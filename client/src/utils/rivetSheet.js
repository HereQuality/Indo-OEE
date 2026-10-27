import { FORMULAS } from "./sheetFormulas";
import { cycleAfterExcluded, dayCalc, rowCalc } from "./productionSheet";

/**
 * utils/rivetSheet.js
 * ─────────────────────
 * The RIVET Data Entry sheet's figures. Like SPM, a RIVET part's cycle time is
 * set once on the Part (Production › Parts, required there): its own four
 * named operations — Loading, Process, Unloading and Cleaning, Other
 * Operations — which sum to Total Cycle Time. Picking a part copies both the
 * sum (totalCycleSec) and the four operations onto the entry (display only);
 * ticking one off there subtracts its own seconds from this entry's Total
 * Cycle Time, the Part's own record never touched — the same mechanism SPM
 * uses (utils/spmSheet.js's spmCycleSec), just reimplemented here for RIVET's
 * own four field names.
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

// A RIVET part's Process choices — set once on the Part (Production › Parts,
// required there), independent of the entry's own Process box (same choices,
// same dropdown look). Kept in step with RIVET_PROCESS_TYPES in
// server/models/Item.js and PROCESS_TYPES in server/models/RivetEntry.js.
export const RIVET_PROCESS_TYPES = ["Rivet", "Clamp"];

// The named operation-time boxes, in sheet order — Total Cycle Time is their
// sum (the same shape as SPM_OP_FIELDS in utils/spmSheet.js, but RIVET's own
// four fields). Kept in step with RIVET_OP_FIELDS in server/models/Item.js.
export const RIVET_OP_FIELDS = [
  { key: "rivetLoadingSec", label: "Loading (sec)" },
  { key: "rivetProcessSec", label: "Process (sec)" },
  { key: "rivetUnloadingCleaningSec", label: "Unloading and Cleaning (sec)" },
  { key: "rivetOtherOperationsSec", label: "Other Operations (sec)" },
];

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const sumOrZero = (vals) => vals.reduce((s, v) => s + (isNum(v) ? v : 0), 0);

// Total Cycle Time (sec) = the Part's own Total Cycle Time (copied onto the
// entry as totalCycleSec when picked), minus whichever of the four operations
// are unticked for this entry — the same rule as SPM's own cycle
// (utils/spmSheet.js's spmCycleSec), just keyed to RIVET_OP_FIELDS instead of
// SPM_OP_FIELDS. Blank without a Part Name, same as SPM.
export const rivetCycleSec = (row) => {
  if (!String(row?.itemName || "").trim()) return null;
  const excluded = new Set(row?.excludedOps || []);
  const excludedSec = sumOrZero(RIVET_OP_FIELDS.filter((f) => excluded.has(f.key)).map((f) => num(row?.[f.key])));
  const ownTotal = num(row?.totalCycleSec);
  return isNum(ownTotal) ? cycleAfterExcluded(ownTotal, excludedSec) : null;
};

// The row as the shared formulas read it: its own cycle time in `totalCycleSec`.
const withCycle = (row) => ({ ...row, totalCycleSec: rivetCycleSec(row) ?? "" });

export const rivetRowCalc = (row) => rowCalc(withCycle(row));

// One result per row of one machine's one date, same order and meaning as dayCalc.
export const rivetDayCalc = (rows) => dayCalc((rows || []).map(withCycle));

// The formula popovers for the RIVET table's calculated headers: the CNC ones, with
// the one that reads differently here.
export const RIVET_FORMULAS = (() => {
  const { rejectedQty: _typedHere, ...shared } = FORMULAS;
  return {
    ...shared,
    cycle: "Total Cycle Time = Loading (Sec) + Process (Sec) + Unloading and Cleaning (Sec) + Other Operations (Sec).",
  };
})();
