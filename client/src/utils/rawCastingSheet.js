import { FORMULAS } from "./sheetFormulas";
import { WORKING_STATUSES, entryDayCalc, rowCalc } from "./productionSheet";

/**
 * utils/rawCastingSheet.js
 * ──────────────────────────
 * The RAW CASTING inspection sheet's figures (sheet key "rawCasting" — its own
 * process, on AFTER POWDER COATING's template, utils/powderCoatingSheet.js).
 * Kept per WORKER: each row's `machine` is its worker's id (the API sets it),
 * so the shared table and day formulas group by worker. The CNC sheet's own
 * formulas (utils/productionSheet.js), fed this sheet's fields:
 *   Inspection Start / End Time        → machineOnTime / machineOffTime
 *   Inspection Working Hours           = End − Start
 *   Standard Inspection Time / pc      → totalCycleSec (prefilled from the Part)
 *   TOTAL QTY (typed)                  → actualQty
 *   Types of Defects                   → rejectBreakdown over RAW_CASTING_DEFECTS
 *   Total Defects                      = the three added up
 *   OK QTY                             = TOTAL − Total Defects
 *   Ideal Inspection Quantity          = Hours × 3600 ÷ Std — NOT floored (2 decimals)
 *   Ideal Inspection Quantity/Hour     = 3600 ÷ Std
 *   Ideal Inspection Time (hr)         = TOTAL × Std ÷ 3600 (runQtyBasis "total")
 *   Unreported Time                    = Planned×60 − Ideal Insp. Time×60 − Other Activity − Total Idle
 *   Productivity without Lunch, tea    = Ideal Insp. Time ÷ (Planned − Other Activity ÷ 60)
 *   Productivity considering Lunch     = Ideal Insp. Time ÷ (Planned − Other Activity ÷ 60 − Lunch ÷ 60)
 * ("Other" idle time doesn't lower either Productivity.) The paper has no
 * Planned column: each of its rows works on its own Working Hours, so every
 * entry's Unreported / Productivity is its own (entryDayCalc) — typed Planned =
 * the Working Hours reproduces all 17 paper rows exactly
 * (utils/rawCastingSheet.test.mjs); a day on Process Master's lock is combined
 * once, as on every other sheet.
 */

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as RAW CASTING if it is named so — no other process's name matches.
export const isRawCastingProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/raw-casting-data-entry\/?$/.test(page);
  return /\braw\s*casting\b/i.test(process?.processName || "");
};

// Every Working Status but PRESENT is a day the worker didn't inspect — such an
// entry is status-only. Keep in step with server/models/RawCastingEntry.js.
export const NON_WORKING_STATUSES = WORKING_STATUSES.filter((s) => s !== "PRESENT");
export const isStatusOnly = (v) => NON_WORKING_STATUSES.includes(String(v?.workingStatus ?? "").trim());

// The sheet's Types of Defects, in its own order — kept as the entry's
// Rejection Master split (rejectBreakdown), which is what the dashboard's
// Rejection by Reason reads. Keep in step with RAW_CASTING_DEFECTS in
// server/models/RawCastingEntry.js.
export const RAW_CASTING_DEFECTS = ["Blow Holes Casting", "Crack/Damage Casting", "Other"];

// Idle Time on this sheet: Lunch / Tea / Washroom and Other only.
export const RAW_CASTING_IDLE_FIELDS = [
  { key: "lunchMin", label: "Lunch / Tea / Washroom etc (Min)" },
  { key: "otherMin", label: "Other (Min)" },
];

// One worker takes up to this many entries on a date. Keep in step with
// MAX_SLOTS in server/models/RawCastingEntry.js.
export const RAW_CASTING_MAX_ENTRIES_PER_DAY = 8;

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && v !== undefined && Number.isFinite(v);

// Total Defects — the three counts added up (blank ones as 0); null while none
// is typed and there's no TOTAL QTY either.
export const defectTotal = (row) => {
  const typed = RAW_CASTING_DEFECTS.map((d) => num(row?.rejectBreakdown?.[d])).filter(isNum);
  if (!typed.length && !isNum(num(row?.actualQty))) return null;
  return typed.reduce((a, b) => a + b, 0);
};

// A row as the shared formulas read it: OK / Rejected from TOTAL QTY and the
// defect counts (what the server stores too), Ideal Inspection Time on TOTAL QTY.
const withDerived = (row) => {
  if (!row) return row;
  const total = num(row.actualQty);
  const defects = defectTotal(row);
  return {
    ...row,
    runQtyBasis: "total",
    ...(isNum(total) ? { rejectedQty: defects, okQty: total - defects } : {}),
  };
};

// rowCalc's figures, with this sheet's own Ideal Inspection Quantity: not
// floored (the paper shows 871.88), and Ideal Inspection Quantity/Hour =
// 3600 ÷ Standard Inspection Time. idealQtyFloor is the whole pieces the
// working hours allow.
export const rawCastingRowCalc = (row) => {
  const c = rowCalc(withDerived(row));
  if (!row) return c;
  const cycle = c.totalCycleSec;
  const hasCycle = isNum(cycle) && cycle > 0;
  const idealQty = hasCycle && isNum(c.shiftHours) ? (c.shiftHours * 3600) / cycle : null;
  const total = num(row.actualQty);
  const defects = defectTotal(row);
  return {
    ...c,
    idealQty,
    idealQtyFloor: isNum(idealQty) ? Math.floor(idealQty + 1e-9) : null,
    idealQtyPerHour: hasCycle ? 3600 / cycle : null,
    totalDefect: defects,
    okQty: isNum(total) ? total - defects : null,
  };
};

// Unreported Time and the two Productivity figures, one result per row in
// sortByMachineOn order: each entry on its own, as on the paper (combined once
// for a day on Process Master's lock).
export const rawCastingDayCalc = (rows) => entryDayCalc((rows || []).map(withDerived));

// The formula popovers for this table's calculated headers.
export const RAW_CASTING_FORMULAS = {
  ...FORMULAS,
  shift: "Inspection Working Hours = Inspection End Time − Inspection Start Time",
  cycle: "Standard Inspection Time per Piece — filled in from the Part when picked, and can be changed for the day.",
  idealQty: "Ideal Inspection Quantity = Inspection Working Hours × 3600 ÷ Standard Inspection Time per Piece — not rounded down, as on the sheet.",
  idealQtyPerHour: "Ideal Inspection Quantity/Hour = 3600 ÷ Standard Inspection Time per Piece",
  totalDefect: "Total Defects = Blow Holes Casting + Crack/Damage Casting + Other",
  okQty: "OK QTY = TOTAL QTY − Total Defects",
  totalStoppage: "Total Idle Time (Min) = Lunch / Tea / Washroom + Other",
  effective: "Ideal Inspection Time (hours) = TOTAL QTY × Standard Inspection Time per Piece ÷ 3600 — every piece inspected counts.",
  unreported:
    "Unreported Time (min) = Planned Operator Shift × 60 − Ideal Inspection Time × 60 − Time in Other Activity − Total Idle Time, for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  productivity:
    "Productivity without considering Lunch, tea, etc. = Ideal Inspection Time ÷ (Planned Operator Shift − Other Activity ÷ 60), for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  productivityLunch:
    "Productivity considering Lunch, tea, etc. = Ideal Inspection Time ÷ (Planned Operator Shift − Other Activity ÷ 60 − Lunch / Tea ÷ 60), for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  quality: "Quality = OK QTY ÷ TOTAL QTY, for this entry.",
  availability:
    "Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Inspection Working Hours − Total Idle Time − Other Activity; Planned Production Time = Planned Operator Shift − Lunch / Tea. Above 100% (red) sends the entry to Admin review.",
  performance:
    "Performance = Standard Inspection Time per Piece × TOTAL QTY ÷ Operating Time, for this entry — how fast the inspection went against the standard time. Above 100% (red) sends the entry to Admin review: usually a wrong time per piece, quantity or idle time.",
};
