// Golden-fixture generator for test/production/processes/rubber/*.
//
// Runs the REAL client/src/utils/rubberSheet.js + rubberValidation.js (and the
// shared productionSheet.js / entryValidation.js / quantityRules.js /
// shiftHours.js / limitNotice.js they import) and the REAL table columns
// (Components/Production/rubberColumns.jsx) over a broad, deterministic (seeded)
// input set and writes the JSON the Dart tests compare against. client/ is only
// READ; nothing is written inside it. The page's own pure handlers (emptyEntry,
// toFormValues, toPayload, …) are copied from client/src/pages/RubberDataEntry.jsx
// and Components/Production/RubberEntryForm.jsx below (pages are not importable).
//
//   cd mobile
//   ESB=../client/node_modules/.bin/esbuild
//   $ESB test/production/processes/rubber/tool/gen_rubber_golden.mjs --bundle \
//        --platform=node --format=esm --loader:.js=jsx --loader:.css=empty \
//        "--define:import.meta.env={}" \
//        "--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
//        --outfile=<scratch>/rubber-golden/gen.mjs
//   (rubberColumns.jsx pulls in ProductionEntriesTable.jsx and the api client:
//   JSX in .js files, Vite's import.meta.env and CommonJS node builtins.)
//   OUT_DIR=test/production/processes/rubber/fixtures TZ=Asia/Kolkata node <scratch>/rubber-golden/gen.mjs
//
// JSON cannot carry NaN/Infinity/undefined, so those are written as markers:
//   {"$n":"NaN"|"Inf"|"-Inf"}   and   {"$u":1} (undefined).

import fs from "node:fs";
import path from "node:path";
import { REJECT_REASONS, isoDay, sortByMachineOn } from "../../../../../../client/src/utils/productionSheet.js";
import {
  NON_WORKING_STATUSES,
  RUBBER_FORMULAS,
  RUBBER_STOPPAGE_FIELDS,
  isRubberProcess,
  isStatusOnly,
  rubberDayCalc,
  rubberRowCalc,
} from "../../../../../../client/src/utils/rubberSheet.js";
import { RUBBER_WORDS, firstOverLimit, stoppageNotice } from "../../../../../../client/src/utils/limitNotice.js";
import {
  RUBBER_FIELD_ORDER,
  RUBBER_MINUTE_KEYS,
  RUBBER_TIME_WORDS,
  firstRubberError,
  validateRubberEntry,
} from "../../../../../../client/src/utils/rubberValidation.js";
import { isTimeRuleMessage, overlapErrors } from "../../../../../../client/src/utils/entryValidation.js";
import { hasRejectData, quantityFormValues, rejectPayload } from "../../../../../../client/src/utils/quantityRules.js";
import { hmToWireHours, hoursToShiftInput, parseShiftHours } from "../../../../../../client/src/utils/shiftHours.js";
import { RUBBER_COLUMNS } from "../../../../../../client/src/Components/Production/rubberColumns.jsx";

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

// ── copies of the page's pure handlers (RubberDataEntry.jsx) ────────────────
const TEXT_FIELDS = ["workingStatus", "itemName", "remarks", "otherMinRemark", "rejectOtherRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = ["totalCycleSec", "actualQty", "okQty", "plannedOperatorShiftHours", ...RUBBER_STOPPAGE_FIELDS.map((f) => f.key)];

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
  ...quantityFormValues(row),
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
// api/rubberSheet.api.js saveRubberRow: { machine, ...row } -> { ...row, worker: machine }
const savePayload = (body) => {
  const { machine, ...row } = body;
  return wire({ ...row, worker: machine });
};

// The form's per-block "has typed work" test (RubberEntryForm.jsx `hasData`).
const STOPPAGE_BOXES = RUBBER_STOPPAGE_FIELDS.filter((f) => f.key !== "lunchMin");
const LINES = [
  { id: 1, fields: ["date", "machine", "machineStatus"] },
  { id: 2, fields: ["itemName", "vendor", "totalCycleSec"] },
  { id: 3, fields: ["machineOnTime", "machineOffTime"] },
  { id: 5, fields: ["actualQty", "okQty"] },
  { id: 7, fields: ["plannedOperatorShiftHours", "lunchMin"] },
  { id: 8, fields: [...STOPPAGE_BOXES.map((f) => f.key), "stoppageTotal", "otherMinRemark"] },
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
const TIMES_OK = ["06:00", "07:30", "08:00", "9", "930", "0930", "9:30", "9.30", "13:15", "14:00", "16:00", "21:30", "22:00", "23:59", "00:00", "02:00", "05:45", "17:00"];
const TIMES_BAD = ["24:00", "9:5", "abc", "12345", "", "  ", "25", "7:60", null, undefined, 930, 9, "9-30"];
const NUMS = ["", undefined, null, "0", "1", "5", "10", "12.5", 3, 7.5, "  ", "abc", "-4", "1e2", "0x10", "45", 45, "120", "0.5", "600", "1440", "1441"];
const QTY = ["", undefined, null, "0", "10", "50", "100", "160", "163", "166", "250", "480", 320, 55, "12.5", "-3", "abc", "  ", "9999"];
const SPLIT = ["", undefined, null, "0", "1", "2", "5", "10", 3, "0.5", "-1", "abc", "  ", "40"];
const PLANNED = ["", undefined, "8", "8.30", "8.5", "9", "4", "7.45", "8.60", "0", "24", "24.5", "abc", "8,30", 8, 8.5, "1.5", "12", "-1", "3"];
const ITEMS = ["Rubber seal", "Grommet 7B", "Gasket", " Pad ", "X"];
const STATUSES = ["", "", "", "PRESENT", "ABSENT", "SUNDAY", "LEAVE", "HOLIDAY", "REPORT NOT FILLUP", " absent ", "present", "W/OFF", undefined, null, 7];
const STOP_KEYS = RUBBER_STOPPAGE_FIELDS.map((f) => f.key);

const randomSplit = (rejected) => {
  const split = {};
  let left = rejected;
  for (const reason of REJECT_REASONS) {
    if (left <= 0 || !chance(0.4)) continue;
    const n = int(0, left);
    split[reason] = String(n);
    left -= n;
  }
  if (left > 0 && chance(0.8)) split[pick(REJECT_REASONS)] = String(left + (Number(split.x) || 0));
  return split;
};

function saneRow(id) {
  const shifts = [["06:00", "14:00"], ["14:00", "22:00"], ["22:00", "06:00"], ["08:00", "16:00"], ["07:30", "15:45"], ["9", "17"], ["0930", "1330"], ["9:30", "18.15"]];
  const [on, off] = pick(shifts);
  const actual = int(0, 700);
  const ok = Math.max(0, actual - int(0, 30));
  const row = {
    _id: id,
    date: "2026-04-06",
    machine: "w" + int(1, 4),
    operator: "Worker " + int(1, 5),
    itemName: pick(ITEMS),
    machineOnTime: on,
    machineOffTime: off,
    totalCycleSec: pick(["30", "45", "60", "36", 45, "12.5", "3600", "176"]),
    actualQty: String(actual),
    okQty: String(ok),
    plannedOperatorShiftHours: pick([8, 8.5, 9, 12, 4, "8", 7.75]),
    lunchMin: pick(["0", "20", "30", "45", "", 30]),
    otherMin: pick(["", "0", "5", "15"]),
    remarks: pick(["", "ok", "late start"]),
  };
  if (chance(0.7)) row.rejectBreakdown = randomSplit(actual - ok);
  for (const k of ["plannedDownMin", "setupMin", "noManPowerMin", "materialShiftingMin", "noMaterialMin", "noPowerMin"]) if (chance(0.25)) row[k] = String(int(0, 40));
  return row;
}
function junkRow(id) {
  const row = { _id: id };
  if (chance(0.85)) row.itemName = pick([...ITEMS, " ", "", null, undefined, 7]);
  if (chance(0.9)) row.machineOnTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.9)) row.machineOffTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.7)) row.totalCycleSec = pick(NUMS);
  if (chance(0.15)) row.cycleTimeSec = pick(NUMS);
  if (chance(0.1)) row.drillingSec = pick(NUMS);
  if (chance(0.1)) row.excludedOps = pick([[], ["drillingSec"], null, ["nope"]]);
  if (chance(0.85)) row.actualQty = pick(QTY);
  if (chance(0.7)) row.okQty = pick(QTY);
  if (chance(0.25)) row.rejectedQty = pick(QTY);
  if (chance(0.4)) row.rejectBreakdown = Object.fromEntries(REJECT_REASONS.filter(() => chance(0.3)).map((r) => [r, pick(SPLIT)]));
  if (chance(0.5)) row.plannedOperatorShiftHours = pick([...NUMS, 8.5, 12]);
  for (const k of STOP_KEYS) if (chance(0.3)) row[k] = pick(NUMS);
  for (const k of ["bdMechMin", "bdEleMin", "otherActivityMin"]) if (chance(0.1)) row[k] = pick(NUMS);
  if (chance(0.3)) row.workingStatus = pick(STATUSES);
  if (chance(0.15)) row.workingMode = pick(["Working", "Non Working", "", undefined]);
  return row;
}

// ── rowCalc ─────────────────────────────────────────────────────────────────
const curated = [
  // The real sheet row quoted in the web source: 166 pcs where 163 was ideal.
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "176", actualQty: "166", okQty: "160", plannedOperatorShiftHours: 8.5, lunchMin: "30" },
  { itemName: "Seal", machineOnTime: "09:00", machineOffTime: "10:00", totalCycleSec: "30", actualQty: "80", okQty: "80", plannedOperatorShiftHours: 1 },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "600", okQty: "590", rejectBreakdown: { "Tool Mark": "6", Other: "4" }, plannedOperatorShiftHours: 8.5, lunchMin: "30", otherMin: "10", setupMin: "15", plannedDownMin: "20" },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "", okQty: "3" },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "3" },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "0", okQty: "0" },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "10", okQty: "20" },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "abc", okQty: "2" },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "10", okQty: "abc" },
  { itemName: "", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "10", okQty: "10" },
  { machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "10", okQty: "8" },
  { itemName: "Seal", totalCycleSec: "45", actualQty: "10", okQty: "9" },
  { itemName: "Seal", machineOnTime: "22:00", machineOffTime: "06:00", totalCycleSec: "36", actualQty: "700", okQty: "690", plannedOperatorShiftHours: 9 },
  { itemName: "Seal", machineOnTime: "23:59", machineOffTime: "00:00", totalCycleSec: "36", actualQty: "1", okQty: "1" },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "08:00", totalCycleSec: "36", actualQty: "0", okQty: "0" },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "0", actualQty: "10", okQty: "10" },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "-10", actualQty: "10", okQty: "10" },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "abc", actualQty: "10", okQty: "10" },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "97", actualQty: "10", okQty: "10", plannedOperatorShiftHours: 8, lunchMin: 480 },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "97", actualQty: "10", okQty: "10", plannedOperatorShiftHours: 0 },
  { itemName: "Seal", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "97", actualQty: "10", okQty: "10", plannedOperatorShiftHours: 8, setupMin: "500", noPowerMin: "100" },
  { itemName: "Seal", machineOnTime: 8, machineOffTime: 16, totalCycleSec: 45, actualQty: 600, okQty: 600 },
  { itemName: "Seal", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "1e400", actualQty: "5", okQty: "5" },
  { itemName: "Seal", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: true, okQty: "1" },
  { itemName: "Seal", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "5", rejectedQty: "1" }, // legacy, no Actual
  {},
];
const rowCases = [...curated];
for (let i = 0; i < 700 * SCALE; i += 1) rowCases.push(chance(0.5) ? saneRow("r" + i) : junkRow("r" + i));
const rowOut = rowCases.map((row) => ({ row: encIn(row), out: enc(rubberRowCalc(row)) }));
rowOut.push({ row: null, out: enc(rubberRowCalc(null)) });
write("row_calc.json", rowOut);

// isStatusOnly on the same rows; isRubberProcess on process documents.
write("helpers.json", {
  statusOnly: rowCases.map((row) => ({ row: encIn(row), statusOnly: isStatusOnly(row) })),
  rubberProcess: [
    { dataEntryMenu: "/hqepl/production/rubber-data-entry" },
    { dataEntryMenu: "/admin/production/rubber-data-entry/" },
    { dataEntryMenu: "/hqepl/production/rubber-data-entry-x" },
    { dataEntryMenu: "/hqepl/production/cnc-data-entry", processName: "RUBBER" },
    { dataEntryMenu: "", processName: "RUBBER" },
    { processName: "Rubber moulding" },
    { processName: "rubberised" },
    { processName: "RUBBER-2" },
    { processName: "CNC" },
    { dataEntryMenu: null, processName: null },
    {},
  ].map((p) => ({ process: p, rubber: isRubberProcess(p) })),
});

// ── dayCalc ─────────────────────────────────────────────────────────────────
const dayCases = [];
const addDay = (rows) => {
  const sorted = sortByMachineOn(rows);
  dayCases.push({ rows: encIn(rows), order: sorted.map((r) => r._id), out: enc(rubberDayCalc(sorted)) });
};
const mk = (id, on, off, extra = {}) => ({ _id: id, itemName: "Seal", machineOnTime: on, machineOffTime: off, totalCycleSec: "45", actualQty: "100", okQty: "96", plannedOperatorShiftHours: 8, ...extra });
addDay([]);
addDay([mk("a", "08:00", "16:00", { totalCycleSec: "176", actualQty: "166", okQty: "160", plannedOperatorShiftHours: 8.5, lunchMin: "30" })]);
addDay([mk("a", "14:00", "22:00", { lunchMin: "30" }), mk("b", "06:00", "13:30", { lunchMin: "20", setupMin: "15" }), mk("c", "22:00", "02:00")]);
addDay([mk("a", "06:00", "10:00"), mk("b", "10:00", "14:00"), mk("c", "13:00", "18:00")]);
addDay([mk("a", "06:00", "10:00"), mk("b", "11:15", "14:00"), mk("c", "16:45", "23:00")]);
addDay([mk("a", "", "10:00"), mk("b", "06:00", "10:00"), mk("c", "abc", "")]);
addDay([mk("a", "", ""), mk("b", "", "")]);
addDay([mk("a", "08:00", "16:00"), mk("b", "08:00", "12:00"), mk("c", "08:00", "10:00")]);
addDay([null, mk("a", "08:00", "16:00"), null]);
addDay([mk("a", "08:00", "16:00", { itemName: "" })]);
addDay([mk("a", "08:00", "16:00", { lunchMin: "abc", otherMin: "x" })]);
addDay([mk("a", "08:00", "16:00", { plannedOperatorShiftHours: "" })]);
addDay([mk("a", "08:00", "16:00", { plannedOperatorShiftHours: undefined, actualQty: "" })]);
addDay([mk("a", "08:00", "16:00", { plannedDownMin: "60", lunchMin: "30" })]);
addDay([mk("a", "08:00", "16:00", { lunchMin: "480", plannedOperatorShiftHours: 8 })]);
for (let i = 0; i < 300 * SCALE; i += 1) {
  const n = int(1, 4);
  const rows = [];
  for (let j = 0; j < n; j += 1) {
    const r = chance(0.7) ? saneRow(`d${i}_${j}`) : junkRow(`d${i}_${j}`);
    if (chance(0.5)) r.machineOffTime = pick(TIMES_OK);
    if (chance(0.4)) r.lunchMin = pick(["", "0", "20", "30", 30, "abc"]);
    if (chance(0.3)) r.plannedDownMin = pick(["", "5", "15", "x", 20]);
    if (chance(0.2)) r.setupMin = pick(["", "5", "15", "x"]);
    rows.push(r);
  }
  addDay(rows);
}
write("day_calc.json", dayCases);

// ── validateRubberEntry ─────────────────────────────────────────────────────
// A fully valid block: 8 h shift, 45 s per piece, 600 made, 590 OK, planned 8.30.
const baseValid = () => ({
  date: "2026-04-06",
  machine: "w1",
  machineStatus: [],
  workingMode: "Working",
  itemName: "Seal",
  vendor: "",
  machineOnTime: "08:00",
  machineOffTime: "16:00",
  totalCycleSec: "45",
  actualQty: "600",
  okQty: "590",
  rejectBreakdown: { "Tool Mark": "6", "Surface Finish": "4" },
  rejectOtherRemark: "",
  plannedOperatorShiftHours: "8.30",
  lunchMin: "30",
  plannedDownMin: "",
  setupMin: "",
  noManPowerMin: "",
  materialShiftingMin: "",
  noMaterialMin: "",
  noPowerMin: "",
  otherMin: "",
  otherMinRemark: "",
  remarks: "",
});
const valMutations = [
  {}, { date: "" }, { date: null }, { date: "  " }, { machine: "" }, { machine: undefined }, { itemName: "" }, { itemName: null }, { itemName: "   " },
  { workingMode: "Non Working" }, { workingMode: "Non Working", date: "", machine: "" }, { workingMode: "Non Working", machineStatus: ["No Manpower"] },
  { workingStatus: "ABSENT" }, { workingStatus: "SUNDAY", machine: "" }, { workingStatus: "PRESENT" }, { workingStatus: "present" }, { workingStatus: " LEAVE " }, { workingStatus: "ABSENT", date: "" },
  { workingStatus: "ABSENT", itemName: "", actualQty: "" }, { workingStatus: 5 }, { workingStatus: null },
  { machineOnTime: "" }, { machineOffTime: "" }, { machineOnTime: "abc" }, { machineOffTime: "25:00" }, { machineOnTime: "9" }, { machineOffTime: "17.30" }, { machineOnTime: "0800" }, { machineOnTime: 8 },
  { machineOnTime: "", machineOffTime: "" }, { machineOnTime: "22:00", machineOffTime: "06:00" }, { machineOnTime: "08:00", machineOffTime: "08:00" }, { machineOnTime: "23:59", machineOffTime: "00:00" },
  { vendor: "v1" }, { vendorName: "Acme" },
  { totalCycleSec: "" }, { totalCycleSec: "0" }, { totalCycleSec: "abc" }, { totalCycleSec: "-3" }, { totalCycleSec: "1" }, { totalCycleSec: 45 }, { totalCycleSec: "  " }, { totalCycleSec: undefined },
  { actualQty: "" }, { actualQty: undefined }, { actualQty: "abc" }, { actualQty: "-1" }, { actualQty: "  " }, { actualQty: "0", okQty: "0", rejectBreakdown: {} }, { actualQty: "0" }, { actualQty: 600 },
  { actualQty: "12.5", okQty: "12", rejectBreakdown: {} }, { actualQty: "1e2", okQty: "100", rejectBreakdown: {} }, { actualQty: "9999" }, { actualQty: "700" }, { actualQty: "640" }, { actualQty: "641", okQty: "631" },
  { okQty: "" }, { okQty: undefined }, { okQty: "abc" }, { okQty: "-1" }, { okQty: "600", rejectBreakdown: {} }, { okQty: "601" }, { okQty: "589.5" }, { okQty: 590 }, { okQty: "  " },
  { rejectBreakdown: {} }, { rejectBreakdown: { "Tool Mark": "10" } }, { rejectBreakdown: { "Tool Mark": "11" } }, { rejectBreakdown: { "Tool Mark": "abc" } }, { rejectBreakdown: { "Tool Mark": "-1", Other: "11" } },
  { rejectBreakdown: { Other: "10" } }, { rejectBreakdown: { Other: "10" }, rejectOtherRemark: "flash" }, { rejectBreakdown: { Other: "10" }, rejectOtherRemark: "  " }, { rejectBreakdown: { Other: "0", "Tool Mark": "10" } },
  { rejectBreakdown: { "Tool Mark": "5.5", "Surface Finish": "4.5" } }, { rejectBreakdown: { "Tool Mark": "" , "Surface Finish": "" } }, { rejectBreakdown: { Nope: "10" } }, { rejectBreakdown: null },
  { okQty: "600", rejectBreakdown: { "Tool Mark": "1" } }, { actualQty: "", rejectBreakdown: { Other: "3" } },
  { plannedOperatorShiftHours: "" }, { plannedOperatorShiftHours: undefined }, { plannedOperatorShiftHours: "0" }, { plannedOperatorShiftHours: "-1" }, { plannedOperatorShiftHours: "24" }, { plannedOperatorShiftHours: "24.01" }, { plannedOperatorShiftHours: "25" },
  { plannedOperatorShiftHours: "abc" }, { plannedOperatorShiftHours: "8" }, { plannedOperatorShiftHours: "7.59" }, { plannedOperatorShiftHours: "7.60" }, { plannedOperatorShiftHours: "8.5" }, { plannedOperatorShiftHours: "8,30" },
  { plannedOperatorShiftHours: "8.004" }, { plannedOperatorShiftHours: 8.5 }, { plannedOperatorShiftHours: 8 }, { plannedOperatorShiftHours: "1.5" }, { plannedOperatorShiftHours: "0.30" },
  { plannedOperatorShiftHours: "9", machineOnTime: "22:00", machineOffTime: "06:00" }, { plannedOperatorShiftHours: "7", machineOnTime: "22:00", machineOffTime: "06:00" },
  { machineOnTime: "", plannedOperatorShiftHours: "0.30" }, { machineOffTime: "abc", plannedOperatorShiftHours: "0.30" },
  { lunchMin: "" }, { lunchMin: undefined }, { lunchMin: "0" }, { lunchMin: "abc" }, { lunchMin: "-1" }, { lunchMin: "1440" }, { lunchMin: "1441" }, { lunchMin: "  " }, { lunchMin: 30 }, { lunchMin: "12.5" },
  { lunchMin: "480" }, { lunchMin: "481" }, { lunchMin: "479", otherMin: "1", otherMinRemark: "r" }, { lunchMin: "479", otherMin: "2", otherMinRemark: "r" },
  { setupMin: "20" }, { setupMin: "abc" }, { setupMin: "-1" }, { setupMin: "1441" }, { plannedDownMin: "450" }, { plannedDownMin: "451" }, { noManPowerMin: "60", noMaterialMin: "60", noPowerMin: "60" },
  { materialShiftingMin: "12.5" }, { noPowerMin: 10 }, { setupMin: "200", plannedDownMin: "200", noPowerMin: "51" }, { bdMechMin: "500" }, { bdEleMin: "abc" },
  { otherMin: "5" }, { otherMin: "5", otherMinRemark: "" }, { otherMin: "5", otherMinRemark: "  " }, { otherMin: "5", otherMinRemark: "power cut" }, { otherMin: "0" }, { otherMin: "0", otherMinRemark: "" },
  { otherMin: "abc" }, { otherMin: "-1" }, { otherMin: "1441", otherMinRemark: "r" }, { otherMin: "450", otherMinRemark: "r" }, { otherMin: "451", otherMinRemark: "r" }, { otherMin: "10", otherMinRemark: "r", lunchMin: "20" },
  { machineOnTime: "", lunchMin: "5000" }, { machineOnTime: "", otherMin: "9999" }, { machineOnTime: "abc", setupMin: "5000" },
  { date: "", machine: "", itemName: "" },
  { date: "", machine: "", itemName: "", machineOnTime: "", machineOffTime: "", actualQty: "", okQty: "", plannedOperatorShiftHours: "", lunchMin: "", totalCycleSec: "" },
  { actualQty: "700", okQty: "800", plannedOperatorShiftHours: "0", lunchMin: "-1", otherMin: "9", setupMin: "9999", totalCycleSec: "0" },
  { machineOnTime: "6:00", machineOffTime: "14:00", plannedOperatorShiftHours: "8", lunchMin: "" },
  { machineOnTime: "6:00", machineOffTime: "14:00", plannedOperatorShiftHours: "7.59", lunchMin: "0" },
];
const valInputs = valMutations.map((m) => dropUndefined({ ...baseValid(), ...m }));
for (let i = 0; i < 320 * SCALE; i += 1) {
  valInputs.push(dropUndefined({ ...baseValid(), ...pick(valMutations), ...pick(valMutations), ...pick(valMutations) }));
}
// Whole random rows too, in the form's own typed-string shape.
for (let i = 0; i < 120 * SCALE; i += 1) {
  const r = junkRow("v" + i);
  r.machine = pick(["w1", "", undefined, "  "]);
  r.date = pick(["2026-04-06", "", undefined]);
  valInputs.push(dropUndefined(r));
}
const savedVariants = [null, { machineOnTime: "08:00", machineOffTime: "16:00" }, { machineOnTime: "9", machineOffTime: "8" }, { machineOnTime: "bad", machineOffTime: "" }, { machineOnTime: "0800", machineOffTime: "1600" }];
const valCases = [];
for (const v of valInputs) {
  const saved = pick(savedVariants);
  const errors = saved ? validateRubberEntry(v, { saved }) : validateRubberEntry(v);
  valCases.push({ values: encIn(v), saved, errors });
}
write("validation.json", valCases);

// Which messages speak up before Save (the time rules), in this sheet's words.
const messages = [...new Set(valCases.flatMap((c) => Object.values(c.errors)))];
write("live_messages.json", messages.map((m) => ({ message: m, live: isTimeRuleMessage(m) })));

// firstRubberError over lists of error maps
const errLists = [];
for (let i = 0; i < 80; i += 1) {
  const list = [];
  for (let j = 0; j < int(0, 3); j += 1) list.push(pick(valCases).errors);
  if (chance(0.15)) list.push(null);
  errLists.push(list);
}
errLists.push([], [{}], [{ zzz: "x", date: "d" }], [{}, { zzz: "only unknown" }]);
write("first_error.json", {
  order: RUBBER_FIELD_ORDER,
  minuteKeys: RUBBER_MINUTE_KEYS,
  cases: errLists.map((list) => ({ errors: list, first: firstRubberError(list.map((e) => e || {})) })),
});

// The overlap rule in the worker's words (the page passes RUBBER_TIME_WORDS).
const overlapCases = [];
const occupied = { "w1|2026-04-06": [{ slot: 1, machineOnTime: "08:00", machineOffTime: "12:00" }, { slot: 2, machineOnTime: "13:00", machineOffTime: "15:00" }] };
for (const [on, off] of [["09:00", "10:00"], ["07:00", "09:00"], ["11:30", "13:30"], ["12:00", "13:00"], ["06:00", "08:00"], ["14:00", "18:00"], ["15:00", "16:00"], ["07:00", "16:00"]]) {
  for (const editSlot of [null, 1]) {
    const entries = [{ ...baseValid(), machineOnTime: on, machineOffTime: off }];
    overlapCases.push({ entries: encIn(entries), occupied, editSlot, out: overlapErrors(entries, occupied, { editSlot, words: RUBBER_TIME_WORDS }) });
  }
}
// Two blocks of the same worker and date in one form.
const twin = [{ ...baseValid(), machineOnTime: "08:00", machineOffTime: "10:00" }, { ...baseValid(), machineOnTime: "09:30", machineOffTime: "11:00" }];
overlapCases.push({ entries: encIn(twin), occupied: {}, editSlot: null, out: overlapErrors(twin, {}, { words: RUBBER_TIME_WORDS }) });
write("overlap.json", { words: RUBBER_TIME_WORDS, cases: overlapCases });

// ── values / payload ────────────────────────────────────────────────────────
const stored = (extra = {}) => ({
  _id: "e" + int(1, 99999),
  date: "2026-04-06",
  worker: "w1",
  machine: "w1",
  process: "p1",
  operator: "Asha",
  slot: pick([1, 2, 3]),
  item: pick(["i1", null]),
  itemName: "Seal",
  vendor: pick([null, "v1"]),
  vendorName: pick(["", "Acme"]),
  totalCycleSec: 45,
  machineOnTime: "08:00",
  machineOffTime: "16:00",
  actualQty: pick([600, undefined, null]),
  okQty: 590,
  rejectedQty: pick([10, undefined]),
  rejectBreakdown: pick([{ "Tool Mark": 6, "Surface Finish": 4 }, {}, undefined, { Other: 10, Nope: 2 }]),
  rejectReason: pick(["", "Tool Mark", "Porosity / Blow Hole", undefined]),
  rejectOtherRemark: pick(["", "flash"]),
  plannedOperatorShiftHours: pick([8.5, 8, 7.75, 3.833333, null]),
  lunchMin: pick([30, 0, undefined]),
  setupMin: pick([undefined, 15]),
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
    const values = { ...v, _id: pick([undefined, "e1", ""]), slot: pick([1, 2, 3, "2", undefined, "abc"]), item: pick(["", "i1", undefined]) };
    dropUndefined(values);
    const processId = pick(["p1", "p2"]);
    payloadCases.push({ values: encIn(values), isEdit, processId, payload: savePayload(toPayload(values, isEdit, processId)) });
  }
}
// status-only / non-working days with leftovers typed in the hidden boxes
for (const extra of [{ workingStatus: "ABSENT" }, { workingMode: "Non Working", machineStatus: ["No Manpower", "Machine Breakdown"] }, { workingStatus: "SUNDAY", remarks: " note " }]) {
  for (const isEdit of [false, true]) {
    const values = { ...baseValid(), ...extra, item: "i1", vendor: "v1", _id: "e9", slot: 2, rejectBreakdown: { Other: "10" }, rejectOtherRemark: "x" };
    payloadCases.push({ values: encIn(values), isEdit, processId: "p1", payload: savePayload(toPayload(values, isEdit, "p1")) });
  }
}
write("payload.json", payloadCases);

// hasAnyEntryData / block has-data / item selection / draft merge
const dataCases = [];
const dataInputs = [
  ...valInputs.slice(0, 60),
  emptyEntry(),
  { ...emptyEntry(), machine: "w1" },
  { ...emptyEntry(), workingMode: "Non Working" },
  { ...emptyEntry(), machineStatus: ["No Planning"] },
  { ...emptyEntry(), workingStatus: "ABSENT" },
  { ...emptyEntry(), remarks: "x" },
  { ...emptyEntry(), lunchMin: "0" },
  { ...emptyEntry(), vendor: "v1" },
  { ...emptyEntry(), slot: 3 },
  { ...emptyEntry(), rejectBreakdown: { Other: "0" } },
  { ...emptyEntry(), rejectBreakdown: { Other: "2" } },
  { ...emptyEntry(), rejectBreakdown: { Other: "" } },
  { ...emptyEntry(), rejectOtherRemark: "why" },
  { ...emptyEntry(), noPowerMin: "5" },
];
for (const v of dataInputs) dataCases.push({ values: encIn(v), blockHasData: blockHasData(v), anyData: hasAnyEntryData([v]) });
dataCases.push({ list: [encIn(emptyEntry()), encIn({ ...emptyEntry(), machine: "w1" })], anyData: true });
dataCases.push({ list: [encIn(emptyEntry()), encIn(emptyEntry())], anyData: false });
write("has_data.json", dataCases);

const items = [
  { _id: "i1", itemName: "Seal", totalCycleSec: 45, process: "p1" },
  { _id: "i2", itemName: "Cap", totalCycleSec: null },
  { _id: "i3", itemName: "Grommet", totalCycleSec: "" },
  { _id: "i4", itemName: "Slow", totalCycleSec: 12.5 },
];
const itemCases = [];
for (const id of ["", "i1", "i2", "i3", "i4", "nope"]) {
  const v = dropUndefined({ ...baseValid(), item: "iX", itemName: "Old", totalCycleSec: "99" });
  itemCases.push({ values: encIn(v), itemId: id, out: enc(handleItemSelect(v, id, items)) });
}
write("item_select.json", { items, cases: itemCases });

// the formulas map, the stoppage fields and the statuses
write("formulas.json", RUBBER_FORMULAS);
write("fields.json", { stoppage: RUBBER_STOPPAGE_FIELDS, nonWorking: NON_WORKING_STATUSES, rejectReasons: REJECT_REASONS, words: RUBBER_WORDS });

// firstOverLimit as the page's Save calls it: no quantity check (qtyKey null — OK + Rejected
// may beat Ideal and goes to OEE Review), RUBBER's words, workers named by id.
const overCases = [];
const overNames = { w1: "Asha", w2: "Ravi" };
const overBlock = () => {
  const b = dropUndefined({ ...baseValid(), ...pick(valMutations), machine: pick(["w1", "w2", "w9"]) });
  if (chance(0.7)) {
    b.machineOnTime = pick(["08:00", "09:30", "07:00"]);
    b.machineOffTime = pick(["09:00", "10:30", "16:00", "08:00"]);
    b.lunchMin = pick(["", "0", "30", "45", "70"]);
    b.otherMin = pick(["", "0", "10", "40"]);
    b.otherMinRemark = pick(["", "why"]);
    b.setupMin = pick(["", "0", "20", "50", "90"]);
    b.actualQty = pick(["", "100", "9999"]);
  }
  return b;
};
for (let i = 0; i < 160 * SCALE; i += 1) {
  const blocks = Array.from({ length: int(1, 3) }, overBlock);
  const errors = blocks.map((b) => validateRubberEntry(b));
  const out = firstOverLimit(blocks, errors, rubberRowCalc, { qtyKey: null, words: RUBBER_WORDS, machineName: overNames });
  overCases.push({ blocks: encIn(blocks), errors: encIn(errors), machineName: overNames, out: enc(out) });
}
write("first_over_limit.json", overCases);

// The stoppage popup a capped box raises, in RUBBER's words.
write(
  "stoppage_notice.json",
  [[480, 500, ""], [60, 61, "Asha"], [450, 452.5, "Ravi"], [0, 1, ""]].map(([limitMin, totalMin, machine]) => ({
    limitMin,
    totalMin,
    machine,
    out: stoppageNotice({ limitMin, totalMin, machine, words: RUBBER_WORDS }),
  })),
);

// ── table cells (the REAL rubberColumns.jsx) ────────────────────────────────
// A cell is a string, a number or a React element: WithRemark (its `value`), a
// red over-100% <span> (its text). The review badge and the general-remark eye
// are covered by the shared web-parity fixtures (review.json), so they're left out.
// A React element, without importing React (it lives in client/node_modules).
const isValidElement = (el) => !!el && typeof el === "object" && typeof el.$$typeof === "symbol" && "props" in el;
const textOf = (el) => {
  if (el === null || el === undefined || el === false) return "";
  if (typeof el === "string" || typeof el === "number") return String(el);
  if (Array.isArray(el)) return el.map(textOf).join("");
  if (isValidElement(el)) {
    const name = typeof el.type === "string" ? el.type : el.type?.name;
    if (name === "WithRemark") return textOf(el.props.value);
    if (name === "span") return textOf(el.props.children);
    return { $skip: name || "element" };
  }
  return String(el);
};
const flatColumns = RUBBER_COLUMNS.flatMap((c) => (c.expandable ? [c.summary, ...c.columns] : [c]));
const cellRows = [];
for (let i = 0; i < 40 * SCALE; i += 1) {
  const r = i < 30 ? saneRow("t" + i) : junkRow("t" + i);
  r.machine = pick(["w1", "w2", "w9"]);
  r.date = pick(["2026-04-06", "2026-04-07"]);
  if (chance(0.3)) r.vendorName = pick(["Acme", ""]);
  if (chance(0.2)) r.workingMode = "Non Working";
  if (chance(0.2)) r.machineStatus = pick([["No Manpower"], [], ["No Planning", "No Manpower"]]);
  if (chance(0.3)) r.rejectOtherRemark = "flash";
  if (chance(0.3)) r.otherMinRemark = "power cut";
  cellRows.push(r);
}
const cellCtx = { machineName: { w1: "Asha", w2: "Ravi" } };
const dayOf = {};
const groups = {};
for (const r of cellRows) (groups[`${r.machine}|${r.date}`] ||= []).push(r);
for (const group of Object.values(groups)) {
  const sorted = sortByMachineOn(group);
  const results = rubberDayCalc(sorted);
  sorted.forEach((r, i) => {
    dayOf[r._id] = results[i];
  });
}
write("cells.json", {
  columns: flatColumns.map((c) => ({ key: c.key, label: c.label })),
  groups: RUBBER_COLUMNS.filter((c) => c.expandable).map((c) => ({ key: c.key, label: c.label, summary: c.summary.key, columns: c.columns.map((s) => s.key) })),
  machineName: cellCtx.machineName,
  rows: cellRows.map((r) => {
    const c = rubberRowCalc(r);
    const d = dayOf[r._id];
    return { row: encIn(r), cells: Object.fromEntries(flatColumns.map((col) => [col.key, textOf(col.get(r, c, d, cellCtx))])) };
  }),
});

console.log("ok", { rows: rowOut.length, days: dayCases.length, validation: valCases.length, payload: payloadCases.length, cells: cellRows.length });
