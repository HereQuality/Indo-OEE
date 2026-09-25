import { CYCLE_OP_FIELDS, normalizeTime, rowCalc, spanMinutes } from "./productionSheet";

/**
 * utils/entryValidation.js
 * ──────────────────────────
 * Every rule the Production Data Entry form enforces, in one place, so the
 * Save button, the per-field messages and the "scroll to the first thing
 * still missing" behaviour all read from the same answer.
 *
 *   Required    Date, Machine No., Operator, Part Name, Machine ON/OFF Time,
 *               Actual Qty, OK Qty, Planned Operator Shift — and Lunch / Rest,
 *               but only when Planned Operator Shift − Machine Shift leaves time
 *               over. If the machine ran the whole planned shift there is no room
 *               for a lunch, so it is optional (and can only be 0).
 *   Quantities  Actual ≤ Ideal, OK ≤ Actual, and the Reject Master split has
 *               to account for every rejected piece (Rejected = Actual − OK).
 *   Downtime    Optional, but whatever is typed must be 0–1440, and the total
 *               (Lunch / Rest included) can't exceed Planned Operator Shift −
 *               Machine Shift, in minutes.
 *   "Other"     Rejecting pieces as "Other", or logging Other downtime, needs
 *               its own remark.
 *
 * The server re-checks the required fields, the remarks and the stoppage cap
 * (server/controllers/productionSheet.controller.js — entryRuleError); keep
 * the two in step.
 */

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const blank = (v) => v === "" || v === null || v === undefined || String(v).trim() === "";

const CYCLE_OP_KEYS = CYCLE_OP_FIELDS.map((f) => f.key);

// The downtime boxes on the form. Lunch / Rest sits with Planned Operator
// Shift instead, but still counts toward the total (see rowCalc).
export const DOWNTIME_KEYS = [
  "setupMin",
  "noManPowerMin",
  "materialShiftingMin",
  "noMaterialMin",
  "bdMechMin",
  "bdEleMin",
  "noPowerMin",
  "otherMin",
];

// Top to bottom, the way the form reads — the first key with an error is
// where Save scrolls to.
export const FIELD_ORDER = [
  "date",
  "machine",
  "operator",
  "itemName",
  "machineOnTime",
  "machineOffTime",
  "actualQty",
  "okQty",
  "rejectBreakdown",
  "rejectOtherRemark",
  "plannedOperatorShiftHours",
  "lunchMin",
  ...DOWNTIME_KEYS,
  "stoppageTotal",
  "otherMinRemark",
  ...CYCLE_OP_KEYS,
];

// Minutes of the operator's planned shift the machine wasn't running — the
// most stoppage the entry can account for. null until both numbers exist.
export const stoppageLimitMin = (v) => {
  const planned = num(v.plannedOperatorShiftHours);
  const shiftMin = spanMinutes(v.machineOnTime, v.machineOffTime);
  if (!isNum(planned) || shiftMin === null) return null;
  return Math.max(0, Math.round(planned * 60 - shiftMin));
};

// Lunch / Rest has to be entered only when the planned shift leaves minutes
// over the machine's run (stoppageLimitMin > 0). With no room left — or while
// the shift and machine times are still missing, which are required anyway —
// it isn't asked for.
export const lunchRequired = (v) => {
  const limit = stoppageLimitMin(v);
  return limit !== null && limit > 0;
};

// The Reject Master boxes as clean numbers: blanks dropped, the rest > 0.
export const cleanSplit = (split) =>
  Object.fromEntries(
    Object.entries(split || {})
      .map(([reason, v]) => [reason, blank(v) ? 0 : Number(v)])
      .filter(([, n]) => Number.isFinite(n) && n > 0),
  );

// One block's values → { fieldKey: message }. Empty object = ready to save.
export const validateEntry = (v) => {
  const errors = {};
  const calc = rowCalc(v);

  if (blank(v.date)) errors.date = "Date is required";
  if (blank(v.machine)) errors.machine = "Machine No. is required";
  if (blank(v.operator)) errors.operator = "Operator is required";
  if (blank(v.itemName)) errors.itemName = "Part Name is required";

  for (const [key, label] of [
    ["machineOnTime", "Machine ON Time"],
    ["machineOffTime", "Machine OFF Time"],
  ]) {
    if (blank(v[key])) errors[key] = `${label} is required`;
    else if (!normalizeTime(v[key])) errors[key] = "Enter a valid time";
  }

  // Actual can't beat what the shift could make; OK can't beat Actual.
  const actual = num(v.actualQty);
  if (blank(v.actualQty)) errors.actualQty = "Actual Quantity is required";
  else if (!Number.isFinite(actual) || actual < 0) errors.actualQty = "Must be 0 or more";
  else if (isNum(calc.idealQty) && actual > calc.idealQty) {
    errors.actualQty = `Actual can't be more than Ideal Quantity (${calc.idealQty})`;
  }

  const ok = num(v.okQty);
  if (blank(v.okQty)) errors.okQty = "OK Quantity is required";
  else if (!Number.isFinite(ok) || ok < 0) errors.okQty = "Must be 0 or more";
  else if (isNum(actual) && ok > actual) errors.okQty = `OK can't be more than Actual Quantity (${actual})`;

  // Rejected = Actual − OK, and every rejected piece needs a reason. Can only
  // be checked once Actual and OK are both usable.
  const rejectedKnown = isNum(actual) && isNum(ok) && ok <= actual;
  const rejected = rejectedKnown ? actual - ok : 0;
  const split = cleanSplit(v.rejectBreakdown);
  const splitTotal = Object.values(split).reduce((s, n) => s + n, 0);
  if (Object.values(v.rejectBreakdown || {}).some((n) => !blank(n) && (!Number.isFinite(Number(n)) || Number(n) < 0))) {
    errors.rejectBreakdown = "Rejected quantities must be 0 or more";
  } else if (rejectedKnown && splitTotal < rejected) {
    errors.rejectBreakdown = `${rejected - splitTotal} of ${rejected} rejected piece(s) still have no reason — the boxes must add up to the rejected quantity`;
  } else if (rejectedKnown && splitTotal > rejected) {
    errors.rejectBreakdown =
      rejected > 0
        ? `Split is ${splitTotal - rejected} more than the ${rejected} rejected — the boxes must add up to the rejected quantity`
        : "Nothing was rejected (Actual − OK is 0), so these boxes should be empty";
  }
  if (split.Other > 0 && blank(v.rejectOtherRemark)) {
    errors.rejectOtherRemark = 'Remark is required when "Other" is a reject reason';
  }

  const planned = num(v.plannedOperatorShiftHours);
  if (blank(v.plannedOperatorShiftHours)) errors.plannedOperatorShiftHours = "Planned Operator Shift is required";
  else if (!Number.isFinite(planned) || planned <= 0 || planned > 24) errors.plannedOperatorShiftHours = "Must be more than 0 and at most 24 hours";

  const lunch = num(v.lunchMin);
  if (blank(v.lunchMin)) {
    if (lunchRequired(v)) errors.lunchMin = "Lunch / Rest is required (enter 0 if none)";
  } else if (!Number.isFinite(lunch) || lunch < 0 || lunch > 1440) errors.lunchMin = "0–1440";

  for (const key of DOWNTIME_KEYS) {
    const n = num(v[key]);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1440)) errors[key] = "0–1440";
  }
  for (const key of CYCLE_OP_KEYS) {
    const n = num(v[key]);
    if (n !== null && (!Number.isFinite(n) || n < 0)) errors[key] = "Must be 0 or more";
  }

  const limit = stoppageLimitMin(v);
  if (limit !== null && calc.totalStoppageMin > limit) {
    errors.stoppageTotal = `Total stoppage is ${calc.totalStoppageMin} min but only ${limit} min is allowed (Planned Operator Shift − Machine Shift)`;
  }
  if (num(v.otherMin) > 0 && blank(v.otherMinRemark)) {
    errors.otherMinRemark = "Remark is required when Other downtime is entered";
  }

  return errors;
};

// The first field with an error, in form order — { index, field } — or null.
export const firstError = (errorsList) => {
  for (let index = 0; index < errorsList.length; index += 1) {
    const errors = errorsList[index] || {};
    const field = FIELD_ORDER.find((k) => errors[k]) || Object.keys(errors)[0];
    if (field) return { index, field };
  }
  return null;
};

