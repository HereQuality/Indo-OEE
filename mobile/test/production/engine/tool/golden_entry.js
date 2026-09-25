// Golden generator: runs the REAL client/src/utils/processDashboard.js (bundled
// by esbuild, never written into client/) over a deterministic input set and
// prints one JSON document. NaN / +-Infinity are encoded as "__NaN__" etc.
import * as PD from "/Users/hqepldev/HQEPL/Indo-OEE/client/src/utils/processDashboard.js";
import * as PS from "/Users/hqepldev/HQEPL/Indo-OEE/client/src/utils/productionSheet.js";

const RealDate = Date;

// ── deterministic PRNG ─────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = mulberry32(20260925);
const rnd = () => R();
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const pad = (v) => String(v).padStart(2, "0");

// ── row generation ─────────────────────────────────────────────────────────
const REASONS = ["Dimension Out", "Tool Mark", "Surface Finish", "Porosity / Blow Hole", "Material Defect", "Setting Mistake", "Operator Mistake", "Machine Fault", "Other"];
const STOP = ["plannedDownMin", "setupMin", "noManPowerMin", "materialShiftingMin", "noMaterialMin", "bdMechMin", "bdEleMin", "noPowerMin", "lunchMin", "otherMin"];
const OPS = ["drillingSec", "boringSec", "threadingSec", "tappingSec", "chamferingSec", "otherOp1Sec", "otherOp2Sec", "clampDeclampSec"];
const OPERATORS = ["Ravi K", "Sunil", "anita", "Op 10", "Op 2", "Meena P", ""];
const ITEMS = ["Bracket A", "Flange 10", "Flange 2", "Shaft-7", "Housing", "bush"];

const timeFmt = (h, m) => {
  const hh = ((h % 24) + 24) % 24;
  const f = int(0, 9);
  if (f === 0) return `${hh}:${pad(m)}`;
  if (f === 1) return `${pad(hh)}${pad(m)}`;
  if (f === 2) return `${pad(hh)}.${pad(m)}`;
  return `${pad(hh)}:${pad(m)}`;
};

const dayString = (start, offset) => {
  const d = new RealDate(start[0], start[1] - 1, start[2] + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Values a stored number can arrive as: number, numeric string, blank, null.
const numberish = (n, { blank = 0.1, str = 0.15 } = {}) => {
  if (chance(blank)) return pick([undefined, null, ""]);
  return chance(str) ? String(n) : n;
};

let rowCounter = 0;
function makeRow({ machine, date, slot, legacy = false }) {
  const r = { _id: `e${rowCounter++}`, machine, date, slot };
  const status = chance(0.05);
  r.operator = status ? "" : chance(0.05) ? undefined : pick(OPERATORS);
  if (status) r.workingStatus = pick(["M/C OFF", "ABSENT", "SUNDAY", "HOLIDAY"]);
  const startH = [6, 14, 22][slot - 1] + (chance(0.3) ? int(-1, 1) : 0);
  const spanH = chance(0.85) ? 8 : int(1, 9);
  const startM = pick([0, 0, 0, 15, 30, 45]);
  const endM = pick([0, 0, 0, 15, 30, 45]);
  if (chance(0.92)) {
    r.machineOnTime = timeFmt(startH, startM);
    r.machineOffTime = chance(0.03) ? "25:99" : timeFmt(startH + spanH, endM);
  } else if (chance(0.5)) {
    r.machineOnTime = timeFmt(startH, startM);
  }
  const hasItem = chance(0.93);
  if (hasItem) {
    r.itemName = pick(ITEMS);
    if (chance(0.9)) r.item = `i${ITEMS.indexOf(r.itemName)}`;
    const cyc = int(20, 180) + (chance(0.3) ? rnd() : 0);
    const style = legacy ? pick(["cycleTimeSec", "cycleOpsSec", "ops"]) : pick(["total", "total", "total", "ops", "totalAndOps"]);
    if (style === "total") r.totalCycleSec = numberish(cyc, { blank: 0.02 });
    else if (style === "cycleTimeSec") r.cycleTimeSec = numberish(cyc, { blank: 0 });
    else if (style === "cycleOpsSec") r.cycleOpsSec = Array.from({ length: int(1, 5) }, () => pick([int(5, 40), String(int(5, 40)), null, ""]));
    else {
      for (const k of OPS) if (chance(0.5)) r[k] = numberish(int(2, 40), { blank: 0.05 });
      if (style === "totalAndOps") {
        r.totalCycleSec = cyc;
        r.excludedOps = OPS.filter(() => chance(0.25));
      }
    }
  } else if (chance(0.5)) {
    r.itemName = pick(["", "   ", null]);
    r.totalCycleSec = 60;
  }
  const ideal = Math.max(1, Math.floor((spanH * 3600) / Math.max(1, r.totalCycleSec ? Number(r.totalCycleSec) || 60 : 60)));
  const ok = int(0, Math.min(ideal, 900));
  const actual = Math.min(ideal, ok + int(0, 25));
  if (!status || chance(0.3)) {
    if (chance(0.9)) r.okQty = numberish(chance(0.1) ? ok + 0.5 : ok, { blank: 0.02 });
    if (chance(legacy ? 0.2 : 0.92)) r.actualQty = numberish(actual, { blank: 0.02 });
    else r.rejectedQty = numberish(int(0, 20), { blank: 0.1 });
  }
  if (chance(0.15)) r.plannedOperatorShiftHours = numberish(pick([8, 8, 7.5, 10, 12]));
  for (const k of STOP) {
    if (chance(0.3)) r[k] = numberish(chance(0.2) ? int(0, 200) + 0.25 : int(0, 120), { blank: 0.1 });
  }
  if (chance(0.5)) r.lunchMin = numberish(pick([30, 45, 60, 20]));
  // Rejects: per-reason split, or one legacy reason.
  const rej = Math.max(0, actual - ok);
  if (rej > 0 || chance(0.1)) {
    if (chance(0.7)) {
      const picks = REASONS.filter(() => chance(0.3));
      const bd = {};
      let left = rej;
      for (const reason of picks) {
        const q = Math.min(left, int(0, Math.max(1, rej)));
        left -= q;
        bd[reason] = chance(0.1) ? String(q) : q;
      }
      if (chance(0.1)) bd["Weird"] = "abc";
      if (chance(0.1)) bd["Other"] = 0;
      if (Object.keys(bd).length || chance(0.5)) r.rejectBreakdown = bd;
      if (chance(0.3)) r.rejectReason = pick(REASONS);
    } else {
      r.rejectReason = pick([...REASONS, "", "Not a reason", undefined]);
    }
  }
  if (chance(0.1)) r.remarks = "note " + int(1, 99);
  if (r.rejectBreakdown && r.rejectBreakdown.Other && chance(0.7)) r.rejectOtherRemark = "other reject " + int(1, 9);
  if (chance(0.2) && r.otherMin) r.otherMinRemark = "other stop " + int(1, 9);
  return r;
}

function plant({ machines, days, start, skip = 0.15, legacyShare = 0.05, extraSlots = true }) {
  const rows = [];
  for (let d = 0; d < days; d++) {
    const date = dayString(start, d);
    for (const m of machines) {
      if (chance(skip)) continue;
      const slots = extraSlots ? pick([1, 1, 2, 2, 3]) : 1;
      const order = chance(0.3) ? [3, 1, 2] : [1, 2, 3]; // saved out of order
      for (const slot of order.slice(0, slots)) rows.push(makeRow({ machine: m, date, slot, legacy: chance(legacyShare) }));
    }
  }
  return rows;
}

// ── scenarios ──────────────────────────────────────────────────────────────
const MACHINE_NAMES = { m1: "MC 10", m2: "MC 2", m3: "7A", m4: "7B", m5: "MC 1", m6: "cnc 3", m7: "MC 2", m8: "" };
const MACHINE_ORDER = { m3: 0, m1: 1, m2: 2, m5: 3 };

const scenarios = {};
const S = (name, rows, ctxExtra = {}) => (scenarios[name] = { rows, ctxExtra });

S("plant", plant({ machines: ["m1", "m2", "m3", "m4", "m5", "m6", "m9"], days: 21, start: [2026, 8, 20] }));
S("long", plant({ machines: ["m1", "m2", "m3"], days: 80, start: [2026, 1, 15], skip: 0.1 }));
S("legacy", plant({ machines: ["m1", "m2"], days: 12, start: [2026, 3, 1], legacyShare: 1 }));
S("empty", []);
{
  const one = makeRow({ machine: "m1", date: "2026-09-01", slot: 1 });
  S("single", [one]);
  S("blank", [{ _id: "b1", machine: "m2", date: "2026-09-02" }]);
}
{
  const rows62 = Array.from({ length: 62 }, (_, i) => ({ ...makeRow({ machine: "m1", date: dayString([2026, 1, 1], i), slot: 1 }) }));
  S("dates62", rows62);
  S("dates63", [...rows62, makeRow({ machine: "m1", date: dayString([2026, 1, 1], 62), slot: 1 })]);
  const dup = Array.from({ length: 70 }, (_, i) => makeRow({ machine: "m1", date: dayString([2026, 1, 1], i % 62), slot: 1 + Math.floor(i / 62) }));
  S("dates62dup", dup);
}
// Hand-made weird rows: types the API never sends but the engine must survive.
S("weird", [
  { _id: "w1", machine: "m1", date: "2026-09-01", slot: 1, itemName: "X", totalCycleSec: "  30 ", machineOnTime: "8", machineOffTime: "16", okQty: " 100 ", actualQty: "120", rejectBreakdown: { "5": 10, "2": "5", Other: 5, "10": 0, "01": 3 } },
  { _id: "w2", machine: "m1", date: "2026-09-01", slot: 2, itemName: "X", totalCycleSec: "1e1", machineOnTime: "1600", machineOffTime: "0.30", okQty: "0x10", actualQty: 5000, rejectReason: 7 },
  { _id: "w3", machine: "m2", date: "2026-09-02", slot: 1, itemName: "Y", totalCycleSec: 45, machineOnTime: "06:00", machineOffTime: "14:00", okQty: -5, actualQty: 10, operator: "5" },
  { _id: "w4", machine: "m2", date: "2026-09-02", slot: 2, itemName: "Y", totalCycleSec: 45, machineOnTime: "14:00", machineOffTime: "22:00", okQty: true, actualQty: false, operator: 0, bdMechMin: "x", bdEleMin: "12", lunchMin: " 30 ", setupMin: "1e1", otherMin: null },
  { _id: "w5", machine: "m3", date: "2026-09-03", slot: 1, itemName: "Z", totalCycleSec: 0, machineOnTime: "06:00", machineOffTime: "06:00", okQty: 50, actualQty: 50, rejectBreakdown: [3, "4", "z", 0] },
  { _id: "w6", machine: "m3", date: "2026-09-03", slot: 2, itemName: "Z", totalCycleSec: -10, machineOnTime: "10:00", machineOffTime: "09:00", okQty: 5, actualQty: 5.5, rejectedQty: 3, itemName2: "q" },
  { _id: "w7", machine: "m3", date: "2026-09-03", slot: 3, machineOnTime: "10:00", okQty: 5, rejectedQty: "7", rejectReason: "Tool Mark" },
  { _id: "w8", machine: "m4", date: "2026-09-04", slot: 1, itemName: "Z", totalCycleSec: 60, machineOnTime: "06:00", machineOffTime: "14:00", okQty: 100, actualQty: 200, rejectBreakdown: { "Tool Mark": 40, "Dimension Out": "60", Other: 1e2 }, rejectReason: "Setting Mistake", plannedOperatorShiftHours: "8" },
  { _id: "w9", machine: "m4", date: "2026-09-04", slot: 2, itemName: "Z", totalCycleSec: 60, machineOnTime: "14:00", machineOffTime: "22:00", okQty: 100, actualQty: 200, rejectBreakdown: {}, rejectReason: "", plannedOperatorShiftHours: " " },
  { _id: "w10", machine: "m4", date: "2026-09-05", slot: 1, itemName: "Z", totalCycleSec: 60, machineOnTime: "06:00", machineOffTime: "14:00", okQty: 100, actualQty: 200, rejectBreakdown: null },
  { _id: "w11", machine: "m4", date: "2026-09-05", slot: 2, itemName: "Z", totalCycleSec: 60, machineOnTime: "14:00", machineOffTime: "22:00", okQty: 100, actualQty: 200, rejectReason: null, rejectBreakdown: { A: 0, B: -3, C: null, D: "" } },
  { _id: "w12", machine: "m5", date: "2026-09-05", slot: 1, itemName: "  ", totalCycleSec: 60, machineOnTime: "06:00", machineOffTime: "14:00", okQty: 100, actualQty: 200 },
  { _id: "w13", machine: "12", date: "2026-09-05", slot: 1, itemName: "N", totalCycleSec: 60, machineOnTime: "06:00", machineOffTime: "14:00", okQty: 1e5 + 0.5, actualQty: 123456.789 },
  { _id: "w14", machine: "m6", date: "2026-09-06", slot: 1, itemName: "N", totalCycleSec: 1, machineOnTime: "00:00", machineOffTime: "23:59", okQty: 99999.99, actualQty: 100000.01, plannedOperatorShiftHours: 24.5 },
  { _id: "w15", machine: "m6", date: "2026-09-06", slot: 2, itemName: "N", cycleTimeSec: "12", machineOnTime: "23:59", machineOffTime: "00:00", okQty: 1e9, actualQty: 1e12 },
]);

// ── ctx & helpers ──────────────────────────────────────────────────────────
const ctxFor = (rows) => ({ machineName: { ...MACHINE_NAMES }, machineOrder: { ...MACHINE_ORDER }, bucket: PD.timeBucket(rows) });

const idx = (rows, list) => list.map((r) => rows.indexOf(r));

const sample = (arr, n) => {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < n * 4 && out.length < Math.min(n, arr.length); i++) {
    const v = arr[Math.floor(rnd() * arr.length)];
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
};

function runScenario(name, { rows }) {
  const ctx = ctxFor(rows);
  const out = { bucket: PD.timeBucket(rows), ctx: { machineName: ctx.machineName, machineOrder: ctx.machineOrder, bucket: ctx.bucket } };
  out.calc = rows.map((r) => PD.calcOf(r));
  out.calcCached = rows.map((r) => PD.calcOf(r) === PD.calcOf(r));
  out.summary = PD.summarize(rows);
  out.dims = {};
  for (const dim of Object.keys(PD.DIMENSIONS)) {
    const D = PD.DIMENSIONS[dim];
    const groups = PD.groupRows(rows, dim);
    out.dims[dim] = {
      label: D.label,
      values: rows.map((r) => D.value(r)),
      texts: rows.map((r) => D.text(D.value(r), ctx)),
      groups: [...groups].map(([k, g]) => [k, idx(rows, g)]),
      by: PD.summarizeBy(rows, dim, ctx),
    };
  }
  // Filters: single, pairs, everything, with every `except`.
  const values = Object.fromEntries(Object.keys(PD.DIMENSIONS).map((d) => [d, [...new Set(rows.map(PD.DIMENSIONS[d].value))]]));
  const combos = [{}];
  for (const d of Object.keys(PD.DIMENSIONS)) {
    for (let i = 0; i < 3; i++) combos.push({ [d]: sample(values[d], int(1, 2)) });
  }
  for (let i = 0; i < 14; i++) {
    const c = {};
    for (const d of Object.keys(PD.DIMENSIONS)) if (chance(0.5)) c[d] = sample(values[d], int(1, 3));
    combos.push(c);
  }
  combos.push({ machine: ["nope"] }, { operator: [""] }, { item: [""], month: sample(values.month, 1) });
  out.filters = combos.map((partial) => {
    const filters = { ...PD.EMPTY_FILTERS, ...partial };
    const res = {
      filters,
      has: PD.hasFilters(filters),
      applied: idx(rows, PD.applyFilters(rows, filters)),
      sameRef: PD.applyFilters(rows, filters) === rows,
      except: {},
    };
    for (const d of Object.keys(PD.DIMENSIONS)) {
      res.except[d] = idx(rows, PD.applyFilters(rows, filters, d));
    }
    return res;
  });
  // Measures on the full summary and on a filtered one.
  const measured = [out.summary, PD.summarize(PD.applyFilters(rows, { ...PD.EMPTY_FILTERS, ...(combos[3] || {}) }))];
  out.measures = measured.map((s) => ({
    stats: PD.STAT_CATALOG.map((st) => {
      const m = PD.statMeasure(st);
      return { key: m.key, label: m.label, format: m.format, value: m.get(s), formatted: PD.FORMATS[m.format](m.get(s)), exact: PD.formatExact(m.format, m.get(s)) };
    }),
    causes: [...PD.STOPPAGE_GROUPS.flatMap((g) => g.fields), "nope"].map((k) => {
      const m = PD.causeMeasure(k);
      return { key: m.key, label: m.label, format: m.format, value: m.get(s) };
    }),
    reasons: [...REASONS, "Weird", "5", "nope"].map((k) => {
      const m = PD.reasonMeasure(k);
      return { key: m.key, label: m.label, format: m.format, value: m.get(s) };
    }),
  }));
  return out;
}

const scenarioOut = {};
for (const [name, sc] of Object.entries(scenarios)) scenarioOut[name] = { rows: sc.rows, ...runScenario(name, sc) };

// ── toggleFilter ───────────────────────────────────────────────────────────
const toggles = [];
{
  let f = { ...PD.EMPTY_FILTERS };
  for (const [dim, value] of [["machine", "m1"], ["machine", "m2"], ["operator", ""], ["machine", "m1"], ["item", "Shaft-7"], ["month", "2026-09"], ["date", "2026-09-01"], ["operator", ""], ["machine", "m2"]]) {
    f = PD.toggleFilter(f, dim, value);
    toggles.push({ dim, value, result: f });
  }
  toggles.push({ dim: "brandNew", value: "x", result: PD.toggleFilter(PD.EMPTY_FILTERS, "brandNew", "x") });
}

// ── compareMachines ────────────────────────────────────────────────────────
const cmpNames = ["MC 10", "MC 2", "MC 1", "7A", "7B", "cnc 3", "CNC 3", "MC 02", "", "Lathe", "lathe 10", "lathe 9", "X-1", "X 1", "É1", "E1", "A", "a", "10", "9", "9a", "9A", "b"];
const machineCtx = {
  machineName: Object.fromEntries(cmpNames.map((n, i) => [`k${i}`, n])),
  machineOrder: { k3: 0, k0: 1, k5: 2, k1: 3, k9: 3 },
};
const cmpItems = cmpNames.map((n, i) => ({ key: `k${i}`, label: `lbl-${n}` }));
cmpItems.push({ key: "gone1", label: "Zed" }, { key: "gone2", label: "alpha 10" }, { key: "gone3", label: "alpha 9" }, { key: "gone4", label: "" });
const optItems = cmpItems.map((it) => ({ value: it.key, label: it.label }));
const compareOut = {
  ctx: machineCtx,
  itemsByKey: [...cmpItems].sort(PD.compareMachines(machineCtx)).map((i) => i.key),
  itemsByValue: [...optItems].sort(PD.compareMachines(machineCtx, (o) => o.value)).map((i) => i.value),
  noCtx: [...cmpItems].sort(PD.compareMachines(undefined)).map((i) => i.key),
  emptyCtx: [...cmpItems].sort(PD.compareMachines({ machineName: {}, machineOrder: {} })).map((i) => i.key),
};

// ── natural compare battery ────────────────────────────────────────────────
const NAT = [
  "", " ", "  ", "a", "A", "b", "B", "z", "Z", "ab", "aB", "Ab", "AB", "a b", "a-b", "a_b", "a.b", "a,b", "ab1", "a 1", "a1", "a01", "a001", "a10", "a2", "a9", "a1b", "a1c", "a1b1", "a1b2", "a10b",
  "1", "01", "001", "2", "9", "10", "11", "100", "1.5", "1.10", "1.9", "1,5", "0", "00", "0a", "0.5", "-1", "+1", "1-2", "1_2", "1 2", "12", "021",
  "MC 1", "MC 2", "MC 10", "MC-3", "MC_3", "mc 3", "Mc 3", "MC 03", "MC3", "MC 3A", "MC 3a", "MC 3B",
  "7A", "7B", "07A", "10A", "9A", "9a", "A1", "A2", "A10", "a1", "a10", "x-ray", "x ray", "xray", "x_ray", "X-Ray", "x.ray", "(a)", "[a]", "{a}", "<a>", "@a", "#a", "$a", "%a", "&a", "*a", "+a", "=a", "!a", "?a", "/a", "\\a", "|a", "~a", "`a", "^a", "'a", "\"a", ":a", ";a", ",a", ".a",
  "e", "é", "è", "ê", "ë", "E", "É", "f", "é1", "e1", "e2", "n", "ñ", "o", "ö", "ô", "O", "Ö", "u", "ü", "ù", "a", "à", "á", "â", "ä", "å", "ã", "ā", "ç", "c", "C", "Ç", "ł", "l", "ń", "š", "s", "ž", "z", "ý", "y", "ÿ",
  "Ravi K", "ravi k", "Ravi  K", "RAVI K", "Sunil", "sunil", "Sunil 2", "Op 10", "Op 2", "Op 1", "op 1", "OP 1",
  "Bracket A", "Flange 10", "Flange 2", "Shaft-7", "Housing", "bush", "Bush", "(no part)", "(no operator)", "—",
  "Ω", "α", "β", "Б", "б", "А", "中", "日本", "あ", "ア", "क", "अ", "ا", "😀", "€1", "£1", "°", "–", "‘a",
];
const natRows = NAT.map((a) => NAT.map((b) => Math.sign(a.localeCompare(b, undefined, { numeric: true }))));
const natOut = { strings: NAT, matrix: natRows.map((r) => r.map((v) => (v < 0 ? "<" : v > 0 ? ">" : "=")).join("")) };

// ── formats ────────────────────────────────────────────────────────────────
const FORMAT_INPUTS = [
  "__undefined__", null, "__NaN__", "__Infinity__", "__-Infinity__", 0, -0, 1, -1, 0.5, -0.5, 1.005, 1.234, 2.5, 12.345, 99.995, 99.994999, 100, 999, 1000, 1234.5678, 9999.999, 12345.6789, 99999, 99999.5, 99999.99, 99999.994, 99999.995, 100000, 100000.4, 100000.5, 100000.01,
  123455, 123456, 123456.789, 199999.99, 250000.125, 269412, 999994, 999995, 999999, 999999.4, 999999.5, 1000000, 1000001, 1005000, 1234567, 1e7 - 1, 9999995, 9994999, 12345678, 99999999, 99999999.5, 123456789, 999999999, 1e9, 1234567890, 9.99999e9, 1e10, 1.5e10, 99999999999, 1e11, 999999999999, 1e12, 1234567890123, 1e13, 9999999999999, 1e14, 123456789012345, 999999999999999, 1e15, 1234567890123456,
  1e16, 1e17, 1.234e18, 1e20, 1e21, 5e-7, 0.1 + 0.2, -99999.995, -100000, -123456, -999999.5, -1234567, -1e9, -1e12, 1.5, 0.05, 0.005, 0.994, 0.995, 33.333333, 66.666666, 0.9642, 0.96425, 0.999999, 1.000001, 94.7, 0.947, 0.99975, 1.7976931348623157e308,
];
const decodeIn = (v) => (v === "__undefined__" ? undefined : v === "__NaN__" ? NaN : v === "__Infinity__" ? Infinity : v === "__-Infinity__" ? -Infinity : v);
const formatOut = {
  inputs: FORMAT_INPUTS,
  results: Object.fromEntries(
    Object.keys(PD.FORMATS).map((f) => [f, { formatted: FORMAT_INPUTS.map((v) => PD.FORMATS[f](decodeIn(v))), exact: FORMAT_INPUTS.map((v) => PD.formatExact(f, decodeIn(v))) }]),
  ),
  locale: new Intl.NumberFormat().resolvedOptions().locale,
};

// ── catalogs & small helpers ───────────────────────────────────────────────
const catalogOut = {
  STAT_CATALOG: PD.STAT_CATALOG,
  CHART_CATALOG: PD.CHART_CATALOG,
  DEFAULT_STATS: PD.DEFAULT_STATS,
  DEFAULT_CHARTS: PD.DEFAULT_CHARTS,
  STOPPAGE_GROUPS: PD.STOPPAGE_GROUPS,
  EMPTY_FILTERS: PD.EMPTY_FILTERS,
  MONTH_LABELS: PD.MONTH_LABELS,
  MAX_RANGE_DAYS: PD.MAX_RANGE_DAYS,
  DEFAULT_RANGE_KEY: PD.DEFAULT_RANGE_KEY,
  statKeys: Object.keys(PD.STATS_BY_KEY),
  chartKeys: Object.keys(PD.CHARTS_BY_KEY),
  dimensionKeys: Object.keys(PD.DIMENSIONS),
  dimensionLabels: Object.fromEntries(Object.entries(PD.DIMENSIONS).map(([k, d]) => [k, d.label])),
  quickKeys: PD.QUICK_RANGES.map((q) => [q.key, q.label]),
  causeLabels: [...PS.STOPPAGE_FIELDS.map((f) => f.key), "nope", "", "otherMin (min)"].map((k) => [k, PD.causeLabel(k)]),
  monthLabels: ["2026-01", "2026-02", "2026-12", "1999-07", "2026-13", "2026-00", "2026-9", "2026", "", "abcd-ef", "2026-1x", "2026-05-15"].map((m) => [m, PD.monthLabel(m)]),
  dimTexts: {
    machine: ["m1", "m8", "m9", "", "zzz"].map((v) => [v, PD.DIMENSIONS.machine.text(v, { machineName: MACHINE_NAMES })]),
    operator: ["", "Ravi K"].map((v) => [v, PD.DIMENSIONS.operator.text(v)]),
    item: ["", "Flange 10"].map((v) => [v, PD.DIMENSIONS.item.text(v)]),
    month: ["2026-01", "2026-12", "2026-13"].map((v) => [v, PD.DIMENSIONS.month.text(v)]),
    date: ["2026-09-05", "1999-01-31"].map((v) => [v, PD.DIMENSIONS.date.text(v)]),
  },
  resolve: [
    ["undef", undefined],
    ["null", null],
    ["empty", []],
    ["mixed", ["totalQty", "bogus", "okQty", "totalQty", "", null, 5]],
    ["notArray", "totalQty"],
    ["object", { 0: "totalQty" }],
  ].map(([name, saved]) => ({
    name,
    saved: saved === undefined ? "__undefined__" : saved,
    stats: PD.resolveWidgets(saved, PD.STATS_BY_KEY, PD.DEFAULT_STATS).map((w) => w.key),
    charts: PD.resolveWidgets(saved, PD.CHARTS_BY_KEY, PD.DEFAULT_CHARTS).map((w) => w.key),
  })),
};

// ── period helpers (pinned "now") ──────────────────────────────────────────
const NOWS = [
  [2026, 9, 25, 10, 30], [2026, 1, 1, 0, 0], [2026, 12, 31, 23, 59], [2024, 3, 1, 9, 0], [2024, 2, 29, 12, 0], [2026, 3, 31, 0, 1], [2025, 3, 30, 12, 0], [2026, 3, 8, 12, 0], [2026, 11, 1, 12, 0], [2100, 3, 1, 12, 0], [2026, 5, 31, 23, 30], [2026, 10, 31, 1, 30],
];
function withNow([y, m, d, h, mi], fn) {
  const NOW = new RealDate(y, m - 1, d, h, mi, 0).getTime();
  class FakeDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(NOW);
      else super(...a);
    }
    static now() {
      return NOW;
    }
  }
  globalThis.Date = FakeDate;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}
const EXTENTS = [null, { from: "2026-01-05", to: "2026-09-25" }, { from: "2023-02-01", to: "2025-12-31" }, { from: "2026-09-01", to: "2026-09-01" }, { from: "2020-01-01", to: "2030-06-01" }, { from: "2027-01-01", to: "2028-01-01" }, { from: "1999-12-31", to: "2026-01-01" }];
const RANGES_FOR_DESCRIBE = [
  ["2025-01-01", "2025-12-31"], ["2026-09-01", "2026-09-30"], ["2024-02-01", "2024-02-29"], ["2023-02-01", "2023-02-28"], ["2026-09-05", "2026-09-05"], ["2026-09-05", "2026-09-06"], ["2026-08-15", "2026-09-14"], ["2026-01-01", "2026-06-30"], ["2026-01-01", "2027-12-31"], ["2026-02-01", "2026-02-29"], ["", ""], ["2026-09-01", ""], ["", "2026-09-30"], ["2026-12-01", "2026-12-31"], ["2026-01-01", "2026-01-31"], ["2026-09-30", "2026-09-01"], ["2026-09-01", "2026-09-31"],
];
const periodOut = NOWS.map((now) =>
  withNow(now, () => {
    const q = Object.fromEntries(PD.QUICK_RANGES.map((qr) => [qr.key, qr.range()]));
    const other = [["2026-09-01", "2026-09-30"], ["2025-01-01", "2025-12-31"], ["2026-09-25", "2026-09-25"]].concat(Object.values(q), [q.last7.slice().reverse()]);
    return {
      now,
      quick: q,
      defaultRange: PD.defaultRange(),
      defaultEntryRange: PD.defaultEntryRange(),
      quickKeys: other.map((r) => [r, PD.quickRangeKey(r)]),
      years: EXTENTS.map((e) => PD.yearsOfExtent(e)),
      describe: RANGES_FOR_DESCRIBE.map((r) => PD.describeRange(r)).concat(Object.values(q).map((r) => PD.describeRange(r))),
    };
  }),
);

const staticPeriod = {
  isoDate: [[2026, 9, 5, 12], [2026, 12, 31, 23], [2026, 1, 1, 0], [2024, 2, 29, 6], [1999, 12, 31, 12], [2026, 3, 8, 3], [2026, 11, 1, 1], [2100, 2, 28, 12]].map(([y, m, d, h]) => [[y, m, d, h], PD.isoDate(new RealDate(y, m - 1, d, h))]),
  parse: ["2026-09-05", "2024-02-29", "1999-12-31", "2026-01-01", "2026-9-5", "2026-13-01", "2026-02-30", "2026-00-10", "2026-01-00", "0099-01-01", "2026-12-31", "2100-02-29"].map((s) => {
    const d = PD.parseIsoDate(s);
    return [s, [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]];
  }),
  monthRange: ["2026-09", "2026-02", "2024-02", "2100-02", "2000-02", "1900-02", "2026-12", "2026-01", "2026-1", "2026-11", "2026-04", "1999-07", "2026-13", "2026-00"].map((m) => [m, PD.monthRange(m)]),
  yearRange: [2024, 2025, 2026, 1999, 2100].map((y) => [y, PD.yearRange(y)]),
  rangeDays: [
    ["2026-09-01", "2026-09-30"], ["2026-09-05", "2026-09-05"], ["2024-02-01", "2024-03-01"], ["2026-01-01", "2026-12-31"], ["2020-01-01", "2024-12-31"], ["2021-01-01", "2025-12-31"], ["2026-03-01", "2026-03-31"], ["2026-10-01", "2026-11-30"], ["2025-03-01", "2025-04-30"], ["2026-09-10", "2026-09-01"], ["2026-01-01", "2026-01-02"], ["2026-03-07", "2026-03-09"], ["2026-11-01", "2026-11-02"], ["1999-12-31", "2000-01-01"],
  ].map((r) => [r, PD.rangeDays(r)]),
};

const doc = {
  scenarios: scenarioOut,
  toggles,
  compare: compareOut,
  natural: natOut,
  formats: formatOut,
  catalogs: catalogOut,
  period: periodOut,
  staticPeriod,
};

const enc = (k, v) => (typeof v === "number" && !Number.isFinite(v) ? `__${v}__` : v);
process.stdout.write(JSON.stringify(doc, enc));
