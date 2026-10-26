// Golden-fixture generator for test/production/processes/final_assembly/*.
//
// Runs the REAL client/src/utils/finalAssemblySheet.js + finalAssemblyValidation.js
// (and the shared productionSheet.js / entryValidation.js / quantityRules.js /
// shiftHours.js / limitNotice.js they import), the REAL table columns
// (Components/Production/finalAssemblyColumns.jsx, rendered to text with
// react-dom/server) and the REAL dashboard engine (utils/processDashboard.js)
// over a deterministic (seeded) input set. client/ is only READ. The page's own
// pure handlers are copied from client/src/pages/FinalAssemblyDataEntry.jsx and
// Components/Production/FinalAssemblyEntryForm.jsx below.
//
//   cd mobile
//   ESB=../client/node_modules/.bin/esbuild
//   $ESB test/production/processes/final_assembly/tool/gen_fa_golden.mjs --bundle \
//        --platform=node --format=esm --loader:.js=jsx --loader:.css=empty \
//        '--define:import.meta.env={}' \
//        "--banner:js=import {createRequire} from 'module';const require=createRequire(import.meta.url);" \
//        --outfile=<scratch>/fa-golden/gen.mjs
//   OUT_DIR=test/production/processes/final_assembly/fixtures TZ=Asia/Kolkata node <scratch>/fa-golden/gen.mjs
//
// NaN/Infinity/undefined travel as {"$n":"NaN"|"Inf"|"-Inf"} and {"$u":1}.

import fs from "node:fs";
import path from "node:path";
import React from "../../../../../../client/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../../../../../client/node_modules/react-dom/server.js";
import { WORKING_STATUSES, isoDay, sortByMachineOn } from "../../../../../../client/src/utils/productionSheet.js";
import {
  FA_DEFECT_REASONS,
  FA_FORMULAS,
  FA_IDLE_FIELDS,
  FA_LABELS,
  FA_MAX_ENTRIES_PER_DAY,
  NON_WORKING_STATUSES,
  defectTotal,
  faDayCalc,
  faRowCalc,
  isFinalAssemblyProcess,
  isStatusOnly,
} from "../../../../../../client/src/utils/finalAssemblySheet.js";
import { FA_FIELD_ORDER, FA_MINUTE_KEYS, firstFinalAssemblyError, validateFinalAssemblyEntry } from "../../../../../../client/src/utils/finalAssemblyValidation.js";
import { FA_WORDS, firstOverLimit, stoppageNotice } from "../../../../../../client/src/utils/limitNotice.js";
import { slotsFullErrors } from "../../../../../../client/src/utils/entryValidation.js";
import { hasRejectData, quantityFormValues, rejectPayload } from "../../../../../../client/src/utils/quantityRules.js";
import { hmToWireHours, hoursToShiftInput, parseShiftHours } from "../../../../../../client/src/utils/shiftHours.js";
import { FINAL_ASSEMBLY_COLUMNS } from "../../../../../../client/src/Components/Production/finalAssemblyColumns.jsx";
import * as PD from "../../../../../../client/src/utils/processDashboard.js";

const OUT = process.env.OUT_DIR;
if (!OUT) throw new Error("set OUT_DIR");
fs.mkdirSync(OUT, { recursive: true });

const consoleError = console.error;
console.error = (...a) => (String(a[0]).includes("useLayoutEffect") ? undefined : consoleError(...a));

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(Number(process.env.SEED || 20261027));
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
const wire = (v) => JSON.parse(JSON.stringify(v));
const dropUndefined = (o) => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};

// ── copies of the page's pure handlers (FinalAssemblyDataEntry.jsx) ─────────
const TEXT_FIELDS = ["workingStatus", "itemName", "otherActivity", "remarks", "otherMinRemark", "rejectOtherRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = ["totalCycleSec", "actualQty", "otherActivityMin", "plannedOperatorShiftHours", "lunchMin", "otherMin"];

const hasAnyEntryData = (list) =>
  list.some((v) => {
    if (v.machine) return true;
    if (hasRejectData(v)) return true;
    return [...TEXT_FIELDS, ...TIME_FIELDS, ...NUMBER_FIELDS].some((k) => v[k] !== "" && v[k] !== undefined && v[k] !== null);
  });

const emptyEntry = () => ({
  date: isoDay(new Date()),
  machine: "",
  machineStatus: [],
  workingMode: "Working",
  slot: 1,
  item: "",
  vendor: "",
  vendorName: "",
  rejectBreakdown: {},
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, ""])),
});

const toFormValues = (row) => ({
  ...emptyEntry(),
  ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)),
  item: row.item || "",
  vendor: row.vendor || "",
  slot: row.slot,
  ...quantityFormValues(row, FA_DEFECT_REASONS),
  plannedOperatorShiftHours: hoursToShiftInput(row.plannedOperatorShiftHours),
});

const STATUS_ONLY_KEPT = ["workingStatus", "workingMode", "machineStatus", "remarks"];
const toPayload = (v, isEdit, processId) => {
  const body = toFullPayload(v, isEdit, processId);
  if (!isStatusOnly(v) && v.workingMode !== "Non Working") return body;
  return Object.fromEntries(
    Object.entries(body).map(([k, val]) =>
      ["_id", "date", "machine", "process", "slot", ...STATUS_ONLY_KEPT].includes(k) ? [k, val] : [k, k === "item" ? null : k === "rejectBreakdown" ? {} : ""],
    ),
  );
};
const toFullPayload = (v, isEdit, processId) => ({
  ...(isEdit && v._id ? { _id: v._id } : {}),
  date: v.date,
  machine: v.machine,
  process: processId,
  vendor: v.vendor || "",
  machineStatus: v.workingMode === "Non Working" ? v.machineStatus || [] : [],
  workingMode: v.workingMode || "Working",
  slot: isEdit ? Number(v.slot) : "auto",
  item: v.item || null,
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, String(v[k] ?? "").trim()])),
  otherMinRemark: Number(v.otherMin) > 0 ? String(v.otherMinRemark ?? "").trim() : "",
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, v[k] ?? ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, v[k] === "" || v[k] === undefined ? "" : Number(v[k])])),
  ...rejectPayload(v),
  plannedOperatorShiftHours: (() => {
    const { hours } = parseShiftHours(v.plannedOperatorShiftHours);
    return hours === null ? "" : hmToWireHours(hours);
  })(),
  lunchMin: v.lunchMin === "" || v.lunchMin === undefined ? 0 : Number(v.lunchMin),
});
const savePayload = (body) => {
  const { machine, ...row } = body;
  return wire({ ...row, worker: machine });
};

// FinalAssemblyEntryForm.jsx LINES / DATA_KEYS / hasData.
const LINES = [
  { id: 1, fields: ["date", "machine", "machineStatus"] },
  { id: 2, fields: ["itemName", "vendor", "totalCycleSec"] },
  { id: 3, fields: ["machineOnTime", "machineOffTime"] },
  { id: 5, fields: ["actualQty", "rejectBreakdown", "rejectOtherRemark"] },
  { id: 6, fields: ["otherActivity", "otherActivityMin"] },
  { id: 7, fields: ["plannedOperatorShiftHours", "lunchMin"] },
  { id: 8, fields: ["otherMin", "stoppageTotal", "otherMinRemark"] },
  { id: 12, fields: ["remarks"] },
];
const DATA_KEYS = LINES.flatMap((l) => l.fields).filter((k) => !["date", "machine", "stoppageTotal", "rejectBreakdown"].includes(k));
const blockHasData = (v) =>
  v.workingMode === "Non Working" ||
  DATA_KEYS.some((k) => (Array.isArray(v[k]) ? v[k].length > 0 : v[k] !== "" && v[k] !== undefined && v[k] !== null)) ||
  Object.values(v.rejectBreakdown || {}).some((n) => n !== "" && n !== undefined && n !== null);

const withPart = (v, it) => ({ ...v, item: it._id, itemName: it.itemName, totalCycleSec: it.totalCycleSec ?? "" });
const handleItemSelect = (v, itemId, items) => {
  if (!itemId) return { ...v, item: "", itemName: "", totalCycleSec: "" };
  const it = items.find((item) => item._id === itemId);
  if (!it) return { ...v, item: "" };
  return withPart(v, it);
};

// ── value pools ─────────────────────────────────────────────────────────────
const TIMES_OK = ["08:00", "09:30", "10:30", "11:00", "14:00", "14:55", "15:55", "16:00", "17:00", "18:00", "19:00", "9", "930", "9:30", "9.30", "23:59", "00:00"];
const TIMES_BAD = ["24:00", "9:5", "abc", "", "  ", "25", "7:60", null, undefined, 930];
const NUMS = ["", undefined, null, "0", "1", "5", "10", "12.5", 3, 7.5, "  ", "abc", "-4", "1e2", "45", 45, "120", "0.5", "600", "1440", "1441"];
const QTY = ["", undefined, null, "0", "10", "12", "18", "40", "140", "185", "200", "600", 320, "12.5", "-3", "abc", "  ", "9999"];
const STDS = ["", "", "30", "20", "60", "50", 30, "12.5", "0", "-1", "abc", "1e400", undefined, null];
const DEF = ["", undefined, null, "0", "1", "2", "5", 3, "0.5", "-1", "abc", "  ", "40"];
const ITEMS = ["24 PIN SIDE ENTRY B/M", "PACKING", "6 PIN 35 A SET B/O", " Hood ", "X"];
const STATUSES = ["", "", "", "PRESENT", "ABSENT", "SUNDAY", "LEAVE", "HOLIDAY", " absent ", "present", "W/OFF", undefined, null, 7];
const defects = (p = 0.5) => {
  const rb = {};
  for (const r of FA_DEFECT_REASONS) if (chance(p)) rb[r] = pick(DEF);
  if (chance(0.05)) rb["Tool Mark"] = "3";
  return rb;
};

// The sheet's 18 real paper rows (utils/finalAssemblySheet.test.mjs) — entered as the form saves them.
const PAPER = [
  ["09:30", "10:30", 30, 185, {}], ["10:30", "11:00", 30, 40, {}], ["11:00", "14:00", 30, 200, { lunchMin: 30 }], ["14:55", "15:55", 20, 60, {}],
  ["14:55", "15:55", 60, 12, {}], ["16:00", "17:00", 30, 140, {}], ["17:00", "19:00", 60, 25, {}], ["17:00", "19:00", 50, 18, {}], ["17:00", "19:00", 50, 18, {}],
  ["15:00", "19:00", null, 0, { otherActivity: "Material Shifting" }], ["08:00", "18:00", null, 170, { lunchMin: 30 }], ["08:00", "18:00", null, 8, { lunchMin: 30 }],
  ["08:00", "18:00", null, 8, { lunchMin: 30 }], ["08:00", "18:00", null, 200, { lunchMin: 30 }], ["08:00", "18:00", null, 20, { lunchMin: 30 }],
  ["08:00", "18:00", null, 4, { lunchMin: 30 }], ["08:00", "18:00", null, 600, { lunchMin: 30 }], ["08:00", "18:00", null, 1, { lunchMin: 30 }],
];
const spanMin = (on, off) => {
  const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return m(off) - m(on);
};
const paperRow = ([on, off, std, total, extra], i, more = {}) => ({
  _id: `p${i}`,
  machine: "w1",
  date: "2024-05-11",
  itemName: std === null ? "PACKING" : "Connector",
  ...(std === null ? {} : { totalCycleSec: std }),
  machineOnTime: on,
  machineOffTime: off,
  actualQty: total,
  rejectBreakdown: {},
  plannedOperatorShiftHours: spanMin(on, off) / 60,
  ...extra,
  ...more,
});

function saneRow(id) {
  const [on, off] = pick([["09:30", "10:30"], ["11:00", "14:00"], ["08:00", "18:00"], ["17:00", "19:00"], ["9", "17"], ["0930", "1330"]]);
  const total = int(0, 400);
  const row = {
    _id: id,
    date: "2024-05-11",
    machine: "w" + int(1, 4),
    operator: "Worker " + int(1, 5),
    itemName: pick(ITEMS),
    machineOnTime: on,
    machineOffTime: off,
    actualQty: String(total),
    plannedOperatorShiftHours: pick([1, 2, 3, 8, 10, 12, "8", 7.75]),
    lunchMin: pick(["0", "20", "30", "", 30]),
    otherMin: pick(["", "0", "5", "15"]),
    otherActivityMin: pick(["", "0", "10", "25"]),
    remarks: pick(["", "AMIT , DILIP"]),
    rejectBreakdown: {},
  };
  if (chance(0.7)) row.totalCycleSec = pick(["30", "20", "60", "50", 30, "12.5"]);
  for (const r of FA_DEFECT_REASONS) if (chance(0.3)) row.rejectBreakdown[r] = String(int(0, Math.max(0, Math.floor(total / 8))));
  if (chance(0.15)) row.plannedLocked = chance(0.5);
  return row;
}
function junkRow(id) {
  const row = { _id: id };
  if (chance(0.85)) row.itemName = pick([...ITEMS, " ", "", null, undefined, 7]);
  if (chance(0.9)) row.machineOnTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.9)) row.machineOffTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.7)) row.totalCycleSec = pick(STDS);
  if (chance(0.85)) row.actualQty = pick(QTY);
  if (chance(0.2)) row.okQty = pick(QTY);
  if (chance(0.15)) row.rejectedQty = pick(QTY);
  if (chance(0.7)) row.rejectBreakdown = pick([defects(), defects(0.9), null, [3, "x"], {}]);
  if (chance(0.5)) row.otherActivityMin = pick(NUMS);
  if (chance(0.5)) row.plannedOperatorShiftHours = pick([...NUMS, 8.5, 12]);
  if (chance(0.5)) row.lunchMin = pick(NUMS);
  if (chance(0.5)) row.otherMin = pick(NUMS);
  if (chance(0.1)) row.setupMin = pick(NUMS);
  if (chance(0.3)) row.workingStatus = pick(STATUSES);
  if (chance(0.15)) row.workingMode = pick(["Working", "Non Working", "", undefined]);
  return row;
}

// ── faRowCalc ───────────────────────────────────────────────────────────────
const curated = [
  ...PAPER.map((p, i) => paperRow(p, i)),
  { itemName: "X", machineOnTime: "08:00", machineOffTime: "09:00", totalCycleSec: 30, actualQty: 100, rejectBreakdown: { "Wrong Assembly": 3, "Broken Screw": "2", Other: "1" } },
  { itemName: "X", machineOnTime: "08:00", machineOffTime: "09:00", totalCycleSec: 7, actualQty: 100 },
  { itemName: "X", machineOnTime: "08:00", machineOffTime: "09:00", actualQty: 100, rejectBreakdown: { Other: 5 } },
  { itemName: "X", machineOnTime: "08:00", machineOffTime: "09:00", totalCycleSec: "", actualQty: "" },
  { itemName: "X", machineOnTime: "08:00", machineOffTime: "09:00", totalCycleSec: 30, rejectBreakdown: { Other: 2 } },
  { itemName: "X", totalCycleSec: 30, actualQty: 10 },
  {},
];
const rowCases = [...curated];
for (let i = 0; i < 700 * SCALE; i += 1) rowCases.push(chance(0.5) ? saneRow("r" + i) : junkRow("r" + i));
const rowOut = rowCases.map((row) => ({ row: encIn(row), out: enc(faRowCalc(row)) }));
rowOut.push({ row: null, out: enc(faRowCalc(null)) });
write("row_calc.json", rowOut);

write("helpers.json", {
  rows: rowCases.map((row) => ({ row: encIn(row), defectTotal: enc(defectTotal(row)), statusOnly: isStatusOnly(row) })),
  processes: [
    { dataEntryMenu: "/hqepl/production/final-assembly-data-entry" },
    { dataEntryMenu: "/admin/production/final-assembly-data-entry/" },
    { dataEntryMenu: "/hqepl/production/cnc-data-entry", processName: "FINAL ASSEMBLY" },
    { processName: "FINAL ASSEMBLY" },
    { processName: "Final  Assembly line" },
    { processName: "FINALASSEMBLY" },
    { processName: "MODULAR FRAME ASSEMBLY" },
    {},
    null,
  ].map((p) => ({ process: p, is: isFinalAssemblyProcess(p) })),
});

// ── faDayCalc ───────────────────────────────────────────────────────────────
const dayCases = [];
const addDay = (rows) => {
  const sorted = sortByMachineOn(rows);
  dayCases.push({ rows: encIn(rows), order: sorted.map((r) => r && r._id), out: enc(faDayCalc(sorted)) });
};
addDay([]);
for (let i = 0; i < PAPER.length; i += 1) addDay([paperRow(PAPER[i], i)]);
addDay(PAPER.slice(0, 9).map((p, i) => paperRow(p, i)));
addDay(PAPER.slice(3, 9).map((p, i) => paperRow(p, i, { plannedLocked: i === 1, plannedOperatorShiftHours: 12 })));
addDay(PAPER.slice(10, 18).map((p, i) => paperRow(p, i, { otherActivityMin: i === 0 ? 30 : "" })));
addDay([null, paperRow(PAPER[0], 0), null]);
for (let i = 0; i < 300 * SCALE; i += 1) {
  const rows = [];
  for (let j = 0, n = int(1, 4); j < n; j += 1) {
    const r = chance(0.7) ? saneRow(`d${i}_${j}`) : junkRow(`d${i}_${j}`);
    if (chance(0.4)) r.machineOffTime = pick(TIMES_OK);
    if (chance(0.3)) r.otherActivityMin = pick(["", "5", "15", "x", 20]);
    rows.push(r);
  }
  addDay(rows);
}
write("day_calc.json", dayCases);

// ── validateFinalAssemblyEntry ──────────────────────────────────────────────
const baseValid = () => ({
  date: "2024-05-11",
  machine: "w1",
  machineStatus: [],
  workingMode: "Working",
  itemName: "Connector",
  vendor: "",
  machineOnTime: "11:00",
  machineOffTime: "14:00",
  totalCycleSec: "30",
  actualQty: "200",
  rejectBreakdown: { "Wrong Assembly": "2", "Broken Screw": "", Other: "" },
  rejectOtherRemark: "",
  otherActivity: "",
  otherActivityMin: "",
  plannedOperatorShiftHours: "3",
  lunchMin: "30",
  otherMin: "",
  otherMinRemark: "",
  remarks: "",
});
const valMutations = [
  {}, { date: "" }, { date: null }, { machine: "" }, { machine: undefined }, { itemName: "" }, { itemName: "   " },
  { workingMode: "Non Working" }, { workingMode: "Non Working", date: "", machine: "" }, { workingStatus: "ABSENT" }, { workingStatus: "SUNDAY", machine: "" },
  { workingStatus: "PRESENT" }, { workingStatus: " LEAVE " }, { workingStatus: 5 },
  { machineOnTime: "" }, { machineOffTime: "" }, { machineOnTime: "abc" }, { machineOffTime: "25:00" }, { machineOnTime: "9" }, { machineOffTime: "14.30" },
  { machineOnTime: "14:00", machineOffTime: "11:00" }, { machineOnTime: "11:00", machineOffTime: "11:00" }, { machineOnTime: "23:59", machineOffTime: "00:00" },
  { vendor: "v1" },
  { totalCycleSec: "" }, { totalCycleSec: undefined }, { totalCycleSec: "0" }, { totalCycleSec: "abc" }, { totalCycleSec: "-3" }, { totalCycleSec: "  " }, { totalCycleSec: 30 }, { totalCycleSec: "7" },
  { actualQty: "" }, { actualQty: undefined }, { actualQty: "abc" }, { actualQty: "-1" }, { actualQty: "  " }, { actualQty: "12.5" }, { actualQty: "0" }, { actualQty: "1" }, { actualQty: 200 }, { actualQty: "9999" },
  { rejectBreakdown: {} }, { rejectBreakdown: undefined }, { rejectBreakdown: { Other: "3" } }, { rejectBreakdown: { Other: "3" }, rejectOtherRemark: "scratch" }, { rejectBreakdown: { Other: "3" }, rejectOtherRemark: "  " },
  { rejectBreakdown: { "Wrong Assembly": "-1" } }, { rejectBreakdown: { "Broken Screw": "1.5" } }, { rejectBreakdown: { "Wrong Clamping": "abc" } }, { rejectBreakdown: { "Wrong Assembly": "200" } },
  { rejectBreakdown: { "Wrong Assembly": "150", "Broken Screw": "51" } }, { rejectBreakdown: { "Tool Mark": "-2" } }, { rejectBreakdown: { "Wrong Assembly": 5 } }, { rejectBreakdown: [1, 2] },
  { actualQty: "", rejectBreakdown: { Other: "5" } }, { actualQty: "1", rejectBreakdown: { "Wrong Assembly": "2" } },
  { plannedOperatorShiftHours: "" }, { plannedOperatorShiftHours: "0" }, { plannedOperatorShiftHours: "-1" }, { plannedOperatorShiftHours: "24" }, { plannedOperatorShiftHours: "24.01" },
  { plannedOperatorShiftHours: "abc" }, { plannedOperatorShiftHours: "2.99" }, { plannedOperatorShiftHours: "2.5" }, { plannedOperatorShiftHours: "3.0" }, { plannedOperatorShiftHours: "3,5" }, { plannedOperatorShiftHours: 12 },
  { plannedOperatorShiftHours: "9", machineOnTime: "14:00", machineOffTime: "11:00" }, { machineOnTime: "", plannedOperatorShiftHours: "0.30" },
  { lunchMin: "" }, { lunchMin: "abc" }, { lunchMin: "-1" }, { lunchMin: "1441" }, { lunchMin: "180" }, { lunchMin: "181" }, { lunchMin: "12.5" },
  { otherActivityMin: "10" }, { otherActivityMin: "10", otherActivity: "Material Shifting" }, { otherActivityMin: "10", otherActivity: "  " }, { otherActivityMin: "abc" }, { otherActivityMin: "-1" },
  { otherActivityMin: "150", otherActivity: "x" }, { otherActivityMin: "151", otherActivity: "x" }, { otherActivity: "Packing" },
  { otherMin: "5" }, { otherMin: "5", otherMinRemark: "power cut" }, { otherMin: "0" }, { otherMin: "abc" }, { otherMin: "1441", otherMinRemark: "r" }, { otherMin: "151", otherMinRemark: "r" },
  { machineOnTime: "", lunchMin: "5000" }, { setupMin: "50" }, { plannedDownMin: "500" },
  { date: "", machine: "", itemName: "", machineOnTime: "", machineOffTime: "", actualQty: "", plannedOperatorShiftHours: "", lunchMin: "", totalCycleSec: "" },
];
const valInputs = valMutations.map((m) => dropUndefined({ ...baseValid(), ...m }));
for (let i = 0; i < 320 * SCALE; i += 1) valInputs.push(dropUndefined({ ...baseValid(), ...pick(valMutations), ...pick(valMutations), ...pick(valMutations) }));
for (let i = 0; i < 120 * SCALE; i += 1) {
  const r = junkRow("v" + i);
  r.machine = pick(["w1", "", undefined, "  "]);
  r.date = pick(["2024-05-11", "", undefined]);
  valInputs.push(dropUndefined(r));
}
const savedVariants = [
  null,
  { date: "2024-05-11", machine: "w1", machineOnTime: "11:00", machineOffTime: "14:00" },
  { date: "2024-05-11", machine: "w1", machineOnTime: "14:00", machineOffTime: "11:00" },
  { date: "2024-05-10", machine: "w1", machineOnTime: "14:00", machineOffTime: "11:00" },
];
const valCases = [];
for (const v of valInputs) {
  const saved = pick(savedVariants);
  valCases.push({ values: encIn(v), saved, errors: saved ? validateFinalAssemblyEntry(v, { saved }) : validateFinalAssemblyEntry(v) });
}
write("validation.json", valCases);

const errLists = [];
for (let i = 0; i < 80; i += 1) {
  const list = [];
  for (let j = 0; j < int(0, 3); j += 1) list.push(pick(valCases).errors);
  if (chance(0.15)) list.push(null);
  errLists.push(list);
}
errLists.push([], [{}], [{ zzz: "x", date: "d" }], [{}, { zzz: "only unknown" }]);
write("first_error.json", {
  order: FA_FIELD_ORDER,
  minuteKeys: FA_MINUTE_KEYS,
  cases: errLists.map((list) => ({ errors: list, first: firstFinalAssemblyError(list.map((e) => e || {})) })),
});

// ── values / payload ────────────────────────────────────────────────────────
const stored = () => ({
  _id: "e" + int(1, 99999),
  date: "2024-05-11",
  worker: "w1",
  machine: "w1",
  process: "p1",
  operator: "Alkesh",
  slot: pick([1, 2, 12]),
  item: pick(["i1", null]),
  itemName: "Connector",
  vendor: pick([null, "v1"]),
  vendorName: pick(["", "Acme"]),
  totalCycleSec: pick([30, undefined, null, 12.5]),
  machineOnTime: "11:00",
  machineOffTime: "14:00",
  actualQty: pick([200, undefined, null]),
  okQty: pick([195, undefined]),
  rejectedQty: pick([5, 0, undefined]),
  rejectBreakdown: pick([undefined, {}, { "Wrong Assembly": 3, Other: 2, "Tool Mark": 4 }, { Other: 5 }]),
  rejectReason: pick([undefined, "", "Other", "Wrong Assembly", "Tool Mark"]),
  rejectOtherRemark: pick(["", "scratched"]),
  otherActivity: pick(["", "Material Shifting"]),
  otherActivityMin: pick([undefined, 10]),
  plannedOperatorShiftHours: pick([3, 8, 7.75, 3.333333, null, 12]),
  lunchMin: pick([30, 0, undefined]),
  otherMin: pick([undefined, 5]),
  otherMinRemark: pick(["", "power cut"]),
  remarks: pick(["", "AMIT , DILIP"]),
  workingMode: pick([undefined, "Non Working"]),
  machineStatus: pick([undefined, ["No Manpower"]]),
  workingStatus: pick([undefined, "", "ABSENT"]),
});
const formCases = [];
for (let i = 0; i < 80 * SCALE; i += 1) {
  const row = dropUndefined(stored());
  formCases.push({ row: encIn(row), out: enc(toFormValues(row)) });
}
write("to_form_values.json", formCases);

const payloadCases = [];
for (const v of valInputs) {
  for (const isEdit of [false, true]) {
    if (chance(0.6)) continue;
    const values = dropUndefined({ ...v, _id: pick([undefined, "e1", ""]), slot: pick([1, 2, 12, "2", undefined, "abc"]), item: pick(["", "i1", undefined]), vendor: pick(["", "v1", undefined]) });
    const processId = pick(["p1", "p2"]);
    payloadCases.push({ values: encIn(values), isEdit, processId, payload: savePayload(toPayload(values, isEdit, processId)) });
  }
}
for (const extra of [{ workingStatus: "ABSENT" }, { workingMode: "Non Working", machineStatus: ["No Manpower"] }, { workingStatus: "SUNDAY", remarks: " note " }]) {
  for (const isEdit of [false, true]) {
    const values = { ...baseValid(), ...extra, item: "i1", vendor: "v1", rejectBreakdown: { Other: "2" }, rejectOtherRemark: "x", _id: "e9", slot: 2 };
    payloadCases.push({ values: encIn(values), isEdit, processId: "p1", payload: savePayload(toPayload(values, isEdit, "p1")) });
  }
}
write("payload.json", payloadCases);

const dataCases = [];
const dataInputs = [
  ...valInputs.slice(0, 60),
  emptyEntry(),
  { ...emptyEntry(), machine: "w1" },
  { ...emptyEntry(), workingMode: "Non Working" },
  { ...emptyEntry(), machineStatus: ["No Planning"] },
  { ...emptyEntry(), rejectBreakdown: { Other: "0" } },
  { ...emptyEntry(), rejectBreakdown: { Other: "2" } },
  { ...emptyEntry(), rejectBreakdown: { Other: "" } },
  { ...emptyEntry(), rejectOtherRemark: "x" },
  { ...emptyEntry(), lunchMin: "0" },
  { ...emptyEntry(), vendor: "v1" },
];
for (const v of dataInputs) dataCases.push({ values: encIn(v), blockHasData: blockHasData(v), anyData: hasAnyEntryData([v]) });
dataCases.push({ list: [encIn(emptyEntry()), encIn({ ...emptyEntry(), machine: "w1" })], anyData: true });
dataCases.push({ list: [encIn(emptyEntry()), encIn(emptyEntry())], anyData: false });
write("has_data.json", dataCases);

const items = [
  { _id: "i1", itemName: "Connector", totalCycleSec: 30, process: "p1" },
  { _id: "i2", itemName: "PACKING", totalCycleSec: null },
  { _id: "i3", itemName: "Hood", totalCycleSec: "" },
  { _id: "i4", itemName: "Set", totalCycleSec: 12.5 },
];
const itemCases = [];
for (const id of ["", "i1", "i2", "i3", "i4", "nope"]) {
  const v = dropUndefined({ ...baseValid(), item: "iX", itemName: "Old", totalCycleSec: "99" });
  itemCases.push({ values: encIn(v), itemId: id, out: enc(handleItemSelect(v, id, items)) });
}
write("item_select.json", { items, cases: itemCases });

write("formulas.json", FA_FORMULAS);
write("fields.json", {
  labels: FA_LABELS,
  reasons: FA_DEFECT_REASONS,
  idle: FA_IDLE_FIELDS,
  nonWorking: NON_WORKING_STATUSES,
  workingStatuses: WORKING_STATUSES,
  maxEntries: FA_MAX_ENTRIES_PER_DAY,
  words: FA_WORDS,
});

// ── limit popups ────────────────────────────────────────────────────────────
const overCases = [];
const overNames = { w1: "Alkesh", w2: "Amit" };
const overBlock = () => {
  const b = dropUndefined({ ...baseValid(), ...pick(valMutations), machine: pick(["w1", "w2", "w9"]) });
  if (chance(0.7)) {
    b.machineOnTime = pick(["08:00", "09:30", "11:00"]);
    b.machineOffTime = pick(["09:00", "10:30", "14:00", "08:00"]);
    b.lunchMin = pick(["", "0", "30", "45", "70"]);
    b.otherMin = pick(["", "0", "10", "40"]);
    b.otherMinRemark = pick(["", "why"]);
    b.otherActivityMin = pick(["", "0", "20", "50", "90"]);
    b.otherActivity = pick(["", "Packing"]);
    b.actualQty = pick(["", "100", "9999"]);
  }
  return b;
};
for (let i = 0; i < 160 * SCALE; i += 1) {
  const blocks = Array.from({ length: int(1, 3) }, overBlock);
  const errors = blocks.map((b) => validateFinalAssemblyEntry(b));
  const out = firstOverLimit(blocks, errors, faRowCalc, { qtyKey: null, words: FA_WORDS, machineName: overNames });
  overCases.push({ blocks: encIn(blocks), errors: encIn(errors), machineName: overNames, out: enc(out) });
}
write("first_over_limit.json", overCases);
write("notices.json", [[60, 61], [180, 210.5], [600, 601]].map(([limitMin, totalMin]) => ({ limitMin, totalMin, out: stoppageNotice({ limitMin, totalMin, words: FA_WORDS }) })));

// ── slotsFullErrors (max 12) ────────────────────────────────────────────────
const slotCases = [];
const taken = (n) => Array.from({ length: n }, (_, i) => ({ slot: i + 1, machineOnTime: "08:00", machineOffTime: "18:00" }));
const who = (id) => ({ w1: "Alkesh" })[id] || "This worker";
for (const n of [0, 10, 11, 12, 13]) {
  for (const formBlocks of [1, 2, 3]) {
    const entries = Array.from({ length: formBlocks }, (_, i) => ({ date: "2024-05-11", machine: i === 2 ? "w2" : "w1" }));
    const occupied = { "w1|2024-05-11": taken(n), "w2|2024-05-11": taken(12) };
    slotCases.push({ entries, occupied, editSlot: null, saved: null, out: slotsFullErrors(entries, occupied, { who, max: FA_MAX_ENTRIES_PER_DAY }) });
  }
  for (const date of ["2024-05-11", "2024-05-12"]) {
    const entries = [{ date, machine: "w1" }];
    const occupied = { "w1|2024-05-11": taken(n), "w1|2024-05-12": taken(n) };
    const saved = { date: "2024-05-11", machine: "w1", machineOnTime: "08:00", machineOffTime: "18:00" };
    slotCases.push({ entries, occupied, editSlot: 2, saved, out: slotsFullErrors(entries, occupied, { editSlot: 2, saved, who, max: FA_MAX_ENTRIES_PER_DAY }) });
  }
}
write("slots_full.json", { cases: slotCases });

// ── the table's cells (finalAssemblyColumns.jsx, rendered to text) ──────────
const textOf = (v) => {
  if (v === null || v === undefined || v === false) return { text: "", eye: false };
  if (!React.isValidElement(v)) return { text: String(v), eye: false };
  const html = renderToStaticMarkup(v);
  const text = html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");
  return { text, eye: html.includes('aria-label="View remarks"') };
};
const tableColumns = FINAL_ASSEMBLY_COLUMNS.flatMap((c) => (c.expandable ? [c.summary, ...c.columns] : [c]));
const workerNames = { w1: "Alkesh", w2: "Amit", w3: "" };
const tableRows = [];
for (let i = 0; i < 160 * SCALE; i += 1) {
  const r = chance(0.6) ? saneRow("t" + i) : junkRow("t" + i);
  r.date = pick(["2024-05-11", "2024-05-16"]);
  r.machine = pick(["w1", "w2", "w3", "w9"]);
  if (chance(0.7)) r.operator = pick(["Alkesh", "Amit", "", "Old Name"]);
  if (chance(0.2)) r.vendorName = pick(["Acme", ""]);
  if (chance(0.25)) r.workingMode = pick(["Non Working", "Working"]);
  if (chance(0.25)) r.machineStatus = pick([[], ["No Manpower"], ["Machine Breakdown", "No Planning"]]);
  if (chance(0.3)) r.otherMin = pick(["", "0", "5", 12]);
  if (chance(0.3)) r.otherMinRemark = pick(["", "power cut"]);
  if (chance(0.3)) r.rejectOtherRemark = pick(["", "scratched"]);
  if (chance(0.3)) r.otherActivity = pick(["", "Material Shifting"]);
  if (chance(0.3)) r.remarks = pick(["", "AMIT , DILIP"]);
  if (chance(0.2)) r.review = pick([{ status: "pending" }, { status: "approved", decidedBy: { name: "Admin" } }, { status: "rejected" }]);
  tableRows.push(dropUndefined(r));
}
tableRows.push(...PAPER.map((p, i) => paperRow(p, i, { _id: "tp" + i, machine: "w1", operator: "Alkesh", date: "2024-05-11" })));
const dayByKey = {};
{
  const groups = {};
  for (const r of tableRows) (groups[`${r.machine}|${r.date}`] ||= []).push(r);
  for (const group of Object.values(groups)) {
    const sorted = sortByMachineOn(group);
    const results = faDayCalc(sorted);
    sorted.forEach((r, i) => {
      dayByKey[r._id] = results[i];
    });
  }
}
const ctx = { machineName: workerNames };
write("table_cells.json", {
  keys: tableColumns.map((c) => c.key),
  labels: tableColumns.map((c) => c.label),
  machineName: workerNames,
  rows: tableRows.map((r) => {
    const c = faRowCalc(r);
    const d = dayByKey[r._id] || {};
    const cells = {};
    for (const col of tableColumns) cells[col.key] = textOf(col.get(r, c, d, ctx));
    return { row: encIn(r), cells };
  }),
});

// ── dashboard ───────────────────────────────────────────────────────────────
const flags = { runQtyBasis: "total", calcMode: "perEntry" };
const fa = { processName: "FINAL ASSEMBLY", dataEntryMenu: "/hqepl/production/final-assembly-data-entry" };
const feed = (n) =>
  Array.from({ length: n }, (_, i) => {
    const r = saneRow("f" + i);
    r.date = pick(["2024-05-11", "2024-05-12"]);
    return { ...r, ...flags };
  });
write("dashboard.json", {
  stoppageKeys: PD.stoppageKeysFor(fa),
  isWorker: PD.isWorkerProcess(fa),
  scenarios: Object.fromEntries(
    Object.entries({
      paper: PAPER.map((p, i) => ({ ...paperRow(p, i), ...flags })),
      feed: feed(40),
      locked: feed(12).map((r) => ({ ...r, plannedLocked: true, plannedOperatorShiftHours: 12 })),
    }).map(([name, rows]) => [name, { rows: encIn(rows), summary: enc(PD.summarize(rows)) }]),
  ),
});

console.log("ok", { rows: rowOut.length, days: dayCases.length, validation: valCases.length, payload: payloadCases.length, table: tableRows.length });
