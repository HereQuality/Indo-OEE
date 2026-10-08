import { FORMULAS } from "./sheetFormulas";
import { dayCalc, rowCalc } from "./productionSheet";

/**
 * utils/spmSheet.js
 * ───────────────────
 * The SPM Data Entry sheet's figures. The SPM sheet differs from the CNC one in
 * where its cycle time comes from, not in what it does with it: Total Cycle
 * Time (sec) = Loading + Process + Unloading and Cleaning + Other Operations
 * (the four operation times typed on the entry), instead of being copied from
 * the part. Once that's worked out, Ideal Quantity, Effective Run Time, Setup
 * Efficiency, Unutilized/Unreported Time and the three OEE figures are the
 * very same formulas rowCalc/dayCalc already use for CNC and VMC — SPM needs
 * no override of its own for any of those (unlike VMC's Ideal Quantity, which
 * has to divide the typed program/pieces rather than the generic shift÷cycle).
 *
 * No. of Holes in One Piece, No. of Piece in One Cycle and Stroke Required for
 * One Piece are typed and shown on the sheet, but nobody has given us the rule
 * connecting them to Ideal Quantity (or anything else) yet — they stay
 * display-only reference figures until that's confirmed against real data.
 */

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as SPM if it is named so, which is what it will be linked as.
export const isSpmProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/spm-data-entry\/?$/.test(page);
  return /\bspm\b/i.test(process?.processName || "");
};

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);

// Total Cycle Time (sec) = Loading + Process + Unloading and Cleaning + Other
// Operations; null until every one of the four is usable.
export const spmCycleSec = (row) => {
  const parts = [row?.loadingSec, row?.processSec, row?.unloadingCleaningSec, row?.otherOperationsSec].map(num);
  return parts.every(isNum) ? parts.reduce((sum, n) => sum + n, 0) : null;
};

// The row as the shared formulas read it: its own cycle time in `totalCycleSec`.
const withCycle = (row) => ({ ...row, totalCycleSec: spmCycleSec(row) ?? "" });

export const spmRowCalc = (row) => rowCalc(withCycle(row));

// One result per row of one machine's one date, same order and meaning as dayCalc.
export const spmDayCalc = (rows) => dayCalc((rows || []).map(withCycle));

// The formula popovers for the SPM table's calculated headers: the CNC ones, with
// the one that reads differently here.
export const SPM_FORMULAS = (() => {
  const { rejectedQty: _typedHere, ...shared } = FORMULAS;
  return {
    ...shared,
    cycle: "Total Cycle Time = Loading (Sec) + Process (Sec) + Unloading and Cleaning (Sec) + Other Operations (Sec).",
  };
})();
