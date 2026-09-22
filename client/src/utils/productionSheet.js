/**
 * utils/productionSheet.js
 * ────────────────────────────
 * Column definitions and formulas for the Production Data Entry sheet.
 * Formulas reproduce the Indo "Section Wise Eff. — CNC" Excel sheet and
 * were checked against its values (e.g. 06/04 7A, 07/04 7D, 22/04 7B).
 *
 * Per row (blank while Working Status — the Operator cell — is empty):
 *   1  Total cycle time (sec)   = the item's own Total Cycle Time (blank without Part Name)
 *   2  Machine Shift Time (h)   = MOD(OFF − ON, 1) × 24
 *   3  Ideal Quantity           = Shift min × 60 ÷ Cycle sec (not reduced by Planned Down)
 *   4  Ideal Quantity/Hours     = Ideal Quantity ÷ Shift h
 *   5  % OK Quantity            = OK ÷ (OK + Rejected)
 *   7  Total Stoppage (min)     = sum of the ten stoppage columns
 *   8  Effective Run Time (h)   = OK × Cycle sec ÷ 3600
 *   10 Setup Efficiency (%)     = Effective h ÷ Shift h
 *      Rejected Quantity        = Actual − OK          (derived, never typed)
 *
 * Per row again, but looking forward ("this row + next row + next 2 rows" in
 * Excel — a rolling 3-row window starting at that row, bounded to this
 * machine's own rows on this date, never a single value shared by every row
 * of the day). Blank while that row's own Planned Operator Shift Time is
 * empty (Unutilized instead follows that row's own Working Status):
 *   9  Unreported Time (min)    = Shift×60 − Effective×60 − Stoppage
 *   11 OEE considering losses   = Effective ÷ (Shift − Stoppage/60)
 *   12 OEE … but lunch          = Effective ÷ (Shift − Lunch/60)
 *   13 OEE … but lunch and COT  = Effective ÷ (Shift − Lunch/60 − Setup/60)
 *   6  Unutilized Machine Time  = (12 − (Shift − Stoppage/60)) ÷ 11
 */

export const SLOTS_PER_DAY = 3;
export const CYCLE_OPS = 5;

// The named operation-time boxes, in sheet order — Total Cycle Time is their
// sum (formula 1). Copied onto an entry when its Part Name is picked, and
// still editable there afterwards. Kept in step with CYCLE_OP_FIELDS in
// server/models/Item.js. Two operations really are both called "Other
// Operation (sec)" on the sheet; they're told apart here only by key.
export const CYCLE_OP_FIELDS = [
  { key: "drillingSec", label: "Drilling (sec)" },
  { key: "boringSec", label: "Boring (sec)" },
  { key: "threadingSec", label: "Threading (sec)" },
  { key: "tappingSec", label: "Tapping (sec)" },
  { key: "chamferingSec", label: "Chamfering (sec)" },
  { key: "otherOp1Sec", label: "Other Operation (sec)" },
  { key: "otherOp2Sec", label: "Other Operation (sec)" },
  { key: "clampDeclampSec", label: "Clamp/Declamp (sec)" },
];

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

  // 1) Total cycle time is the item's own Total Cycle Time box — typed on
  // its own, not the sum of Drilling/Boring/Threading/… below. On the real
  // sheet the two can genuinely differ (an item's measured operations don't
  // always add up to its set cycle time), so that sum is only a fallback
  // for a row that predates the Total Cycle Time box, same as the older
  // single `cycleTimeSec` and the old grid's op-wise `cycleOpsSec` array.
  // An operation unticked for this entry (excludedOps) has its own seconds
  // taken back out — this entry's own figure, the item's master untouched.
  // Blank without a Part Name.
  const excluded = new Set(row.excludedOps || []);
  const excludedSec = sumOrZero(CYCLE_OP_FIELDS.filter((f) => excluded.has(f.key)).map((f) => num(row[f.key])));
  const ownTotal = num(row.totalCycleSec);
  const opFields = CYCLE_OP_FIELDS.filter((f) => !excluded.has(f.key)).map((f) => num(row[f.key]));
  const hasOpFields = opFields.some(isNum);
  const legacySingle = num(row.cycleTimeSec);
  const opsTotal = isNum(ownTotal)
    ? ownTotal - excludedSec
    : hasOpFields
      ? sumOrZero(opFields)
      : isNum(legacySingle)
        ? legacySingle
        : totalCycleSec(row.cycleOpsSec);
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

  // 3) Ideal Quantity = shift min × 60 ÷ cycle sec. The formula as first given
  // subtracted Planned Down Time here too, but two real entries checked
  // against it (06/08/2026, machine 7A) disproved that: an 8-hour shift with
  // no down time and a 3-hour shift with 90 min of it both came out to
  // exactly 40 pieces/hour once the subtraction was dropped, matching their
  // real Ideal Quantities (320 and 120) exactly — with it, neither did.
  const idealQty = shiftMin !== null ? ratio(shiftMin * 60, cycle) : null;

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

// One result per row of one machine's one date, not one shared value for the
// whole group. The Excel formulas read "this row + next row + next 2 rows" —
// a rolling 3-row window starting at that row, not a single total spread
// across every row of the day. So entry 1 of a day looks ahead across
// entries 1‑3, entry 2 across 2‑3, and entry 3 (or a day with only one or two
// entries) looks at just what is actually there — three different entries
// give three different numbers, never one repeated across all of them.
// The window never reaches past this machine's own rows for this date, so a
// short day's last entry isn't quietly padded out with the next date's rows.
// Each row's own Working Status / Planned Operator Shift Time (not the
// group's) decides whether that row's own figures are blank.
// Rows of one machine's one date, in the order "next row" means in every
// formula below — by actual Machine ON Time, not Entry No. A supervisor can
// save entries in any order (edit one later, add a missed shift after the
// fact, …), and Entry No. is just which of a machine's (up to three) slots a
// record happened to land in; it does not have to match the order shifts
// actually ran in. A row with no valid time (rare — usually only a status
// row like ABSENT) sorts last, by Entry No. among itself. Exported so a
// caller matching dayCalc's results back to specific rows (by _id) sorts
// them exactly the same way first, rather than risking a second sort that
// quietly drifts out of step with this one.
export function sortByMachineOn(rows) {
  const onMinutes = (r) => toMinutes(r?.machineOnTime);
  return (rows || [])
    .filter(Boolean)
    .map((r, i) => ({ r, i, on: onMinutes(r) }))
    .sort((a, b) => {
      if (a.on === null && b.on === null) return a.i - b.i;
      if (a.on === null) return 1;
      if (b.on === null) return -1;
      return a.on - b.on || a.i - b.i;
    })
    .map((x) => x.r);
}

export function dayCalc(rows) {
  const list = sortByMachineOn(rows);
  const calcs = list.map(rowCalc);

  return list.map((row, i) => {
    const windowRows = list.slice(i, i + 3);
    const windowCalcs = calcs.slice(i, i + 3);

    const shiftH = sumOrZero(windowCalcs.map((c) => c.shiftHours));
    const stoppageMin = sumOrZero(windowCalcs.map((c) => c.totalStoppageMin));
    const effectiveH = sumOrZero(windowCalcs.map((c) => c.effectiveHours));
    const lunchMin = sumOrZero(windowRows.map((r) => num(r.lunchMin)));
    const setupMin = sumOrZero(windowRows.map((r) => num(r.setupMin)));

    const working = workingStatusOf(row) !== "";
    const planned = isNum(num(row.plannedOperatorShiftHours));

    // The clock gap between this row's own Machine OFF and the next row's
    // Machine ON — a genuine blind spot with no entry at all, not a typed
    // stoppage reason and not automatically "downtime" of any kind (an
    // operator handover, a real gap, or just two shifts saved slightly
    // apart). Shown so it can be *seen*, never folded into Total Stoppage
    // or assigned a cause on its own. Blank for the day's last saved row —
    // there's nothing after it (yet) to measure a gap against.
    const next = list[i + 1];
    const thisOff = toMinutes(row.machineOffTime);
    const nextOn = next ? toMinutes(next.machineOnTime) : null;
    // Plain clock-minute subtraction, not spanMinutes' midnight-wrap logic —
    // both times are the same date's, so a negative gap only ever means
    // the next shift was logged as starting at or before this one ended
    // (an overlap or a typo), which reads as no gap rather than as ~24h.
    const rawGapMin = thisOff !== null && nextOn !== null ? nextOn - thisOff : null;
    const gapMin = rawGapMin === null ? null : Math.max(0, rawGapMin);

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
      gapMin,
    };
  });
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
