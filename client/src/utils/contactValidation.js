import { isNonWorking } from "./productionSheet";
import { normalizeTime, spanMinutes } from "./productionSheet";
import { stoppageLimitMin, timesUnchanged, withDecimalPlanned } from "./entryValidation";
import { contactRowCalc, isStatusOnly } from "./contactSheet";
import { hoursToHm, parseShiftHours } from "./shiftHours";
import { validateQuantities } from "./quantityRules";

/**
 * utils/contactValidation.js
 * ─────────────────────────────
 * Every rule the Contact Data Entry form enforces — the CNC sheet's rules
 * (utils/entryValidation.js) — Production Master (Actual + OK Quantity typed,
 * Rejected = Actual − OK) and Rejection Master (the rejected pieces split by
 * reason, utils/quantityRules.js) — plus Working Status and Setting ON/OFF Time as plain optional fields (no formula
 * reads them — see productionSheet.js's rowCalc). Total Cycle Time is this
 * entry's own figure, prefilled from the Part and editable here.
 *
 *   Status-only Any Working Status but PRESENT (ABSENT, SUNDAY, M/C OFF, …):
 *               only Date and Machine No. — nothing else is asked for.
 *   Required    Date, Machine No., Operator, Part Name, Total Cycle Time (> 0),
 *               Machine ON/OFF Time, Actual Quantity, OK Quantity,
 *               Planned Operator Shift (typed as decimal hours like the sheet, not less than the Machine
 *               Shift).
 *   Optional     Working Status, Setting ON/OFF Time — informational only.
 *   Quantities  Actual can't be more than Ideal Quantity, OK can't be more than
 *               Actual; the Rejection Master boxes must add up to Actual − OK,
 *               and "Other" needs a remark.
 *   Times       Machine OFF after ON.
 *   Downtime    Optional (blank counts as 0), 0–1440 each, total within Planned
 *               Operator Shift − Machine Shift. "Others" needs a remark.
 *
 * The server re-checks these (server/controllers/contactSheet.controller.js —
 * entryRuleError); keep the two in step.
 */

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const blank = (v) => v === "" || v === null || v === undefined || String(v).trim() === "";

export const CONTACT_DOWNTIME_KEYS = [
  "plannedDownMin",
  "setupMin",
  "noManPowerMin",
  "materialShiftingMin",
  "noMaterialMin",
  "bdMechMin",
  "bdEleMin",
  "noPowerMin",
  "otherMin",
];

// Top to bottom, the way the form reads — the first key with an error is where Save scrolls to.
export const CONTACT_FIELD_ORDER = [
  "date",
  "machine",
  "operator",
  "workingStatus",
  "itemName",
  "totalCycleSec",
  "machineOnTime",
  "machineOffTime",
  "settingOnTime",
  "settingOffTime",
  "actualQty",
  "okQty",
  "rejectBreakdown",
  "rejectOtherRemark",
  "plannedOperatorShiftHours",
  "lunchMin",
  ...CONTACT_DOWNTIME_KEYS,
  "stoppageTotal",
  "otherMinRemark",
];

const clock = (t) => {
  const n = normalizeTime(t);
  return n ? Number(n.slice(0, 2)) * 60 + Number(n.slice(3)) : null;
};

// One block's values → { fieldKey: message }. Empty object = ready to save.
export const validateContactEntry = (v, { saved = null } = {}) => {
  const errors = {};
  const calc = contactRowCalc(v);

  if (blank(v.date)) errors.date = "Date is required";
  if (blank(v.machine)) errors.machine = "Machine No. is required";
  // ABSENT, SUNDAY, M/C OFF, … — a day with no production records just its status.
  if (isStatusOnly(v) || isNonWorking(v)) return errors;

  if (blank(v.operator)) errors.operator = "Operator is required";
  if (blank(v.itemName)) errors.itemName = "Part Name is required";
  const cycle = num(v.totalCycleSec);
  if (blank(v.totalCycleSec)) errors.totalCycleSec = "Total Cycle Time is required";
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

  // Setting ON/OFF Time are optional, informational only — just needs to be a
  // real time when something is typed.
  for (const [key, label] of [
    ["settingOnTime", "Setting ON Time"],
    ["settingOffTime", "Setting OFF Time"],
  ]) {
    if (!blank(v[key]) && !normalizeTime(v[key])) errors[key] = `Enter a valid ${label.toLowerCase()}`;
  }

  // Actual and OK are typed; Rejected = Actual − OK and the split accounts for it.
  validateQuantities(v, calc, errors, { capByIdeal: true });

  // Planned Operator Shift is typed as decimal hours like the sheet (5.33 = 5 h 20 min).
  const plannedParse = parseShiftHours(v.plannedOperatorShiftHours);
  const planned = plannedParse.hours;
  if (blank(v.plannedOperatorShiftHours)) errors.plannedOperatorShiftHours = "Planned Operator Shift is required";
  else if (planned === null) errors.plannedOperatorShiftHours = "Enter hours as on the sheet, like 8.5 or 5.33";
  else if (planned <= 0 || planned > 24) errors.plannedOperatorShiftHours = "Must be more than 0:00 and at most 24:00";
  else {
    // Not while End isn't after Start: the span would wrap past midnight
    // (23 h and the like), and the End box already says what's wrong.
    const shiftMin = errors.machineOffTime ? null : spanMinutes(v.machineOnTime, v.machineOffTime);
    if (shiftMin !== null && Math.round(planned * 60) < shiftMin) {
      errors.plannedOperatorShiftHours = `Planned Operator Shift can't be less than the Machine Shift (${hoursToHm(shiftMin / 60)})`;
    }
  }
  const decimal = withDecimalPlanned(v);

  // Lunch / Rest is optional, like every other stoppage box: blank counts as 0.
  const lunch = num(v.lunchMin);
  if (!blank(v.lunchMin) && (!Number.isFinite(lunch) || lunch < 0 || lunch > 1440)) errors.lunchMin = "0–1440";

  for (const key of CONTACT_DOWNTIME_KEYS) {
    const n = num(v[key]);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1440)) errors[key] = "0–1440";
  }
  const limit = stoppageLimitMin(decimal);
  if (limit !== null && calc.totalStoppageMin > limit) {
    errors.stoppageTotal = `Total stoppage is ${calc.totalStoppageMin} min but the Machine Shift is only ${limit} min`;
  }
  if (num(v.otherMin) > 0 && blank(v.otherMinRemark)) {
    errors.otherMinRemark = "Remark is required when Others downtime is entered";
  }
  return errors;
};

// The first field with an error, in form order — { index, field } — or null.
export const firstContactError = (errorsList) => {
  for (let index = 0; index < errorsList.length; index += 1) {
    const errors = errorsList[index] || {};
    const field = CONTACT_FIELD_ORDER.find((k) => errors[k]) || Object.keys(errors)[0];
    if (field) return { index, field };
  }
  return null;
};
