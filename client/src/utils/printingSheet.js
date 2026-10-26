import { FORMULAS } from "./sheetFormulas";
import { STOPPAGE_FIELDS, WORKING_STATUSES, entryDayCalc, rowCalc } from "./productionSheet";

/**
 * utils/printingSheet.js
 * ────────────────────────
 * The PRINTING sheet's figures — the shared formulas (utils/productionSheet.js)
 * fed this sheet's fields, the SPRING FOR PINS way:
 *   Standard Time per Piece (sec)   → totalCycleSec (prefilled from the Part)
 *   TOTAL QTY. / OK QTY.            → actualQty / okQty (Rejected = TOTAL − OK)
 *   Effective Machine Run Time      → on TOTAL QTY (runQtyBasis "total")
 *   Total Idle Time                 → every one of its 13 downtime columns: its
 *                                     own three (extraStoppageKeys) + the ten
 * plus, as the paper sheet shows them:
 *   Ideal Quantity        = Machine Shift × 3600 ÷ Std, NOT rounded (idealQtyExact)
 *                           — the cap on TOTAL QTY still uses it rounded down (idealQty)
 *   Ideal Quantity/Hours  = 3600 ÷ Std
 *
 * Kept per OPERATOR like RUBBER: each row's `machine` is its operator's id (the
 * API sets it), so the shared table and day formulas group by operator. The MC
 * No. is optional and is `mcMachine`, never the row key.
 *
 * Each entry is worked out on its own (entryDayCalc): with Planned Operator
 * Shift typed equal to the Machine Shift (process unlocked) every figure equals
 * the paper sheet's — checked against its 16 example rows
 * (utils/paperSheets.test.mjs, utils/printingSheet.test.mjs). A day on Process
 * Master's locked shift is combined once, as on every other sheet.
 */

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as PRINTING if it is named so.
export const isPrintingProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/printing-data-entry\/?$/.test(page);
  return /\bprinting\b/i.test(process?.processName || "");
};

// Every Working Status but PRESENT is a day with no work — such an entry is
// status-only. Keep in step with server/models/PrintingEntry.js.
export const NON_WORKING_STATUSES = WORKING_STATUSES.filter((s) => s !== "PRESENT");
export const isStatusOnly = (v) => NON_WORKING_STATUSES.includes(String(v?.workingStatus ?? "").trim());

// Most entries one operator may have on a date — the paper sheet has up to
// four. Keep in step with MAX_SLOTS in server/models/PrintingEntry.js.
export const PRINTING_MAX_ENTRIES = 8;

// Printing's own downtime columns, ahead of the ten every sheet has. Keep in
// step with PRINTING_EXTRA_STOPPAGE_KEYS in server/models/PrintingEntry.js.
export const PRINTING_EXTRA_STOPPAGE_FIELDS = [
  { key: "askQueryQcMin", label: "Ask Query To QC Team (min)" },
  { key: "emptyBagTuggingMin", label: "Empty Bag Tugging (min)" },
  { key: "stockCountingMin", label: "Stock Counting (min)" },
];
export const PRINTING_EXTRA_STOPPAGE_KEYS = PRINTING_EXTRA_STOPPAGE_FIELDS.map((f) => f.key);

// The ten shared columns in the paper sheet's own wording.
const SHEET_WORDING = {
  plannedDownMin: "Planned Down Time (min)",
  setupMin: "Setup Time (min)",
  noManPowerMin: "No Man Power (min)",
  materialShiftingMin: "Material Shifting (min)",
  noMaterialMin: "No Material (min)",
  bdMechMin: "B.D. Mech. (min)",
  bdEleMin: "B.D. Ele. (min)",
  noPowerMin: "No Power (min)",
  lunchMin: "Lunch / Tea / Washroom etc (Min)",
  otherMin: "Other (Min)",
};

// Every downtime column of the sheet, in its own order.
export const PRINTING_STOPPAGE_FIELDS = [
  ...PRINTING_EXTRA_STOPPAGE_FIELDS,
  ...STOPPAGE_FIELDS.map((f) => ({ key: f.key, label: SHEET_WORDING[f.key] || f.label })),
];

// What every row of this sheet tells the shared formulas: Effective Run Time
// on TOTAL QTY, and its three own downtime columns counted as stoppage.
export const withPrinting = (row) => (row ? { ...row, runQtyBasis: "total", extraStoppageKeys: PRINTING_EXTRA_STOPPAGE_KEYS } : row);

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export const printingRowCalc = (row) => {
  const c = rowCalc(withPrinting(row));
  if (!row) return c;
  const std = c.totalCycleSec;
  const hasStd = isNum(std) && std > 0;
  return {
    ...c,
    // The sheet's own Ideal Quantity, unrounded (942.86); idealQty stays the
    // rounded-down figure TOTAL QTY is capped at.
    idealQtyExact: hasStd && isNum(c.shiftHours) ? (c.shiftHours * 3600) / std : null,
    idealQtyPerHour: hasStd ? 3600 / std : null,
  };
};

// One result per row, in sortByMachineOn order — each entry on its own (see the
// file comment).
export const printingDayCalc = (rows) => entryDayCalc((rows || []).map(withPrinting));

// The formula popovers for this table's calculated headers.
export const PRINTING_FORMULAS = {
  ...FORMULAS,
  shift: "Machine Shift Time = Machine OFF Time − Machine ON Time",
  cycle: "Standard Time per Piece — filled in from the Part when picked, and can be changed for the day.",
  idealQty:
    "Ideal Quantity = Machine Shift Time × 3600 ÷ Standard Time per Piece, as the sheet shows it (not rounded). TOTAL QTY can't be more than it rounded down — a part-piece can't be made.",
  idealQtyPerHour: "Ideal Quantity/Hours = 3600 ÷ Standard Time per Piece",
  pctOk: "Ok Quantity (%) = OK QTY ÷ TOTAL QTY",
  rejectedQty: "Rejected QTY = TOTAL QTY − OK QTY.",
  totalStoppage: "Total Idle Time = every downtime column added up — Ask Query To QC Team, Empty Bag Tugging and Stock Counting included.",
  effective: "Effective Machine Run Time = TOTAL QTY × Standard Time per Piece ÷ 3600 — every piece run counts on this sheet.",
  unreported:
    "Unreported Time (min) = Planned Operator Shift × 60 − Effective Machine Run Time × 60 − Total Idle Time, for this entry (a day on Process Master's locked shift: combined across the operator's date).",
  oeeLosses:
    "OEE considering losses = Effective Machine Run Time ÷ (Planned Operator Shift − Total Idle Time ÷ 60), for this entry (a day on Process Master's locked shift: combined across the operator's date).",
  oeeLunch:
    "OEE not considering losses but lunch = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch ÷ 60), for this entry (a locked-shift day: combined).",
  oeeLunchCot:
    "OEE not considering losses but lunch and COT = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch ÷ 60 − Setup Time ÷ 60), for this entry (a locked-shift day: combined).",
  availability:
    "Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Machine Shift − every downtime column; Planned Production Time = Planned Operator Shift − Lunch − Planned Down Time (the planned stops). Above 100% (red) sends the entry to Admin review.",
  performance:
    "Performance = Standard Time per Piece × TOTAL QTY ÷ Operating Time, for this entry. Above 100% (red) sends the entry to Admin review: usually a wrong time per piece, quantity or downtime.",
  quality: "Quality = OK QTY ÷ TOTAL QTY, for this entry.",
};
