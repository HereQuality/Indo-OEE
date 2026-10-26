import { FORMULAS } from "./sheetFormulas";
import { WORKING_STATUSES, entryDayCalc, rowCalc } from "./productionSheet";

/**
 * utils/finalAssemblySheet.js
 * ─────────────────────────────
 * The FINAL ASSEMBLY sheet's figures (sheet key "finalAssembly") — AFTER POWDER
 * COATING's shape (utils/powderCoatingSheet.js), kept as its own process. Per
 * WORKER: each row's `machine` is its worker's id (the API sets it), so the
 * shared table and day formulas group by worker. The shared formulas
 * (utils/productionSheet.js), fed this sheet's fields:
 *   Start / End Time                 → machineOnTime / machineOffTime
 *   Working Hours                    = End − Start
 *   Standard Time per Piece (Sec)    → totalCycleSec — OPTIONAL (PACKING has none)
 *   Total QTY (typed)                → actualQty
 *   Types of Defects (typed)         → rejectBreakdown over FA_DEFECT_REASONS
 *   Total Defects / Rejected QTY     = the defects added up
 *   OK QTY                           = Total QTY − Total Defects
 *   Ideal Quantity                   = Hours × 3600 ÷ Std — NOT floored (blank without Std)
 *   Ideal Quantity/Hour              = 3600 ÷ Std
 *   Effective time (hr)              = Total QTY × Std ÷ 3600 (0 without Std)
 *   Unreported (min)                 = Planned×60 − Effective×60 − Other Activity − Total Idle
 *   Productivity (no lunch / lunch)  = dayCalc's productivity / productivityLunch:
 *                                      Effective ÷ (Planned − Other Activity [− Lunch])
 * Every entry is worked out on its own (entryDayCalc) — the paper has no Planned
 * column and works each row on its own Working Hours; typed Planned = Working
 * Hours reproduces all 18 real rows exactly (utils/finalAssemblySheet.test.mjs).
 * A day on Process Master's lock is combined once, as on every other sheet.
 */

// The sheet's labels, in one place — the paper's header gave only the defect
// and idle names, so the rest are inferred (assembly wording). Rename here;
// the form, table, rules and formula popovers all read them. Keep in step with
// FA_LABELS in server/models/FinalAssemblyEntry.js.
export const FA_LABELS = {
  sheet: "FINAL ASSEMBLY",
  worker: "Worker Name",
  workers: "workers",
  itemName: "Item Name",
  workingStatus: "Working Status",
  reasons: "Reasons For Not Working",
  start: "Assembly Start Time",
  end: "Assembly End Time",
  hours: "Assembly Working Hours",
  std: "Standard Time per Piece (Sec)",
  totalQty: "Total QTY",
  okQty: "OK QTY",
  rejectedQty: "Rejected QTY",
  defects: "Types of Defects",
  totalDefects: "Total Defects",
  idealQty: "Ideal Quantity",
  idealQtyPerHour: "Ideal Quantity/Hour",
  otherActivity: "Other Activity Carried out",
  otherActivityMin: "Time consume in Other Activity (min)",
  lunchMin: "Lunch / Tea / Washroom etc (Min)",
  otherMin: "Other (Min)",
  totalIdle: "Total Idle (Min)",
  effective: "Effective Assembly Time (hr)",
  unreported: "Unreported (min)",
  productivity: "Productivity without considering Lunch, tea, etc. (%)",
  productivityLunch: "Productivity Considering Lunch, tea, etc. (%)",
  remarks: "Remarks",
};

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as FINAL ASSEMBLY if it is named so — the whole name, so MODULAR
// FRAME ASSEMBLY is never taken for it.
export const isFinalAssemblyProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/final-assembly-data-entry\/?$/.test(page);
  return /\bfinal\s*assembly\b/i.test(process?.processName || "");
};

// Every Working Status but PRESENT is a day the worker didn't work — such an
// entry is status-only. Keep in step with server/models/FinalAssemblyEntry.js.
export const NON_WORKING_STATUSES = WORKING_STATUSES.filter((s) => s !== "PRESENT");
export const isStatusOnly = (v) => NON_WORKING_STATUSES.includes(String(v?.workingStatus ?? "").trim());

// The sheet's Types of Defects, in its order. Keep in step with
// FA_DEFECT_REASONS in server/models/FinalAssemblyEntry.js.
export const FA_DEFECT_REASONS = ["Wrong Assembly", "Broken Screw", "Wrong Clamping", "Other"];

// Idle Time on this sheet: Lunch / Tea / Washroom and Other only.
export const FA_IDLE_FIELDS = [
  { key: "lunchMin", label: FA_LABELS.lunchMin },
  { key: "otherMin", label: FA_LABELS.otherMin },
];

// One worker takes up to this many entries on a date (the paper has nine for
// one worker on one date), and they MAY overlap in time. Keep in step with
// MAX_SLOTS in server/models/FinalAssemblyEntry.js.
export const FA_MAX_ENTRIES_PER_DAY = 12;

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && v !== undefined && Number.isFinite(v);

// Total Defects — the defect boxes added up (blank ones as 0); null while none
// is typed and there's no Total QTY either.
export const defectTotal = (row) => {
  const typed = FA_DEFECT_REASONS.map((r) => num(row?.rejectBreakdown?.[r])).filter(isNum);
  if (!typed.length && !isNum(num(row?.actualQty))) return null;
  return typed.reduce((a, b) => a + b, 0);
};

// A row as the shared formulas read it: OK / Rejected from Total QTY and the
// defects (what the server stores too), Effective time on Total QTY.
const withDerived = (row) => {
  if (!row) return row;
  const total = num(row.actualQty);
  const defects = defectTotal(row);
  return {
    ...row,
    runQtyBasis: "total",
    ...(isNum(total) ? { rejectedQty: defects, okQty: total - defects } : {}),
  };
};

// rowCalc's figures with this sheet's own Ideal Quantity (not floored, blank
// without a Standard Time) and Ideal Quantity/Hour (3600 ÷ Std), plus Total
// Defects and OK QTY. idealQtyFloor is the whole pieces the shift could make.
export const faRowCalc = (row) => {
  const c = rowCalc(withDerived(row));
  if (!row) return c;
  const cycle = c.totalCycleSec;
  const hasCycle = isNum(cycle) && cycle > 0;
  const idealQty = hasCycle && isNum(c.shiftHours) ? (c.shiftHours * 3600) / cycle : null;
  const total = num(row.actualQty);
  const defects = defectTotal(row);
  return {
    ...c,
    idealQty,
    idealQtyFloor: isNum(idealQty) ? Math.floor(idealQty + 1e-9) : null,
    idealQtyPerHour: hasCycle ? 3600 / cycle : null,
    // No Standard Time (PACKING): Effective time is 0, as on the paper.
    effectiveHours: isNum(c.effectiveHours) ? c.effectiveHours : isNum(c.shiftHours) ? 0 : null,
    totalDefect: defects,
    okQty: isNum(total) ? total - defects : null,
  };
};

// Unreported and the two Productivity figures, one result per row in
// sortByMachineOn order: each entry on its own (combined once for a day on
// Process Master's lock).
export const faDayCalc = (rows) => entryDayCalc((rows || []).map(withDerived));

// The formula popovers for this table's calculated headers.
export const FA_FORMULAS = {
  ...FORMULAS,
  shift: `${FA_LABELS.hours} = ${FA_LABELS.end} − ${FA_LABELS.start}`,
  cycle: `${FA_LABELS.std} — filled in from the Part when picked, can be changed for the day, and may be left blank (PACKING has none).`,
  idealQty: `${FA_LABELS.idealQty} = ${FA_LABELS.hours} × 3600 ÷ Standard Time per Piece — not rounded down; blank without a Standard Time.`,
  idealQtyPerHour: `${FA_LABELS.idealQtyPerHour} = 3600 ÷ Standard Time per Piece`,
  rejectedQty: `${FA_LABELS.rejectedQty} = ${FA_LABELS.totalDefects} = ${FA_DEFECT_REASONS.join(" + ")}. The breakdown shows each.`,
  totalDefect: `${FA_LABELS.totalDefects} = ${FA_DEFECT_REASONS.join(" + ")}`,
  okQty: `${FA_LABELS.okQty} = ${FA_LABELS.totalQty} − ${FA_LABELS.totalDefects}`,
  totalStoppage: `${FA_LABELS.totalIdle} = Lunch / Tea / Washroom + Other`,
  effective: `${FA_LABELS.effective} = ${FA_LABELS.totalQty} × Standard Time per Piece ÷ 3600 — every piece counts; 0 without a Standard Time.`,
  unreported: `${FA_LABELS.unreported} = Planned Operator Shift × 60 − Effective time × 60 − Other Activity − Total Idle, for this entry (with Process Master's fixed shift: combined across the worker's whole date).`,
  productivity:
    "Productivity without considering Lunch, tea, etc. = Effective time ÷ (Planned Operator Shift − Other Activity), for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  productivityLunch:
    "Productivity considering Lunch, tea, etc. = Effective time ÷ (Planned Operator Shift − Other Activity − Lunch / Tea), for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  quality: `Quality = ${FA_LABELS.okQty} ÷ ${FA_LABELS.totalQty}, for this entry.`,
  availability:
    "Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Working Hours − Total Idle − Other Activity; Planned Production Time = Planned Operator Shift − Lunch / Tea. Above 100% (red) sends the entry to Admin review.",
  performance:
    "Performance = Standard Time per Piece × Total QTY ÷ Operating Time, for this entry (blank without a Standard Time). Above 100% (red) sends the entry to Admin review.",
};
