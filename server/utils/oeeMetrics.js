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

const PLANNED_STOP_KEYS = ["lunchMin", "plannedDownMin"];
const METRICS = ["availability", "performance", "quality"];
const METRIC_LABELS = { availability: "Availability", performance: "Performance", quality: "Quality" };

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
  return own - sumOrZero(fields.filter((f) => excluded.has(f.key)).map((f) => num(e[f.key])));
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
  spm: (e) => minusExcluded(e, SPM_OP_FIELDS),
  rivet: (e) => minusExcluded(e, RIVET_OP_FIELDS),
  press: perPieceSec("standardTimeMin", "pcsPerStandardTime"),
  contact: (e) => num(e.totalCycleSec),
  trobe: (e) => num(e.totalCycleSec),
  spring: (e) => num(e.totalCycleSec),
  powder: (e) => num(e.totalCycleSec),
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

  const plannedH = num(e.plannedOperatorShiftHours);
  const plannedProdMin = (isNum(plannedH) ? plannedH * 60 : shiftMin) - sumOrZero(PLANNED_STOP_KEYS.map((k) => num(e[k])));
  // Time spent on other work (After Powder Coating's Other Activity) isn't
  // idle, but it isn't inspecting either — so it's out of Operating Time too.
  // Only that sheet's rows carry it; on every other sheet it's 0.
  const operatingMin = shiftMin - sumOrZero(STOPPAGE_KEYS.map((k) => num(e[k]))) - (num(e.otherActivityMin) || 0);
  const idealRunSec = isNum(cycle) && cycle > 0 && isNum(totalQty) ? cycle * totalQty : null;

  out.availability = plannedProdMin > 0 ? operatingMin / plannedProdMin : null;
  out.performance = operatingMin > 0 && isNum(idealRunSec) ? idealRunSec / 60 / operatingMin : null;
  out.quality = isNum(totalQty) && totalQty > 0 && isNum(ok) ? ok / totalQty : null;
  return out;
};

// The metrics above 100% — [{ metric, value }] (value as a fraction), [] when none.
const metricsOver100 = (m) =>
  METRICS.filter((k) => isNum(m?.[k]) && m[k] > 1 + 1e-9).map((k) => ({ metric: k, value: m[k] }));

module.exports = { entryMetrics, metricsOver100, METRICS, METRIC_LABELS, CYCLE_SEC };
