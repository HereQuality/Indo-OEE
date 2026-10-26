import { FORMULAS } from "./sheetFormulas";
import { WORKING_STATUSES, entryDayCalc, rowCalc } from "./productionSheet";

/**
 * utils/embossingSheet.js
 * ─────────────────────────
 * The EMBOSSING sheet's figures — INJECTION MOULDING's (utils/injectionSheet.js):
 * the CNC sheet's own formulas (utils/productionSheet.js), fed this sheet's
 * fields, checked against all ten paper rows with times (embossingSheet.test.mjs):
 *
 *   Machine Shift Time (Hours)        = OFF − ON
 *   Ideal Quantity                    = Shift × 3600 ÷ Standard Time per Piece —
 *                                       NOT rounded down (idealQtyExact), and NOT a
 *                                       cap: TOTAL QTY. may beat it (the paper's JAYA
 *                                       BEN 15/05, 5400 against 4800, 121.62%) — such
 *                                       an entry goes to OEE Review instead
 *   Ideal Quantity/Hours              = 3600 ÷ Standard Time per Piece
 *   Ok Quantity (%)                   = OK ÷ TOTAL
 *   Rejected QTY                      = TOTAL − OK
 *   Effective Machine Run Time (hrs)  = TOTAL QTY. × Standard Time ÷ 3600 (every piece
 *                                       run counts, like SPRING FOR PINS)
 *   Total Idle Time (Min)             = the ten downtime columns added up
 *   Unreported Time (min)             = Planned × 60 − Effective × 60 − Idle
 *   OEE considering losses            = Effective ÷ (Planned − Idle ÷ 60)
 *   OEE … but lunch                   = Effective ÷ (Planned − Lunch ÷ 60)
 *   OEE … but lunch and COT           = Effective ÷ (Planned − Lunch ÷ 60 − Setup ÷ 60)
 *
 * The paper has no Planned column: each row works on its own Machine Shift.
 * Here every entry is worked out on its own (entryDayCalc) — typed Planned =
 * Machine Shift on an unlocked process gives exactly the paper's figures; a
 * Planned from Process Master's lock (12 h) is the machine's whole day, so a
 * locked day is combined once, as on every other sheet.
 */

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as EMBOSSING if it is named so.
export const isEmbossingProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/embossing-data-entry\/?$/.test(page);
  return /\bembossing\b/i.test(process?.processName || "");
};

// Every Working Status but PRESENT is a day the machine didn't produce — such an
// entry is status-only. Keep in step with server/models/EmbossingEntry.js.
export const NON_WORKING_STATUSES = WORKING_STATUSES.filter((s) => s !== "PRESENT");
export const isStatusOnly = (v) => NON_WORKING_STATUSES.includes(String(v?.workingStatus ?? "").trim());

// The paper sheet's ten downtime columns, in its own order and wording.
export const EMBOSSING_STOPPAGE_FIELDS = [
  { key: "plannedDownMin", label: "Planned Down Time (min)" },
  { key: "setupMin", label: "Setup Time (min)" },
  { key: "noManPowerMin", label: "No Man Power (min)" },
  { key: "materialShiftingMin", label: "Material Shifting (min)" },
  { key: "noMaterialMin", label: "No Material (min)" },
  { key: "bdMechMin", label: "B.D. Mech. (min)" },
  { key: "bdEleMin", label: "B.D. Ele. (min)" },
  { key: "noPowerMin", label: "No Power (min)" },
  { key: "lunchMin", label: "Lunch / Tea / Washroom etc (Min)" },
  { key: "otherMin", label: "Other (Min)" },
];

const isNum = (v) => v !== null && v !== undefined && Number.isFinite(v);

// Effective Machine Run Time counts every piece run — TOTAL QTY. — on this sheet.
const withBasis = (row) => (row ? { ...row, runQtyBasis: "total" } : row);

export const embossingRowCalc = (row) => {
  const c = rowCalc(withBasis(row));
  if (!row) return c;
  const std = c.totalCycleSec;
  const hasStd = isNum(std) && std > 0;
  return {
    ...c,
    // The sheet's own Ideal Quantity, not rounded down.
    idealQtyExact: hasStd && isNum(c.shiftHours) ? (c.shiftHours * 3600) / std : null,
    // Ideal Quantity/Hours = 3600 ÷ Standard Time per Piece.
    idealQtyPerHour: hasStd ? 3600 / std : null,
  };
};

// One result per row of one machine's one date (sortByMachineOn order, like
// dayCalc) — each entry's own figures, or the day's combined ones on a 12 h lock.
export const embossingDayCalc = (rows) => entryDayCalc((rows || []).map(withBasis));

// The formula popovers for this table's calculated headers.
export const EMBOSSING_FORMULAS = {
  ...FORMULAS,
  shift: "Machine Shift Time (Hours) = Machine OFF Time − Machine ON Time",
  cycle: "Standard Time per Piece (in Sec) — filled in from the Part when picked, and can be changed for the day.",
  totalQty: "TOTAL QTY. = every piece the machine ran (OK + Rejected).",
  rejectedQty: "Rejected QTY = TOTAL QTY. − OK QTY.",
  pctOk: "Ok Quantity (%) = OK QTY. ÷ TOTAL QTY.",
  idealQty:
    "Ideal Quantity = Machine Shift Time × 3600 ÷ Standard Time per Piece (shown to 2 decimals, as on the sheet). TOTAL QTY. may be more than this — such an entry goes to OEE Review (Performance above 100%).",
  idealQtyPerHour: "Ideal Quantity/Hour = 3600 ÷ Standard Time per Piece",
  totalStoppage: "Total Idle Time (Min) = the ten downtime columns added up, Lunch / Tea / Washroom included.",
  effective: "Effective Machine Run Time (hours) = TOTAL QTY. × Standard Time per Piece ÷ 3600 — every piece run counts on this sheet.",
  unreported:
    "Unreported Time (min) = Planned Operator Shift × 60 − Effective Machine Run Time × 60 − Total Idle Time, for this entry. A Planned Operator Shift locked in Process Master counts once for the machine's day, so a locked day is combined across its entries.",
  oeeLosses:
    "OEE considering losses = Effective Machine Run Time ÷ (Planned Operator Shift − Total Idle Time ÷ 60), for this entry (combined across the machine's day on a locked shift).",
  oeeLunch:
    "OEE not considering losses but lunch = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch ÷ 60), for this entry (combined across the machine's day on a locked shift).",
  oeeLunchCot:
    "OEE not considering losses but lunch and COT = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch ÷ 60 − Setup Time ÷ 60), for this entry (combined across the machine's day on a locked shift). COT = change-over time, the Setup Time column.",
  performance:
    "Performance = Standard Time per Piece × TOTAL QTY. ÷ Operating Time, for this entry — how fast it ran against its ideal speed. Above 100% (red) sends the entry to Admin review: usually a wrong time per piece, quantity or downtime.",
};
