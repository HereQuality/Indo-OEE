import { FORMULAS } from "./sheetFormulas";
import { entryDayCalc, rowCalc, spanMinutes } from "./productionSheet";

/**
 * utils/mfdSheet.js
 * ───────────────────
 * The MODULAR FRAME DRILLING sheet's figures — the CNC sheet's own formulas
 * (utils/productionSheet.js), fed this sheet's fields, with its own IDEAL
 * Quantity. Checked against all 19 rows of the paper sheet (mfdSheet.test.mjs):
 *
 *   Machine Shift Time (Hour)        = Machine Time OFF − Machine Time ON
 *   IDEAL Quantity                   = (Machine Shift min − Lunch min) × 60 ÷ Total Cycle Time
 *                                      — Lunch / Tea taken out, NOT rounded down: shown
 *                                      with 0 decimals as on the paper, kept unrounded
 *                                      for every figure (idealQtyExact). The cap on Actual
 *                                      Quantity is the whole number under it (idealQty), a
 *                                      piece being made or not (INJECTION MOULDING's rule)
 *   IDEAL Quantity/Hour              = IDEAL Quantity ÷ Machine Shift hours
 *   % OK Quantity                    = OK ÷ Actual
 *   Rejected Quantity                = Actual − OK
 *   Effective Machine Run Time (Hour)= ACTUAL OK Quantity × Total Cycle Time ÷ 3600 — the
 *                                      standard CNC rule. (The paper's Excel has
 *                                      (OK + Cycle) × Cycle ÷ 3600, a spreadsheet slip the
 *                                      user chose not to copy — see the test.)
 *   Total stoppage (Min)             = the ten downtime columns added up
 *   Unreported Time (Min)            = Planned × 60 − Effective × 60 − Total stoppage
 *   Efficiency (%)                   = Effective ÷ Machine Shift hours
 *   OEE considering losses           = Effective ÷ (Planned − stoppage ÷ 60)
 *   OEE … but lunch                  = Effective ÷ (Planned − Lunch ÷ 60)
 *   OEE … but lunch & COT            = Effective ÷ (Planned − Lunch ÷ 60 − Set-up ÷ 60)
 *
 * The paper has no Planned column: each row works on its own Machine Shift.
 * Here every entry is worked out on its own (entryDayCalc) — typed Planned =
 * Machine Shift on an unlocked process gives each row's own figures, even with
 * two overlapping entries on one machine's date (4/B VISHAL 10/05); a Planned
 * from Process Master's lock (12 h) is the machine's whole day, so a locked day
 * is combined once, as on every other sheet.
 */

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as MODULAR FRAME DRILLING only by its whole name — never by
// "DRILLING" alone, which a CNC process could carry.
export const isMfdProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/modular-frame-drilling-data-entry\/?$/.test(page);
  return /\bmodular\s*frame\s*drilling\b/i.test(process?.processName || "");
};

// A date's entries per machine. Keep in step with MAX_SLOTS in server/models/MfdEntry.js.
export const MFD_MAX_SLOTS = 8;

// A part's Process — the sheet's own "Process" column, set once on the Part
// (Production › Parts, required there) and shown on the entry. Keep in step
// with MFD_OPERATIONS in server/models/Item.js.
export const MFD_OPERATIONS = ["DRILLING", "TAPPING", "DRILL/CHAM"];

// The paper sheet's ten downtime columns, in its own order and wording.
export const MFD_STOPPAGE_FIELDS = [
  { key: "plannedDownMin", label: "Planned downtime (min)" },
  { key: "setupMin", label: "Set-up Time (min)" },
  { key: "noManPowerMin", label: "No Manpower (min)" },
  { key: "materialShiftingMin", label: "Material Shifting (min)" },
  { key: "noMaterialMin", label: "No Material (min)" },
  { key: "bdMechMin", label: "B.D. Mech. (min)" },
  { key: "bdEleMin", label: "B.D. Ele. (min)" },
  { key: "noPowerMin", label: "No Power (min)" },
  { key: "lunchMin", label: "Lunch / Tea / Washroom etc (min)" },
  { key: "otherMin", label: "Others (min)" },
];

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && v !== undefined && Number.isFinite(v);

// IDEAL Quantity, unrounded: the Machine Shift less Lunch / Tea over Total
// Cycle Time. Keep in step with idealQtyOf in server/controllers/mfdSheet.controller.js.
export const mfdIdealQty = (shiftMin, lunchMin, cycleSec) => Math.max(0, ((shiftMin - (lunchMin || 0)) * 60) / cycleSec);

export const mfdRowCalc = (row) => {
  const c = rowCalc(row);
  if (!row) return c;
  const cycle = c.totalCycleSec;
  const shiftMin = spanMinutes(row.machineOnTime, row.machineOffTime);
  const lunchMin = num(row.lunchMin) || 0;
  const exact = isNum(cycle) && cycle > 0 && shiftMin !== null ? mfdIdealQty(shiftMin, lunchMin, cycle) : null;
  return {
    ...c,
    // The sheet's own IDEAL Quantity, Lunch / Tea out and not rounded down…
    idealQtyExact: exact,
    // …and the cap on Actual Quantity: the whole number under it.
    idealQty: exact === null ? null : Math.floor(exact + 1e-9),
    // How much Lunch / Tea it took out — the cap's popup names it.
    idealLunchMin: exact === null ? null : lunchMin,
    // IDEAL Quantity/Hour = IDEAL Quantity ÷ Machine Shift hours.
    idealQtyPerHour: exact !== null && shiftMin > 0 ? exact / (shiftMin / 60) : null,
    // Efficiency (%) = Effective Machine Run Time ÷ Machine Shift hours.
    efficiency: isNum(c.effectiveHours) && shiftMin > 0 ? c.effectiveHours / (shiftMin / 60) : null,
  };
};

// One result per row of one machine's one date (sortByMachineOn order, like
// dayCalc) — each entry's own figures, or the day's combined ones on a 12 h lock.
export const mfdDayCalc = (rows) => entryDayCalc(rows || []);

// IDEAL Quantity as the paper shows it (0 decimals) and IDEAL Quantity/Hour (1 decimal).
export const fmtIdeal = (v) => (isNum(v) ? String(Math.round(v)) : "");
export const fmtIdealPerHour = (v) => (isNum(v) ? v.toFixed(1) : "");

// The formula popovers for this table's calculated headers.
export const MFD_FORMULAS = {
  ...FORMULAS,
  shift: "Machine Shift Time (Hour) = Machine Time OFF − Machine Time ON",
  cycle: "Total Cycle Time (Sec) — filled in from the Part when picked, and can be changed for the day.",
  partRef: "Drawing No., Process, No. of Holes and Stroke Required are the Part's own (Production › Parts), copied onto the entry when the Part is picked.",
  idealQty:
    "IDEAL Quantity = (Machine Shift Time in min − Lunch / Tea in min) × 60 ÷ Total Cycle Time, shown with no decimals as on the sheet. Actual Quantity can't be more than the whole number under it.",
  idealQtyPerHour: "IDEAL Quantity/Hour = IDEAL Quantity ÷ Machine Shift Time (hours)",
  actualQty: "Actual Quantity — every piece run (OK + Rejected), typed on the form.",
  rejectedQty: "Rejected Quantity = Actual Quantity − ACTUAL OK Quantity",
  pctOk: "% OK Quantity = ACTUAL OK Quantity ÷ Actual Quantity",
  totalStoppage: "Total stoppage (Min) = the ten downtime columns added up, Lunch / Tea / Washroom included.",
  effective: "Effective Machine Run Time (Hour) = ACTUAL OK Quantity × Total Cycle Time ÷ 3600",
  efficiency: "Efficiency (%) = Effective Machine Run Time ÷ Machine Shift Time (hours), for this entry.",
  unreported:
    "Unreported Time (Min) = Planned Operator Shift × 60 − Effective Machine Run Time × 60 − Total stoppage, for this entry. A Planned Operator Shift locked in Process Master counts once for the machine's day, so a locked day is combined across its entries.",
  oeeLosses:
    "OEE considering losses = Effective Machine Run Time ÷ (Planned Operator Shift − Total stoppage ÷ 60), for this entry (combined across the machine's day on a locked shift).",
  oeeLunch:
    "OEE not considering losses, but lunch = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch ÷ 60), for this entry (combined across the machine's day on a locked shift).",
  oeeLunchCot:
    "OEE not considering losses, but lunch & COT = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch ÷ 60 − Set-up Time ÷ 60), for this entry (combined across the machine's day on a locked shift). COT = change-over time, the Set-up Time column.",
  performance:
    "Performance = Total Cycle Time × Actual Quantity ÷ Operating Time, for this entry — how fast it ran against its ideal speed. Above 100% (red) sends the entry to Admin review: usually a wrong cycle time, quantity or downtime.",
};
