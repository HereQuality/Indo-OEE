/**
 * utils/productionSheet.js
 * ────────────────────────────
 * Column definitions and formulas for the Production Data Entry sheet.
 * Formulas reproduce the Indo "Section Wise Eff. — CNC" Excel sheet and
 * were checked against its values (e.g. 06/04 7A, 07/04 7D, 22/04 7B).
 *
 * Per row:
 *   2  Machine Shift Time (h)   = MOD(OFF − ON, 1) × 24 (as soon as ON/OFF are typed,
 *                                 regardless of Working Status/Operator)
 *   1  Total cycle time (sec)   = the item's own Total Cycle Time (blank without Part Name)
 *   3  Ideal Quantity           = FLOOR(Shift min × 60 ÷ Cycle sec) (not reduced by Planned
 *                                 Down; floored — a fractional target can't actually be made)
 *   4  Ideal Quantity/Hours     = Ideal Quantity ÷ Shift h
 *   5  % OK Quantity            = OK ÷ (OK + Rejected)
 *   7  Total Stoppage (min)     = sum of the ten stoppage columns (whatever is typed,
 *                                 regardless of Working Status/Operator)
 *   8  Effective Run Time (h)   = OK × Cycle sec ÷ 3600 (as soon as OK Quantity and Cycle Time
 *                                 are there, regardless of Working Status/Operator)
 *   10 Setup Efficiency (%)     = Effective h ÷ Shift h
 *      Actual Quantity          = typed on the form, never more than Ideal Quantity
 *      Rejected Quantity        = Actual Quantity − OK   (derived, never typed, so OK + Rejected
 *                                 = Actual always holds; the Rejection Master split must add up to it)
 *   6  Unutilized Machine Time  = (12 − (Shift − Lunch/60)) ÷ 11, this row's own Shift/
 *                                 Lunch only — never blended with another entry of the
 *                                 same machine/date.
 *
 * Combined across every entry of this machine's date (not a per-row or windowed
 * figure — one machine can have several entries/slots on one date, and these four
 * are that whole date's totals, so every one of that machine's entries for the day
 * shows the same number). Pure math off the day's totals — none of them use Planned
 * Operator Shift Time or Working Status/Operator, so none wait on those:
 *   9  Unreported Time (min)    = Day Shift×60 − Day Effective×60 − Day Stoppage
 *   11 OEE considering losses   = Day Effective ÷ (Day Shift − Day Stoppage/60)
 *   12 OEE … but lunch          = Day Effective ÷ (Day Shift − Day Lunch/60)
 *   13 OEE … but lunch and Setup Time = Day Effective ÷ (Day Shift − Day Lunch/60 − Day Setup/60)
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

// What to call an operation wherever it is shown. Both "Other Operation"
// entries share one label in CYCLE_OP_FIELDS, so the second is told apart here
// as "Other Operation 2 (sec)" — one place, so the entry form, the entries table
// and Item Master can't disagree about it.
export const cycleOpLabel = (f) => (f.key === "otherOp2Sec" ? `${f.label.replace(" (sec)", "")} 2 (sec)` : f.label);

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

const sumOrZero = (vals) => vals.reduce((s, v) => s + (isNum(v) ? v : 0), 0);
const ratio = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);

export function rowCalc(row) {
  if (!row) return {};

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

  // 2) Machine Shift Time = MOD(OFF − ON, 1) × 24. Pure span math off the two
  // typed times — shown as soon as both are entered, not gated on Working
  // Status/Operator (unlike Effective Hours/Stoppage below, which really do
  // depend on whether the machine was actually run).
  const shiftMin = spanMinutes(row.machineOnTime, row.machineOffTime);
  const shiftHours = shiftMin === null ? null : shiftMin / 60;

  // 3) Ideal Quantity = shift min × 60 ÷ cycle sec. The formula as first given
  // subtracted Planned Down Time here too, but two real entries checked
  // against it (06/08/2026, machine 7A) disproved that: an 8-hour shift with
  // no down time and a 3-hour shift with 90 min of it both came out to
  // exactly 40 pieces/hour once the subtraction was dropped, matching their
  // real Ideal Quantities (320 and 120) exactly — with it, neither did.
  // Floored — a piece is either finished or it isn't, so a fractional target
  // (e.g. 292.3) can never actually be produced; the lower whole number is
  // the real ceiling on what the shift could make.
  const idealQtyRaw = shiftMin !== null ? ratio(shiftMin * 60, cycle) : null;
  const idealQty = isNum(idealQtyRaw) ? Math.floor(idealQtyRaw) : null;

  const ok = num(row.okQty);
  // Actual Quantity is typed (and the form keeps it at or under Ideal
  // Quantity), so Rejected is whatever of it wasn't OK: OK + Rejected = Actual.
  // Entries saved while Ideal Quantity stood in for Actual carry that figure
  // in their own actualQty, so they read exactly as before. A row with no
  // Actual at all (only the oldest ones) falls back to OK + whatever Rejected
  // it stored.
  const actual = num(row.actualQty);
  const rej = isNum(actual) && isNum(ok) ? Math.max(0, actual - ok) : num(row.rejectedQty);
  const totalProduced = isNum(actual) ? actual : (ok || 0) + (rej || 0);

  // 7) Total Stoppage = sum of the ten stoppage columns — whatever is
  // actually typed, regardless of whether Operator is filled in. A
  // supervisor who logs downtime minutes without yet picking an Operator
  // shouldn't see that real data thrown away.
  const totalStoppageMin = sumOrZero(STOPPAGE_FIELDS.map((f) => num(row[f.key])));

  // 8) Effective Machine Run Time = OK Quantity × Total Cycle Time ÷ 3600.
  // Pure math off two typed values, same as Machine Shift Time above — shown
  // as soon as OK Quantity and a Part (for Cycle Time) are there, not gated
  // on Working Status/Operator.
  const effectiveHours = isNum(cycle) ? ((ok || 0) * cycle) / 3600 : null;

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

// Unutilized Machine Time is one result per row of one machine's one date,
// not one shared value for the whole group: the Excel formula reads "this
// row + next row + next 2 rows" — a rolling 3-row window starting at that
// row. So entry 1 of a day looks ahead across entries 1‑3, entry 2 across
// 2‑3, and entry 3 (or a day with only one or two entries) looks at just
// what is actually there. The window never reaches past this machine's own
// rows for this date, so a short day's last entry isn't quietly padded out
// with the next date's rows. Unreported Time and the three OEE percentages
// are different: they're combined once across the whole machine/date (see
// dayCalc), so every entry of that machine/date shares the same number for
// those four, deliberately.
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

  // Unreported Time and the three OEE percentages are combined across every
  // entry of this machine's date, not windowed per entry — a day's several
  // shifts (slots) are really one day's efficiency, so every entry of that
  // machine/date shows the same combined figure rather than three different
  // numbers for what is one day's work.
  const dayShiftH = sumOrZero(calcs.map((c) => c.shiftHours));
  const dayStoppageMin = sumOrZero(calcs.map((c) => c.totalStoppageMin));
  const dayEffectiveH = sumOrZero(calcs.map((c) => c.effectiveHours));
  const dayLunchMin = sumOrZero(list.map((r) => num(r.lunchMin)));
  const daySetupMin = sumOrZero(list.map((r) => num(r.setupMin)));
  // Blank only when nothing on this machine/date has a Machine Shift Time at
  // all — otherwise the combined figures use whatever entries do have one.
  const dayHasShift = calcs.some((c) => isNum(c.shiftHours));

  const dayUnreportedMin = dayHasShift ? dayShiftH * 60 - dayEffectiveH * 60 - dayStoppageMin : null;
  const dayOeeLosses = dayHasShift ? ratio(dayEffectiveH, dayShiftH - dayStoppageMin / 60) : null;
  const dayOeeLunch = dayHasShift ? ratio(dayEffectiveH, dayShiftH - dayLunchMin / 60) : null;
  // (Named …Cot — the key saved dashboards use — though the column now reads "Setup Time".)
  const dayOeeLunchCot = dayHasShift ? ratio(dayEffectiveH, dayShiftH - dayLunchMin / 60 - daySetupMin / 60) : null;

  return list.map((row, i) => {
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

    // Unutilized is this row's own Shift/Lunch only — not the rolling
    // window the four combined figures above use. With several entries a
    // day for one machine, a shared window put one number on entry 1 alone;
    // per-row keeps each entry's own figure.
    const shiftHi = calcs[i].shiftHours;
    const lunchMinI = num(row.lunchMin);

    return {
      // 6) Unutilized Machine Time = (12 − (Shift h − Lunch min ÷ 60)) ÷ 11,
      // for this entry alone. Not gated on Operator, so lunch minutes typed
      // in still count even before an Operator is picked for the row.
      unutilized: isNum(shiftHi) ? (12 - (shiftHi - lunchMinI / 60)) / 11 : null,
      // 9) Unreported Time (min), 11) OEE considering losses, 12) OEE not
      // considering losses but lunch, and 13) … but lunch and Setup Time are all
      // combined across this machine's whole date (computed once above), so
      // every entry of that machine/date shows the same figure.
      unreportedMin: dayUnreportedMin,
      oeeLosses: dayOeeLosses,
      oeeLunch: dayOeeLunch,
      oeeLunchCot: dayOeeLunchCot,
      gapMin,
    };
  });
}

// Every remark an entry carries, labelled and in form order: the two the form
// requires when "Other" is used (as a reject reason, or as downtime — each with
// the figure it explains) and then the general Remarks box. Empty ones are left
// out, so an entry with none gives []. Shared by the entries table's eye popover
// and the dashboard's drill-down so the two can't word them differently.
export const remarkParts = (r) => {
  const rejectOther = num(r?.rejectBreakdown?.Other);
  const downtimeOther = num(r?.otherMin);
  return [
    r?.rejectOtherRemark && {
      key: "reject",
      title: "Reject · Other",
      figure: isNum(rejectOther) && rejectOther > 0 ? `${fmtNum(rejectOther)} pcs` : "",
      text: r.rejectOtherRemark,
    },
    r?.otherMinRemark && {
      key: "downtime",
      title: "Downtime · Other",
      figure: isNum(downtimeOther) && downtimeOther > 0 ? `${fmtNum(downtimeOther)} min` : "",
      text: r.otherMinRemark,
    },
    r?.remarks && { key: "general", title: "Remarks", figure: "", text: r.remarks },
  ].filter(Boolean);
};

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
