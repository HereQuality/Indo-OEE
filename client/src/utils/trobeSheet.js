import { FORMULAS } from "./sheetFormulas";
import { WORKING_STATUSES, dayCalc, rowCalc } from "./productionSheet";

/**
 * utils/trobeSheet.js
 * ───────────────────────
 * The Trobe Data Entry sheet's figures — the plain CNC sheet's own formulas
 * (utils/productionSheet.js), unchanged. A Trobe part has no named
 * operation breakdown: its Total Cycle Time (set in Production › Parts) only
 * prefills the entry, which keeps its own editable figure — the same part
 * really does run at a different cycle on different days.
 */

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as Trobe if it is named so, which is what it will be linked as.
export const isTrobeProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/trobe-data-entry\/?$/.test(page);
  return /\btrobe\b/i.test(process?.processName || "");
};

// Every Working Status but PRESENT is a day the machine didn't produce — such
// an entry is status-only: no part, times or quantities. Keep in step with
// NON_WORKING_STATUSES in server/models/TrobeEntry.js.
export const NON_WORKING_STATUSES = WORKING_STATUSES.filter((s) => s !== "PRESENT");
export const isStatusOnly = (v) => NON_WORKING_STATUSES.includes(String(v?.workingStatus ?? "").trim());

export const trobeRowCalc = rowCalc;
export const trobeDayCalc = dayCalc;

// The formula popovers for the Trobe table's calculated headers — the CNC
// ones, with the one that reads differently here (no operation breakdown).
export const TROBE_FORMULAS = {
  ...FORMULAS,
  cycle: "Total Cycle Time = this entry's own cycle time — filled in from the Part when picked, and can be changed for the day.",
  rejectedQty: "Rejected Quantity is typed on the form for this entry — it isn't worked out from the other figures.",
  idealQty:
    "Ideal Quantity = FLOOR(Machine Shift Time × 3600 ÷ Total Cycle Time) — the most the shift could make, so OK + Rejected Quantity can't be more than this.",
};
