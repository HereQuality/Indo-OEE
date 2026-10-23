import { FORMULAS } from "./sheetFormulas";
import { WORKING_STATUSES, dayCalc, rowCalc } from "./productionSheet";

/**
 * utils/rubberSheet.js
 * ──────────────────────
 * The RUBBER sheet's figures — the CNC sheet's own formulas
 * (utils/productionSheet.js), unchanged, fed this sheet's fields:
 *   Working Start / End Time      → machineOnTime / machineOffTime
 *   Worker Shift Time             → Machine Shift Time
 *   Total Cycle Time (sec)        → totalCycleSec
 *   Effective working Time (hr)   → Effective Run Time, on OK Qty
 * plus the two Productivity figures dayCalc works out per worker per date.
 * There's no machine: each row's `machine` is its worker's id (the API sets
 * it), so the shared table and day formulas group by worker.
 */

// Which sheet a process's data entry happens on is the page it is linked to in
// Process Master (its "Data Entry Page"). A process not linked to any page yet
// is taken as RUBBER if it is named so.
export const isRubberProcess = (process) => {
  const page = process?.dataEntryMenu || "";
  if (page) return /\/rubber-data-entry\/?$/.test(page);
  return /\brubber\b/i.test(process?.processName || "");
};

// Every Working Status but PRESENT is a day the worker didn't work — such an
// entry is status-only. Keep in step with server/models/RubberEntry.js.
export const NON_WORKING_STATUSES = WORKING_STATUSES.filter((s) => s !== "PRESENT");
export const isStatusOnly = (v) => NON_WORKING_STATUSES.includes(String(v?.workingStatus ?? "").trim());

// The sheet's stoppage columns, in its own order and wording — no B.D. Mech. /
// B.D. Ele.: a worker has no machine to break down. Keep in step with
// RUBBER_STOPPAGE_KEYS in server/models/RubberEntry.js.
export const RUBBER_STOPPAGE_FIELDS = [
  { key: "plannedDownMin", label: "Planned downtime (min)" },
  { key: "setupMin", label: "Set-up Time (min)" },
  { key: "noManPowerMin", label: "No Manpower (min)" },
  { key: "materialShiftingMin", label: "Material Shifting (min)" },
  { key: "noMaterialMin", label: "No Material (min)" },
  { key: "noPowerMin", label: "No Power (min)" },
  { key: "lunchMin", label: "Lunch / Tea / Washroom etc (min)" },
  { key: "otherMin", label: "Others (min)" },
];

export const rubberRowCalc = (row) => rowCalc(row);
export const rubberDayCalc = (rows) => dayCalc(rows || []);

// The formula popovers for this table's calculated headers.
export const RUBBER_FORMULAS = {
  ...FORMULAS,
  shift: "Worker Shift Time = Working End Time − Working Start Time",
  cycle: "Total Cycle Time — filled in from the Part when picked, and can be changed for the day.",
  idealQty: "IDEAL Quantity = Worker Shift Time × 3600 ÷ Total Cycle Time, rounded down.",
  idealQtyPerHour: "IDEAL Quantity / Hour = IDEAL Quantity ÷ Worker Shift Time",
  rejectedQty: "Rejected Quantity is typed on the form for this entry — it isn't worked out from the other figures.",
  availability:
    "Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Worker Shift Time − every stoppage; Planned Production Time = Planned Operator Shift − Lunch / Tea − Planned downtime (the planned stops). Above 100% (red) sends the entry to Admin review.",
  totalStoppage: "Total stoppage = every stoppage column added up, Lunch / Tea / Washroom included.",
  effective: "Effective working Time (hr) = Actual OK Quantity × Total Cycle Time ÷ 3600",
  unreported:
    "Unreported Time (min) = Planned Operator Shift − Effective working Time − Total stoppage, combined across every entry of this worker's date.",
  productivity:
    "Productivity without considering Lunch, Tea, etc. = Effective working Time ÷ Planned Operator Shift, combined across every entry of this worker's date.",
  productivityLunch:
    "Productivity considering Lunch, Tea, etc. = Effective working Time ÷ (Planned Operator Shift − Lunch / Tea), combined across every entry of this worker's date.",
};
