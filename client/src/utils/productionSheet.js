/**
 * utils/productionSheet.js
 * ────────────────────────────
 * Column definitions and formulas for the Production Data Entry sheet.
 * Formulas reproduce the Indo "Section Wise Eff. — CNC" Excel sheet and
 * were checked against its values (e.g. 06/04 7A, 07/04 7D, 22/04 7B).
 *
 * Per row:
 *   Total cycle time (sec)   = Op 1 + … + Op 5
 *   Machine Shift Time (h)   = Machine OFF − Machine ON
 *   Ideal Quantity           = Shift h × 3600 ÷ Total cycle sec
 *   Ideal Quantity/Hours     = 3600 ÷ Total cycle sec
 *   Rejected Quantity        = Actual − OK          (derived, never typed)
 *   % OK Quantity            = OK ÷ Actual
 *   Total Stoppage (min)     = sum of the ten stoppage columns
 *   Effective Run Time (h)   = OK × Total cycle sec ÷ 3600
 *   Setup Efficiency (%)     = Effective h ÷ Shift h
 *
 * Per machine per day (all three rows of that machine on that date):
 *   Unreported Time (min)                       = Shift − Stoppage − Effective
 *   OEE considering losses                      = Effective ÷ (Shift − Stoppage)
 *   OEE not considering losses but lunch        = Effective ÷ (Shift − Lunch)
 *   OEE not considering losses but lunch and COT = Effective ÷ (Shift − Lunch − Setup)
 * (all in minutes; COT = Setup Time)
 *
 * Utilized / Unutilized Machine Time are shown but not calculated yet —
 * their formula is still to be confirmed with Indo.
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

export function rowCalc(row) {
  if (!row) return {};
  // The entry form supplies one `cycleTimeSec`; records saved by the old grid
  // hold the op-wise `cycleOpsSec` array, which is summed. Either works.
  const single = num(row.cycleTimeSec);
  const cycle = isNum(single) ? single : totalCycleSec(row.cycleOpsSec);
  const shiftMin = spanMinutes(row.machineOnTime, row.machineOffTime);
  const shiftHours = shiftMin === null ? null : shiftMin / 60;
  const ok = num(row.okQty);
  const actual = num(row.actualQty);
  // Rejected is always Actual − OK. Rows saved before Actual Quantity existed
  // have no actualQty, so their stored rejectedQty is used instead.
  const rej = isNum(actual) && isNum(ok) ? Math.max(0, actual - ok) : num(row.rejectedQty);

  const stoppageVals = STOPPAGE_FIELDS.map((f) => num(row[f.key])).filter(isNum);
  const totalStoppageMin = stoppageVals.length ? stoppageVals.reduce((s, v) => s + v, 0) : null;

  const effectiveHours = cycle && isNum(ok) ? (ok * cycle) / 3600 : null;
  // Falls back to OK + Rejected for rows that predate Actual Quantity.
  const totalProduced = isNum(actual) ? actual : (ok || 0) + (rej || 0);

  return {
    totalCycleSec: cycle,
    actualQty: isNum(actual) ? actual : isNum(ok) || isNum(rej) ? totalProduced : null,
    rejectedQty: rej,
    shiftHours,
    idealQty: cycle && shiftHours !== null ? (shiftHours * 3600) / cycle : null,
    idealQtyPerHour: cycle ? 3600 / cycle : null,
    pctOk: totalProduced > 0 && (isNum(ok) || isNum(rej)) ? (ok || 0) / totalProduced : null,
    totalStoppageMin,
    effectiveHours,
    setupEfficiency: effectiveHours !== null && shiftHours > 0 ? effectiveHours / shiftHours : null,
  };
}

// Day-level results for one machine on one date, from its (up to) three rows.
export function dayCalc(rows) {
  let shiftMin = 0;
  let stoppageMin = 0;
  let lunchMin = 0;
  let setupMin = 0;
  let effectiveMin = 0;
  let hasShift = false;

  for (const row of rows) {
    if (!row) continue;
    const c = rowCalc(row);
    if (c.shiftHours !== null) {
      shiftMin += c.shiftHours * 60;
      hasShift = true;
    }
    stoppageMin += c.totalStoppageMin || 0;
    lunchMin += num(row.lunchMin) || 0;
    setupMin += num(row.setupMin) || 0;
    effectiveMin += (c.effectiveHours || 0) * 60;
  }

  if (!hasShift) return { unreportedMin: null, oeeLosses: null, oeeLunch: null, oeeLunchCot: null };

  const ratio = (denominator) => (denominator > 0 ? effectiveMin / denominator : null);
  return {
    unreportedMin: shiftMin - stoppageMin - effectiveMin,
    oeeLosses: ratio(shiftMin - stoppageMin),
    oeeLunch: ratio(shiftMin - lunchMin),
    oeeLunchCot: ratio(shiftMin - lunchMin - setupMin),
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
