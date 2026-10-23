import { fmtNum } from "./productionSheet";
import { hoursToHm } from "./shiftHours";
import { stoppageLimitMin } from "./entryValidation";

/**
 * utils/limitNotice.js
 * ───────────────────────
 * The popup every entry form (all eight sheets) raises when a figure goes past
 * what the entry's own shift allows, as worked out from its Machine ON / OFF
 * Time and time per piece:
 *   Quantity  OK + Rejected (CNC: Actual Quantity) over Ideal Quantity
 *   Stoppage  all stoppage together over the Machine Shift
 * Shown the moment a keystroke is blocked (the box won't take it), and on Save
 * for an entry that went over another way — its times or time per piece
 * changed after the quantity was typed. The rules themselves are each sheet's
 * validation and server controller; this only explains them with the numbers.
 *
 * Each builder returns [message, options] for AlertContext's notice().
 */

const n = (v) => (v === "" || v === null || v === undefined ? 0 : Number(v) || 0);

// `words` lets a sheet say it its own way — After Powder Coating's worker
// inspects pieces within Inspection Working Hours, it doesn't make them.
const MACHINE_WORDS = { who: "Machine", canMake: "this machine can make", shift: "Machine Shift" };
export const WORKER_WORDS = { who: "Worker", canMake: "this worker can inspect", shift: "Inspection Working Hours" };
// RUBBER's worker makes pieces, within a Worker Shift Time.
export const RUBBER_WORDS = { who: "Worker", canMake: "this worker can make", shift: "Worker Shift Time" };
const whoRow = (machine, words) => (machine ? [{ label: words.who, value: machine }] : []);

export const qtyNotice = ({ calc, entered, label = "OK + Rejected", machine = "", words = MACHINE_WORDS }) => [
  `As per calculation, ${words.canMake} at most ${fmtNum(calc.idealQty)} pieces in this shift.`,
  {
    title: "Can't add this much quantity",
    details: [
      ...whoRow(machine, words),
      { label: words.shift, value: `${hoursToHm(calc.shiftHours)} hr` },
      { label: "Time per piece", value: `${fmtNum(calc.totalCycleSec)} sec` },
      { label: "Ideal Quantity (most possible)", value: fmtNum(calc.idealQty) },
      { label, value: fmtNum(entered), highlight: true },
    ],
    hint: `Check the quantity, the time per piece, or the ${words === MACHINE_WORDS ? "Machine ON / OFF" : "Start / End"} Time.`,
  },
];

export const stoppageNotice = ({ limitMin, totalMin, machine = "", words = MACHINE_WORDS }) => [
  `Stoppage happens within the ${words.shift}, so all of it together can't be more than ${limitMin} min.`,
  {
    title: "Can't add this much stoppage",
    details: [
      ...whoRow(machine, words),
      { label: words.shift, value: `${limitMin} min` },
      { label: "Total stoppage", value: `${fmtNum(totalMin)} min`, highlight: true },
    ],
    hint: `Check the stoppage minutes, or the ${words === MACHINE_WORDS ? "Machine ON / OFF" : "Start / End"} Time.`,
  },
];

// On Save: the first block whose quantity or stoppage is past its limit —
// { index, field, notice } — or null. Only a field its validation already
// flagged counts (a status-only day has no quantities to check). Save moves
// focus to that field itself once the popup is closed.
export const firstOverLimit = (
  entries,
  errorsList,
  rowCalc,
  { qtyKey = "okQty", qtyLabel = qtyKey === "actualQty" ? "Actual Quantity" : "OK + Rejected", words = MACHINE_WORDS, machineName = {} } = {},
) => {
  for (let index = 0; index < entries.length; index += 1) {
    const v = entries[index];
    const errors = errorsList[index] || {};
    const machine = machineName[v.machine] || "";
    const calc = rowCalc(v);
    const entered = qtyKey === "actualQty" ? n(v.actualQty) : n(v.okQty) + n(v.rejectedQty);
    if (qtyKey && errors[qtyKey] && Number.isFinite(calc.idealQty) && entered > calc.idealQty) {
      const [message, options] = qtyNotice({ calc, entered, label: qtyLabel, machine, words });
      return { index, field: qtyKey, notice: [message, { ...options, returnFocus: false }] };
    }
    const limitMin = stoppageLimitMin(v);
    if (errors.stoppageTotal && limitMin !== null) {
      // Other Activity (After Powder Coating) counts against the same limit.
      const totalMin = (calc.totalStoppageMin || 0) + n(v.otherActivityMin);
      const [message, options] = stoppageNotice({ limitMin, totalMin, machine, words });
      return { index, field: "stoppageTotal", notice: [message, { ...options, returnFocus: false }] };
    }
  }
  return null;
};
