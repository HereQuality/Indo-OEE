import { isNonWorking, normalizeTime, spanMinutes } from "./productionSheet";
import { stoppageLimitMin, timesUnchanged } from "./entryValidation";
import { RAW_CASTING_DEFECTS, defectTotal, isStatusOnly, rawCastingRowCalc } from "./rawCastingSheet";
import { hoursToHm, parseShiftHours } from "./shiftHours";

/**
 * utils/rawCastingValidation.js
 * ───────────────────────────────
 * Every rule the RAW CASTING form enforces — AFTER POWDER COATING's rules
 * (utils/powderCoatingValidation.js) over this sheet's own fields:
 *
 *   Status-only Any Working Status but PRESENT (ABSENT, SUNDAY, …), or Non
 *               Working: only Date and Worker Name — nothing else is asked for.
 *   Required    Date, Worker Name, Item Name, Standard Inspection Time per
 *               Piece (> 0), Inspection Start / End Time, TOTAL QTY, Planned
 *               Operator Shift (typed as decimal hours like the sheet, not less
 *               than the Inspection Working Hours; fixed by Process Master while
 *               locked).
 *   Optional    Vendor Name, Challan No. (the sheet's own rows often leave them blank).
 *   Quantities  TOTAL QTY and the three Types of Defects are whole numbers, 0
 *               or more; the defects are optional (blank counts as 0) and
 *               together can't be more than TOTAL QTY. OK QTY = TOTAL − Total
 *               Defects. TOTAL MAY be more than Ideal Inspection Quantity — a
 *               person can beat the standard time — and such an entry goes to
 *               OEE Review (Performance > 100%).
 *   Times       Inspection End after Start. One worker's entries on a date MAY
 *               overlap (the paper has MANJU 10:10–16:30 and 16:10–18:50).
 *   Idle / Other Activity  Optional, 0–1440 each; Lunch + Other idle + Other
 *               Activity within the Inspection Working Hours. "Other" idle needs
 *               a remark, Other Activity minutes need what the activity was.
 *
 * The server re-checks these (server/controllers/rawCastingSheet.controller.js
 * — entryRuleError); keep the two in step.
 */

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const blank = (v) => v === "" || v === null || v === undefined || String(v).trim() === "";

export const RAW_CASTING_MINUTE_KEYS = ["otherActivityMin", "lunchMin", "otherMin"];

// Top to bottom, the way the form reads — the first key with an error is where Save scrolls to.
export const RAW_CASTING_FIELD_ORDER = [
  "date",
  "machine",
  "workingStatus",
  "itemName",
  "vendor",
  "challanNo",
  "totalCycleSec",
  "machineOnTime",
  "machineOffTime",
  "actualQty",
  "rejectBreakdown",
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
export const validateRawCastingEntry = (v, { saved = null } = {}) => {
  const errors = {};
  const calc = rawCastingRowCalc(v);

  if (blank(v.date)) errors.date = "Date is required";
  if (blank(v.machine)) errors.machine = "Worker Name is required";
  // ABSENT, SUNDAY, … or Non Working — a day with no inspection records just its status.
  if (isStatusOnly(v) || isNonWorking(v)) return errors;

  if (blank(v.itemName)) errors.itemName = "Item Name is required";
  const cycle = num(v.totalCycleSec);
  if (blank(v.totalCycleSec)) errors.totalCycleSec = "Standard Inspection Time per Piece is required";
  else if (!isNum(cycle) || cycle <= 0) errors.totalCycleSec = "Must be more than 0";

  for (const [key, label] of [
    ["machineOnTime", "Inspection Start Time"],
    ["machineOffTime", "Inspection End Time"],
  ]) {
    if (blank(v[key])) errors[key] = `${label} is required`;
    else if (!normalizeTime(v[key])) errors[key] = "Enter a valid time";
  }
  if (!errors.machineOnTime && !errors.machineOffTime && !timesUnchanged(v, saved)) {
    const on = clock(v.machineOnTime);
    const off = clock(v.machineOffTime);
    if (on !== null && off !== null && off <= on) errors.machineOffTime = "Inspection End Time must be after Inspection Start Time";
  }

  // TOTAL QTY is typed; the defect counts are optional and come out of it.
  const total = num(v.actualQty);
  if (blank(v.actualQty)) errors.actualQty = "TOTAL QTY is required";
  else if (!isNum(total) || total < 0 || !Number.isInteger(total)) errors.actualQty = "Must be a whole number, 0 or more";
  if (RAW_CASTING_DEFECTS.some((d) => {
    const n = num(v.rejectBreakdown?.[d]);
    return n !== null && (!isNum(n) || n < 0 || !Number.isInteger(n));
  })) {
    errors.rejectBreakdown = "Defects must be whole numbers, 0 or more";
  }
  const defects = defectTotal(v) || 0;
  if (!errors.actualQty && !errors.rejectBreakdown && defects > total) {
    errors.rejectBreakdown = `Total Defects (${defects}) can't be more than TOTAL QTY (${total})`;
  }

  // Planned Operator Shift is typed as decimal hours like the sheet (5.33 = 5 h 20 min).
  const planned = parseShiftHours(v.plannedOperatorShiftHours).hours;
  if (blank(v.plannedOperatorShiftHours)) errors.plannedOperatorShiftHours = "Planned Operator Shift is required";
  else if (planned === null) errors.plannedOperatorShiftHours = "Enter hours as on the sheet, like 7.75 or 2.67";
  else if (planned <= 0 || planned > 24) errors.plannedOperatorShiftHours = "Must be more than 0:00 and at most 24:00";
  else {
    // Not while End isn't after Start: the span would wrap past midnight
    // (23 h and the like), and the End box already says what's wrong.
    const shiftMin = errors.machineOffTime ? null : spanMinutes(v.machineOnTime, v.machineOffTime);
    if (shiftMin !== null && Math.round(planned * 60) < shiftMin) {
      errors.plannedOperatorShiftHours = `Planned Operator Shift can't be less than the Inspection Working Hours (${hoursToHm(shiftMin / 60)})`;
    }
  }

  // Idle Time and Other Activity are optional, like every downtime box: blank counts as 0.
  for (const key of RAW_CASTING_MINUTE_KEYS) {
    const n = num(v[key]);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1440)) errors[key] = "0–1440";
  }
  const limit = stoppageLimitMin(v);
  const away = (calc.totalStoppageMin || 0) + (num(v.otherActivityMin) || 0);
  if (limit !== null && away > limit) {
    errors.stoppageTotal = `Idle Time + Other Activity is ${away} min but the Inspection Working Hours are only ${limit} min`;
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
export const firstRawCastingError = (errorsList) => {
  for (let index = 0; index < errorsList.length; index += 1) {
    const errors = errorsList[index] || {};
    const field = RAW_CASTING_FIELD_ORDER.find((k) => errors[k]) || Object.keys(errors)[0];
    if (field) return { index, field };
  }
  return null;
};
