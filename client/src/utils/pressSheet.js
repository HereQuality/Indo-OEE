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

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);

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
  const idealQty = Math.floor((shiftMin * pieces) / minutes);
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
