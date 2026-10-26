import { isNonWorking, normalizeTime, spanMinutes } from "./productionSheet";
import { stoppageLimitMin, timesUnchanged } from "./entryValidation";
import { BPC_STOPPAGE_FIELDS, bpcRowCalc, isStatusOnly } from "./bpcSheet";
import { hoursToHm, parseShiftHours } from "./shiftHours";
import { validateQuantities } from "./quantityRules";

/**
 * utils/bpcValidation.js
 * ────────────────────────
 * Every rule the BEFORE POWDER COATING form enforces — RUBBER's rules
 * (utils/rubberValidation.js) over this sheet's own fields and words:
 *
 *   Status-only Any Working Status but PRESENT (ABSENT, SUNDAY, …), or Non
 *               Working: only Date and Operator — nothing else is asked for.
 *   Required    Date, Operator, Item Name, Standard Time per Piece (> 0),
 *               Machine ON / OFF Time, TOTAL QTY, OK QTY, Planned Operator Shift
 *               (typed as decimal hours like every sheet, not less than the
 *               Machine Shift Time; fixed by Process Master while locked).
 *   Quantities  TOTAL and OK are typed whole numbers, 0 or more; OK can't be more
 *               than TOTAL; Rejected = TOTAL − OK, split across this sheet's own
 *               reasons (Rejection Master — the boxes must add up, "Other" needs
 *               a remark; utils/quantityRules.js). TOTAL MAY be more than Ideal
 *               Quantity — an operator can beat the standard time, as on RUBBER —
 *               and such an entry goes to OEE Review (Performance > 100%).
 *   Times       Machine OFF after ON; one operator's entries on a date can't
 *               overlap (entryValidation's overlapErrors, on the page).
 *   Idle Time   Optional, 0–1440 each; Setup + B.D. + Lunch + Other together
 *               within the Machine Shift Time. "Other" needs a remark.
 *
 * The server re-checks these (server/controllers/bpcSheet.controller.js —
 * entryRuleError); keep the two in step.
 */

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const blank = (v) => v === "" || v === null || v === undefined || String(v).trim() === "";

export const BPC_MINUTE_KEYS = BPC_STOPPAGE_FIELDS.map((f) => f.key);

// Top to bottom, the way the form reads — the first key with an error is where Save scrolls to.
export const BPC_FIELD_ORDER = [
  "date",
  "machine",
  "workingStatus",
  "itemName",
  "vendor",
  "totalCycleSec",
  "machineOnTime",
  "machineOffTime",
  "actualQty",
  "okQty",
  "rejectBreakdown",
  "rejectOtherRemark",
  "plannedOperatorShiftHours",
  ...BPC_MINUTE_KEYS,
  "stoppageTotal",
  "otherMinRemark",
];

// The overlap message (entryValidation's overlapErrors) in this sheet's words:
// the sheet calls them Machine ON / OFF Time, kept per operator.
export const BPC_TIME_WORDS = { start: "Machine ON Time", end: "Machine OFF Time", owner: "this operator" };

const clock = (t) => {
  const n = normalizeTime(t);
  return n ? Number(n.slice(0, 2)) * 60 + Number(n.slice(3)) : null;
};

// One block's values → { fieldKey: message }. Empty object = ready to save.
export const validateBpcEntry = (v, { saved = null } = {}) => {
  const errors = {};
  const calc = bpcRowCalc(v);

  if (blank(v.date)) errors.date = "Date is required";
  if (blank(v.machine)) errors.machine = "Operator is required";
  // ABSENT, SUNDAY, … or Non Working — a day with no work records just its status.
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

  // Not capped at Ideal — over-Ideal goes to OEE Review instead.
  validateQuantities(v, calc, errors, { capByIdeal: false });
  if (errors.actualQty === "Actual Quantity is required") errors.actualQty = "TOTAL QTY is required";
  if (errors.okQty === "OK Quantity is required") errors.okQty = "OK QTY is required";
  if (errors.okQty && /^OK can't be more than Actual Quantity/.test(errors.okQty)) errors.okQty = `OK can't be more than TOTAL QTY (${num(v.actualQty)})`;
  for (const key of ["actualQty", "okQty"]) {
    const n = num(v[key]);
    if (!errors[key] && isNum(n) && !Number.isInteger(n)) errors[key] = "Must be a whole number, 0 or more";
  }

  // Planned Operator Shift is typed as decimal hours (5.33 = 5 h 20 min).
  const planned = parseShiftHours(v.plannedOperatorShiftHours).hours;
  if (blank(v.plannedOperatorShiftHours)) errors.plannedOperatorShiftHours = "Planned Operator Shift is required";
  else if (planned === null) errors.plannedOperatorShiftHours = "Enter hours like 8.5 or 6.75";
  else if (planned <= 0 || planned > 24) errors.plannedOperatorShiftHours = "Must be more than 0:00 and at most 24:00";
  else {
    // Not while OFF isn't after ON: the span would wrap past midnight
    // (23 h and the like), and the OFF box already says what's wrong.
    const shiftMin = errors.machineOffTime ? null : spanMinutes(v.machineOnTime, v.machineOffTime);
    if (shiftMin !== null && Math.round(planned * 60) < shiftMin) {
      errors.plannedOperatorShiftHours = `Planned Operator Shift can't be less than the Machine Shift Time (${hoursToHm(shiftMin / 60)})`;
    }
  }

  // Idle time is optional, like every downtime box: blank counts as 0.
  for (const key of BPC_MINUTE_KEYS) {
    const n = num(v[key]);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1440)) errors[key] = "0–1440";
  }
  const limit = stoppageLimitMin(v);
  if (limit !== null && (calc.totalStoppageMin || 0) > limit) {
    errors.stoppageTotal = `Total Idle Time is ${calc.totalStoppageMin} min but the Machine Shift Time is only ${limit} min`;
  }
  if (num(v.otherMin) > 0 && blank(v.otherMinRemark)) {
    errors.otherMinRemark = "Remark is required when Other idle time is entered";
  }
  return errors;
};

// The first field with an error, in form order — { index, field } — or null.
export const firstBpcError = (errorsList) => {
  for (let index = 0; index < errorsList.length; index += 1) {
    const errors = errorsList[index] || {};
    const field = BPC_FIELD_ORDER.find((k) => errors[k]) || Object.keys(errors)[0];
    if (field) return { index, field };
  }
  return null;
};
