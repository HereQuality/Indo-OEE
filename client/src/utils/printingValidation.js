import { isNonWorking, normalizeTime, spanMinutes } from "./productionSheet";
import { stoppageLimitMin, timesUnchanged } from "./entryValidation";
import { PRINTING_STOPPAGE_FIELDS, isStatusOnly, printingRowCalc } from "./printingSheet";
import { hoursToHm, parseShiftHours } from "./shiftHours";
import { validateQuantities } from "./quantityRules";

/**
 * utils/printingValidation.js
 * ─────────────────────────────
 * Every rule the PRINTING form enforces — RUBBER's rules
 * (utils/rubberValidation.js) with SPRING FOR PINS's quantities, over this
 * sheet's own fields:
 *
 *   Non Working Only Date and Operator (+ reasons / remarks) — nothing else.
 *   Required    Date, Operator, Item Name, Standard Time per Piece (> 0),
 *               Machine ON / OFF Time, TOTAL QTY (Actual Quantity), OK QTY,
 *               Planned Operator Shift (typed as decimal hours like the sheet,
 *               not less than the Machine Shift). MC No. is optional.
 *   Quantities  Whole numbers, 0 or more; OK ≤ TOTAL; Rejected = TOTAL − OK.
 *               TOTAL can't be more than the Ideal Quantity rounded down. No
 *               Rejection Master on this sheet — only the free-text
 *               Reason/Remarks for Rejection/Rework.
 *   Times       Machine OFF after ON. NO overlap rule: one operator may run
 *               two jobs at the same time (the paper sheet does).
 *   Downtime    Optional, 0–1440 each; all 13 columns together within the
 *               Machine Shift. "Other" needs a remark.
 *
 * The server re-checks these (server/controllers/printingSheet.controller.js —
 * entryRuleError); keep the two in step.
 */

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const blank = (v) => v === "" || v === null || v === undefined || String(v).trim() === "";

export const PRINTING_MINUTE_KEYS = PRINTING_STOPPAGE_FIELDS.map((f) => f.key);

// Top to bottom, the way the form reads — the first key with an error is where Save scrolls to.
export const PRINTING_FIELD_ORDER = [
  "date",
  "machine",
  "workingMode",
  "mcMachine",
  "itemName",
  "vendor",
  "totalCycleSec",
  "machineOnTime",
  "machineOffTime",
  "actualQty",
  "okQty",
  "plannedOperatorShiftHours",
  ...PRINTING_MINUTE_KEYS,
  "stoppageTotal",
  "otherMinRemark",
];

const clock = (t) => {
  const n = normalizeTime(t);
  return n ? Number(n.slice(0, 2)) * 60 + Number(n.slice(3)) : null;
};

// One block's values → { fieldKey: message }. Empty object = ready to save.
export const validatePrintingEntry = (v, { saved = null } = {}) => {
  const errors = {};
  const calc = printingRowCalc(v);

  if (blank(v.date)) errors.date = "Date is required";
  if (blank(v.machine)) errors.machine = "Operator is required";
  // Non Working (or an older status-only day) records just its status.
  if (isStatusOnly(v) || isNonWorking(v)) return errors;

  if (blank(v.itemName)) errors.itemName = "Item Name is required";
  const cycle = num(v.totalCycleSec);
  if (blank(v.totalCycleSec)) errors.totalCycleSec = "Standard Time per Piece is required";
  else if (!isNum(cycle) || cycle <= 0) errors.totalCycleSec = "Must be more than 0";

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

  // TOTAL ≤ Ideal (rounded down), OK ≤ TOTAL. This sheet has no Rejection
  // Master, so the split rules of the shared check don't apply.
  validateQuantities(v, calc, errors, { capByIdeal: true });
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
    // Not while OFF isn't after ON: the span would wrap past midnight, and the
    // OFF box already says what's wrong.
    const shiftMin = errors.machineOffTime ? null : spanMinutes(v.machineOnTime, v.machineOffTime);
    if (shiftMin !== null && Math.round(planned * 60) < shiftMin) {
      errors.plannedOperatorShiftHours = `Planned Operator Shift can't be less than the Machine Shift (${hoursToHm(shiftMin / 60)})`;
    }
  }

  // Downtime is optional, like every downtime box: blank counts as 0.
  for (const key of PRINTING_MINUTE_KEYS) {
    const n = num(v[key]);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1440)) errors[key] = "0–1440";
  }
  const limit = stoppageLimitMin(v);
  if (limit !== null && (calc.totalStoppageMin || 0) > limit) {
    errors.stoppageTotal = `Total Idle Time is ${calc.totalStoppageMin} min but the Machine Shift is only ${limit} min`;
  }
  if (num(v.otherMin) > 0 && blank(v.otherMinRemark)) {
    errors.otherMinRemark = "Remark is required when Other downtime is entered";
  }
  return errors;
};

// The first field with an error, in form order — { index, field } — or null.
export const firstPrintingError = (errorsList) => {
  for (let index = 0; index < errorsList.length; index += 1) {
    const errors = errorsList[index] || {};
    const field = PRINTING_FIELD_ORDER.find((k) => errors[k]) || Object.keys(errors)[0];
    if (field) return { index, field };
  }
  return null;
};
