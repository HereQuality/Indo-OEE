import { FORMULAS } from "./sheetFormulas";
import { dayCalc, rowCalc } from "./productionSheet";

/**
 * utils/rivetSheet.js
 * ─────────────────────
 * The RIVET Data Entry sheet's figures. Checked against two real rows: Loading/
 * Process/Unloading and Cleaning/Other Operations were blank on both — RIVET
 * doesn't build its cycle time up from those the way SPM does. Total Cycle
 * Time is just typed directly on the entry (`totalCycleSec`), same as CNC's
 * own cycle time, so rowCalc/dayCalc in utils/productionSheet.js already read
 * it exactly as they need to — no adapter required here, unlike VMC/SPM.
 *
 * No. of Holes in One Piece is typed and shown on the sheet, but nobody has
 * given us the rule connecting it to Ideal Quantity (or anything else) yet —
 * it stays a display-only reference figure until that's confirmed against
 * real data.
 */

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as RIVET if it is named so, which is what it will be linked as.
export const isRivetProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/rivet-data-entry\/?$/.test(page);
  return /\brivet\b/i.test(process?.processName || "");
};

export const rivetRowCalc = (row) => rowCalc(row);

// One result per row of one machine's one date, same order and meaning as dayCalc.
export const rivetDayCalc = (rows) => dayCalc(rows || []);

// The formula popovers for the RIVET table's calculated headers: the CNC ones, with
// the two that read differently here.
export const RIVET_FORMULAS = (() => {
  const { rejectedQty: _typedHere, ...shared } = FORMULAS;
  return {
    ...shared,
    cycle: "Total Cycle Time is typed directly for this entry.",
  };
})();
