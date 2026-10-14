const mongoose = require("mongoose");
const RivetEntry = require("../models/RivetEntry");
const { PROCESS_TYPES } = require("../models/RivetEntry");
const { STOPPAGE_KEYS } = require("../models/ProductionEntry");
const Machine = require("../models/Machine");
const { clockMinutes, findOverlap } = require("../utils/machineTimes");
const { machineNamesFor } = require("../utils/machineNames");
const { reviewFor, logEntrySave, logEntryDelete, logEntryUnlock } = require("../utils/entryAudit");
const { enforcePlannedShift } = require("../utils/plannedShift");
const { WORKING_MODES, isNonWorking, nonWorkingBody } = require("../utils/workingMode");
const { MACHINE_STATUSES } = require("../models/entryCommon");
const { checkNotLocked, parseDay, parseList } = require("./productionSheet.controller");

/**
 * controllers/rivetSheet.controller.js
 * ─────────────────────────────────────
 * The RIVET Data Entry sheet's API — the same shape as the CNC/VMC/SPM sheets'
 * (productionSheet.controller.js: paged by date, three slots per machine per
 * date, no overlapping times for a machine or an operator, a 2-working-day
 * lock with a Super Admin unlock) over its own collection and its own columns.
 */

// A date's slots per machine — the sheet's three rows per machine.
const MAX_SLOTS = 3;
const SLOT_NUMBERS = Array.from({ length: MAX_SLOTS }, (_, i) => i + 1);
// Distinct dates per page, and the widest date window a request may ask for.
const PAGE_SIZE_DAYS = 10;
const MAX_RANGE_DAYS = 366 * 5;

const TEXT_KEYS = ["operator", "processType", "itemName", "drawingNo", "remarks", "otherMinRemark"];
const TIME_KEYS = ["machineOnTime", "machineOffTime"];
const RIVET_OP_KEYS = ["rivetLoadingSec", "rivetProcessSec", "rivetUnloadingCleaningSec", "rivetOtherOperationsSec"];
const NUMBER_KEYS = [
  "noOfHoles",
  ...RIVET_OP_KEYS,
  "totalCycleSec",
  "okQty",
  "rejectedQty",
  "plannedOperatorShiftHours",
  ...STOPPAGE_KEYS,
];

const fail = (message) => Object.assign(new Error(message), { status: 400 });

const toRow = (e) => ({
  ...e,
  date: e.date.toISOString().slice(0, 10),
  machine: String(e.machine),
  item: e.item ? String(e.item) : null,
});

// Builds the stored document from the request body. Blank inputs are unset
// (not saved as 0), so a blank sheet cell stays blank.
const buildFields = (body) => {
  const set = {};
  const unset = {};
  for (const k of TEXT_KEYS) {
    if (body[k] !== undefined) set[k] = String(body[k] ?? "").trim();
  }
  if (set.processType && !PROCESS_TYPES.includes(set.processType)) {
    throw fail(`"${set.processType}" is not a valid Process`);
  }
  for (const k of TIME_KEYS) {
    if (body[k] === undefined) continue;
    if (body[k] === "" || body[k] === null) unset[k] = "";
    else set[k] = String(body[k]);
  }
  for (const k of NUMBER_KEYS) {
    if (body[k] === undefined) continue;
    if (body[k] === "" || body[k] === null) {
      unset[k] = "";
    } else {
      const n = Number(body[k]);
      if (!Number.isFinite(n)) throw fail(`"${k}" must be a number`);
      set[k] = n;
    }
  }
  if (body.item !== undefined) {
    if (body.item && !mongoose.isValidObjectId(body.item)) throw fail("Invalid item");
    set.item = body.item || null;
  }
  // Which of the four operations this entry has unticked — see RivetEntry's own
  // comment; subtracted from totalCycleSec, the item's own record untouched.
  if (body.excludedOps !== undefined) {
    const raw = Array.isArray(body.excludedOps) ? body.excludedOps : [];
    if (raw.some((k) => !RIVET_OP_KEYS.includes(k))) {
      throw fail("Unknown operation in excludedOps");
    }
    const excluded = [...new Set(raw)];
    if (excluded.length) set.excludedOps = excluded;
    else unset.excludedOps = "";
  }
  // Machine Working Status — any of MACHINE_STATUSES (entryCommon.js); none unsets it.
  // Machine Working Status: only "Non Working" is stored (see utils/workingMode.js).
  if (body.workingMode !== undefined) {
    if (isNonWorking(body)) set.workingMode = "Non Working";
    else unset.workingMode = "";
  }
  if (body.machineStatus !== undefined) {
    const raw = Array.isArray(body.machineStatus) ? body.machineStatus : [];
    if (raw.some((v) => !MACHINE_STATUSES.includes(v))) {
      throw Object.assign(new Error("Unknown Machine Working Status"), { status: 400 });
    }
    const list = MACHINE_STATUSES.filter((v) => raw.includes(v));
    if (list.length) set.machineStatus = list;
    else unset.machineStatus = "";
  }
  return { set, unset };
};

// This sheet's key in the audit log, and the fields whose old → new values it records.
const SHEET = "rivet";
const LOG_FIELDS = [...new Set([...TEXT_KEYS, ...TIME_KEYS, ...NUMBER_KEYS, "excludedOps", "machineStatus", "workingMode"])];

const isRowEmpty = (doc) =>
  doc.workingMode !== "Non Working" &&
  !(doc.machineStatus || []).length &&
  TEXT_KEYS.every((k) => !doc[k]) &&
  TIME_KEYS.every((k) => !doc[k]) &&
  NUMBER_KEYS.every((k) => doc[k] === undefined || doc[k] === null);

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";

// Rows saved before a time rule existed may break it; editing something else on
// such a row must still work, so the time rules only apply when the times are
// being set or changed.
const sameTimes = (existing, body) =>
  !!existing && existing.machineOnTime === body.machineOnTime && existing.machineOffTime === body.machineOffTime;

const REQUIRED_FIELDS = [
  ["operator", "Operator"],
  ["processType", "Process"],
  ["itemName", "Part Name"],
  ["machineOnTime", "Machine ON Time"],
  ["machineOffTime", "Machine OFF Time"],
  ["okQty", "Actual OK Quantity"],
  ["rejectedQty", "Rejected Quantity"],
  ["plannedOperatorShiftHours", "Planned Operator Shift"],
];

// Decimal hours as a clock reads them: 3.5 -> "3:30".
const hm = (hours) => {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// The entry form's own rules, re-checked so a request that skips the form can't
// save an incomplete entry. A body with every field blank is how a row is
// cleared, so it passes. Keep in step with client/src/utils/rivetValidation.js.
const entryRuleError = (body, existing = null) => {
  // A Non Working entry records only the day, machine, operator, reason and remarks.
  if (isNonWorking(body)) return null;
  if ([...TEXT_KEYS, ...TIME_KEYS, ...NUMBER_KEYS].every((k) => isBlank(body[k])) && !(body.machineStatus || []).length) return null;

  const missing = REQUIRED_FIELDS.filter(([k]) => isBlank(body[k])).map(([, label]) => label);
  if (missing.length) return `Required: ${missing.join(", ")}`;

  // Total Cycle Time = the Part's own figure (copied onto this entry as
  // totalCycleSec when picked), minus whichever of the four operations are
  // ticked off here — same rule as SPM's own cycle (client/src/utils/rivetSheet.js's
  // rivetCycleSec; keep the two in step).
  if (isBlank(body.totalCycleSec)) return "This Part has no Operation Times set — edit it in Parts first";
  const excludedSet = new Set(Array.isArray(body.excludedOps) ? body.excludedOps : []);
  const excludedSec = RIVET_OP_KEYS.filter((k) => excludedSet.has(k)).reduce((sum, k) => sum + (isBlank(body[k]) ? 0 : Number(body[k])), 0);
  const cycleSec = Number(body.totalCycleSec) - excludedSec;
  if (cycleSec <= 0) return "Total Cycle Time must be more than 0";

  const minutesOf = (k) => (isBlank(body[k]) ? 0 : Number(body[k]));
  if (minutesOf("otherMin") > 0 && isBlank(body.otherMinRemark)) {
    return "A remark is required when Others downtime is entered";
  }

  const on = clockMinutes(body.machineOnTime);
  const off = clockMinutes(body.machineOffTime);
  if (on === null || off === null) return "Machine ON/OFF Time must be HH:mm";
  // The machine runs within one day: a shift through midnight is two entries.
  if (off <= on && !sameTimes(existing, body)) return "Machine OFF Time must be after Machine ON Time";

  const shiftMin = off - on < 0 ? off - on + 1440 : off - on;
  // The most the shift could make: floor(shift seconds ÷ cycle seconds).
  const ideal = Math.floor((shiftMin * 60) / cycleSec);
  if (Number(body.okQty) + Number(body.rejectedQty) > ideal) {
    return `OK + Rejected (${Number(body.okQty) + Number(body.rejectedQty)}) can't be more than Ideal Quantity (${ideal})`;
  }

  const plannedMin = Math.round(Number(body.plannedOperatorShiftHours) * 60);
  if (plannedMin < shiftMin) {
    return `Planned Operator Shift (${hm(Number(body.plannedOperatorShiftHours))}) can't be less than Machine Shift (${hm(shiftMin / 60)})`;
  }
  // Total stoppage (Lunch / Rest included) has to fit inside the machine's
  // own ON–OFF span — stoppage happens inside the shift, not in some
  // separate block of time beyond it (client/src/utils/entryValidation.js's
  // stoppageLimitMin; keep the two in step).
  const limit = shiftMin;
  const total = STOPPAGE_KEYS.reduce((sum, k) => sum + minutesOf(k), 0);
  if (total > limit) {
    return `Total stoppage (${total} min) can't be more than the Machine Shift (${limit} min)`;
  }
  return null;
};

const dayLabel = (date) => {
  const [y, m, d] = String(date).split("-");
  return `${d}/${m}/${y}`;
};

// GET /spm-sheet?from&to&page[&machine=id1,id2][&operator=a,b][&item=name1,name2]
// Paginated by distinct date, newest first — a date's entries are one block on
// the sheet, so paging is by whole date, never mid-date.
exports.getSheet = async (req, res) => {
  try {
    const from = parseDay(req.query.from);
    const to = parseDay(req.query.to);
    if (!from || !to || to < from) {
      return res.status(400).json({ isOk: false, message: "Valid 'from' and 'to' dates (YYYY-MM-DD) are required" });
    }
    if ((to - from) / 86400000 > MAX_RANGE_DAYS) {
      return res.status(400).json({ isOk: false, message: `Date range can't exceed ${MAX_RANGE_DAYS} days` });
    }

    // Only Machine narrows the fetch itself, so a date's rows are always a
    // machine's whole day (the day-level OEE figures need that). Operator/Item
    // only narrow which dates qualify for paging; the client filters the rows.
    const query = { date: { $gte: from, $lte: to } };
    if (req.query.machine) {
      const ids = parseList(req.query.machine);
      if (!ids.length || ids.some((id) => !mongoose.isValidObjectId(id))) {
        return res.status(400).json({ isOk: false, message: "Invalid machine" });
      }
      query.machine = { $in: ids };
    }
    const dateFilterQuery = { ...query };
    if (req.query.operator) dateFilterQuery.operator = { $in: parseList(req.query.operator) };
    if (req.query.item) dateFilterQuery.itemName = { $in: parseList(req.query.item) };

    const distinctDates = await RivetEntry.find(dateFilterQuery).distinct("date");
    const sortedDates = distinctDates.map((d) => d.toISOString().slice(0, 10)).sort().reverse();
    const totalDays = sortedDates.length;
    const totalPages = Math.max(1, Math.ceil(totalDays / PAGE_SIZE_DAYS));
    const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);
    const pageDates = sortedDates.slice((page - 1) * PAGE_SIZE_DAYS, page * PAGE_SIZE_DAYS).map(parseDay);

    const entries = pageDates.length
      ? await RivetEntry.find({ ...query, date: { $in: pageDates } })
          .select("-__v -createdAt -updatedBy -updatedByModel")
          .lean()
      : [];

    // The pickers list active machines only, so the names of any other machine
    // these entries were made on (deactivated, or deleted since) come with them.
    res.status(200).json({
      isOk: true,
      data: entries.map(toRow),
      meta: { page, totalPages, totalDays },
      machineNames: await machineNamesFor(entries.map((e) => e.machine)),
    });
  } catch (error) {
    console.error("Error loading RIVET sheet:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /spm-sheet/extent — earliest and latest entry date across every saved record.
exports.getExtent = async (req, res) => {
  try {
    const [oldest, newest] = await Promise.all([
      RivetEntry.findOne().sort({ date: 1 }).select("date").lean(),
      RivetEntry.findOne().sort({ date: -1 }).select("date").lean(),
    ]);
    const data =
      oldest && newest ? { from: oldest.date.toISOString().slice(0, 10), to: newest.date.toISOString().slice(0, 10) } : null;
    res.status(200).json({ isOk: true, data });
  } catch (error) {
    console.error("Error loading RIVET sheet extent:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /spm-sheet/filter-options?from&to — the distinct Machine/Operator/Item
// values in that date range, for the Filters panel's pickers.
exports.getFilterOptions = async (req, res) => {
  try {
    const from = parseDay(req.query.from);
    const to = parseDay(req.query.to);
    if (!from || !to || to < from) {
      return res.status(400).json({ isOk: false, message: "Valid 'from' and 'to' dates (YYYY-MM-DD) are required" });
    }
    const query = { date: { $gte: from, $lte: to } };
    const [machine, operator, itemName] = await Promise.all([
      RivetEntry.distinct("machine", query),
      RivetEntry.distinct("operator", { ...query, operator: { $nin: ["", null] } }),
      RivetEntry.distinct("itemName", { ...query, itemName: { $nin: ["", null] } }),
    ]);
    res.status(200).json({
      isOk: true,
      data: { machine: machine.map(String), operator, item: itemName },
      machineNames: await machineNamesFor(machine),
    });
  } catch (error) {
    console.error("Error loading RIVET sheet filter options:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// PUT /spm-sheet/row — upserts one (date, machine, slot) row; a row with every
// field blank is deleted instead.
exports.saveRow = async (req, res) => {
  try {
    const { date, machine, slot, _id } = req.body;
    const day = parseDay(date);
    if (!day) return res.status(400).json({ isOk: false, message: "Valid date (YYYY-MM-DD) is required" });
    if (!mongoose.isValidObjectId(machine) || !(await Machine.exists({ _id: machine, isActive: true }))) {
      return res.status(400).json({ isOk: false, message: "Machine not found or inactive" });
    }
    // Found by _id when the client sends one (every edit does) — NOT by
    // (date, machine, slot) alone, which breaks the moment an edit changes
    // the Date (or Machine): nothing at the NEW (date, machine, slot)
    // matched yet, so upsert below created a second row there instead of
    // moving the first, leaving the original stranded at its old date (see
    // the same fix in productionSheet.controller.js's saveRow). Falls back
    // to the composite-key lookup only for a caller that still doesn't send
    // _id.
    const editSlot = slot === "auto" ? null : Number(slot);
    let existing =
      _id && mongoose.isValidObjectId(_id)
        ? await RivetEntry.findById(_id)
            .lean()
        : null;
    if (!existing && editSlot && SLOT_NUMBERS.includes(editSlot)) {
      existing = await RivetEntry.findOne({ date: day, machine, slot: editSlot })
        .lean();
    }
    // The Operator Planned Shift comes from the machine's process (Process
    // Master), never from what was typed — see utils/plannedShift.js.
    if (req.body.workingMode !== undefined && !WORKING_MODES.includes(String(req.body.workingMode).trim())) {
      return res.status(400).json({ isOk: false, message: "Machine Working Status must be Working or Non Working" });
    }
    if (isNonWorking(req.body)) req.body = nonWorkingBody(req.body);
    await enforcePlannedShift(req.body, existing);
    const ruleError = entryRuleError(req.body, existing);
    if (ruleError) return res.status(400).json({ isOk: false, message: ruleError });

    // The form sends "auto" for a new entry; the lowest free slot is picked here
    // because only the server sees every entry, so a new one can never overwrite
    // an existing one.
    let slotNo;
    if (slot === "auto") {
      const used = new Set((await RivetEntry.find({ date: day, machine }).select("slot").lean()).map((e) => e.slot));
      slotNo = SLOT_NUMBERS.find((n) => !used.has(n));
      if (!slotNo) {
        return res.status(400).json({
          isOk: false,
          message: `This machine already has ${MAX_SLOTS} entries on ${dayLabel(date)} — edit one of them instead`,
        });
      }
    } else {
      slotNo = Number(slot);
      if (!SLOT_NUMBERS.includes(slotNo)) {
        return res.status(400).json({ isOk: false, message: `Slot must be 1–${MAX_SLOTS}` });
      }
      // An edit that moved to a different Date (or Machine) carries its old
      // slot number over, which may already belong to an unrelated entry on
      // the new date — reassign to that date's next free slot instead of
      // colliding with (or, worse, overwriting) someone else's row.
      if (existing) {
        const existingDay = existing.date instanceof Date ? existing.date.toISOString().slice(0, 10) : String(existing.date).slice(0, 10);
        const moved = existingDay !== date || String(existing.machine) !== String(machine);
        if (moved) {
          const used = new Set(
            (await RivetEntry.find({ date: day, machine, _id: { $ne: existing._id } }).select("slot").lean()).map((e) => e.slot),
          );
          if (used.has(slotNo)) {
            const free = SLOT_NUMBERS.find((n) => !used.has(n));
            if (!free) {
              return res.status(400).json({
                isOk: false,
                message: `This machine already has ${MAX_SLOTS} entries on ${dayLabel(date)} — can't move this entry there`,
              });
            }
            slotNo = free;
          }
        }
      }
      // Only editing a saved row can be locked; catching up on a late new
      // entry is fine. The window counts from when that row was first saved
      // (createdAt), not from its own Date — see checkNotLocked's own comment.
      if (existing) {
        const createdAtISO = new Date(existing.createdAt).toISOString().slice(0, 10);
        const lockMessage = await checkNotLocked(createdAtISO, req.user, existing.unlockedUntil);
        if (lockMessage) return res.status(403).json({ isOk: false, message: lockMessage });
      }
    }

    // One machine runs one thing at a time.
    if (!sameTimes(existing, req.body)) {
      const others = await RivetEntry.find({ date: day, machine, slot: { $ne: slotNo } })
        .select("slot machineOnTime machineOffTime")
        .lean();
      const clash = findOverlap(req.body.machineOnTime, req.body.machineOffTime, others);
      if (clash) {
        return res.status(400).json({
          isOk: false,
          message: `This machine already has an entry from ${clash.text} on ${dayLabel(date)}. Machine ON/OFF times can't overlap.`,
        });
      }
    }

    // One operator runs one machine at a time (on this RIVET sheet).
    const operator = String(req.body.operator ?? "").trim();
    const operatorChanged = !existing || String(existing.operator ?? "").trim() !== operator;
    if (operator && (operatorChanged || !sameTimes(existing, req.body))) {
      const others = await RivetEntry.find({ date: day, operator, $nor: [{ machine, slot: slotNo }] })
        .select("machine slot machineOnTime machineOffTime")
        .populate("machine", "machineName")
        .lean();
      const elsewhere = others.filter((o) => String(o.machine?._id ?? o.machine) !== String(machine));
      const clash = findOverlap(req.body.machineOnTime, req.body.machineOffTime, elsewhere);
      if (clash) {
        const other = elsewhere.find((o) => o.slot === clash.slot);
        return res.status(400).json({
          isOk: false,
          message: `Operator ${operator} is already on machine ${other?.machine?.machineName || "another machine"} from ${clash.text} on ${dayLabel(date)}. An operator can't run two machines at the same time.`,
        });
      }
    }

    const { set, unset } = buildFields(req.body);
    // Availability / Performance / Quality, and whether this save needs Admin
    // review — written in the same update as the entry (utils/entryAudit.js).
    const review = reviewFor(SHEET, existing, set, unset);
    // date/machine/slot aren't in `set` (buildFields never touches them), but
    // an edit by _id has to carry them explicitly, since it's no longer the
    // findOneAndUpdate filter doing that for free the way an upsert's match
    // fields do.
    const fields = { ...set, date: day, machine, slot: slotNo };

    const doc = existing
      ? await RivetEntry.findByIdAndUpdate(
          existing._id,
          {
            $set: { ...fields, ...review.set, updatedBy: req.user._id, updatedByModel: req.user.constructor.modelName },
            ...(Object.keys({ ...unset, ...review.unset }).length ? { $unset: { ...unset, ...review.unset } } : {}),
          },
          { new: true, runValidators: true },
        ).lean()
      : await RivetEntry.findOneAndUpdate(
          { date: day, machine, slot: slotNo },
          {
            $set: { ...set, ...review.set, updatedBy: req.user._id, updatedByModel: req.user.constructor.modelName },
            ...(Object.keys({ ...unset, ...review.unset }).length ? { $unset: { ...unset, ...review.unset } } : {}),
          },
          { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
        ).lean();

    if (isRowEmpty(doc)) {
      await RivetEntry.deleteOne({ _id: doc._id });
      if (existing) await logEntryDelete({ sheet: SHEET, req, before: existing, fields: LOG_FIELDS });
      return res.status(200).json({ isOk: true, data: null, message: "Row cleared" });
    }
    await logEntrySave({ sheet: SHEET, req, before: existing, after: doc, fields: LOG_FIELDS, review });
    res.status(200).json({ isOk: true, data: toRow(doc), message: "Row saved" });
  } catch (error) {
    console.error("Error saving RIVET row:", error);
    const status = error.status || (error.name === "ValidationError" || error.name === "CastError" ? 400 : 500);
    res.status(status).json({ isOk: false, message: error.message });
  }
};

// GET /spm-sheet/occupied?date=YYYY-MM-DD&machine=<id>  — the slots a machine
// already has on a date; or ?date&operator=<name> (no machine) — everything that
// operator has that date on any RIVET machine. So the form can flag an overlap
// before Save (saveRow still enforces it).
exports.getOccupied = async (req, res) => {
  try {
    const day = parseDay(req.query.date);
    const { machine } = req.query;
    const operator = String(req.query.operator ?? "").trim();
    if (day && !machine && operator) {
      const rows = await RivetEntry.find({ date: day, operator })
        .select("machine slot machineOnTime machineOffTime")
        .populate("machine", "machineName")
        .sort({ machineOnTime: 1 })
        .lean();
      return res.status(200).json({
        isOk: true,
        data: rows.map((r) => ({
          machine: String(r.machine?._id ?? r.machine),
          machineName: r.machine?.machineName || "",
          slot: r.slot,
          machineOnTime: r.machineOnTime || "",
          machineOffTime: r.machineOffTime || "",
        })),
      });
    }
    if (!day || !mongoose.isValidObjectId(machine)) {
      return res.status(400).json({ isOk: false, message: "Valid date (YYYY-MM-DD) and machine are required" });
    }
    const rows = await RivetEntry.find({ date: day, machine }).select("slot machineOnTime machineOffTime").sort({ slot: 1 }).lean();
    res.status(200).json({
      isOk: true,
      data: rows.map((r) => ({ slot: r.slot, machineOnTime: r.machineOnTime || "", machineOffTime: r.machineOffTime || "" })),
    });
  } catch (error) {
    console.error("Error reading occupied RIVET machine times:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// DELETE /spm-sheet/row/:id — removes one saved entry (unless locked).
exports.deleteRow = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ isOk: false, message: "Invalid entry" });
    }
    const existing = await RivetEntry.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ isOk: false, message: "Entry not found" });
    const lockMessage = await checkNotLocked(new Date(existing.createdAt).toISOString().slice(0, 10), req.user, existing.unlockedUntil);
    if (lockMessage) return res.status(403).json({ isOk: false, message: lockMessage });

    const deleted = await RivetEntry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ isOk: false, message: "Entry not found" });
    await logEntryDelete({ sheet: SHEET, req, before: existing, fields: LOG_FIELDS });
    res.status(200).json({ isOk: true, message: "Entry deleted" });
  } catch (error) {
    console.error("Error deleting RIVET row:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// PUT /spm-sheet/row/:id/unlock — Super Admin only (route-level authorize):
// 24 hours of edit/delete on this one entry despite the working-day lock.
exports.unlockRow = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ isOk: false, message: "Invalid entry" });
    }
    const unlockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const entry = await RivetEntry.findByIdAndUpdate(req.params.id, { $set: { unlockedUntil } }, { new: true }).lean();
    if (!entry) return res.status(404).json({ isOk: false, message: "Entry not found" });
    await logEntryUnlock({ sheet: SHEET, req, entry });
    res.status(200).json({ isOk: true, data: toRow(entry), message: "Unlocked for 24 hours" });
  } catch (error) {
    console.error("Error unlocking RIVET row:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
