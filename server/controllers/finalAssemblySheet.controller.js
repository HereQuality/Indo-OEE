const mongoose = require("mongoose");
const FinalAssemblyEntry = require("../models/FinalAssemblyEntry");
const { WORKING_STATUSES, NON_WORKING_STATUSES, FA_DEFECT_REASONS, FA_IDLE_KEYS, FA_LABELS, MAX_SLOTS } = require("../models/FinalAssemblyEntry");
const MachineOperator = require("../models/MachineOperator");
const Process = require("../models/Process");
const { clockMinutes } = require("../utils/machineTimes");
const { machineNamesFor } = require("../utils/machineNames");
const { reviewFor, logEntrySave, logEntryDelete, logEntryUnlock, withAuthors } = require("../utils/entryAudit");
const { vendorFields } = require("../utils/entryVendor");
const { enforcePlannedShiftForProcess } = require("../utils/plannedShift");
const { WORKING_MODES, isNonWorking, nonWorkingBody } = require("../utils/workingMode");
const { MACHINE_STATUSES } = require("../models/entryCommon");
const { applyQuantities, rejectOtherError } = require("../utils/rejectSplit");
const { checkNotLocked, parseDay, parseList } = require("./productionSheet.controller");

/**
 * controllers/finalAssemblySheet.controller.js
 * ──────────────────────────────────────────────
 * The FINAL ASSEMBLY sheet's API (sheet key "finalAssembly") — AFTER POWDER
 * COATING's shape (powderCoatingSheet.controller.js: per WORKER, paged by
 * date, a 2-working-day lock with a Super Admin unlock), with three rules of
 * its own:
 *  - Up to MAX_SLOTS (12) entries per worker per date (the paper has nine).
 *  - NO overlap rule: a worker runs several assembly jobs at once (the paper
 *    has two 14:55–15:55 and three 17:00–19:00 jobs for one worker, and six
 *    08:00–18:00 PACKING rows for another), as on PRINTING.
 *  - Standard Time per Piece is optional (PACKING has none): such an entry
 *    saves with no Ideal, Effective Time 0 and Productivity 0%.
 * TOTAL QTY and the Types of Defects split (this sheet's own reasons —
 * rejectFieldsFor / applyQuantities) are typed; Total Defects (rejectedQty) is
 * their sum and OK QTY what's left of TOTAL, both set here, as AFTER POWDER
 * COATING sets its own.
 *
 * Rows go back to the client with `machine` set to the worker's id as well,
 * so the shared table, day formulas and dashboard group by worker exactly as
 * they group every other sheet by machine; `machineNames` names the workers.
 */

const SLOT_NUMBERS = Array.from({ length: MAX_SLOTS }, (_, i) => i + 1);
// Distinct dates per page, and the widest date window a request may ask for.
const PAGE_SIZE_DAYS = 10;
const MAX_RANGE_DAYS = 366 * 5;

const TEXT_KEYS = ["workingStatus", "itemName", "otherActivity", "remarks", "otherMinRemark", "rejectReason", "rejectOtherRemark"];
const TIME_KEYS = ["machineOnTime", "machineOffTime"];
// okQty / rejectedQty are NOT here — derived from TOTAL and the defects, never taken from the client.
const NUMBER_KEYS = ["totalCycleSec", "actualQty", "otherActivityMin", "plannedOperatorShiftHours", ...FA_IDLE_KEYS];
// What a status-only entry (ABSENT, SUNDAY, …) never carries.
const PRODUCTION_KEYS = ["itemName", "otherActivity", "otherMinRemark", "rejectReason", "rejectOtherRemark", ...TIME_KEYS, ...NUMBER_KEYS];

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

// The defects typed in a request's split — blanks as 0; null when it isn't an object.
const defectsOf = (split) =>
  split && typeof split === "object" && !Array.isArray(split)
    ? Object.values(split).reduce((sum, v) => sum + (isBlank(v) || !Number.isFinite(Number(v)) ? 0 : Number(v)), 0)
    : 0;

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
  // The Types of Defects split, over this sheet's own reasons (only the
  // split — OK is not typed here, so the TOTAL − OK rule isn't run).
  applyQuantities({ rejectReason: body.rejectReason, rejectBreakdown: body.rejectBreakdown }, set, unset, { reasons: FA_DEFECT_REASONS });
  // Total Defects is the split added up, and OK QTY what's left of TOTAL QTY —
  // both blank while TOTAL is (a status-only or cleared row).
  if (body.actualQty !== undefined || body.rejectBreakdown !== undefined) {
    if (!("actualQty" in set)) {
      Object.assign(unset, { okQty: "", rejectedQty: "" });
    } else {
      const defects = Object.values(set.rejectBreakdown || {}).reduce((sum, n) => sum + n, 0);
      if (defects > set.actualQty) throw fail(`${FA_LABELS.rejectedQty} (${defects}) can't be more than ${FA_LABELS.actualQty} (${set.actualQty})`);
      set.rejectedQty = defects;
      set.okQty = set.actualQty - defects;
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

// This sheet's key in the audit log, and the fields whose old → new values it
// records. Operator isn't one of them: here it is only the worker's name,
// already logged as the worker.
const SHEET = "finalAssembly";
const LOG_FIELDS = [...new Set(["worker", "vendorName", ...TEXT_KEYS, ...TIME_KEYS, ...NUMBER_KEYS, "machineStatus", "workingMode", "rejectBreakdown"])];

const isRowEmpty = (doc) =>
  doc.workingMode !== "Non Working" &&
  !(doc.machineStatus || []).length &&
  !doc.vendor &&
  TEXT_KEYS.every((k) => !doc[k]) &&
  TIME_KEYS.every((k) => !doc[k]) &&
  [...NUMBER_KEYS, "rejectedQty", "okQty"].every((k) => doc[k] === undefined || doc[k] === null) &&
  !Object.keys(doc.rejectBreakdown || {}).length;

// Whether a save moves a saved entry to another Date or Worker (for the slot it lands in).
const movesEntry = (existing, date, worker) => {
  if (!existing) return false;
  const existingDay = existing.date instanceof Date ? existing.date.toISOString().slice(0, 10) : String(existing.date).slice(0, 10);
  return existingDay !== date || String(existing.worker) !== String(worker);
};

// Rows saved before a time rule existed may break it; editing something else on
// such a row must still work, so End-after-Start only applies when the times
// are being set or changed.
const sameTimes = (existing, body) =>
  !!existing && existing.machineOnTime === body.machineOnTime && existing.machineOffTime === body.machineOffTime;

// Standard Time per Piece is NOT required (PACKING has none).
const REQUIRED_FIELDS = [
  ["itemName", FA_LABELS.itemName],
  ["machineOnTime", FA_LABELS.machineOnTime],
  ["machineOffTime", FA_LABELS.machineOffTime],
  ["actualQty", FA_LABELS.actualQty],
  ["plannedOperatorShiftHours", "Planned Operator Shift"],
];

// Decimal hours as a clock reads them: 3.5 -> "3:30".
const hm = (hours) => {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// The entry form's own rules, re-checked so a request that skips the form can't
// save an incomplete entry. A body with every field blank is how a row is
// cleared, so it passes. Keep in step with client/src/utils/finalAssemblyValidation.js.
const entryRuleError = (body, existing = null) => {
  // A Non Working entry records only the day, worker, reason and remarks.
  if (isNonWorking(body)) return null;
  if (
    [...TEXT_KEYS, ...TIME_KEYS, ...NUMBER_KEYS].every((k) => isBlank(body[k])) &&
    isBlank(body.vendor) &&
    !(body.machineStatus || []).length &&
    !Object.keys(body.rejectBreakdown || {}).length
  ) {
    return null;
  }
  // A status-only day (ABSENT, SUNDAY, …) needs nothing beyond its Date,
  // Worker (both checked in saveRow) and the status itself.
  if (isStatusOnly(body)) return null;

  const missing = REQUIRED_FIELDS.filter(([k]) => isBlank(body[k])).map(([, label]) => label);
  if (missing.length) return `Required: ${missing.join(", ")}`;

  // Optional — but a typed one has to be a real time per piece.
  if (!isBlank(body.totalCycleSec) && !(Number(body.totalCycleSec) > 0)) return "Standard Time per Piece must be more than 0 (or left blank)";

  const minutesOf = (k) => (isBlank(body[k]) ? 0 : Number(body[k]));
  if (minutesOf("otherMin") > 0 && isBlank(body.otherMinRemark)) {
    return "A remark is required when Other idle time is entered";
  }
  if (minutesOf("otherActivityMin") > 0 && isBlank(body.otherActivity)) {
    return "Say what the Other Activity was when its time is entered";
  }
  const otherError = rejectOtherError(body);
  if (otherError) return otherError;

  const on = clockMinutes(body.machineOnTime);
  const off = clockMinutes(body.machineOffTime);
  if (on === null || off === null) return `${FA_LABELS.machineOnTime} / ${FA_LABELS.machineOffTime} must be HH:mm`;
  // A job runs within one day: one through midnight is two entries.
  if (off <= on && !sameTimes(existing, body)) return `${FA_LABELS.machineOffTime} must be after ${FA_LABELS.machineOnTime}`;

  const shiftMin = off - on < 0 ? off - on + 1440 : off - on;
  // TOTAL QTY may be more than the Ideal Quantity — a worker can beat the
  // standard time (the paper has 154%) — and such an entry is held for OEE
  // Review (Performance > 100%, see reviewFor) rather than refused.
  const total = Number(body.actualQty);
  const defects = defectsOf(body.rejectBreakdown);
  if (defects > total) return `${FA_LABELS.rejectedQty} (${defects}) can't be more than ${FA_LABELS.actualQty} (${total})`;

  const plannedMin = Math.round(Number(body.plannedOperatorShiftHours) * 60);
  if (plannedMin < shiftMin) {
    return `Planned Operator Shift (${hm(Number(body.plannedOperatorShiftHours))}) can't be less than the ${FA_LABELS.shift} (${hm(shiftMin / 60)})`;
  }
  // Idle time and Other Activity both happen inside the working hours.
  const away = [...FA_IDLE_KEYS, "otherActivityMin"].reduce((sum, k) => sum + minutesOf(k), 0);
  if (away > shiftMin) {
    return `Idle Time + Other Activity (${away} min) can't be more than the ${FA_LABELS.shift} (${shiftMin} min)`;
  }
  return null;
};

const dayLabel = (date) => {
  const [y, m, d] = String(date).split("-");
  return `${d}/${m}/${y}`;
};

const validIds = (list) => list.length && list.every((id) => mongoose.isValidObjectId(id));

// GET /final-assembly-sheet?from&to&page[&worker=id1,id2][&item=name1,name2][&vendor=name1,name2]
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

    const distinctDates = await FinalAssemblyEntry.find(dateFilterQuery).distinct("date");
    const sortedDates = distinctDates.map((d) => d.toISOString().slice(0, 10)).sort().reverse();
    const totalDays = sortedDates.length;
    const totalPages = Math.max(1, Math.ceil(totalDays / PAGE_SIZE_DAYS));
    const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);
    const pageDates = sortedDates.slice((page - 1) * PAGE_SIZE_DAYS, page * PAGE_SIZE_DAYS).map(parseDay);

    const entries = pageDates.length
      ? await FinalAssemblyEntry.find({ ...query, date: { $in: pageDates } })
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
    console.error("Error loading Final Assembly sheet:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /final-assembly-sheet/extent — earliest and latest entry date across every saved record.
exports.getExtent = async (req, res) => {
  try {
    const [oldest, newest] = await Promise.all([
      FinalAssemblyEntry.findOne().sort({ date: 1 }).select("date").lean(),
      FinalAssemblyEntry.findOne().sort({ date: -1 }).select("date").lean(),
    ]);
    const data =
      oldest && newest ? { from: oldest.date.toISOString().slice(0, 10), to: newest.date.toISOString().slice(0, 10) } : null;
    res.status(200).json({ isOk: true, data });
  } catch (error) {
    console.error("Error loading Final Assembly sheet extent:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /final-assembly-sheet/filter-options?from&to — the distinct Worker / Item /
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
      FinalAssemblyEntry.distinct("worker", query),
      FinalAssemblyEntry.distinct("itemName", { ...query, itemName: { $nin: ["", null] } }),
      FinalAssemblyEntry.distinct("vendorName", { ...query, vendorName: { $nin: ["", null] } }),
    ]);
    res.status(200).json({
      isOk: true,
      data: { machine: worker.map(String), operator: [], item: itemName, vendor: vendorName },
      machineNames: await machineNamesFor(worker),
    });
  } catch (error) {
    console.error("Error loading Final Assembly filter options:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// PUT /final-assembly-sheet/row — upserts one (date, worker, slot) row; a row
// with every field blank is deleted instead.
exports.saveRow = async (req, res) => {
  try {
    // A status-only entry never keeps work figures, whatever the
    // request carried — blanking them here unsets anything saved before.
    if (isStatusOnly(req.body)) {
      req.body = { ...req.body, ...Object.fromEntries(PRODUCTION_KEYS.map((k) => [k, ""])), rejectBreakdown: {}, item: null, vendor: null };
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
    // Date. Falls back to the composite-key lookup only for a caller that
    // doesn't send _id.
    const editSlot = slot === "auto" ? null : Number(slot);
    let existing = _id && mongoose.isValidObjectId(_id) ? await FinalAssemblyEntry.findById(_id).lean() : null;
    if (!existing && editSlot && SLOT_NUMBERS.includes(editSlot)) {
      existing = await FinalAssemblyEntry.findOne({ date: day, worker, slot: editSlot }).lean();
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
    // new entry is fine. The window counts from when that row was first saved
    // (createdAt), not from its own Date — see checkNotLocked's own comment.
    if (existing) {
      const createdAtISO = new Date(existing.createdAt).toISOString().slice(0, 10);
      const lockMessage = await checkNotLocked(createdAtISO, req.user, existing.unlockedUntil);
      if (lockMessage) return res.status(403).json({ isOk: false, message: lockMessage });
    }
    const moved = movesEntry(existing, date, worker);

    // The form sends "auto" for a new entry; the lowest free slot is picked here
    // because only the server sees every entry, so a new one can never overwrite
    // an existing one. No overlap check: a worker may run several jobs at once.
    let slotNo;
    if (slot === "auto") {
      const used = new Set((await FinalAssemblyEntry.find({ date: day, worker }).select("slot").lean()).map((e) => e.slot));
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
      // An edit that moved to a different Date carries its old slot number over,
      // which may already belong to another entry there — reassign to that
      // date's next free slot instead of colliding with it.
      if (moved) {
        const used = new Set(
          (await FinalAssemblyEntry.find({ date: day, worker, _id: { $ne: existing._id } }).select("slot").lean()).map((e) => e.slot),
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
      ? await FinalAssemblyEntry.findByIdAndUpdate(
          existing._id,
          { $set: { ...fields, ...review.set, ...stamp }, ...(Object.keys($unset).length ? { $unset } : {}) },
          { new: true, runValidators: true },
        ).lean()
      : await FinalAssemblyEntry.findOneAndUpdate(
          { date: day, worker, slot: slotNo },
          { $set: { ...set, process: processId, ...review.set, ...stamp }, ...(Object.keys($unset).length ? { $unset } : {}) },
          { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
        ).lean();

    if (isRowEmpty(doc)) {
      await FinalAssemblyEntry.deleteOne({ _id: doc._id });
      if (existing) await logEntryDelete({ sheet: SHEET, req, before: existing, fields: LOG_FIELDS });
      return res.status(200).json({ isOk: true, data: null, message: "Row cleared" });
    }
    await logEntrySave({ sheet: SHEET, req, before: existing, after: doc, fields: LOG_FIELDS, review });
    res.status(200).json({ isOk: true, data: toRow(doc), message: "Row saved" });
  } catch (error) {
    console.error("Error saving Final Assembly row:", error);
    const status = error.status || (error.name === "ValidationError" || error.name === "CastError" ? 400 : 500);
    res.status(status).json({ isOk: false, message: error.message });
  }
};

// GET /final-assembly-sheet/occupied?date=YYYY-MM-DD&worker=<id> — the slots and
// times a worker already has on a date, so the form can say the date is full
// (and show what's already entered) before Save. Overlapping times are allowed.
exports.getOccupied = async (req, res) => {
  try {
    const day = parseDay(req.query.date);
    const { worker } = req.query;
    if (!day || !mongoose.isValidObjectId(worker)) {
      return res.status(400).json({ isOk: false, message: "Valid date (YYYY-MM-DD) and worker are required" });
    }
    const rows = await FinalAssemblyEntry.find({ date: day, worker }).select("slot machineOnTime machineOffTime").sort({ slot: 1 }).lean();
    res.status(200).json({
      isOk: true,
      data: rows.map((r) => ({ slot: r.slot, machineOnTime: r.machineOnTime || "", machineOffTime: r.machineOffTime || "" })),
    });
  } catch (error) {
    console.error("Error reading occupied Final Assembly times:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// DELETE /final-assembly-sheet/row/:id — removes one saved entry (unless locked).
exports.deleteRow = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ isOk: false, message: "Invalid entry" });
    }
    const existing = await FinalAssemblyEntry.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ isOk: false, message: "Entry not found" });
    const lockMessage = await checkNotLocked(new Date(existing.createdAt).toISOString().slice(0, 10), req.user, existing.unlockedUntil);
    if (lockMessage) return res.status(403).json({ isOk: false, message: lockMessage });

    const deleted = await FinalAssemblyEntry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ isOk: false, message: "Entry not found" });
    await logEntryDelete({ sheet: SHEET, req, before: existing, fields: LOG_FIELDS });
    res.status(200).json({ isOk: true, message: "Entry deleted" });
  } catch (error) {
    console.error("Error deleting Final Assembly row:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// PUT /final-assembly-sheet/row/:id/unlock — Super Admin or Full access (route-level
// authorize): 24 hours of edit/delete on this one entry despite the working-day lock.
exports.unlockRow = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ isOk: false, message: "Invalid entry" });
    }
    const unlockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const entry = await FinalAssemblyEntry.findByIdAndUpdate(req.params.id, { $set: { unlockedUntil } }, { new: true }).lean();
    if (!entry) return res.status(404).json({ isOk: false, message: "Entry not found" });
    await logEntryUnlock({ sheet: SHEET, req, entry });
    res.status(200).json({ isOk: true, data: toRow(entry), message: "Unlocked for 24 hours" });
  } catch (error) {
    console.error("Error unlocking Final Assembly row:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
