// Golden-fixture generator for test/production/processes/bpc/*.
//
// Runs the REAL client/src/utils/bpcSheet.js + bpcValidation.js (and the shared
// productionSheet.js / entryValidation.js / quantityRules.js / limitNotice.js /
// shiftHours.js / processDashboard.js they import) and the REAL table columns
// (Components/Production/bpcColumns.jsx, rendered to text with react-dom/server)
// over a broad, deterministic (seeded) input set, and writes the JSON the Dart
// tests compare against. client/ is only READ; nothing is written inside it.
// The page's own pure handlers (emptyEntry, toFormValues, toPayload, …) are
// copied from client/src/pages/BeforePowderCoatingDataEntry.jsx and
// Components/Production/BpcEntryForm.jsx below (pages are not importable).
//
//   cd mobile
//   ESB=../client/node_modules/.bin/esbuild
//   NODE_PATH=../client/node_modules $ESB test/production/processes/bpc/tool/gen_bpc_golden.mjs --bundle \
//        --platform=node --format=esm --loader:.js=jsx --jsx=automatic --log-level=error --define:import.meta.env={} \
//        --banner:js="import {createRequire} from 'module';const require=createRequire(import.meta.url);" \
//        --outfile=<scratch>/bpc-golden/gen.mjs
//   OUT_DIR=test/production/processes/bpc/fixtures TZ=Asia/Kolkata node <scratch>/bpc-golden/gen.mjs
//
// JSON cannot carry NaN/Infinity/undefined, so those are written as markers:
//   {"$n":"NaN"|"Inf"|"-Inf"}   and   {"$u":1} (undefined).

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isoDay, remarkParts, sortByMachineOn } from "../../../../../../client/src/utils/productionSheet.js";
import {
  BPC_FORMULAS,
  BPC_MAX_ENTRIES_PER_DAY,
  BPC_REJECT_REASONS,
  BPC_STOPPAGE_FIELDS,
  NON_WORKING_STATUSES,
  bpcDayCalc,
  bpcRowCalc,
  isBpcProcess,
  isStatusOnly,
  rejectSplitTotal,
} from "../../../../../../client/src/utils/bpcSheet.js";
import { BPC_FIELD_ORDER, BPC_MINUTE_KEYS, BPC_TIME_WORDS, firstBpcError, validateBpcEntry } from "../../../../../../client/src/utils/bpcValidation.js";
import { BPC_WORDS, firstOverLimit, stoppageNotice } from "../../../../../../client/src/utils/limitNotice.js";
import { hasRejectData, quantityFormValues, rejectPayload } from "../../../../../../client/src/utils/quantityRules.js";
import { overlapErrors, slotsFullErrors } from "../../../../../../client/src/utils/entryValidation.js";
import { hmToWireHours, hoursToShiftInput, parseShiftHours } from "../../../../../../client/src/utils/shiftHours.js";
import { causeLabel, causeLabelsFor, isWorkerProcess, stoppageKeysFor, summarize } from "../../../../../../client/src/utils/processDashboard.js";
import { BPC_COLUMNS } from "../../../../../../client/src/Components/Production/bpcColumns.jsx";

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

// A table cell as the person reads it: React output rendered, tags stripped.
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'", "&nbsp;": " " };
const cellText = (v) => {
  if (v === null || v === undefined || typeof v === "boolean") return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null, v));
  return html.replace(/<[^>]*>/g, "").replace(/&[#\w]+;/g, (m) => ENTITIES[m] ?? m);
};

// ── copies of the page's pure handlers (BeforePowderCoatingDataEntry.jsx) ───
const TEXT_FIELDS = ["workingStatus", "itemName", "remarks", "otherMinRemark", "rejectOtherRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = ["totalCycleSec", "actualQty", "okQty", "plannedOperatorShiftHours", ...BPC_STOPPAGE_FIELDS.map((f) => f.key)];

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
  ...quantityFormValues(row, BPC_REJECT_REASONS),
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
// api/bpcSheet.api.js saveBpcRow: { machine, ...row } -> { ...row, worker: machine }
const savePayload = (body) => {
  const { machine, ...row } = body;
  return wire({ ...row, worker: machine });
};

// The form's per-block "has typed work" test (BpcEntryForm.jsx).
const IDLE_BOXES = BPC_STOPPAGE_FIELDS.filter((f) => f.key !== "lunchMin");
const LINES = [
  { id: 1, fields: ["date", "machine", "machineStatus"] },
  { id: 2, fields: ["itemName", "vendor", "totalCycleSec"] },
  { id: 3, fields: ["machineOnTime", "machineOffTime"] },
  { id: 5, fields: ["actualQty", "okQty"] },
  { id: 7, fields: ["plannedOperatorShiftHours", "lunchMin"] },
  { id: 8, fields: [...IDLE_BOXES.map((f) => f.key), "stoppageTotal", "otherMinRemark"] },
  { id: 12, fields: ["remarks"] },
  { id: 13, fields: ["rejectBreakdown", "rejectOtherRemark"] },
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
const TIMES_OK = ["06:00", "07:30", "08:15", "9", "930", "0930", "9:30", "9.30", "11:15", "13:45", "14:40", "15:00", "16:00", "18:00", "22:00", "23:59", "00:00", "05:45"];
const TIMES_BAD = ["24:00", "9:5", "abc", "12345", "", "  ", "25", "7:60", null, undefined, 930, 9, "9-30"];
const NUMS = ["", undefined, null, "0", "1", "5", "10", "12.5", 3, 7.5, "  ", "abc", "-4", "1e2", "0x10", "45", 45, "120", "0.5", "600", "1440", "1441"];
const QTY = ["", undefined, null, "0", "10", "90", "150", "345", "452", "796", "913", 320, 55, "12.5", "-3", "abc", "  ", "9999"];
const STD = ["27", "30", "35", "40", "16", "13", 27, "12.5", "0", "-2", "abc", "", "3600"];
const PLANNED = ["", undefined, "6.75", "3", "1", "2.5", "4.67", "1.75", "12", "0", "24", "24.5", "abc", "8,30", 8, 6.75, "-1"];
const ITEMS = ["BODY", "Cover", " Cap ", "X"];
const STATUSES = ["", "", "", "PRESENT", "ABSENT", "SUNDAY", "LEAVE", "HOLIDAY", "REPORT NOT FILLUP", " absent ", "present", "W/OFF", undefined, null, 7];
const REASONS = [...BPC_REJECT_REASONS, "Tool Mark", "Weird"];

const splitFor = (rejected) => {
  const split = {};
  let left = Math.max(0, rejected);
  for (const r of BPC_REJECT_REASONS) {
    if (!left || chance(0.4)) continue;
    const q = r === "Other" ? left : int(0, left);
    if (q) split[r] = chance(0.5) ? String(q) : q;
    left -= q;
  }
  return split;
};

function saneRow(id) {
  const shifts = [["08:15", "15:00"], ["15:00", "18:00"], ["15:00", "16:00"], ["11:15", "13:45"], ["10:00", "14:40"], ["09:15", "11:00"], ["08:00", "12:00"], ["930", "1330"]];
  const [on, off] = pick(shifts);
  const total = int(0, 900);
  const ok = Math.max(0, total - int(0, 30));
  const row = {
    _id: id,
    date: "2026-05-13",
    machine: "op" + int(1, 4),
    operator: "Operator " + int(1, 5),
    itemName: pick(ITEMS),
    machineOnTime: on,
    machineOffTime: off,
    totalCycleSec: pick(["27", "30", "35", "40", "16", "13", 27, "12.5"]),
    actualQty: String(total),
    okQty: String(ok),
    plannedOperatorShiftHours: pick([6.75, 3, 1, 12, 4.666667, "6.75", 8]),
    lunchMin: pick(["0", "30", "", 30]),
    setupMin: pick(["", "0", "10", "15"]),
    bdMechMin: pick(["", "0", "20"]),
    otherMin: pick(["", "0", "5", "15"]),
    remarks: pick(["", "ok", "late start"]),
  };
  if (chance(0.7)) row.rejectBreakdown = splitFor(total - ok);
  if (chance(0.2)) row.plannedLocked = true;
  return row;
}
function junkRow(id) {
  const row = { _id: id };
  if (chance(0.85)) row.itemName = pick([...ITEMS, " ", "", null, undefined, 7]);
  if (chance(0.9)) row.machineOnTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.9)) row.machineOffTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.8)) row.totalCycleSec = pick([...STD, ...NUMS]);
  if (chance(0.1)) row.drillingSec = pick(NUMS);
  if (chance(0.85)) row.actualQty = pick(QTY);
  if (chance(0.8)) row.okQty = pick(QTY);
  if (chance(0.25)) row.rejectedQty = pick(QTY);
  if (chance(0.5)) {
    row.rejectBreakdown = {};
    for (const r of REASONS) if (chance(0.3)) row.rejectBreakdown[r] = pick(["", "1", "2", 3, "abc", "-1", null, "0"]);
  }
  if (chance(0.5)) row.plannedOperatorShiftHours = pick([...NUMS, 6.75, 12]);
  for (const k of ["setupMin", "bdMechMin", "lunchMin", "otherMin"]) if (chance(0.5)) row[k] = pick(NUMS);
  for (const k of ["plannedDownMin", "noManPowerMin", "bdEleMin", "noPowerMin"]) if (chance(0.08)) row[k] = pick(NUMS);
  if (chance(0.2)) row.plannedLocked = pick([true, false, "true"]);
  if (chance(0.3)) row.workingStatus = pick(STATUSES);
  if (chance(0.15)) row.workingMode = pick(["Working", "Non Working", "", undefined]);
  return row;
}

// ── rowCalc ─────────────────────────────────────────────────────────────────
// The six rows of the paper sheet (utils/bpcSheet.test.mjs) and the edges.
const PAPER = [
  { on: "08:15", off: "15:00", std: 27, total: 796, ok: 795, lunch: 30 },
  { on: "15:00", off: "18:00", std: 30, total: 345, ok: 286, lunch: 0 },
  { on: "15:00", off: "16:00", std: 35, total: 90, ok: 90, lunch: 0 },
  { on: "11:15", off: "13:45", std: 40, total: 150, ok: 150, lunch: 30 },
  { on: "10:00", off: "14:40", std: 16, total: 913, ok: 0, lunch: 30 },
  { on: "09:15", off: "11:00", std: 13, total: 452, ok: 452, lunch: 0 },
];
const paperRow = (p, i, o = {}) => ({
  _id: `p${i}`,
  date: "2026-05-13",
  machine: "op1",
  itemName: "BODY",
  totalCycleSec: p.std,
  machineOnTime: p.on,
  machineOffTime: p.off,
  actualQty: p.total,
  okQty: p.ok,
  lunchMin: p.lunch,
  plannedOperatorShiftHours: (((Number(p.off.slice(0, 2)) * 60 + Number(p.off.slice(3))) - (Number(p.on.slice(0, 2)) * 60 + Number(p.on.slice(3)))) / 60),
  ...o,
});
const curated = [
  ...PAPER.map((p, i) => paperRow(p, i)),
  paperRow(PAPER[0], 9, { setupMin: 10, bdMechMin: 20, otherMin: 6 }),
  { itemName: "BODY", machineOnTime: "08:00", machineOffTime: "12:00", totalCycleSec: "20", actualQty: "600", okQty: "600", setupMin: 10, bdMechMin: 20, otherMin: 6, lunchMin: 30, plannedOperatorShiftHours: 4 },
  { itemName: "BODY", machineOnTime: "08:00", machineOffTime: "12:00", totalCycleSec: "0", actualQty: "10", okQty: "10" },
  { itemName: "BODY", machineOnTime: "08:00", machineOffTime: "12:00", totalCycleSec: "-5", actualQty: "10", okQty: "10" },
  { itemName: "BODY", machineOnTime: "08:00", machineOffTime: "12:00", totalCycleSec: "abc", actualQty: "10", okQty: "10" },
  { itemName: "", machineOnTime: "08:00", machineOffTime: "12:00", totalCycleSec: "20", actualQty: "10", okQty: "10" },
  { itemName: "BODY", totalCycleSec: "20", actualQty: "10", okQty: "10" },
  { itemName: "BODY", machineOnTime: "22:00", machineOffTime: "06:00", totalCycleSec: "36", actualQty: "700", okQty: "690", plannedOperatorShiftHours: 9 },
  { itemName: "BODY", machineOnTime: "08:00", machineOffTime: "08:00", totalCycleSec: "36", actualQty: "0", okQty: "0" },
  { itemName: "BODY", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "1e400", actualQty: "5", okQty: "5" },
  { itemName: "BODY", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "5", rejectedQty: "1" },
  { itemName: "BODY", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "5", okQty: "9" },
  { itemName: "BODY", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "13", actualQty: "1", okQty: "1", plannedOperatorShiftHours: 0.000001 },
  {},
];
const rowCases = [...curated];
for (let i = 0; i < 700 * SCALE; i += 1) rowCases.push(chance(0.5) ? saneRow("r" + i) : junkRow("r" + i));
const rowOut = rowCases.map((row) => ({ row: encIn(row), out: enc(bpcRowCalc(row)) }));
rowOut.push({ row: null, out: enc(bpcRowCalc(null)) });
write("row_calc.json", rowOut);

// isStatusOnly / rejectSplitTotal on the same rows; the sheet's lists and words.
write("helpers.json", {
  rows: rowCases.map((row) => ({ row: encIn(row), statusOnly: isStatusOnly(row), splitTotal: enc(rejectSplitTotal(row)) })),
  rejectReasons: BPC_REJECT_REASONS,
  stoppageFields: BPC_STOPPAGE_FIELDS,
  maxEntriesPerDay: BPC_MAX_ENTRIES_PER_DAY,
  nonWorking: NON_WORKING_STATUSES,
  timeWords: BPC_TIME_WORDS,
  words: BPC_WORDS,
  processes: [
    { processName: "BEFORE POWDER COATING" },
    { processName: "before  powder coating line" },
    { processName: "AFTER POWDER COATING" },
    { processName: "Anything", dataEntryMenu: "/hqepl/production/before-powder-coating-data-entry" },
    { processName: "Anything", dataEntryMenu: "/hqepl/production/before-powder-coating-data-entry/" },
    { processName: "BEFORE POWDER COATING", dataEntryMenu: "/hqepl/production/powder-coating-data-entry" },
    { processName: "CNC" },
    {},
  ].map((p) => ({ process: p, isBpc: isBpcProcess(p) })),
});

// ── dayCalc ─────────────────────────────────────────────────────────────────
const dayCases = [];
const addDay = (rows) => {
  const sorted = sortByMachineOn(rows);
  dayCases.push({ rows: encIn(rows), order: sorted.map((r) => r && r._id), out: enc(bpcDayCalc(sorted)) });
};
const mk = (id, on, off, extra = {}) => ({ _id: id, itemName: "BODY", machineOnTime: on, machineOffTime: off, totalCycleSec: "30", actualQty: "100", okQty: "98", plannedOperatorShiftHours: 4, ...extra });
addDay([]);
addDay(PAPER.map((p, i) => paperRow(p, i)));
addDay(PAPER.slice(0, 2).map((p, i) => paperRow(p, i, { plannedOperatorShiftHours: 12, plannedLocked: true })));
addDay([paperRow(PAPER[0], 0, { setupMin: 10, bdMechMin: 20, otherMin: 6 })]);
addDay([mk("a", "08:00", "12:00", { setupMin: "10", bdMechMin: "20", lunchMin: "30", otherMin: "6" })]);
addDay([mk("a", "08:00", "12:00", { plannedLocked: true, plannedOperatorShiftHours: 12 }), mk("b", "12:00", "16:00")]);
addDay([mk("a", "06:00", "10:00"), mk("b", "10:00", "14:00"), mk("c", "13:00", "18:00")]);
addDay([mk("a", "", "10:00"), mk("b", "06:00", "10:00"), mk("c", "abc", "")]);
addDay([null, mk("a", "08:00", "16:00"), null]);
addDay([mk("a", "08:00", "16:00", { plannedOperatorShiftHours: "" })]);
addDay([mk("a", "08:00", "16:00", { lunchMin: "480", plannedOperatorShiftHours: 8 })]);
addDay([mk("a", "08:00", "16:00", { lunchMin: "abc", setupMin: "x" })]);
for (let i = 0; i < 300 * SCALE; i += 1) {
  const n = int(1, 6);
  const rows = [];
  for (let j = 0; j < n; j += 1) {
    const r = chance(0.7) ? saneRow(`d${i}_${j}`) : junkRow(`d${i}_${j}`);
    if (chance(0.5)) r.machineOffTime = pick(TIMES_OK);
    rows.push(r);
  }
  addDay(rows);
}
write("day_calc.json", dayCases);

// ── validateBpcEntry ────────────────────────────────────────────────────────
// A fully valid block: the first paper row as typed.
const baseValid = () => ({
  date: "2026-05-13",
  machine: "op1",
  machineStatus: [],
  workingMode: "Working",
  itemName: "BODY",
  vendor: "",
  machineOnTime: "08:15",
  machineOffTime: "15:00",
  totalCycleSec: "27",
  actualQty: "796",
  okQty: "795",
  rejectBreakdown: { "Blow Holes Casting": "1" },
  rejectOtherRemark: "",
  plannedOperatorShiftHours: "6.75",
  setupMin: "",
  bdMechMin: "",
  lunchMin: "30",
  otherMin: "",
  otherMinRemark: "",
  remarks: "",
});
const valMutations = [
  {}, { date: "" }, { date: null }, { date: "  " }, { machine: "" }, { machine: undefined }, { itemName: "" }, { itemName: null }, { itemName: "   " },
  { workingMode: "Non Working" }, { workingMode: "Non Working", date: "", machine: "" }, { workingMode: "Non Working", machineStatus: ["No Manpower"] },
  { workingStatus: "ABSENT" }, { workingStatus: "SUNDAY", machine: "" }, { workingStatus: "PRESENT" }, { workingStatus: "present" }, { workingStatus: " LEAVE " }, { workingStatus: "ABSENT", date: "" },
  { workingStatus: 5 }, { workingStatus: null },
  { machineOnTime: "" }, { machineOffTime: "" }, { machineOnTime: "abc" }, { machineOffTime: "25:00" }, { machineOnTime: "9" }, { machineOffTime: "17.30" }, { machineOnTime: "0815" }, { machineOnTime: 8 },
  { machineOnTime: "", machineOffTime: "" }, { machineOnTime: "22:00", machineOffTime: "06:00" }, { machineOnTime: "08:00", machineOffTime: "08:00" }, { machineOnTime: "23:59", machineOffTime: "00:00" },
  { vendor: "v1" }, { vendorName: "Acme" },
  { totalCycleSec: "" }, { totalCycleSec: "0" }, { totalCycleSec: "abc" }, { totalCycleSec: "-3" }, { totalCycleSec: "1" }, { totalCycleSec: 27 }, { totalCycleSec: "  " }, { totalCycleSec: undefined },
  { actualQty: "" }, { actualQty: undefined }, { actualQty: "abc" }, { actualQty: "-1" }, { actualQty: "  " }, { actualQty: "12.5" }, { actualQty: "1e2" }, { actualQty: 796 }, { actualQty: "950", okQty: "950", rejectBreakdown: {} },
  { okQty: "" }, { okQty: undefined }, { okQty: "abc" }, { okQty: "-2" }, { okQty: "800" }, { okQty: "795.5" }, { okQty: 795 }, { okQty: "796", rejectBreakdown: {} }, { okQty: "790" },
  { actualQty: "", okQty: "5" }, { actualQty: "abc", okQty: "800" }, { actualQty: "12.5", okQty: "12.5", rejectBreakdown: {} },
  { rejectBreakdown: {} }, { rejectBreakdown: { Other: "1" } }, { rejectBreakdown: { Other: "1" }, rejectOtherRemark: "chipped" }, { rejectBreakdown: { Other: "1" }, rejectOtherRemark: "  " },
  { rejectBreakdown: { "Blow Holes Casting": "2" } }, { rejectBreakdown: { "Blow Holes Casting": "-1" } }, { rejectBreakdown: { "Blow Holes Casting": "abc" } }, { rejectBreakdown: { "Tool Mark": "1" } },
  { rejectBreakdown: { "Crack/Damage Casting": "1", "TAP Broken Casting": "" } }, { okQty: "796", rejectBreakdown: { "Threading Casting": "1" } },
  { plannedOperatorShiftHours: "" }, { plannedOperatorShiftHours: undefined }, { plannedOperatorShiftHours: "0" }, { plannedOperatorShiftHours: "-1" }, { plannedOperatorShiftHours: "24" }, { plannedOperatorShiftHours: "24.01" },
  { plannedOperatorShiftHours: "abc" }, { plannedOperatorShiftHours: "6.5" }, { plannedOperatorShiftHours: "6.74" }, { plannedOperatorShiftHours: "6.76" }, { plannedOperatorShiftHours: "8,30" }, { plannedOperatorShiftHours: 6.75 },
  { plannedOperatorShiftHours: "12" }, { plannedOperatorShiftHours: "9", machineOnTime: "22:00", machineOffTime: "06:00" }, { machineOnTime: "", plannedOperatorShiftHours: "0.30" },
  { lunchMin: "" }, { lunchMin: undefined }, { lunchMin: "0" }, { lunchMin: "abc" }, { lunchMin: "-1" }, { lunchMin: "1440" }, { lunchMin: "1441" }, { lunchMin: "  " }, { lunchMin: 30 }, { lunchMin: "12.5" },
  { setupMin: "200", bdMechMin: "176" }, { setupMin: "200", bdMechMin: "175" }, { setupMin: "abc" }, { bdMechMin: "-1" }, { bdMechMin: "1441" },
  { otherMin: "5" }, { otherMin: "5", otherMinRemark: "  " }, { otherMin: "5", otherMinRemark: "power cut" }, { otherMin: "0" }, { otherMin: "abc" }, { otherMin: "-1" },
  { machineOnTime: "", lunchMin: "5000" }, { plannedDownMin: "500" }, { noPowerMin: "400" },
  { date: "", machine: "", itemName: "" },
  { date: "", machine: "", itemName: "", machineOnTime: "", machineOffTime: "", actualQty: "", okQty: "", plannedOperatorShiftHours: "", lunchMin: "", totalCycleSec: "" },
];
const valInputs = valMutations.map((m) => dropUndefined({ ...baseValid(), ...m }));
for (let i = 0; i < 360 * SCALE; i += 1) {
  valInputs.push(dropUndefined({ ...baseValid(), ...pick(valMutations), ...pick(valMutations), ...pick(valMutations) }));
}
for (let i = 0; i < 140 * SCALE; i += 1) {
  const r = junkRow("v" + i);
  r.machine = pick(["op1", "", undefined, "  "]);
  r.date = pick(["2026-05-13", "", undefined]);
  valInputs.push(dropUndefined(r));
}
const savedVariants = [null, { date: "2026-05-13", machine: "op1", machineOnTime: "08:15", machineOffTime: "15:00" }, { date: "2026-05-13", machine: "op1", machineOnTime: "9", machineOffTime: "8" }, { machineOnTime: "bad", machineOffTime: "" }];
const valCases = [];
for (const v of valInputs) {
  const saved = pick(savedVariants);
  const errors = saved ? validateBpcEntry(v, { saved }) : validateBpcEntry(v);
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
errLists.push([], [{}], [{ zzz: "x", date: "d" }], [{}, { zzz: "only unknown" }]);
write("first_error.json", {
  order: BPC_FIELD_ORDER,
  minuteKeys: BPC_MINUTE_KEYS,
  cases: errLists.map((list) => ({ errors: list, first: firstBpcError(list.map((e) => e || {})) })),
});

// ── values / payload ────────────────────────────────────────────────────────
const stored = (extra = {}) => ({
  _id: "e" + int(1, 99999),
  date: "2026-05-13",
  worker: "op1",
  machine: "op1",
  process: "p1",
  operator: "SUREKHA",
  slot: pick([1, 2, 3, 6, 8]),
  item: pick(["i1", null]),
  itemName: "BODY",
  vendor: pick([null, "v1"]),
  vendorName: pick(["", "Acme"]),
  totalCycleSec: pick([27, 12.5, null]),
  machineOnTime: "08:15",
  machineOffTime: "15:00",
  actualQty: pick([796, undefined, null]),
  okQty: pick([795, 790, undefined]),
  rejectedQty: pick([1, 6, undefined]),
  rejectBreakdown: pick([undefined, {}, { "Blow Holes Casting": 1 }, { "Blow Holes Casting": 2, "TAP Broken Casting": 3, Other: 1, "Tool Mark": 4 }]),
  rejectReason: pick([undefined, "", "Blow Holes Casting", "Tool Mark", "Other"]),
  rejectOtherRemark: pick(["", "chipped"]),
  plannedOperatorShiftHours: pick([6.75, 12, 5.333333, 3.833333, null]),
  plannedLocked: pick([undefined, true, false]),
  setupMin: pick([undefined, 10]),
  bdMechMin: pick([undefined, 20]),
  lunchMin: pick([30, 0, undefined]),
  otherMin: pick([undefined, 5]),
  otherMinRemark: pick(["", "power cut"]),
  remarks: pick(["", "ok"]),
  review: pick([undefined, { status: "pending", flagged: [{ metric: "performance", value: 1.2 }] }]),
  workingMode: pick([undefined, "Non Working"]),
  machineStatus: pick([undefined, ["No Manpower"], ["Machine Breakdown", "No Planning"]]),
  workingStatus: pick([undefined, "", "ABSENT"]),
  unlockedUntil: null,
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

// quantityFormValues itself: this sheet's reasons, and the CNC list it leaves alone.
write(
  "quantity_form_values.json",
  storedRows.map((row) => ({ row: encIn(row), bpc: enc(quantityFormValues(row, BPC_REJECT_REASONS)), cnc: enc(quantityFormValues(row)) })),
);

const payloadCases = [];
for (const v of valInputs) {
  for (const isEdit of [false, true]) {
    if (chance(0.55)) continue;
    const values = { ...v, _id: pick([undefined, "e1", ""]), slot: pick([1, 2, 8, "2", undefined, "abc"]), item: pick(["", "i1", undefined]) };
    dropUndefined(values);
    const processId = pick(["p1", "p2"]);
    payloadCases.push({ values: encIn(values), isEdit, processId, payload: savePayload(toPayload(values, isEdit, processId)) });
  }
}
for (const extra of [
  { workingStatus: "ABSENT" },
  { workingMode: "Non Working", machineStatus: ["No Manpower", "Machine Breakdown"] },
  { workingStatus: "SUNDAY", remarks: " note " },
  { rejectBreakdown: { "Crack/Damage Casting": "4", Threading: "" }, rejectOtherRemark: "x" },
  { okQty: "790", rejectBreakdown: { "Blow Holes Casting": "2", "TAP Broken Casting": "3", Other: "1" }, rejectOtherRemark: " chipped " },
]) {
  for (const isEdit of [false, true]) {
    const values = { ...baseValid(), ...extra, item: "i1", vendor: "v1", _id: "e9", slot: 2 };
    payloadCases.push({ values: encIn(values), isEdit, processId: "p1", payload: savePayload(toPayload(values, isEdit, "p1")) });
  }
}
write("payload.json", payloadCases);

const dataCases = [];
const dataInputs = [
  ...valInputs.slice(0, 80),
  emptyEntry(),
  { ...emptyEntry(), machine: "op1" },
  { ...emptyEntry(), workingMode: "Non Working" },
  { ...emptyEntry(), machineStatus: ["No Planning"] },
  { ...emptyEntry(), workingStatus: "ABSENT" },
  { ...emptyEntry(), remarks: "x" },
  { ...emptyEntry(), lunchMin: "0" },
  { ...emptyEntry(), vendor: "v1" },
  { ...emptyEntry(), slot: 3 },
  { ...emptyEntry(), rejectBreakdown: { Other: "" } },
  { ...emptyEntry(), rejectBreakdown: { Other: "0" } },
  { ...emptyEntry(), rejectBreakdown: { Other: "2" } },
  { ...emptyEntry(), rejectOtherRemark: "r" },
  { ...emptyEntry(), setupMin: "5" },
];
for (const v of dataInputs) dataCases.push({ values: encIn(v), blockHasData: blockHasData(v), anyData: hasAnyEntryData([v]) });
dataCases.push({ list: [encIn(emptyEntry()), encIn({ ...emptyEntry(), machine: "op1" })], anyData: true });
dataCases.push({ list: [encIn(emptyEntry()), encIn(emptyEntry())], anyData: false });
write("has_data.json", dataCases);

const items = [
  { _id: "i1", itemName: "BODY", totalCycleSec: 27, process: "p1" },
  { _id: "i2", itemName: "Cap", totalCycleSec: null },
  { _id: "i3", itemName: "Hinge", totalCycleSec: "" },
  { _id: "i4", itemName: "Slow", totalCycleSec: 12.5 },
];
const itemCases = [];
for (const id of ["", "i1", "i2", "i3", "i4", "nope"]) {
  const v = dropUndefined({ ...baseValid(), item: "iX", itemName: "Old", totalCycleSec: "99" });
  itemCases.push({ values: encIn(v), itemId: id, out: enc(handleItemSelect(v, id, items)) });
}
write("item_select.json", { items, cases: itemCases });

write("formulas.json", BPC_FORMULAS);

// firstOverLimit as the page's Save calls it: no quantity check (qtyKey null — TOTAL QTY
// may beat Ideal and goes to OEE Review), the operator's words, operators named by id.
const overCases = [];
const overNames = { op1: "SUREKHA", op2: "RAVI" };
const overBlock = () => {
  const b = dropUndefined({ ...baseValid(), ...pick(valMutations), machine: pick(["op1", "op2", "op9"]) });
  if (chance(0.7)) {
    b.machineOnTime = pick(["08:00", "09:30", "07:00"]);
    b.machineOffTime = pick(["09:00", "10:30", "16:00", "08:00"]);
    b.lunchMin = pick(["", "0", "30", "45", "70"]);
    b.setupMin = pick(["", "0", "20", "60"]);
    b.bdMechMin = pick(["", "0", "40", "90"]);
    b.otherMin = pick(["", "0", "10", "40"]);
    b.otherMinRemark = pick(["", "why"]);
    b.actualQty = pick(["", "100", "9999"]);
  }
  return b;
};
for (let i = 0; i < 160 * SCALE; i += 1) {
  const blocks = Array.from({ length: int(1, 3) }, overBlock);
  const errors = blocks.map((b) => validateBpcEntry(b));
  const out = firstOverLimit(blocks, errors, bpcRowCalc, { qtyKey: null, words: BPC_WORDS, machineName: overNames });
  overCases.push({ blocks: encIn(blocks), errors: encIn(errors), machineName: overNames, out: enc(out) });
}
write("first_over_limit.json", overCases);

// The idle-box popup (minutesBox) in this sheet's words.
write(
  "stoppage_notice.json",
  [[405, 406], [240, 300.5], [60, 61], [0, 5]].map(([limitMin, totalMin]) => ({ limitMin, totalMin, out: stoppageNotice({ limitMin, totalMin, words: BPC_WORDS }) })),
);

// The page's time rules in this sheet's words: overlapErrors (BPC_TIME_WORDS) and
// slotsFullErrors (BPC_MAX_ENTRIES_PER_DAY, the operator named).
const slotRow = (slot, on, off) => ({ slot, machineOnTime: on, machineOffTime: off });
const ruleCases = [];
const names = { op1: "SUREKHA" };
const ruleBlock = () => ({
  date: pick(["2026-05-13", "2026-05-14", ""]),
  machine: pick(["op1", "op2", ""]),
  machineOnTime: pick(["08:00", "09:00", "10:30", "13:00", ""]),
  machineOffTime: pick(["09:30", "11:00", "12:00", "16:00", ""]),
});
for (let i = 0; i < 160 * SCALE; i += 1) {
  const entries = Array.from({ length: int(1, 4) }, ruleBlock);
  const occupied = {};
  if (chance(0.8)) occupied["op1|2026-05-13"] = Array.from({ length: pick([1, 2, 7, 8, 8]) }, (_, k) => slotRow(k + 1, pick(["06:00", "07:00", "11:30"]), pick(["07:00", "08:30", "12:30"])));
  if (chance(0.4)) occupied["op2|2026-05-13"] = [slotRow(1, "10:00", "11:00")];
  const edit = chance(0.3);
  const editSlot = edit ? pick([1, 2, 8]) : null;
  const saved = edit ? { date: "2026-05-13", machine: "op1", machineOnTime: "06:00", machineOffTime: "07:00" } : null;
  const overlap = overlapErrors(entries, occupied, { editSlot, saved, words: BPC_TIME_WORDS });
  const full = slotsFullErrors(entries, occupied, { editSlot, saved, who: (id) => names[id] || "This operator", max: BPC_MAX_ENTRIES_PER_DAY });
  ruleCases.push({ entries, occupied, editSlot, saved, names, overlap, full });
}
write("time_rules.json", ruleCases);

// ── the table (bpcColumns.jsx) ──────────────────────────────────────────────
// Every column's cell text, the opened Rejected QTY breakdown included, for rows
// carrying their own calc and the page's day results (bpcDayCalc per operator/date).
const tableRows = [
  ...PAPER.map((p, i) => ({ ...paperRow(p, i), slot: i + 1, operator: "SUREKHA", rejectBreakdown: splitFor(p.total - p.ok) })),
  ...storedRows.slice(0, 40),
  ...Array.from({ length: 160 * SCALE }, (_, i) => {
    const r = chance(0.6) ? saneRow("t" + i) : junkRow("t" + i);
    r.date = pick(["2026-05-13", "2026-05-14"]);
    r.machine = pick(["op1", "op2", "op9"]);
    r.slot = int(1, 8);
    if (chance(0.3)) r.vendorName = pick(["", "Acme"]);
    if (chance(0.2)) r.workingMode = "Non Working";
    if (chance(0.2)) r.machineStatus = pick([[], ["No Manpower"], ["Machine Breakdown", "No Planning"]]);
    if (chance(0.3)) r.operator = pick(["", "Old name", undefined]);
    if (chance(0.2)) r.review = pick([{ status: "pending" }, { status: "approved" }, { status: "rejected" }, { status: "weird" }]);
    if (chance(0.3)) r.otherMinRemark = pick(["", "power cut"]);
    if (chance(0.3)) r.rejectOtherRemark = pick(["", "chipped"]);
    if (chance(0.3)) r.plannedOperatorShiftHours = pick(["", 6.75, null, 12]);
    return dropUndefined(r);
  }),
];
const groups = {};
for (const r of tableRows) (groups[`${r.machine}|${r.date}`] ||= []).push(r);
const dayById = {};
for (const group of Object.values(groups)) {
  const sorted = sortByMachineOn(group);
  const results = bpcDayCalc(sorted);
  sorted.forEach((r, i) => {
    dayById[r._id] = results[i];
  });
}
const machineName = { op1: "SUREKHA", op2: "RAVI" };
const ctx = { machineName };
const cellCases = tableRows.map((r) => {
  const c = bpcRowCalc(r);
  const d = dayById[r._id] || {};
  const cells = {};
  for (const col of BPC_COLUMNS) {
    if (col.expandable) {
      cells[col.summary.key] = cellText(col.summary.get(r, c, d, ctx));
      for (const sub of col.columns) cells[sub.key] = cellText(sub.get(r, c, d, ctx));
    } else {
      cells[col.key] = cellText(col.get(r, c, d, ctx));
    }
  }
  return { row: encIn(r), machineName: machineName[r.machine] ?? null, day: enc(d), cells, generalRemark: remarkParts(r).some((p) => p.key === "general") };
});
write("table_cells.json", {
  columns: BPC_COLUMNS.map((c) => (c.expandable ? { key: c.key, label: c.summary.label, subs: c.columns.map((s) => ({ key: s.key, label: s.label })) } : { key: c.key, label: c.label })),
  cases: cellCases,
});

// ── the dashboard (utils/processDashboard.js) ───────────────────────────────
const dashProcesses = [
  { processName: "BEFORE POWDER COATING" },
  { processName: "Anything", dataEntryMenu: "/hqepl/production/before-powder-coating-data-entry" },
  { processName: "AFTER POWDER COATING" },
  { processName: "CNC", dataEntryMenu: "/hqepl/production/cnc-data-entry" },
  { processName: "VMC" },
];
write("dashboard.json", {
  processes: dashProcesses.map((p) => ({ process: p, worker: isWorkerProcess(p), stoppageKeys: stoppageKeysFor(p), causeLabels: causeLabelsFor(p) })),
  causeLabels: ["bdMechMin", "setupMin", "lunchMin", "otherMin", "bdEleMin", "nope"].map((key) => ({
    key,
    plain: causeLabel(key),
    bpc: causeLabel(key, causeLabelsFor({ processName: "BEFORE POWDER COATING" })),
  })),
});

// The dashboard's figures over this sheet's rows as the server feeds them
// (process.controller.js: runQtyBasis "total", calcMode "perEntry",
// lossesExceptLunch) — each entry its own OEE, a locked day once.
const feed = (r) => ({ ...r, runQtyBasis: "total", calcMode: "perEntry", lossesExceptLunch: true });
const summaryCases = [
  PAPER.map((p, i) => feed(paperRow(p, i))),
  PAPER.slice(0, 2).map((p, i) => feed(paperRow(p, i, { plannedOperatorShiftHours: 12, plannedLocked: true }))),
  [...PAPER.map((p, i) => feed(paperRow(p, i, { machine: i % 2 ? "op1" : "op2", setupMin: 10, bdMechMin: 5, otherMin: 3 })))],
  ...Array.from({ length: 30 * SCALE }, (_, i) =>
    Array.from({ length: int(1, 8) }, (_, j) => {
      const r = saneRow(`s${i}_${j}`);
      r.date = pick(["2026-05-13", "2026-05-14"]);
      return feed(r);
    }),
  ),
].map((rows) => ({ rows: encIn(rows), out: enc(summarize(rows)) }));
write("summary.json", summaryCases);

console.log("ok", { rows: rowOut.length, days: dayCases.length, validation: valCases.length, payload: payloadCases.length, cells: cellCases.length, rules: ruleCases.length });
