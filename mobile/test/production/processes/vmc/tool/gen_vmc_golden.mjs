// Golden-fixture generator for test/production/processes/vmc/*.
//
// Runs the REAL client/src/utils/vmcSheet.js + vmcValidation.js (and the CNC
// functions they sit on) over a deterministic (seeded) input set and writes the
// JSON the Dart tests compare against. client/ is only READ.
//
//   cd mobile
//   ESB=../client/node_modules/.bin/esbuild
//   $ESB test/production/processes/vmc/tool/gen_vmc_golden.mjs --bundle --platform=node \
//        --format=esm --outfile=/tmp/vmc-golden/gen.mjs
//   OUT_DIR=test/production/processes/vmc/fixtures TZ=Asia/Kolkata node /tmp/vmc-golden/gen.mjs
//   (SEED=.. SCALE=.. for a one-off soak run.)
//
// NaN/Infinity/undefined travel as {"$n":"NaN"|"Inf"|"-Inf"} / {"$u":1}.

import fs from "node:fs";
import path from "node:path";
import { sortByMachineOn } from "../../../../../../client/src/utils/productionSheet.js";
import { vmcRowCalc, vmcDayCalc, programCycleSec, VMC_FORMULAS } from "../../../../../../client/src/utils/vmcSheet.js";
import { VMC_FIELD_ORDER, VMC_DOWNTIME_KEYS, firstVmcError, validateVmcEntry } from "../../../../../../client/src/utils/vmcValidation.js";
import { STOPPAGE_FIELDS } from "../../../../../../client/src/utils/productionSheet.js";
import { hmToWireHours, parseHm } from "../../../../../../client/src/utils/shiftHours.js";

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

// ── generators ──────────────────────────────────────────────────────────────
const TIMES_OK = ["06:00", "07:30", "08:00", "9", "930", "0930", "9:30", "9.30", "13:15", "14:00", "16:00", "21:30", "22:00", "23:59", "00:00", "02:00", "05:45"];
const TIMES_BAD = ["24:00", "9:5", "abc", "12345", "", "  ", "25", "7:60", null, undefined, 930, 9, "9-30"];
const NUMS = ["", undefined, null, "0", "1", "5", "10", "12.5", 3, 7.5, "  ", "abc", "-4", "1e2", "0x10", "45", 45, "120", "0.5", "600", "1440", "1441"];
const PROGRAM_MIN = ["", undefined, null, "0", "1", "5", "7", "12.5", "30", 7, 12.5, "abc", "-2", "  ", "0.5", "480"];
const PIECES = ["", undefined, null, "0", "1", "2", "3", "9", "12", 4, "2.5", "abc", "-1", "  ", "100"];
const QTY = ["", undefined, null, "0", "10", "50", "100", "250", "300", "480", "599", "600", 320, 55, "12.5", "-3", "abc", "  ", "9999"];
const ITEMS = ["Part A", "Bracket 7B", "Flange", " Part B ", "X"];
const PLANNED_TYPED = ["", undefined, "abc", "8", "8.30", "8.5", "8.75", "0", "25", "24", "3.5", "12", "9.15", "7.60", "0.01", "1000", "8,30", 8, "  ", "10.45"];
const PLANNED_DEC = ["", undefined, null, "8", "8.5", 8, 9, 12, "4", 0, 25, "abc", 7.5, 3.8333333];
const STOP = ["", undefined, null, "0", "5", "10", "25", "30", "45", "120", "-1", "1440", "1441", "abc", 12.5, 20];

const vmcRow = (id, { typed }) => {
  const shifts = [["06:00", "14:00"], ["14:00", "22:00"], ["22:00", "06:00"], ["08:00", "16:00"], ["07:30", "15:45"], ["9", "17"], ["0930", "1330"], ["9:30", "18.15"], ["08:00", "08:00"]];
  const [on, off] = pick(shifts);
  const row = { _id: id, date: "2026-04-06", machine: "m" + int(1, 4), operator: pick(["op1", "op2", "", "  "]), slot: int(1, 3) };
  if (chance(0.9)) row.itemName = pick(ITEMS);
  row.machineOnTime = on;
  row.machineOffTime = off;
  row.programTimeMin = pick(["5", "7", "12.5", "30", 10, "3", PROGRAM_MIN]).valueOf?.() ?? "5";
  if (Array.isArray(row.programTimeMin)) row.programTimeMin = pick(PROGRAM_MIN);
  row.pcsPerProgram = pick(["1", "2", "3", "9", 4, "12"]);
  row.okQty = String(int(0, 400));
  row.rejectedQty = String(int(0, 60));
  row.plannedOperatorShiftHours = typed ? pick(["8", "8.30", "9", "12", "4.15", "10.45"]) : pick(["8", "8.5", "9", "12", 8, 9.25]);
  row.lunchMin = pick(["0", "20", "30", "45", "", 30]);
  for (const k of VMC_DOWNTIME_KEYS) if (chance(0.3)) row[k] = pick(["", "0", "10", "25", "5"]);
  if (chance(0.3)) row.remarks = pick(["", "ok", "late start"]);
  if (chance(0.2)) row.otherMinRemark = pick(["", "tea", "  "]);
  if (chance(0.1)) row.workingMode = "Non Working";
  return row;
};

const junkRow = (id, { typed }) => {
  const row = { _id: id };
  const maybe = (p, k, v) => {
    if (chance(p)) row[k] = v;
  };
  maybe(0.5, "date", pick(["2026-04-06", "", undefined]));
  maybe(0.5, "machine", pick(["m1", "", "  ", undefined]));
  maybe(0.5, "operator", pick(["op1", "", " ", undefined, 7]));
  maybe(0.85, "itemName", pick(["Part A", " ", "", null, undefined, 7]));
  maybe(0.9, "machineOnTime", pick([...TIMES_OK, ...TIMES_BAD]));
  maybe(0.9, "machineOffTime", pick([...TIMES_OK, ...TIMES_BAD]));
  maybe(0.9, "programTimeMin", pick(PROGRAM_MIN));
  maybe(0.9, "pcsPerProgram", pick(PIECES));
  maybe(0.8, "okQty", pick(QTY));
  maybe(0.8, "rejectedQty", pick(QTY));
  maybe(0.15, "actualQty", pick(QTY));
  maybe(0.8, "plannedOperatorShiftHours", pick(typed ? PLANNED_TYPED : PLANNED_DEC));
  maybe(0.5, "lunchMin", pick(STOP));
  for (const f of STOPPAGE_FIELDS) maybe(0.3, f.key, pick(STOP));
  maybe(0.2, "otherMinRemark", pick(["", " ", "x", undefined]));
  maybe(0.1, "workingMode", pick(["Non Working", "Working", undefined, ""]));
  maybe(0.1, "excludedOps", pick([[], ["programTimeMin"], ["pcsPerProgram", "programTimeMin"], null]));
  maybe(0.05, "otherActivityMin", pick(NUMS));
  return row;
};

const makeRow = (id, opts) => (chance(0.55) ? vmcRow(id, opts) : junkRow(id, opts));

// ── rowCalc ─────────────────────────────────────────────────────────────────
const rowCases = [];
for (let i = 0; i < 700 * SCALE; i += 1) {
  const row = makeRow("r" + i, { typed: false });
  rowCases.push({ row: encIn(row), out: enc(vmcRowCalc(row)) });
}
// Hand-picked: the "7 min over 9 pieces" case the web comment names, and edge programs.
for (const [p, n, on, off] of [["7", "9", "08:00", "16:00"], ["7", "9", "06:00", "14:00"], ["5", "1", "08:00", "08:01"], ["0", "5", "08:00", "16:00"], ["5", "0", "08:00", "16:00"]]) {
  const row = { _id: "h", itemName: "P", programTimeMin: p, pcsPerProgram: n, machineOnTime: on, machineOffTime: off, okQty: "10", rejectedQty: "1", plannedOperatorShiftHours: 9 };
  rowCases.push({ row: encIn(row), out: enc(vmcRowCalc(row)) });
}
write("row_calc.json", rowCases);

// programCycleSec on its own
const cycleCases = [];
for (let i = 0; i < 200 * SCALE; i += 1) {
  const row = { programTimeMin: pick(PROGRAM_MIN), pcsPerProgram: pick(PIECES) };
  cycleCases.push({ row: encIn(row), out: enc(programCycleSec(row)) });
}
write("cycle.json", cycleCases);

// ── dayCalc ─────────────────────────────────────────────────────────────────
const dayCases = [];
for (let i = 0; i < 250 * SCALE; i += 1) {
  const n = int(0, 4);
  const rows = Array.from({ length: n }, (_, j) => makeRow(`d${i}_${j}`, { typed: false }));
  const sorted = sortByMachineOn(rows);
  dayCases.push({ rows: encIn(rows), sorted: encIn(sorted), out: enc(vmcDayCalc(sorted)) });
}
write("day_calc.json", dayCases);

// ── validation ──────────────────────────────────────────────────────────────
const valCases = [];
for (let i = 0; i < 1200 * SCALE; i += 1) {
  const v = makeRow("v" + i, { typed: true });
  if (chance(0.7)) v.date = "2026-04-06";
  if (chance(0.7)) v.machine = "m1";
  let saved = null;
  if (chance(0.25)) saved = { machineOnTime: chance(0.6) ? v.machineOnTime : pick(TIMES_OK), machineOffTime: chance(0.6) ? v.machineOffTime : pick(TIMES_OK) };
  valCases.push({ values: encIn(v), saved: saved && encIn(saved), errors: enc(validateVmcEntry(v, { saved })) });
}
// complete, valid-ish blocks so the "ok" and cap paths are exercised too
for (let i = 0; i < 300 * SCALE; i += 1) {
  const v = {
    _id: "ok" + i,
    date: "2026-04-06",
    machine: "m1",
    operator: "Ravi",
    item: "i1",
    itemName: "Bracket",
    programTimeMin: pick(["5", "10", "7", "30"]),
    pcsPerProgram: pick(["1", "2", "9", "4"]),
    machineOnTime: pick(["08:00", "06:00", "9:30"]),
    machineOffTime: pick(["16:00", "14:00", "18:00"]),
    okQty: String(int(0, 200)),
    rejectedQty: String(int(0, 40)),
    plannedOperatorShiftHours: pick(["9", "8.30", "10", "12"]),
    lunchMin: pick(["", "30", "45"]),
  };
  for (const k of VMC_DOWNTIME_KEYS) if (chance(0.25)) v[k] = String(int(0, 90));
  if (Number(v.otherMin) > 0 && chance(0.5)) v.otherMinRemark = "tea";
  valCases.push({ values: encIn(v), saved: null, errors: enc(validateVmcEntry(v, {})) });
}
write("validation.json", valCases);

// firstVmcError over lists of (generated) error maps
const firstCases = [];
for (let i = 0; i < 150 * SCALE; i += 1) {
  const n = int(0, 3);
  const list = Array.from({ length: n }, () => {
    if (chance(0.3)) return chance(0.5) ? {} : null;
    const e = {};
    for (const k of [...VMC_FIELD_ORDER, "weird"]) if (chance(0.12)) e[k] = "msg " + k;
    return e;
  });
  firstCases.push({ errors: list, out: enc(firstVmcError(list)) });
}
write("first_error.json", { fieldOrder: VMC_FIELD_ORDER, downtimeKeys: VMC_DOWNTIME_KEYS, cases: firstCases });

// ── toPayload (body of VmcDataEntry.jsx's handler, copied — pages aren't importable) ──
const STOPPAGE_KEYS = STOPPAGE_FIELDS.map((f) => f.key);
const TEXT_FIELDS = ["operator", "machineNotRun", "workOrderNo", "itemName", "drawingNo", "setupNo", "remarks", "otherMinRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = ["programTimeMin", "pcsPerProgram", "okQty", "rejectedQty", "plannedOperatorShiftHours", ...STOPPAGE_KEYS];
const toPayload = (v, isEdit) => ({
  ...(isEdit && v._id ? { _id: v._id } : {}),
  date: v.date,
  machine: v.machine,
  machineStatus: v.workingMode === "Non Working" ? v.machineStatus || [] : [],
  workingMode: v.workingMode || "Working",
  slot: isEdit ? Number(v.slot) : "auto",
  item: v.item || null,
  vendor: v.vendor || null,
  excludedOps: v.excludedOps || [],
  workOrder: v.workOrder || null,
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, String(v[k] ?? "").trim()])),
  otherMinRemark: Number(v.otherMin) > 0 ? String(v.otherMinRemark ?? "").trim() : "",
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, v[k] ?? ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, v[k] === "" || v[k] === undefined ? "" : Number(v[k])])),
  plannedOperatorShiftHours: (() => {
    const { hours } = parseHm(v.plannedOperatorShiftHours);
    return hours === null ? "" : hmToWireHours(hours);
  })(),
  lunchMin: v.lunchMin === "" || v.lunchMin === undefined ? 0 : Number(v.lunchMin),
});
const payloadCases = [];
for (let i = 0; i < 600 * SCALE; i += 1) {
  // Form values: every typed field is a string ('' blank), as the phone's boxes hold them.
  const v = { ...makeRow("p" + i, { typed: true }) };
  for (const k of [...TEXT_FIELDS, ...TIME_FIELDS, ...NUMBER_FIELDS]) {
    if (v[k] === undefined || v[k] === null) v[k] = "";
    else if (typeof v[k] === "number") v[k] = String(v[k]);
  }
  v.date = "2026-04-06";
  v.machine = chance(0.9) ? "m1" : "";
  v.item = chance(0.7) ? "i1" : "";
  v.vendor = chance(0.2) ? "v1" : "";
  v.workOrder = chance(0.2) ? "w1" : "";
  v.workOrderNo = chance(0.2) ? " WO-7 " : "";
  v.machineStatus = chance(0.4) ? pick([["Machine Breakdown"], ["No Manpower", "No Planning"], []]) : [];
  v.excludedOps = chance(0.3) ? ["programTimeMin"] : [];
  v.drawingNo = chance(0.5) ? " D-12 " : "";
  v.setupNo = chance(0.3) ? "S1" : "";
  const isEdit = chance(0.5);
  payloadCases.push({ values: encIn(v), isEdit, payload: JSON.parse(JSON.stringify(toPayload(v, isEdit))) });
}
write("payload.json", payloadCases);

write("formulas.json", VMC_FORMULAS);
console.log("vmc golden written to", OUT, { rows: rowCases.length, day: dayCases.length, validation: valCases.length, payload: payloadCases.length });
