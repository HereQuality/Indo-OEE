// Golden-fixture generator for test/production/processes/press/*.
//
// Runs the REAL client/src/utils/pressSheet.js + pressValidation.js (and the page's
// toPayload, copied below — pages are not importable) over a seeded input set and
// writes the JSON the Dart tests compare against. client/ is only READ.
//
//   cd mobile
//   ESB=../client/node_modules/.bin/esbuild
//   $ESB test/production/processes/press/tool/gen_press_golden.mjs --bundle --platform=node \
//        --format=esm --outfile=<scratch>/press-golden/gen.mjs
//   OUT_DIR=test/production/processes/press/fixtures TZ=Asia/Kolkata node <scratch>/press-golden/gen.mjs
//
// SEED=.. / SCALE=.. give bigger one-off soak sets (the committed fixtures use SCALE=1).
// NaN/Infinity/undefined travel as {"$n":..} / {"$u":1} (see test/production/calc/golden_support.dart).

import fs from "node:fs";
import path from "node:path";
import {
  PRESS_FORMULAS,
  PRESS_OPERATIONS,
  PRESS_PROGRAM_FIELDS,
  pressDayCalc,
  pressRowCalc,
  standardCycleSec,
} from "../../../../../../client/src/utils/pressSheet.js";
import {
  PRESS_DOWNTIME_KEYS,
  PRESS_FIELD_ORDER,
  firstPressError,
  validatePressEntry,
} from "../../../../../../client/src/utils/pressValidation.js";
import { REJECT_REASONS, STOPPAGE_FIELDS, metricsOver100, sortByMachineOn } from "../../../../../../client/src/utils/productionSheet.js";
import { stoppageLimitMin, withDecimalPlanned } from "../../../../../../client/src/utils/entryValidation.js";
import { rejectPayload } from "../../../../../../client/src/utils/quantityRules.js";
import { hmToWireHours, parseShiftHours } from "../../../../../../client/src/utils/shiftHours.js";

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
const TIMES_OK = ["06:00", "07:30", "08:00", "9", "930", "0930", "9:30", "13:15", "14:00", "16:00", "21:30", "22:00", "23:59", "00:00", "02:00", "05:45"];
const TIMES_BAD = ["24:00", "9:5", "abc", "12345", "", "  ", "25", "7:60", null, undefined, 930, 9, "9-30"];
const NUMS = ["", undefined, null, "0", "1", "5", "10", "12.5", 3, 7.5, "  ", "abc", "-4", "1e2", "45", 45, "120", "0.5", "600", "1440", "1441"];
const QTY = ["", undefined, null, "0", "10", "100", "250", "300", "480", "599", "600", "640", 320, 55, "12.5", "-3", "abc", "  ", "9999"];
const PLANNED = ["", undefined, "8", "8.30", "9.00", "12", "4.15", "3.5", "3.75", "0", "0.00", "24", "24.01", "25", "abc", "8.60", "8,30", " 9 ", "1.5", "7.45", "10.59", "1000", "8.", ".5"];
const ITEMS = ["Press Part A", "Bracket 7B", "Flange", " Part B ", "X"];
const STD = ["2", "1", "0.5", "3", "10", 2, 1.5, "7", "0", "-1", "abc", "", undefined, null, "1e1", "60"];
const PCS = ["1", "2", "5", "10", "100", 3, "0", "-2", "2.5", "abc", "", undefined, null, "7"];
const STOP_KEYS = STOPPAGE_FIELDS.map((f) => f.key);

// Actual / OK / the Rejection Master split (reason -> qty) the way the form holds them.
function qtyFields() {
  const ok = int(0, 900);
  const rej = int(0, 40);
  const split = {};
  if (chance(0.7) && rej > 0) {
    const a = int(0, rej);
    const r1 = pick(REJECT_REASONS);
    split[r1] = String(a);
    const r2 = pick(REJECT_REASONS);
    split[r2] = String((Number(split[r2]) || 0) + rej - a);
  }
  const f = { actualQty: String(ok + rej), okQty: String(ok), rejectBreakdown: split };
  if ("Other" in split) f.rejectOtherRemark = pick(["", "cracked", "  burr  "]);
  // A record saved before Actual existed: OK + Rejected only.
  if (chance(0.15)) return { okQty: String(ok), rejectedQty: String(rej) };
  return f;
}

function saneRow(id) {
  const shifts = [["06:00", "14:00"], ["14:00", "22:00"], ["08:00", "16:00"], ["07:30", "15:45"], ["9", "17"], ["0930", "1330"], ["9:30", "18:15"], ["08:00", "12:00"]];
  const [on, off] = pick(shifts);
  const row = {
    _id: id,
    date: "2026-04-06",
    machine: "m" + int(1, 4),
    operator: "op" + int(1, 5),
    itemName: pick(ITEMS),
    machineOnTime: on,
    machineOffTime: off,
    standardTimeMin: pick(["2", "1", "0.5", "3", 2, "7.5"]),
    pcsPerStandardTime: pick(["1", "2", "5", "10", 4]),
    ...qtyFields(),
    plannedOperatorShiftHours: pick([8, 8.5, 9, 12, 4, "8", 7.5, "5.33", "0.5"]),
    lunchMin: pick(["0", "20", "30", "45", "", 30]),
    setupMin: pick(["", "0", "10", "25"]),
    remarks: pick(["", "ok", "late start"]),
  };
  for (const k of STOP_KEYS) if (chance(0.2)) row[k] = pick(["", "0", "5", "15", 10]);
  if (chance(0.1)) row.otherActivityMin = pick(["", "0", "20", 30]);
  return row;
}

function junkRow(id) {
  const row = { _id: id };
  if (chance(0.85)) row.itemName = pick(["Press Part A", "Bracket", " ", "", null, undefined, 7]);
  if (chance(0.9)) row.machineOnTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.9)) row.machineOffTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.9)) row.standardTimeMin = pick(STD);
  if (chance(0.9)) row.pcsPerStandardTime = pick(PCS);
  if (chance(0.85)) row.okQty = pick(QTY);
  if (chance(0.85)) row.rejectedQty = pick(QTY);
  if (chance(0.5)) row.actualQty = pick(QTY);
  if (chance(0.4)) row.rejectBreakdown = pick([{}, { [REJECT_REASONS[0]]: pick(QTY) }, { [REJECT_REASONS[1]]: pick(QTY), Other: pick(QTY) }, { "Not a reason": "5" }, null]);
  if (chance(0.2)) row.rejectOtherRemark = pick(["", "why", "  ", undefined]);
  if (chance(0.8)) row.plannedOperatorShiftHours = pick([...PLANNED, 8, 9.5, 24, 0, null]);
  if (chance(0.3)) row.excludedOps = pick([[], ["standardTimeMin"], ["pcsPerStandardTime", "standardTimeMin"], null]);
  for (const k of STOP_KEYS) if (chance(0.35)) row[k] = pick(NUMS);
  if (chance(0.1)) row.otherActivityMin = pick(NUMS);
  if (chance(0.1)) row.totalCycleSec = pick(NUMS); // must be ignored: the cycle comes from the standard time
  return row;
}

const curated = [
  { itemName: "Press Part A", machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "2", pcsPerStandardTime: "10", okQty: "1500", rejectedQty: "20", plannedOperatorShiftHours: 8.5, lunchMin: "30", setupMin: "10" },
  // ideal = floor(480 * 10 / 2) = 2400
  { itemName: "Press Part A", machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "2", pcsPerStandardTime: "10", okQty: "2400", rejectedQty: "0" },
  { itemName: "Press Part A", machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "2", pcsPerStandardTime: "10", okQty: "2400", rejectedQty: "1" },
  // no part
  { itemName: "", machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "2", pcsPerStandardTime: "10", okQty: "5", rejectedQty: "1" },
  { machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "2", pcsPerStandardTime: "10" },
  // missing standard time -> no cycle, no ideal
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", okQty: "5", rejectedQty: "1" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "2", okQty: "5", rejectedQty: "1" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", pcsPerStandardTime: "4", okQty: "5", rejectedQty: "1" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "0", pcsPerStandardTime: "4", okQty: "5", rejectedQty: "1" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "2", pcsPerStandardTime: "0", okQty: "5", rejectedQty: "1" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "2", pcsPerStandardTime: "-3", okQty: "5", rejectedQty: "1" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "-2", pcsPerStandardTime: "3", okQty: "5", rejectedQty: "1" },
  // overnight, zero span
  { itemName: "P", machineOnTime: "22:00", machineOffTime: "06:00", standardTimeMin: "3", pcsPerStandardTime: "7", okQty: "100", rejectedQty: "2" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "08:00", standardTimeMin: "3", pcsPerStandardTime: "7", okQty: "0", rejectedQty: "0" },
  { itemName: "P", machineOnTime: "23:59", machineOffTime: "00:00", standardTimeMin: "3", pcsPerStandardTime: "7", okQty: "1", rejectedQty: "0" },
  // fractional pieces
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "09:00", standardTimeMin: "7", pcsPerStandardTime: "2.5", okQty: "5", rejectedQty: "0" },
  // all ten stoppage columns
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "1", pcsPerStandardTime: "1", okQty: "400", rejectedQty: "10", plannedOperatorShiftHours: 8, plannedDownMin: "5", setupMin: "10", noManPowerMin: "1", materialShiftingMin: "2", noMaterialMin: "3", bdMechMin: "4", bdEleMin: "5", noPowerMin: "6", lunchMin: "30", otherMin: "7" },
  // A / P / Q over 100%
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "1", pcsPerStandardTime: "2", okQty: "900", rejectedQty: "100", plannedOperatorShiftHours: 4, lunchMin: "60", plannedDownMin: "20" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "1", pcsPerStandardTime: "1", okQty: "0", rejectedQty: "0", plannedOperatorShiftHours: 8 },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", standardTimeMin: "1", pcsPerStandardTime: "1", okQty: "100", rejectedQty: "0", plannedOperatorShiftHours: 8, setupMin: "480" },
  {},
];

const rowCases = [];
for (const c of curated) rowCases.push(c);
for (let i = 0; i < 150 * SCALE; i++) rowCases.push(saneRow("s" + i));
for (let i = 0; i < 350 * SCALE; i++) rowCases.push(junkRow("j" + i));

write("standard_cycle.json", rowCases.map((row) => ({ row: encIn(row), out: enc(standardCycleSec(row)) })));
write("row_calc.json", rowCases.map((row) => ({ row: encIn(row), out: enc(pressRowCalc(row)) })));

// ── dayCalc ─────────────────────────────────────────────────────────────────
const dayCases = [];
function dayRows() {
  const n = int(1, 3);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const r = chance(0.8) ? saneRow("d" + i) : junkRow("d" + i);
    r.machine = "m1";
    r.date = "2026-04-06";
    r.slot = i + 1;
    rows.push(r);
  }
  // order given to the function is arbitrary; the controller sorts first
  return rows;
}
for (let i = 0; i < 260 * SCALE; i++) {
  const rows = dayRows();
  dayCases.push({ rows: encIn(rows), out: enc(pressDayCalc(sortByMachineOn(rows))) });
}
dayCases.push({ rows: [], out: enc(pressDayCalc([])) });
write("day_calc.json", dayCases);

// ── validation ──────────────────────────────────────────────────────────────
function formValues() {
  const v = chance(0.7) ? saneRow("v") : junkRow("v");
  if (chance(0.8)) v.plannedOperatorShiftHours = pick(PLANNED);
  v.date = pick(["2026-04-06", "", undefined, "  "]);
  if (chance(0.85)) v.date = "2026-04-06";
  v.machine = chance(0.9) ? "m1" : pick(["", undefined, "  "]);
  if (chance(0.9) && !("operator" in v)) v.operator = "Ravi";
  if (chance(0.1)) v.operator = pick(["", undefined, "  "]);
  if (chance(0.4)) v.otherMin = pick(["", "0", "5", "abc"]);
  if (chance(0.4)) v.otherMinRemark = pick(["", "  ", "belt broke"]);
  if (chance(0.06)) v.workingMode = "Non Working";
  if (chance(0.03)) v.workingMode = "Working";
  return v;
}
const valCases = [];
const validBase = {
  date: "2026-04-06", machine: "m1", operator: "Ravi", itemName: "Press Part A", machineOnTime: "08:00", machineOffTime: "16:00",
  standardTimeMin: "2", pcsPerStandardTime: "10", actualQty: "2010", okQty: "2000", rejectBreakdown: { [REJECT_REASONS[0]]: "10" }, rejectOtherRemark: "",
  plannedOperatorShiftHours: "8.5", lunchMin: "30",
};
const curatedVal = [
  validBase,
  {},
  { ...validBase, workingMode: "Non Working", operator: "", itemName: "" },
  { ...validBase, date: "", workingMode: "Non Working" },
  { ...validBase, actualQty: "2401", okQty: "2400" }, // over Ideal (2400)
  { ...validBase, actualQty: "2400", okQty: "2400", rejectBreakdown: {} }, // exactly Ideal, nothing rejected
  { ...validBase, okQty: "-1" },
  { ...validBase, actualQty: "abc" },
  { ...validBase, actualQty: "-3" },
  { ...validBase, actualQty: "", okQty: "" },
  { ...validBase, okQty: "2011" }, // OK above Actual
  { ...validBase, rejectBreakdown: {} },
  { ...validBase, rejectBreakdown: { [REJECT_REASONS[0]]: "4" } },
  { ...validBase, rejectBreakdown: { [REJECT_REASONS[0]]: "7", [REJECT_REASONS[1]]: "7" } },
  { ...validBase, rejectBreakdown: { [REJECT_REASONS[0]]: "-1" } },
  { ...validBase, rejectBreakdown: { [REJECT_REASONS[0]]: "abc" } },
  { ...validBase, actualQty: "2000", rejectBreakdown: { [REJECT_REASONS[0]]: "3" } }, // nothing rejected
  { ...validBase, rejectBreakdown: { Other: "10" } },
  { ...validBase, rejectBreakdown: { Other: "10" }, rejectOtherRemark: "cracked" },
  { ...validBase, rejectBreakdown: { Other: "10" }, rejectOtherRemark: "   " },
  { ...validBase, standardTimeMin: "", pcsPerStandardTime: "" },
  { ...validBase, plannedOperatorShiftHours: "7.99" },
  { ...validBase, plannedOperatorShiftHours: "8.00" },
  { ...validBase, plannedOperatorShiftHours: "8.60" },
  { ...validBase, plannedOperatorShiftHours: "24.30" },
  { ...validBase, plannedOperatorShiftHours: "5.33" },
  { ...validBase, plannedOperatorShiftHours: "0.5" },
  { ...validBase, machineOffTime: "07:00" },
  { ...validBase, machineOffTime: "08:00" },
  { ...validBase, setupMin: "400", noPowerMin: "81" },
  { ...validBase, setupMin: "480" },
  { ...validBase, otherMin: "5" },
  { ...validBase, otherMin: "5", otherMinRemark: "belt" },
  { ...validBase, bdMechMin: "1441" },
  { ...validBase, lunchMin: "-5" },
];
for (const v of curatedVal) valCases.push({ values: v, saved: null });
for (let i = 0; i < 520 * SCALE; i++) {
  const v = formValues();
  let saved = null;
  // (The web's timesUnchanged also compares the saved row's date and machine; the phone's editor only
  // hands over the times, so the fixtures keep date/machine unchanged and the times alone decide.)
  if (chance(0.3)) saved = { date: v.date, machine: v.machine, machineOnTime: chance(0.6) ? v.machineOnTime : pick(TIMES_OK), machineOffTime: chance(0.6) ? v.machineOffTime : pick(TIMES_OK) };
  valCases.push({ values: v, saved });
}
write("validation.json", valCases.map((c) => ({ values: encIn(c.values), saved: c.saved ? encIn(c.saved) : null, errors: enc(validatePressEntry(c.values, { saved: c.saved })) })));

// firstPressError over lists of error maps
const firstCases = [];
const allKeys = [...PRESS_FIELD_ORDER, "bogus", "date"];
for (let i = 0; i < 120; i++) {
  const list = [];
  const n = int(0, 3);
  for (let b = 0; b < n; b++) {
    if (chance(0.15)) { list.push(chance(0.5) ? {} : undefined); continue; }
    const e = {};
    const m = int(0, 4);
    for (let k = 0; k < m; k++) e[pick(allKeys)] = "msg" + k;
    list.push(e);
  }
  firstCases.push({ errors: list.map((e) => (e === undefined ? null : e)), out: enc(firstPressError(list)) });
}
write("first_error.json", firstCases);

// ── stoppage limit + over-100 helpers the form leans on ─────────────────────
const helperCases = [];
for (let i = 0; i < 200 * SCALE; i++) {
  const v = chance(0.7) ? saneRow("h") : junkRow("h");
  v.plannedOperatorShiftHours = pick(PLANNED);
  const dec = withDecimalPlanned(v);
  helperCases.push({
    values: encIn(v),
    stoppageLimit: enc(stoppageLimitMin(dec)),
    decimalPlanned: enc(dec.plannedOperatorShiftHours),
    over: enc(metricsOver100(pressRowCalc(dec))),
  });
}
write("helpers.json", helperCases);

// ── payload: the page's toPayload (PressDataEntry.jsx), copied verbatim ─────
const STOPPAGE_KEYS = STOP_KEYS;
const TEXT_FIELDS = ["operator", "itemName", "operation", "drawingNo", "setupNo", "remarks", "rejectOtherRemark", "otherMinRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = ["standardTimeMin", "pcsPerStandardTime", "actualQty", "okQty", "plannedOperatorShiftHours", ...STOPPAGE_KEYS];
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
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, String(v[k] ?? "").trim()])),
  ...rejectPayload(v),
  otherMinRemark: Number(v.otherMin) > 0 ? String(v.otherMinRemark ?? "").trim() : "",
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, v[k] ?? ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, v[k] === "" || v[k] === undefined ? "" : Number(v[k])])),
  plannedOperatorShiftHours: (() => {
    const { hours } = parseShiftHours(v.plannedOperatorShiftHours);
    return hours === null ? "" : hmToWireHours(hours);
  })(),
  lunchMin: v.lunchMin === "" || v.lunchMin === undefined ? 0 : Number(v.lunchMin),
});

// The form holds typed fields as strings; times are HH:mm (the time picker),
// numbers are finite or blank (validation blocks anything else before a PUT).
const FIN = ["", "0", "1", "5", "12", "12.5", "300", "1440", "007", "1e2", " 7 "];
function payloadValues() {
  const v = {
    _id: chance(0.8) ? "id" + int(1, 99) : undefined,
    date: "2026-04-06",
    machine: "m" + int(1, 5),
    slot: pick([1, 2, 3, "2"]),
    item: pick(["", "i1", "i2", undefined]),
    vendor: pick(["", "v1", undefined]),
    vendorName: pick(["", "Acme"]),
    excludedOps: pick([[], ["standardTimeMin"], ["pcsPerStandardTime", "standardTimeMin"], undefined]),
    workingMode: pick(["Working", "Non Working", undefined, ""]),
    machineStatus: pick([[], ["Machine Breakdown"], ["No Manpower", "No Planning"], undefined]),
    operator: pick(["Ravi", "  Ravi  ", "", undefined]),
    itemName: pick(["Press Part A", " Flange ", ""]),
    operation: pick(["", "Bending", "Tapping", "Blank", "Old Op"]),
    drawingNo: pick(["", "DW-1", " DW-2 "]),
    setupNo: pick(["", "1", "5", "9"]),
    remarks: pick(["", "  all ok  ", "x"]),
    otherMinRemark: pick(["", "belt  ", "  "]),
    machineOnTime: pick(["08:00", "", "22:15"]),
    machineOffTime: pick(["16:00", "", "23:59"]),
    plannedOperatorShiftHours: pick(["", "8", "8.30", "3.5", "3.75", "24", "abc", "8.60", "0.45", "12.00", "5.33", "0.5"]),
  };
  for (const k of NUMBER_FIELDS) if (k !== "plannedOperatorShiftHours" && chance(0.8)) v[k] = pick(FIN);
  v.rejectBreakdown = pick([{}, {}, { [REJECT_REASONS[0]]: "5" }, { [REJECT_REASONS[1]]: "3", Other: "2" }, { [REJECT_REASONS[0]]: "", Other: "0" }, { [REJECT_REASONS[2]]: "abc", [REJECT_REASONS[0]]: "7" }, { [REJECT_REASONS[3]]: "7", [REJECT_REASONS[1]]: "7" }, undefined, null]);
  v.rejectOtherRemark = pick(["", " cracked ", undefined, null]);
  if (chance(0.5)) v.lunchMin = pick(FIN);
  if (chance(0.5)) v.otherMin = pick(FIN);
  return v;
}
const payCases = [];
for (let i = 0; i < 400 * SCALE; i++) {
  const v = payloadValues();
  const isEdit = chance(0.5);
  payCases.push({ values: encIn(v), isEdit, payload: enc(toPayload(v, isEdit)) });
}
write("payload.json", payCases);

// ── constants ───────────────────────────────────────────────────────────────
write("constants.json", {
  operations: PRESS_OPERATIONS,
  programFields: PRESS_PROGRAM_FIELDS,
  downtimeKeys: PRESS_DOWNTIME_KEYS,
  fieldOrder: PRESS_FIELD_ORDER,
  formulas: PRESS_FORMULAS,
  textFields: TEXT_FIELDS,
  numberFields: NUMBER_FIELDS,
});
console.log("press golden written to", OUT, { rows: rowCases.length, days: dayCases.length, validation: valCases.length, payload: payCases.length });
