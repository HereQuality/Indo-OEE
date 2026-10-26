import { FORMULAS } from "./sheetFormulas";
import { WORKING_STATUSES, entryDayCalc, rowCalc } from "./productionSheet";

/**
 * utils/mfaSheet.js
 * ───────────────────
 * The MODULAR FRAME ASSEMBLY sheet's figures (sheet key "mfa" — its own
 * process, on RAW CASTING's template, utils/rawCastingSheet.js). Kept per
 * WORKER: each row's `machine` is its worker's id (the API sets it), so the
 * shared table and day formulas group by worker. The CNC sheet's own formulas
 * (utils/productionSheet.js), fed this sheet's fields:
 *   Assembly Start / End Time        → machineOnTime / machineOffTime
 *   Assembly Working Hours           = End − Start
 *   Standard Assembly Time / pc      → totalCycleSec (prefilled from the Part)
 *   TOTAL QTY / OK QTY               → actualQty / okQty; Rejected QTY = TOTAL − OK
 *                                      (no reason split — Remarks only)
 *   Ideal Assembly Quantity          = Hours × 3600 ÷ Std — NOT floored (2 decimals)
 *   Ideal Assembly Quantity/Hour     = 3600 ÷ Std
 *   Ideal Assembly Time (hr)         = TOTAL × Std ÷ 3600 (runQtyBasis "total")
 *   Unreported Time                  = Planned×60 − Ideal Assembly Time×60 − Other Activity − Total Idle
 *   Productivity without Lunch, tea  = Ideal Assembly Time ÷ (Planned − Other Activity ÷ 60)
 *   Productivity considering Lunch   = Ideal Assembly Time ÷ (Planned − Other Activity ÷ 60 − Lunch ÷ 60)
 * ("Other" idle time doesn't lower either Productivity.) The paper has no
 * Planned column: each of its rows works on its own Working Hours, so every
 * entry's Unreported / Productivity is its own (entryDayCalc) — typed Planned =
 * the Working Hours reproduces the paper's rows exactly
 * (utils/mfaSheet.test.mjs); a day on Process Master's lock is combined once,
 * as on every other sheet.
 */

// The sheet's timing columns, worded for assembly — the paper's own header for
// them wasn't sent, so this is the one place to rename them on the client
// (the form, the table, the formulas, the rules and Part Master read them
// from here). Keep in step with MFA_LABELS in server/models/MfaEntry.js.
export const MFA_LABELS = {
  start: "Assembly Start Time",
  end: "Assembly End Time",
  hours: "Assembly Working Hours",
  cycle: "Standard Assembly Time per Piece",
  idealQty: "Ideal Assembly Quantity",
  idealQtyPerHour: "Ideal Assembly Quantity/Hour",
  effective: "Ideal Assembly Time (In Hour)",
};

// The limit popups (utils/limitNotice.js) in this sheet's words: a worker's
// Assembly Working Hours, Start / End.
export const MFA_WORDS = { who: "Worker", canMake: "this worker can assemble", shift: MFA_LABELS.hours };

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as MODULAR FRAME ASSEMBLY if it is named so — by the whole name, so
// MODULAR FRAME DRILLING and FINAL ASSEMBLY are never taken for it.
export const isMfaProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/modular-frame-assembly-data-entry\/?$/.test(page);
  return /\bmodular\s*frame\s*assembly\b/i.test(process?.processName || "");
};

// Every Working Status but PRESENT is a day the worker didn't work — such an
// entry is status-only. Keep in step with server/models/MfaEntry.js.
export const NON_WORKING_STATUSES = WORKING_STATUSES.filter((s) => s !== "PRESENT");
export const isStatusOnly = (v) => NON_WORKING_STATUSES.includes(String(v?.workingStatus ?? "").trim());

// Idle Time on this sheet: Lunch / Tea / Washroom and Other only.
export const MFA_IDLE_FIELDS = [
  { key: "lunchMin", label: "Lunch / Tea / Washroom etc (Min)" },
  { key: "otherMin", label: "Other (Min)" },
];

// One worker takes up to this many entries on a date. Keep in step with
// MAX_SLOTS in server/models/MfaEntry.js.
export const MFA_MAX_ENTRIES_PER_DAY = 8;

const isNum = (v) => v !== null && v !== undefined && Number.isFinite(v);

// Ideal Assembly Time counts every piece assembled — TOTAL QTY — on this sheet.
const withBasis = (row) => (row ? { ...row, runQtyBasis: "total" } : row);

// rowCalc's figures, with this sheet's own Ideal Assembly Quantity: not
// floored (the paper shows 788.37), and Ideal Assembly Quantity/Hour =
// 3600 ÷ Standard Assembly Time. idealQtyFloor is the whole pieces the
// working hours allow.
export const mfaRowCalc = (row) => {
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

// Unreported Time and the two Productivity figures, one result per row in
// sortByMachineOn order: each entry on its own, as on the paper (combined once
// for a day on Process Master's lock).
export const mfaDayCalc = (rows) => entryDayCalc((rows || []).map(withBasis));

// The formula popovers for this table's calculated headers.
export const MFA_FORMULAS = {
  ...FORMULAS,
  shift: `${MFA_LABELS.hours} = ${MFA_LABELS.end} − ${MFA_LABELS.start}`,
  cycle: `${MFA_LABELS.cycle} — filled in from the Part when picked, and can be changed for the day.`,
  rejectedQty: "Rejected QTY = TOTAL QTY − OK QTY, so OK + Rejected = TOTAL.",
  idealQty: `${MFA_LABELS.idealQty} = ${MFA_LABELS.hours} × 3600 ÷ ${MFA_LABELS.cycle} — not rounded down, as on the sheet.`,
  idealQtyPerHour: `${MFA_LABELS.idealQtyPerHour} = 3600 ÷ ${MFA_LABELS.cycle}`,
  totalStoppage: "Total Idle Time (Min) = Lunch / Tea / Washroom + Other",
  effective: `${MFA_LABELS.effective} = TOTAL QTY × ${MFA_LABELS.cycle} ÷ 3600 — every piece assembled counts, rejected ones too.`,
  unreported:
    "Unreported Time (min) = Planned Operator Shift × 60 − Ideal Assembly Time × 60 − Time in Other Activity − Total Idle Time, for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  productivity:
    "Productivity without considering Lunch, tea, etc. = Ideal Assembly Time ÷ (Planned Operator Shift − Other Activity ÷ 60), for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  productivityLunch:
    "Productivity considering Lunch, tea, etc. = Ideal Assembly Time ÷ (Planned Operator Shift − Other Activity ÷ 60 − Lunch / Tea ÷ 60), for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  quality: "Quality = OK QTY ÷ TOTAL QTY, for this entry.",
  availability:
    `Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = ${MFA_LABELS.hours} − Total Idle Time − Other Activity; Planned Production Time = Planned Operator Shift − Lunch / Tea. Above 100% (red) sends the entry to Admin review.`,
  performance:
    `Performance = ${MFA_LABELS.cycle} × TOTAL QTY ÷ Operating Time, for this entry — how fast the assembly went against the standard time. Above 100% (red) sends the entry to Admin review: usually a wrong time per piece, quantity or idle time.`,
};
