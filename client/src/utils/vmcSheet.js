import { FORMULAS } from "./sheetFormulas";
import { dayCalc, rowCalc, spanMinutes } from "./productionSheet";

/**
 * utils/vmcSheet.js
 * ───────────────────
 * The VMC Data Entry sheet's figures. The VMC sheet differs from the CNC one in
 * where its cycle time comes from, not in what it does with it: Product Cycle
 * Time is worked out from the program — Program Time (min) × 60 ÷ No. of Piece
 * In One Program — instead of being copied from the part. So these are thin
 * adapters: put that cycle time where the CNC formulas expect it
 * (`totalCycleSec`) and hand the row over to rowCalc / dayCalc in
 * productionSheet.js. Machine Shift, Effective Run Time, Setup Efficiency,
 * Unutilized/Unreported Time and the three OEE figures are therefore the very
 * same formulas on both sheets, and can't drift apart.
 */

// Why a machine did not run. Keep in step with MACHINE_NOT_RUN in
// server/models/VmcEntry.js.
export const MACHINE_NOT_RUN = ["M/C OFF", "ABSENT", "SUNDAY", "HOLIDAY", "STOCK COUNTING", "REPORT NOT FILLUP"];

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"), so the VMC process is the one linked to
// the VMC Data Entry page. Item Master reads it to offer a VMC part its program
// (Program Time, pieces per program) instead of CNC operation times. A process not
// linked to any page yet is taken as VMC if it is named so, which is what it will
// be linked as — so a part can be set up before the link is.
export const isVmcProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/vmc-data-entry\/?$/.test(page);
  return /\bvmc\b/i.test(process?.processName || "");
};

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);

// Product Cycle Time (sec) = Program Time (min) × 60 ÷ pieces per program; null until both are usable.
export const programCycleSec = (row) => {
  const minutes = num(row?.programTimeMin);
  const pieces = num(row?.pcsPerProgram);
  return isNum(minutes) && isNum(pieces) && pieces > 0 ? (minutes * 60) / pieces : null;
};

// The row as the shared formulas read it: its own cycle time in `totalCycleSec`.
const withCycle = (row) => ({ ...row, totalCycleSec: programCycleSec(row) ?? "" });

export const vmcRowCalc = (row) => {
  const calc = rowCalc(withCycle(row));
  // Ideal Quantity = FLOOR(Machine Shift (min) × pieces ÷ Program Time (min)) — the same
  // figure as shift seconds ÷ cycle seconds, but from the whole numbers typed, so a
  // cycle time that doesn't divide evenly (7 min ÷ 9 pcs) can't tip a floor over by 1.
  const shiftMin = spanMinutes(row?.machineOnTime, row?.machineOffTime);
  const minutes = num(row?.programTimeMin);
  const pieces = num(row?.pcsPerProgram);
  if (shiftMin === null || !isNum(minutes) || minutes <= 0 || !isNum(pieces)) return calc;
  const idealQty = Math.floor((shiftMin * pieces) / minutes);
  return { ...calc, idealQty, idealQtyPerHour: calc.shiftHours ? idealQty / calc.shiftHours : null };
};

// One result per row of one machine's one date, same order and meaning as dayCalc.
export const vmcDayCalc = (rows) => dayCalc((rows || []).map(withCycle));

// The formula popovers for the VMC table's calculated headers: the CNC ones, with
// the three that read differently here.
export const VMC_FORMULAS = (() => {
  const { rejectedQty: _typedHere, ...shared } = FORMULAS;
  return {
    ...shared,
    idealQtyPerHour: "Ideal Quantity / Hour = Ideal Quantity ÷ Machine Shift Time (hours).",
    cycle: "Product Cycle Time = Program Time (min) × 60 ÷ No. of Piece In One Program.",
    idealQty:
      "Ideal Quantity = FLOOR(Machine Shift Time (min) × No. of Piece In One Program ÷ Program Time (min)) — the most the shift could make, so Actual OK + Rejected can't be more than this.",
  };
})();
