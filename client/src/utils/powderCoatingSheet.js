import { FORMULAS } from "./sheetFormulas";
import { WORKING_STATUSES, dayCalc, rowCalc } from "./productionSheet";

/**
 * utils/powderCoatingSheet.js
 * ──────────────────────────────
 * The After Powder Coating inspection sheet's figures — the CNC sheet's own
 * formulas (utils/productionSheet.js), fed this sheet's fields:
 *   Inspection Start / End Time   → machineOnTime / machineOffTime
 *   Inspection Working Hours      → Machine Shift Time
 *   Standard Inspection Time / pc → totalCycleSec
 *   TOTAL QTY (typed)             → actualQty
 *   Total Defect / Rework         → the four defect counts added up
 *   OK QTY                        → Total Qty − Total Defect / Rework
 *   Ideal Inspection Time (hr)    → Effective Run Time, on Total Qty (every
 *                                   piece inspected counts, defects included)
 * plus the two Productivity figures dayCalc works out per worker per date.
 * There's no machine: each row's `machine` is its worker's id (the API sets
 * it), so the shared table and day formulas group by worker.
 */

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as After Powder Coating if it is named so.
export const isPowderCoatingProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/powder-coating-data-entry\/?$/.test(page);
  // BEFORE POWDER COATING is a different process (utils/bpcSheet.js).
  const name = process?.processName || "";
  return /powder\s*coating/i.test(name) && !/before\s*powder/i.test(name);
};

// Every Working Status but PRESENT is a day the worker didn't inspect — such an
// entry is status-only. Keep in step with server/models/PowderCoatingEntry.js.
export const NON_WORKING_STATUSES = WORKING_STATUSES.filter((s) => s !== "PRESENT");
export const isStatusOnly = (v) => NON_WORKING_STATUSES.includes(String(v?.workingStatus ?? "").trim());

// The sheet's Types of defect / rework, in its own order — keep in step with
// DEFECT_KEYS in server/models/PowderCoatingEntry.js.
export const DEFECT_FIELDS = [
  { key: "lessCoatingQty", label: "Less Powder Coating" },
  { key: "dotsQty", label: "Dots" },
  { key: "missCoatingQty", label: "Miss Powder Coating" },
  { key: "otherDefectQty", label: "Other" },
];
// Idle Time on this sheet: Lunch / Tea / Washroom and Other only.
export const POWDER_IDLE_FIELDS = [
  { key: "lunchMin", label: "Lunch / Tea / Washroom etc (min)" },
  { key: "otherMin", label: "Other (min)" },
];

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);

// Total Defect / Rework — the four counts added up (blank ones as 0); null
// while none is typed and there's no Total Qty either.
export const defectTotal = (row) => {
  const typed = DEFECT_FIELDS.map((f) => num(row?.[f.key])).filter(isNum);
  if (!typed.length && !isNum(num(row?.actualQty))) return null;
  return typed.reduce((a, b) => a + b, 0);
};

// A row as the shared formulas read it: OK / Rejected from Total Qty and the
// defect counts (what the server stores too), Effective Run Time on Total Qty.
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

export const powderRowCalc = (row) => {
  const calc = rowCalc(withDerived(row));
  const total = num(row?.actualQty);
  const defects = defectTotal(row);
  return { ...calc, totalDefect: defects, okQty: isNum(total) ? total - defects : null };
};
export const powderDayCalc = (rows) => dayCalc((rows || []).map(withDerived));

// The formula popovers for this table's calculated headers.
export const POWDER_FORMULAS = {
  ...FORMULAS,
  shift: "Inspection Working Hours = Inspection End Time − Inspection Start Time",
  cycle: "Standard Inspection Time per Piece — filled in from the Part when picked, and can be changed for the day.",
  idealQty: "Ideal Inspection Quantity = Inspection Working Hours × 3600 ÷ Standard Inspection Time per Piece, rounded down.",
  idealQtyPerHour: "Ideal Inspection Quantity / Hour = Ideal Inspection Quantity ÷ Inspection Working Hours",
  totalDefect: "Total Defect / Rework = Less Powder Coating + Dots + Miss Powder Coating + Other",
  okQty: "OK Qty = Total Qty − Total Defect / Rework",
  totalStoppage: "Total Idle Time = Lunch / Tea / Washroom + Other",
  effective: "Ideal Inspection Time (hr) = Total Qty × Standard Inspection Time per Piece ÷ 3600 — every piece inspected counts.",
  unreported:
    "Unreported Time (min) = Planned Operator Shift − Ideal Inspection Time − Other Activity − Total Idle Time, combined across every entry of this worker's date.",
  productivity:
    "Productivity without considering Lunch, Tea, etc. = Ideal Inspection Time ÷ (Planned Operator Shift − Other Activity), combined across every entry of this worker's date.",
  productivityLunch:
    "Productivity considering Lunch, Tea, etc. = Ideal Inspection Time ÷ (Planned Operator Shift − Other Activity − Lunch / Tea), combined across every entry of this worker's date.",
  quality: "Quality = OK Qty ÷ Total Qty, for this entry.",
  availability:
    "Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Inspection Working Hours − Total Idle Time − Other Activity; Planned Production Time = Planned Operator Shift − Lunch / Tea. Above 100% (red) sends the entry to Admin review.",
  performance:
    "Performance = Standard Inspection Time per Piece × Total Qty ÷ Operating Time, for this entry — how fast the inspection went against the standard time. Above 100% (red) sends the entry to Admin review: usually a wrong time per piece, quantity or idle time.",
};
