/**
 * utils/productionSheet.js
 * ────────────────────────────
 * Column definitions and formulas for the Production Data Entry sheet.
 * Formulas reproduce the Indo "Section Wise Eff. — CNC" Excel sheet and
 * were checked against its values (e.g. 06/04 7A, 07/04 7D, 22/04 7B).
 *
 * Per row (blank while Working Status — the Operator cell — is empty):
 *   1  Total cycle time (sec)   = sum of operation times (blank without Part Name)
 *   2  Machine Shift Time (h)   = MOD(OFF − ON, 1) × 24
 *   3  Ideal Quantity           = (Shift min − Planned Down min) × 60 ÷ Cycle sec
 *   4  Ideal Quantity/Hours     = Ideal Quantity ÷ Shift h
 *   5  % OK Quantity            = OK ÷ (OK + Rejected)
 *   7  Total Stoppage (min)     = sum of the ten stoppage columns
 *   8  Effective Run Time (h)   = OK × Cycle sec ÷ 3600
 *   10 Setup Efficiency (%)     = Effective h ÷ Shift h
 *      Rejected Quantity        = Actual − OK          (derived, never typed)
 *
 * Per machine per day ("this row + next 2 rows" in Excel = its three rows);
 * blank while Planned Operator Shift Time is empty:
 *   9  Unreported Time (min)    = Shift×60 − Effective×60 − Stoppage
 *   11 OEE considering losses   = Effective ÷ (Shift − Stoppage/60)
 *   12 OEE … but lunch          = Effective ÷ (Shift − Lunch/60)
 *   13 OEE … but lunch and COT  = Effective ÷ (Shift − Lunch/60 − Setup/60)
 *   6  Unutilized Machine Time  = (12 − (Shift − Stoppage/60)) ÷ 11
 *      (blank while Working Status is empty)
 */

export const SLOTS_PER_DAY = 3;
export const CYCLE_OPS = 5;

// Offered in the entry form's Reject Reason dropdown and grouped on the
// dashboard. Keep in step with REJECT_REASONS in server/models/ProductionEntry.js.
export const REJECT_REASONS = [
  "Dimension Out",
  "Tool Mark",
  "Surface Finish",
  "Porosity / Blow Hole",
  "Material Defect",
  "Setting Mistake",
  "Operator Mistake",
  "Machine Fault",
  "Other",
];

export const WORKING_STATUSES = ["M/C OFF", "ABSENT", "SUNDAY", "HOLIDAY", "STOCK COUNTING", "REPORT NOT FILLUP"];

export const STOPPAGE_FIELDS = [
  { key: "plannedDownMin", label: "Planned Down Time (min)" },
  { key: "setupMin", label: "Setup Time (min)" },
  { key: "noManPowerMin", label: "No Man Power (min)" },
  { key: "materialShiftingMin", label: "Material Shifting (min)" },
  { key: "noMaterialMin", label: "No Material (min)" },
  { key: "bdMechMin", label: "B.D. Mech. (min)" },
  { key: "bdEleMin", label: "B.D. Ele. (min)" },
  { key: "noPowerMin", label: "No Power (min)" },
  { key: "lunchMin", label: "Lunch/Tea/Wash room etc. (min)" },
  { key: "otherMin", label: "Other (min)" },
];

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);

// Accepts what people type in a time cell — "9", "930", "0930", "9:30",
// "9.30", "21:30" — and returns "HH:mm", or null if it isn't a valid time.
export const normalizeTime = (raw) => {
  const s = String(raw ?? "").trim().replace(".", ":");
  let m = s.match(/^(\d{1,2}):(\d{2})$/) || s.match(/^(\d{1,2})(\d{2})$/);
  if (!m && /^\d{1,2}$/.test(s)) m = [s, s, "00"];
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
};

const toMinutes = (hhmm) => {
  const t = normalizeTime(hhmm);
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

// OFF − ON in minutes; an OFF earlier than ON is taken as running past midnight.
export const spanMinutes = (on, off) => {
  const a = toMinutes(on);
  const b = toMinutes(off);
  if (a === null || b === null) return null;
  const diff = b - a;
  return diff < 0 ? diff + 1440 : diff;
};

export const totalCycleSec = (ops) => {
  const vals = (ops || []).map(num).filter(isNum);
  return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
};

// The Indo sheet's "Working Status" cell holds the operator's name, or a
// status such as ABSENT / M/C OFF when nobody ran the machine. Most formulas
// stay blank until it is filled.
const workingStatusOf = (row) => String(row?.operator || row?.workingStatus || "").trim();

const sumOrZero = (vals) => vals.reduce((s, v) => s + (isNum(v) ? v : 0), 0);
const ratio = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);

export function rowCalc(row) {
  if (!row) return {};
  const working = workingStatusOf(row) !== "";

  // 1) Total cycle time = sum of the operation times; blank without a Part Name.
  // The entry form supplies one `cycleTimeSec`; records saved by the old grid
  // hold the op-wise `cycleOpsSec` array, which is summed. Either works.
  const single = num(row.cycleTimeSec);
  const opsTotal = isNum(single) ? single : totalCycleSec(row.cycleOpsSec);
  const cycle = String(row.itemName || "").trim() ? opsTotal : null;

  // 2) Machine Shift Time = MOD(OFF − ON, 1) × 24.
  const shiftMin = working ? spanMinutes(row.machineOnTime, row.machineOffTime) : null;
  const shiftHours = shiftMin === null ? null : shiftMin / 60;

  const ok = num(row.okQty);
  const actual = num(row.actualQty);
  // Rejected is always Actual − OK. Rows saved before Actual Quantity existed
  // have no actualQty, so their stored rejectedQty is used instead.
  const rej = isNum(actual) && isNum(ok) ? Math.max(0, actual - ok) : num(row.rejectedQty);
  // Falls back to OK + Rejected for rows that predate Actual Quantity.
  const totalProduced = isNum(actual) ? actual : (ok || 0) + (rej || 0);

  // 3) Ideal Quantity = (shift min − Planned Down Time) × 60 ÷ cycle sec.
  const idealQty =
    shiftMin !== null ? ratio((shiftMin - (num(row.plannedDownMin) || 0)) * 60, cycle) : null;

  // 7) Total Stoppage = sum of the ten stoppage columns.
  const totalStoppageMin = working ? sumOrZero(STOPPAGE_FIELDS.map((f) => num(row[f.key]))) : null;

  // 8) Effective Machine Run Time = OK × cycle sec ÷ 3600.
  const effectiveHours = working && isNum(cycle) ? ((ok || 0) * cycle) / 3600 : null;

  return {
    totalCycleSec: cycle,
    actualQty: isNum(actual) ? actual : isNum(ok) || isNum(rej) ? totalProduced : null,
    rejectedQty: rej,
    shiftHours,
    idealQty,
    // 4) Ideal Quantity/Hours = Ideal Quantity ÷ Machine Shift Time.
    idealQtyPerHour: ratio(idealQty, shiftHours),
    // 5) % OK Quantity = OK ÷ (OK + Rejected).
    pctOk: isNum(ok) ? ratio(ok, ok + (rej || 0)) : null,
    totalStoppageMin,
    effectiveHours,
    // 10) Setup Efficiency = Effective Run Time ÷ Machine Shift Time.
    setupEfficiency: ratio(effectiveHours, shiftHours),
  };
}

// Day-level results for one machine on one date. The Excel formulas read
// "this row + the next 2 rows" — i.e. all (up to) three rows of that machine
// on that date. A row whose value is blank counts as 0.
export function dayCalc(rows) {
  const list = (rows || []).filter(Boolean);
  const calcs = list.map(rowCalc);

  const shiftH = sumOrZero(calcs.map((c) => c.shiftHours));
  const stoppageMin = sumOrZero(calcs.map((c) => c.totalStoppageMin));
  const effectiveH = sumOrZero(calcs.map((c) => c.effectiveHours));
  const lunchMin = sumOrZero(list.map((r) => num(r.lunchMin)));
  const setupMin = sumOrZero(list.map((r) => num(r.setupMin)));

  const working = list.some((r) => workingStatusOf(r) !== "");
  const planned = list.some((r) => isNum(num(r.plannedOperatorShiftHours)));

  return {
    // 6) Unutilized Machine Time = (12 − (Shift h − Stoppage min ÷ 60)) ÷ 11.
    unutilized: working ? (12 - (shiftH - stoppageMin / 60)) / 11 : null,
    // 9) Unreported Time (min) = Shift × 60 − Effective × 60 − Stoppage.
    unreportedMin: planned ? shiftH * 60 - effectiveH * 60 - stoppageMin : null,
    // 11) OEE considering losses = Effective ÷ (Shift − Stoppage ÷ 60).
    oeeLosses: planned ? ratio(effectiveH, shiftH - stoppageMin / 60) : null,
    // 12) OEE not considering losses but lunch = Effective ÷ (Shift − Lunch ÷ 60).
    oeeLunch: planned ? ratio(effectiveH, shiftH - lunchMin / 60) : null,
    // 13) … but lunch and COT = Effective ÷ (Shift − Lunch ÷ 60 − Setup ÷ 60).
    oeeLunchCot: planned ? ratio(effectiveH, shiftH - lunchMin / 60 - setupMin / 60) : null,
  };
}

// ── Formatting ─────────────────────────────────────────────────────────────
export const fmtNum = (v, digits = 2) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return Number.isInteger(v) ? String(v) : v.toFixed(digits).replace(/\.?0+$/, "");
};
export const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "" : `${(v * 100).toFixed(2)}%`);

// ── Dates ──────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Every "YYYY-MM-DD" in the given "YYYY-MM" month.
export const daysOfMonth = (yyyymm) => {
  const [y, m] = yyyymm.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`);
};

export const displayDay = (iso) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export const isSunday = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay() === 0;
};

export const rowKey = (date, machineId, slot) => `${date}|${machineId}|${slot}`;
