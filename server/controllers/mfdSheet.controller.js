const mongoose = require("mongoose");
const { strictNumber, isBlankNumber } = require("../utils/strictNumber");
const MfdEntry = require("../models/MfdEntry");
const { MAX_SLOTS } = require("../models/MfdEntry");
const { STOPPAGE_KEYS } = require("../models/ProductionEntry");
const Machine = require("../models/Machine");
const { clockMinutes, findOverlap } = require("../utils/machineTimes");
const { machineNamesFor } = require("../utils/machineNames");
const { insertNewEntry } = require("../utils/insertEntry");
const { reviewFor, siblingsOf, reflagSiblings, logEntrySave, logEntryDelete, logEntryUnlock, withAuthors } = require("../utils/entryAudit");
const { vendorFields, machineProcess } = require("../utils/entryVendor");
const { enforcePlannedShift } = require("../utils/plannedShift");
const { WORKING_MODES, isNonWorking, nonWorkingBody } = require("../utils/workingMode");
const { MACHINE_STATUSES } = require("../models/entryCommon");
const { applyQuantities } = require("../utils/rejectSplit");
const { checkNotLocked, parseDay, parseList } = require("./productionSheet.controller");

/**
 * controllers/mfdSheet.controller.js
 * ────────────────────────────────────
 * The MODULAR FRAME DRILLING sheet's API — INJECTION MOULDING's
 * (injectionSheet.controller.js) over its own collection: paged by date, a
 * 2-working-day lock with a Super Admin unlock, Operator Planned Shift from
 * Process Master (utils/plannedShift.js), vendors where the process has them,
 * Admin review of an entry over 100%, and the audit log.
 *
 * Its own rules:
 *  - Up to MAX_SLOTS (8) entries per machine per date.
 *  - Entries of one machine on a date MAY overlap in time — the paper has 4/B
 *    08:15–18:55 alongside 14:50–15:25, and 4/A with two operators at once — so
 *    there is no machine overlap check (PRINTING's rule). One operator still
 *    can't be on two DIFFERENT machines at the same time.
 *  - IDEAL Quantity takes Lunch / Tea out: (Machine Shift min − Lunch min) × 60
 *    ÷ Total Cycle Time, not rounded down on the sheet; Actual Quantity can't
 *    be more than the whole number under it (INJECTION MOULDING's cap).
 *  - Actual and ACTUAL OK Quantity typed, Rejected = Actual − OK derived on
 *    save, and no Rejection Master: the paper has no reject reasons, only
 *    REMARKS. A split sent anyway is never stored.
 *  - Drawing No., Process, No. of Holes and Stroke Required are the Part's,
 *    copied onto the entry by the form; Setting Time ON / OFF are optional.
 */

// A date's slots per machine.
const SLOT_NUMBERS = Array.from({ length: MAX_SLOTS }, (_, i) => i + 1);
// Distinct dates per page, and the widest date window a request may ask for.
const PAGE_SIZE_DAYS = 10;
const MAX_RANGE_DAYS = 366 * 5;

const TEXT_KEYS = ["operator", "itemName", "drawingNo", "operation", "remarks", "otherMinRemark"];
const TIME_KEYS = ["machineOnTime", "machineOffTime", "settingOnTime", "settingOffTime"];
// rejectedQty is NOT here — it is derived (Actual − OK) in applyQuantities, never taken from the client.
const NUMBER_KEYS = ["noOfHoles", "strokeRequired", "totalCycleSec", "actualQty", "okQty", "plannedOperatorShiftHours", ...STOPPAGE_KEYS];

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
    if (body[k] !== undefined) {
      if (body[k] !== null && typeof body[k] === "object") throw fail(`"${k}" must be text`);
      set[k] = String(body[k] ?? "").trim();
    }
  }
  for (const k of TIME_KEYS) {
    if (body[k] === undefined) continue;
    if (body[k] === "" || body[k] === null) unset[k] = "";
    else if (typeof body[k] === "object") throw fail(`"${k}" must be text`);
    else set[k] = String(body[k]);
  }
  for (const k of NUMBER_KEYS) {
    if (body[k] === undefined) continue;
    if (isBlankNumber(body[k])) {
      unset[k] = "";
    } else {
      const n = strictNumber(body[k]);
      if (!Number.isFinite(n)) throw fail(`"${k}" must be a number`);
      set[k] = n;
    }
  }
  // Rejected = Actual − OK. Only the two quantities are passed on: this sheet
  // has no reject reasons, so a split sent anyway is never stored.
  applyQuantities({ actualQty: body.actualQty, okQty: body.okQty }, set, unset);
  if (body.item !== undefined) {
    if (body.item && !mongoose.isValidObjectId(body.item)) throw fail("Invalid item");
    set.item = body.item || null;
  }
  // Working Status: only "Non Working" is stored (see utils/workingMode.js).
  if (body.workingMode !== undefined) {
    if (isNonWorking(body)) set.workingMode = "Non Working";
    else unset.workingMode = "";
  }
  // Reasons For Not Working — any of MACHINE_STATUSES (entryCommon.js); none unsets it.
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
const SHEET = "mfd";
const LOG_FIELDS = [...new Set([...TEXT_KEYS, ...TIME_KEYS, ...NUMBER_KEYS, "rejectedQty", "vendorName", "machineStatus", "workingMode"])];

const isRowEmpty = (doc) =>
  doc.workingMode !== "Non Working" &&
  !(doc.machineStatus || []).length &&
  TEXT_KEYS.every((k) => !doc[k]) &&
  TIME_KEYS.every((k) => !doc[k]) &&
  [...NUMBER_KEYS, "rejectedQty"].every((k) => doc[k] === undefined || doc[k] === null);

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";

// Rows saved before a time rule existed may break it; editing something else on
// such a row must still work, so the time rules only apply when the times are
// being set or changed.
const sameTimes = (existing, body) =>
  !!existing && existing.machineOnTime === body.machineOnTime && existing.machineOffTime === body.machineOffTime;

// Whether a save moves a saved entry to another Date or Machine. The exemption
// above only holds while the entry stays where it is: moved, its times meet
// entries they were never checked against, so the operator rule applies again.
const movesEntry = (existing, date, machine) => {
  if (!existing) return false;
  const existingDay = existing.date instanceof Date ? existing.date.toISOString().slice(0, 10) : String(existing.date).slice(0, 10);
  return existingDay !== date || String(existing.machine) !== String(machine);
};

// IDEAL Quantity, as the paper works it out: the Machine Shift less Lunch / Tea,
// over Total Cycle Time — not rounded down. Keep in step with mfdIdealQty in
// client/src/utils/mfdSheet.js.
const idealQtyOf = (shiftMin, lunchMin, cycleSec) => ((shiftMin - lunchMin) * 60) / cycleSec;

// In the sheet's own words; "Actual Quantity" is the Production Master every sheet shares.
const REQUIRED_FIELDS = [
  ["operator", "Operator"],
  ["itemName", "Part Name"],
  ["totalCycleSec", "Total Cycle Time"],
  ["machineOnTime", "Machine Time ON"],
  ["machineOffTime", "Machine Time OFF"],
  ["actualQty", "Actual Quantity"],
  ["okQty", "OK Quantity"],
  ["plannedOperatorShiftHours", "Planned Operator Shift"],
];

// Decimal hours as a clock reads them: 3.5 -> "3:30".
const hm = (hours) => {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// The entry form's own rules, re-checked so a request that skips the form can't
// save an incomplete entry. A body with every field blank is how a row is
// cleared, so it passes. Keep in step with client/src/utils/mfdValidation.js.
const entryRuleError = (body, existing = null) => {
  // A Non Working entry records only the day, machine, operator, reason and remarks.
  if (isNonWorking(body)) return null;
  if ([...TEXT_KEYS, ...TIME_KEYS, ...NUMBER_KEYS].every((k) => isBlank(body[k])) && !(body.machineStatus || []).length) return null;

  const missing = REQUIRED_FIELDS.filter(([k]) => isBlank(body[k])).map(([, label]) => label);
  if (missing.length) return `Required: ${missing.join(", ")}`;

  // This entry's own Total Cycle Time — prefilled from the Part, editable here.
  const cycleSec = Number(body.totalCycleSec);
  if (!(cycleSec > 0)) return "Total Cycle Time must be more than 0";

  const minutesOf = (k) => (isBlank(body[k]) ? 0 : Number(body[k]));
  if (minutesOf("otherMin") > 0 && isBlank(body.otherMinRemark)) {
    return "A remark is required when Others downtime is entered";
  }

  const on = clockMinutes(body.machineOnTime);
  const off = clockMinutes(body.machineOffTime);
  if (on === null || off === null) return "Machine Time ON/OFF must be HH:mm";
  // The machine runs within one day: a shift through midnight is two entries.
  if (off <= on && !sameTimes(existing, body)) return "Machine Time OFF must be after Machine Time ON";
  // Setting Time ON / OFF are optional — only a real time when typed.
  for (const [k, label] of [["settingOnTime", "Setting Time ON"], ["settingOffTime", "Setting Time OFF"]]) {
    if (!isBlank(body[k]) && clockMinutes(body[k]) === null) return `${label} must be HH:mm`;
  }

  const shiftMin = off - on < 0 ? off - on + 1440 : off - on;
  // The most the shift could make: the IDEAL Quantity (Lunch / Tea taken out),
  // rounded down — a piece is either made or not.
  const ideal = Math.max(0, Math.floor(idealQtyOf(shiftMin, minutesOf("lunchMin"), cycleSec) + 1e-9));
  if (Number(body.actualQty) > ideal) {
    return `Actual Quantity (${Number(body.actualQty)}) can't be more than IDEAL Quantity (${ideal})`;
  }
  for (const [k, label] of [["actualQty", "Actual Quantity"], ["okQty", "OK Quantity"]]) {
    if (!Number.isInteger(Number(body[k]))) return `${label} must be a whole number`;
  }

  const plannedMin = Math.round(Number(body.plannedOperatorShiftHours) * 60);
  if (plannedMin < shiftMin) {
    return `Planned Operator Shift (${hm(Number(body.plannedOperatorShiftHours))}) can't be less than Machine Shift (${hm(shiftMin / 60)})`;
  }
  // Total stoppage (Lunch included) has to fit inside the machine's own ON–OFF
  // span (client/src/utils/entryValidation.js's stoppageLimitMin; keep the two in step).
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

// GET /mfd-sheet?from&to&page[&machine=id1,id2][&operator=a,b][&item=name1,name2]
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

    const distinctDates = await MfdEntry.find(dateFilterQuery).distinct("date");
    const sortedDates = distinctDates.map((d) => d.toISOString().slice(0, 10)).sort().reverse();
    const totalDays = sortedDates.length;
    const totalPages = Math.max(1, Math.ceil(totalDays / PAGE_SIZE_DAYS));
    const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);
    const pageDates = sortedDates.slice((page - 1) * PAGE_SIZE_DAYS, page * PAGE_SIZE_DAYS).map(parseDay);

    const entries = pageDates.length
      ? await MfdEntry.find({ ...query, date: { $in: pageDates } })
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
      machineNames: await machineNamesFor(entries.map((e) => e.machine)),
    });
  } catch (error) {
    console.error("Error loading MODULAR FRAME DRILLING sheet:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /mfd-sheet/extent — earliest and latest entry date across every saved record.
exports.getExtent = async (req, res) => {
  try {
    const [oldest, newest] = await Promise.all([
      MfdEntry.findOne().sort({ date: 1 }).select("date").lean(),
      MfdEntry.findOne().sort({ date: -1 }).select("date").lean(),
    ]);
    const data =
      oldest && newest ? { from: oldest.date.toISOString().slice(0, 10), to: newest.date.toISOString().slice(0, 10) } : null;
    res.status(200).json({ isOk: true, data });
  } catch (error) {
    console.error("Error loading MODULAR FRAME DRILLING sheet extent:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /mfd-sheet/filter-options?from&to — the distinct Machine/Operator/Part
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
      MfdEntry.distinct("machine", query),
      MfdEntry.distinct("operator", { ...query, operator: { $nin: ["", null] } }),
      MfdEntry.distinct("itemName", { ...query, itemName: { $nin: ["", null] } }),
    ]);
    res.status(200).json({
      isOk: true,
      data: { machine: machine.map(String), operator, item: itemName },
      machineNames: await machineNamesFor(machine),
    });
  } catch (error) {
    console.error("Error loading MODULAR FRAME DRILLING sheet filter options:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// PUT /mfd-sheet/row — upserts one (date, machine, slot) row; a row with every
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
    // the Date (or Machine) — see the same fix in productionSheet.controller.js's
    // saveRow. Falls back to the composite-key lookup only for a caller that
    // still doesn't send _id.
    const editSlot = slot === "auto" ? null : Number(slot);
    let existing = _id && mongoose.isValidObjectId(_id) ? await MfdEntry.findById(_id).lean() : null;
    if (!existing && editSlot && SLOT_NUMBERS.includes(editSlot)) {
      existing = await MfdEntry.findOne({ date: day, machine, slot: editSlot }).lean();
    }
    // The Operator Planned Shift comes from the machine's process (Process
    // Master), never from what was typed — see utils/plannedShift.js.
    if (req.body.workingMode !== undefined && !WORKING_MODES.includes(String(req.body.workingMode).trim())) {
      return res.status(400).json({ isOk: false, message: "Working Status must be Working or Non Working" });
    }
    if (isNonWorking(req.body)) req.body = nonWorkingBody(req.body);
    await enforcePlannedShift(req.body, existing);
    const ruleError = entryRuleError(req.body, existing);
    if (ruleError) return res.status(400).json({ isOk: false, message: ruleError });

    // Only an edit of an already-saved row can be locked; catching up on a late
    // new entry is fine. The window counts from when that row was first saved
    // (createdAt), not from its own Date — see checkNotLocked's own comment.
    if (existing) {
      const createdAtISO = new Date(existing.createdAt).toISOString().slice(0, 10);
      const lockMessage = await checkNotLocked(createdAtISO, req.user, existing.unlockedUntil);
      if (lockMessage) return res.status(403).json({ isOk: false, message: lockMessage });
    }
    // Whether this save moves the saved entry to another Date or Machine — for
    // the slot it lands in and the operator check below.
    const moved = movesEntry(existing, date, machine);

    // The form sends "auto" for a new entry; the lowest free slot is picked here
    // because only the server sees every entry, so a new one can never overwrite
    // an existing one.
    let slotNo;
    if (slot === "auto" && existing && !moved) {
      // Editing in place: the entry keeps its own slot.
      slotNo = existing.slot;
    } else if (slot === "auto") {
      const used = new Set((await MfdEntry.find({ date: day, machine }).select("slot").lean()).map((e) => e.slot));
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
      if (moved) {
        const used = new Set(
          (await MfdEntry.find({ date: day, machine, _id: { $ne: existing._id } }).select("slot").lean()).map((e) => e.slot),
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

    // No machine overlap check: two jobs may run on one drilling machine at
    // once (see the file comment). One operator still runs one MACHINE at a
    // time — their entries on other machines that date can't overlap this one.
    const operator = String(req.body.operator ?? "").trim();
    const operatorChanged = !existing || String(existing.operator ?? "").trim() !== operator;
    if (operator && (operatorChanged || moved || !sameTimes(existing, req.body))) {
      const others = await MfdEntry.find({ date: day, operator, ...(existing ? { _id: { $ne: existing._id } } : {}) })
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
    // Vendor Name — only a vendor ticked for this machine's process (utils/entryVendor.js).
    const vendorUpdate = await vendorFields(req.body, existing, () => machineProcess(machine));
    Object.assign(set, vendorUpdate.set);
    Object.assign(unset, vendorUpdate.unset);
    // Whether Planned came from the lock — set by enforcePlannedShift above, never by the request.
    if (typeof req.body.plannedLocked === "boolean") set.plannedLocked = req.body.plannedLocked;
    else unset.plannedLocked = "";
    // Availability / Performance / Quality, and whether this save needs Admin
    // review — written in the same update as the entry (utils/entryAudit.js).
    // The day's OEE figures read the entries sharing this machine's date.
    const review = reviewFor(SHEET, existing, set, unset, await siblingsOf(MfdEntry, SHEET, { date: day, key: machine }));
    // date/machine/slot aren't in `set` (buildFields never touches them), but
    // an edit by _id has to carry them explicitly.
    const fields = { ...set, date: day, machine, slot: slotNo };
    const unsetAll = { ...unset, ...review.unset };
    const by = { updatedBy: req.user._id, updatedByModel: req.user.constructor.modelName };

    let doc = existing
      ? await MfdEntry.findByIdAndUpdate(
          existing._id,
          { $set: { ...fields, ...review.set, ...by }, ...(Object.keys(unsetAll).length ? { $unset: unsetAll } : {}) },
          { new: true, runValidators: true },
        ).lean()
      : null;
    if (!existing) {
      // A NEW entry is inserted, not upserted: two saves racing for the same free slot
      // would otherwise merge into one row (utils/insertEntry.js retries on the next free slot).
      const inserted = await insertNewEntry(MfdEntry, {
        filter: { date: day, machine },
        slots: SLOT_NUMBERS,
        slotNo,
        payload: { ...fields, ...review.set, updatedBy: req.user._id, updatedByModel: req.user.constructor.modelName },
      });
      if (inserted.full) {
        return res.status(400).json({
          isOk: false,
          message: `This machine already has ${MAX_SLOTS} entries on ${dayLabel(date)} — edit one of them instead`,
        });
      }
      doc = inserted.doc;
    }

    if (isRowEmpty(doc)) {
      await MfdEntry.deleteOne({ _id: doc._id });
      if (existing) await logEntryDelete({ sheet: SHEET, req, before: existing, fields: LOG_FIELDS });
      await reflagSiblings({ sheet: SHEET, Model: MfdEntry, req, before: existing, date: day, key: machine });
      return res.status(200).json({ isOk: true, data: null, message: "Row cleared" });
    }
    await logEntrySave({ sheet: SHEET, req, before: existing, after: doc, fields: LOG_FIELDS, review });
    await reflagSiblings({ sheet: SHEET, Model: MfdEntry, req, before: existing, date: day, key: machine, id: doc._id });
    res.status(200).json({ isOk: true, data: toRow(doc), message: "Row saved" });
  } catch (error) {
    console.error("Error saving MODULAR FRAME DRILLING row:", error);
    const status = error.status || (error.name === "ValidationError" || error.name === "CastError" ? 400 : 500);
    res.status(status).json({ isOk: false, message: error.message });
  }
};

// GET /mfd-sheet/occupied?date=YYYY-MM-DD&machine=<id>  — the slots a machine
// already has on a date (the form says how many are left of MAX_SLOTS); or
// ?date&operator=<name> (no machine) — everything that operator has that date
// on any MODULAR FRAME DRILLING machine, so the form can flag an operator on two
// machines at once before Save (saveRow still enforces both).
exports.getOccupied = async (req, res) => {
  try {
    const day = parseDay(req.query.date);
    const { machine } = req.query;
    const operator = String(req.query.operator ?? "").trim();
    if (day && !machine && operator) {
      const rows = await MfdEntry.find({ date: day, operator })
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
    const rows = await MfdEntry.find({ date: day, machine }).select("slot machineOnTime machineOffTime").sort({ slot: 1 }).lean();
    res.status(200).json({
      isOk: true,
      data: rows.map((r) => ({ slot: r.slot, machineOnTime: r.machineOnTime || "", machineOffTime: r.machineOffTime || "" })),
    });
  } catch (error) {
    console.error("Error reading occupied MODULAR FRAME DRILLING machine times:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// DELETE /mfd-sheet/row/:id — removes one saved entry (unless locked).
exports.deleteRow = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ isOk: false, message: "Invalid entry" });
    }
    const existing = await MfdEntry.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ isOk: false, message: "Entry not found" });
    const lockMessage = await checkNotLocked(new Date(existing.createdAt).toISOString().slice(0, 10), req.user, existing.unlockedUntil);
    if (lockMessage) return res.status(403).json({ isOk: false, message: lockMessage });

    const deleted = await MfdEntry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ isOk: false, message: "Entry not found" });
    await logEntryDelete({ sheet: SHEET, req, before: existing, fields: LOG_FIELDS });
    await reflagSiblings({ sheet: SHEET, Model: MfdEntry, req, before: existing, date: existing.date, key: existing.machine });
    res.status(200).json({ isOk: true, message: "Entry deleted" });
  } catch (error) {
    console.error("Error deleting MODULAR FRAME DRILLING row:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// PUT /mfd-sheet/row/:id/unlock — Super Admin or Full access (route-level requireAdmin):
// 24 hours of edit/delete on this one entry despite the working-day lock.
exports.unlockRow = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ isOk: false, message: "Invalid entry" });
    }
    const unlockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const entry = await MfdEntry.findByIdAndUpdate(req.params.id, { $set: { unlockedUntil } }, { new: true }).lean();
    if (!entry) return res.status(404).json({ isOk: false, message: "Entry not found" });
    await logEntryUnlock({ sheet: SHEET, req, entry });
    res.status(200).json({ isOk: true, data: toRow(entry), message: "Unlocked for 24 hours" });
  } catch (error) {
    console.error("Error unlocking MODULAR FRAME DRILLING row:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.MAX_SLOTS = MAX_SLOTS;
exports.idealQtyOf = idealQtyOf;
