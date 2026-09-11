const ProductionEntry = require("../models/ProductionEntry");
const Machine = require("../models/Machine");
// ProductionEntry.operator is an ObjectId ref — mongoose needs this schema
// registered in the process for the .populate("operator") calls below.
require("../models/MachineOperator");
const FormDefinition = require("../models/FormDefinition");
const FormField = require("../models/FormField");
const { computeRowCalculations, computeBatchRowCalculations, computeBatchPositions, rowWorkingScheduleBounds, rowOwnSpan } = require("../services/productionCalculation.service");
const { resolveMachineFilter } = require("../utils/entryQuery");
const { aggregateEfficiencyByGroup } = require("../utils/efficiencyAggregate");
const { buildGrindingEfficiencyPdf } = require("../services/report.service");

// Rejected Qty is never accepted directly from the client — it's derived in
// buildData() as the sum of these reason fields (mirrors how Total Stoppage
// sums the Downtime & Stoppage Reason fields client-side).
const REJECTION_QTY_FIELDS = [
  "rejScratchesQty", "rejChippingQty", "rejCornerBreakageQty",
  "rejSizeMismatchQty", "rejHandlingBreakageQty", // includes "Others"
];

const NUMERIC_FIELDS = [
  "sizeWidthMm", "sizeHeightMm",
  "processQty", "okQty",
  ...REJECTION_QTY_FIELDS,
  "standardTimePerPieceMin",
  "plannedDowntimeMin",
  "noManpowerMin", "mechanicalBreakdownMin", "electricalBreakdownMin",
  "rawMaterialNotAvailableMin", "humanErrorStoppageMin", "changeoverMin",
  "rawMaterialProblemMin", "noPowerMin", "othersMin",
];

const OPTIONAL_MIN_FIELDS = [
  "plannedDowntimeMin",
  "noManpowerMin", "mechanicalBreakdownMin", "electricalBreakdownMin",
  "rawMaterialNotAvailableMin", "humanErrorStoppageMin", "changeoverMin",
  "rawMaterialProblemMin", "noPowerMin", "othersMin",
];

// ── Form Builder custom fields ────────────────────────────────────────────
// Admin-added (non-core) fields live in ProductionEntry.extraValues rather
// than as real columns — see models/FormDefinition.js. The set of valid keys
// always comes from the stored schema, never from the request body, so a
// caller can't invent a field or inflate Total Stoppage with a key that
// isn't actually configured as a stoppage reason.
const GRINDING_FORM_SLUG = "grinding-data-entry";

async function loadCustomFields() {
  const form = await FormDefinition.findOne({ slug: GRINDING_FORM_SLUG, isActive: true })
    .select("_id version")
    .lean();
  if (!form) return { form: null, fields: [] };
  const fields = await FormField.find({ formDefinitionId: form._id, isCore: false, isVisible: true }).lean();
  return { form, fields };
}

const readCustomValue = (body, key) => {
  const src = body.extraValues && typeof body.extraValues === "object" ? body.extraValues : body;
  return src[key];
};

async function customFieldErrors(body) {
  const errors = {};
  const { fields } = await loadCustomFields();
  for (const f of fields) {
    const raw = readCustomValue(body, f.key);
    const blank = raw === undefined || raw === "" || raw === null;
    if (f.isRequired && blank) {
      errors[f.key] = `${f.label} is required`;
      continue;
    }
    if (blank) continue;
    if (f.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) errors[f.key] = `${f.label} must be a number`;
      else if (n < 0) errors[f.key] = `${f.label} cannot be negative`;
      else if (f.isStoppageReason && n > 1440) errors[f.key] = `${f.label} cannot exceed 1440 minutes`;
    }
  }
  return errors;
}

/**
 * Writes the configured custom values onto the entry and rolls the
 * stoppage-flagged ones up into customStoppageMin — itself one of the
 * engine's STOPPAGE_KEYS, which is how an admin-added downtime reason
 * reaches the OEE math without productionCalculation.service.js ever
 * needing to touch the database.
 */
async function applyCustomFields(data, body) {
  const { form, fields } = await loadCustomFields();
  data.customStoppageMin = 0;
  if (!form) return;
  data.formVersion = form.version;

  const values = {};
  let stoppageMin = 0;

  for (const f of fields) {
    let raw = readCustomValue(body, f.key);
    if (raw === undefined || raw === "" || raw === null) {
      if (f.defaultValue === undefined || f.defaultValue === null) continue;
      raw = f.defaultValue;
    }
    if (f.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      values[f.key] = n;
      if (f.isStoppageReason) stoppageMin += Math.min(Math.max(n, 0), 1440);
    } else {
      values[f.key] = String(raw).slice(0, 500);
    }
  }

  if (Object.keys(values).length) data.extraValues = values;
  data.customStoppageMin = Math.min(stoppageMin, 1440);
}

async function validatePayload(body) {
  const errors = {};

  if (!body.machine) errors.machine = "M/C Name is required";
  else {
    const m = await Machine.findById(body.machine);
    if (!m) errors.machine = "Selected machine does not exist";
    else if (!m.isActive) errors.machine = "Selected machine is inactive";
  }

  if (!body.date) errors.date = "Date is required";

  const timeRx = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!body.mcStartTime) errors.mcStartTime = "M/C Start Time is required";
  else if (!timeRx.test(body.mcStartTime)) errors.mcStartTime = "Must be HH:mm format";

  if (!body.mcOffTime) errors.mcOffTime = "M/C Off Time is required";
  else if (!timeRx.test(body.mcOffTime)) errors.mcOffTime = "Must be HH:mm format";
  else if (!errors.mcStartTime && body.mcOffTime <= body.mcStartTime)
    errors.mcOffTime = "M/C Off Time cannot be earlier than or equal to M/C Start Time";

  const dims = { sizeWidthMm: "Width", sizeHeightMm: "Height" };
  for (const [k, label] of Object.entries(dims)) {
    const v = Number(body[k]);
    if (!body[k]) errors[k] = `${label} is required`;
    else if (isNaN(v) || v <= 0) errors[k] = `${label} must be > 0`;
  }

  const thickness = typeof body.thicknessMm === "string" ? body.thicknessMm.trim() : body.thicknessMm;
  if (!thickness && thickness !== 0) errors.thicknessMm = "Thickness is required";

  const qty = { processQty: "Production Qty", okQty: "OK Qty" };
  for (const [k, label] of Object.entries(qty)) {
    const v = Number(body[k]);
    if (body[k] === undefined || body[k] === "") errors[k] = `${label} is required`;
    else if (isNaN(v) || !Number.isInteger(v)) errors[k] = `${label} must be a whole number`;
    else if (k === "processQty" && v < 1) errors[k] = `${label} must be at least 1`;
    else if (v < 0) errors[k] = `${label} cannot be negative`;
  }
  if (!errors.processQty && !errors.okQty) {
    if (Number(body.okQty) > Number(body.processQty))
      errors.okQty = "OK Qty cannot exceed Production Qty";
  }

  for (const k of REJECTION_QTY_FIELDS) {
    if (body[k] === undefined || body[k] === "" || body[k] === null) continue;
    const v = Number(body[k]);
    if (isNaN(v) || !Number.isInteger(v) || v < 0) errors[k] = "Must be a whole number ≥ 0";
  }
  const rejectionFieldsClean = REJECTION_QTY_FIELDS.every((k) => !errors[k]);
  if (!errors.processQty && !errors.okQty && rejectionFieldsClean) {
    const rejectedQtyTotal = REJECTION_QTY_FIELDS.reduce((s, k) => s + (Number(body[k]) || 0), 0);
    if (Number(body.okQty) + rejectedQtyTotal > Number(body.processQty))
      errors.rejHandlingBreakageQty = "OK Qty + Rejected Qty (from Rejection Reasons) cannot exceed Production Qty";
  }

  const st = Number(body.standardTimePerPieceMin);
  if (!body.standardTimePerPieceMin) errors.standardTimePerPieceMin = "Standard Time is required";
  else if (isNaN(st) || st <= 0) errors.standardTimePerPieceMin = "Standard Time must be > 0";

  for (const k of OPTIONAL_MIN_FIELDS) {
    if (body[k] === undefined || body[k] === "" || body[k] === null) continue;
    const v = Number(body[k]);
    if (isNaN(v) || v < 0 || v > 1440) errors[k] = "Must be 0–1440 minutes";
  }

  const othersRemark = typeof body.othersRemark === "string" ? body.othersRemark.trim() : "";
  if (Number(body.othersMin) > 0 && !othersRemark) {
    errors.othersRemark = "Remark is required when Others (Minutes) is greater than 0";
  } else if (othersRemark.length > 300) {
    errors.othersRemark = "Remark cannot exceed 300 characters";
  }

  validateAdditionalPeriods(body, errors);

  Object.assign(errors, await customFieldErrors(body));

  return errors;
}

// Extra M/C ON/OFF periods for the SAME row (see the model file and
// productionCalculation.service.js's 2026-09-06 note) — each must be a
// valid HH:mm pair with Off after Start, and none of a row's own periods
// (primary + additional) may overlap each other.
const ADDITIONAL_PERIODS_LIMIT = 8;
function validateAdditionalPeriods(body, errors) {
  const raw = body.additionalPeriods;
  if (raw === undefined || raw === null || raw === "") return;
  if (!Array.isArray(raw)) {
    errors.additionalPeriods = "Additional periods must be a list";
    return;
  }
  if (raw.length > ADDITIONAL_PERIODS_LIMIT) {
    errors.additionalPeriods = `No more than ${ADDITIONAL_PERIODS_LIMIT} additional periods allowed`;
    return;
  }
  const timeRx = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const periods = [];
  if (body.mcStartTime && body.mcOffTime && timeRx.test(body.mcStartTime) && timeRx.test(body.mcOffTime)) {
    periods.push([body.mcStartTime, body.mcOffTime]);
  }
  for (let i = 0; i < raw.length; i++) {
    const start = raw[i] && raw[i].startTime;
    const end = raw[i] && raw[i].endTime;
    const label = `Additional period ${i + 1}`;
    if (!start || !timeRx.test(start)) { errors.additionalPeriods = `${label} Start Time must be HH:mm`; return; }
    if (!end || !timeRx.test(end)) { errors.additionalPeriods = `${label} Off Time must be HH:mm`; return; }
    if (end <= start) { errors.additionalPeriods = `${label} Off Time must be after its Start Time`; return; }
    for (const [pStart, pEnd] of periods) {
      if (timeWindowsOverlap(start, end, pStart, pEnd)) {
        errors.additionalPeriods = `${label} (${start}–${end}) overlaps with another period on this same row`;
        return;
      }
    }
    periods.push([start, end]);
  }
}

// Filters/normalizes `additionalPeriods` from a request body down to the
// shape stored on the model — drops any incomplete item.
function sanitizeAdditionalPeriods(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && p.startTime && p.endTime)
    .map((p) => ({ startTime: p.startTime, endTime: p.endTime }));
}

function buildData(body) {
  const data = {
    machine: body.machine,
    operator: body.operator || undefined,
    date: body.date || Date.now(),
    mcStartTime: body.mcStartTime,
    mcOffTime: body.mcOffTime,
    additionalPeriods: sanitizeAdditionalPeriods(body.additionalPeriods),
    shiftOnTime: body.shiftOnTime || undefined,
    shiftOffTime: body.shiftOffTime || undefined,
    lunchStartTime: body.lunchStartTime || undefined,
    batchId: body.batchId || undefined,
    othersRemark: typeof body.othersRemark === "string" ? body.othersRemark.trim().slice(0, 300) : "",
  };
  for (const k of NUMERIC_FIELDS) {
    if (body[k] !== undefined && body[k] !== "") data[k] = Number(body[k]);
  }
  if (body.thicknessMm !== undefined && body.thicknessMm !== "") {
    data.thicknessMm = String(body.thicknessMm).trim();
  }
  data.rejectedQty = REJECTION_QTY_FIELDS.reduce((sum, k) => sum + (Number(body[k]) || 0), 0);
  return data;
}

// Server-side backstop for the same check the client already runs before
// submitting: Production Qty can't exceed what this row's own actual M/C
// run time (M/C Off − M/C Start) allows at this Standard Time (Ideal
// Production). Re-derived from `data.calculated` — the same number that
// gets stored — so it can never disagree with what the client saw.
function capacityError(data) {
  const ideal = data.calculated.idealProductionQty;
  if (ideal < data.processQty) {
    return `Not achievable: this row's own M/C run time ÷ Standard Time = ${ideal.toFixed(2)} pcs, ` +
      `which is less than Production Qty (${data.processQty}). Reduce Production Qty or check the M/C Start/Off Time.`;
  }
  return null;
}

// True if two [start, off) M/C time windows overlap — a window crossing
// midnight (off <= start) is treated as extending into the next day.
// Mirrors client/src/pages/GrindingEntry.jsx's timeWindowsOverlap exactly.
function timeWindowsOverlap(aStart, aOff, bStart, bOff) {
  const toMin = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const norm = (start, off) => {
    let s = toMin(start), e = toMin(off);
    if (e <= s) e += 1440;
    return [s, e];
  };
  const [aS, aE] = norm(aStart, aOff);
  const [bS, bE] = norm(bStart, bOff);
  return aS < bE && bS < aE;
}

// Server-side backstop for the same overlap rule the client enforces across
// rows within one Add Entry submission — but the client can only see rows
// it has open in the form right now, not entries already saved elsewhere
// (a prior session, another operator, or siblings from an earlier partial
// batch save that aren't loaded into this edit). Queries every entry already
// saved for this Machine on this Date and rejects a genuine time conflict,
// regardless of how the conflicting entry got there.
async function checkMachineTimeOverlap(body, excludeId) {
  if (!body.machine || !body.date || !body.mcStartTime || !body.mcOffTime) return null;
  const day = new Date(body.date);
  const startOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  const query = { machine: body.machine, date: { $gte: startOfDay, $lt: endOfDay } };
  if (excludeId) query._id = { $ne: excludeId };
  const candidates = await ProductionEntry.find(query).select("mcStartTime mcOffTime additionalPeriods").lean();
  const newPeriods = [
    [body.mcStartTime, body.mcOffTime],
    ...sanitizeAdditionalPeriods(body.additionalPeriods).map((p) => [p.startTime, p.endTime]),
  ];
  for (const c of candidates) {
    const cPeriods = [[c.mcStartTime, c.mcOffTime], ...(c.additionalPeriods || []).map((p) => [p.startTime, p.endTime])];
    for (const [nStart, nEnd] of newPeriods) {
      for (const [cStart, cEnd] of cPeriods) {
        if (timeWindowsOverlap(nStart, nEnd, cStart, cEnd)) {
          return `This M/C time (${nStart}–${nEnd}) overlaps with another entry already saved for ` +
            `this machine on this date (${cStart}–${cEnd}) — the same machine can't run two jobs at once.`;
        }
      }
    }
  }
  return null;
}

// Resolves Shift On/Off Time: prefer the entry's own snapshot (taken from
// the Machine when the entry was saved — see the ProductionEntry model
// comment for why this is a snapshot, not a live re-fetch), only falling
// back to the Machine's CURRENT Shift Time when the snapshot is missing
// entirely (legacy/defensive path, not the normal one).
async function resolveShiftTimes(data) {
  let shiftOnTime = data.shiftOnTime;
  let shiftOffTime = data.shiftOffTime;
  if (!shiftOnTime || !shiftOffTime) {
    const machine = await Machine.findById(data.machine);
    shiftOnTime = shiftOnTime || machine?.machineOnTime;
    shiftOffTime = shiftOffTime || machine?.machineOffTime;
  }
  return { shiftOnTime, shiftOffTime };
}

// Computes and applies a PROVISIONAL `calculated`/`overtimeMin` for `data`
// (the entry currently being created/updated), as if it were a standalone
// entry (isFirst=isLast=true default). Used only to run the capacity check
// before insert/update — Ideal Production Qty (what capacityError checks)
// doesn't depend on batch position, so this provisional value is fine for
// that gate. The real, position-aware `calculated` gets written afterward
// by recomputeBatch, once the row's siblings (if any) are known.
async function applyShiftCalculations(data) {
  const { shiftOnTime, shiftOffTime } = await resolveShiftTimes(data);
  const calculated = computeRowCalculations(data, shiftOnTime, shiftOffTime);
  data.calculated = calculated;
  data.overtimeMin = calculated.overtimeMin;
  return calculated;
}

// Recomputes and saves `calculated`/`overtimeMin` for every row matched by
// `query`, position-aware within that group (see computeBatchRowCalculations
// in productionCalculation.service.js's 2026-09-03 note) — a row's own
// Working Schedule Time (and Overtime/Start Delay/Early Closed) now depends
// on whether it's the first/last chronological entry among its siblings,
// not just its own fields, so creating, editing, or deleting one row in a
// batch must recompute the whole batch, not just that one row.
async function recomputeBatch(query) {
  const siblings = await ProductionEntry.find(query);
  if (siblings.length === 0) return;
  const { shiftOnTime, shiftOffTime } = await resolveShiftTimes(siblings[0]);
  const results = computeBatchRowCalculations(siblings, shiftOnTime, shiftOffTime);
  await Promise.all(results.map(({ row, calculated }) => {
    row.calculated = calculated;
    row.overtimeMin = calculated.overtimeMin;
    return row.save();
  }));
}

// A standalone entry (no batchId) is its own batch of one.
function batchQueryFor(entry) {
  return entry.batchId ? { batchId: entry.batchId } : { _id: entry._id };
}

exports.createProductionEntry = async (req, res) => {
  try {
    const errors = await validatePayload(req.body);
    if (Object.keys(errors).length > 0)
      return res.status(400).json({ isOk: false, errors, message: "Please fix the highlighted fields" });

    const overlapMsg = await checkMachineTimeOverlap(req.body, null);
    if (overlapMsg) {
      return res.status(400).json({ isOk: false, errors: { mcOffTime: overlapMsg }, message: overlapMsg });
    }

    const data = buildData(req.body);
    await applyCustomFields(data, req.body);
    await applyShiftCalculations(data);
    const capacityMsg = capacityError(data);
    if (capacityMsg) {
      return res.status(400).json({ isOk: false, errors: { processQty: capacityMsg }, message: capacityMsg });
    }
    if (req.user) {
      data.createdBy = req.user._id;
      data.createdByModel = req.user.roleType === "SuperAdmin" ? "User" : "Operator";
    }
    const entry = await ProductionEntry.create(data);

    // The new row may join an existing batch (or already have siblings from
    // earlier saves in the same multi-row submission) — recompute the whole
    // batch so every row's Working Schedule Time/Overtime/Start Delay/Early
    // Closed reflects the correct first/last position now that this row
    // exists (see recomputeBatch's comment above).
    await recomputeBatch(batchQueryFor(entry));

    const populated = await ProductionEntry.findById(entry._id).populate([
      { path: "machine", select: "machineName machineCode machineOnTime machineOffTime" },
      { path: "operator", select: "name" },
    ]);
    res.status(201).json({ isOk: true, data: populated, message: "Entry saved successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isOk: false, message: err.message });
  }
};

exports.updateProductionEntry = async (req, res) => {
  try {
    const { entryId } = req.params;
    const errors = await validatePayload(req.body);
    if (Object.keys(errors).length > 0)
      return res.status(400).json({ isOk: false, errors, message: "Please fix the highlighted fields" });

    // Only re-check overlap when the Machine/Date/M-C time actually changed —
    // otherwise editing an unrelated field (e.g. OK Qty) on an entry that
    // happens to have a pre-existing overlap from before this check existed
    // would permanently block that edit for a conflict the user isn't
    // touching.
    const existingEntry = await ProductionEntry.findById(entryId).select("mcStartTime mcOffTime additionalPeriods machine date batchId").lean();
    if (!existingEntry) return res.status(404).json({ isOk: false, message: "Entry not found" });
    const timeRelevantFieldsChanged =
      existingEntry.mcStartTime !== req.body.mcStartTime ||
      existingEntry.mcOffTime !== req.body.mcOffTime ||
      JSON.stringify(existingEntry.additionalPeriods || []) !== JSON.stringify(sanitizeAdditionalPeriods(req.body.additionalPeriods)) ||
      String(existingEntry.machine) !== String(req.body.machine) ||
      new Date(existingEntry.date).toDateString() !== new Date(req.body.date).toDateString();
    if (timeRelevantFieldsChanged) {
      const overlapMsg = await checkMachineTimeOverlap(req.body, entryId);
      if (overlapMsg) {
        return res.status(400).json({ isOk: false, errors: { mcOffTime: overlapMsg }, message: overlapMsg });
      }
    }

    const data = buildData(req.body);
    await applyCustomFields(data, req.body);
    await applyShiftCalculations(data);
    const capacityMsg = capacityError(data);
    if (capacityMsg) {
      return res.status(400).json({ isOk: false, errors: { processQty: capacityMsg }, message: capacityMsg });
    }

    let entry = await ProductionEntry.findOneAndUpdate({ _id: entryId }, data, {
      new: true, runValidators: true,
    });

    if (!entry) return res.status(404).json({ isOk: false, message: "Entry not found" });

    // Recompute this row's (possibly new) batch — its own time/batchId may
    // have changed, which can change who's first/last among its siblings.
    await recomputeBatch(batchQueryFor(entry));
    // If it moved OUT of its old batch, that batch's remaining members may
    // also have a new first/last row now that this one has left.
    if (existingEntry.batchId && String(existingEntry.batchId) !== String(entry.batchId || "")) {
      await recomputeBatch({ batchId: existingEntry.batchId });
    }

    entry = await ProductionEntry.findById(entryId)
      .populate("machine", "machineName machineCode machineOnTime machineOffTime")
      .populate("operator", "name");

    res.status(200).json({ isOk: true, data: entry, message: "Entry updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isOk: false, message: err.message });
  }
};

exports.deleteProductionEntry = async (req, res) => {
  try {
    const entry = await ProductionEntry.findByIdAndDelete(req.params.entryId);
    if (!entry) return res.status(404).json({ isOk: false, message: "Entry not found" });

    // The deleted row may have been the first or last in its batch — the
    // remaining siblings need recomputing so a new row correctly becomes
    // first/last in its place.
    if (entry.batchId) await recomputeBatch({ batchId: entry.batchId });

    res.status(200).json({ isOk: true, message: "Entry deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isOk: false, message: err.message });
  }
};

exports.getProductionEntryById = async (req, res) => {
  try {
    const entry = await ProductionEntry.findById(req.params.entryId)
      .populate("machine", "machineName machineCode machineOnTime machineOffTime").populate("operator", "name");
    if (!entry) return res.status(404).json({ isOk: false, message: "Entry not found" });
    res.status(200).json({ isOk: true, data: entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isOk: false, message: err.message });
  }
};

// Operator Efficiency + Machine Efficiency tables, date-range filtered —
// grouped/reduced from the same rows as the sheet, using the same
// idealProductionQty (NA-aware) the sheet already computes and stores.
exports.getProductionEfficiency = async (req, res) => {
  try {
    const { from, to } = req.query;
    const query = {};
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = new Date(from);
      if (to) query.date.$lte = new Date(to);
    }

    const entries = await ProductionEntry.find(query)
      .populate("machine", "machineName")
      .populate("operator", "name")
      .lean();

    const operators = aggregateEfficiencyByGroup(
      entries,
      (e) => (e.operator?._id ? String(e.operator._id) : null),
      (e) => e.operator?.name || "Unknown Operator",
    );
    const machines = aggregateEfficiencyByGroup(
      entries,
      (e) => (e.machine?._id ? String(e.machine._id) : null),
      (e) => e.machine?.machineName || "Unknown Machine",
    );

    res.status(200).json({ isOk: true, data: { operators, machines } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isOk: false, message: err.message });
  }
};

// Server-generated PDF of the Grinding Efficiency Report — mirrors
// getProductionEfficiency's aggregation exactly, then applies the same
// operator (exact match) / machine (substring match) filter the on-screen
// EfficiencyModal applies, so the PDF always matches what's currently shown.
exports.downloadGrindingEfficiencyPdf = async (req, res) => {
  try {
    const { from, to, tab = "machines", operator, match } = req.query;
    const query = {};
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = new Date(from);
      if (to) query.date.$lte = new Date(to);
    }

    const entries = await ProductionEntry.find(query)
      .populate("machine", "machineName")
      .populate("operator", "name")
      .lean();

    let rows = tab === "operators"
      ? aggregateEfficiencyByGroup(
          entries,
          (e) => (e.operator?._id ? String(e.operator._id) : null),
          (e) => e.operator?.name || "Unknown Operator",
        )
      : aggregateEfficiencyByGroup(
          entries,
          (e) => (e.machine?._id ? String(e.machine._id) : null),
          (e) => e.machine?.machineName || "Unknown Machine",
        );

    let filterDescription;
    if (tab === "operators" && operator) {
      const wanted = new Set(String(operator).split(",").map((s) => s.trim()).filter(Boolean));
      rows = rows.filter((r) => wanted.has(r.name));
      filterDescription = `Operator(s): ${[...wanted].join(", ")}`;
    } else if (tab !== "operators" && match) {
      const q = String(match).toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q));
      filterDescription = `Machine search: "${match}"`;
    }

    const today = new Date().toISOString().split("T")[0];
    const fromDate = from || today;
    const toDate = to || fromDate;

    const doc = buildGrindingEfficiencyPdf({ tab, rows, from: fromDate, to: toDate, filterDescription });

    const filename = `grinding-${tab === "operators" ? "operator" : "machine"}-efficiency_${fromDate}${
      toDate !== fromDate ? `_to_${toDate}` : ""
    }.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error("Error generating grinding efficiency PDF:", err);
    res.status(500).json({ isOk: false, message: err.message });
  }
};

exports.listProductionEntries = async (req, res) => {
  try {
    const { machine, process, from, to, skip = 0, per_page = 50 } = req.query;
    const query = {};
    const machineFilter = await resolveMachineFilter({ machine, process });
    if (machineFilter !== undefined) query.machine = machineFilter;
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = new Date(from);
      if (to) query.date.$lte = new Date(to);
    }
    const [count, entries] = await Promise.all([
      ProductionEntry.countDocuments(query),
      ProductionEntry.find(query)
        .populate("machine", "machineName machineCode machineOnTime machineOffTime").populate("operator", "name")
        .sort({ date: -1, createdAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(per_page))
        .lean(),
    ]);
    res.status(200).json({ isOk: true, data: entries, count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isOk: false, message: err.message });
  }
};

// Shift Time Report — one row per entry: Machine, Shift Start/End, M/C
// On/Off, Overtime, Start Delay / Early Closed (all already stored on the
// entry — Overtime/Start Delay/Early Closed are computed once at save time
// by applyShiftCalculations, so this is a straight read, no recomputation).
exports.getShiftTimeReport = async (req, res) => {
  try {
    const { from, to, machine } = req.query;
    const query = {};
    if (machine) query.machine = machine;
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = new Date(from);
      if (to) query.date.$lte = new Date(to);
    }

    const entries = await ProductionEntry.find(query)
      .populate("machine", "machineName machineCode machineOnTime machineOffTime")
      .sort({ date: -1, mcStartTime: -1 })
      .lean();

    // Effective Shift Start/End — mirrors rowWorkingScheduleBounds, the same
    // position-aware rule Working Schedule Time itself uses (see
    // productionCalculation.service.js's 2026-09-03 note): only the
    // chronologically first row in a batch can extend backward past Shift
    // On, only the last can extend forward past Shift Off — a middle row
    // shows exactly its own M/C Start/Off. computeBatchPositions groups
    // these same `entries` by batchId to know which is which. Prefers the
    // entry's own shiftOnTime/shiftOffTime SNAPSHOT (what it actually ran
    // under — doesn't drift if the machine's Shift Time is edited later);
    // falls back to the machine's current config only for entries saved
    // before snapshotting existed.
    const positions = computeBatchPositions(entries);
    const rows = entries.map((e) => {
      const shiftOnTime = e.shiftOnTime || e.machine?.machineOnTime || null;
      const shiftOffTime = e.shiftOffTime || e.machine?.machineOffTime || null;
      const { isFirst, isLast } = positions.get(String(e._id));
      const ownSpan = rowOwnSpan(e);
      const { start: effectiveStartTime, end: effectiveEndTime } = rowWorkingScheduleBounds(
        shiftOnTime, shiftOffTime, ownSpan.start, ownSpan.end, isFirst, isLast,
      );

      return {
        _id: e._id,
        date: e.date,
        machineName: e.machine?.machineName || "Unknown Machine",
        shiftOnTime,
        shiftOffTime,
        mcStartTime: e.mcStartTime,
        mcOffTime: e.mcOffTime,
        effectiveStartTime,
        effectiveEndTime,
        // Pulled straight from the stored calculation (same source of truth
        // as the sheet/Dashboard/PDFs) — never recomputed here, so it can
        // never drift from what's shown elsewhere.
        totalShiftTimeMin: e.calculated?.workingScheduleMin ?? 0,
        overtimeMin: e.calculated?.overtimeMin ?? e.overtimeMin ?? 0,
        startDelayMin: e.calculated?.startDelayMin ?? 0,
        earlyClosedMin: e.calculated?.earlyClosedMin ?? 0,
      };
    });

    res.status(200).json({ isOk: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isOk: false, message: err.message });
  }
};
