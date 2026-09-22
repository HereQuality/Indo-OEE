const mongoose = require("mongoose");
const ProductionEntry = require("../models/ProductionEntry");
const { STOPPAGE_KEYS, REJECT_REASONS } = require("../models/ProductionEntry");
const Machine = require("../models/Machine");
const { CYCLE_OP_FIELDS } = require("../models/Item");
const { normalizeCycleOps } = require("./item.controller");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 62;
// Entries a machine can have on one date — the sheet's three rows per machine.
const MAX_SLOTS = 3;
const SLOT_NUMBERS = Array.from({ length: MAX_SLOTS }, (_, i) => i + 1);

const TEXT_KEYS = ["operator", "workingStatus", "itemName", "drawingNo", "setupNo", "rejectReason", "remarks"];
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

// GET /production-sheet?from=YYYY-MM-DD&to=YYYY-MM-DD[&machine=id]
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
      if (!mongoose.isValidObjectId(req.query.machine)) {
        return res.status(400).json({ isOk: false, message: "Invalid machine" });
      }
      query.machine = req.query.machine;
    }

    const entries = await ProductionEntry.find(query)
      .select("-__v -createdAt -updatedBy -updatedByModel")
      .lean();

    res.status(200).json({ isOk: true, data: entries.map(toRow) });
  } catch (error) {
    console.error("Error loading production sheet:", error);
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
    const deleted = await ProductionEntry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ isOk: false, message: "Entry not found" });
    res.status(200).json({ isOk: true, message: "Entry deleted" });
  } catch (error) {
    console.error("Error deleting production row:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /production-sheet/reject-reasons — the list the form's dropdown offers.
exports.listRejectReasons = async (req, res) => {
  res.status(200).json({ isOk: true, data: REJECT_REASONS });
};
