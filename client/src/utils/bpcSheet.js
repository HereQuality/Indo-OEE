import { FORMULAS } from "./sheetFormulas";
import { WORKING_STATUSES, entryDayCalc, rowCalc } from "./productionSheet";

/**
 * utils/bpcSheet.js
 * ───────────────────
 * The BEFORE POWDER COATING sheet's figures (sheet key "bpc" — a different
 * process from AFTER POWDER COATING, utils/powderCoatingSheet.js). Kept per
 * OPERATOR like RUBBER: each row's `machine` is its operator's id (the API sets
 * it), so the shared table and day formulas group by operator. The SPRING FOR
 * PINS quantity / time model, fed this sheet's fields:
 *   Machine ON / OFF Time             → machineOnTime / machineOffTime
 *   Machine Shift Time (Hours)        = OFF − ON
 *   Standard Time per Piece (Sec)     → totalCycleSec (prefilled from the Part)
 *   TOTAL QTY / OK QTY                → actualQty / okQty; Rejected = TOTAL − OK
 *   Ideal Quantity                    = Shift × 3600 ÷ Std — NOT floored (2 decimals)
 *   Ideal Quantity/Hours              = 3600 ÷ Std
 *   Total Idle Time                   = Setup + B.D. + Lunch + Other
 *   Effective Machine Run Time        = TOTAL × Std ÷ 3600 (runQtyBasis "total")
 *   Unreported Time                   = Planned×60 − Effective×60 − Idle
 *   OEE considering losses            = Eff ÷ (Planned − every stoppage EXCEPT Lunch ÷ 60)
 *   OEE not considering losses but lunch = Eff ÷ (Planned − Lunch ÷ 60)
 * The paper has no Planned column: each of its rows works on its own Machine
 * Shift, so every entry's Unreported / OEE is its own (entryDayCalc) — typed
 * Planned = Machine Shift reproduces the paper exactly (utils/paperSheets.test.mjs);
 * a day on Process Master's lock is combined once, as on every other sheet.
 */

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as BEFORE POWDER COATING if it is named so.
export const isBpcProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/before-powder-coating-data-entry\/?$/.test(page);
  return /before\s*powder\s*coating/i.test(process?.processName || "");
};

// Every Working Status but PRESENT is a day the operator didn't work — such an
// entry is status-only. Keep in step with server/models/BeforePowderCoatingEntry.js.
export const NON_WORKING_STATUSES = WORKING_STATUSES.filter((s) => s !== "PRESENT");
export const isStatusOnly = (v) => NON_WORKING_STATUSES.includes(String(v?.workingStatus ?? "").trim());

// The sheet's own Rejected QTY columns, in its order. Keep in step with
// BPC_REJECT_REASONS in server/models/BeforePowderCoatingEntry.js.
export const BPC_REJECT_REASONS = ["Blow Holes Casting", "Crack/Damage Casting", "Threading Casting", "TAP Broken Casting", "Other"];

// The sheet's downtime columns, in its order and wording. B.D. (Breakdown) is
// stored under the shared bdMechMin key, so rowCalc / dayCalc and the server's
// oeeMetrics count it unchanged. Keep in step with BPC_STOPPAGE_KEYS in
// server/models/BeforePowderCoatingEntry.js.
export const BPC_STOPPAGE_FIELDS = [
  { key: "setupMin", label: "Setup Time (min)" },
  { key: "bdMechMin", label: "B.D. (Breakdown) (min)" },
  { key: "lunchMin", label: "Lunch / Tea / Washroom etc (Min)" },
  { key: "otherMin", label: "Other (Min)" },
];

// One operator takes up to this many entries on a date (the paper has up to
// six). Keep in step with MAX_SLOTS in server/models/BeforePowderCoatingEntry.js.
export const BPC_MAX_ENTRIES_PER_DAY = 8;

const isNum = (v) => v !== null && v !== undefined && Number.isFinite(v);

// Effective Machine Run Time counts every piece run — TOTAL QTY — on this sheet.
const withBasis = (row) => (row ? { ...row, runQtyBasis: "total" } : row);

// rowCalc's figures, with this sheet's own Ideal Quantity: not floored (the
// paper shows 102.857…), and Ideal Quantity/Hours = 3600 ÷ Standard Time.
// idealQtyFloor is the whole pieces the shift could make — what any cap on
// TOTAL QTY would use.
export const bpcRowCalc = (row) => {
  const c = rowCalc(withBasis(row));
  if (!row) return c;
  const cycle = c.totalCycleSec;
  const hasCycle = isNum(cycle) && cycle > 0;
  const idealQty = hasCycle && isNum(c.shiftHours) ? (c.shiftHours * 3600) / cycle : null;
  return {
    ...c,
    idealQty,
    idealQtyFloor: isNum(idealQty) ? Math.floor(idealQty + 1e-9) : null,
    idealQtyPerHour: hasCycle ? 3600 / cycle : null,
  };
};

// Unreported Time and the two OEE figures, one result per row in
// sortByMachineOn order: each entry on its own (combined once for a day on
// Process Master's lock); OEE considering losses leaves Lunch out of the losses.
export const bpcDayCalc = (rows) => entryDayCalc((rows || []).map(withBasis), { lossesExceptLunch: true });

// The rejected pieces the reason columns add up to — the paper's total after them.
export const rejectSplitTotal = (row) =>
  BPC_REJECT_REASONS.reduce((s, r) => s + (Number.isFinite(Number(row?.rejectBreakdown?.[r])) ? Number(row.rejectBreakdown[r]) : 0), 0);

// The formula popovers for this table's calculated headers.
export const BPC_FORMULAS = {
  ...FORMULAS,
  shift: "Machine Shift Time (Hours) = Machine OFF Time − Machine ON Time",
  cycle: "Standard Time per Piece — filled in from the Part when picked, and can be changed for the day.",
  rejectedQty:
    "Rejected QTY = TOTAL QTY − OK QTY, so OK + Rejected = TOTAL. The breakdown shows how it splits across Blow Holes, Crack/Damage, Threading, TAP Broken and Other.",
  rejectSplitTotal: "The reason columns added up — always equal to Rejected QTY.",
  idealQty: "Ideal Quantity = Machine Shift Time × 3600 ÷ Standard Time per Piece — not rounded down, as on the sheet.",
  idealQtyPerHour: "Ideal Quantity/Hours = 3600 ÷ Standard Time per Piece",
  totalStoppage: "Total Idle Time (Min) = Setup Time + B.D. (Breakdown) + Lunch / Tea / Washroom + Other",
  effective: "Effective Machine Run Time (hours) = TOTAL QTY × Standard Time per Piece ÷ 3600 — every piece run counts, rejected ones too.",
  unreported:
    "Unreported Time (min) = Planned Operator Shift × 60 − Effective Machine Run Time × 60 − Total Idle Time, for this entry (with Process Master's fixed shift: combined across the operator's whole date).",
  oeeLosses:
    "OEE considering losses = Effective Machine Run Time ÷ (Planned Operator Shift − (Setup + B.D. + Other) ÷ 60) — every stoppage except Lunch / Tea, for this entry (with Process Master's fixed shift: combined across the operator's whole date).",
  oeeLunch:
    "OEE not considering losses but lunch = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch / Tea ÷ 60), for this entry (with Process Master's fixed shift: combined across the operator's whole date).",
  performance:
    "Performance = Standard Time per Piece × TOTAL QTY ÷ Operating Time, for this entry. Above 100% (red) sends the entry to Admin review — usually a wrong time per piece, quantity or idle time.",
  availability:
    "Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Machine Shift Time − Total Idle Time; Planned Production Time = Planned Operator Shift − Lunch / Tea. Above 100% (red) sends the entry to Admin review.",
  quality: "Quality = OK QTY ÷ TOTAL QTY, for this entry.",
};
