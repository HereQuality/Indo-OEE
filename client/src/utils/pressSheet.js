import { FORMULAS } from "./sheetFormulas";
import { dayCalc, rowCalc, spanMinutes } from "./productionSheet";

/**
 * utils/pressSheet.js
 * ─────────────────────
 * The PRESS Data Entry sheet's figures. Like the VMC sheet, PRESS works out its
 * cycle time from a standard time rather than a part's own Total Cycle Time:
 * Product Cycle Time = Standard Time Taken (min) × 60 ÷ No. Piece in Standard
 * Time. So this is a thin adapter: put that cycle time where the CNC formulas
 * expect it (`totalCycleSec`) and hand the row over to rowCalc / dayCalc in
 * productionSheet.js. Machine Shift, Effective Run Time, Setup Efficiency,
 * Unutilized/Unreported Time and the three OEE figures are therefore the very
 * same formulas on every sheet, and can't drift apart.
 */

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as PRESS if it is named so, which is what it will be linked as.
export const isPressProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/press-data-entry\/?$/.test(page);
  return /\bpress\b/i.test(process?.processName || "");
};

// A PRESS part's Operation choices — set once on the Part (Production ›
// Parts, required there), independent of the entry's own Operation box (same
// choices, same dropdown look). Kept in step with PRESS_OPERATIONS in
// server/models/Item.js and OPERATIONS in server/models/PressEntry.js.
export const PRESS_OPERATIONS = ["Bending", "Tapping", "Blank"];

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);

// Standard Time Taken and No. Piece in Standard Time, as the entry form's tick
// boxes offer them (copied from the Part, read-only — see PressEntryForm.jsx),
// the same look as VMC's own program checkboxes. Ticking them off is purely a
// per-entry note here — same reasoning as VMC_PROGRAM_FIELDS in
// utils/vmcSheet.js: these two multiply together to make one cycle time, so
// there's no honest partial result once either is unticked. Product Cycle
// Time keeps using both regardless of which are ticked, pending the user's
// own check with their senior (same open question as VMC's).
export const PRESS_PROGRAM_FIELDS = [
  { key: "standardTimeMin", label: "Standard Time Taken (min)" },
  { key: "pcsPerStandardTime", label: "No. Piece in Standard Time" },
];

// Product Cycle Time (sec) = Standard Time Taken (min) × 60 ÷ No. Piece in Standard Time; null until both are usable.
export const standardCycleSec = (row) => {
  const minutes = num(row?.standardTimeMin);
  const pieces = num(row?.pcsPerStandardTime);
  return isNum(minutes) && isNum(pieces) && pieces > 0 ? (minutes * 60) / pieces : null;
};

// The row as the shared formulas read it: its own cycle time in `totalCycleSec`.
const withCycle = (row) => ({ ...row, totalCycleSec: standardCycleSec(row) ?? "" });

export const pressRowCalc = (row) => {
  const calc = rowCalc(withCycle(row));
  // Ideal Quantity = FLOOR(Machine Shift (min) × pieces ÷ Standard Time (min)) — the same
  // figure as shift seconds ÷ cycle seconds, but from the whole numbers typed, so a
  // cycle time that doesn't divide evenly can't tip a floor over by 1.
  const shiftMin = spanMinutes(row?.machineOnTime, row?.machineOffTime);
  const minutes = num(row?.standardTimeMin);
  const pieces = num(row?.pcsPerStandardTime);
  if (shiftMin === null || !isNum(minutes) || minutes <= 0 || !isNum(pieces)) return calc;
  // Scaled to whole thousandths first so 180 min × 15 pcs ÷ 2.7 min is exactly 1000, not 999.99…
  const idealQty = Math.floor(Math.round(shiftMin * pieces * 1000) / Math.round(minutes * 1000));
  return { ...calc, idealQty, idealQtyPerHour: calc.shiftHours ? idealQty / calc.shiftHours : null };
};

// One result per row of one machine's one date, same order and meaning as dayCalc.
export const pressDayCalc = (rows) => dayCalc((rows || []).map(withCycle));

// The formula popovers for the PRESS table's calculated headers: the CNC ones, with
// the ones that read differently here.
export const PRESS_FORMULAS = (() => {
  const { rejectedQty: _typedHere, ...shared } = FORMULAS;
  return {
    ...shared,
    cycle: "Product Cycle Time = Standard Time Taken (min) × 60 ÷ No. Piece in Standard Time.",
    idealQty:
      "Ideal Quantity = FLOOR(Machine Shift Time (min) × No. Piece in Standard Time ÷ Standard Time Taken (min)) — the most the shift could make, so Actual OK + Rejected can't be more than this.",
  };
})();
