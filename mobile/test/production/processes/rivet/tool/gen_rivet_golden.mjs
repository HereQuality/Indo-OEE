// Golden-fixture generator for test/production/processes/rivet/*.
//
// Runs the REAL client/src/utils/rivetSheet.js + rivetValidation.js (and the
// pure handlers of pages/RivetDataEntry.jsx, copied below — pages are not
// importable) over a seeded input set and writes the JSON the Dart tests compare
// against. client/ is only READ.
//
//   cd mobile
//   ESB=../client/node_modules/.bin/esbuild
//   $ESB test/production/processes/rivet/tool/gen_rivet_golden.mjs --bundle --platform=node \
//        --format=esm --outfile=/tmp/rivet-golden/gen.mjs
//   OUT_DIR=test/production/processes/rivet/fixtures TZ=Asia/Kolkata node /tmp/rivet-golden/gen.mjs
//
// SEED=.. / SCALE=.. make bigger one-off soak runs. NaN/Infinity/undefined travel
// as {"$n":..} / {"$u":1} markers (see ../../calc/golden_support.dart).

import fs from "node:fs";
import path from "node:path";
import { STOPPAGE_FIELDS, sortByMachineOn } from "../../../../../../client/src/utils/productionSheet.js";
import {
  RIVET_FORMULAS,
  RIVET_OP_FIELDS,
  RIVET_PROCESS_TYPES,
  rivetCycleSec,
  rivetDayCalc,
  rivetRowCalc,
} from "../../../../../../client/src/utils/rivetSheet.js";
import { RIVET_DOWNTIME_KEYS, RIVET_FIELD_ORDER, firstRivetError, validateRivetEntry } from "../../../../../../client/src/utils/rivetValidation.js";
import { hmToWireHours, hoursToHmInput, parseHm } from "../../../../../../client/src/utils/shiftHours.js";

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
// What the server receives: JSON.stringify drops undefined and turns NaN into null.
const wire = (v) => JSON.parse(JSON.stringify(v));
const write = (name, data) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(data));

// ── inputs ──────────────────────────────────────────────────────────────────
const OPS = RIVET_OP_FIELDS.map((f) => f.key);
const TIMES_OK = ["06:00", "07:30", "08:00", "9", "930", "0930", "9:30", "9.30", "13:15", "14:00", "16:00", "21:30", "22:00", "23:59", "00:00", "02:00", "05:45"];
const TIMES_BAD = ["24:00", "9:5", "abc", "12345", "", "  ", "25", "7:60", null, undefined, 930, 9, "9-30"];
const NUMS = ["", undefined, null, "0", "1", "5", "10", "12.5", 3, 7.5, "  ", "abc", "-4", "1e2", "0x10", "45", 45, "120", "0.5", "600"];
const QTY = ["", undefined, null, "0", "10", "100", "250", "300", "480", "599", "600", "640", 320, 55, "12.5", "-3", "abc", "  ", "9999"];
const SECS = ["5", "8", "10", "12.5", 4, "0", "20", "15"];
const ITEMS = ["Rivet A", "Clamp 7B", "Flange", " Part B ", "X"];
const HM = ["8", "8.30", "9", "12", "4.15", "3.5", "3.60", "24", "24.01", "0", "0.00", "abc", "", "  ", "8,30", ".5", "5.", 8, 8.5, null, undefined, "1000", "7.075"];

function saneRow(id) {
  const shifts = [["06:00", "14:00"], ["14:00", "22:00"], ["22:00", "06:00"], ["08:00", "16:00"], ["07:30", "15:45"], ["9", "17"], ["0930", "1330"], ["9:30", "18.15"]];
  const [on, off] = pick(shifts);
  const ops = Object.fromEntries(OPS.map((k) => [k, pick(SECS)]));
  const sum = OPS.reduce((s, k) => s + Number(ops[k]), 0);
  const row = {
    _id: id,
    date: "2026-04-06",
    machine: "m" + int(1, 4),
    operator: "op" + int(1, 5),
    processType: pick(RIVET_PROCESS_TYPES),
    itemName: pick(ITEMS),
    ...ops,
    totalCycleSec: chance(0.8) ? String(sum) : pick(["45", "60", 90, "12.5"]),
    machineOnTime: on,
    machineOffTime: off,
    okQty: String(int(0, 400)),
    rejectedQty: String(int(0, 40)),
    plannedOperatorShiftHours: pick(["8", "8.30", "9", "12", "4", 8, "10.15"]),
    lunchMin: pick(["0", "20", "30", "45", "", 30]),
    setupMin: pick(["", "0", "10", "25"]),
    remarks: pick(["", "ok", "late start"]),
  };
  if (chance(0.3)) row.excludedOps = [pick(OPS)];
  if (chance(0.1)) row.excludedOps = OPS.slice(0, 2);
  return row;
}

function junkRow(id) {
  const row = { _id: id };
  if (chance(0.85)) row.itemName = pick(["Rivet A", "Clamp", " ", "", null, undefined, 7]);
  if (chance(0.9)) row.machineOnTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.9)) row.machineOffTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.7)) row.totalCycleSec = pick(NUMS);
  for (const k of OPS) if (chance(0.4)) row[k] = pick(NUMS);
  if (chance(0.15)) row.drillingSec = pick(NUMS); // a CNC key must be ignored
  if (chance(0.1)) row.cycleTimeSec = pick(NUMS);
  if (chance(0.1)) row.cycleOpsSec = pick([[], [10, "20", null, ""], ["a", 5], null]);
  if (chance(0.4)) row.excludedOps = pick([[], [OPS[0]], [OPS[1], OPS[3]], OPS, ["nope"], null, ["drillingSec"]]);
  if (chance(0.85)) row.okQty = pick(QTY);
  if (chance(0.85)) row.rejectedQty = pick(QTY);
  if (chance(0.3)) row.actualQty = pick(QTY);
  for (const f of STOPPAGE_FIELDS) if (chance(0.35)) row[f.key] = pick(NUMS);
  return row;
}

// ── rowCalc / rivetCycleSec ─────────────────────────────────────────────────
const mkRow = (extra = {}) => ({
  itemName: "Rivet A",
  machineOnTime: "08:00",
  machineOffTime: "16:00",
  totalCycleSec: "45",
  rivetLoadingSec: "10",
  rivetProcessSec: "20",
  rivetUnloadingCleaningSec: "10",
  rivetOtherOperationsSec: "5",
  okQty: "100",
  rejectedQty: "5",
  ...extra,
});
const curated = [
  mkRow(),
  mkRow({ excludedOps: ["rivetLoadingSec"] }),
  mkRow({ excludedOps: OPS }),
  mkRow({ excludedOps: ["rivetLoadingSec", "rivetProcessSec"], totalCycleSec: "20" }),
  mkRow({ totalCycleSec: "" }),
  mkRow({ totalCycleSec: undefined }),
  mkRow({ totalCycleSec: null }),
  mkRow({ totalCycleSec: "abc" }),
  mkRow({ totalCycleSec: "0" }),
  mkRow({ totalCycleSec: "-5" }),
  mkRow({ itemName: "" }),
  mkRow({ itemName: "   " }),
  mkRow({ itemName: undefined }),
  mkRow({ itemName: 0 }),
  mkRow({ rivetLoadingSec: "x", excludedOps: ["rivetLoadingSec"] }),
  mkRow({ excludedOps: "rivetLoadingSec" }),
  mkRow({ excludedOps: null }),
  mkRow({ okQty: "", rejectedQty: "" }),
  mkRow({ okQty: "10" , rejectedQty: undefined }),
  mkRow({ okQty: undefined, rejectedQty: "7" }),
  mkRow({ actualQty: "50", okQty: "40", rejectedQty: "99" }),
  mkRow({ machineOnTime: "22:00", machineOffTime: "06:00" }),
  mkRow({ machineOnTime: "08:00", machineOffTime: "08:00" }),
  mkRow({ plannedDownMin: "10", setupMin: "20", noManPowerMin: "1", materialShiftingMin: "2", noMaterialMin: "3", bdMechMin: "4", bdEleMin: "5", noPowerMin: "6", lunchMin: "30", otherMin: "7" }),
  mkRow({ cycleTimeSec: "33", totalCycleSec: "" }),
  mkRow({ cycleOpsSec: [1, 2], totalCycleSec: "" }),
  mkRow({ totalCycleSec: 1e400 }),
  {},
];
const rowCases = [...curated];
for (let i = 0; i < 700 * SCALE; i += 1) rowCases.push(chance(0.5) ? saneRow("r" + i) : junkRow("r" + i));
const rowCalcOut = rowCases.map((row) => ({ row: encIn(row), out: enc(rivetRowCalc(row)), cycle: enc(rivetCycleSec(row)) }));
rowCalcOut.push({ row: null, out: enc(rivetRowCalc(null)), cycle: enc(rivetCycleSec(null)) });
write("row_calc.json", rowCalcOut);

// ── dayCalc ─────────────────────────────────────────────────────────────────
const dayCases = [];
const addDay = (rows) => {
  const sorted = sortByMachineOn(rows);
  dayCases.push({ rows: encIn(rows), order: sorted.map((r) => r._id), out: enc(rivetDayCalc(sorted)) });
};
const mk = (id, on, off, extra = {}) => mkRow({ _id: id, machineOnTime: on, machineOffTime: off, ...extra });
addDay([]);
addDay([mk("a", "06:00", "14:00", { lunchMin: "30", setupMin: "10", okQty: "300", rejectedQty: "10" })]);
addDay([mk("a", "14:00", "22:00", { lunchMin: "30" }), mk("b", "06:00", "13:30", { lunchMin: "20", setupMin: "5" }), mk("c", "22:00", "02:00")]);
addDay([mk("a", "06:00", "10:00"), mk("b", "10:00", "14:00"), mk("c", "13:00", "18:00")]);
addDay([mk("a", "06:00", "10:00"), mk("b", "11:15", "14:00"), mk("c", "16:45", "23:00")]);
addDay([mk("a", "", "10:00"), mk("b", "06:00", "10:00"), mk("c", "abc", "")]);
addDay([mk("a", "08:00", "16:00", { itemName: "" })]);
addDay([mk("a", "08:00", "16:00", { excludedOps: ["rivetLoadingSec"] }), mk("b", "16:00", "20:00", { excludedOps: OPS })]);
addDay([null, mk("a", "08:00", "16:00"), null]);
addDay([mk("a", "08:00", "16:00", { lunchMin: "abc" })]);
for (let i = 0; i < 260 * SCALE; i += 1) {
  const n = int(1, 4);
  const rows = [];
  for (let j = 0; j < n; j += 1) {
    const r = chance(0.7) ? saneRow(`d${i}_${j}`) : junkRow(`d${i}_${j}`);
    if (chance(0.5)) r.machineOffTime = pick(TIMES_OK);
    if (chance(0.4)) r.lunchMin = pick(["", "0", "20", "30", 30, "abc"]);
    if (chance(0.4)) r.setupMin = pick(["", "5", "15", "x"]);
    rows.push(r);
  }
  addDay(rows);
}
write("day_calc.json", dayCases);

// ── validateRivetEntry ──────────────────────────────────────────────────────
function validRow() {
  return {
    date: "2026-04-06",
    machine: "m1",
    operator: "Ravi",
    processType: "Rivet",
    item: "i1",
    itemName: "Rivet A",
    totalCycleSec: "45",
    rivetLoadingSec: "10",
    rivetProcessSec: "20",
    rivetUnloadingCleaningSec: "10",
    rivetOtherOperationsSec: "5",
    excludedOps: [],
    machineOnTime: "08:00",
    machineOffTime: "16:00",
    okQty: "300",
    rejectedQty: "20",
    plannedOperatorShiftHours: "9.00",
    lunchMin: "30",
    workingMode: "Working",
  };
}
const valCases = [];
const addVal = (v, saved) => {
  const errors = validateRivetEntry(v, saved ? { saved } : undefined);
  valCases.push({ values: encIn(v), saved: saved ? encIn(saved) : null, errors: enc(errors), keys: Object.keys(errors) });
};
addVal(validRow());
addVal({});
addVal({ ...validRow(), workingMode: "Non Working", operator: "", itemName: "", okQty: "" });
addVal({ ...validRow(), workingMode: "Non Working", date: "", machine: "" });
addVal({ ...validRow(), itemName: "" });
addVal({ ...validRow(), totalCycleSec: "" });
addVal({ ...validRow(), totalCycleSec: undefined });
addVal({ ...validRow(), excludedOps: OPS });
addVal({ ...validRow(), excludedOps: ["rivetLoadingSec"], totalCycleSec: "10" });
addVal({ ...validRow(), processType: "" });
addVal({ ...validRow(), okQty: "400", rejectedQty: "200" }); // over ideal
addVal({ ...validRow(), okQty: "-1" });
addVal({ ...validRow(), rejectedQty: "abc" });
addVal({ ...validRow(), okQty: "", rejectedQty: "" });
addVal({ ...validRow(), machineOnTime: "16:00", machineOffTime: "08:00" });
addVal({ ...validRow(), machineOnTime: "16:00", machineOffTime: "08:00" }, { machineOnTime: "16:00", machineOffTime: "08:00" });
addVal({ ...validRow(), machineOnTime: "abc" });
addVal({ ...validRow(), plannedOperatorShiftHours: "7" }); // less than shift
addVal({ ...validRow(), plannedOperatorShiftHours: "8.75" });
addVal({ ...validRow(), plannedOperatorShiftHours: "25" });
addVal({ ...validRow(), otherMin: "10" });
addVal({ ...validRow(), otherMin: "10", otherMinRemark: "power cut" });
addVal({ ...validRow(), setupMin: "600" });
addVal({ ...validRow(), lunchMin: "abc" });
addVal({ ...validRow(), lunchMin: "1441" });
addVal({ ...validRow(), plannedDownMin: "1441", bdMechMin: "-1" });
for (let i = 0; i < 900 * SCALE; i += 1) {
  const v = validRow();
  const row = chance(0.5) ? saneRow("v" + i) : junkRow("v" + i);
  const merged = { ...v, ...row };
  if (chance(0.5)) merged.plannedOperatorShiftHours = pick(HM);
  if (chance(0.3)) merged.operator = pick(["", "  ", "Ravi", undefined, null]);
  if (chance(0.3)) merged.processType = pick(["", "Rivet", "Clamp", "Other", undefined]);
  if (chance(0.2)) merged.date = pick(["", "2026-04-06", undefined]);
  if (chance(0.2)) merged.machine = pick(["", "m2", undefined]);
  if (chance(0.1)) merged.workingMode = "Non Working";
  if (chance(0.3)) merged.otherMin = pick(NUMS);
  if (chance(0.3)) merged.otherMinRemark = pick(["", "why", "  ", undefined]);
  for (const k of RIVET_DOWNTIME_KEYS) if (chance(0.2)) merged[k] = pick(NUMS);
  if (chance(0.3)) merged.lunchMin = pick(NUMS);
  const saved = chance(0.2) ? { machineOnTime: pick(TIMES_OK), machineOffTime: pick(TIMES_OK) } : undefined;
  if (saved && chance(0.5)) {
    saved.machineOnTime = merged.machineOnTime;
    saved.machineOffTime = merged.machineOffTime;
  }
  addVal(merged, saved);
}
const errorLists = valCases.slice(0, 200).map((c) => c.errors);
write("validation.json", { cases: valCases, fieldOrder: RIVET_FIELD_ORDER, downtimeKeys: RIVET_DOWNTIME_KEYS, processTypes: RIVET_PROCESS_TYPES, formulas: RIVET_FORMULAS });

// firstRivetError: groups of 1-4 real error maps, plus hand-made lists.
const firstCases = [];
const realErrors = valCases.map((c) => {
  const o = {};
  for (const [k, x] of Object.entries(c.errors)) o[k] = x;
  return o;
});
for (let i = 0; i < 200; i += 1) {
  const n = int(1, 4);
  const list = [];
  for (let j = 0; j < n; j += 1) list.push(chance(0.2) ? {} : pick(realErrors));
  firstCases.push({ errors: list, out: firstRivetError(list.map((e) => JSON.parse(JSON.stringify(e)))) });
}
firstCases.push({ errors: [], out: firstRivetError([]) });
firstCases.push({ errors: [{}, {}], out: firstRivetError([{}, {}]) });
firstCases.push({ errors: [{ zzz: "x" }], out: firstRivetError([{ zzz: "x" }]) });
firstCases.push({ errors: [{ okQty: "a", processType: "b" }], out: firstRivetError([{ okQty: "a", processType: "b" }]) });
write("first_error.json", firstCases);
void errorLists;

// ── page handlers (copied from pages/RivetDataEntry.jsx — keep in step) ──────
const STOPPAGE_KEYS = STOPPAGE_FIELDS.map((f) => f.key);
const TEXT_FIELDS = ["operator", "processType", "itemName", "drawingNo", "remarks", "otherMinRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = ["noOfHoles", ...OPS, "totalCycleSec", "okQty", "rejectedQty", "plannedOperatorShiftHours", ...STOPPAGE_KEYS];
const hasAnyEntryData = (list) =>
  list.some((v) => {
    if (v.machine) return true;
    return [...TEXT_FIELDS, ...TIME_FIELDS, ...NUMBER_FIELDS].some((k) => v[k] !== "" && v[k] !== undefined && v[k] !== null);
  });
const emptyEntry = () => ({
  date: "2026-01-01",
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
const toFormValues = (row) => ({
  ...emptyEntry(),
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
  ...Object.fromEntries(OPS.map((k) => [k, it[k] ?? ""])),
  excludedOps: [],
});
const DATA_KEYS = ["operator", "machineStatus", "processType", "itemName", "noOfHoles", "machineOnTime", "machineOffTime", "okQty", "rejectedQty", "plannedOperatorShiftHours", "lunchMin", ...RIVET_DOWNTIME_KEYS, "otherMinRemark", "remarks"];
const hasData = (v) => v.workingMode === "Non Working" || DATA_KEYS.some((k) => (Array.isArray(v[k]) ? v[k].length > 0 : v[k] !== "" && v[k] !== undefined && v[k] !== null));

// A typed block (what the phone's boxes hold: Strings) in the shapes the form can produce.
function typedBlock(i) {
  const b = { ...emptyEntry(), ...(chance(0.7) ? saneRow("p" + i) : junkRow("p" + i)) };
  b.date = pick(["2026-04-06", "2026-01-01", "", undefined]);
  b.machine = pick(["m1", "", "m3", undefined]);
  b.slot = pick([1, 2, 3, "2", undefined, "x"]);
  b.item = pick(["", "i1", undefined, null]);
  if (chance(0.5)) b._id = "id" + i;
  b.workingMode = pick(["Working", "Non Working", undefined, ""]);
  b.machineStatus = pick([[], ["Machine Breakdown"], ["No Manpower", "No Planning"], undefined, null]);
  b.vendor = pick(["", "v1", undefined]);
  b.plannedOperatorShiftHours = pick(HM);
  b.lunchMin = pick(["", "0", "30", undefined, null, "abc", 20]);
  b.otherMin = pick(["", "0", "5", undefined, "abc", null]);
  b.otherMinRemark = pick(["", " why ", undefined, null, 5]);
  b.operator = pick(["Ravi", "  Asha  ", "", undefined, null]);
  b.remarks = pick(["", "  x ", undefined]);
  if (chance(0.3)) b.noOfHoles = pick(["4", "", 6, "abc", null]);
  if (chance(0.3)) b.excludedOps = pick([[], [OPS[0]], undefined, null]);
  if (chance(0.3)) b.machineOnTime = pick(TIMES_OK);
  return b;
}
const payloadCases = [];
for (let i = 0; i < 500 * SCALE; i += 1) {
  const b = typedBlock(i);
  const isEdit = chance(0.5);
  payloadCases.push({ values: encIn(b), isEdit, payload: wire(toPayload(b, isEdit)) });
}
write("payload.json", payloadCases);

// A saved record -> form values -> payload (the edit round trip). Numbers in the
// row stay numbers on the web; the phone shows them as text, the payload agrees.
const roundCases = [];
for (let i = 0; i < 400 * SCALE; i += 1) {
  const row = {
    _id: "id" + i,
    date: "2026-04-06",
    machine: pick(["m1", "m2"]),
    slot: pick([1, 2, 3]),
    item: pick(["i1", null, undefined]),
    operator: pick(["Ravi", "", null]),
    processType: pick(["Rivet", "Clamp", "", null]),
    itemName: pick(ITEMS),
    drawingNo: pick(["D-1", "", null]),
    noOfHoles: pick([4, 0, null, "6", undefined]),
    ...Object.fromEntries(OPS.map((k) => [k, pick([5, 10, 12.5, null, "7"])])),
    totalCycleSec: pick([45, 30.5, "", null, 60]),
    excludedOps: pick([[], [OPS[1]], null, undefined]),
    machineOnTime: pick(["08:00", "06:30"]),
    machineOffTime: pick(["16:00", "14:30"]),
    okQty: pick([300, 0, "12", null]),
    rejectedQty: pick([5, 0, null]),
    plannedOperatorShiftHours: pick([8, 8.5, 9, 7.75, 3.8333333333, null, undefined, 24, "9"]),
    lunchMin: pick([30, 0, null, undefined, 45]),
    setupMin: pick([10, null, undefined]),
    otherMin: pick([0, 5, null]),
    otherMinRemark: pick(["", "power", null]),
    remarks: pick(["", "note", null]),
    workingMode: pick(["Working", "Non Working", undefined]),
    machineStatus: pick([[], ["No Planning"], undefined]),
    vendor: pick([null, "v1", undefined]),
    vendorName: pick(["", "Vend", undefined]),
  };
  const isEdit = chance(0.7);
  roundCases.push({ row: encIn(row), isEdit, payload: wire(toPayload(toFormValues(row), isEdit)) });
}
write("round_trip.json", roundCases);

// hasAnyEntryData / hasData / emptyEntry / withPart
const dataCases = [];
for (let i = 0; i < 300 * SCALE; i += 1) {
  const n = int(1, 3);
  const list = [];
  for (let j = 0; j < n; j += 1) list.push(chance(0.4) ? emptyEntry() : typedBlock(i * 3 + j));
  dataCases.push({ blocks: encIn(list), any: hasAnyEntryData(list), each: list.map(hasData) });
}
write("has_data.json", dataCases);

const items = [
  { _id: "i1", itemName: "Rivet A", drawingNo: "D-1", totalCycleSec: "45", rivetLoadingSec: "10", rivetProcessSec: "20", rivetUnloadingCleaningSec: "10", rivetOtherOperationsSec: "5" },
  { _id: "i2", itemName: "Clamp 7", totalCycleSec: "30", rivetLoadingSec: "10" },
  { _id: "i3", itemName: "Bare" },
];
const pickCases = [];
for (const itemId of ["i1", "i2", "i3", "", "zzz"]) {
  for (let i = 0; i < 6; i += 1) {
    const b = typedBlock(i);
    b.excludedOps = pick([[], [OPS[0]]]);
    const it = items.find((x) => x._id === itemId);
    const out = !itemId ? { ...b, item: "", itemName: "", drawingNo: "" } : !it ? { ...b, item: "" } : withPart(b, it);
    pickCases.push({ values: encIn(b), itemId, out: wire(out) });
  }
}
write("apply_item.json", { items, cases: pickCases });
write("empty_entry.json", wire(emptyEntry()));

console.log(
  JSON.stringify({
    rowCalc: rowCalcOut.length,
    dayCalc: dayCases.length,
    validate: valCases.length,
    firstError: firstCases.length,
    payload: payloadCases.length,
    roundTrip: roundCases.length,
    hasData: dataCases.length,
    applyItem: pickCases.length,
  }),
);
