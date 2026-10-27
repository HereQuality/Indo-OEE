const { STOPPAGE_KEYS } = require("../models/ProductionEntry");
const { CYCLE_OP_FIELDS, SPM_OP_FIELDS, RIVET_OP_FIELDS } = require("../models/Item");

/**
 * utils/oeeMetrics.js
 * ─────────────────────
 * Availability / Performance / Quality for one saved entry of any sheet —
 * the server's copy of client/src/utils/productionSheet.js's oeeParts (and
 * each sheet's own cycle time, from client/src/utils/<sheet>Sheet.js). The
 * browser shows these figures; this copy is what decides, on every save,
 * whether an entry goes to Admin review. Keep the two in step.
 *
 *   Planned Production Time = Planned Operator Shift − Lunch − Planned Downtime
 *   Operating Time          = Machine Shift (ON→OFF) − every stoppage
 *   Availability            = Operating Time ÷ Planned Production Time
 *   Performance             = Cycle Time × (OK + Rejected) ÷ Operating Time
 *   Quality                 = OK ÷ (OK + Rejected)
 */

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const sumOrZero = (vals) => vals.reduce((s, v) => s + (isNum(v) ? v : 0), 0);

// Planned Operator Shift in minutes, back to the minute it stands for (to
// 1/1000 min) from the 6-decimal hours it is saved as — 6.833333 is 410, not
// 409.99998. The browser's plannedMinOf (utils/productionSheet.js) does the same.
const plannedMinOf = (e) => {
  const h = num(e.plannedOperatorShiftHours);
  return isNum(h) ? Math.round(h * 60000) / 1000 : null;
};

const PLANNED_STOP_KEYS = ["lunchMin", "plannedDownMin"];
// Downtime columns a sheet has beyond the shared ten (STOPPAGE_KEYS), by sheet —
// they take time out of Operating Time like the rest. PRINTING: Ask Query To QC
// Team, Empty Bag Tugging, Stock Counting (models/PrintingEntry.js; the client
// counts the same keys through row.extraStoppageKeys, utils/printingSheet.js).
const EXTRA_STOPPAGE_KEYS = {
  printing: require("../models/PrintingEntry").PRINTING_EXTRA_STOPPAGE_KEYS,
};
const METRICS = ["availability", "performance", "quality"];
// The OEE figures — a machine's day (or a per-entry sheet's entry) worked out
// in dayCalc (client/src/utils/productionSheet.js): OEE considering losses,
// not considering losses but lunch, and … but lunch & Setup Time (COT); and the
// worker sheets' two Productivity figures. Over 100% also holds an entry (dayOeeFor).
const OEE_METRICS = ["oeeLosses", "oeeLunch", "oeeLunchCot", "productivity", "productivityLunch"];
const METRIC_LABELS = {
  availability: "Availability",
  performance: "Performance",
  quality: "Quality",
  oeeLosses: "OEE considering losses",
  oeeLunch: "OEE not considering losses but lunch",
  oeeLunchCot: "OEE not considering losses but lunch & setup time",
  productivity: "Productivity without considering Lunch, Tea, etc.",
  productivityLunch: "Productivity considering Lunch, Tea, etc.",
};

const toMinutes = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
};
const spanMinutes = (on, off) => {
  const a = toMinutes(on);
  const b = toMinutes(off);
  if (a === null || b === null) return null;
  return b - a < 0 ? b - a + 1440 : b - a;
};

// The Part's own figure minus whichever of `fields` this entry unticked.
const minusExcluded = (e, fields) => {
  const own = num(e.totalCycleSec);
  if (!isNum(own)) return null;
  const excluded = new Set(e.excludedOps || []);
  const excludedSec = sumOrZero(fields.filter((f) => excluded.has(f.key)).map((f) => num(e[f.key])));
  if (excludedSec === 0) return own;
  // Unticking more than the Part has left float noise or a negative figure: no cycle at all.
  const c = Math.round((own - excludedSec) * 1e6) / 1e6;
  return c > 0 ? c : null;
};

// SPM: the Part's own figure as above; an entry saved before SPM entries
// carried it (8–9 Oct 2026) adds up its four operations instead, which is what
// its cycle was then — the browser's spmCycleSec (utils/spmSheet.js) does the same.
const spmCycleSec = (e) => {
  if (isNum(num(e.totalCycleSec))) return minusExcluded(e, SPM_OP_FIELDS);
  const excluded = new Set(e.excludedOps || []);
  const ops = SPM_OP_FIELDS.filter((f) => !excluded.has(f.key)).map((f) => num(e[f.key]));
  return ops.some(isNum) ? sumOrZero(ops) : null;
};

// CNC: utils/productionSheet.js rowCalc's own fallbacks, oldest rows included.
const cncCycleSec = (e) => {
  const excluded = new Set(e.excludedOps || []);
  if (isNum(num(e.totalCycleSec))) return minusExcluded(e, CYCLE_OP_FIELDS);
  const ops = CYCLE_OP_FIELDS.filter((f) => !excluded.has(f.key)).map((f) => num(e[f.key]));
  if (ops.some(isNum)) return sumOrZero(ops);
  if (isNum(num(e.cycleTimeSec))) return num(e.cycleTimeSec);
  const legacy = (e.cycleOpsSec || []).map(num).filter(isNum);
  return legacy.length ? sumOrZero(legacy) : null;
};

const perPieceSec = (minutesKey, piecesKey) => (e) => {
  const minutes = num(e[minutesKey]);
  const pieces = num(e[piecesKey]);
  return isNum(minutes) && isNum(pieces) && pieces > 0 ? (minutes * 60) / pieces : null;
};

// Each sheet's cycle time exactly as its own table shows it.
const CYCLE_SEC = {
  cnc: cncCycleSec,
  vmc: perPieceSec("programTimeMin", "pcsPerProgram"),
  spm: spmCycleSec,
  rivet: (e) => minusExcluded(e, RIVET_OP_FIELDS),
  press: perPieceSec("standardTimeMin", "pcsPerStandardTime"),
  contact: (e) => num(e.totalCycleSec),
  trobe: (e) => num(e.totalCycleSec),
  spring: (e) => num(e.totalCycleSec),
  powder: (e) => num(e.totalCycleSec),
  rubber: (e) => num(e.totalCycleSec),
  // INJECTION MOULDING: Standard Time per Piece.
  injection: (e) => num(e.totalCycleSec),
  // EMBOSSING: Standard Time per Piece.
  embossing: (e) => num(e.totalCycleSec),
  // PRINTING: Standard Time per Piece.
  printing: (e) => num(e.totalCycleSec),
  // BEFORE POWDER COATING: Standard Time per Piece.
  bpc: (e) => num(e.totalCycleSec),
  // FINAL ASSEMBLY: Standard Time per Piece — optional (PACKING has none: no Performance).
  finalAssembly: (e) => num(e.totalCycleSec),
  // RAW CASTING: Standard Inspection Time per Piece.
  rawCasting: (e) => num(e.totalCycleSec),
  // MODULAR FRAME DRILLING: the entry's own Total Cycle Time (prefilled from the
  // Part, editable) — the same figure its IDEAL Quantity and Effective use.
  mfd: (e) => num(e.totalCycleSec),
  // MODULAR FRAME ASSEMBLY: Standard Assembly Time per Piece.
  mfa: (e) => num(e.totalCycleSec),
};

// { availability, performance, quality } as fractions (1 = 100%), each null
// when it can't be worked out from what the entry holds.
const entryMetrics = (sheet, e) => {
  const out = { availability: null, performance: null, quality: null };
  const shiftMin = spanMinutes(e.machineOnTime, e.machineOffTime);
  if (shiftMin === null) return out;

  const cycle = String(e.itemName || "").trim() ? CYCLE_SEC[sheet](e) : null;
  const ok = num(e.okQty);
  const rej = num(e.rejectedQty);
  const actual = num(e.actualQty);
  const totalQty = isNum(actual) ? actual : isNum(ok) || isNum(rej) ? (ok || 0) + (rej || 0) : null;

  const plannedMin = plannedMinOf(e);
  const plannedProdMin = (isNum(plannedMin) ? plannedMin : shiftMin) - sumOrZero(PLANNED_STOP_KEYS.map((k) => num(e[k])));
  // Time spent on other work (After Powder Coating's Other Activity) isn't
  // idle, but it isn't inspecting either — so it's out of Operating Time too.
  // Only that sheet's rows carry it; on every other sheet it's 0.
  // A sheet's own downtime columns beyond the shared ten (EXTRA_STOPPAGE_KEYS)
  // are stoppage like the rest.
  const operatingMin =
    shiftMin -
    sumOrZero([...STOPPAGE_KEYS, ...(EXTRA_STOPPAGE_KEYS[sheet] || [])].map((k) => num(e[k]))) -
    (num(e.otherActivityMin) || 0);
  const idealRunSec = isNum(cycle) && cycle > 0 && isNum(totalQty) ? cycle * totalQty : null;

  out.availability = plannedProdMin > 0 ? operatingMin / plannedProdMin : null;
  out.performance = operatingMin > 0 && isNum(idealRunSec) ? idealRunSec / 60 / operatingMin : null;
  out.quality = isNum(totalQty) && totalQty > 0 && isNum(ok) ? ok / totalQty : null;
  return out;
};

// The metrics above 100% — Availability / Performance / Quality and the OEE
// figures — [{ metric, value }] (value as a fraction), [] when none.
const metricsOver100 = (m) =>
  [...METRICS, ...OEE_METRICS].filter((k) => isNum(m?.[k]) && m[k] > 1 + 1e-9).map((k) => ({ metric: k, value: m[k] }));


// ── The OEE figures ─────────────────────────────────────────────────────────
// The server's copy of dayCalc / entryDayCalc (client/src/utils/productionSheet.js)
// and of each sheet's adapter (withCycle / withBasis / withDerived / withPrinting
// in client/src/utils/<sheet>Sheet.js): the figures the entries table shows.
//   · Older sheets (calcMode "day"): every entry of a machine's (or worker's)
//     date shares one combined figure.
//   · Per-entry sheets (perEntry): each entry on its own — unless an entry of
//     that day took its Planned Operator Shift from Process Master's lock, which
//     is the whole day's, so the day is combined once as on the older sheets.
// A sheet's `figures` are the ones its table has: three OEE columns on a machine
// sheet, two on BEFORE POWDER COATING, the two Productivity columns on a worker
// sheet. `total`: Effective Run Time counts every piece (TOTAL QTY), not OK.
const MACHINE_OEE = ["oeeLosses", "oeeLunch", "oeeLunchCot"];
const PRODUCTIVITY = ["productivity", "productivityLunch"];
const SHEET_DAY = {
  cnc: { owner: "machine", figures: MACHINE_OEE },
  vmc: { owner: "machine", figures: MACHINE_OEE },
  spm: { owner: "machine", figures: MACHINE_OEE },
  rivet: { owner: "machine", figures: MACHINE_OEE },
  press: { owner: "machine", figures: MACHINE_OEE },
  contact: { owner: "machine", figures: MACHINE_OEE },
  trobe: { owner: "machine", figures: MACHINE_OEE },
  spring: { owner: "machine", figures: MACHINE_OEE, total: true },
  injection: { owner: "machine", figures: MACHINE_OEE, total: true, perEntry: true },
  embossing: { owner: "machine", figures: MACHINE_OEE, total: true, perEntry: true },
  mfd: { owner: "machine", figures: MACHINE_OEE, perEntry: true },
  printing: { owner: "worker", figures: MACHINE_OEE, total: true, perEntry: true },
  bpc: { owner: "worker", figures: ["oeeLosses", "oeeLunch"], total: true, perEntry: true, lossesExceptLunch: true },
  powder: { owner: "worker", figures: PRODUCTIVITY, total: true },
  rubber: { owner: "worker", figures: PRODUCTIVITY },
  rawCasting: { owner: "worker", figures: PRODUCTIVITY, total: true, perEntry: true },
  mfa: { owner: "worker", figures: PRODUCTIVITY, total: true, perEntry: true },
  finalAssembly: { owner: "worker", figures: PRODUCTIVITY, total: true, perEntry: true },
};

// The field a sheet's entries are grouped on within a date: its machine, or its worker.
const ownerFieldOf = (sheet) => SHEET_DAY[sheet]?.owner || "machine";

const ratio = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);

// What dayCalc reads off one entry (client rowCalc): Machine Shift, Total
// Stoppage and Effective Run Time.
const rowParts = (sheet, e) => {
  const cfg = SHEET_DAY[sheet];
  const shiftMin = spanMinutes(e.machineOnTime, e.machineOffTime);
  const cycle = String(e.itemName || "").trim() ? CYCLE_SEC[sheet](e) : null;
  const ok = num(e.okQty);
  const actual = num(e.actualQty);
  const rej = isNum(actual) && isNum(ok) ? Math.max(0, actual - ok) : num(e.rejectedQty);
  const totalProduced = isNum(actual) ? actual : (ok || 0) + (rej || 0);
  const runQty = cfg.total ? totalProduced : ok || 0;
  return {
    shiftHours: shiftMin === null ? null : shiftMin / 60,
    stoppageMin: sumOrZero([...STOPPAGE_KEYS, ...(EXTRA_STOPPAGE_KEYS[sheet] || [])].map((k) => num(e[k]))),
    effectiveHours: isNum(cycle) ? (runQty * cycle) / 3600 : null,
  };
};

// dayCalc's combined figures over `rows` (one machine's or worker's one date).
const combinedFigures = (sheet, rows) => {
  const cfg = SHEET_DAY[sheet];
  const calcs = rows.map((r) => rowParts(sheet, r));
  // A Planned that came from Process Master's lock is the whole day's: counted
  // once, never less than those entries' own runs added up.
  const lockedIdx = rows.map((r, i) => i).filter((i) => rows[i].plannedLocked === true && isNum(plannedMinOf(rows[i])) && isNum(calcs[i].shiftHours));
  const locked = new Set(lockedIdx);
  const lockedHours = lockedIdx.length
    ? Math.max(Math.max(...lockedIdx.map((i) => plannedMinOf(rows[i]) / 60)), sumOrZero(lockedIdx.map((i) => calcs[i].shiftHours)))
    : 0;
  const dayAvailH =
    sumOrZero(
      rows.map((r, i) => {
        if (locked.has(i)) return null;
        const shift = calcs[i].shiftHours;
        if (!isNum(shift)) return null;
        const plannedMin = plannedMinOf(r);
        return isNum(plannedMin) && plannedMin / 60 > shift ? plannedMin / 60 : shift;
      }),
    ) + lockedHours;
  const dayStoppageMin = sumOrZero(calcs.map((c) => c.stoppageMin));
  const dayEffectiveH = sumOrZero(calcs.map((c) => c.effectiveHours));
  const dayLunchMin = sumOrZero(rows.map((r) => num(r.lunchMin)));
  const daySetupMin = sumOrZero(rows.map((r) => num(r.setupMin)));
  const dayOtherActivityMin = sumOrZero(rows.map((r) => num(r.otherActivityMin)));
  const dayHasShift = calcs.some((c) => isNum(c.shiftHours));
  const losses = cfg.lossesExceptLunch ? dayStoppageMin - dayLunchMin : dayStoppageMin;
  const workH = dayAvailH - dayOtherActivityMin / 60;
  const all = {
    oeeLosses: dayHasShift ? ratio(dayEffectiveH, dayAvailH - losses / 60) : null,
    oeeLunch: dayHasShift ? ratio(dayEffectiveH, dayAvailH - dayLunchMin / 60) : null,
    oeeLunchCot: dayHasShift ? ratio(dayEffectiveH, dayAvailH - dayLunchMin / 60 - daySetupMin / 60) : null,
    productivity: dayHasShift ? ratio(dayEffectiveH, workH) : null,
    productivityLunch: dayHasShift ? ratio(dayEffectiveH, workH - dayLunchMin / 60) : null,
  };
  return Object.fromEntries(cfg.figures.map((k) => [k, all[k]]));
};

// The OEE figures the entries table shows for `entry` — { oeeLosses, … } or
// { productivity, … } by sheet, each null when it can't be worked out. `entry`
// is the entry as it stands (or will stand once saved); `siblings` are the other
// entries of its machine's (worker's) date from the same collection — the entry
// itself, if among them, is ignored.
const dayOeeFor = (sheet, entry, siblings = []) => {
  const cfg = SHEET_DAY[sheet];
  if (!cfg) return {};
  const others = (siblings || []).filter((s) => s && !(entry._id !== undefined && String(s._id) === String(entry._id)));
  const day = [...others, entry];
  if (cfg.perEntry && !day.some((r) => r.plannedLocked === true)) return combinedFigures(sheet, [entry]);
  return combinedFigures(sheet, day);
};

module.exports = { entryMetrics, metricsOver100, spanMinutes, METRICS, OEE_METRICS, METRIC_LABELS, CYCLE_SEC, EXTRA_STOPPAGE_KEYS, SHEET_DAY, ownerFieldOf, dayOeeFor };
