import { FORMULAS } from "./sheetFormulas";
import { dayCalc, rowCalc } from "./productionSheet";

/**
 * utils/spmSheet.js
 * ───────────────────
 * The SPM Data Entry sheet's figures. Like CNC, an SPM part's cycle time is
 * set once on the Part (Production › Parts, required there): its own four
 * named operations — Loading, Process, Unloading and Cleaning, Other
 * Operations — which sum to Total Cycle Time. Picking a part copies both the
 * sum (totalCycleSec) and the four operations onto the entry (display only);
 * ticking one off there subtracts its own seconds from this entry's Total
 * Cycle Time, the Part's own record never touched — the exact same mechanism
 * CNC's rowCalc already has for its eight operations (excludedOps), just
 * reimplemented here for SPM's own four field names, since rowCalc's own
 * version only knows CNC's CYCLE_OP_FIELDS. Once Total Cycle Time is worked
 * out, Ideal Quantity, Effective Run Time, Setup Efficiency, Unutilized/
 * Unreported Time and the three OEE figures are the very same formulas
 * rowCalc/dayCalc already use for CNC and VMC.
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

// The named operation-time boxes, in sheet order — Total Cycle Time is their
// sum (just like CNC's CYCLE_OP_FIELDS in utils/productionSheet.js, but SPM's
// own four fields). Kept in step with SPM_OP_FIELDS in server/models/Item.js.
export const SPM_OP_FIELDS = [
  { key: "loadingSec", label: "Loading (sec)" },
  { key: "processSec", label: "Process (sec)" },
  { key: "unloadingCleaningSec", label: "Unloading and Cleaning (sec)" },
  { key: "otherOperationsSec", label: "Other Operations (sec)" },
];

// An SPM part's three reference figures — No. of Holes in One Piece, No. of
// Piece in One Cycle, Stroke Required for One Piece. Set once on the Part
// (required there), copied onto an SPM entry read-only, same as the four
// operations above — just not part of any formula yet (nobody has given us
// the rule connecting them to Ideal Quantity). Kept in step with
// SPM_REFERENCE_FIELDS in server/models/Item.js.
export const SPM_REFERENCE_FIELDS = [
  { key: "noOfHoles", label: "No. of Holes in One Piece" },
  { key: "piecesPerCycle", label: "No. of Piece in One Cycle" },
  { key: "strokeRequired", label: "Stroke Required for One Piece" },
];

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const sumOrZero = (vals) => vals.reduce((s, v) => s + (isNum(v) ? v : 0), 0);

// Total Cycle Time (sec) = the Part's own Total Cycle Time (copied onto the
// entry as totalCycleSec when picked), minus whichever of the four operations
// are unticked for this entry — the exact same rule as CNC's own cycle
// (utils/productionSheet.js's rowCalc), just keyed to SPM_OP_FIELDS instead
// of CYCLE_OP_FIELDS. Blank without a Part Name, same as CNC.
export const spmCycleSec = (row) => {
  if (!String(row?.itemName || "").trim()) return null;
  const excluded = new Set(row?.excludedOps || []);
  const excludedSec = sumOrZero(SPM_OP_FIELDS.filter((f) => excluded.has(f.key)).map((f) => num(row?.[f.key])));
  const ownTotal = num(row?.totalCycleSec);
  return isNum(ownTotal) ? ownTotal - excludedSec : null;
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
