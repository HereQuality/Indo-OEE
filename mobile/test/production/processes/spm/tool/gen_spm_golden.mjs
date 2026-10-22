// Golden-fixture generator for test/production/processes/spm/*.
//
// Runs the REAL client/src/utils/spmSheet.js + spmValidation.js (and the
// productionSheet.js / entryValidation.js / shiftHours.js they sit on) over a
// broad, deterministic (seeded) input set and writes the JSON the Dart tests
// compare against. client/ is only READ; nothing is written inside it.
//
//   cd mobile
//   ESB=../client/node_modules/.bin/esbuild
//   $ESB test/production/processes/spm/tool/gen_spm_golden.mjs --bundle --platform=node \
//        --format=esm --outfile=<scratch>/spm-golden/gen.mjs
//   OUT_DIR=test/production/processes/spm/fixtures TZ=Asia/Kolkata node <scratch>/spm-golden/gen.mjs
//
// SEED=.. SCALE=.. give bigger one-off soak sets. JSON cannot carry
// NaN/Infinity/undefined, so those are written as {"$n":"NaN"|"Inf"|"-Inf"} and
// {"$u":1}.
//
// The page-level helpers (emptyEntry, toFormValues, toPayload, withPart,
// hasAnyEntryData, hasData) live inside client/src/pages/SpmDataEntry.jsx and
// Components/Production/SpmEntryForm.jsx, which are not importable: their bodies
// are copied below, UNCHANGED apart from what is marked. Keep them in step.

import fs from "node:fs";
import path from "node:path";
import { isoDay, sortByMachineOn, STOPPAGE_FIELDS } from "../../../../../../client/src/utils/productionSheet.js";
import {
  SPM_FORMULAS,
  SPM_OP_FIELDS,
  SPM_REFERENCE_FIELDS,
  isSpmProcess,
  spmCycleSec,
  spmDayCalc,
  spmRowCalc,
} from "../../../../../../client/src/utils/spmSheet.js";
import { SPM_DOWNTIME_KEYS, SPM_FIELD_ORDER, firstSpmError, validateSpmEntry } from "../../../../../../client/src/utils/spmValidation.js";
import { hmToWireHours, hoursToHmInput, parseHm } from "../../../../../../client/src/utils/shiftHours.js";
import { stoppageLimitMin, withDecimalPlanned } from "../../../../../../client/src/utils/entryValidation.js";

let vendorSeq = 0;
const OUT = process.env.OUT_DIR;
if (!OUT) throw new Error("set OUT_DIR");
fs.mkdirSync(OUT, { recursive: true });

// ── helpers ─────────────────────────────────────────────────────────────────
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
// Inputs: drop undefined keys (a missing key IS undefined for the Dart maps).
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

// ── value pools ─────────────────────────────────────────────────────────────
const TIMES_OK = ["06:00", "07:30", "08:00", "9", "930", "0930", "9:30", "9.30", "13:15", "14:00", "16:00", "21:30", "22:00", "23:59", "00:00", "02:00", "05:45"];
const TIMES_BAD = ["24:00", "9:5", "abc", "12345", "", "  ", "25", "7:60", null, undefined, 930, 9, "9-30"];
const NUMS = ["", undefined, null, "0", "1", "5", "10", "12.5", 3, 7.5, "  ", "abc", "-4", "1e2", "0x10", "45", 45, "120", "0.5", "600"];
const SECS = ["", undefined, null, "0", "5", "12", "20", "30", 8, 15.5, "abc", "-2", "45"];
const QTY = ["", undefined, null, "0", "10", "100", "250", "300", "480", "599", "600", "640", 320, 55, "12.5", "-3", "abc", "  ", "9999", "1", "400"];
const MINS = ["", undefined, null, "0", "5", "10", "30", "60", "90", "480", "1440", "1441", "-1", "abc", " ", 20, "7.5"];
const PLANNED_TYPED = ["", undefined, null, "8", "8.30", "9", "9.5", "12", "7.45", "3.60", "abc", "0", "24", "24.01", "25", "8,30", " 8.15 ", "10.0", "0.30", "1000", 9, 8.3];
const PLANNED_DEC = ["", undefined, null, 8, 8.5, 9, 12, 4, "8", "9.5", 0, "abc", 24, 25, 7.75];
const ITEMS = ["Part A", "Bracket 7B", "Flange", " Part B ", "X", "Plate 9"];
const REMARKS = ["", undefined, "ok", "late start", "  "];
const DATES = ["2026-04-06", "2026-10-02", "", undefined, "  ", "2026-12-31"];

const OPS = SPM_OP_FIELDS.map((f) => f.key);
const REFS = SPM_REFERENCE_FIELDS.map((f) => f.key);
const STOP_KEYS = STOPPAGE_FIELDS.map((f) => f.key);

// ── row generators (a saved/typed SPM row) ──────────────────────────────────
function spmRow(id, hostile) {
  const shifts = [["06:00", "14:00"], ["14:00", "22:00"], ["22:00", "06:00"], ["08:00", "16:00"], ["07:30", "15:45"], ["9", "17"], ["0930", "1330"], ["9:30", "18.15"], ["00:00", "23:59"], ["10:00", "10:30"]];
  const [on, off] = pick(shifts);
  const ops = { loadingSec: int(0, 12), processSec: int(1, 40), unloadingCleaningSec: int(0, 10), otherOperationsSec: int(0, 6) };
  const total = ops.loadingSec + ops.processSec + ops.unloadingCleaningSec + ops.otherOperationsSec;
  const row = { _id: id };
  const H = hostile;
  row.itemName = H && chance(0.3) ? pick(["Part A", " ", "", null, undefined, 7]) : pick(ITEMS);
  row.machineOnTime = H && chance(0.3) ? pick([...TIMES_OK, ...TIMES_BAD]) : on;
  row.machineOffTime = H && chance(0.3) ? pick([...TIMES_OK, ...TIMES_BAD]) : off;
  for (const k of OPS) row[k] = H && chance(0.3) ? pick(SECS) : ops[k];
  row.totalCycleSec = H && chance(0.35) ? pick(NUMS) : chance(0.9) ? total : String(total);
  for (const k of REFS) row[k] = H && chance(0.3) ? pick(NUMS) : int(1, 8);
  if (chance(0.45)) row.excludedOps = OPS.filter(() => chance(0.4));
  else if (H && chance(0.2)) row.excludedOps = pick([null, [], ["nope"], ["processSec", "processSec"]]);
  row.okQty = H && chance(0.4) ? pick(QTY) : String(int(0, 700));
  row.rejectedQty = H && chance(0.4) ? pick(QTY) : String(int(0, 30));
  if (H && chance(0.1)) row.actualQty = pick(QTY);
  row.plannedOperatorShiftHours = H && chance(0.4) ? pick(PLANNED_DEC) : pick([8, 8.5, 9, 12, 4, 9.5, 11]);
  for (const k of STOP_KEYS) {
    if (chance(0.5)) row[k] = H && chance(0.4) ? pick(MINS) : String(int(0, 40));
  }
  if (H && chance(0.1)) row.otherActivityMin = pick(MINS);
  row.remarks = pick(REMARKS);
  return row;
}

// ── rowCalc ─────────────────────────────────────────────────────────────────
const rowCases = [];
const nRows = 700 * SCALE;
for (let i = 0; i < nRows; i += 1) {
  const row = spmRow("r" + i, i % 2 === 1);
  rowCases.push({ row: encIn(row), out: enc(spmRowCalc(row)), cycle: enc(spmCycleSec(row)) });
}
// A few fixed ones: nothing, null-ish.
for (const row of [{}, { itemName: "A" }, { itemName: "A", totalCycleSec: "60" }]) {
  rowCases.push({ row: encIn(row), out: enc(spmRowCalc(row)), cycle: enc(spmCycleSec(row)) });
}
write("row_calc.json", rowCases);

// ── dayCalc ─────────────────────────────────────────────────────────────────
const dayCases = [];
const nDays = 300 * SCALE;
for (let i = 0; i < nDays; i += 1) {
  const rows = [];
  const n = int(0, 4);
  for (let j = 0; j < n; j += 1) {
    const r = spmRow(`d${i}-${j}`, i % 3 === 2);
    if (chance(0.3)) r.setupMin = String(int(0, 30));
    if (chance(0.3)) r.lunchMin = String(int(0, 45));
    rows.push(r);
  }
  dayCases.push({ rows: rows.map(encIn), out: enc(spmDayCalc(rows)) });
}
write("day_calc.json", dayCases);

// ── validation (form values: typed fields are strings, planned is H.MM) ─────
function formValues(hostile) {
  const H = hostile;
  const shifts = [["06:00", "14:00"], ["08:00", "16:00"], ["22:00", "06:00"], ["07:30", "15:45"], ["09:00", "09:00"], ["10:00", "09:00"], ["00:00", "23:59"]];
  const [on, off] = pick(shifts);
  const ops = { loadingSec: int(1, 12), processSec: int(1, 40), unloadingCleaningSec: int(0, 10), otherOperationsSec: int(0, 6) };
  const total = ops.loadingSec + ops.processSec + ops.unloadingCleaningSec + ops.otherOperationsSec;
  const v = {
    date: H && chance(0.2) ? pick(DATES) : "2026-10-02",
    machine: H && chance(0.15) ? pick(["", undefined, " "]) : "m1",
    machineStatus: chance(0.2) ? ["No Manpower"] : [],
    workingMode: H && chance(0.15) ? pick(["Non Working", "Working", undefined]) : "Working",
    slot: 1,
    item: chance(0.9) ? "i1" : "",
    // Wave 2: some entries name a vendor (a counter, not the RNG, so the other fixtures keep their stream).
    vendor: vendorSeq++ % 5 === 0 ? "v1" : "",
    vendorName: "",
    excludedOps: chance(0.4) ? OPS.filter(() => chance(0.3)) : [],
    operator: H && chance(0.2) ? pick(["", " ", undefined]) : "Ravi",
    itemName: H && chance(0.25) ? pick(["", " ", undefined, "Part A"]) : "Part A",
    drawingNo: "D-1",
    remarks: pick(["", "x"]),
    otherMinRemark: chance(0.7) ? "" : pick(["why", " ", undefined]),
    machineOnTime: H && chance(0.3) ? pick([...TIMES_OK, ...TIMES_BAD]) : on,
    machineOffTime: H && chance(0.3) ? pick([...TIMES_OK, ...TIMES_BAD]) : off,
    totalCycleSec: H && chance(0.25) ? pick(["", undefined, "0", "abc", "-5"]) : String(total),
    okQty: H && chance(0.4) ? pick(QTY) : String(int(0, 520)),
    rejectedQty: H && chance(0.4) ? pick(QTY) : String(int(0, 30)),
    plannedOperatorShiftHours: H && chance(0.55) ? pick(PLANNED_TYPED) : pick(["8", "8.30", "9", "10", "8.00", "8.15", "12"]),
  };
  for (const k of OPS) v[k] = H && chance(0.2) ? pick(SECS) : String(ops[k]);
  for (const k of REFS) v[k] = H && chance(0.25) ? pick(["", undefined, "abc", " ", "0"]) : String(int(1, 6));
  for (const k of STOP_KEYS) {
    if (k === "otherMin") v[k] = chance(0.25) ? String(int(1, 30)) : pick(["", "0"]);
    else v[k] = H && chance(0.3) ? pick(MINS) : chance(0.5) ? String(int(0, 25)) : "";
  }
  return v;
}

const valCases = [];
const nVal = 1200 * SCALE;
for (let i = 0; i < nVal; i += 1) {
  const values = formValues(i % 3 !== 0);
  const saved = chance(0.25) ? { machineOnTime: pick(TIMES_OK), machineOffTime: pick(TIMES_OK) } : chance(0.1) ? { machineOnTime: values.machineOnTime, machineOffTime: values.machineOffTime } : null;
  valCases.push({ values: encIn(values), saved: saved ? encIn(saved) : null, errors: enc(validateSpmEntry(values, { saved })) });
}
write("validation.json", valCases);

// firstSpmError over lists of per-block error maps.
const firstCases = [];
for (let i = 0; i < 200 * SCALE; i += 1) {
  const list = [];
  const n = int(0, 3);
  for (let j = 0; j < n; j += 1) {
    if (chance(0.15)) {
      list.push(chance(0.5) ? null : {});
      continue;
    }
    const e = {};
    const keys = [...SPM_FIELD_ORDER, "weird", "machineOnTime"];
    for (const k of keys) if (chance(0.12)) e[k] = "msg " + k;
    list.push(e);
  }
  firstCases.push({ list, out: firstSpmError(list.map((x) => x || {})) });
}
write("first_error.json", { order: SPM_FIELD_ORDER, downtimeKeys: SPM_DOWNTIME_KEYS, cases: firstCases });

// The web's stoppage allowance (shift minutes) and decimal planned, as the form uses them.
const limitCases = [];
for (let i = 0; i < 200 * SCALE; i += 1) {
  const v = formValues(true);
  limitCases.push({ values: encIn(v), limit: enc(stoppageLimitMin(withDecimalPlanned(v))), planned: enc(withDecimalPlanned(v).plannedOperatorShiftHours) });
}
write("stoppage_limit.json", limitCases);

// ── page helpers: copies of SpmDataEntry.jsx / SpmEntryForm.jsx ─────────────
const SPM_OP_KEYS = OPS;
const SPM_REFERENCE_KEYS = REFS;
const STOPPAGE_KEYS = STOP_KEYS;
const TEXT_FIELDS = ["operator", "itemName", "drawingNo", "remarks", "otherMinRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = [
  "noOfHoles",
  "piecesPerCycle",
  "strokeRequired",
  "loadingSec",
  "processSec",
  "unloadingCleaningSec",
  "otherOperationsSec",
  "totalCycleSec",
  "okQty",
  "rejectedQty",
  "plannedOperatorShiftHours",
  ...STOPPAGE_KEYS,
];

const hasAnyEntryData = (list) =>
  list.some((v) => {
    if (v.machine) return true;
    return [...TEXT_FIELDS, ...TIME_FIELDS, ...NUMBER_FIELDS].some((k) => v[k] !== "" && v[k] !== undefined && v[k] !== null);
  });

// emptyEntry with the date passed in (the page uses isoDay(new Date())).
const emptyEntry = (day) => ({
  date: day,
  machine: "",
  machineStatus: [],
  workingMode: "Working",
  slot: 1,
  item: "",
  vendor: "",
  vendorName: "",
  excludedOps: [],
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, ""])),
});

const toFormValues = (row, day) => ({
  ...emptyEntry(day),
  ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)),
  item: row.item || "",
  slot: row.slot,
  plannedOperatorShiftHours: hoursToHmInput(row.plannedOperatorShiftHours),
});

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
  otherMinRemark: Number(v.otherMin) > 0 ? String(v.otherMinRemark ?? "").trim() : "",
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, v[k] ?? ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, v[k] === "" || v[k] === undefined ? "" : Number(v[k])])),
  plannedOperatorShiftHours: (() => {
    const { hours } = parseHm(v.plannedOperatorShiftHours);
    return hours === null ? "" : hmToWireHours(hours);
  })(),
  lunchMin: v.lunchMin === "" || v.lunchMin === undefined ? 0 : Number(v.lunchMin),
});

const withPart = (v, it) => ({
  ...v,
  item: it._id,
  itemName: it.itemName,
  drawingNo: it.drawingNo || "",
  totalCycleSec: it.totalCycleSec ?? "",
  ...Object.fromEntries(SPM_OP_KEYS.map((k) => [k, it[k] ?? ""])),
  ...Object.fromEntries(SPM_REFERENCE_KEYS.map((k) => [k, it[k] ?? ""])),
  excludedOps: [],
});

// handleItemSelect's per-block body.
const selectItem = (v, itemId, items) => {
  if (!itemId) return { ...v, item: "", itemName: "", drawingNo: "" };
  const it = items.find((item) => item._id === itemId);
  if (!it) return { ...v, item: "" };
  return withPart(v, it);
};

// The form's hasData (SpmEntryForm.jsx): LINES' fields minus date / machine / stoppageTotal.
const LINE_FIELDS = [
  ["date", "machine", "operator", "machineStatus"],
  ["itemName", "noOfHoles", "piecesPerCycle", "strokeRequired"],
  ["machineOnTime", "machineOffTime"],
  ["okQty", "rejectedQty"],
  ["plannedOperatorShiftHours", "lunchMin"],
  [...SPM_DOWNTIME_KEYS, "stoppageTotal", "otherMinRemark"],
  ["remarks"],
];
const DATA_KEYS = LINE_FIELDS.flat().filter((k) => !["date", "machine", "stoppageTotal"].includes(k));
const hasData = (v) =>
  v.workingMode === "Non Working" || DATA_KEYS.some((k) => (Array.isArray(v[k]) ? v[k].length > 0 : v[k] !== "" && v[k] !== undefined && v[k] !== null));

// JSON.stringify -> parse is exactly what goes over the wire (NaN -> null).
const wire = (o) => JSON.parse(JSON.stringify(o));
// The phone keeps every typed field as text: numbers are shown as their String().
const TYPED = [...TEXT_FIELDS, ...TIME_FIELDS, ...NUMBER_FIELDS];
const asText = (o) => {
  const out = { ...o };
  for (const k of TYPED) if (k !== "plannedOperatorShiftHours" && out[k] !== undefined && out[k] !== null && typeof out[k] !== "string") out[k] = String(out[k]);
  return out;
};

const DAY = "2026-10-22";
write("empty_entry.json", { day: DAY, out: enc(emptyEntry(DAY)) });

const payloadCases = [];
for (let i = 0; i < 700 * SCALE; i += 1) {
  const values = formValues(i % 2 === 1);
  if (chance(0.4)) values._id = "id" + i;
  values.vendor = chance(0.2) ? "v1" : "";
  values.lunchMin = chance(0.3) ? pick(["", undefined, "30", "abc"]) : values.lunchMin;
  const isEdit = chance(0.5);
  if (isEdit) values.slot = pick([1, 2, 3, "2", undefined, "x"]);
  values.workingMode = chance(0.2) ? "Non Working" : chance(0.1) ? undefined : "Working";
  values.machineStatus = pick([[], ["Machine Breakdown"], ["No Planning", "No Manpower"], undefined, null]);
  values.excludedOps = pick([[], ["processSec"], undefined, null]);
  values.remarks = pick(["  spaced  ", "", undefined, "r"]);
  values.otherMinRemark = pick(["  why  ", "", undefined]);
  payloadCases.push({ values: encIn(values), isEdit, payload: encIn(wire(toPayload(values, isEdit))) });
}
write("payload.json", payloadCases);

const formValueCases = [];
for (let i = 0; i < 300 * SCALE; i += 1) {
  const row = spmRow("f" + i, i % 2 === 1);
  row.item = pick(["i1", "", null, undefined]);
  row.slot = pick([1, 2, 3]);
  row.machine = "m1";
  row.date = "2026-10-01";
  row.plannedOperatorShiftHours = pick(PLANNED_DEC);
  row.machineStatus = pick([undefined, [], ["No Planning"]]);
  row.workingMode = pick([undefined, "Working", "Non Working"]);
  row.vendor = pick([undefined, null, "v1"]);
  row.vendorName = pick([undefined, "Acme"]);
  row.drawingNo = pick([undefined, null, "D-9"]);
  row.otherMinRemark = pick([undefined, "why"]);
  formValueCases.push({ row: encIn(row), out: encIn(asText(wire(toFormValues(wire(row), DAY)))) });
}
write("form_values.json", { day: DAY, cases: formValueCases });

const ITEM_POOL = [
  { _id: "i1", itemName: "Part A", drawingNo: "D-1", totalCycleSec: 30, loadingSec: 5, processSec: 20, unloadingCleaningSec: 3, otherOperationsSec: 2, noOfHoles: 4, piecesPerCycle: 2, strokeRequired: 1 },
  { _id: "i2", itemName: "Part B", totalCycleSec: 12.5, loadingSec: 2.5, processSec: 10, noOfHoles: 0 },
  { _id: "i3", itemName: "Bare" },
  { _id: "i4", itemName: "Strings", drawingNo: "X", totalCycleSec: "44", loadingSec: "4", processSec: "40", piecesPerCycle: "3" },
];
const pickCases = [];
for (let i = 0; i < 200 * SCALE; i += 1) {
  // The phone only ever holds typed fields as text, so the block going in is text too.
  const values = asText({ ...formValues(true), item: pick(["i1", "", "i9"]) });
  const itemId = pick(["i1", "i2", "i3", "i4", "", "nope"]);
  pickCases.push({ values: encIn(values), itemId, items: ITEM_POOL, out: encIn(asText(wire(selectItem(values, itemId, ITEM_POOL)))) });
}
write("item_pick.json", pickCases);

const dataCases = [];
for (let i = 0; i < 400 * SCALE; i += 1) {
  const blocks = [];
  const n = int(0, 3);
  for (let j = 0; j < n; j += 1) {
    const b = emptyEntry(DAY);
    if (chance(0.5)) b.machine = pick(["", "m1"]);
    const k = pick([...TYPED, "workingMode", "machineStatus", "item", "vendor", "excludedOps"]);
    if (chance(0.6)) b[k] = pick(["", "x", "0", " ", ["a"], [], "Non Working", "Working"]);
    blocks.push(b);
  }
  dataCases.push({
    blocks: blocks.map(encIn),
    any: hasAnyEntryData(blocks),
    data: blocks.map((b) => hasData(b)),
  });
}
write("has_data.json", dataCases);

write("formulas.json", { formulas: SPM_FORMULAS, opFields: SPM_OP_FIELDS, referenceFields: SPM_REFERENCE_FIELDS });

const procCases = [];
for (const p of [{}, { dataEntryMenu: "/hqepl/production/spm-data-entry" }, { dataEntryMenu: "/hqepl/production/spm-data-entry/" }, { dataEntryMenu: "/hqepl/production/cnc-data-entry" }, { processName: "SPM" }, { processName: "Spm Line" }, { processName: "Spmx" }, { dataEntryMenu: "", processName: "my SPM" }, null]) {
  procCases.push({ process: p, out: isSpmProcess(p) });
}
write("is_spm_process.json", procCases);

console.log("spm golden written to", OUT, { rows: rowCases.length, days: dayCases.length, validation: valCases.length, payloads: payloadCases.length });
