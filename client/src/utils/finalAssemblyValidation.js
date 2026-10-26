import { isNonWorking, normalizeTime, spanMinutes } from "./productionSheet";
import { cleanSplit, stoppageLimitMin, timesUnchanged } from "./entryValidation";
import { FA_LABELS, defectTotal, faRowCalc, isStatusOnly } from "./finalAssemblySheet";
import { hoursToHm, parseShiftHours } from "./shiftHours";

/**
 * utils/finalAssemblyValidation.js
 * ──────────────────────────────────
 * Every rule the FINAL ASSEMBLY form enforces — AFTER POWDER COATING's rules
 * (utils/powderCoatingValidation.js) over this sheet's own fields, with three
 * of its own:
 *
 *   Status-only Any Working Status but PRESENT, or Non Working: only Date and
 *               Worker Name — nothing else is asked for.
 *   Required    Date, Worker Name, Item Name, Start / End Time, Total QTY,
 *               Planned Operator Shift (decimal hours, not less than the
 *               Working Hours; fixed by Process Master while locked).
 *   Optional    Standard Time per Piece (PACKING has none — then Ideal is
 *               blank, Effective 0 and Productivity 0%); a typed one is > 0.
 *   Quantities  The Types of Defects are optional (blank = 0) and together
 *               can't be more than Total QTY; "Other" needs a remark. Total
 *               QTY MAY be more than Ideal (the paper has 154%) — such an entry
 *               goes to OEE Review.
 *   Times       End after Start. Overlapping times ARE allowed for one worker
 *               (several jobs at once), so there's no overlap rule; up to
 *               FA_MAX_ENTRIES_PER_DAY a date (slotsFullErrors, on the page).
 *   Idle / Other Activity  Optional, 0–1440 each; Lunch + Other idle + Other
 *               Activity within the Working Hours. "Other" idle needs a remark,
 *               Other Activity minutes need what the activity was.
 *
 * The server re-checks these (server/controllers/finalAssemblySheet.controller.js
 * — entryRuleError); keep the two in step.
 */

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const blank = (v) => v === "" || v === null || v === undefined || String(v).trim() === "";

export const FA_MINUTE_KEYS = ["otherActivityMin", "lunchMin", "otherMin"];

// Top to bottom, the way the form reads — the first key with an error is where Save scrolls to.
export const FA_FIELD_ORDER = [
  "date",
  "machine",
  "workingStatus",
  "itemName",
  "vendor",
  "totalCycleSec",
  "machineOnTime",
  "machineOffTime",
  "actualQty",
  "rejectBreakdown",
  "rejectOtherRemark",
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
export const validateFinalAssemblyEntry = (v, { saved = null } = {}) => {
  const errors = {};
  const calc = faRowCalc(v);

  if (blank(v.date)) errors.date = "Date is required";
  if (blank(v.machine)) errors.machine = `${FA_LABELS.worker} is required`;
  // ABSENT, SUNDAY, … or Non Working — a day with no work records just its status.
  if (isStatusOnly(v) || isNonWorking(v)) return errors;

  if (blank(v.itemName)) errors.itemName = `${FA_LABELS.itemName} is required`;
  // Optional — PACKING has none.
  const cycle = num(v.totalCycleSec);
  if (!blank(v.totalCycleSec) && (!isNum(cycle) || cycle <= 0)) errors.totalCycleSec = "Must be more than 0 — or leave it blank";

  for (const [key, label] of [
    ["machineOnTime", FA_LABELS.start],
    ["machineOffTime", FA_LABELS.end],
  ]) {
    if (blank(v[key])) errors[key] = `${label} is required`;
    else if (!normalizeTime(v[key])) errors[key] = "Enter a valid time";
  }
  if (!errors.machineOnTime && !errors.machineOffTime && !timesUnchanged(v, saved)) {
    const on = clock(v.machineOnTime);
    const off = clock(v.machineOffTime);
    if (on !== null && off !== null && off <= on) errors.machineOffTime = `${FA_LABELS.end} must be after ${FA_LABELS.start}`;
  }

  // Total QTY is typed; the defects are optional and come out of it.
  const total = num(v.actualQty);
  if (blank(v.actualQty)) errors.actualQty = `${FA_LABELS.totalQty} is required`;
  else if (!isNum(total) || total < 0 || !Number.isInteger(total)) errors.actualQty = "Must be a whole number, 0 or more";
  if (Object.values(v.rejectBreakdown || {}).some((n) => !blank(n) && (!Number.isInteger(Number(n)) || Number(n) < 0))) {
    errors.rejectBreakdown = "Defects must be whole numbers, 0 or more";
  } else {
    const defects = defectTotal(v) || 0;
    if (!errors.actualQty && defects > total) {
      errors.rejectBreakdown = `${FA_LABELS.totalDefects} (${defects}) can't be more than ${FA_LABELS.totalQty} (${total})`;
    }
  }
  if (cleanSplit(v.rejectBreakdown).Other > 0 && blank(v.rejectOtherRemark)) {
    errors.rejectOtherRemark = 'Remark is required when "Other" defects are entered';
  }

  // Planned Operator Shift is typed as decimal hours (5.33 = 5 h 20 min).
  const planned = parseShiftHours(v.plannedOperatorShiftHours).hours;
  if (blank(v.plannedOperatorShiftHours)) errors.plannedOperatorShiftHours = "Planned Operator Shift is required";
  else if (planned === null) errors.plannedOperatorShiftHours = "Enter hours like 8.5 or 1.00";
  else if (planned <= 0 || planned > 24) errors.plannedOperatorShiftHours = "Must be more than 0:00 and at most 24:00";
  else {
    // Not while End isn't after Start: the span would wrap past midnight.
    const shiftMin = errors.machineOffTime ? null : spanMinutes(v.machineOnTime, v.machineOffTime);
    if (shiftMin !== null && Math.round(planned * 60) < shiftMin) {
      errors.plannedOperatorShiftHours = `Planned Operator Shift can't be less than the ${FA_LABELS.hours} (${hoursToHm(shiftMin / 60)})`;
    }
  }

  // Idle Time and Other Activity are optional, like every downtime box: blank counts as 0.
  for (const key of FA_MINUTE_KEYS) {
    const n = num(v[key]);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1440)) errors[key] = "0–1440";
  }
  const limit = stoppageLimitMin(v);
  const away = (calc.totalStoppageMin || 0) + (num(v.otherActivityMin) || 0);
  if (limit !== null && away > limit) {
    errors.stoppageTotal = `Idle Time + Other Activity is ${away} min but the ${FA_LABELS.hours} are only ${limit} min`;
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
export const firstFinalAssemblyError = (errorsList) => {
  for (let index = 0; index < errorsList.length; index += 1) {
    const errors = errorsList[index] || {};
    const field = FA_FIELD_ORDER.find((k) => errors[k]) || Object.keys(errors)[0];
    if (field) return { index, field };
  }
  return null;
};
