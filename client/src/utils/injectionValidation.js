import { isNonWorking, normalizeTime, spanMinutes } from "./productionSheet";
import { stoppageLimitMin, timesUnchanged, withDecimalPlanned } from "./entryValidation";
import { INJECTION_STOPPAGE_FIELDS, injectionRowCalc, isStatusOnly } from "./injectionSheet";
import { hoursToHm, parseShiftHours } from "./shiftHours";
import { validateQuantities } from "./quantityRules";

/**
 * utils/injectionValidation.js
 * ──────────────────────────────
 * Every rule the INJECTION MOULDING form enforces — the SPRING FOR PINS form's
 * (utils/springValidation.js) over this sheet's own fields:
 *
 *   Non Working  Working Status "Non Working" (or a status-only Working Status:
 *                ABSENT, SUNDAY, …): only Date and MC No. — nothing else is asked for.
 *   Required     Date, MC No., Operator, Item Name, Standard Time per Piece (> 0),
 *                Machine ON / OFF Time, Actual Quantity (TOTAL QTY.), OK Quantity,
 *                Planned Operator Shift (typed as decimal hours like the sheet, not
 *                less than the Machine Shift — or fixed by Process Master's lock).
 *   Quantities   Whole numbers, 0 or more; TOTAL can't be more than Ideal Quantity
 *                rounded down, OK can't be more than TOTAL; Rejected = TOTAL − OK.
 *                No Rejection Master: this sheet has no reject reasons.
 *   Times        Machine OFF after ON.
 *   Downtime     Optional (blank counts as 0), 0–1440 each, all of it together
 *                within the Machine Shift. "Other" needs a remark.
 *
 * The server re-checks these (server/controllers/injectionSheet.controller.js —
 * entryRuleError); keep the two in step.
 */

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const blank = (v) => v === "" || v === null || v === undefined || String(v).trim() === "";

export const INJECTION_MINUTE_KEYS = INJECTION_STOPPAGE_FIELDS.map((f) => f.key);
// The downtime boxes in their own line — every one but Lunch, which sits beside Planned.
export const INJECTION_DOWNTIME_KEYS = INJECTION_MINUTE_KEYS.filter((k) => k !== "lunchMin");

// Top to bottom, the way the form reads — the first key with an error is where Save scrolls to.
export const INJECTION_FIELD_ORDER = [
  "date",
  "machine",
  "operator",
  "workingMode",
  "machineStatus",
  "itemName",
  "vendor",
  "totalCycleSec",
  "machineOnTime",
  "machineOffTime",
  "actualQty",
  "okQty",
  "plannedOperatorShiftHours",
  "lunchMin",
  ...INJECTION_DOWNTIME_KEYS,
  "stoppageTotal",
  "otherMinRemark",
];

const clock = (t) => {
  const n = normalizeTime(t);
  return n ? Number(n.slice(0, 2)) * 60 + Number(n.slice(3)) : null;
};

// One block's values → { fieldKey: message }. Empty object = ready to save.
export const validateInjectionEntry = (v, { saved = null } = {}) => {
  const errors = {};
  const calc = injectionRowCalc(v);

  if (blank(v.date)) errors.date = "Date is required";
  if (blank(v.machine)) errors.machine = "MC No. is required";
  // Non Working (or ABSENT, SUNDAY, …) — a day with no production records just its reason.
  if (isStatusOnly(v) || isNonWorking(v)) return errors;

  if (blank(v.operator)) errors.operator = "Operator is required";
  if (blank(v.itemName)) errors.itemName = "Item Name is required";
  const std = num(v.totalCycleSec);
  if (blank(v.totalCycleSec)) errors.totalCycleSec = "Standard Time per Piece is required";
  else if (!isNum(std) || std <= 0) errors.totalCycleSec = "Must be more than 0";

  for (const [key, label] of [
    ["machineOnTime", "Machine ON Time"],
    ["machineOffTime", "Machine OFF Time"],
  ]) {
    if (blank(v[key])) errors[key] = `${label} is required`;
    else if (!normalizeTime(v[key])) errors[key] = "Enter a valid time";
  }
  if (!errors.machineOnTime && !errors.machineOffTime && !timesUnchanged(v, saved)) {
    const on = clock(v.machineOnTime);
    const off = clock(v.machineOffTime);
    if (on !== null && off !== null && off <= on) errors.machineOffTime = "Machine OFF Time must be after Machine ON Time";
  }

  // TOTAL (Actual) and OK are typed; TOTAL can't beat what the shift could make
  // (Ideal Quantity rounded down — calc.idealQty). There's no reject split on
  // this sheet, so the shared rules' split checks don't apply.
  validateQuantities({ ...v, rejectBreakdown: {} }, calc, errors);
  delete errors.rejectBreakdown;
  delete errors.rejectOtherRemark;
  for (const key of ["actualQty", "okQty"]) {
    const n = num(v[key]);
    if (!errors[key] && isNum(n) && !Number.isInteger(n)) errors[key] = "Must be a whole number, 0 or more";
  }

  // Planned Operator Shift is typed as decimal hours like the sheet (5.33 = 5 h 20 min).
  const planned = parseShiftHours(v.plannedOperatorShiftHours).hours;
  if (blank(v.plannedOperatorShiftHours)) errors.plannedOperatorShiftHours = "Planned Operator Shift is required";
  else if (planned === null) errors.plannedOperatorShiftHours = "Enter hours as on the sheet, like 8.5 or 5.33";
  else if (planned <= 0 || planned > 24) errors.plannedOperatorShiftHours = "Must be more than 0:00 and at most 24:00";
  else {
    // Not while OFF isn't after ON: the span would wrap past midnight
    // (23 h and the like), and the OFF box already says what's wrong.
    const shiftMin = errors.machineOffTime ? null : spanMinutes(v.machineOnTime, v.machineOffTime);
    if (shiftMin !== null && Math.round(planned * 60) < shiftMin) {
      errors.plannedOperatorShiftHours = `Planned Operator Shift can't be less than the Machine Shift (${hoursToHm(shiftMin / 60)})`;
    }
  }

  // Downtime is optional, every box: blank counts as 0.
  for (const key of INJECTION_MINUTE_KEYS) {
    const n = num(v[key]);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1440)) errors[key] = "0–1440";
  }
  const limit = stoppageLimitMin(withDecimalPlanned(v));
  if (limit !== null && (calc.totalStoppageMin || 0) > limit) {
    errors.stoppageTotal = `Total Idle Time is ${calc.totalStoppageMin} min but the Machine Shift is only ${limit} min`;
  }
  if (num(v.otherMin) > 0 && blank(v.otherMinRemark)) {
    errors.otherMinRemark = "Remark is required when Other downtime is entered";
  }
  return errors;
};

// The first field with an error, in form order — { index, field } — or null.
export const firstInjectionError = (errorsList) => {
  for (let index = 0; index < errorsList.length; index += 1) {
    const errors = errorsList[index] || {};
    const field = INJECTION_FIELD_ORDER.find((k) => errors[k]) || Object.keys(errors)[0];
    if (field) return { index, field };
  }
  return null;
};
