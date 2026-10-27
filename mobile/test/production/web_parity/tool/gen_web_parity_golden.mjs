// Golden-fixture generator for test/production/web_parity/* (Wave 1 of the
// phone's Data Entry completion): the REAL client JS for
//   utils/vendorsFor.js, utils/plannedShift.js, utils/limitNotice.js,
//   utils/productionSheet.js (metricsOver100, rowCalc, fmtPct),
// plus the two bits that live only inside a .jsx file and are copied verbatim
// (ProductionEntriesTable.jsx: pctOver's test, ReviewBadge's text/tone/title,
// MACHINE_STATUS_COLUMN.get).
//
//   ESB=/Users/hqepldev/HQEPL/Indo-OEE/client/node_modules/.bin/esbuild
//   $ESB test/production/web_parity/tool/gen_web_parity_golden.mjs --bundle --platform=node \
//        --format=esm --outfile=<scratch>/wp-golden/gen.mjs
//   OUT_DIR=test/production/web_parity/fixtures TZ=Asia/Kolkata node <scratch>/wp-golden/gen.mjs
//
// Same markers as the CNC generator: {"$n":"NaN"|"Inf"|"-Inf"}, {"$u":1}.

import fs from "node:fs";
import path from "node:path";
import { vendorsForProcess, vendorsForMachine, anyVendorFor } from "../../../../../client/src/utils/vendorsFor.js";
import { lockedHours, shiftSettingOf, shiftSettingForMachine } from "../../../../../client/src/utils/plannedShift.js";
import { qtyNotice, stoppageNotice, firstOverLimit, WORKER_WORDS } from "../../../../../client/src/utils/limitNotice.js";
import { metricsOver100, rowCalc, fmtPct } from "../../../../../client/src/utils/productionSheet.js";
import { validateEntry } from "../../../../../client/src/utils/entryValidation.js";

const OUT = process.env.OUT_DIR;
if (!OUT) throw new Error("set OUT_DIR");
fs.mkdirSync(OUT, { recursive: true });

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(Number(process.env.SEED || 20261022));
const SCALE = Number(process.env.SCALE || 1);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

function enc(v) {
  if (v === undefined) return { $u: 1 };
  if (typeof v === "number") {
    if (Number.isNaN(v)) return { $n: "NaN" };
    if (v === Infinity) return { $n: "Inf" };
    if (v === -Infinity) return { $n: "-Inf" };
    return v;
  }
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = enc(x);
    return o;
  }
  return v;
}
function encIn(v) {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : encIn(x)));
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = encIn(x);
    return o;
  }
  return enc(v);
}
const write = (name, data) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(data));
const N = (n) => Math.round(n * SCALE);

// ── vendors ────────────────────────────────────────────────────────────────
const PROCS = ["p1", "p2", "p3", "p4"];
const procRef = () => (chance(0.3) ? { _id: pick(PROCS) } : pick(PROCS));
function vendorList() {
  const out = [];
  for (let i = 0; i < int(0, 6); i += 1) {
    const v = { _id: `v${i}`, name: `Vendor ${i}` };
    if (chance(0.7)) v.isActive = pick([true, true, false]);
    if (chance(0.9)) v.processes = Array.from({ length: int(0, 3) }, procRef);
    out.push(v);
  }
  return out;
}
const vendorCases = [];
for (let i = 0; i < N(400); i += 1) {
  const vendors = vendorList();
  const machines = Array.from({ length: int(1, 4) }, (_, k) => {
    const m = { _id: `m${k}` };
    if (chance(0.85)) m.process = chance(0.2) ? { _id: pick(PROCS) } : pick([...PROCS, "", null]);
    return m;
  });
  const processId = pick([...PROCS, { _id: pick(PROCS) }, "", null, undefined, 0, "nope"]);
  const machineId = pick([...machines.map((m) => m._id), "m9", "", null, undefined]);
  const ids = Array.from({ length: int(0, 3) }, () => pick([...PROCS, null, "", { _id: pick(PROCS) }]));
  vendorCases.push({
    vendors: encIn(vendors),
    machines: encIn(machines),
    processId: encIn(processId),
    machineId: encIn(machineId),
    processIds: encIn(ids),
    forProcess: vendorsForProcess(vendors, processId).map((v) => v._id),
    forMachine: vendorsForMachine(vendors, machines, machineId).map((v) => v._id),
    any: anyVendorFor(vendors, ids),
  });
}
write("vendors.json", vendorCases);

// ── planned shift ──────────────────────────────────────────────────────────
const HOURS = [12, 8, "8", "7.5", 0, "0", 25, 24, 0.5, null, undefined, "abc", -1, "", 11.25, "24", "24.5"];
const shiftCases = [];
for (let i = 0; i < N(300); i += 1) {
  const processes = Array.from({ length: int(0, 4) }, (_, k) => {
    const p = { _id: `p${k}` };
    if (chance(0.7)) p.plannedShiftLocked = pick([true, false, undefined, null, "false", 0]);
    if (chance(0.8)) p.plannedShiftHours = pick(HOURS);
    return p;
  });
  const machines = Array.from({ length: int(1, 4) }, (_, k) => {
    const m = { _id: `m${k}` };
    if (chance(0.85)) m.process = pick(["p0", "p1", "p2", "p3", "p9", "", null]);
    return m;
  });
  const process = pick([...processes, null, undefined]);
  const machineId = pick([...machines.map((m) => m._id), "m9", "", null, undefined]);
  shiftCases.push({
    process: encIn(process),
    machines: encIn(machines),
    processes: encIn(processes),
    machineId: encIn(machineId),
    locked: lockedHours(process),
    setting: shiftSettingOf(process),
    forMachine: shiftSettingForMachine(machineId, machines, processes),
  });
}
write("planned_shift.json", shiftCases);

// ── limit notices ──────────────────────────────────────────────────────────
const calcCases = [];
const QTYS = [0, 1, 55, 240, 480, 599.5, 600, 12345, "300", "", null, undefined, NaN, Infinity];
for (let i = 0; i < N(200); i += 1) {
  const calc = {
    idealQty: pick([0, 1, 100, 480, 600, 777.5, null, undefined, NaN]),
    shiftHours: pick([8, 7.5, 0, 12.25, null, undefined, "8", NaN]),
    totalCycleSec: pick([45, 60, 12.5, 0, null, undefined, "36"]),
  };
  const entered = pick(QTYS);
  const machine = pick(["", "CNC 1", "Lathe 7B"]);
  const label = pick([undefined, "Actual Quantity", "OK + Rejected"]);
  const worker = chance(0.25);
  calcCases.push({
    calc: encIn(calc),
    entered: encIn(entered),
    machine,
    label: label ?? null,
    worker,
    qty: enc(qtyNotice({ calc, entered, machine, ...(label ? { label } : {}), ...(worker ? { words: WORKER_WORDS } : {}) })),
    limitMin: encIn(pick([480, 60, 0, 12.5, 1440, "90"])),
    totalMin: encIn(pick([500, 75, 0, 1500.5, "100", NaN, null])),
  });
  const c = calcCases[calcCases.length - 1];
  c.stoppage = enc(stoppageNotice({ limitMin: c.limitMin, totalMin: c.totalMin, machine, ...(worker ? { words: WORKER_WORDS } : {}) }));
}
write("limit_notice.json", calcCases);

// firstOverLimit over real CNC rows + the real CNC validation
const T = [["06:00", "14:00"], ["08:00", "16:00"], ["22:00", "06:00"], ["09:00", "09:30"], ["", "12:00"], ["10:00", "10:00"]];
const overCases = [];
for (let i = 0; i < N(300); i += 1) {
  const blocks = Array.from({ length: int(1, 3) }, (_, k) => {
    const [on, off] = pick(T);
    return {
      date: "2026-04-06",
      machine: pick(["m1", "m2", "m3"]),
      operator: pick(["Ravi", "", "Sita"]),
      itemName: pick(["Part A", ""]),
      machineOnTime: on,
      machineOffTime: off,
      totalCycleSec: pick(["60", "45", "12.5", "3600", ""]),
      actualQty: pick(["", "0", "100", "480", "700", "9999", "abc"]),
      okQty: pick(["", "0", "100", "480", "700"]),
      plannedOperatorShiftHours: pick(["8", "12", "8.30", ""]),
      lunchMin: pick(["", "30", "600"]),
      setupMin: pick(["", "0", "25", "700"]),
      otherMin: pick(["", "0", "10"]),
      otherMinRemark: pick(["", "x"]),
      excludedOps: [],
      rejectBreakdown: {},
    };
  });
  const errorsList = blocks.map((b) => validateEntry(b));
  const names = { m1: "CNC 1", m2: "CNC 2" };
  const out = firstOverLimit(blocks, errorsList, rowCalc, { qtyKey: "actualQty", machineName: names });
  overCases.push({ blocks: encIn(blocks), errors: encIn(errorsList), machineName: names, out: enc(out) });
}
write("first_over_limit.json", overCases);

// ── review / over 100 / working status (copied from ProductionEntriesTable.jsx) ──
const REVIEW_STYLE = {
  pending: ["Pending review", "bg-warning-subtle text-warning-emphasis"],
  approved: ["Approved", "bg-success-subtle text-success-emphasis"],
  rejected: ["Rejected", "bg-danger-subtle text-danger-emphasis"],
};
const METRIC_LABEL = { availability: "Availability", performance: "Performance", quality: "Quality" };
const reviewOf = (review) => {
  const style = review && REVIEW_STYLE[review.status];
  if (!style) return { text: "—", tone: "", over: "", by: "", remark: "" };
  const over = (review.flagged || []).map((f) => `${METRIC_LABEL[f.metric] || f.metric} ${fmtPct(f.value)}`).join(", ");
  const by = review.decidedBy?.name ? ` — ${review.status} by ${review.decidedBy.name}` : "";
  return { text: style[0], tone: style[1], over, by: by ? by.slice(3) : "", remark: review.remark || "" };
};
const reviewCases = [];
const STATUSES = ["pending", "approved", "rejected", "weird", "", undefined, null];
for (let i = 0; i < N(200); i += 1) {
  const review = chance(0.15)
    ? pick([undefined, null, {}])
    : {
        status: pick(STATUSES),
        flagged: chance(0.8) ? Array.from({ length: int(0, 3) }, () => ({ metric: pick(["availability", "performance", "quality", "other"]), value: pick([1.05, 1.5, 2, 1.0000001, 0.99, 3.14159]) })) : undefined,
        decidedBy: chance(0.5) ? { name: pick(["Asha", "", "Dev"]) } : undefined,
        remark: pick(["", "ok", "recheck cycle time", undefined]),
      };
  reviewCases.push({ review: encIn(review), out: reviewOf(review) });
}
write("review.json", reviewCases);

const pctOver = (v) => Number.isFinite(v) && v > 1 + 1e-9;
const overCases2 = [];
for (let i = 0; i < N(200); i += 1) {
  const v = pick([0, 0.5, 1, 1.0000000001, 1.000000002, 1.05, 2, -1, NaN, Infinity, null, undefined, "1.5", "abc"]);
  const calc = { availability: v, performance: pick([0.9, 1.2, null, undefined, NaN]), quality: pick([1, 1.01, 0]) };
  // The OEE / Productivity figures of the day (withDayFigures) hold an entry too.
  if (i % 2) Object.assign(calc, { oeeLosses: [0.9, 1.025, 1, null][i % 4], oeeLunch: [1.0000000001, 1.2, undefined][i % 3], oeeLunchCot: [0.5, 1.5, NaN][i % 3], productivity: [1, 1.3, null][(i >> 1) % 3], productivityLunch: [0.8, 1.000000002][(i >> 1) % 2] });
  overCases2.push({ v: encIn(v), over: pctOver(v), calc: encIn(calc), keys: metricsOver100(calc) });
}
write("over_100.json", overCases2);

const statusText = (r) =>
  r.workingMode === "Non Working" ? ["Non Working", ...(r.machineStatus || [])].join(" — ") : (r.machineStatus || []).length ? `Working — ${(r.machineStatus || []).join(", ")}` : "Working";
const statusCases = [];
const MS = ["Machine Breakdown", "No Manpower", "No Planning"];
for (let i = 0; i < N(120); i += 1) {
  const r = {};
  if (chance(0.8)) r.workingMode = pick(["Working", "Non Working", "", "other"]);
  if (chance(0.8)) r.machineStatus = MS.filter(() => chance(0.5));
  statusCases.push({ row: encIn(r), out: statusText(r) });
}
write("working_status.json", statusCases);
// The three payload keys the CNC page's toPayload (ProductionSheet.jsx) added for
// the web-parity extras, copied from its body, and the form-value side of them.
const payloadPart = (v) => ({
  machineStatus: v.workingMode === "Non Working" ? v.machineStatus || [] : [],
  workingMode: v.workingMode || "Working",
  vendor: v.vendor || null,
});
const payloadCases = [];
for (let i = 0; i < N(150); i += 1) {
  const v = {};
  if (chance(0.8)) v.workingMode = pick(["Working", "Non Working", "", undefined, null]);
  if (chance(0.8)) v.machineStatus = pick([[], ["No Manpower"], ["Machine Breakdown", "No Planning"], undefined, null]);
  if (chance(0.7)) v.vendor = pick(["", "v1", null, undefined, "v2"]);
  payloadCases.push({ values: encIn(v), out: enc(payloadPart(v)) });
}
write("payload_fields.json", payloadCases);
console.log("web parity fixtures written to", OUT);
