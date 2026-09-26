const mongoose = require("mongoose");
const ProductionEntry = require("../models/ProductionEntry");
const { STOPPAGE_KEYS, REJECT_REASONS } = require("../models/ProductionEntry");
const Machine = require("../models/Machine");
const { CYCLE_OP_FIELDS } = require("../models/Item");
const { normalizeCycleOps } = require("./item.controller");
const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const { isEntryLocked } = require("../utils/workingDays");
const { clockMinutes, findOverlap } = require("../utils/machineTimes");

// An existing entry can only be edited/deleted within 2 *working* days of
// its own date (see utils/workingDays.js) — past that it's treated as
// closed, the same way a finalized ledger period would be — for Super Admin
// too; the only way past it (for anyone, Super Admin included) is a still-
// current `unlockedUntil` (see unlockRow below), a Super Admin-granted,
// 24-hour, one-entry exception. Deliberately explicit rather than a silent
// SuperAdmin bypass, so unlocking an old entry is always its own visible
// action, not an invisible standing power.
const LOCK_WORKING_DAYS = 2;

const checkNotLocked = async (entryDateISO, user, unlockedUntil) => {
  if (unlockedUntil && new Date(unlockedUntil) > new Date()) return null;
  const [{ weeklyOffDays }, holidays] = await Promise.all([
    WeeklyOffSetting.findOne().lean().then((d) => d || { weeklyOffDays: [0] }),
    CompanyHoliday.find({ isActive: true }).lean(),
  ]);
  if (isEntryLocked(entryDateISO, weeklyOffDays, holidays, undefined, LOCK_WORKING_DAYS)) {
    return `This entry is more than ${LOCK_WORKING_DAYS} working days old and is locked. Ask a Super Admin to unlock it.`;
  }
  return null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// The Filters panel's "Year"/custom-range pickers can ask for several years —
// this is only a sanity cap on how wide a single request's date window can
// be, not how much data comes back. What actually comes back is always just
// one page's worth (see PAGE_SIZE_DAYS in getSheet below), however wide the
// window is.
const MAX_RANGE_DAYS = 366 * 5;
// How many distinct dates' worth of entries one page of the sheet returns.
const PAGE_SIZE_DAYS = 10;
// Entries a machine can have on one date — the sheet's three rows per machine.
const MAX_SLOTS = 3;
const SLOT_NUMBERS = Array.from({ length: MAX_SLOTS }, (_, i) => i + 1);

const TEXT_KEYS = [
  "operator",
  "workingStatus",
  "itemName",
  "drawingNo",
  "setupNo",
  "rejectReason",
  "remarks",
  "rejectOtherRemark",
  "otherMinRemark",
];
const TIME_KEYS = ["machineOnTime", "machineOffTime", "settingOnTime", "settingOffTime"];
// rejectedQty is NOT here — it is derived from actualQty − okQty below and
// never accepted from the client.
const NUMBER_KEYS = [
  "actualQty",
  "okQty",
  "plannedOperatorShiftHours",
  "totalCycleSec",
  ...STOPPAGE_KEYS,
  ...CYCLE_OP_FIELDS.map((f) => f.key),
];

// "YYYY-MM-DD" -> Date at UTC midnight, or null if it isn't a real date.
const parseDay = (s) => {
  if (!DATE_RE.test(String(s || ""))) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
};

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
      if (!Number.isFinite(n)) throw Object.assign(new Error(`"${k}" must be a number`), { status: 400 });
      set[k] = n;
    }
  }
  if (body.cycleOpsSec !== undefined) {
    const ops = normalizeCycleOps(body.cycleOpsSec);
    if (ops.some((v) => v !== null && !Number.isFinite(v))) {
      throw Object.assign(new Error("Cycle times must be numbers"), { status: 400 });
    }
    set.cycleOpsSec = ops;
  }
  // Which of this entry's own operations don't count toward its Total Cycle
  // Time — an empty list unsets the field rather than saving one.
  if (body.excludedOps !== undefined) {
    const raw = Array.isArray(body.excludedOps) ? body.excludedOps : [];
    const validKeys = CYCLE_OP_FIELDS.map((f) => f.key);
    if (raw.some((k) => !validKeys.includes(k))) {
      throw Object.assign(new Error("Unknown operation in excludedOps"), { status: 400 });
    }
    const excluded = [...new Set(raw)];
    if (excluded.length) set.excludedOps = excluded;
    else unset.excludedOps = "";
  }
  // Rejected = Actual − OK. Both are needed to compute it; when either side
  // is being cleared the stored Rejected is cleared with it, and an OK above
  // Actual is rejected outright rather than saved as a negative.
  if (body.actualQty !== undefined || body.okQty !== undefined) {
    const actual = "actualQty" in set ? set.actualQty : null;
    const ok = "okQty" in set ? set.okQty : null;
    if (actual === null || ok === null) {
      unset.rejectedQty = "";
    } else if (ok > actual) {
      throw Object.assign(new Error("OK Quantity cannot be more than Actual Quantity"), { status: 400 });
    } else {
      set.rejectedQty = actual - ok;
      delete unset.rejectedQty;
    }
  }

  if (body.rejectReason !== undefined && set.rejectReason && !REJECT_REASONS.includes(set.rejectReason)) {
    throw Object.assign(new Error(`"${set.rejectReason}" is not a valid reject reason`), { status: 400 });
  }

  // The per-reason split of the rejected pieces. Only reasons that actually
  // cost pieces are stored, so an all-zero split unsets the field rather than
  // saving nine zeroes. The total is not checked against Actual − OK here:
  // the form does that, and a part-filled split is still worth keeping.
  if (body.rejectBreakdown !== undefined) {
    const raw = body.rejectBreakdown;
    if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
      throw Object.assign(new Error("rejectBreakdown must be an object"), { status: 400 });
    }
    const split = {};
    for (const [reason, value] of Object.entries(raw || {})) {
      if (!REJECT_REASONS.includes(reason)) {
        throw Object.assign(new Error(`"${reason}" is not a valid reject reason`), { status: 400 });
      }
      if (value === "" || value === null || value === undefined) continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        throw Object.assign(new Error(`Rejected quantity for "${reason}" must be 0 or more`), { status: 400 });
      }
      if (n > 0) split[reason] = n;
    }
    if (Object.keys(split).length) set.rejectBreakdown = split;
    else unset.rejectBreakdown = "";
  }

  if (body.item !== undefined) {
    if (body.item && !mongoose.isValidObjectId(body.item)) {
      throw Object.assign(new Error("Invalid item"), { status: 400 });
    }
    set.item = body.item || null;
  }
  return { set, unset };
};

const isRowEmpty = (doc) =>
  TEXT_KEYS.every((k) => !doc[k]) &&
  TIME_KEYS.every((k) => !doc[k]) &&
  [...NUMBER_KEYS, "rejectedQty"].every((k) => doc[k] === undefined || doc[k] === null) &&
  !Object.keys(doc.rejectBreakdown || {}).length &&
  !(doc.cycleOpsSec || []).some((v) => v !== null && v !== undefined);

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";

// A saved row whose machine times are exactly what the request carries. Rows
// saved before "OFF must be after ON" / "no overlap" existed may break those
// rules; editing something else on such a row must still work, so the two time
// rules only apply when the times themselves are being set or changed.
const sameTimes = (existing, body) =>
  !!existing && existing.machineOnTime === body.machineOnTime && existing.machineOffTime === body.machineOffTime;

// What the entry form always makes mandatory. Lunch / Rest joins them only when
// the planned shift leaves time over the machine's run (see entryRuleError).
const REQUIRED_FIELDS = [
  ["operator", "Operator"],
  ["itemName", "Part Name"],
  ["machineOnTime", "Machine ON Time"],
  ["machineOffTime", "Machine OFF Time"],
  ["actualQty", "Actual Quantity"],
  ["okQty", "OK Quantity"],
  ["plannedOperatorShiftHours", "Planned Operator Shift"],
];

// The entry form's own rules, re-checked here so a request that skips the form
// can't save an incomplete entry. Returns a message, or null when it's fine.
// A body with every field blank is left alone — that is how a row is cleared.
// Keep in step with client/src/utils/entryValidation.js.
const entryRuleError = (body, existing = null) => {
  const everyBlank = [...TEXT_KEYS, ...TIME_KEYS, ...NUMBER_KEYS].every((k) => isBlank(body[k]));
  if (everyBlank && !Object.keys(body.rejectBreakdown || {}).length) return null;

  const missing = REQUIRED_FIELDS.filter(([k]) => isBlank(body[k])).map(([, label]) => label);
  if (missing.length) return `Required: ${missing.join(", ")}`;

  const minutesOf = (k) => (isBlank(body[k]) ? 0 : Number(body[k]));

  if (Number(body.rejectBreakdown?.Other) > 0 && isBlank(body.rejectOtherRemark)) {
    return 'A remark is required when "Other" is used as a reject reason';
  }
  if (minutesOf("otherMin") > 0 && isBlank(body.otherMinRemark)) {
    return "A remark is required when Other downtime is entered";
  }

  // Total stoppage (Lunch / Rest included, as everywhere else) has to fit in
  // the part of the operator's planned shift the machine wasn't running.
  const on = clockMinutes(body.machineOnTime);
  const off = clockMinutes(body.machineOffTime);
  if (on === null || off === null) return "Machine ON/OFF Time must be HH:mm";
  // The machine runs within one day: OFF comes after ON (a shift through
  // midnight is two entries, one per date).
  if (off <= on && !sameTimes(existing, body)) return "Machine OFF Time must be after Machine ON Time";
  const shiftMin = off - on < 0 ? off - on + 1440 : off - on;
  const limit = Math.max(0, Math.round(Number(body.plannedOperatorShiftHours) * 60 - shiftMin));
  // Lunch / Rest may be 0 but not empty — unless the machine ran the whole
  // planned shift, when there is no room for one and it isn't asked for.
  if (limit > 0 && isBlank(body.lunchMin)) return "Lunch / Rest is required (enter 0 if none)";
  const total = STOPPAGE_KEYS.reduce((sum, k) => sum + minutesOf(k), 0);
  if (total > limit) {
    return `Total stoppage (${total} min) can't be more than Planned Operator Shift − Machine Shift (${limit} min)`;
  }
  return null;
};

// "id1,id2" -> ["id1","id2"], dropping blanks.
const parseList = (raw) => String(raw || "").split(",").map((s) => s.trim()).filter(Boolean);

// GET /production-sheet?from&to&page[&machine=id1,id2][&operator=a,b][&item=name1,name2]
// Paginated by distinct date, newest first, PAGE_SIZE_DAYS per page — a
// date's entries are merged into one block on the sheet, so pagination is
// by whole date, never mid-date. Only the requested page's own rows are
// fetched from the DB and sent — the whole date range is never pulled at
// once, however wide `from`..`to` is.
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

    // Only Machine narrows the actual fetch — Operator/Item stay
    // client-side row filters (see applyFilters in processDashboard.js), so
    // a date's fetched rows are always a machine's *whole* day, which
    // dayCalc/summarize need to get that day's OEE/unreported figures right.
    // Operator/Item still narrow which *dates* qualify for pagination below,
    // so paging through a filtered view doesn't show dates with no matches.
    const query = { date: { $gte: from, $lte: to } };
    if (req.query.machine) {
      const ids = parseList(req.query.machine);
      if (!ids.length || ids.some((id) => !mongoose.isValidObjectId(id))) {
        return res.status(400).json({ isOk: false, message: "Invalid machine" });
      }
      query.machine = { $in: ids };
    }
    // Filtered by itemName, not the `item` reference id — the client's Part
    // filter (DIMENSIONS.item in processDashboard.js) slices on the entry's
    // own stored itemName text, the same field the sheet's Part Name column
    // shows, so older rows with no `item` link still filter correctly.
    const dateFilterQuery = { ...query };
    if (req.query.operator) dateFilterQuery.operator = { $in: parseList(req.query.operator) };
    if (req.query.item) dateFilterQuery.itemName = { $in: parseList(req.query.item) };

    const distinctDates = await ProductionEntry.find(dateFilterQuery).distinct("date");
    const sortedDates = distinctDates.map((d) => d.toISOString().slice(0, 10)).sort().reverse();
    const totalDays = sortedDates.length;
    const totalPages = Math.max(1, Math.ceil(totalDays / PAGE_SIZE_DAYS));
    const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);
    const pageDates = sortedDates
      .slice((page - 1) * PAGE_SIZE_DAYS, page * PAGE_SIZE_DAYS)
      .map(parseDay);

    const entries = pageDates.length
      ? await ProductionEntry.find({ ...query, date: { $in: pageDates } })
          .select("-__v -createdAt -updatedBy -updatedByModel")
          .lean()
      : [];

    res.status(200).json({
      isOk: true,
      data: entries.map(toRow),
      meta: { page, totalPages, totalDays },
    });
  } catch (error) {
    console.error("Error loading production sheet:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /production-sheet/extent — the earliest and latest entry date across
// every saved record, regardless of any filter. Since the sheet itself now
// only ever holds one page of rows, the Filters panel's Year tab needs this
// to know how far back data actually goes.
exports.getExtent = async (req, res) => {
  try {
    const [oldest, newest] = await Promise.all([
      ProductionEntry.findOne().sort({ date: 1 }).select("date").lean(),
      ProductionEntry.findOne().sort({ date: -1 }).select("date").lean(),
    ]);
    const data = oldest && newest
      ? { from: oldest.date.toISOString().slice(0, 10), to: newest.date.toISOString().slice(0, 10) }
      : null;
    res.status(200).json({ isOk: true, data });
  } catch (error) {
    console.error("Error loading production sheet extent:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /production-sheet/filter-options?from&to — the distinct Machine/
// Operator/Item values present anywhere in that date range, for the Filters
// panel's pickers. Kept as its own lightweight endpoint (not derived from the
// sheet's own page of rows) so the picker options don't shrink to whatever
// happens to be on the current page.
exports.getFilterOptions = async (req, res) => {
  try {
    const from = parseDay(req.query.from);
    const to = parseDay(req.query.to);
    if (!from || !to || to < from) {
      return res.status(400).json({ isOk: false, message: "Valid 'from' and 'to' dates (YYYY-MM-DD) are required" });
    }
    const query = { date: { $gte: from, $lte: to } };
    const [machine, operator, itemName] = await Promise.all([
      ProductionEntry.distinct("machine", query),
      ProductionEntry.distinct("operator", { ...query, operator: { $nin: ["", null] } }),
      ProductionEntry.distinct("itemName", { ...query, itemName: { $nin: ["", null] } }),
    ]);
    res.status(200).json({
      isOk: true,
      data: { machine: machine.map(String), operator, item: itemName },
    });
  } catch (error) {
    console.error("Error loading production sheet filter options:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// PUT /production-sheet/row — upserts one (date, machine, slot) row; a row
// with every field blank is deleted instead.
exports.saveRow = async (req, res) => {
  try {
    const { date, machine, slot } = req.body;
    const day = parseDay(date);
    if (!day) return res.status(400).json({ isOk: false, message: "Valid date (YYYY-MM-DD) is required" });
    if (!mongoose.isValidObjectId(machine) || !(await Machine.exists({ _id: machine, isActive: true }))) {
      return res.status(400).json({ isOk: false, message: "Machine not found or inactive" });
    }
    // An edit names its slot; the row already saved there decides whether the
    // time rules still apply (see sameTimes) and whether it is locked.
    const editSlot = slot === "auto" ? null : Number(slot);
    const existing =
      editSlot && SLOT_NUMBERS.includes(editSlot)
        ? await ProductionEntry.findOne({ date: day, machine, slot: editSlot })
            .select("unlockedUntil machineOnTime machineOffTime")
            .lean()
        : null;
    const ruleError = entryRuleError(req.body, existing);
    if (ruleError) return res.status(400).json({ isOk: false, message: ruleError });

    // The entry form no longer asks for a slot — it sends "auto" and this
    // picks the machine's lowest free slot for that date. Done here rather
    // than in the form because the form only holds the entries it has loaded,
    // which may be filtered to one machine; this always sees all of them, so
    // a new entry can never land on an existing one and overwrite it.
    let slotNo;
    if (slot === "auto") {
      const used = new Set((await ProductionEntry.find({ date: day, machine }).select("slot").lean()).map((e) => e.slot));
      slotNo = SLOT_NUMBERS.find((n) => !used.has(n));
      if (!slotNo) {
        return res.status(400).json({
          isOk: false,
          message: `This machine already has ${MAX_SLOTS} entries on ${date} — edit one of them instead`,
        });
      }
    } else {
      slotNo = Number(slot);
      if (!SLOT_NUMBERS.includes(slotNo)) {
        return res.status(400).json({ isOk: false, message: `Slot must be 1–${MAX_SLOTS}` });
      }
      // Only an edit of an already-saved row can be locked — a brand new
      // entry (slot "auto", handled above) is never blocked just because
      // its own date is old; catching up on late-entered data is fine.
      const lockMessage = await checkNotLocked(date, req.user, existing?.unlockedUntil);
      if (lockMessage) return res.status(403).json({ isOk: false, message: lockMessage });
    }

    // One machine runs one thing at a time: its entries on a date can't
    // overlap in time. Checked here, against everything saved (the form only
    // knows what it has loaded), and only when the times are new or changed —
    // an older row that already breaks this stays editable.
    if (!sameTimes(existing, req.body)) {
      const others = await ProductionEntry.find({ date: day, machine, slot: { $ne: slotNo } })
        .select("slot machineOnTime machineOffTime")
        .lean();
      const clash = findOverlap(req.body.machineOnTime, req.body.machineOffTime, others);
      if (clash) {
        const [y, m, d] = String(date).split("-");
        return res.status(400).json({
          isOk: false,
          message: `This machine already has an entry from ${clash.text} on ${d}/${m}/${y}. Machine ON/OFF times can't overlap.`,
        });
      }
    }

    const { set, unset } = buildFields(req.body);
    const key = { date: day, machine, slot: slotNo };

    const doc = await ProductionEntry.findOneAndUpdate(
      key,
      {
        $set: { ...set, updatedBy: req.user._id, updatedByModel: req.user.constructor.modelName },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();

    if (isRowEmpty(doc)) {
      await ProductionEntry.deleteOne({ _id: doc._id });
      return res.status(200).json({ isOk: true, data: null, message: "Row cleared" });
    }

    res.status(200).json({ isOk: true, data: toRow(doc), message: "Row saved" });
  } catch (error) {
    console.error("Error saving production row:", error);
    const status = error.status || (error.name === "ValidationError" || error.name === "CastError" ? 400 : 500);
    res.status(status).json({ isOk: false, message: error.message });
  }
};

// GET /production-sheet/occupied?date=YYYY-MM-DD&machine=<id> — the time slots
// a machine already has on a date ({ slot, machineOnTime, machineOffTime } per
// saved entry), so the entry form can show what is taken and refuse an overlap
// before Save. saveRow still enforces the rule on its own.
exports.getOccupied = async (req, res) => {
  try {
    const day = parseDay(req.query.date);
    const { machine } = req.query;
    if (!day || !mongoose.isValidObjectId(machine)) {
      return res.status(400).json({ isOk: false, message: "Valid date (YYYY-MM-DD) and machine are required" });
    }
    const rows = await ProductionEntry.find({ date: day, machine })
      .select("slot machineOnTime machineOffTime")
      .sort({ slot: 1 })
      .lean();
    res.status(200).json({
      isOk: true,
      data: rows.map((r) => ({ slot: r.slot, machineOnTime: r.machineOnTime || "", machineOffTime: r.machineOffTime || "" })),
    });
  } catch (error) {
    console.error("Error reading occupied machine times:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /production-sheet/operators — every operator name typed so far, for
// the Operator column's suggestions. Kept for records saved before the
// Operator box read from Operator Master (see machineOperator.controller.js
// — MachineOperator is its own lightweight model; this endpoint is only
// history, not a live source for the dropdown any more).
exports.listOperatorNames = async (req, res) => {
  try {
    const names = await ProductionEntry.distinct("operator", { operator: { $nin: ["", null] } });
    res.status(200).json({ isOk: true, data: names.sort((a, b) => a.localeCompare(b)) });
  } catch (error) {
    console.error("Error listing operator names:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// DELETE /production-sheet/row/:id — removes one saved entry.
exports.deleteRow = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ isOk: false, message: "Invalid entry" });
    }
    const existing = await ProductionEntry.findById(req.params.id).select("date unlockedUntil").lean();
    if (!existing) return res.status(404).json({ isOk: false, message: "Entry not found" });
    const lockMessage = await checkNotLocked(new Date(existing.date).toISOString().slice(0, 10), req.user, existing.unlockedUntil);
    if (lockMessage) return res.status(403).json({ isOk: false, message: lockMessage });

    const deleted = await ProductionEntry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ isOk: false, message: "Entry not found" });
    res.status(200).json({ isOk: true, message: "Entry deleted" });
  } catch (error) {
    console.error("Error deleting production row:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// PUT /production-sheet/row/:id/unlock — Super Admin only (route-level
// authorize check). Grants exactly 24 hours of edit/delete access on this
// one entry regardless of the normal 2-working-day lock, so an Operator can
// fix it themselves instead of Super Admin doing the edit.
exports.unlockRow = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ isOk: false, message: "Invalid entry" });
    }
    const unlockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const entry = await ProductionEntry.findByIdAndUpdate(req.params.id, { $set: { unlockedUntil } }, { new: true }).lean();
    if (!entry) return res.status(404).json({ isOk: false, message: "Entry not found" });
    res.status(200).json({ isOk: true, data: toRow(entry), message: "Unlocked for 24 hours" });
  } catch (error) {
    console.error("Error unlocking production row:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /production-sheet/reject-reasons — the list the form's dropdown offers.
exports.listRejectReasons = async (req, res) => {
  res.status(200).json({ isOk: true, data: REJECT_REASONS });
};
