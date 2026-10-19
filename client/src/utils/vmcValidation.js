import { isNonWorking } from "./productionSheet";
import { normalizeTime, spanMinutes } from "./productionSheet";
import { stoppageLimitMin, withDecimalPlanned } from "./entryValidation";
import { vmcRowCalc } from "./vmcSheet";
import { hoursToHm, parseHm } from "./shiftHours";

/**
 * utils/vmcValidation.js
 * ────────────────────────
 * Every rule the VMC Data Entry form enforces, in one place — the CNC sheet's
 * rules (utils/entryValidation.js) over the VMC sheet's fields. The machine/
 * operator overlap checks and the stoppage allowance are the CNC ones, imported
 * as they are; what is VMC's own is below.
 *
 *   Required    Date, Machine No., Operator, Part Name (and that Part needs its
 *               own Program Time / No. of Piece In One Program set in Parts —
 *               see validateVmcEntry), Machine ON/OFF Time, Actual OK Quantity,
 *               Rejected Quantity, Planned Operator Shift (typed H.MM, not less
 *               than the Machine Shift).
 *   Quantities  OK + Rejected can't be more than Ideal Quantity.
 *   Times       Machine OFF after ON.
 *   Downtime    Optional (blank counts as 0), 0–1440 each, total within Planned
 *               Operator Shift − Machine Shift. "Others" needs a remark.
 *
 * The server re-checks these (server/controllers/vmcSheet.controller.js —
 * entryRuleError); keep the two in step.
 */

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const blank = (v) => v === "" || v === null || v === undefined || String(v).trim() === "";

// In the order the sheet lists them. Lunch / Rest has its own box beside
// Planned Operator Shift (see VMC_FIELD_ORDER) and isn't in this group, though
// it still counts toward the total (see rowCalc).
export const VMC_DOWNTIME_KEYS = [
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
export const VMC_FIELD_ORDER = [
  "date",
  "machine",
  "operator",
  "itemName",
  "machineOnTime",
  "machineOffTime",
  "okQty",
  "rejectedQty",
  "plannedOperatorShiftHours",
  "lunchMin",
  ...VMC_DOWNTIME_KEYS,
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
export const validateVmcEntry = (v, { saved = null } = {}) => {
  const errors = {};
  const calc = vmcRowCalc(v);

  if (blank(v.date)) errors.date = "Date is required";
  if (blank(v.machine)) errors.machine = "Machine No. is required";
  // Non Working: the machine did not run, so nothing else is asked for.
  if (isNonWorking(v)) return errors;
  if (blank(v.operator)) errors.operator = "Operator is required";
  if (blank(v.itemName)) errors.itemName = "Part Name is required";
  // Program Time / No. of Piece In One Program are set on the Part itself
  // (Production › Parts, required there for a VMC part) — if a part still
  // lacks them (an older one from before that requirement), there's no cycle
  // time to compute from, so Save can't go through until the Part is fixed.
  else if (!isNum(calc.totalCycleSec)) {
    errors.itemName = "This Part has no Program Time / No. of Piece In One Program set — edit it in Parts first";
  }

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

  for (const key of VMC_DOWNTIME_KEYS) {
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
export const firstVmcError = (errorsList) => {
  for (let index = 0; index < errorsList.length; index += 1) {
    const errors = errorsList[index] || {};
    const field = VMC_FIELD_ORDER.find((k) => errors[k]) || Object.keys(errors)[0];
    if (field) return { index, field };
  }
  return null;
};
