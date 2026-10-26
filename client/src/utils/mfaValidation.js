import { isNonWorking, normalizeTime, spanMinutes } from "./productionSheet";
import { stoppageLimitMin, timesUnchanged } from "./entryValidation";
import { MFA_LABELS, isStatusOnly, mfaRowCalc } from "./mfaSheet";
import { hoursToHm, parseShiftHours } from "./shiftHours";
import { validateQuantities } from "./quantityRules";

/**
 * utils/mfaValidation.js
 * ────────────────────────
 * Every rule the MODULAR FRAME ASSEMBLY form enforces — RAW CASTING's rules
 * (utils/rawCastingValidation.js) over this sheet's own fields:
 *
 *   Status-only Any Working Status but PRESENT (ABSENT, SUNDAY, …), or Non
 *               Working: only Date and Worker Name — nothing else is asked for.
 *   Required    Date, Worker Name, Item Name, Standard Assembly Time per Piece
 *               (> 0), Assembly Start / End Time, TOTAL QTY, OK QTY, Planned
 *               Operator Shift (typed as decimal hours like the sheet, not less
 *               than the Assembly Working Hours; fixed by Process Master while
 *               locked).
 *   Quantities  TOTAL and OK are typed whole numbers, 0 or more; OK can't be
 *               more than TOTAL; Rejected QTY = TOTAL − OK. No reason split —
 *               Remarks only, as on INJECTION MOULDING, so the shared rules'
 *               split checks are dropped. TOTAL MAY be more than the Ideal
 *               Assembly Quantity (the paper has rows at 160% and 549%) — such
 *               an entry goes to OEE Review.
 *   Times       Assembly End after Start. One worker's entries on a date MAY overlap.
 *   Idle / Other Activity  Optional, 0–1440 each; Lunch + Other idle + Other
 *               Activity within the Assembly Working Hours. "Other" idle needs
 *               a remark, Other Activity minutes need what the activity was.
 *
 * The server re-checks these (server/controllers/mfaSheet.controller.js —
 * entryRuleError); keep the two in step.
 */

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const blank = (v) => v === "" || v === null || v === undefined || String(v).trim() === "";

export const MFA_MINUTE_KEYS = ["otherActivityMin", "lunchMin", "otherMin"];

// Top to bottom, the way the form reads — the first key with an error is where Save scrolls to.
export const MFA_FIELD_ORDER = [
  "date",
  "machine",
  "workingStatus",
  "itemName",
  "totalCycleSec",
  "machineOnTime",
  "machineOffTime",
  "actualQty",
  "okQty",
  "otherActivity",
  "otherActivityMin",
  "plannedOperatorShiftHours",
  "lunchMin",
  "otherMin",
  "stoppageTotal",
  "otherMinRemark",
];

const clock = (t) => {
  const n = normalizeTime(t);
  return n ? Number(n.slice(0, 2)) * 60 + Number(n.slice(3)) : null;
};

// One block's values → { fieldKey: message }. Empty object = ready to save.
export const validateMfaEntry = (v, { saved = null } = {}) => {
  const errors = {};
  const calc = mfaRowCalc(v);

  if (blank(v.date)) errors.date = "Date is required";
  if (blank(v.machine)) errors.machine = "Worker Name is required";
  // ABSENT, SUNDAY, … or Non Working — a day with no work records just its status.
  if (isStatusOnly(v) || isNonWorking(v)) return errors;

  if (blank(v.itemName)) errors.itemName = "Item Name is required";
  const cycle = num(v.totalCycleSec);
  if (blank(v.totalCycleSec)) errors.totalCycleSec = `${MFA_LABELS.cycle} is required`;
  else if (!isNum(cycle) || cycle <= 0) errors.totalCycleSec = "Must be more than 0";

  for (const [key, label] of [
    ["machineOnTime", MFA_LABELS.start],
    ["machineOffTime", MFA_LABELS.end],
  ]) {
    if (blank(v[key])) errors[key] = `${label} is required`;
    else if (!normalizeTime(v[key])) errors[key] = "Enter a valid time";
  }
  if (!errors.machineOnTime && !errors.machineOffTime && !timesUnchanged(v, saved)) {
    const on = clock(v.machineOnTime);
    const off = clock(v.machineOffTime);
    if (on !== null && off !== null && off <= on) errors.machineOffTime = `${MFA_LABELS.end} must be after ${MFA_LABELS.start}`;
  }

  // TOTAL and OK are typed; not capped at Ideal — over-Ideal goes to OEE Review
  // instead. There's no reject split on this sheet, so the shared rules' split
  // checks don't apply.
  validateQuantities({ ...v, rejectBreakdown: {} }, calc, errors, { capByIdeal: false });
  delete errors.rejectBreakdown;
  delete errors.rejectOtherRemark;
  if (errors.actualQty === "Actual Quantity is required") errors.actualQty = "TOTAL QTY is required";
  if (errors.okQty === "OK Quantity is required") errors.okQty = "OK QTY is required";
  if (errors.okQty && /^OK can't be more than Actual Quantity/.test(errors.okQty)) errors.okQty = `OK can't be more than TOTAL QTY (${num(v.actualQty)})`;
  for (const key of ["actualQty", "okQty"]) {
    const n = num(v[key]);
    if (!errors[key] && isNum(n) && !Number.isInteger(n)) errors[key] = "Must be a whole number, 0 or more";
  }

  // Planned Operator Shift is typed as decimal hours like the sheet (5.33 = 5 h 20 min).
  const planned = parseShiftHours(v.plannedOperatorShiftHours).hours;
  if (blank(v.plannedOperatorShiftHours)) errors.plannedOperatorShiftHours = "Planned Operator Shift is required";
  else if (planned === null) errors.plannedOperatorShiftHours = "Enter hours as on the sheet, like 9.42 or 2.67";
  else if (planned <= 0 || planned > 24) errors.plannedOperatorShiftHours = "Must be more than 0:00 and at most 24:00";
  else {
    // Not while End isn't after Start: the span would wrap past midnight
    // (23 h and the like), and the End box already says what's wrong.
    const shiftMin = errors.machineOffTime ? null : spanMinutes(v.machineOnTime, v.machineOffTime);
    if (shiftMin !== null && Math.round(planned * 60) < shiftMin) {
      errors.plannedOperatorShiftHours = `Planned Operator Shift can't be less than the ${MFA_LABELS.hours} (${hoursToHm(shiftMin / 60)})`;
    }
  }

  // Idle Time and Other Activity are optional, like every downtime box: blank counts as 0.
  for (const key of MFA_MINUTE_KEYS) {
    const n = num(v[key]);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1440)) errors[key] = "0–1440";
  }
  const limit = stoppageLimitMin(v);
  const away = (calc.totalStoppageMin || 0) + (num(v.otherActivityMin) || 0);
  if (limit !== null && away > limit) {
    errors.stoppageTotal = `Idle Time + Other Activity is ${away} min but the ${MFA_LABELS.hours} are only ${limit} min`;
  }
  if (num(v.otherActivityMin) > 0 && blank(v.otherActivity)) {
    errors.otherActivity = "Say what the other activity was";
  }
  if (num(v.otherMin) > 0 && blank(v.otherMinRemark)) {
    errors.otherMinRemark = "Remark is required when Other idle time is entered";
  }
  return errors;
};

// The first field with an error, in form order — { index, field } — or null.
export const firstMfaError = (errorsList) => {
  for (let index = 0; index < errorsList.length; index += 1) {
    const errors = errorsList[index] || {};
    const field = MFA_FIELD_ORDER.find((k) => errors[k]) || Object.keys(errors)[0];
    if (field) return { index, field };
  }
  return null;
};
