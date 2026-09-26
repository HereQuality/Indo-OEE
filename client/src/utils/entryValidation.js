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
 *   Quantities  Actual ≤ Ideal, OK ≤ Actual, and the Rejection Master split has
 *               to account for every rejected piece (Rejected = Actual − OK).
 *   Times       Machine OFF Time must be after Machine ON Time, and one machine's
 *               entries on a date can't overlap in time (see overlapErrors).
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

// ── Machine ON/OFF times ───────────────────────────────────────────────────
// Two rules, both also enforced by the server (saveRow): OFF comes after ON
// (a shift through midnight is two entries, one per date), and one machine's
// entries on a date never overlap in time. Keep in step with
// server/utils/machineTimes.js and the phone app's production_entry_validation.dart.

const clock = (t) => {
  const n = normalizeTime(t);
  return n ? Number(n.slice(0, 2)) * 60 + Number(n.slice(3)) : null;
};

// 0..1439 (or a next-day stretch beyond it) → "8:05 AM".
export const fmt12 = (minutes) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

// The stretch of the day an entry occupies — { start, end } in minutes — or
// null when a time is missing. Rows saved before "OFF after ON" may run through
// midnight (OFF <= ON); they are stretched into the next day so they still
// block the late hours they really covered.
export const timeInterval = (on, off) => {
  const start = clock(on);
  const end = clock(off);
  if (start === null || end === null) return null;
  return { start, end: end > start ? end : end + 1440 };
};

// Touching is fine: one entry ending at 16:00 and the next starting at 16:00.
const intervalsOverlap = (a, b) => a.start < b.end && b.start < a.end;

const intervalText = (i) => `${fmt12(i.start)} – ${fmt12(i.end)}`;

// The two time rules speak up as soon as the times are picked, not only after
// Save is pressed like the other messages ("is required" and the like).
export const isTimeRuleMessage = (message) =>
  typeof message === "string" && (message.startsWith("Machine OFF Time must be after") || message.includes("overlaps another entry"));

// Only when a row's times are set or changed do the two rules apply — an
// older row that already breaks them stays editable. `saved` is the row's
// { machineOnTime, machineOffTime } as it was loaded (edit mode), else null.
const timesUnchanged = (v, saved) =>
  !!saved &&
  normalizeTime(v.machineOnTime) === normalizeTime(saved.machineOnTime) &&
  normalizeTime(v.machineOffTime) === normalizeTime(saved.machineOffTime);

// What the machine already has on this entry's date, as readable ranges, for the
// "already booked" hint. `occupied` maps "machine|date" → [{ slot, machineOnTime,
// machineOffTime }] (the server's saved entries); `editSlot` is the slot of the
// row being edited, which is not "another" entry.
export const bookedRanges = (v, occupied = {}, editSlot = null) =>
  (occupied[`${v.machine}|${v.date}`] || [])
    .filter((o) => o.slot !== editSlot)
    .map((o) => timeInterval(o.machineOnTime, o.machineOffTime))
    .filter(Boolean)
    .map(intervalText);

// Overlap problems for every block: { [machineOnTime | machineOffTime]: message }.
// Each block is checked against the machine's saved entries on its date AND
// against the other blocks of the same form (same machine, same date).
export const overlapErrors = (entries, occupied = {}, { editSlot = null, saved = null } = {}) =>
  entries.map((v, i) => {
    const mine = timeInterval(v.machineOnTime, v.machineOffTime);
    if (!mine || blank(v.machine) || blank(v.date) || timesUnchanged(v, saved)) return {};
    const others = [
      ...(occupied[`${v.machine}|${v.date}`] || []).filter((o) => o.slot !== editSlot),
      ...entries.filter((o, j) => j !== i && o.machine === v.machine && o.date === v.date),
    ]
      .map((o) => timeInterval(o.machineOnTime, o.machineOffTime))
      .filter(Boolean);
    const hit = others.find((o) => intervalsOverlap(mine, o));
    if (!hit) return {};
    // Point at the box to change: the start if it lands inside the other
    // entry, otherwise the end that runs into it.
    const startInside = mine.start >= hit.start && mine.start < hit.end;
    return {
      [startInside ? "machineOnTime" : "machineOffTime"]:
        `${startInside ? "Machine ON Time" : "Machine OFF Time"} overlaps another entry for this machine on this date (${intervalText(hit)})`,
    };
  });

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

// The Rejection Master boxes as clean numbers: blanks dropped, the rest > 0.
export const cleanSplit = (split) =>
  Object.fromEntries(
    Object.entries(split || {})
      .map(([reason, v]) => [reason, blank(v) ? 0 : Number(v)])
      .filter(([, n]) => Number.isFinite(n) && n > 0),
  );

// One block's values → { fieldKey: message }. Empty object = ready to save.
// `saved` (edit mode) is the row's times as loaded — see timesUnchanged.
export const validateEntry = (v, { saved = null } = {}) => {
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
  // The machine runs within one day: OFF must come after ON.
  if (!errors.machineOnTime && !errors.machineOffTime && !timesUnchanged(v, saved)) {
    const on = clock(v.machineOnTime);
    const off = clock(v.machineOffTime);
    if (on !== null && off !== null && off <= on) errors.machineOffTime = "Machine OFF Time must be after Machine ON Time";
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

