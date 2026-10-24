const mongoose = require("mongoose");
const PowderCoatingEntry = require("../models/PowderCoatingEntry");
const { WORKING_STATUSES, NON_WORKING_STATUSES, DEFECT_KEYS, IDLE_KEYS } = require("../models/PowderCoatingEntry");
const MachineOperator = require("../models/MachineOperator");
const Process = require("../models/Process");
const { clockMinutes, findOverlap } = require("../utils/machineTimes");
const { machineNamesFor } = require("../utils/machineNames");
const { reviewFor, logEntrySave, logEntryDelete, logEntryUnlock, withAuthors } = require("../utils/entryAudit");
const { vendorFields } = require("../utils/entryVendor");
const { enforcePlannedShiftForProcess } = require("../utils/plannedShift");
const { WORKING_MODES, isNonWorking, nonWorkingBody } = require("../utils/workingMode");
const { MACHINE_STATUSES } = require("../models/entryCommon");
const { checkNotLocked, parseDay, parseList } = require("./productionSheet.controller");

/**
 * controllers/powderCoatingSheet.controller.js
 * ───────────────────────────────────────────────
 * The After Powder Coating inspection sheet's API — the same shape as the
 * Spring sheet's (springSheet.controller.js: paged by date, three slots per
 * date, no overlapping times, a 2-working-day lock with a Super Admin unlock),
 * but kept per WORKER instead of per machine: there is no machine on this
 * sheet. A worker inspects one thing at a time, so their entries on a date
 * can't overlap. The Operator Planned Shift comes from the entry's own process
 * (there's no machine to find it through). TOTAL QTY and the four defect /
 * rework counts are typed; Total Defect / Rework (rejectedQty) is their sum
 * and OK Qty what's left of Total, both set here.
 *
 * Rows go back to the client with `machine` set to the worker's id as well,
 * so the shared table, day formulas and dashboard group by worker exactly as
 * they group every other sheet by machine; `machineNames` names the workers.
 */

// A date's slots per worker.
const MAX_SLOTS = 3;
const SLOT_NUMBERS = Array.from({ length: MAX_SLOTS }, (_, i) => i + 1);
// Distinct dates per page, and the widest date window a request may ask for.
const PAGE_SIZE_DAYS = 10;
const MAX_RANGE_DAYS = 366 * 5;

const TEXT_KEYS = ["workingStatus", "itemName", "otherActivity", "remarks", "otherMinRemark"];
const TIME_KEYS = ["machineOnTime", "machineOffTime"];
const NUMBER_KEYS = ["totalCycleSec", "actualQty", ...DEFECT_KEYS, "otherActivityMin", "plannedOperatorShiftHours", ...IDLE_KEYS];
// What a status-only entry (ABSENT, SUNDAY, …) never carries.
const PRODUCTION_KEYS = ["itemName", "otherActivity", "otherMinRemark", ...TIME_KEYS, ...NUMBER_KEYS];

const isStatusOnly = (body) => NON_WORKING_STATUSES.includes(String(body?.workingStatus ?? "").trim());

const fail = (message) => Object.assign(new Error(message), { status: 400 });

const toRow = (e) => ({
  ...e,
  date: e.date.toISOString().slice(0, 10),
  worker: String(e.worker),
  // The worker stands where the machine stands on every other sheet.
  machine: String(e.worker),
  process: e.process ? String(e.process) : null,
  item: e.item ? String(e.item) : null,
  vendor: e.vendor ? String(e.vendor) : null,
});

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";

// Builds the stored document from the request body. Blank inputs are unset
// (not saved as 0), so a blank sheet cell stays blank.
const buildFields = (body) => {
  const set = {};
  const unset = {};
  for (const k of TEXT_KEYS) {
    if (body[k] !== undefined) set[k] = String(body[k] ?? "").trim();
  }
  if (set.workingStatus && !WORKING_STATUSES.includes(set.workingStatus)) {
    throw fail(`"${set.workingStatus}" is not a valid Working Status`);
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
  // Total Defect / Rework is the four types added up, and OK Qty what's left
  // of Total Qty — both blank while Total Qty is (a status-only or cleared row).
  if (body.actualQty !== undefined || DEFECT_KEYS.some((k) => body[k] !== undefined)) {
    if (isBlank(body.actualQty)) {
      Object.assign(unset, { okQty: "", rejectedQty: "" });
    } else {
      set.rejectedQty = DEFECT_KEYS.reduce((sum, k) => sum + (isBlank(body[k]) ? 0 : Number(body[k])), 0);
      set.okQty = Number(body.actualQty) - set.rejectedQty;
    }
  }
  if (body.item !== undefined) {
    if (body.item && !mongoose.isValidObjectId(body.item)) throw fail("Invalid item");
    set.item = body.item || null;
  }
  // Working Status: only "Non Working" is stored (see utils/workingMode.js).
  if (body.workingMode !== undefined) {
    if (isNonWorking(body)) set.workingMode = "Non Working";
    else unset.workingMode = "";
  }
  if (body.machineStatus !== undefined) {
    const raw = Array.isArray(body.machineStatus) ? body.machineStatus : [];
    if (raw.some((v) => !MACHINE_STATUSES.includes(v))) throw fail("Unknown Reason For Not Working");
    const list = MACHINE_STATUSES.filter((v) => raw.includes(v));
    if (list.length) set.machineStatus = list;
    else unset.machineStatus = "";
  }
  return { set, unset };
};

// This sheet's key in the audit log, and the fields whose old → new values it records.
// Operator isn't one of them: here it is only the worker's name, already
// logged as Worker Name.
const SHEET = "powder";
const LOG_FIELDS = [...new Set(["worker", "vendorName", ...TEXT_KEYS, ...TIME_KEYS, ...NUMBER_KEYS, "machineStatus", "workingMode"])];

const isRowEmpty = (doc) =>
  doc.workingMode !== "Non Working" &&
  !(doc.machineStatus || []).length &&
  !doc.vendor &&
  TEXT_KEYS.every((k) => !doc[k]) &&
  TIME_KEYS.every((k) => !doc[k]) &&
  NUMBER_KEYS.every((k) => doc[k] === undefined || doc[k] === null);

// Rows saved before a time rule existed may break it; editing something else on
// such a row must still work, so the time rules only apply when the times are
// being set or changed.
const sameTimes = (existing, body) =>
  !!existing && existing.machineOnTime === body.machineOnTime && existing.machineOffTime === body.machineOffTime;

// Whether a save moves a saved entry to another Date or Worker. The exemption
// above only holds while the entry stays where it is: moved, its times meet
// entries they were never checked against, so the overlap rules apply again.
const movesEntry = (existing, date, worker) => {
  if (!existing) return false;
  const existingDay = existing.date instanceof Date ? existing.date.toISOString().slice(0, 10) : String(existing.date).slice(0, 10);
  return existingDay !== date || String(existing.worker) !== String(worker);
};

const REQUIRED_FIELDS = [
  ["itemName", "Item Name"],
  ["totalCycleSec", "Standard Inspection Time per Piece"],
  ["machineOnTime", "Inspection Start Time"],
  ["machineOffTime", "Inspection End Time"],
  ["actualQty", "Total Qty"],
  ["plannedOperatorShiftHours", "Planned Operator Shift"],
];

// Decimal hours as a clock reads them: 3.5 -> "3:30".
const hm = (hours) => {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// The entry form's own rules, re-checked so a request that skips the form can't
// save an incomplete entry. A body with every field blank is how a row is
// cleared, so it passes. Keep in step with client/src/utils/powderCoatingValidation.js.
const entryRuleError = (body, existing = null) => {
  // A Non Working entry records only the day, worker, reason and remarks.
  if (isNonWorking(body)) return null;
  if ([...TEXT_KEYS, ...TIME_KEYS, ...NUMBER_KEYS].every((k) => isBlank(body[k])) && isBlank(body.vendor) && !(body.machineStatus || []).length) {
    return null;
  }
  // A status-only day (ABSENT, SUNDAY, …) needs nothing beyond its Date,
  // Worker (both checked in saveRow) and the status itself.
  if (isStatusOnly(body)) return null;

  const missing = REQUIRED_FIELDS.filter(([k]) => isBlank(body[k])).map(([, label]) => label);
  if (missing.length) return `Required: ${missing.join(", ")}`;

  const cycleSec = Number(body.totalCycleSec);
  if (!(cycleSec > 0)) return "Standard Inspection Time per Piece must be more than 0";

  const minutesOf = (k) => (isBlank(body[k]) ? 0 : Number(body[k]));
  if (minutesOf("otherMin") > 0 && isBlank(body.otherMinRemark)) {
    return "A remark is required when Other idle time is entered";
  }
  if (minutesOf("otherActivityMin") > 0 && isBlank(body.otherActivity)) {
    return "Say what the Other Activity was when its time is entered";
  }

  const on = clockMinutes(body.machineOnTime);
  const off = clockMinutes(body.machineOffTime);
  if (on === null || off === null) return "Inspection Start / End Time must be HH:mm";
  // An inspection runs within one day: one through midnight is two entries.
  if (off <= on && !sameTimes(existing, body)) return "Inspection End Time must be after Inspection Start Time";

  const shiftMin = off - on < 0 ? off - on + 1440 : off - on;
  // Total Qty may be more than Ideal Inspection Quantity — a person can beat the
  // standard time, unlike a machine its cycle — and such an entry is held for
  // OEE Review (Performance > 100%, see reviewFor) rather than refused.
  const total = Number(body.actualQty);
  const defects = DEFECT_KEYS.reduce((sum, k) => sum + minutesOf(k), 0);
  if (defects > total) return `Total Defect / Rework (${defects}) can't be more than Total Qty (${total})`;

  const plannedMin = Math.round(Number(body.plannedOperatorShiftHours) * 60);
  if (plannedMin < shiftMin) {
    return `Planned Operator Shift (${hm(Number(body.plannedOperatorShiftHours))}) can't be less than Inspection Working Hours (${hm(shiftMin / 60)})`;
  }
  // Idle time and Other Activity both happen inside the working hours.
  const away = [...IDLE_KEYS, "otherActivityMin"].reduce((sum, k) => sum + minutesOf(k), 0);
  if (away > shiftMin) {
    return `Idle Time + Other Activity (${away} min) can't be more than the Inspection Working Hours (${shiftMin} min)`;
  }
  return null;
};

const dayLabel = (date) => {
  const [y, m, d] = String(date).split("-");
  return `${d}/${m}/${y}`;
};

const validIds = (list) => list.length && list.every((id) => mongoose.isValidObjectId(id));

// GET /powder-coating-sheet?from&to&page[&worker=id1,id2][&item=name1,name2][&vendor=name1,name2]
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

    const query = { date: { $gte: from, $lte: to } };
    if (req.query.worker) {
      const ids = parseList(req.query.worker);
      if (!validIds(ids)) return res.status(400).json({ isOk: false, message: "Invalid worker" });
      query.worker = { $in: ids };
    }
    const dateFilterQuery = { ...query };
    if (req.query.item) dateFilterQuery.itemName = { $in: parseList(req.query.item) };
    if (req.query.vendor) dateFilterQuery.vendorName = { $in: parseList(req.query.vendor) };

    const distinctDates = await PowderCoatingEntry.find(dateFilterQuery).distinct("date");
    const sortedDates = distinctDates.map((d) => d.toISOString().slice(0, 10)).sort().reverse();
    const totalDays = sortedDates.length;
    const totalPages = Math.max(1, Math.ceil(totalDays / PAGE_SIZE_DAYS));
    const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);
    const pageDates = sortedDates.slice((page - 1) * PAGE_SIZE_DAYS, page * PAGE_SIZE_DAYS).map(parseDay);

    const entries = pageDates.length
      ? await PowderCoatingEntry.find({ ...query, date: { $in: pageDates } })
          // createdAt and unlockedUntil stay in: the sheet works out each row's
          // working-day lock, and whether to offer Unlock, from them.
          .select("-__v")
          .lean()
          .then((rows) => withAuthors(SHEET, rows))
      : [];

    res.status(200).json({
      isOk: true,
      data: entries.map(toRow),
      meta: { page, totalPages, totalDays },
      // Worker names, under the key every sheet's page reads its names from.
      machineNames: await machineNamesFor(entries.map((e) => e.worker)),
    });
  } catch (error) {
    console.error("Error loading After Powder Coating sheet:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /powder-coating-sheet/extent — earliest and latest entry date across every saved record.
exports.getExtent = async (req, res) => {
  try {
    const [oldest, newest] = await Promise.all([
      PowderCoatingEntry.findOne().sort({ date: 1 }).select("date").lean(),
      PowderCoatingEntry.findOne().sort({ date: -1 }).select("date").lean(),
    ]);
    const data =
      oldest && newest ? { from: oldest.date.toISOString().slice(0, 10), to: newest.date.toISOString().slice(0, 10) } : null;
    res.status(200).json({ isOk: true, data });
  } catch (error) {
    console.error("Error loading After Powder Coating sheet extent:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /powder-coating-sheet/filter-options?from&to — the distinct Worker / Item /
// Vendor values in that date range, for the Filters panel's pickers. Workers go
// under `machine`, where every sheet's Filters panel looks for its row key.
exports.getFilterOptions = async (req, res) => {
  try {
    const from = parseDay(req.query.from);
    const to = parseDay(req.query.to);
    if (!from || !to || to < from) {
      return res.status(400).json({ isOk: false, message: "Valid 'from' and 'to' dates (YYYY-MM-DD) are required" });
    }
    const query = { date: { $gte: from, $lte: to } };
    const [worker, itemName, vendorName] = await Promise.all([
      PowderCoatingEntry.distinct("worker", query),
      PowderCoatingEntry.distinct("itemName", { ...query, itemName: { $nin: ["", null] } }),
      PowderCoatingEntry.distinct("vendorName", { ...query, vendorName: { $nin: ["", null] } }),
    ]);
    res.status(200).json({
      isOk: true,
      data: { machine: worker.map(String), operator: [], item: itemName, vendor: vendorName },
      machineNames: await machineNamesFor(worker),
    });
  } catch (error) {
    console.error("Error loading After Powder Coating filter options:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// PUT /powder-coating-sheet/row — upserts one (date, worker, slot) row; a row with
// every field blank is deleted instead.
exports.saveRow = async (req, res) => {
  try {
    // A status-only entry never keeps inspection figures, whatever the
    // request carried — blanking them here unsets anything saved before.
    if (isStatusOnly(req.body)) {
      req.body = { ...req.body, ...Object.fromEntries(PRODUCTION_KEYS.map((k) => [k, ""])), item: null, vendor: null };
    }
    const { date, worker, slot, _id } = req.body;
    const day = parseDay(date);
    if (!day) return res.status(400).json({ isOk: false, message: "Valid date (YYYY-MM-DD) is required" });
    const workerDoc = mongoose.isValidObjectId(worker) ? await MachineOperator.findOne({ _id: worker, isActive: true }).select("name").lean() : null;
    if (!workerDoc) return res.status(400).json({ isOk: false, message: "Worker not found or inactive" });
    // The worker's name is what this entry's Operator / Worker Name reads.
    req.body.operator = workerDoc.name;

    // Found by _id when the client sends one (every edit does) — NOT by
    // (date, worker, slot) alone, which breaks the moment an edit changes the
    // Date (or Worker). Falls back to the composite-key lookup only for a
    // caller that doesn't send _id.
    const editSlot = slot === "auto" ? null : Number(slot);
    let existing = _id && mongoose.isValidObjectId(_id) ? await PowderCoatingEntry.findById(_id).lean() : null;
    if (!existing && editSlot && SLOT_NUMBERS.includes(editSlot)) {
      existing = await PowderCoatingEntry.findOne({ date: day, worker, slot: editSlot }).lean();
    }

    // The process this entry belongs to: an edit keeps its own; a new one
    // takes the process the page is linked to (sent by the form).
    const processId = existing?.process || req.body.process;
    if (!mongoose.isValidObjectId(processId) || !(await Process.exists({ _id: processId }))) {
      return res.status(400).json({ isOk: false, message: "Process not found" });
    }

    if (req.body.workingMode !== undefined && !WORKING_MODES.includes(String(req.body.workingMode).trim())) {
      return res.status(400).json({ isOk: false, message: "Working Status must be Working or Non Working" });
    }
    if (isNonWorking(req.body)) req.body = { ...nonWorkingBody(req.body), vendor: null };
    // The Operator Planned Shift comes from the process (Process Master), not
    // from what was typed, while it's locked — see utils/plannedShift.js.
    await enforcePlannedShiftForProcess(req.body, existing, processId);
    const ruleError = entryRuleError(req.body, existing);
    if (ruleError) return res.status(400).json({ isOk: false, message: ruleError });

    // Only an edit of an already-saved row can be locked; catching up on a late
    // new entry is fine. Every save that finds a saved row is checked, whatever
    // slot it names — one sent with slot "auto" used to skip this. The window
    // counts from when that row was first saved (createdAt), not from its own
    // Date — see checkNotLocked's own comment.
    if (existing) {
      const createdAtISO = new Date(existing.createdAt).toISOString().slice(0, 10);
      const lockMessage = await checkNotLocked(createdAtISO, req.user, existing.unlockedUntil);
      if (lockMessage) return res.status(403).json({ isOk: false, message: lockMessage });
    }
    // Whether this save moves the saved entry to another Date or Worker — for the
    // slot it lands in and the overlap checks below.
    const moved = movesEntry(existing, date, worker);

    // The form sends "auto" for a new entry; the lowest free slot is picked here
    // because only the server sees every entry, so a new one can never overwrite
    // an existing one.
    let slotNo;
    if (slot === "auto") {
      const used = new Set((await PowderCoatingEntry.find({ date: day, worker }).select("slot").lean()).map((e) => e.slot));
      slotNo = SLOT_NUMBERS.find((n) => !used.has(n));
      if (!slotNo) {
        return res.status(400).json({
          isOk: false,
          message: `${workerDoc.name} already has ${MAX_SLOTS} entries on ${dayLabel(date)} — edit one of them instead`,
        });
      }
    } else {
      slotNo = Number(slot);
      if (!SLOT_NUMBERS.includes(slotNo)) {
        return res.status(400).json({ isOk: false, message: `Slot must be 1–${MAX_SLOTS}` });
      }
      // An edit that moved to a different Date (or Worker) carries its old slot
      // number over, which may already belong to another entry there —
      // reassign to that date's next free slot instead of colliding with it.
      if (moved) {
        const used = new Set(
          (await PowderCoatingEntry.find({ date: day, worker, _id: { $ne: existing._id } }).select("slot").lean()).map((e) => e.slot),
        );
        if (used.has(slotNo)) {
          const free = SLOT_NUMBERS.find((n) => !used.has(n));
          if (!free) {
            return res.status(400).json({
              isOk: false,
              message: `${workerDoc.name} already has ${MAX_SLOTS} entries on ${dayLabel(date)} — can't move this entry there`,
            });
          }
          slotNo = free;
        }
      }
    }

    // One worker inspects one thing at a time. Checked when the times are new or
    // changed, or the entry moves to another Date or Worker.
    if (moved || !sameTimes(existing, req.body)) {
      const others = await PowderCoatingEntry.find({ date: day, worker, ...(existing ? { _id: { $ne: existing._id } } : {}) })
        .select("slot machineOnTime machineOffTime")
        .lean();
      const clash = findOverlap(req.body.machineOnTime, req.body.machineOffTime, others);
      if (clash) {
        return res.status(400).json({
          isOk: false,
          message: `${workerDoc.name} already has an inspection from ${clash.text} on ${dayLabel(date)}. A worker's times can't overlap.`,
        });
      }
    }

    const { set, unset } = buildFields(req.body);
    set.operator = workerDoc.name;
    // Vendor Name — only a vendor ticked for this process (utils/entryVendor.js).
    const vendorUpdate = await vendorFields(req.body, existing, processId);
    Object.assign(set, vendorUpdate.set);
    Object.assign(unset, vendorUpdate.unset);
    // Whether Planned came from the lock — set by enforcePlannedShift above, never by the request.
    if (typeof req.body.plannedLocked === "boolean") set.plannedLocked = req.body.plannedLocked;
    else unset.plannedLocked = "";
    // Availability / Performance / Quality, and whether this save needs Admin
    // review — written in the same update as the entry (utils/entryAudit.js).
    const review = reviewFor(SHEET, existing, set, unset);
    // date/worker/process/slot aren't in `set`, but an edit by _id has to carry
    // them explicitly, since it's no longer the upsert's match doing that.
    const fields = { ...set, date: day, worker, process: processId, slot: slotNo };
    const stamp = { updatedBy: req.user._id, updatedByModel: req.user.constructor.modelName };
    const $unset = { ...unset, ...review.unset };

    const doc = existing
      ? await PowderCoatingEntry.findByIdAndUpdate(
          existing._id,
          { $set: { ...fields, ...review.set, ...stamp }, ...(Object.keys($unset).length ? { $unset } : {}) },
          { new: true, runValidators: true },
        ).lean()
      : await PowderCoatingEntry.findOneAndUpdate(
          { date: day, worker, slot: slotNo },
          { $set: { ...set, process: processId, ...review.set, ...stamp }, ...(Object.keys($unset).length ? { $unset } : {}) },
          { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
        ).lean();

    if (isRowEmpty(doc)) {
      await PowderCoatingEntry.deleteOne({ _id: doc._id });
      if (existing) await logEntryDelete({ sheet: SHEET, req, before: existing, fields: LOG_FIELDS });
      return res.status(200).json({ isOk: true, data: null, message: "Row cleared" });
    }
    await logEntrySave({ sheet: SHEET, req, before: existing, after: doc, fields: LOG_FIELDS, review });
    res.status(200).json({ isOk: true, data: toRow(doc), message: "Row saved" });
  } catch (error) {
    console.error("Error saving After Powder Coating row:", error);
    const status = error.status || (error.name === "ValidationError" || error.name === "CastError" ? 400 : 500);
    res.status(status).json({ isOk: false, message: error.message });
  }
};

// GET /powder-coating-sheet/occupied?date=YYYY-MM-DD&worker=<id> — the slots and
// times a worker already has on a date, so the form can flag an overlap before
// Save (saveRow still enforces it).
exports.getOccupied = async (req, res) => {
  try {
    const day = parseDay(req.query.date);
    const { worker } = req.query;
    if (!day || !mongoose.isValidObjectId(worker)) {
      return res.status(400).json({ isOk: false, message: "Valid date (YYYY-MM-DD) and worker are required" });
    }
    const rows = await PowderCoatingEntry.find({ date: day, worker }).select("slot machineOnTime machineOffTime").sort({ slot: 1 }).lean();
    res.status(200).json({
      isOk: true,
      data: rows.map((r) => ({ slot: r.slot, machineOnTime: r.machineOnTime || "", machineOffTime: r.machineOffTime || "" })),
    });
  } catch (error) {
    console.error("Error reading occupied After Powder Coating times:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// DELETE /powder-coating-sheet/row/:id — removes one saved entry (unless locked).
exports.deleteRow = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ isOk: false, message: "Invalid entry" });
    }
    const existing = await PowderCoatingEntry.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ isOk: false, message: "Entry not found" });
    const lockMessage = await checkNotLocked(new Date(existing.createdAt).toISOString().slice(0, 10), req.user, existing.unlockedUntil);
    if (lockMessage) return res.status(403).json({ isOk: false, message: lockMessage });

    const deleted = await PowderCoatingEntry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ isOk: false, message: "Entry not found" });
    await logEntryDelete({ sheet: SHEET, req, before: existing, fields: LOG_FIELDS });
    res.status(200).json({ isOk: true, message: "Entry deleted" });
  } catch (error) {
    console.error("Error deleting After Powder Coating row:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// PUT /powder-coating-sheet/row/:id/unlock — Super Admin or Full access (route-level
// authorize): 24 hours of edit/delete on this one entry despite the working-day lock.
exports.unlockRow = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ isOk: false, message: "Invalid entry" });
    }
    const unlockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const entry = await PowderCoatingEntry.findByIdAndUpdate(req.params.id, { $set: { unlockedUntil } }, { new: true }).lean();
    if (!entry) return res.status(404).json({ isOk: false, message: "Entry not found" });
    await logEntryUnlock({ sheet: SHEET, req, entry });
    res.status(200).json({ isOk: true, data: toRow(entry), message: "Unlocked for 24 hours" });
  } catch (error) {
    console.error("Error unlocking After Powder Coating row:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
