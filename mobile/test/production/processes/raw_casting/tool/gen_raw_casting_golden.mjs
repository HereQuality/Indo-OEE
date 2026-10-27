// Golden-fixture generator for test/production/processes/raw_casting/*.
//
// Runs the REAL client/src/utils/rawCastingSheet.js + rawCastingValidation.js
// (and the shared productionSheet.js / entryValidation.js / limitNotice.js /
// shiftHours.js / processDashboard.js they import) and the REAL table columns
// (Components/Production/rawCastingColumns.jsx, rendered to text) over a broad,
// deterministic (seeded) input set. client/ is only READ.
//
//   cd mobile
//   ESB=../client/node_modules/.bin/esbuild
//   NODE_PATH=../client/node_modules $ESB test/production/processes/raw_casting/tool/gen_raw_casting_golden.mjs --bundle \
//        --platform=node --format=esm --loader:.js=jsx --jsx=automatic --log-level=error --define:import.meta.env={} \
//        --banner:js="import {createRequire} from 'module';const require=createRequire(import.meta.url);" \
//        --outfile=<scratch>/rc-golden/gen.mjs
//   OUT_DIR=test/production/processes/raw_casting/fixtures TZ=Asia/Kolkata node <scratch>/rc-golden/gen.mjs
//
// NaN/Infinity/undefined are written as {"$n":"NaN"|"Inf"|"-Inf"} and {"$u":1}.

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isoDay, remarkParts, sortByMachineOn } from "../../../../../../client/src/utils/productionSheet.js";
import {
  RAW_CASTING_DEFECTS,
  RAW_CASTING_FORMULAS,
  RAW_CASTING_IDLE_FIELDS,
  RAW_CASTING_MAX_ENTRIES_PER_DAY,
  NON_WORKING_STATUSES,
  defectTotal,
  isRawCastingProcess,
  isStatusOnly,
  rawCastingDayCalc,
  rawCastingRowCalc,
} from "../../../../../../client/src/utils/rawCastingSheet.js";
import {
  RAW_CASTING_FIELD_ORDER,
  RAW_CASTING_MINUTE_KEYS,
  firstRawCastingError,
  validateRawCastingEntry,
} from "../../../../../../client/src/utils/rawCastingValidation.js";
import { WORKER_WORDS, firstOverLimit } from "../../../../../../client/src/utils/limitNotice.js";
import { cleanSplit, slotsFullErrors } from "../../../../../../client/src/utils/entryValidation.js";
import { hmToWireHours, hoursToShiftInput, parseShiftHours } from "../../../../../../client/src/utils/shiftHours.js";
import { isWorkerProcess, stoppageKeysFor, summarize } from "../../../../../../client/src/utils/processDashboard.js";
import { RAW_CASTING_COLUMNS } from "../../../../../../client/src/Components/Production/rawCastingColumns.jsx";

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
// What goes over the wire: NaN/undefined disappear the way JSON.stringify drops them.
const wire = (v) => JSON.parse(JSON.stringify(v));
const dropUndefined = (o) => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};

// A table cell as the person reads it: React output rendered, tags stripped.
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'", "&nbsp;": " " };
const cellText = (v) => {
  if (v === null || v === undefined || typeof v === "boolean") return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null, v));
  return html.replace(/<[^>]*>/g, "").replace(/&[#\w]+;/g, (m) => ENTITIES[m] ?? m);
};


// ── copies of the page's pure handlers (RawCastingDataEntry.jsx) ────────────
const TEXT_FIELDS = ["workingStatus", "itemName", "challanNo", "otherActivity", "remarks", "otherMinRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = ["totalCycleSec", "actualQty", "otherActivityMin", "plannedOperatorShiftHours", "lunchMin", "otherMin"];
const hasDefects = (v) => Object.values(v.rejectBreakdown || {}).some((n) => n !== "" && n !== undefined && n !== null);
const hasAnyEntryData = (list) =>
  list.some((v) => {
    if (v.machine) return true;
    if (hasDefects(v)) return true;
    return [...TEXT_FIELDS, ...TIME_FIELDS, ...NUMBER_FIELDS].some((k) => v[k] !== "" && v[k] !== undefined && v[k] !== null);
  });
const emptyEntry = () => ({
  date: isoDay(new Date()), machine: "", machineStatus: [], workingMode: "Working", slot: 1, item: "", vendor: "", vendorName: "", rejectBreakdown: {},
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
  rejectBreakdown: Object.fromEntries(RAW_CASTING_DEFECTS.filter((d) => row.rejectBreakdown?.[d] != null).map((d) => [d, String(row.rejectBreakdown[d])])),
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
  rejectBreakdown: cleanSplit(v.rejectBreakdown),
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
const FORM_DATA_KEYS = ["machineStatus", "itemName", "vendor", "challanNo", "totalCycleSec", "machineOnTime", "machineOffTime", "actualQty", "otherActivity", "otherActivityMin", "plannedOperatorShiftHours", "lunchMin", "otherMin", "otherMinRemark", "remarks"];
const blockHasData = (v) =>
  v.workingMode === "Non Working" ||
  FORM_DATA_KEYS.some((k) => (Array.isArray(v[k]) ? v[k].length > 0 : v[k] !== "" && v[k] !== undefined && v[k] !== null)) ||
  Object.values(v.rejectBreakdown || {}).some((n) => n !== "" && n !== undefined && n !== null);
const withPart = (v, it) => ({ ...v, item: it._id, itemName: it.itemName, totalCycleSec: it.totalCycleSec ?? "" });
const handleItemSelect = (v, itemId, items) => {
  if (!itemId) return { ...v, item: "", itemName: "", totalCycleSec: "" };
  const it = items.find((item) => item._id === itemId);
  if (!it) return { ...v, item: "" };
  return withPart(v, it);
};

// ── value pools ─────────────────────────────────────────────────────────────
const TIMES_OK = ["06:00", "08:15", "9", "930", "0930", "9:30", "9.30", "10:10", "12:30", "14:30", "16:00", "16:30", "18:50", "19:00", "23:59", "00:00"];
const TIMES_BAD = ["24:00", "9:5", "abc", "12345", "", "  ", "25", "7:60", null, undefined, 930, 9, "9-30"];
const NUMS = ["", undefined, null, "0", "1", "5", "10", "12.5", 3, 7.5, "  ", "abc", "-4", "1e2", "45", 45, "120", "600", "1440", "1441"];
const QTY = ["", undefined, null, "0", "10", "218", "340", "686", "799", 320, 55, "12.5", "-3", "abc", "  ", "9999"];
const DEF = ["", undefined, null, "0", "1", "2", "5", 3, "0.5", "-1", "abc", "  ", "40"];
const STD = ["30", "36", "32", "25", "38", 30, "12.5", "0", "-2", "abc", "", "3600"];
const ITEMS = ["24 PIN B/O(M)", "3 PIN B/O S/C,MS", " Cap ", "X"];
const STATUSES = ["", "", "", "PRESENT", "ABSENT", "SUNDAY", "LEAVE", "HOLIDAY", " absent ", "present", "W/OFF", undefined, null, 7];
const DEFECT_NAMES = [...RAW_CASTING_DEFECTS, "Tool Mark", "Weird"];

const defectsFor = (total) => {
  const o = {};
  let left = Math.floor(total / 10);
  for (const d of RAW_CASTING_DEFECTS) {
    if (chance(0.4)) continue;
    const q = int(0, left);
    if (q) o[d] = chance(0.5) ? String(q) : q;
    left -= q;
  }
  return o;
};
function saneRow(id) {
  const shifts = [["12:30", "14:30"], ["08:15", "16:00"], ["16:00", "19:00"], ["10:10", "16:30"], ["16:10", "18:50"], ["08:00", "12:00"], ["930", "1330"]];
  const [on, off] = pick(shifts);
  const total = int(0, 900);
  const row = {
    _id: id, date: "2024-05-10", machine: "w" + int(1, 4), operator: "Worker " + int(1, 5), itemName: pick(ITEMS), challanNo: pick(["", "DC/28", "105"]),
    machineOnTime: on, machineOffTime: off, totalCycleSec: pick(["30", "36", "32", "25", 30, "12.5"]), actualQty: String(total),
    plannedOperatorShiftHours: pick([1.82, 3, 7.75, 12, 2.666667, "7.75", 8]),
    lunchMin: pick(["0", "30", "", 30]), otherMin: pick(["", "0", "5", "15"]), otherActivityMin: pick(["", "0", "10", "25"]),
    remarks: pick(["", "ok", "late start"]),
  };
  if (chance(0.7)) row.rejectBreakdown = defectsFor(total);
  if (chance(0.2)) row.plannedLocked = true;
  return row;
}
function junkRow(id) {
  const row = { _id: id };
  if (chance(0.85)) row.itemName = pick([...ITEMS, " ", "", null, undefined, 7]);
  if (chance(0.9)) row.machineOnTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.9)) row.machineOffTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.8)) row.totalCycleSec = pick([...STD, ...NUMS]);
  if (chance(0.85)) row.actualQty = pick(QTY);
  if (chance(0.3)) row.okQty = pick(QTY);
  if (chance(0.25)) row.rejectedQty = pick(QTY);
  if (chance(0.5)) {
    row.rejectBreakdown = {};
    for (const d of DEFECT_NAMES) if (chance(0.4)) row.rejectBreakdown[d] = pick(DEF);
  }
  if (chance(0.5)) row.plannedOperatorShiftHours = pick([...NUMS, 7.75, 12]);
  for (const k of ["lunchMin", "otherMin", "otherActivityMin"]) if (chance(0.5)) row[k] = pick(NUMS);
  for (const k of ["setupMin", "bdMechMin", "noPowerMin"]) if (chance(0.08)) row[k] = pick(NUMS);
  if (chance(0.2)) row.plannedLocked = pick([true, false, "true"]);
  if (chance(0.3)) row.workingStatus = pick(STATUSES);
  if (chance(0.15)) row.workingMode = pick(["Working", "Non Working", "", undefined]);
  return row;
}

// ── rowCalc ─────────────────────────────────────────────────────────────────
const curated = [
  { itemName: "24 PIN B/O(M)", machineOnTime: "12:30", machineOffTime: "14:30", totalCycleSec: 30, actualQty: 218, rejectBreakdown: { Other: 3 }, plannedOperatorShiftHours: 2 },
  { itemName: "24 PIN B/O D/C,P/C", machineOnTime: "08:15", machineOffTime: "16:00", totalCycleSec: 36, actualQty: 686, rejectBreakdown: { "Blow Holes Casting": 5, "Crack/Damage Casting": 13 }, lunchMin: 30, plannedOperatorShiftHours: 7.75 },
  { itemName: "X", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "", rejectBreakdown: { Other: "3" } },
  { itemName: "X", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", rejectBreakdown: { Other: "3" } },
  { itemName: "X", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "10", rejectBreakdown: { Other: "20" } },
  { itemName: "X", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "abc", rejectBreakdown: { Other: "2" } },
  { itemName: "X", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "0", actualQty: "10" },
  { itemName: "", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "10" },
  { itemName: "X", machineOnTime: "22:00", machineOffTime: "06:00", totalCycleSec: "36", actualQty: "700", plannedOperatorShiftHours: 9 },
  { itemName: "X", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "5", rejectedQty: "1" },
  {},
];
const rowCases = [...curated];
for (let i = 0; i < 700 * SCALE; i += 1) rowCases.push(chance(0.5) ? saneRow("r" + i) : junkRow("r" + i));
const rowOut = rowCases.map((row) => ({ row: encIn(row), out: enc(rawCastingRowCalc(row)) }));
rowOut.push({ row: null, out: enc(rawCastingRowCalc(null)) });
write("row_calc.json", rowOut);

write("helpers.json", {
  rows: rowCases.map((row) => ({ row: encIn(row), statusOnly: isStatusOnly(row), defectTotal: enc(defectTotal(row)) })),
  defects: RAW_CASTING_DEFECTS,
  idleFields: RAW_CASTING_IDLE_FIELDS,
  maxEntriesPerDay: RAW_CASTING_MAX_ENTRIES_PER_DAY,
  nonWorking: NON_WORKING_STATUSES,
  words: WORKER_WORDS,
  processes: [
    { processName: "RAW CASTING" }, { processName: "raw  casting line" }, { processName: "Rawcasting" }, { processName: "Raw Casting Inspection" },
    { processName: "Anything", dataEntryMenu: "/hqepl/production/raw-casting-data-entry" },
    { processName: "Anything", dataEntryMenu: "/hqepl/production/raw-casting-data-entry/" },
    { processName: "RAW CASTING", dataEntryMenu: "/hqepl/production/cnc-data-entry" },
    { processName: "CNC" }, {},
  ].map((p) => ({ process: p, isRaw: isRawCastingProcess(p) })),
});

// ── dayCalc ─────────────────────────────────────────────────────────────────
const dayCases = [];
const addDay = (rows) => {
  const sorted = sortByMachineOn(rows);
  dayCases.push({ rows: encIn(rows), order: sorted.map((r) => r && r._id), out: enc(rawCastingDayCalc(sorted)) });
};
const mk = (id, on, off, extra = {}) => ({ _id: id, itemName: "X", machineOnTime: on, machineOffTime: off, totalCycleSec: "30", actualQty: "100", plannedOperatorShiftHours: 4, ...extra });
addDay([]);
addDay([mk("a", "10:10", "16:30", { lunchMin: 30 }), mk("b", "16:10", "18:50")]);
addDay([mk("a", "08:00", "12:00", { plannedLocked: true, plannedOperatorShiftHours: 12 }), mk("b", "12:00", "16:00")]);
addDay([mk("a", "08:00", "12:00", { lunchMin: "30", otherMin: "6", otherActivityMin: "20" })]);
addDay([mk("a", "", "10:00"), mk("b", "06:00", "10:00"), mk("c", "abc", "")]);
addDay([null, mk("a", "08:00", "16:00"), null]);
addDay([mk("a", "08:00", "16:00", { plannedOperatorShiftHours: "" })]);
for (let i = 0; i < 300 * SCALE; i += 1) {
  const rows = [];
  for (let j = 0; j < int(1, 6); j += 1) {
    const r = chance(0.7) ? saneRow(`d${i}_${j}`) : junkRow(`d${i}_${j}`);
    if (chance(0.5)) r.machineOffTime = pick(TIMES_OK);
    rows.push(r);
  }
  addDay(rows);
}
write("day_calc.json", dayCases);

// ── validateRawCastingEntry ─────────────────────────────────────────────────
const baseValid = () => ({
  date: "2024-05-10", machine: "w1", machineStatus: [], workingMode: "Working", itemName: "24 PIN B/O D/C,P/C", vendor: "", challanNo: "DC/28",
  machineOnTime: "08:15", machineOffTime: "16:00", totalCycleSec: "36", actualQty: "686",
  rejectBreakdown: { "Blow Holes Casting": "5", "Crack/Damage Casting": "13" },
  otherActivity: "", otherActivityMin: "", plannedOperatorShiftHours: "7.75", lunchMin: "30", otherMin: "", otherMinRemark: "", remarks: "",
});
const valMutations = [
  {}, { date: "" }, { date: null }, { machine: "" }, { machine: undefined }, { itemName: "" }, { itemName: "   " },
  { workingMode: "Non Working" }, { workingMode: "Non Working", date: "", machine: "" }, { workingMode: "Non Working", machineStatus: ["No Manpower"] },
  { workingStatus: "ABSENT" }, { workingStatus: "SUNDAY", machine: "" }, { workingStatus: "PRESENT" }, { workingStatus: " LEAVE " }, { workingStatus: 5 }, { workingStatus: null },
  { machineOnTime: "" }, { machineOffTime: "" }, { machineOnTime: "abc" }, { machineOffTime: "25:00" }, { machineOnTime: "9" }, { machineOffTime: "17.30" }, { machineOnTime: 8 },
  { machineOnTime: "22:00", machineOffTime: "06:00" }, { machineOnTime: "08:00", machineOffTime: "08:00" }, { machineOnTime: "23:59", machineOffTime: "00:00" },
  { vendor: "v1" }, { vendorName: "Acme" }, { challanNo: "" }, { challanNo: "  x  " },
  { totalCycleSec: "" }, { totalCycleSec: "0" }, { totalCycleSec: "abc" }, { totalCycleSec: "-3" }, { totalCycleSec: 36 }, { totalCycleSec: undefined },
  { actualQty: "" }, { actualQty: undefined }, { actualQty: "abc" }, { actualQty: "-1" }, { actualQty: "12.5" }, { actualQty: "1e2" }, { actualQty: 686 }, { actualQty: "9999" }, { actualQty: "10" }, { actualQty: "0", rejectBreakdown: {} },
  { rejectBreakdown: {} }, { rejectBreakdown: { Other: "abc" } }, { rejectBreakdown: { Other: "-1" } }, { rejectBreakdown: { Other: "2.5" } }, { rejectBreakdown: { Other: "700" } },
  { rejectBreakdown: { "Blow Holes Casting": "343", "Crack/Damage Casting": "343" } }, { rejectBreakdown: { "Blow Holes Casting": "343", "Crack/Damage Casting": "344" } },
  { rejectBreakdown: { "Tool Mark": "9999" } }, { rejectBreakdown: { Other: "" } }, { actualQty: "", rejectBreakdown: { Other: "50" } },
  { plannedOperatorShiftHours: "" }, { plannedOperatorShiftHours: "0" }, { plannedOperatorShiftHours: "24" }, { plannedOperatorShiftHours: "24.01" }, { plannedOperatorShiftHours: "abc" },
  { plannedOperatorShiftHours: "7.5" }, { plannedOperatorShiftHours: "7.74" }, { plannedOperatorShiftHours: "8,30" }, { plannedOperatorShiftHours: 7.75 }, { plannedOperatorShiftHours: "12" },
  { plannedOperatorShiftHours: "9", machineOnTime: "22:00", machineOffTime: "06:00" },
  { lunchMin: "" }, { lunchMin: "abc" }, { lunchMin: "-1" }, { lunchMin: "1441" }, { lunchMin: 30 }, { lunchMin: "12.5" }, { lunchMin: "465" }, { lunchMin: "466" },
  { otherActivityMin: "10" }, { otherActivityMin: "10", otherActivity: "Filing" }, { otherActivityMin: "0" }, { otherActivityMin: "abc" }, { otherActivityMin: "-1" }, { otherActivityMin: "1441" },
  { otherActivityMin: "430", otherActivity: "x" }, { otherActivityMin: "436", otherActivity: "x" }, { otherActivityMin: "437", otherActivity: "x" },
  { otherMin: "5" }, { otherMin: "5", otherMinRemark: "  " }, { otherMin: "5", otherMinRemark: "power cut" }, { otherMin: "abc" }, { otherMin: "-1" },
  { machineOnTime: "", lunchMin: "5000" }, { noPowerMin: "500" }, { setupMin: "500" },
  { date: "", machine: "", itemName: "" },
  { date: "", machine: "", itemName: "", machineOnTime: "", machineOffTime: "", actualQty: "", plannedOperatorShiftHours: "", lunchMin: "", totalCycleSec: "" },
];
const valInputs = valMutations.map((m) => dropUndefined({ ...baseValid(), ...m }));
for (let i = 0; i < 360 * SCALE; i += 1) valInputs.push(dropUndefined({ ...baseValid(), ...pick(valMutations), ...pick(valMutations), ...pick(valMutations) }));
for (let i = 0; i < 140 * SCALE; i += 1) {
  const r = junkRow("v" + i);
  r.machine = pick(["w1", "", undefined, "  "]);
  r.date = pick(["2024-05-10", "", undefined]);
  valInputs.push(dropUndefined(r));
}
const savedVariants = [null, { date: "2024-05-10", machine: "w1", machineOnTime: "08:15", machineOffTime: "16:00" }, { date: "2024-05-10", machine: "w1", machineOnTime: "9", machineOffTime: "8" }, { machineOnTime: "bad", machineOffTime: "" }];
const valCases = [];
for (const v of valInputs) {
  const saved = pick(savedVariants);
  valCases.push({ values: encIn(v), saved, errors: saved ? validateRawCastingEntry(v, { saved }) : validateRawCastingEntry(v) });
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
  order: RAW_CASTING_FIELD_ORDER,
  minuteKeys: RAW_CASTING_MINUTE_KEYS,
  cases: errLists.map((list) => ({ errors: list, first: firstRawCastingError(list.map((e) => e || {})) })),
});

// ── values / payload ────────────────────────────────────────────────────────
const stored = (extra = {}) => ({
  _id: "e" + int(1, 99999), date: "2024-05-10", worker: "w1", machine: "w1", process: "p1", operator: "MANJU", slot: pick([1, 2, 3, 8]),
  item: pick(["i1", null]), itemName: "24 PIN B/O", challanNo: pick(["", "DC/28", undefined]), vendor: pick([null, "v1"]), vendorName: pick(["", "Alucast"]),
  totalCycleSec: pick([36, 12.5, null]), machineOnTime: "08:15", machineOffTime: "16:00", actualQty: pick([686, undefined, null]),
  okQty: pick([668, undefined]), rejectedQty: pick([18, undefined]),
  rejectBreakdown: pick([undefined, {}, { "Blow Holes Casting": 5, "Crack/Damage Casting": 13 }, { Other: 3, "Tool Mark": 4 }, { "Blow Holes Casting": 0 }]),
  otherActivity: pick(["", "Filing"]), otherActivityMin: pick([undefined, 10]),
  plannedOperatorShiftHours: pick([7.75, 12, 5.333333, 1.816667, null]), plannedLocked: pick([undefined, true, false]),
  lunchMin: pick([30, 0, undefined]), otherMin: pick([undefined, 5]), otherMinRemark: pick(["", "power cut"]), remarks: pick(["", "ok"]),
  review: pick([undefined, { status: "pending", flagged: [{ metric: "performance", value: 1.2 }] }]),
  workingMode: pick([undefined, "Non Working"]), machineStatus: pick([undefined, ["No Manpower"]]), workingStatus: pick([undefined, "", "ABSENT"]), unlockedUntil: null,
  ...extra,
});
const formCases = [];
const storedRows = [];
for (let i = 0; i < 100 * SCALE; i += 1) {
  const row = dropUndefined(stored());
  storedRows.push(row);
  formCases.push({ row: encIn(row), out: enc(toFormValues(row)) });
}
write("to_form_values.json", formCases);

const payloadCases = [];
for (const v of valInputs) {
  for (const isEdit of [false, true]) {
    if (chance(0.55)) continue;
    const values = dropUndefined({ ...v, _id: pick([undefined, "e1", ""]), slot: pick([1, 2, 8, "2", undefined, "abc"]), item: pick(["", "i1", undefined]) });
    const processId = pick(["p1", "p2"]);
    payloadCases.push({ values: encIn(values), isEdit, processId, payload: savePayload(toPayload(values, isEdit, processId)) });
  }
}
for (const extra of [{ workingStatus: "ABSENT" }, { workingMode: "Non Working", machineStatus: ["No Manpower", "Machine Breakdown"] }, { workingStatus: "SUNDAY", remarks: " note " }, { rejectBreakdown: { Other: "4", "Blow Holes Casting": "" } }]) {
  for (const isEdit of [false, true]) {
    const values = { ...baseValid(), ...extra, item: "i1", vendor: "v1", _id: "e9", slot: 2 };
    payloadCases.push({ values: encIn(values), isEdit, processId: "p1", payload: savePayload(toPayload(values, isEdit, "p1")) });
  }
}
write("payload.json", payloadCases);

const dataCases = [];
const dataInputs = [
  ...valInputs.slice(0, 80), emptyEntry(), { ...emptyEntry(), machine: "w1" }, { ...emptyEntry(), workingMode: "Non Working" }, { ...emptyEntry(), machineStatus: ["No Planning"] },
  { ...emptyEntry(), workingStatus: "ABSENT" }, { ...emptyEntry(), remarks: "x" }, { ...emptyEntry(), lunchMin: "0" }, { ...emptyEntry(), vendor: "v1" }, { ...emptyEntry(), challanNo: "c" },
  { ...emptyEntry(), otherActivity: "f" }, { ...emptyEntry(), rejectBreakdown: { Other: "" } }, { ...emptyEntry(), rejectBreakdown: { Other: "0" } },
];
for (const v of dataInputs) dataCases.push({ values: encIn(v), blockHasData: blockHasData(v), anyData: hasAnyEntryData([v]) });
dataCases.push({ list: [encIn(emptyEntry()), encIn({ ...emptyEntry(), machine: "w1" })], anyData: true });
dataCases.push({ list: [encIn(emptyEntry()), encIn(emptyEntry())], anyData: false });
write("has_data.json", dataCases);

const items = [
  { _id: "i1", itemName: "24 PIN", totalCycleSec: 36, process: "p1" }, { _id: "i2", itemName: "Cap", totalCycleSec: null },
  { _id: "i3", itemName: "Hinge", totalCycleSec: "" }, { _id: "i4", itemName: "Slow", totalCycleSec: 12.5 },
];
const itemCases = [];
for (const id of ["", "i1", "i2", "i3", "i4", "nope"]) {
  const v = dropUndefined({ ...baseValid(), item: "iX", itemName: "Old", totalCycleSec: "99" });
  itemCases.push({ values: encIn(v), itemId: id, out: enc(handleItemSelect(v, id, items)) });
}
write("item_select.json", { items, cases: itemCases });
write("formulas.json", RAW_CASTING_FORMULAS);

const overCases = [];
const overNames = { w1: "MANJU", w2: "ANJU" };
const overBlock = () => {
  const b = dropUndefined({ ...baseValid(), ...pick(valMutations), machine: pick(["w1", "w2", "w9"]) });
  if (chance(0.7)) {
    b.machineOnTime = pick(["08:00", "09:30", "07:00"]);
    b.machineOffTime = pick(["09:00", "10:30", "16:00", "08:00"]);
    b.lunchMin = pick(["", "0", "30", "45", "70"]);
    b.otherMin = pick(["", "0", "10", "40"]);
    b.otherMinRemark = pick(["", "why"]);
    b.otherActivityMin = pick(["", "0", "20", "50", "90"]);
    b.otherActivity = pick(["", "Filing"]);
    b.actualQty = pick(["", "100", "9999"]);
  }
  return b;
};
for (let i = 0; i < 160 * SCALE; i += 1) {
  const blocks = Array.from({ length: int(1, 3) }, overBlock);
  const errors = blocks.map((b) => validateRawCastingEntry(b));
  overCases.push({ blocks: encIn(blocks), errors: encIn(errors), machineName: overNames, out: enc(firstOverLimit(blocks, errors, rawCastingRowCalc, { qtyKey: null, words: WORKER_WORDS, machineName: overNames })) });
}
write("first_over_limit.json", overCases);

// slotsFullErrors with this sheet's limit (no overlap rule on this sheet).
const slotRow = (slot) => ({ slot, machineOnTime: "08:00", machineOffTime: "09:00" });
const ruleCases = [];
const names = { w1: "MANJU" };
for (let i = 0; i < 120 * SCALE; i += 1) {
  const entries = Array.from({ length: int(1, 4) }, () => ({ date: pick(["2024-05-10", "2024-05-11", ""]), machine: pick(["w1", "w2", ""]) }));
  const occupied = {};
  if (chance(0.8)) occupied["w1|2024-05-10"] = Array.from({ length: pick([1, 2, 7, 8, 8]) }, (_, k) => slotRow(k + 1));
  const edit = chance(0.3);
  const editSlot = edit ? pick([1, 2, 8]) : null;
  const saved = edit ? { date: "2024-05-10", machine: "w1" } : null;
  ruleCases.push({ entries, occupied, editSlot, saved, names, full: slotsFullErrors(entries, occupied, { editSlot, saved, who: (id) => names[id] || "This worker", max: RAW_CASTING_MAX_ENTRIES_PER_DAY }) });
}
write("time_rules.json", ruleCases);

// ── the table (rawCastingColumns.jsx) ───────────────────────────────────────
const tableRows = [
  ...storedRows.slice(0, 40),
  ...Array.from({ length: 160 * SCALE }, (_, i) => {
    const r = chance(0.6) ? saneRow("t" + i) : junkRow("t" + i);
    r.date = pick(["2024-05-10", "2024-05-11"]);
    r.machine = pick(["w1", "w2", "w9"]);
    r.slot = int(1, 8);
    if (chance(0.3)) r.vendorName = pick(["", "Alucast"]);
    if (chance(0.2)) r.workingMode = "Non Working";
    if (chance(0.2)) r.machineStatus = pick([[], ["No Manpower"], ["No Planning", "Machine Breakdown"]]);
    if (chance(0.3)) r.operator = pick(["", "Old name", undefined]);
    if (chance(0.2)) r.review = pick([{ status: "pending" }, { status: "approved" }, { status: "rejected" }, { status: "weird" }]);
    if (chance(0.3)) r.otherMinRemark = pick(["", "power cut"]);
    if (chance(0.3)) r.otherActivity = pick(["", "Filing"]);
    if (chance(0.3)) r.plannedOperatorShiftHours = pick(["", 7.75, null, 12]);
    return dropUndefined(r);
  }),
];
const groups = {};
for (const r of tableRows) (groups[`${r.machine}|${r.date}`] ||= []).push(r);
const dayById = {};
for (const group of Object.values(groups)) {
  const sorted = sortByMachineOn(group);
  rawCastingDayCalc(sorted).forEach((d, i) => { dayById[sorted[i]._id] = d; });
}
const machineName = { w1: "MANJU", w2: "ANJU" };
const ctx = { machineName };
const cellCases = tableRows.map((r) => {
  const c = rawCastingRowCalc(r);
  const d = dayById[r._id] || {};
  const cells = {};
  for (const col of RAW_CASTING_COLUMNS) {
    if (col.expandable) {
      cells[col.summary.key] = cellText(col.summary.get(r, c, d, ctx));
      for (const sub of col.columns) cells[sub.key] = cellText(sub.get(r, c, d, ctx));
    } else cells[col.key] = cellText(col.get(r, c, d, ctx));
  }
  return { row: encIn(r), machineName: machineName[r.machine] ?? null, day: enc(d), cells, generalRemark: remarkParts(r).some((p) => p.key === "general") };
});
write("table_cells.json", {
  columns: RAW_CASTING_COLUMNS.map((c) => (c.expandable ? { key: c.key, summaryKey: c.summary.key, label: c.summary.label, subs: c.columns.map((s) => ({ key: s.key, label: s.label })) } : { key: c.key, label: c.label })),
  cases: cellCases,
});

// ── the dashboard ───────────────────────────────────────────────────────────
write("dashboard.json", {
  processes: [{ processName: "RAW CASTING" }, { processName: "Anything", dataEntryMenu: "/hqepl/production/raw-casting-data-entry" }, { processName: "AFTER POWDER COATING" }, { processName: "CNC", dataEntryMenu: "/hqepl/production/cnc-data-entry" }]
    .map((p) => ({ process: p, worker: isWorkerProcess(p), stoppageKeys: stoppageKeysFor(p) })),
});
const feed = (r) => ({ ...r, runQtyBasis: "total", calcMode: "perEntry" });
write("summary.json", [
  [slotless(0), slotless(1)].map(feed),
  ...Array.from({ length: 30 * SCALE }, (_, i) => Array.from({ length: int(1, 8) }, (_, j) => {
    const r = saneRow(`s${i}_${j}`);
    r.date = pick(["2024-05-10", "2024-05-11"]);
    return feed(r);
  })),
].map((rows) => ({ rows: encIn(rows), out: enc(summarize(rows)) })));
function slotless(i) {
  return { _id: "p" + i, date: "2024-05-10", machine: "w1", itemName: "X", machineOnTime: i ? "16:10" : "10:10", machineOffTime: i ? "18:50" : "16:30", totalCycleSec: 30, actualQty: 300, okQty: 290, rejectBreakdown: { Other: 10 }, plannedOperatorShiftHours: i ? 2.666667 : 6.333333, lunchMin: i ? 0 : 30 };
}

console.log("ok", { rows: rowOut.length, days: dayCases.length, validation: valCases.length, payload: payloadCases.length, cells: cellCases.length });
