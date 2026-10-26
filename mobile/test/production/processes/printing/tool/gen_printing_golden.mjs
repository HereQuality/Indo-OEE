// Golden-fixture generator for test/production/processes/printing/*.
//
// Runs the REAL client/src/utils/printingSheet.js + printingValidation.js (and
// the shared productionSheet.js / entryValidation.js / quantityRules.js /
// shiftHours.js / limitNotice.js they import), the REAL table columns
// (Components/Production/printingColumns.jsx, rendered to text with
// react-dom/server) and the REAL dashboard engine (utils/processDashboard.js)
// over a broad, deterministic (seeded) input set and writes the JSON the Dart
// tests compare against. client/ is only READ; nothing is written inside it.
// The page's own pure handlers (emptyEntry, toFormValues, toPayload, …) are
// copied from client/src/pages/PrintingDataEntry.jsx and
// Components/Production/PrintingEntryForm.jsx below (pages are not importable).
//
//   cd mobile
//   ESB=../client/node_modules/.bin/esbuild
//   $ESB test/production/processes/printing/tool/gen_printing_golden.mjs --bundle \
//        --platform=node --format=esm --loader:.js=jsx --loader:.css=empty \
//        '--define:import.meta.env={}' \
//        "--banner:js=import {createRequire} from 'module';const require=createRequire(import.meta.url);" \
//        --outfile=<scratch>/printing-golden/gen.mjs
//   OUT_DIR=test/production/processes/printing/fixtures TZ=Asia/Kolkata node <scratch>/printing-golden/gen.mjs
//
// JSON cannot carry NaN/Infinity/undefined, so those are written as markers:
//   {"$n":"NaN"|"Inf"|"-Inf"}   and   {"$u":1} (undefined).

import fs from "node:fs";
import path from "node:path";
import React from "../../../../../../client/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../../../../../client/node_modules/react-dom/server.js";
import { WORKING_STATUSES, isoDay, sortByMachineOn } from "../../../../../../client/src/utils/productionSheet.js";
import {
  NON_WORKING_STATUSES,
  PRINTING_EXTRA_STOPPAGE_FIELDS,
  PRINTING_EXTRA_STOPPAGE_KEYS,
  PRINTING_FORMULAS,
  PRINTING_MAX_ENTRIES,
  PRINTING_STOPPAGE_FIELDS,
  isPrintingProcess,
  isStatusOnly,
  printingDayCalc,
  printingRowCalc,
} from "../../../../../../client/src/utils/printingSheet.js";
import { PRINTING_FIELD_ORDER, PRINTING_MINUTE_KEYS, firstPrintingError, validatePrintingEntry } from "../../../../../../client/src/utils/printingValidation.js";
import { PRINTING_WORDS, firstOverLimit, qtyNotice, stoppageNotice } from "../../../../../../client/src/utils/limitNotice.js";
import { isLiveMessage, slotsFullErrors } from "../../../../../../client/src/utils/entryValidation.js";
import { quantityFormValues } from "../../../../../../client/src/utils/quantityRules.js";
import { hmToWireHours, hoursToShiftInput, parseShiftHours } from "../../../../../../client/src/utils/shiftHours.js";
import { PRINTING_COLUMNS } from "../../../../../../client/src/Components/Production/printingColumns.jsx";
import * as PD from "../../../../../../client/src/utils/processDashboard.js";

const OUT = process.env.OUT_DIR;
if (!OUT) throw new Error("set OUT_DIR");
fs.mkdirSync(OUT, { recursive: true });

// RemarkCell's useLayoutEffect warns under the server renderer; nothing to see.
const consoleError = console.error;
console.error = (...a) => (String(a[0]).includes("useLayoutEffect") ? undefined : consoleError(...a));

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
const rnd = mulberry32(Number(process.env.SEED || 20261026));
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
// What goes over the wire: NaN/undefined disappear the way JSON.stringify drops them.
const wire = (v) => JSON.parse(JSON.stringify(v));
const dropUndefined = (o) => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};

// ── copies of the page's pure handlers (PrintingDataEntry.jsx) ──────────────
const TEXT_FIELDS = ["workingStatus", "itemName", "remarks", "otherMinRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = ["totalCycleSec", "actualQty", "okQty", "plannedOperatorShiftHours", ...PRINTING_STOPPAGE_FIELDS.map((f) => f.key)];

const hasAnyEntryData = (list) =>
  list.some((v) => {
    if (v.machine || v.mcMachine) return true;
    return [...TEXT_FIELDS, ...TIME_FIELDS, ...NUMBER_FIELDS].some((k) => v[k] !== "" && v[k] !== undefined && v[k] !== null);
  });

const emptyEntry = () => ({
  date: isoDay(new Date()),
  machine: "",
  mcMachine: "",
  machineStatus: [],
  workingMode: "Working",
  slot: 1,
  item: "",
  vendor: "",
  vendorName: "",
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, ""])),
});

const toFormValues = (row) => ({
  ...emptyEntry(),
  ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)),
  item: row.item || "",
  vendor: row.vendor || "",
  mcMachine: row.mcMachine || "",
  slot: row.slot,
  actualQty: quantityFormValues(row).actualQty,
  plannedOperatorShiftHours: hoursToShiftInput(row.plannedOperatorShiftHours),
});

const STATUS_ONLY_KEPT = ["workingStatus", "workingMode", "machineStatus", "remarks"];
const toPayload = (v, isEdit, processId) => {
  const body = toFullPayload(v, isEdit, processId);
  if (!isStatusOnly(v) && v.workingMode !== "Non Working") return body;
  return Object.fromEntries(
    Object.entries(body).map(([k, val]) => (["_id", "date", "machine", "process", "slot", ...STATUS_ONLY_KEPT].includes(k) ? [k, val] : [k, k === "item" ? null : ""])),
  );
};
const toFullPayload = (v, isEdit, processId) => ({
  ...(isEdit && v._id ? { _id: v._id } : {}),
  date: v.date,
  machine: v.machine,
  process: processId,
  mcMachine: v.mcMachine || "",
  vendor: v.vendor || "",
  machineStatus: v.workingMode === "Non Working" ? v.machineStatus || [] : [],
  workingMode: v.workingMode || "Working",
  slot: isEdit ? Number(v.slot) : "auto",
  item: v.item || null,
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, String(v[k] ?? "").trim()])),
  otherMinRemark: Number(v.otherMin) > 0 ? String(v.otherMinRemark ?? "").trim() : "",
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, v[k] ?? ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, v[k] === "" || v[k] === undefined ? "" : Number(v[k])])),
  plannedOperatorShiftHours: (() => {
    const { hours } = parseShiftHours(v.plannedOperatorShiftHours);
    return hours === null ? "" : hmToWireHours(hours);
  })(),
  lunchMin: v.lunchMin === "" || v.lunchMin === undefined ? 0 : Number(v.lunchMin),
});
// api/printingSheet.api.js savePrintingRow: { machine, ...row } -> { ...row, worker: machine }
const savePayload = (body) => {
  const { machine, ...row } = body;
  return wire({ ...row, worker: machine });
};

// The form's per-block "has typed work" test (PrintingEntryForm.jsx LINES / DATA_KEYS).
const DOWNTIME_KEYS = PRINTING_STOPPAGE_FIELDS.map((f) => f.key);
const LINES = [
  { id: 1, fields: ["date", "machine", "machineStatus"] },
  { id: 2, fields: ["mcMachine", "itemName", "vendor", "totalCycleSec"] },
  { id: 3, fields: ["machineOnTime", "machineOffTime"] },
  { id: 5, fields: ["actualQty", "okQty"] },
  { id: 7, fields: ["plannedOperatorShiftHours"] },
  { id: 8, fields: [...DOWNTIME_KEYS, "stoppageTotal", "otherMinRemark"] },
  { id: 12, fields: ["remarks"] },
];
const DATA_KEYS = LINES.flatMap((l) => l.fields).filter((k) => !["date", "machine", "stoppageTotal"].includes(k));
const blockHasData = (v) =>
  v.workingMode === "Non Working" || DATA_KEYS.some((k) => (Array.isArray(v[k]) ? v[k].length > 0 : v[k] !== "" && v[k] !== undefined && v[k] !== null));

const withPart = (v, it) => ({ ...v, item: it._id, itemName: it.itemName, totalCycleSec: it.totalCycleSec ?? "" });
const handleItemSelect = (v, itemId, items) => {
  if (!itemId) return { ...v, item: "", itemName: "", totalCycleSec: "" };
  const it = items.find((item) => item._id === itemId);
  if (!it) return { ...v, item: "" };
  return withPart(v, it);
};

// ── value pools ─────────────────────────────────────────────────────────────
const TIMES_OK = ["08:30", "09:00", "09:10", "10:02", "10:30", "9", "930", "0930", "9:30", "9.30", "12:00", "12:30", "15:45", "16:00", "16:05", "17:30", "17:50", "17:55", "23:59", "00:00"];
const TIMES_BAD = ["24:00", "9:5", "abc", "12345", "", "  ", "25", "7:60", null, undefined, 930, 9, "9-30"];
const NUMS = ["", undefined, null, "0", "1", "5", "10", "12.5", 3, 7.5, "  ", "abc", "-4", "1e2", "0x10", "45", 45, "120", "0.5", "600", "1440", "1441"];
const QTY = ["", undefined, null, "0", "10", "50", "96", "100", "240", "465", "874", "3000", 320, 55, "12.5", "-3", "abc", "  ", "99999"];
const STDS = ["7", "11", "10", "20", "22", "21", "6", "5", "8", "38", 7, 12.5, "0", "-1", "abc", "", "1e400"];
const PLANNED = ["", undefined, "8", "8.30", "8.5", "9", "4", "7.45", "8.60", "0", "24", "24.5", "abc", "8,30", 8, 8.5, "1.5", "12", "-1", "3", "5.5", "0.87"];
const ITEMS = ["Label", "Sticker 40", "Carton print", " Tag ", "X"];
const STATUSES = ["", "", "", "PRESENT", "ABSENT", "SUNDAY", "LEAVE", "HOLIDAY", "REPORT NOT FILLUP", " absent ", "present", "W/OFF", "STOCK COUNTING", undefined, null, 7];
const MACHINES = ["mc1", "mc2", ""];

// The sheet's 16 paper rows (utils/printingSheet.test.mjs) — entered the way the form saves them.
const PAPER = [
  ["09:10", "10:02", 7, 240, 240, {}],
  ["10:05", "17:50", 11, 2124, 2124, { lunchMin: 30 }],
  ["09:00", "17:10", 10, 2620, 2620, { lunchMin: 30 }],
  ["17:15", "17:50", 7, 168, 168, {}],
  ["09:10", "12:00", 20, 465, 465, {}],
  ["12:30", "15:45", 22, 500, 500, {}],
  ["10:30", "16:00", 21, 874, 874, { lunchMin: 30 }],
  ["10:30", "16:00", 6, 3000, 3000, { lunchMin: 30 }],
  ["16:05", "17:30", 5, 874, 874, {}],
  ["17:30", "17:50", 5, 100, 100, {}],
  ["08:30", "10:30", 7, 480, 480, {}],
  ["08:35", "09:00", 7, 96, 96, {}],
  ["09:05", "15:45", 20, 1100, 1100, { lunchMin: 30 }],
  ["15:50", "16:45", 20, 90, 90, {}],
  ["16:50", "17:55", 10, 300, 300, {}],
  ["08:30", "09:05", 8, 240, 240, {}],
];
const spanMin = (on, off) => {
  const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return m(off) - m(on);
};
const paperRow = ([on, off, std, total, ok, stops], i, extra = {}) => ({
  _id: `p${i}`,
  machine: "OP1",
  date: "2025-05-14",
  itemName: "Label",
  totalCycleSec: std,
  machineOnTime: on,
  machineOffTime: off,
  actualQty: total,
  okQty: ok,
  plannedOperatorShiftHours: spanMin(on, off) / 60,
  ...stops,
  ...extra,
});

function saneRow(id) {
  const shifts = [["09:00", "17:10"], ["10:30", "16:00"], ["08:30", "10:30"], ["16:05", "17:30"], ["9", "17"], ["0930", "1330"], ["9:30", "18.15"], ["08:30", "17:55"]];
  const [on, off] = pick(shifts);
  const std = pick(["7", "11", "10", "20", "6", "5", "38", 7, "12.5"]);
  const total = int(0, 900);
  const row = {
    _id: id,
    date: "2025-05-14",
    machine: "op" + int(1, 4),
    operator: "Operator " + int(1, 5),
    itemName: pick(ITEMS),
    machineOnTime: on,
    machineOffTime: off,
    totalCycleSec: std,
    actualQty: String(total),
    okQty: String(Math.max(0, total - int(0, 20))),
    plannedOperatorShiftHours: pick([8, 8.5, 9, 12, 4, "8", 7.75, 8.1666667]),
    lunchMin: pick(["0", "20", "30", "45", "", 30]),
    otherMin: pick(["", "0", "5", "15"]),
    remarks: pick(["", "ok", "late start"]),
  };
  for (const k of DOWNTIME_KEYS) if (k !== "lunchMin" && k !== "otherMin" && chance(0.2)) row[k] = String(int(0, 40));
  if (chance(0.3)) row.mcMachine = pick(MACHINES);
  if (chance(0.15)) row.plannedLocked = chance(0.5);
  return row;
}
function junkRow(id) {
  const row = { _id: id };
  if (chance(0.85)) row.itemName = pick([...ITEMS, " ", "", null, undefined, 7]);
  if (chance(0.9)) row.machineOnTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.9)) row.machineOffTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.75)) row.totalCycleSec = pick(STDS);
  if (chance(0.1)) row.cycleTimeSec = pick(NUMS);
  if (chance(0.1)) row.drillingSec = pick(NUMS);
  if (chance(0.85)) row.actualQty = pick(QTY);
  if (chance(0.8)) row.okQty = pick(QTY);
  if (chance(0.2)) row.rejectedQty = pick(QTY);
  if (chance(0.5)) row.plannedOperatorShiftHours = pick([...NUMS, 8.5, 12]);
  for (const k of DOWNTIME_KEYS) if (chance(0.15)) row[k] = pick(NUMS);
  if (chance(0.3)) row.workingStatus = pick(STATUSES);
  if (chance(0.15)) row.workingMode = pick(["Working", "Non Working", "", undefined]);
  if (chance(0.1)) row.runQtyBasis = pick(["ok", "total"]);
  if (chance(0.05)) row.extraStoppageKeys = ["setupMin"];
  return row;
}

// ── printingRowCalc ─────────────────────────────────────────────────────────
const curated = [
  ...PAPER.map((p, i) => paperRow(p, i)),
  // Ideal Quantity unrounded (892.1…) vs its rounded-down cap (892)
  { itemName: "Label", machineOnTime: "08:30", machineOffTime: "17:55", totalCycleSec: 38, actualQty: 893, okQty: 893, lunchMin: 30, plannedOperatorShiftHours: 9.42 },
  // Printing's own three downtime columns count as idle time
  { itemName: "Label", machineOnTime: "10:30", machineOffTime: "16:00", totalCycleSec: 6, actualQty: 2700, okQty: 2700, lunchMin: 30, askQueryQcMin: 10, emptyBagTuggingMin: 10, stockCountingMin: 10, plannedOperatorShiftHours: 5.5 },
  { itemName: "Label", machineOnTime: "10:30", machineOffTime: "16:00", totalCycleSec: 6, actualQty: 2700, okQty: 2690, askQueryQcMin: "abc", emptyBagTuggingMin: "", stockCountingMin: "-5" },
  { itemName: "Label", machineOnTime: "10:30", machineOffTime: "16:00", totalCycleSec: "0", actualQty: 10, okQty: 10 },
  { itemName: "Label", machineOnTime: "10:30", machineOffTime: "16:00", totalCycleSec: "-3", actualQty: 10, okQty: 10 },
  { itemName: "", machineOnTime: "10:30", machineOffTime: "16:00", totalCycleSec: 6, actualQty: 10, okQty: 10 },
  { itemName: "Label", totalCycleSec: 6, actualQty: 10, okQty: 10 },
  { itemName: "Label", machineOnTime: "16:00", machineOffTime: "10:30", totalCycleSec: 6, actualQty: 10, okQty: 10 },
  { itemName: "Label", machineOnTime: "10:30", machineOffTime: "16:00", totalCycleSec: 6, okQty: 10, rejectedQty: 2 },
  { itemName: "Label", machineOnTime: "10:30", machineOffTime: "16:00", totalCycleSec: 6, actualQty: 5, okQty: 10 },
  { itemName: "Label", machineOnTime: "10:30", machineOffTime: "16:00", totalCycleSec: "1e400", actualQty: 5, okQty: 5 },
  {},
];
const rowCases = [...curated];
for (let i = 0; i < 700 * SCALE; i += 1) rowCases.push(chance(0.5) ? saneRow("r" + i) : junkRow("r" + i));
const rowOut = rowCases.map((row) => ({ row: encIn(row), out: enc(printingRowCalc(row)) }));
rowOut.push({ row: null, out: enc(printingRowCalc(null)) });
write("row_calc.json", rowOut);

write(
  "helpers.json",
  {
    statusOnly: rowCases.map((row) => ({ row: encIn(row), statusOnly: isStatusOnly(row) })),
    processes: [
      { dataEntryMenu: "/hqepl/production/printing-data-entry" },
      { dataEntryMenu: "/admin/production/printing-data-entry/" },
      { dataEntryMenu: "/hqepl/production/cnc-data-entry", processName: "PRINTING" },
      { processName: "PRINTING" },
      { processName: "Screen printing line" },
      { processName: "Imprinting" },
      { processName: "printing" },
      { dataEntryMenu: "", processName: "PRINTING 2" },
      {},
      null,
    ].map((p) => ({ process: p, is: isPrintingProcess(p) })),
  },
);

// ── printingDayCalc ─────────────────────────────────────────────────────────
const dayCases = [];
const addDay = (rows) => {
  const sorted = sortByMachineOn(rows);
  dayCases.push({ rows: encIn(rows), order: sorted.map((r) => r && r._id), out: enc(printingDayCalc(sorted)) });
};
addDay([]);
for (let i = 0; i < PAPER.length; i += 1) addDay([paperRow(PAPER[i], i)]);
// SUREKHA 14/05: 10:30–16:00 twice (two jobs at once), then 16:05–17:30 and 17:30–17:50.
addDay(PAPER.slice(6, 10).map((p, i) => paperRow(p, i)));
addDay(PAPER.slice(6, 10).map((p, i) => paperRow(p, i, { plannedLocked: i === 2, plannedOperatorShiftHours: 12 })));
addDay(PAPER.slice(10, 13).map((p, i) => paperRow(p, i, { plannedLocked: true, plannedOperatorShiftHours: 12 })));
addDay([null, paperRow(PAPER[0], 0), null]);
addDay([paperRow(PAPER[7], 7, { askQueryQcMin: 10, emptyBagTuggingMin: 10, stockCountingMin: 10, actualQty: 2700, okQty: 2700 })]);
for (let i = 0; i < 300 * SCALE; i += 1) {
  const n = int(1, 4);
  const rows = [];
  for (let j = 0; j < n; j += 1) {
    const r = chance(0.7) ? saneRow(`d${i}_${j}`) : junkRow(`d${i}_${j}`);
    if (chance(0.4)) r.machineOffTime = pick(TIMES_OK);
    if (chance(0.3)) r.lunchMin = pick(["", "0", "20", "30", 30, "abc"]);
    if (chance(0.3)) r[pick(PRINTING_EXTRA_STOPPAGE_KEYS)] = pick(["", "5", "15", "x", 20]);
    if (chance(0.2)) r.setupMin = pick(["", "5", "15", "x"]);
    rows.push(r);
  }
  addDay(rows);
}
write("day_calc.json", dayCases);

// ── validatePrintingEntry ───────────────────────────────────────────────────
// A fully valid block: 10:30–16:00 at 6 s a piece, 3000 made, 2990 OK, planned 5.5.
const baseValid = () => ({
  date: "2025-05-14",
  machine: "op1",
  mcMachine: "",
  machineStatus: [],
  workingMode: "Working",
  itemName: "Label",
  vendor: "",
  machineOnTime: "10:30",
  machineOffTime: "16:00",
  totalCycleSec: "6",
  actualQty: "3000",
  okQty: "2990",
  plannedOperatorShiftHours: "5.5",
  lunchMin: "30",
  otherMin: "",
  otherMinRemark: "",
  remarks: "",
});
const valMutations = [
  {}, { date: "" }, { date: null }, { date: "  " }, { machine: "" }, { machine: undefined }, { itemName: "" }, { itemName: null }, { itemName: "   " },
  { mcMachine: "mc1" }, { mcMachine: "" }, { mcMachine: undefined },
  { workingMode: "Non Working" }, { workingMode: "Non Working", date: "", machine: "" }, { workingMode: "Non Working", machineStatus: ["No Manpower"] },
  { workingStatus: "ABSENT" }, { workingStatus: "SUNDAY", machine: "" }, { workingStatus: "PRESENT" }, { workingStatus: "present" }, { workingStatus: " LEAVE " }, { workingStatus: "ABSENT", date: "" },
  { workingStatus: "STOCK COUNTING", itemName: "", actualQty: "" }, { workingStatus: 5 }, { workingStatus: null },
  { machineOnTime: "" }, { machineOffTime: "" }, { machineOnTime: "abc" }, { machineOffTime: "25:00" }, { machineOnTime: "9" }, { machineOffTime: "17.30" }, { machineOnTime: "1030" }, { machineOnTime: 10 },
  { machineOnTime: "", machineOffTime: "" }, { machineOnTime: "16:00", machineOffTime: "10:30" }, { machineOnTime: "10:30", machineOffTime: "10:30" }, { machineOnTime: "23:59", machineOffTime: "00:00" },
  { vendor: "v1" }, { vendorName: "Acme" },
  { totalCycleSec: "" }, { totalCycleSec: "0" }, { totalCycleSec: "abc" }, { totalCycleSec: "-3" }, { totalCycleSec: "1" }, { totalCycleSec: 6 }, { totalCycleSec: "  " }, { totalCycleSec: undefined }, { totalCycleSec: "6.6" },
  { actualQty: "" }, { actualQty: undefined }, { actualQty: "abc" }, { actualQty: "-1" }, { actualQty: "  " }, { actualQty: "0", okQty: "0" }, { actualQty: "3300" }, { actualQty: "3301" }, { actualQty: 3000 },
  { actualQty: "12.5", okQty: "10" }, { actualQty: "1e2", okQty: "100" }, { actualQty: "99999" }, { actualQty: "2990" }, { actualQty: "2989" },
  { okQty: "" }, { okQty: undefined }, { okQty: "abc" }, { okQty: "-1" }, { okQty: "3000" }, { okQty: "3001" }, { okQty: "2990.5" }, { okQty: 2990 }, { okQty: "  " },
  { rejectBreakdown: { "Tool Mark": "5" } }, { rejectBreakdown: { Other: "10" }, rejectOtherRemark: "" }, { rejectBreakdown: { x: "-1" } },
  { plannedOperatorShiftHours: "" }, { plannedOperatorShiftHours: undefined }, { plannedOperatorShiftHours: "0" }, { plannedOperatorShiftHours: "-1" }, { plannedOperatorShiftHours: "24" }, { plannedOperatorShiftHours: "24.01" }, { plannedOperatorShiftHours: "25" },
  { plannedOperatorShiftHours: "abc" }, { plannedOperatorShiftHours: "5" }, { plannedOperatorShiftHours: "5.49" }, { plannedOperatorShiftHours: "5.50" }, { plannedOperatorShiftHours: "5.5" }, { plannedOperatorShiftHours: "5,5" },
  { plannedOperatorShiftHours: "5.499" }, { plannedOperatorShiftHours: 5.5 }, { plannedOperatorShiftHours: 12 }, { plannedOperatorShiftHours: "12" }, { plannedOperatorShiftHours: "0.30" },
  { plannedOperatorShiftHours: "9", machineOnTime: "16:00", machineOffTime: "10:30" },
  { machineOnTime: "", plannedOperatorShiftHours: "0.30" }, { machineOffTime: "abc", plannedOperatorShiftHours: "0.30" },
  { lunchMin: "" }, { lunchMin: undefined }, { lunchMin: "0" }, { lunchMin: "abc" }, { lunchMin: "-1" }, { lunchMin: "1440" }, { lunchMin: "1441" }, { lunchMin: "  " }, { lunchMin: 30 }, { lunchMin: "12.5" },
  { lunchMin: "330" }, { lunchMin: "331" },
  { askQueryQcMin: "10" }, { askQueryQcMin: "abc" }, { emptyBagTuggingMin: "-1" }, { stockCountingMin: "1441" }, { stockCountingMin: "300" }, { stockCountingMin: "301" },
  { askQueryQcMin: "100", emptyBagTuggingMin: "100", stockCountingMin: "100" }, { askQueryQcMin: "100", emptyBagTuggingMin: "100", stockCountingMin: "101" },
  { setupMin: "50", lunchMin: "280" }, { plannedDownMin: "400" }, { setupMin: "abc" }, { bdMechMin: "12.5" },
  { otherMin: "5" }, { otherMin: "5", otherMinRemark: "" }, { otherMin: "5", otherMinRemark: "  " }, { otherMin: "5", otherMinRemark: "power cut" }, { otherMin: "0" }, { otherMin: "0", otherMinRemark: "" },
  { otherMin: "abc" }, { otherMin: "-1" }, { otherMin: "1441", otherMinRemark: "r" }, { otherMin: "300", otherMinRemark: "r" }, { otherMin: "301", otherMinRemark: "r" },
  { machineOnTime: "", lunchMin: "5000" }, { machineOnTime: "", otherMin: "9999" },
  { date: "", machine: "", itemName: "" },
  { date: "", machine: "", itemName: "", machineOnTime: "", machineOffTime: "", actualQty: "", okQty: "", plannedOperatorShiftHours: "", lunchMin: "", totalCycleSec: "" },
  { actualQty: "4000", plannedOperatorShiftHours: "0", lunchMin: "-1", otherMin: "9", totalCycleSec: "0" },
];
const valInputs = valMutations.map((m) => dropUndefined({ ...baseValid(), ...m }));
for (let i = 0; i < 320 * SCALE; i += 1) {
  valInputs.push(dropUndefined({ ...baseValid(), ...pick(valMutations), ...pick(valMutations), ...pick(valMutations) }));
}
for (let i = 0; i < 120 * SCALE; i += 1) {
  const r = junkRow("v" + i);
  r.machine = pick(["op1", "", undefined, "  "]);
  r.date = pick(["2025-05-14", "", undefined]);
  valInputs.push(dropUndefined(r));
}
const savedVariants = [
  null,
  { date: "2025-05-14", machine: "op1", machineOnTime: "10:30", machineOffTime: "16:00" },
  { date: "2025-05-14", machine: "op1", machineOnTime: "16:00", machineOffTime: "10:30" },
  { date: "2025-05-14", machine: "op1", machineOnTime: "bad", machineOffTime: "" },
  { date: "2025-05-13", machine: "op1", machineOnTime: "16:00", machineOffTime: "10:30" },
];
const valCases = [];
for (const v of valInputs) {
  const saved = pick(savedVariants);
  const errors = saved ? validatePrintingEntry(v, { saved }) : validatePrintingEntry(v);
  valCases.push({ values: encIn(v), saved, errors });
}
write("validation.json", valCases);

const errLists = [];
for (let i = 0; i < 80; i += 1) {
  const list = [];
  for (let j = 0; j < int(0, 3); j += 1) list.push(pick(valCases).errors);
  if (chance(0.15)) list.push(null);
  errLists.push(list);
}
errLists.push([], [{}], [{ zzz: "x", date: "d" }], [{}, { zzz: "only unknown" }], [{ stockCountingMin: "0–1440", mcMachine: "x", okQty: "y" }]);
write("first_error.json", {
  order: PRINTING_FIELD_ORDER,
  minuteKeys: PRINTING_MINUTE_KEYS,
  cases: errLists.map((list) => ({ errors: list, first: firstPrintingError(list.map((e) => e || {})) })),
});

// ── values / payload ────────────────────────────────────────────────────────
const stored = (extra = {}) => ({
  _id: "e" + int(1, 99999),
  date: "2025-05-14",
  worker: "op1",
  machine: "op1",
  process: "p1",
  operator: "Surekha",
  slot: pick([1, 2, 3, 8]),
  mcMachine: pick([null, "mc1"]),
  mcName: pick(["", "Printer 1"]),
  item: pick(["i1", null]),
  itemName: "Label",
  vendor: pick([null, "v1"]),
  vendorName: pick(["", "Acme"]),
  totalCycleSec: pick([6, 7, 12.5]),
  machineOnTime: "10:30",
  machineOffTime: "16:00",
  actualQty: pick([3000, undefined, null]),
  okQty: pick([2990, 3000, undefined]),
  rejectedQty: pick([10, 0, undefined]),
  plannedOperatorShiftHours: pick([5.5, 8, 7.75, 5.333333, null, 12]),
  plannedLocked: pick([undefined, true, false]),
  lunchMin: pick([30, 0, undefined]),
  askQueryQcMin: pick([undefined, 5]),
  stockCountingMin: pick([undefined, 0, 12]),
  otherMin: pick([undefined, 5]),
  otherMinRemark: pick(["", "power cut"]),
  remarks: pick(["", "ok"]),
  review: pick([undefined, { status: "pending", flagged: [{ metric: "performance", value: 1.2 }] }]),
  workingMode: pick([undefined, "Non Working"]),
  machineStatus: pick([undefined, ["No Manpower"]]),
  workingStatus: pick([undefined, "", "ABSENT"]),
  unlockedUntil: null,
  ...extra,
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
    const values = {
      ...v,
      _id: pick([undefined, "e1", ""]),
      slot: pick([1, 2, 8, "2", undefined, "abc"]),
      item: pick(["", "i1", undefined]),
      mcMachine: pick(["", "mc1", undefined, v.mcMachine]),
      vendor: pick(["", "v1", undefined]),
    };
    dropUndefined(values);
    const processId = pick(["p1", "p2"]);
    payloadCases.push({ values: encIn(values), isEdit, processId, payload: savePayload(toPayload(values, isEdit, processId)) });
  }
}
for (const extra of [{ workingStatus: "ABSENT" }, { workingMode: "Non Working", machineStatus: ["No Manpower", "Machine Breakdown"] }, { workingStatus: "SUNDAY", remarks: " note " }]) {
  for (const isEdit of [false, true]) {
    const values = { ...baseValid(), ...extra, item: "i1", vendor: "v1", mcMachine: "mc1", askQueryQcMin: "5", _id: "e9", slot: 2 };
    payloadCases.push({ values: encIn(values), isEdit, processId: "p1", payload: savePayload(toPayload(values, isEdit, "p1")) });
  }
}
write("payload.json", payloadCases);

const dataCases = [];
const dataInputs = [
  ...valInputs.slice(0, 60),
  emptyEntry(),
  { ...emptyEntry(), machine: "op1" },
  { ...emptyEntry(), mcMachine: "mc1" },
  { ...emptyEntry(), workingMode: "Non Working" },
  { ...emptyEntry(), machineStatus: ["No Planning"] },
  { ...emptyEntry(), workingStatus: "ABSENT" },
  { ...emptyEntry(), remarks: "x" },
  { ...emptyEntry(), lunchMin: "0" },
  { ...emptyEntry(), stockCountingMin: "0" },
  { ...emptyEntry(), vendor: "v1" },
  { ...emptyEntry(), slot: 3 },
];
for (const v of dataInputs) dataCases.push({ values: encIn(v), blockHasData: blockHasData(v), anyData: hasAnyEntryData([v]) });
dataCases.push({ list: [encIn(emptyEntry()), encIn({ ...emptyEntry(), machine: "op1" })], anyData: true });
dataCases.push({ list: [encIn(emptyEntry()), encIn(emptyEntry())], anyData: false });
write("has_data.json", dataCases);

const items = [
  { _id: "i1", itemName: "Label", totalCycleSec: 6, process: "p1" },
  { _id: "i2", itemName: "Tag", totalCycleSec: null },
  { _id: "i3", itemName: "Carton", totalCycleSec: "" },
  { _id: "i4", itemName: "Sticker", totalCycleSec: 12.5 },
];
const itemCases = [];
for (const id of ["", "i1", "i2", "i3", "i4", "nope"]) {
  const v = dropUndefined({ ...baseValid(), item: "iX", itemName: "Old", totalCycleSec: "99" });
  itemCases.push({ values: encIn(v), itemId: id, out: enc(handleItemSelect(v, id, items)) });
}
write("item_select.json", { items, cases: itemCases });

write("formulas.json", PRINTING_FORMULAS);
write("fields.json", {
  extra: PRINTING_EXTRA_STOPPAGE_FIELDS,
  extraKeys: PRINTING_EXTRA_STOPPAGE_KEYS,
  stoppage: PRINTING_STOPPAGE_FIELDS,
  nonWorking: NON_WORKING_STATUSES,
  workingStatuses: WORKING_STATUSES,
  maxEntries: PRINTING_MAX_ENTRIES,
  words: PRINTING_WORDS,
});

// ── limit popups ────────────────────────────────────────────────────────────
// Save on an incomplete entry: the page's call (TOTAL QTY over Ideal, or the 13
// downtime columns over the Machine Shift Time), operators named by id.
const overCases = [];
const overNames = { op1: "Surekha", op2: "Ravi" };
const overBlock = () => {
  const b = dropUndefined({ ...baseValid(), ...pick(valMutations), machine: pick(["op1", "op2", "op9"]) });
  if (chance(0.7)) {
    b.machineOnTime = pick(["10:30", "09:00", "08:30"]);
    b.machineOffTime = pick(["11:00", "12:30", "16:00", "10:30"]);
    b.totalCycleSec = pick(["6", "20", "38", ""]);
    b.lunchMin = pick(["", "0", "30", "45", "70"]);
    b.askQueryQcMin = pick(["", "0", "20", "200"]);
    b.otherMin = pick(["", "0", "10", "40"]);
    b.otherMinRemark = pick(["", "why"]);
    b.actualQty = pick(["", "100", "3000", "99999"]);
    b.okQty = pick(["", "100", "50"]);
  }
  return b;
};
for (let i = 0; i < 160 * SCALE; i += 1) {
  const blocks = Array.from({ length: int(1, 3) }, overBlock);
  const errors = blocks.map((b) => validatePrintingEntry(b));
  const out = firstOverLimit(blocks, errors, printingRowCalc, { qtyKey: "actualQty", qtyLabel: "TOTAL QTY", words: PRINTING_WORDS, machineName: overNames });
  overCases.push({ blocks: encIn(blocks), errors: encIn(errors), machineName: overNames, out: enc(out) });
}
write("first_over_limit.json", overCases);

// The popups a blocked keystroke raises (PrintingEntryForm / QuantityMaster).
const noticeCases = [];
for (const b of [baseValid(), { ...baseValid(), machineOnTime: "08:30", machineOffTime: "17:55", totalCycleSec: "38" }, { ...baseValid(), machineOffTime: "11:00" }]) {
  const calc = printingRowCalc(b);
  for (const entered of [3301, 893, 1000.5]) noticeCases.push({ kind: "qty", values: b, entered, out: qtyNotice({ calc, entered, label: "TOTAL QTY", words: PRINTING_WORDS }) });
  for (const [limitMin, totalMin] of [[330, 331], [30, 45.5], [565, 600]]) noticeCases.push({ kind: "stoppage", limitMin, totalMin, out: stoppageNotice({ limitMin, totalMin, words: PRINTING_WORDS }) });
}
write("notices.json", noticeCases);

// ── slotsFullErrors (max 8) and isLiveMessage ───────────────────────────────
const slotCases = [];
const taken = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ slot: i + 1, machineOnTime: "10:30", machineOffTime: "16:00", ...extra }));
const who = (id) => ({ op1: "Surekha", op2: "" })[id] || "This operator";
for (const n of [0, 6, 7, 8, 9]) {
  for (const formBlocks of [1, 2, 3]) {
    const entries = Array.from({ length: formBlocks }, (_, i) => ({ date: "2025-05-14", machine: i === 2 ? "op2" : "op1" }));
    const occupied = { "op1|2025-05-14": taken(n), "op2|2025-05-14": taken(8) };
    slotCases.push({ entries, occupied, editSlot: null, saved: null, out: slotsFullErrors(entries, occupied, { who, max: PRINTING_MAX_ENTRIES }) });
  }
  // Editing: the row itself isn't "another" entry on its own date; moved to a full date it is refused.
  for (const date of ["2025-05-14", "2025-05-15"]) {
    const entries = [{ date, machine: "op1" }];
    const occupied = { "op1|2025-05-14": taken(n), "op1|2025-05-15": taken(n) };
    const saved = { date: "2025-05-14", machine: "op1", machineOnTime: "10:30", machineOffTime: "16:00" };
    slotCases.push({ entries, occupied, editSlot: 2, saved, out: slotsFullErrors(entries, occupied, { editSlot: 2, saved, who, max: PRINTING_MAX_ENTRIES }) });
  }
}
slotCases.push({ entries: [{ date: "", machine: "op1" }, { date: "2025-05-14", machine: "" }], occupied: {}, editSlot: null, saved: null, out: slotsFullErrors([{ date: "", machine: "op1" }, { date: "2025-05-14", machine: "" }], {}, { who, max: 8 }) });
const liveMessages = [
  "Machine OFF Time must be after Machine ON Time",
  "Enter a valid time",
  "Surekha already has 8 entries on 14/05/2025 — edit one of them instead",
  "This operator already has 8 entries on 15/05/2025 — can't move this entry there",
  "Planned Operator Shift can't be less than the Machine Shift (5:30)",
  "Item Name is required",
  "0–1440",
  "already has entries",
];
write("slots_full.json", { cases: slotCases, live: liveMessages.map((m) => ({ message: m, live: isLiveMessage(m) })) });

// ── the table's cells (printingColumns.jsx, rendered to text) ───────────────
const textOf = (v) => {
  if (v === null || v === undefined || v === false) return { text: "", eye: false };
  if (!React.isValidElement(v)) return { text: String(v), eye: false };
  const html = renderToStaticMarkup(v);
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
  return { text, eye: html.includes('aria-label="View remarks"') };
};
const tableColumns = PRINTING_COLUMNS.flatMap((c) => (c.expandable ? [c.summary, ...c.columns] : [c]));
const operatorNames = { op1: "Surekha", op2: "Ravi", op3: "", OP1: "Operator One" };
const tableRows = [];
for (let i = 0; i < 160 * SCALE; i += 1) {
  const r = chance(0.6) ? saneRow("t" + i) : junkRow("t" + i);
  r.date = pick(["2025-05-14", "2025-05-15"]);
  r.machine = pick(["op1", "op2", "op3", "op9"]);
  if (chance(0.7)) r.operator = pick(["Surekha", "Ravi", "", "Old Name"]);
  if (chance(0.4)) {
    r.mcMachine = pick(["mc1", "", null]);
    r.mcName = pick(["Printer 1", "", undefined]);
  }
  if (chance(0.2)) r.vendorName = pick(["Acme", ""]);
  if (chance(0.25)) r.workingMode = pick(["Non Working", "Working"]);
  if (chance(0.25)) r.machineStatus = pick([[], ["No Manpower"], ["Machine Breakdown", "No Planning"]]);
  if (chance(0.3)) r.otherMin = pick(["", "0", "5", 12]);
  if (chance(0.3)) r.otherMinRemark = pick(["", "power cut"]);
  if (chance(0.3)) r.remarks = pick(["", "smudged print"]);
  if (chance(0.2)) r.review = pick([{ status: "pending" }, { status: "approved", decidedBy: { name: "Admin" } }, { status: "rejected" }, { status: "other" }]);
  tableRows.push(dropUndefined(r));
}
tableRows.push(...PAPER.map((p, i) => paperRow(p, i, { _id: "tp" + i, machine: "op1", operator: "Surekha" })));
const dayByKey = {};
{
  const groups = {};
  for (const r of tableRows) (groups[`${r.machine}|${r.date}`] ||= []).push(r);
  for (const group of Object.values(groups)) {
    const sorted = sortByMachineOn(group);
    const results = printingDayCalc(sorted);
    sorted.forEach((r, i) => {
      dayByKey[r._id] = results[i];
    });
  }
}
const ctx = { machineName: operatorNames };
write("table_cells.json", {
  keys: tableColumns.map((c) => c.key),
  labels: tableColumns.map((c) => c.label),
  machineName: operatorNames,
  rows: tableRows.map((r) => {
    const c = printingRowCalc(r);
    const d = dayByKey[r._id] || {};
    const cells = {};
    for (const col of tableColumns) cells[col.key] = textOf(col.get(r, c, d, ctx));
    return { row: encIn(r), cells };
  }),
});

// ── dashboard: Printing's own causes (utils/processDashboard.js) ────────────
// Rows as the dashboard feed sends them: server DASHBOARD_SHEETS adds the flags.
const flags = { runQtyBasis: "total", calcMode: "perEntry", extraStoppageKeys: PRINTING_EXTRA_STOPPAGE_KEYS };
const feedRows = (n, machineIds) =>
  Array.from({ length: n }, (_, i) => {
    const r = saneRow("f" + i + "_" + int(1, 1e6));
    r.machine = pick(machineIds);
    r.date = pick(["2025-05-13", "2025-05-14", "2025-05-15"]);
    for (const k of PRINTING_EXTRA_STOPPAGE_KEYS) if (chance(0.5)) r[k] = int(0, 30);
    return { ...r, ...flags };
  });
const plainRows = (n) =>
  Array.from({ length: n }, (_, i) => {
    const r = saneRow("m" + i);
    r.machine = pick(["m1", "m2"]);
    for (const k of PRINTING_EXTRA_STOPPAGE_KEYS) delete r[k];
    delete r.plannedLocked;
    return r;
  });
const scenarios = {
  paper: [
    {
      date: "2025-05-13", machine: "OP1", slot: 1, machineOnTime: "09:00", machineOffTime: "17:10",
      plannedOperatorShiftHours: 8 + 10 / 60, totalCycleSec: 10, actualQty: 2620, okQty: 2620,
      lunchMin: 30, askQueryQcMin: 5, emptyBagTuggingMin: 7, stockCountingMin: 3, itemName: "Label", ...flags,
    },
  ],
  printing: feedRows(40, ["op1", "op2", "op3"]),
  locked: feedRows(12, ["op1"]).map((r) => ({ ...r, plannedLocked: true, plannedOperatorShiftHours: 12 })),
  mixed: [...plainRows(20), ...feedRows(15, ["op1", "op2"])],
  machines: plainRows(25),
};
const dashboard = {
  causeFields: PD.CAUSE_FIELDS,
  stoppageGroups: PD.STOPPAGE_GROUPS,
  causeLabels: [...PD.CAUSE_FIELDS.map((f) => f.key), "nope"].map((k) => [k, PD.causeLabel(k)]),
  stoppageKeysPrinting: PD.stoppageKeysFor({ processName: "PRINTING", dataEntryMenu: "/hqepl/production/printing-data-entry" }),
  stoppageKeysNone: PD.stoppageKeysFor(null),
  stoppageKeysCnc: PD.stoppageKeysFor({ processName: "CNC", dataEntryMenu: "/hqepl/production/cnc-data-entry" }),
  isWorkerPrinting: PD.isWorkerProcess({ processName: "PRINTING" }),
  scenarios: Object.fromEntries(
    Object.entries(scenarios).map(([name, rows]) => [
      name,
      {
        rows: encIn(rows),
        summary: enc(PD.summarize(rows)),
        causes: enc(PD.CAUSE_FIELDS.map((f) => PD.causeMeasure(f.key)).map((m) => ({ key: m.key, label: m.label, value: m.get(PD.summarize(rows)) }))),
      },
    ]),
  ),
};
write("dashboard.json", dashboard);

console.log("ok", { rows: rowOut.length, days: dayCases.length, validation: valCases.length, payload: payloadCases.length, table: tableRows.length });
