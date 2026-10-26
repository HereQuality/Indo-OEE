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
 *
 * Combined across every entry of this machine's date (not a per-row or windowed
 * figure — one machine can have several entries/slots on one date, and these five
 * are that whole date's totals, so every one of that machine's entries for the day
 * shows the same number). Pure math off the day's totals — none of them use Planned
 * Operator Shift Time or Working Status/Operator, so none wait on those:
 *   6  Unutilized Machine Time  = (12 − (Day Shift − Day Lunch/60)) ÷ 11 — checked
 *                                 against three real entries on one machine/date
 *                                 (26/09/2026, machine 7A: 5.5h + 2.5h + 7.5h Shift,
 *                                 30 min Lunch) that only lands on the sheet's
 *                                 −27.27% once summed first; any one entry's own
 *                                 Shift/Lunch alone gives a different, wrong number.
 *   9  Unreported Time (min)    = Day (Planned × 60 − Effective × 60) − Day Stoppage, in whole minutes
 *   11 OEE considering losses   = Day Effective ÷ (Day Available − Day Stoppage/60)
 *   12 OEE … but lunch          = Day Effective ÷ (Day Available − Day Lunch/60)
 *   13 OEE … but lunch and Setup Time = Day Effective ÷ (Day Available − Day Lunch/60 − Day Setup/60)
 *
 * Day Available (dayCalc) = per entry, the operator's own Planned Operator
 * Shift (or its Machine Shift, whichever is bigger) — checked against a real
 * saved row (07/10/2026, machine 7D: Planned=Shift=11h, 90 min of real
 * stoppage) that lands on exactly the sheet's 96.49%/87.30%/87.30%. Stoppage
 * itself is still only capped at the Machine Shift on entry (see
 * entryValidation.js's stoppageLimitMin) — that's what was actually broken,
 * not this formula.
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
  "Broken",
  "Other",
];

// Machine Working Status — any of these, ticked on every sheet's entry form.
// Keep in step with MACHINE_STATUSES in server/models/entryCommon.js.
// Machine Working Status: Working (normal entry) or Non Working (the machine did not
// run — only the day, machine, operator, reason and remarks are recorded). Mirrors
// server/utils/workingMode.js; "Working" is the default and is stored as nothing.
export const WORKING_MODES = ["Working", "Non Working"];
export const isNonWorking = (v) => v?.workingMode === "Non Working";

export const MACHINE_STATUSES = ["Machine Breakdown", "No Manpower", "No Planning"];

// Every value the real Contact sheet uses (its typos, e.g. "PRSENT", folded in).
export const WORKING_STATUSES = [
  "PRESENT",
  "ABSENT",
  "LEAVE",
  "M/C OFF",
  "M/C STOP",
  "UNDER MAINT.",
  "SUNDAY",
  "W/OFF",
  "HOLIDAY",
  "STOCK COUNTING",
  "REPORT NOT FILLUP",
];

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

// Planned Operator Shift in minutes. It is saved as hours to 6 decimals
// (6 h 50 min is 6.833333), so it's taken back to the minute it stands for, to
// 1/1000 min — otherwise that rounding leaves Availability a hair over 100%
// (shown red) and Unreported at −0. Mirrored in server/utils/oeeMetrics.js.
const plannedMinOf = (row) => {
  const h = num(row?.plannedOperatorShiftHours);
  return isNum(h) ? Math.round(h * 60000) / 1000 : null;
};

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
  // A sheet with downtime columns of its own beyond these ten (Printing's Ask
  // Query To QC Team / Empty Bag Tugging / Stock Counting) lists their keys in
  // row.extraStoppageKeys (set by its adapter), so they count here too.
  const totalStoppageMin = sumOrZero([...STOPPAGE_FIELDS.map((f) => f.key), ...(row.extraStoppageKeys || [])].map((k) => num(row[k])));

  // 8) Effective Machine Run Time = OK Quantity × Total Cycle Time ÷ 3600.
  // Pure math off two typed values, same as Machine Shift Time above — shown
  // as soon as OK Quantity and a Part (for Cycle Time) are there, not gated
  // on Working Status/Operator. A sheet whose own rule counts every piece run
  // (SPRING FOR PINS: OK + Rejected) marks its rows runQtyBasis: "total".
  const runQty = row.runQtyBasis === "total" ? totalProduced : ok || 0;
  const effectiveHours = isNum(cycle) ? (runQty * cycle) / 3600 : null;

  // 14–16) Availability / Performance / Quality — this entry alone, standard
  // OEE over this sheet's own fields (see oeeParts). Never capped at 100%:
  // anything above it is real and goes to Admin review instead.
  const totalQty = isNum(actual) ? actual : isNum(ok) || isNum(rej) ? (ok || 0) + (rej || 0) : null;
  const parts = oeeParts({ shiftMin, totalStoppageMin, row, cycle, ok, totalQty });

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
    ...parts,
  };
}

// Lunch / Tea and Planned Downtime are the planned stops — taken out of the
// time the machine was meant to produce, so they never lower Availability.
// Every other stoppage does.
export const PLANNED_STOP_KEYS = ["lunchMin", "plannedDownMin"];

// Availability, Performance and Quality for one entry, plus the sums they're
// made of (so the dashboard can add those up across entries and divide once,
// instead of averaging percentages):
//   Planned Production Time = Planned Operator Shift − Lunch − Planned Downtime
//   Operating Time          = Machine Shift (ON→OFF) − every stoppage
//                             (− Other Activity, After Powder Coating only)
//   Availability            = Operating Time ÷ Planned Production Time
//   Performance             = Cycle Time × (OK + Rejected) ÷ Operating Time
//   Quality                 = OK ÷ (OK + Rejected)
// A row with no Planned Operator Shift (only the oldest ones) uses its Machine
// Shift there. Mirrored on the server by server/utils/oeeMetrics.js — keep the
// two in step, it's what decides which entries go to Admin review.
function oeeParts({ shiftMin, totalStoppageMin, row, cycle, ok, totalQty }) {
  const empty = { availability: null, performance: null, quality: null, plannedProdMin: null, operatingMin: null, idealRunSec: null };
  if (shiftMin === null) return empty;
  const plannedMin = plannedMinOf(row);
  const plannedProdMin = (isNum(plannedMin) ? plannedMin : shiftMin) - sumOrZero(PLANNED_STOP_KEYS.map((k) => num(row[k])));
  // Time on other work (After Powder Coating's Other Activity) isn't idle,
  // but it isn't inspecting either. No other sheet's rows carry it.
  const operatingMin = shiftMin - (totalStoppageMin || 0) - (num(row.otherActivityMin) || 0);
  const idealRunSec = isNum(cycle) && cycle > 0 && isNum(totalQty) ? cycle * totalQty : null;
  return {
    availability: plannedProdMin > 0 ? operatingMin / plannedProdMin : null,
    performance: operatingMin > 0 && isNum(idealRunSec) ? idealRunSec / 60 / operatingMin : null,
    quality: isNum(totalQty) && totalQty > 0 && isNum(ok) ? ok / totalQty : null,
    plannedProdMin,
    operatingMin,
    idealRunSec,
  };
}

// Whichever of Availability / Performance / Quality is above 100% on a row's
// calc — [] when none. Uses a tiny tolerance so a figure that's 100% on paper
// isn't flagged over floating-point dust.
export const OEE_METRIC_LABELS = { availability: "Availability", performance: "Performance", quality: "Quality" };
export const metricsOver100 = (calc) =>
  Object.keys(OEE_METRIC_LABELS).filter((k) => isNum(calc?.[k]) && calc[k] > 1 + 1e-9);

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

// `lossesExceptLunch`: OEE considering losses takes every stoppage off the time
// available EXCEPT Lunch / Rest (Before Powder Coating's sheet — its other two
// OEE columns don't exist, and its lunch-only one is oeeLunch below).
export function dayCalc(rows, { lossesExceptLunch = false } = {}) {
  const list = sortByMachineOn(rows);
  const calcs = list.map(rowCalc);

  // Unreported Time and the three OEE percentages are combined across every
  // entry of this machine's date, not windowed per entry — a day's several
  // shifts (slots) are really one day's efficiency, so every entry of that
  // machine/date shows the same combined figure rather than three different
  // numbers for what is one day's work.
  // Time available for the machine: the operator's Planned Operator Shift —
  // real data confirms this directly (07/10/2026, machine 7D: Planned=Shift=
  // 11h, 90 min real stoppage saved despite that, and OEE considering losses/
  // lunch/lunch+setup all land on 96.49%/87.30%/87.30% exactly with Available
  // left as plain Planned/Shift, not Shift+Stoppage — a fix tried here once
  // and reverted because it moved OEE1 to 83.33%, which this real row
  // disproves). A row with no usable Planned (or one shorter than its
  // Machine Shift, an old row) counts its Machine Shift, so nothing is ever
  // less than the run itself.
  //
  // A Planned that came from Process Master's lock (plannedLocked, set by the
  // server) is the machine's whole day, not each entry's: it counts once per
  // date however many entries share it — three entries on a 12 h lock are a
  // 12 h day, not 36 h (never less than those entries' own runs added up).
  // Hours typed on each entry are that entry's own share and add up, the way
  // the paper sheet's entries add up to the day's Planned (checked against
  // RIVET 11/A 21-06-2025 and PRESS 1D 30-09-2026: exact).
  const lockedDay = (() => {
    const idx = list.map((r, i) => i).filter((i) => list[i].plannedLocked === true && isNum(plannedMinOf(list[i])) && isNum(calcs[i].shiftHours));
    if (!idx.length) return { idx: new Set(), hours: 0 };
    const planned = Math.max(...idx.map((i) => plannedMinOf(list[i]) / 60));
    const run = sumOrZero(idx.map((i) => calcs[i].shiftHours));
    return { idx: new Set(idx), hours: Math.max(planned, run) };
  })();
  const dayAvailH =
    sumOrZero(
      list.map((r, i) => {
        if (lockedDay.idx.has(i)) return null;
        const shift = calcs[i].shiftHours;
        if (!isNum(shift)) return null;
        const plannedMin = plannedMinOf(r);
        return isNum(plannedMin) && plannedMin / 60 > shift ? plannedMin / 60 : shift;
      }),
    ) + lockedDay.hours;
  const dayStoppageMin = sumOrZero(calcs.map((c) => c.totalStoppageMin));
  const dayEffectiveH = sumOrZero(calcs.map((c) => c.effectiveHours));
  const dayLunchMin = sumOrZero(list.map((r) => num(r.lunchMin)));
  const daySetupMin = sumOrZero(list.map((r) => num(r.setupMin)));
  // Minutes on other work — only After Powder Coating's rows carry any.
  const dayOtherActivityMin = sumOrZero(list.map((r) => num(r.otherActivityMin)));
  // Blank only when nothing on this machine/date has a Machine Shift Time at
  // all — otherwise the combined figures use whatever entries do have one.
  const dayHasShift = calcs.some((c) => isNum(c.shiftHours));

  // Unreported Time = Planned Operator Shift − Effective Run Time − Stoppage,
  // in minutes, kept to full decimal precision rather than rounded to a
  // whole minute — Effective Run Time is almost never a whole number of
  // minutes itself (OK Qty × Cycle Sec ÷ 60 lands on fractions like 235.5),
  // and rounding it away before subtracting is what was producing a wrong
  // figure against the real sheet (19.5 min there, 19 or 20 here depending
  // on which way the rounding fell). Checked against a real saved row
  // (07/10/2026, machine 7D: Planned 11h, Effective 9h10m, Stoppage 90 min)
  // that comes out to exactly the sheet's 20 min this way — the old formula
  // subtracted Machine Shift here instead of Effective Run Time, which
  // silently treated the whole ON–OFF span as "accounted for" even on a row
  // where the machine was on but not always producing and nothing was logged
  // for that gap, giving a wrong (often negative) result. (A row saved
  // without a Planned shift — only the oldest ones — falls back to Machine
  // Shift in Planned's place.) A locked Planned counts once for the day, as
  // in dayAvailH above.
  const dayUnreportedMin = dayHasShift
    ? sumOrZero(
        list.map((r, i) => {
          const c = calcs[i];
          const stop = (c.totalStoppageMin || 0) + (num(r.otherActivityMin) || 0);
          const effectiveMin = (c.effectiveHours || 0) * 60;
          if (lockedDay.idx.has(i)) return -effectiveMin - stop;
          const plannedMin = plannedMinOf(r);
          const basisMin = isNum(plannedMin) ? plannedMin : isNum(c.shiftHours) ? c.shiftHours * 60 : null;
          return basisMin === null ? -stop : basisMin - effectiveMin - stop;
        }),
      ) + lockedDay.hours * 60
    : null;
  const dayOeeLosses = dayHasShift
    ? ratio(dayEffectiveH, dayAvailH - (lossesExceptLunch ? dayStoppageMin - dayLunchMin : dayStoppageMin) / 60)
    : null;
  const dayOeeLunch = dayHasShift ? ratio(dayEffectiveH, dayAvailH - dayLunchMin / 60) : null;
  // (Named …Cot — the key saved dashboards use — though the column now reads "Setup Time".)
  const dayOeeLunchCot = dayHasShift ? ratio(dayEffectiveH, dayAvailH - dayLunchMin / 60 - daySetupMin / 60) : null;
  // After Powder Coating's two Productivity figures: Ideal Inspection Time
  // (its Effective Run Time) over the time the worker had for inspecting —
  // without, and then with, Lunch / Tea taken out. Checked against a real
  // row (09/10/2026, Saroj: 1 h, 80 pcs × 30 s = 0.6667 h → 66.67% both, no
  // lunch). Other Activity time is out of both: it was work, just not inspection.
  const dayAvailForWorkH = dayAvailH - dayOtherActivityMin / 60;
  const dayProductivity = dayHasShift ? ratio(dayEffectiveH, dayAvailForWorkH) : null;
  const dayProductivityLunch = dayHasShift ? ratio(dayEffectiveH, dayAvailForWorkH - dayLunchMin / 60) : null;

  // 6) Unutilized Machine Time = (12 − (Day Shift − Day Lunch/60)) ÷ 11,
  // combined across every entry of this machine's date — same as Unreported
  // Time and the three OEE figures above, not a per-row figure. Checked
  // against three real entries (26/09/2026, machine 7A, three slots: 5.5h +
  // 2.5h + 7.5h = 15.5h Shift, 30 min Lunch) that only lands on the sheet's
  // −27.27% once all three are summed first — summed alone, entry 1's own
  // 5.5h/30min gives 63.64%, nowhere close.
  const dayShiftH = sumOrZero(calcs.map((c) => c.shiftHours));
  const dayUnutilized = dayHasShift ? (12 - (dayShiftH - dayLunchMin / 60)) / 11 : null;

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

    return {
      // 6) Unutilized Machine Time, 9) Unreported Time (min), 11) OEE
      // considering losses, 12) OEE not considering losses but lunch, and
      // 13) … but lunch and Setup Time are all combined across this
      // machine's whole date (computed once above), so every entry of that
      // machine/date shows the same figure.
      // Shown within 0–100%: the formula's result below 0 reads 0% and above
      // 100% reads 100%. The formula itself is untouched (raw figure kept).
      unutilized: dayUnutilized === null ? null : Math.min(1, Math.max(0, dayUnutilized)),
      unutilizedRaw: dayUnutilized,
      unreportedMin: dayUnreportedMin,
      oeeLosses: dayOeeLosses,
      oeeLunch: dayOeeLunch,
      oeeLunchCot: dayOeeLunchCot,
      productivity: dayProductivity,
      productivityLunch: dayProductivityLunch,
      gapMin,
    };
  });
}

// The sheets that work every entry out on its own — Printing, Injection Moulding
// and Before Powder Coating. Their paper sheets have no Planned Operator Shift
// column and give each row its own OEE / Unreported Time on that row's Machine
// Shift; typed here as the entry's Planned Operator Shift (= its Machine Shift on
// the paper), each entry's figures come from that entry alone — checked against
// 51 real rows of the three sheets (utils/paperSheets.test.mjs): exact. A Planned
// that came from Process Master's lock is the machine's (or worker's) whole day
// instead, so a day with any locked entry is combined once, as on every other
// sheet (dayCalc). One result per row, in sortByMachineOn order, like dayCalc.
export function entryDayCalc(rows, options = {}) {
  const list = sortByMachineOn(rows);
  const day = dayCalc(list, options);
  if (list.some((r) => r.plannedLocked === true)) return day;
  return list.map((r, i) => ({ ...dayCalc([r], options)[0], gapMin: day[i].gapMin }));
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

// A Part Name option's label, as every entry form's Part Name picker shows
// it: the name, plus " — N sec" when the part actually has a usable Total
// Cycle Time — never for a part that doesn't (an earlier, per-form version of
// this check read `Number(it.totalCycleSec)` straight off a null/undefined
// value, which coerces to 0 — finite — so it showed "— null sec" instead of
// leaving the suffix off).
export const partCycleLabel = (it) => {
  const n = it?.totalCycleSec;
  // Rounded for the label only (a VMC part's cycle is program time ÷ pieces,
  // e.g. 65.80645…) — the part's own value is what the form fills in.
  return `${it.itemName}${n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n)) ? ` — ${fmtNum(Number(n))} sec` : ""}`;
};

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
