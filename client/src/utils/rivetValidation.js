import { normalizeTime, spanMinutes } from "./productionSheet";
import { stoppageLimitMin, withDecimalPlanned } from "./entryValidation";
import { rivetRowCalc } from "./rivetSheet";
import { hoursToHm, parseHm } from "./shiftHours";

/**
 * utils/rivetValidation.js
 * ───────────────────────────
 * Every rule the RIVET Data Entry form enforces, in one place — the CNC sheet's
 * rules (utils/entryValidation.js) over the RIVET sheet's fields. The machine/
 * operator overlap checks and the stoppage allowance are the CNC ones, imported
 * as they are; what is RIVET's own is below.
 *
 *   Required    Date, Machine No., Operator, Part Name, Total Cycle Time (Sec,
 *               typed directly — see utils/rivetSheet.js), Machine ON/OFF
 *               Time, Actual OK Quantity, Rejected Quantity, Planned Operator
 *               Shift (typed H.MM, not less than the Machine Shift).
 *   Quantities  OK + Rejected can't be more than Ideal Quantity.
 *   Times       Machine OFF after ON.
 *   Downtime    Optional (blank counts as 0), 0–1440 each, total within Planned
 *               Operator Shift − Machine Shift. "Others" needs a remark.
 *
 * The server re-checks these (server/controllers/rivetSheet.controller.js —
 * entryRuleError); keep the two in step.
 */

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const blank = (v) => v === "" || v === null || v === undefined || String(v).trim() === "";

// In the order the sheet lists them. Lunch / Rest has its own box beside
// Planned Operator Shift (see RIVET_FIELD_ORDER) and isn't in this group, though
// it still counts toward the total (see rowCalc).
export const RIVET_DOWNTIME_KEYS = [
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
export const RIVET_FIELD_ORDER = [
  "date",
  "machine",
  "operator",
  "itemName",
  "totalCycleSec",
  "machineOnTime",
  "machineOffTime",
  "okQty",
  "rejectedQty",
  "plannedOperatorShiftHours",
  "lunchMin",
  ...RIVET_DOWNTIME_KEYS,
  "stoppageTotal",
  "otherMinRemark",
];

const clock = (t) => {
  const n = normalizeTime(t);
  return n ? Number(n.slice(0, 2)) * 60 + Number(n.slice(3)) : null;
};

// Same only-when-changed rule as the CNC sheet: an older row that already breaks a
// time rule stays editable.
const timesUnchanged = (v, saved) =>
  !!saved &&
  normalizeTime(v.machineOnTime) === normalizeTime(saved.machineOnTime) &&
  normalizeTime(v.machineOffTime) === normalizeTime(saved.machineOffTime);

// One block's values → { fieldKey: message }. Empty object = ready to save.
export const validateRivetEntry = (v, { saved = null } = {}) => {
  const errors = {};
  const calc = rivetRowCalc(v);

  if (blank(v.date)) errors.date = "Date is required";
  if (blank(v.machine)) errors.machine = "Machine No. is required";
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

  // OK and Rejected are both typed; together they can't beat what the shift could make.
  const ok = num(v.okQty);
  const rej = num(v.rejectedQty);
  if (blank(v.okQty)) errors.okQty = "Actual OK Quantity is required";
  else if (!isNum(ok) || ok < 0) errors.okQty = "Must be 0 or more";
  if (blank(v.rejectedQty)) errors.rejectedQty = "Rejected Quantity is required";
  else if (!isNum(rej) || rej < 0) errors.rejectedQty = "Must be 0 or more";
  if (!errors.okQty && !errors.rejectedQty && isNum(calc.idealQty) && ok + rej > calc.idealQty) {
    errors.okQty = `OK + Rejected (${ok + rej}) can't be more than Ideal Quantity (${calc.idealQty})`;
  }

  // Planned Operator Shift is typed as H.MM (60 minutes to the hour).
  const plannedParse = parseHm(v.plannedOperatorShiftHours);
  const planned = plannedParse.hours;
  if (blank(v.plannedOperatorShiftHours)) errors.plannedOperatorShiftHours = "Planned Operator Shift is required";
  else if (plannedParse.minutesTooBig) errors.plannedOperatorShiftHours = "Minutes must be 00–59 (3.30 means 3 h 30 min)";
  else if (planned === null) errors.plannedOperatorShiftHours = "Enter hours and minutes like 8.30";
  else if (planned <= 0 || planned > 24) errors.plannedOperatorShiftHours = "Must be more than 0:00 and at most 24:00";
  else {
    const shiftMin = spanMinutes(v.machineOnTime, v.machineOffTime);
    if (shiftMin !== null && Math.round(planned * 60) < shiftMin) {
      errors.plannedOperatorShiftHours = `Planned Operator Shift can't be less than the Machine Shift (${hoursToHm(shiftMin / 60)})`;
    }
  }
  const decimal = withDecimalPlanned(v);

  // Lunch / Rest is optional, like every other stoppage box: blank counts as 0.
  const lunch = num(v.lunchMin);
  if (!blank(v.lunchMin) && (!Number.isFinite(lunch) || lunch < 0 || lunch > 1440)) errors.lunchMin = "0–1440";

  for (const key of RIVET_DOWNTIME_KEYS) {
    const n = num(v[key]);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1440)) errors[key] = "0–1440";
  }
  const limit = stoppageLimitMin(decimal);
  if (limit !== null && calc.totalStoppageMin > limit) {
    errors.stoppageTotal = `Total stoppage is ${calc.totalStoppageMin} min but only ${limit} min is allowed (Planned Operator Shift − Machine Shift)`;
  }
  if (num(v.otherMin) > 0 && blank(v.otherMinRemark)) {
    errors.otherMinRemark = "Remark is required when Others downtime is entered";
  }
  return errors;
};

// The first field with an error, in form order — { index, field } — or null.
export const firstRivetError = (errorsList) => {
  for (let index = 0; index < errorsList.length; index += 1) {
    const errors = errorsList[index] || {};
    const field = RIVET_FIELD_ORDER.find((k) => errors[k]) || Object.keys(errors)[0];
    if (field) return { index, field };
  }
  return null;
};
