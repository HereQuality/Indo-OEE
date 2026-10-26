import { FORMULAS } from "./sheetFormulas";
import { WORKING_STATUSES, dayCalc, rowCalc } from "./productionSheet";

/**
 * utils/springSheet.js
 * ───────────────────────
 * The Spring Data Entry sheet's figures — the plain CNC sheet's own formulas
 * (utils/productionSheet.js), unchanged. A Spring part has no named
 * operation breakdown: its Total Cycle Time (set in Production › Parts) only
 * prefills the entry, which keeps its own editable figure — the same part
 * really does run at a different cycle on different days.
 */

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as Spring if it is named so, which is what it will be linked as.
export const isSpringProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/spring-data-entry\/?$/.test(page);
  return /\bspring\b/i.test(process?.processName || "");
};

// Every Working Status but PRESENT is a day the machine didn't produce — such
// an entry is status-only: no part, times or quantities. Keep in step with
// NON_WORKING_STATUSES in server/models/SpringEntry.js.
export const NON_WORKING_STATUSES = WORKING_STATUSES.filter((s) => s !== "PRESENT");
export const isStatusOnly = (v) => NON_WORKING_STATUSES.includes(String(v?.workingStatus ?? "").trim());

// Effective Machine Run Time here counts every piece run — OK + Rejected — as
// this sheet's own rule does (the other sheets count OK only); see rowCalc.
const withBasis = (row) => (row ? { ...row, runQtyBasis: "total" } : row);
export const springRowCalc = (row) => rowCalc(withBasis(row));
export const springDayCalc = (rows) => dayCalc((rows || []).map(withBasis));

// The formula popovers for the Spring table's calculated headers — the CNC
// ones, with the one that reads differently here (no operation breakdown).
export const SPRING_FORMULAS = {
  ...FORMULAS,
  effective: "Effective Machine Run Time = (OK Qty + Rejected Qty) × Standard Time per Piece ÷ 3600 — every piece run counts on this sheet.",
  cycle: "Standard Time per Piece = this entry's own time per piece — filled in from the Part when picked, and can be changed for the day.",
  idealQty:
    "Ideal Quantity = FLOOR(Machine Shift Time × 3600 ÷ Standard Time per Piece) — the most the shift could make, so OK + Rejected can't be more than this.",
  performance:
    "Performance = Standard Time per Piece × (OK + Rejected) ÷ Operating Time, for this entry — how fast it ran against its ideal speed. Above 100% (red) sends the entry to Admin review: usually a wrong time per piece, quantity or stoppage.",
  rejectedQty: "Rejected Quantity = Actual Quantity − OK Quantity, so OK + Rejected = Actual. The breakdown shows how that total splits across the reasons entered on the form.",
};
