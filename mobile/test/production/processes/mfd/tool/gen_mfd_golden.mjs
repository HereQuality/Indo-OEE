// Golden-fixture generator for test/production/processes/mfd/*.
//
// Runs the REAL client/src/utils/mfdSheet.js + mfdValidation.js (and the shared
// productionSheet.js / entryValidation.js / quantityRules.js / shiftHours.js /
// limitNotice.js they import), the REAL table columns
// (Components/Production/mfdColumns.jsx, rendered with react-dom/server) and the
// REAL dashboard `summarize` (utils/processDashboard.js) over a broad,
// deterministic (seeded) input set and writes the JSON the Dart tests compare
// against. client/ is only READ. The page's own pure handlers are copied from
// client/src/pages/ModularFrameDrillingDataEntry.jsx and the form's "has typed
// work" test from Components/Production/MfdEntryForm.jsx below.
//
//   cd mobile
//   ESB=../client/node_modules/.bin/esbuild
//   NODE_PATH=$PWD/../client/node_modules $ESB test/production/processes/mfd/tool/gen_mfd_golden.mjs \
//        --bundle --platform=node --format=esm --loader:.js=jsx --loader:.css=empty \
//        --define:import.meta.env='{}' \
//        --banner:js="import {createRequire} from 'module';const require=createRequire(import.meta.url);" \
//        --outfile=<scratch>/mfd-golden/gen.mjs
//   OUT_DIR=test/production/processes/mfd/fixtures TZ=Asia/Kolkata node <scratch>/mfd-golden/gen.mjs
//
// JSON cannot carry NaN/Infinity/undefined, so those are written as markers:
//   {"$n":"NaN"|"Inf"|"-Inf"}   and   {"$u":1} (undefined).

import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { STOPPAGE_FIELDS, isoDay, sortByMachineOn, spanMinutes } from "../../../../../../client/src/utils/productionSheet.js";
import {
  MFD_FORMULAS,
  MFD_MAX_SLOTS,
  MFD_OPERATIONS,
  MFD_STOPPAGE_FIELDS,
  fmtIdeal,
  fmtIdealPerHour,
  isMfdProcess,
  mfdDayCalc,
  mfdRowCalc,
} from "../../../../../../client/src/utils/mfdSheet.js";
import { MFD_DOWNTIME_KEYS, MFD_FIELD_ORDER, MFD_MINUTE_KEYS, firstMfdError, validateMfdEntry } from "../../../../../../client/src/utils/mfdValidation.js";
import { firstOverLimit, qtyNotice } from "../../../../../../client/src/utils/limitNotice.js";
import { quantityFormValues } from "../../../../../../client/src/utils/quantityRules.js";
import { hmToWireHours, hoursToShiftInput, parseShiftHours } from "../../../../../../client/src/utils/shiftHours.js";
import { summarize } from "../../../../../../client/src/utils/processDashboard.js";
import { MFD_COLUMNS } from "../../../../../../client/src/Components/Production/mfdColumns.jsx";

const OUT = process.env.OUT_DIR;
if (!OUT) throw new Error("set OUT_DIR");
fs.mkdirSync(OUT, { recursive: true });

// RemarkCell's useLayoutEffect warns under the server renderer — harmless here.
const realError = console.error;
console.error = (...a) => (String(a[0]).includes("useLayoutEffect") ? undefined : realError(...a));

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

// ── copies of the page's pure handlers (ModularFrameDrillingDataEntry.jsx) ─
const STOPPAGE_KEYS = STOPPAGE_FIELDS.map((f) => f.key);
const TEXT_FIELDS = ["operator", "itemName", "drawingNo", "operation", "remarks", "otherMinRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime", "settingOnTime", "settingOffTime"];
const NUMBER_FIELDS = ["noOfHoles", "strokeRequired", "totalCycleSec", "actualQty", "okQty", "plannedOperatorShiftHours", ...STOPPAGE_KEYS];

const hasAnyEntryData = (list) =>
  list.some((v) => {
    if (v.machine) return true;
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
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, ""])),
});

const toFormValues = (row) => ({
  ...emptyEntry(),
  ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)),
  item: row.item || "",
  slot: row.slot,
  actualQty: quantityFormValues(row).actualQty,
  plannedOperatorShiftHours: hoursToShiftInput(row.plannedOperatorShiftHours),
});

const STATUS_ONLY_KEPT = ["operator", "workingMode", "machineStatus", "remarks"];
const toPayload = (v, isEdit) => {
  const body = toFullPayload(v, isEdit);
  if (v.workingMode !== "Non Working") return body;
  return Object.fromEntries(
    Object.entries(body).map(([k, val]) =>
      ["_id", "date", "machine", "slot", ...STATUS_ONLY_KEPT].includes(k) ? [k, val] : [k, k === "item" ? null : ""],
    ),
  );
};
const toFullPayload = (v, isEdit) => ({
  ...(isEdit && v._id ? { _id: v._id } : {}),
  date: v.date,
  machine: v.machine,
  machineStatus: v.workingMode === "Non Working" ? v.machineStatus || [] : [],
  workingMode: v.workingMode || "Working",
  slot: isEdit ? Number(v.slot) : "auto",
  item: v.item || null,
  vendor: v.vendor || null,
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

const withPart = (v, it) => ({
  ...v,
  item: it._id,
  itemName: it.itemName,
  drawingNo: it.drawingNo || "",
  operation: it.mfdOperation || "",
  noOfHoles: it.noOfHoles ?? "",
  strokeRequired: it.strokeRequired ?? "",
  totalCycleSec: it.totalCycleSec ?? "",
});
const NO_PART = { item: "", itemName: "", drawingNo: "", operation: "", noOfHoles: "", strokeRequired: "", totalCycleSec: "" };
const handleItemSelect = (v, itemId, items) => {
  if (!itemId) return { ...v, ...NO_PART };
  const it = items.find((item) => item._id === itemId);
  if (!it) return { ...v, item: "" };
  return withPart(v, it);
};

// The form's per-block "has typed work" test (MfdEntryForm.jsx LINES / DATA_KEYS / hasData).
const LINE_FIELDS = [
  ["date", "machine", "operator", "workingMode", "machineStatus"],
  ["itemName", "vendor", "totalCycleSec"],
  ["machineOnTime", "machineOffTime"],
  ["settingOnTime", "settingOffTime"],
  ["actualQty", "okQty"],
  ["plannedOperatorShiftHours", "lunchMin"],
  [...MFD_DOWNTIME_KEYS, "stoppageTotal", "otherMinRemark"],
  ["remarks"],
];
const DATA_KEYS = LINE_FIELDS.flat().filter((k) => !["date", "machine", "workingMode", "stoppageTotal"].includes(k));
const blockHasData = (v) =>
  v.workingMode === "Non Working" || DATA_KEYS.some((k) => (Array.isArray(v[k]) ? v[k].length > 0 : v[k] !== "" && v[k] !== undefined && v[k] !== null));

// ── value pools ─────────────────────────────────────────────────────────────
const TIMES_OK = ["08:30", "18:00", "11:30", "12:30", "16:30", "17:55", "18:55", "06:00", "9", "930", "0930", "9:30", "9.30", "13:15", "14:00", "22:00", "23:59", "00:00", "02:00"];
const TIMES_BAD = ["24:00", "9:5", "abc", "12345", "", "  ", "25", "7:60", null, undefined, 930, 9, "9-30"];
const NUMS = ["", undefined, null, "0", "1", "5", "10", "12.5", 3, 7.5, "  ", "abc", "-4", "1e2", "0x10", "45", 45, "120", "0.5", "600", "1440", "1441"];
const QTY = ["", undefined, null, "0", "10", "608", "600", "1500", "1608", "1600", 828, 825, "12.5", "-3", "abc", "  ", "99999"];
const STD = ["20", "50", "22", "35", "4", "56", 20, 50, "45", "62", "0", "-2", "abc", "", "  ", "1e400", 12.5];
const PLANNED = ["", undefined, "8", "8.30", "8.5", "9", "9.5", "9.42", "3", "4", "7.45", "8.60", "0", "24", "24.5", "abc", "8,30", 8, 9.5, "1.5", "12", "-1"];
const ITEMS = ["24 PIN FRAME", "DUST COVER CLAMP", "6 PIN FRAME", " 3 PIN HOOD ", "X"];
const STATUSES = ["", "", "", "PRESENT", "ABSENT", "SUNDAY", "LEAVE", "HOLIDAY", "REPORT NOT FILLUP", " absent ", "present", "W/OFF", "M/C OFF", undefined, null, 7];

// The paper sheet's rows (utils/mfdSheet.test.mjs): [ON, OFF, Cycle (s), ACTUAL OK, Rejected, downtime, Process, Holes, Stroke].
const PAPER = [
  ["14:50", "15:25", 20, 75, 0, {}, "DRILLING", 1, 1],
  ["08:15", "18:55", 50, 99, 0, { materialShiftingMin: 115, lunchMin: 30 }, "DRILLING", 2, 2],
  ["08:15", "12:00", 22, 462, 0, {}, "DRILLING", 2, 2],
  ["11:00", "18:00", 23, 946, 0, { lunchMin: 30 }, "DRILLING", 2, 2],
  ["16:05", "18:55", 35, 215, 0, {}, "TAPPING", 4, 4],
  ["08:10", "18:45", 56, 600, 0, { lunchMin: 30 }, "DRILLING", 1, 1],
  ["15:40", "18:00", 36, 140, 7, {}, "DRILLING", 2, 2],
  ["08:10", "15:00", 47, 425, 5, { lunchMin: 30 }, "DRRILL/CHAM", 2, 2],
];
// A paper row as the form saves it: Actual = OK + Rejected, Planned = its Machine Shift.
const paperRow = ([on, off, cycle, ok, rej, stops, operation, holes, stroke], o = {}) => ({
  _id: `${on}-${off}-${cycle}`,
  date: "2024-05-10",
  machine: "m1",
  operator: "VISHAL",
  itemName: "24 PIN FRAME",
  drawingNo: "IE0726",
  operation,
  noOfHoles: holes,
  strokeRequired: stroke,
  totalCycleSec: cycle,
  machineOnTime: on,
  machineOffTime: off,
  actualQty: ok + rej,
  okQty: ok,
  plannedOperatorShiftHours: spanMinutes(on, off) / 60,
  ...stops,
  ...o,
});

function saneRow(id) {
  const [on, off] = pick([["08:15", "18:55"], ["14:50", "15:25"], ["08:15", "12:00"], ["11:00", "18:00"], ["06:00", "14:00"], ["14:00", "22:00"], ["9", "17"], ["0930", "1330"], ["9:30", "18.15"]]);
  const std = pick([20, 50, 22, 35, 4, 56, 45, 62, "20", "12.5"]);
  const shift = spanMinutes(on, off);
  const lunch = pick([0, 0, 30, 45, "30", ""]);
  const ideal = shift ? Math.max(0, Math.floor(((shift - (Number(lunch) || 0)) * 60) / Number(std))) : 100;
  const total = int(0, Math.max(0, chance(0.1) ? ideal + 5 : ideal));
  const row = {
    _id: id,
    date: "2024-05-10",
    machine: "m" + int(1, 3),
    operator: pick(["VISHAL", "MEENA", "Op 7"]),
    itemName: pick(ITEMS),
    drawingNo: pick(["IE0726", "", "IE0117"]),
    operation: pick(MFD_OPERATIONS),
    noOfHoles: pick([1, 2, 4, "", "2"]),
    strokeRequired: pick([1, 2, 4, ""]),
    lunchMin: lunch,
    machineOnTime: on,
    machineOffTime: off,
    totalCycleSec: std,
    actualQty: chance(0.8) ? total : String(total),
    okQty: int(Math.max(0, total - 20), total),
    plannedOperatorShiftHours: pick([shift ? shift / 60 : 8, 8, 9.5, 12, 4, "8", 7.75]),
    remarks: pick(["", "ok", "burr on hole"]),
  };
  if (chance(0.3)) Object.assign(row, { settingOnTime: pick(["08:00", "14:30", "9"]), settingOffTime: pick(["08:15", "14:50", ""]) });
  for (const f of MFD_STOPPAGE_FIELDS) if (f.key !== "lunchMin" && chance(0.3)) row[f.key] = pick([0, 5, 10, 15, 30, "20", ""]);
  if (chance(0.15)) row.plannedLocked = true;
  return row;
}
function junkRow(id) {
  const row = { _id: id };
  if (chance(0.85)) row.itemName = pick([...ITEMS, " ", "", null, undefined, 7]);
  if (chance(0.9)) row.machineOnTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.9)) row.machineOffTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.8)) row.totalCycleSec = pick([...STD, ...NUMS]);
  if (chance(0.1)) row.cycleTimeSec = pick(NUMS);
  if (chance(0.85)) row.actualQty = pick(QTY);
  if (chance(0.7)) row.okQty = pick(QTY);
  if (chance(0.2)) row.rejectedQty = pick(QTY);
  if (chance(0.5)) row.plannedOperatorShiftHours = pick([...NUMS, 8.5, 12, 9.5]);
  for (const f of MFD_STOPPAGE_FIELDS) if (chance(0.25)) row[f.key] = pick(NUMS);
  if (chance(0.2)) row.noOfHoles = pick(NUMS);
  if (chance(0.2)) row.settingOnTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.3)) row.workingStatus = pick(STATUSES);
  if (chance(0.15)) row.workingMode = pick(["Working", "Non Working", "", undefined]);
  if (chance(0.1)) row.plannedLocked = pick([true, false, "true"]);
  if (chance(0.1)) row.runQtyBasis = pick(["ok", "total"]);
  return row;
}

// ── rowCalc ─────────────────────────────────────────────────────────────────
const curated = [
  ...PAPER.map((r) => paperRow(r)),
  paperRow(PAPER[1], { lunchMin: "" }),
  paperRow(PAPER[1], { lunchMin: "abc" }),
  paperRow(PAPER[1], { lunchMin: 700 }), // Lunch past the shift: IDEAL 0, never negative
  paperRow(PAPER[1], { lunchMin: -30 }),
  paperRow(PAPER[0], { actualQty: "", okQty: "75" }),
  paperRow(PAPER[0], { actualQty: undefined, okQty: 75, rejectedQty: 3 }),
  paperRow(PAPER[0], { totalCycleSec: 0 }),
  paperRow(PAPER[0], { totalCycleSec: -5 }),
  paperRow(PAPER[0], { totalCycleSec: "abc" }),
  paperRow(PAPER[0], { totalCycleSec: "" }),
  paperRow(PAPER[0], { itemName: "" }),
  paperRow(PAPER[0], { machineOnTime: "" }),
  paperRow(PAPER[0], { machineOnTime: "22:00", machineOffTime: "06:00" }),
  paperRow(PAPER[0], { machineOnTime: "08:00", machineOffTime: "08:00" }),
  paperRow(PAPER[0], { okQty: 200 }),
  paperRow(PAPER[0], { runQtyBasis: "total" }),
  paperRow(PAPER[0], { totalCycleSec: "1e400" }),
  {},
];
const rowCases = [...curated];
for (let i = 0; i < 700 * SCALE; i += 1) rowCases.push(chance(0.5) ? saneRow("r" + i) : junkRow("r" + i));
const rowOut = rowCases.map((row) => ({ row: encIn(row), out: enc(mfdRowCalc(row)) }));
rowOut.push({ row: null, out: enc(mfdRowCalc(null)) });
write("row_calc.json", rowOut);

// The sheet's constants; isMfdProcess; the IDEAL formatting.
const processes = [
  { dataEntryMenu: "/hqepl/production/modular-frame-drilling-data-entry" },
  { dataEntryMenu: "/hqepl/production/modular-frame-drilling-data-entry/" },
  { processName: "MODULAR FRAME DRILLING" },
  { processName: "Modular  Frame Drilling" },
  { processName: "modularframedrilling" },
  { processName: "MODULAR FRAME DRILLING", dataEntryMenu: "/hqepl/production/cnc-data-entry" },
  { processName: "DRILLING" },
  { processName: "CNC DRILLING" },
  { processName: "MODULAR FRAME" },
  { processName: "", dataEntryMenu: "" },
  {},
  null,
];
const fmtValues = [0, 0.4, 0.5, 1.5, 2.5, -0.4, 731.6, 732.4999, 105, 68.57142857, 68.55, 68.65, 180, 0.05, 0.15, 1e21, NaN, null, undefined, "5", Infinity];
write("helpers.json", {
  processes: processes.map((p) => ({ process: p, isMfd: isMfdProcess(p) })),
  stoppageFields: MFD_STOPPAGE_FIELDS,
  operations: MFD_OPERATIONS,
  maxSlots: MFD_MAX_SLOTS,
  fmt: fmtValues.map((v) => ({ v: enc(v), ideal: fmtIdeal(v), perHour: fmtIdealPerHour(v) })),
});

// ── dayCalc ─────────────────────────────────────────────────────────────────
const dayCases = [];
const addDay = (rows) => {
  const sorted = sortByMachineOn(rows);
  dayCases.push({ rows: encIn(rows), order: sorted.map((r) => r._id), out: enc(mfdDayCalc(sorted)) });
};
addDay([]);
for (const r of PAPER) addDay([paperRow(r)]);
addDay(PAPER.slice(0, 2).map((r) => paperRow(r))); // overlapping entries on one machine
addDay(PAPER.slice(0, 2).map((r) => paperRow(r, { plannedOperatorShiftHours: 12, plannedLocked: true })));
addDay([paperRow(PAPER[1], { plannedOperatorShiftHours: 12, plannedLocked: true }), paperRow(PAPER[0])]);
addDay([paperRow(PAPER[0], { plannedLocked: "true" }), paperRow(PAPER[1])]);
addDay([null, paperRow(PAPER[2]), null]);
addDay([paperRow(PAPER[2], { plannedOperatorShiftHours: "" }), paperRow(PAPER[3], { plannedOperatorShiftHours: undefined })]);
addDay([paperRow(PAPER[3], { lunchMin: "abc" })]);
addDay(PAPER.slice(0, 8).map((r, i) => paperRow(r, { _id: `eight${i}` }))); // eight a day
for (let i = 0; i < 300 * SCALE; i += 1) {
  const n = int(1, 5);
  const rows = [];
  const locked = chance(0.2);
  for (let j = 0; j < n; j += 1) {
    const r = chance(0.75) ? saneRow(`d${i}_${j}`) : junkRow(`d${i}_${j}`);
    if (locked) Object.assign(r, { plannedLocked: true, plannedOperatorShiftHours: 12 });
    else if (chance(0.7)) delete r.plannedLocked;
    rows.push(r);
  }
  addDay(rows);
}
write("day_calc.json", dayCases);

// ── validateMfdEntry ────────────────────────────────────────────────────────
// A fully valid block: the paper's 4/B 08:15–18:55 row typed on the form
// (50 s, 30 min Lunch: IDEAL 732.0).
const baseValid = () => ({
  date: "2024-05-10",
  machine: "m1",
  machineStatus: [],
  workingMode: "Working",
  operator: "VISHAL",
  itemName: "24 PIN FRAME",
  drawingNo: "IE0726",
  operation: "DRILLING",
  noOfHoles: "2",
  strokeRequired: "2",
  vendor: "",
  totalCycleSec: "50",
  machineOnTime: "08:15",
  machineOffTime: "18:55",
  settingOnTime: "",
  settingOffTime: "",
  actualQty: "99",
  okQty: "99",
  plannedOperatorShiftHours: "10.67",
  lunchMin: "30",
  materialShiftingMin: "115",
  plannedDownMin: "",
  setupMin: "",
  otherMin: "",
  otherMinRemark: "",
  remarks: "",
});
const valMutations = [
  {}, { date: "" }, { date: null }, { date: "  " }, { machine: "" }, { machine: undefined }, { operator: "" }, { operator: "  " }, { itemName: "" }, { itemName: null }, { itemName: "   " },
  { workingMode: "Non Working" }, { workingMode: "Non Working", date: "", machine: "" }, { workingMode: "Non Working", machineStatus: ["No Manpower"], operator: "" },
  { workingStatus: "ABSENT" }, { workingStatus: "SUNDAY", itemName: "" },
  { machineOnTime: "" }, { machineOffTime: "" }, { machineOnTime: "abc" }, { machineOffTime: "25:00" }, { machineOnTime: "8.15" }, { machineOffTime: "1855" }, { machineOnTime: 815 },
  { machineOnTime: "", machineOffTime: "" }, { machineOnTime: "22:00", machineOffTime: "06:00" }, { machineOnTime: "08:15", machineOffTime: "08:15" }, { machineOnTime: "23:59", machineOffTime: "00:00" },
  { settingOnTime: "14:30", settingOffTime: "14:50" }, { settingOnTime: "25:00" }, { settingOffTime: "abc" }, { settingOnTime: "9" }, { settingOnTime: "  " }, { settingOffTime: 930 }, { settingOnTime: "14:50", settingOffTime: "14:30" },
  { vendor: "v1" }, { vendorName: "Acme" },
  { totalCycleSec: "" }, { totalCycleSec: "0" }, { totalCycleSec: "abc" }, { totalCycleSec: "-3" }, { totalCycleSec: "56" }, { totalCycleSec: 50 }, { totalCycleSec: "  " }, { totalCycleSec: undefined },
  { totalCycleSec: "0.9" }, { totalCycleSec: "1e400" },
  { actualQty: "" }, { actualQty: undefined }, { actualQty: "abc" }, { actualQty: "-1" }, { actualQty: "  " }, { actualQty: "0", okQty: "0" }, { actualQty: "732" }, { actualQty: "733" },
  { actualQty: "99.5" }, { actualQty: "1e2" }, { actualQty: 99 }, { actualQty: "99999" }, { actualQty: "768" },
  { lunchMin: "0", actualQty: "768" }, { lunchMin: "0", actualQty: "769" }, { lunchMin: "", actualQty: "768" },
  { okQty: "" }, { okQty: undefined }, { okQty: "abc" }, { okQty: "-1" }, { okQty: "100" }, { okQty: "98.5" }, { okQty: 99 }, { okQty: "0" },
  { actualQty: "", okQty: "5" }, { actualQty: "abc", okQty: "5" },
  { plannedOperatorShiftHours: "" }, { plannedOperatorShiftHours: undefined }, { plannedOperatorShiftHours: "0" }, { plannedOperatorShiftHours: "-1" }, { plannedOperatorShiftHours: "24" }, { plannedOperatorShiftHours: "24.01" },
  { plannedOperatorShiftHours: "abc" }, { plannedOperatorShiftHours: "10" }, { plannedOperatorShiftHours: "10.66" }, { plannedOperatorShiftHours: "10.67" }, { plannedOperatorShiftHours: "12" }, { plannedOperatorShiftHours: "10,67" },
  { plannedOperatorShiftHours: 10.67 }, { plannedOperatorShiftHours: 12 }, { plannedOperatorShiftHours: ".5" },
  { plannedOperatorShiftHours: "9", machineOnTime: "22:00", machineOffTime: "06:00" },
  { machineOnTime: "", plannedOperatorShiftHours: "0.30" }, { machineOffTime: "abc", plannedOperatorShiftHours: "0.30" },
  { lunchMin: "" }, { lunchMin: undefined }, { lunchMin: "0" }, { lunchMin: "abc" }, { lunchMin: "-1" }, { lunchMin: "1440" }, { lunchMin: "1441" }, { lunchMin: "  " }, { lunchMin: 30 }, { lunchMin: "12.5" },
  { lunchMin: "525" }, { lunchMin: "526" }, { lunchMin: "30", materialShiftingMin: "610" }, { lunchMin: "30", materialShiftingMin: "611" },
  { otherMin: "5" }, { otherMin: "5", otherMinRemark: "" }, { otherMin: "5", otherMinRemark: "  " }, { otherMin: "5", otherMinRemark: "drill change" }, { otherMin: "0" },
  { otherMin: "abc" }, { otherMin: "-1" }, { otherMin: "1441", otherMinRemark: "r" },
  { machineOnTime: "", lunchMin: "5000" }, { machineOnTime: "", otherMin: "9999" },
  { setupMin: "50" }, { plannedDownMin: "600" }, { setupMin: "abc" }, { bdMechMin: "10", bdEleMin: "10", noPowerMin: "10" }, { noManPowerMin: "1441" }, { noMaterialMin: "  " },
  { rejectBreakdown: { "Tool Mark": "5" } }, { rejectOtherRemark: "x", rejectBreakdown: { Other: "2" } },
  { date: "", machine: "", itemName: "" },
  { date: "", machine: "", itemName: "", machineOnTime: "", machineOffTime: "", actualQty: "", okQty: "", plannedOperatorShiftHours: "", lunchMin: "", totalCycleSec: "" },
  { actualQty: "2000", okQty: "2100", plannedOperatorShiftHours: "0", lunchMin: "-1", otherMin: "9", totalCycleSec: "0" },
];
const valInputs = valMutations.map((m) => dropUndefined({ ...baseValid(), ...m }));
for (let i = 0; i < 360 * SCALE; i += 1) {
  valInputs.push(dropUndefined({ ...baseValid(), ...pick(valMutations), ...pick(valMutations), ...pick(valMutations) }));
}
// Whole random rows too, in the form's own typed-string shape.
for (let i = 0; i < 140 * SCALE; i += 1) {
  const r = junkRow("v" + i);
  r.machine = pick(["m1", "", undefined, "  "]);
  r.date = pick(["2024-05-10", "", undefined]);
  r.operator = pick(["VISHAL", "", undefined]);
  valInputs.push(dropUndefined(r));
}
const savedVariants = [
  null,
  { date: "2024-05-10", machine: "m1", machineOnTime: "08:15", machineOffTime: "18:55" },
  { date: "2024-05-10", machine: "m1", machineOnTime: "18:55", machineOffTime: "08:15" },
  { date: "2024-05-10", machine: "m1", machineOnTime: "22:00", machineOffTime: "06:00" },
  { date: "2024-05-09", machine: "m1", machineOnTime: "22:00", machineOffTime: "06:00" },
  { date: "2024-05-10", machine: "m1", machineOnTime: "0815", machineOffTime: "1855" },
];
const valCases = [];
for (const v of valInputs) {
  const saved = pick(savedVariants);
  const errors = saved ? validateMfdEntry(v, { saved }) : validateMfdEntry(v);
  valCases.push({ values: encIn(v), saved, errors });
}
write("validation.json", valCases);

// firstMfdError over lists of error maps
const errLists = [];
for (let i = 0; i < 80; i += 1) {
  const list = [];
  for (let j = 0; j < int(0, 3); j += 1) list.push(pick(valCases).errors);
  if (chance(0.15)) list.push(null);
  errLists.push(list);
}
errLists.push([], [{}], [{ zzz: "x", date: "d" }], [{}, { zzz: "only unknown" }]);
write("first_error.json", {
  order: MFD_FIELD_ORDER,
  minuteKeys: MFD_MINUTE_KEYS,
  downtimeKeys: MFD_DOWNTIME_KEYS,
  cases: errLists.map((list) => ({ errors: list, first: firstMfdError(list.map((e) => e || {})) })),
});

// ── values / payload ────────────────────────────────────────────────────────
const stored = (extra = {}) => ({
  _id: "e" + int(1, 99999),
  date: "2024-05-10",
  machine: "m1",
  operator: "VISHAL",
  slot: pick([1, 2, 5, 8]),
  item: pick(["i1", null]),
  itemName: "24 PIN FRAME",
  drawingNo: pick(["", "IE0726"]),
  operation: pick(["", "DRILLING", "TAPPING"]),
  noOfHoles: pick([undefined, 2, 4]),
  strokeRequired: pick([undefined, 2]),
  vendor: pick([null, "v1"]),
  vendorName: pick(["", "Acme Tools"]),
  totalCycleSec: pick([20, 50, 12.5]),
  machineOnTime: "08:15",
  machineOffTime: "18:55",
  settingOnTime: pick([undefined, "08:00"]),
  settingOffTime: pick([undefined, "08:15"]),
  actualQty: pick([99, undefined]),
  okQty: pick([99, undefined, 0]),
  rejectedQty: pick([0, 3, undefined]),
  plannedOperatorShiftHours: pick([10.666667, 8, 12, 5.333333, null]),
  lunchMin: pick([30, 0, undefined]),
  materialShiftingMin: pick([undefined, 115]),
  otherMin: pick([undefined, 5]),
  otherMinRemark: pick(["", "drill change"]),
  remarks: pick(["", "burr", "W.OFF"]),
  review: pick([undefined, { status: "pending", flagged: [{ metric: "performance", value: 1.2 }] }]),
  workingMode: pick([undefined, "Non Working"]),
  machineStatus: pick([undefined, ["No Manpower"]]),
  plannedLocked: pick([undefined, true]),
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
    payloadCases.push({ values: encIn(values), isEdit, payload: wire(toPayload(values, isEdit)) });
  }
}
// status-only / non-working days with leftovers typed in the hidden boxes
for (const extra of [{ workingStatus: "ABSENT" }, { workingMode: "Non Working", machineStatus: ["No Manpower", "Machine Breakdown"] }, { workingMode: "Non Working", remarks: " W.OFF ", settingOnTime: "08:00" }]) {
  for (const isEdit of [false, true]) {
    const values = { ...baseValid(), ...extra, item: "i1", vendor: "v1", _id: "e9", slot: 2 };
    payloadCases.push({ values: encIn(values), isEdit, payload: wire(toPayload(values, isEdit)) });
  }
}
write("payload.json", payloadCases);

// hasAnyEntryData / block has-data
const dataCases = [];
const dataInputs = [
  ...valInputs.slice(0, 60),
  emptyEntry(),
  { ...emptyEntry(), machine: "m1" },
  { ...emptyEntry(), workingMode: "Non Working" },
  { ...emptyEntry(), machineStatus: ["No Planning"] },
  { ...emptyEntry(), workingStatus: "ABSENT" },
  { ...emptyEntry(), remarks: "x" },
  { ...emptyEntry(), lunchMin: "0" },
  { ...emptyEntry(), vendor: "v1" },
  { ...emptyEntry(), slot: 3 },
  { ...emptyEntry(), plannedOperatorShiftHours: "12" },
  { ...emptyEntry(), drawingNo: "D-1" },
  { ...emptyEntry(), settingOnTime: "08:00" },
  { ...emptyEntry(), operation: "DRILLING" },
  { ...emptyEntry(), noOfHoles: "2" },
];
for (const v of dataInputs) dataCases.push({ values: encIn(v), blockHasData: blockHasData(v), anyData: hasAnyEntryData([v]) });
dataCases.push({ list: [encIn(emptyEntry()), encIn({ ...emptyEntry(), machine: "m1" })], anyData: true });
dataCases.push({ list: [encIn(emptyEntry()), encIn(emptyEntry())], anyData: false });
write("has_data.json", dataCases);

const items = [
  { _id: "i1", itemName: "24 PIN FRAME BIG", drawingNo: "IE0726", mfdOperation: "DRILLING", noOfHoles: 2, strokeRequired: 2, totalCycleSec: 50, process: "p1" },
  { _id: "i2", itemName: "Bush", totalCycleSec: null, noOfHoles: null },
  { _id: "i3", itemName: "Lever", drawingNo: "", mfdOperation: "", totalCycleSec: "", strokeRequired: 0 },
  { _id: "i4", itemName: "Knob", totalCycleSec: 0.88, mfdOperation: "TAPPING", noOfHoles: 4 },
];
const itemCases = [];
for (const id of ["", "i1", "i2", "i3", "i4", "nope"]) {
  const v = dropUndefined({ ...baseValid(), item: "iX", itemName: "Old", drawingNo: "OLD", operation: "TAPPING", noOfHoles: "9", strokeRequired: "9", totalCycleSec: "99" });
  itemCases.push({ values: encIn(v), itemId: id, out: enc(handleItemSelect(v, id, items)) });
}
write("item_select.json", { items, cases: itemCases });

write("formulas.json", MFD_FORMULAS);

// firstOverLimit as the page's Save calls it: Actual Quantity against the IDEAL
// Quantity (Lunch out) rounded down, machines named by id.
const overCases = [];
const overNames = { m1: "4/B", m2: "M/17" };
const overBlock = () => {
  const b = dropUndefined({ ...baseValid(), ...pick(valMutations), machine: pick(["m1", "m2", "m9"]) });
  if (chance(0.7)) {
    b.machineOnTime = pick(["08:15", "09:30", "14:50"]);
    b.machineOffTime = pick(["09:00", "15:25", "16:30", "18:55", "08:15"]);
    b.lunchMin = pick(["", "0", "30", "45", "70"]);
    b.otherMin = pick(["", "0", "10", "40"]);
    b.otherMinRemark = pick(["", "why"]);
    b.actualQty = pick(["", "50", "99", "800", "99999"]);
    b.okQty = pick(["", "50", "40"]);
  }
  return b;
};
for (let i = 0; i < 160 * SCALE; i += 1) {
  const blocks = Array.from({ length: int(1, 3) }, overBlock);
  const errors = blocks.map((b) => validateMfdEntry(b));
  const out = firstOverLimit(blocks, errors, mfdRowCalc, { qtyKey: "actualQty", machineName: overNames });
  overCases.push({ blocks: encIn(blocks), errors: encIn(errors), machineName: overNames, out: enc(out) });
}
write("first_over_limit.json", overCases);

// The cap's popup as the form raises it (label "Actual Quantity"): it names the Lunch it took out.
write(
  "qty_notice.json",
  [...PAPER.map((r) => paperRow(r)), ...rowCases.slice(0, 120)].map((row) => {
    const c = mfdRowCalc(row);
    const entered = int(0, 2000);
    return { row: encIn(row), entered, out: enc(qtyNotice({ calc: c, entered, label: "Actual Quantity" })) };
  }),
);

// ── the table's cells (mfdColumns.jsx), as the page draws them ────────
// Each column's `get(row, calc, day, ctx)` — strings as they are, React cells
// rendered to text, plus whether a remark eye / red emphasis / review badge shows.
const machineName = { m1: "4/B", m2: "M/17" };
const flatColumns = MFD_COLUMNS.flatMap((c) => (c.expandable ? [c.summary, ...c.columns] : [c]));
const cellOf = (col, r, c, d) => {
  const v = col.get(r, c, d, { machineName });
  if (v === null || v === undefined) return { text: "" };
  if (typeof v !== "object") return { text: String(v) };
  const html = renderToStaticMarkup(v);
  const text = html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
  const out = { text };
  if (html.includes('aria-label="View remarks"')) out.eye = true;
  if (html.includes("text-danger fw-semibold")) out.danger = true;
  const badge = html.match(/badge rounded-pill bg-(warning|success|danger)-subtle/);
  if (badge) out.badge = badge[1];
  return out;
};
const tableRows = [];
const tableRow = (id, extra = {}) => {
  const base = { ...saneRow(id), date: pick(["2024-05-10", "2024-05-11"]), machine: pick(["m1", "m2", "m9"]), slot: int(1, 8) };
  if (chance(0.3)) base.vendorName = pick(["Acme Moulds", ""]);
  if (chance(0.2)) base.review = pick([{ status: "pending" }, { status: "approved", decidedBy: { name: "Admin" } }, { status: "rejected", remark: "no" }, { status: "weird" }]);
  if (chance(0.15)) Object.assign(base, { workingMode: "Non Working", machineStatus: pick([[], ["No Manpower"], ["Machine Breakdown", "No Planning"]]) });
  if (chance(0.1)) base.noOfHoles = pick(["", null, "abc"]);
  if (chance(0.25)) Object.assign(base, { otherMin: pick([5, 0, ""]), otherMinRemark: pick(["mould change", ""]) });
  if (chance(0.2)) base.remarks = pick(["W.OFF", "", "  flash  "]);
  if (chance(0.1)) base.totalCycleSec = pick(["", null, "abc"]);
  if (chance(0.1)) base.okQty = pick(["", null]);
  if (chance(0.05)) base.machineOnTime = "";
  return dropUndefined({ ...base, ...extra });
};
PAPER.forEach((r, i) => tableRows.push(paperRow(r, { _id: `p-${r[0]}-${r[2]}`, slot: i + 1 })));
for (let i = 0; i < 160 * SCALE; i += 1) tableRows.push(tableRow("t" + i));
// The page's day results: one per row, worked out per machine and date (sortByMachineOn order).
const groups = new Map();
for (const r of tableRows) {
  const k = `${r.machine}|${r.date}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const dayById = {};
for (const g of groups.values()) {
  const sorted = sortByMachineOn(g);
  mfdDayCalc(sorted).forEach((d, i) => {
    dayById[sorted[i]._id] = d;
  });
}
write("table_cells.json", {
  columns: flatColumns.map((c) => ({ key: c.key, label: c.label })),
  machineName,
  rows: tableRows.map((r) => {
    const c = mfdRowCalc(r);
    const d = dayById[r._id] || {};
    return { row: encIn(r), cells: Object.fromEntries(flatColumns.map((col) => [col.key, cellOf(col, r, c, d)])) };
  }),
});

// ── the dashboard's per-entry counting (processDashboard.js summarize) ──────
// What GET /processes/entries hands over for this sheet (process.controller.js
// DASHBOARD_SHEETS): calcMode "perEntry" (Effective on OK, the standard rule).
const fed = (r) => ({ ...r, calcMode: "perEntry" });
const dashCases = [];
const addDash = (name, rows) => {
  const s = summarize(rows);
  dashCases.push({
    name,
    rows: encIn(rows),
    out: enc({
      entries: s.entries,
      machineDays: s.machineDays,
      unreportedMin: s.unreportedMin,
      unutilizedDays: s.unutilizedDays,
      unutilized: s.unutilized,
      oeeLosses: s.oeeLosses,
      oeeLunch: s.oeeLunch,
      oeeLunchCot: s.oeeLunchCot,
      effectiveHours: s.effectiveHours,
      totalQty: s.totalQty,
    }),
  });
};
addDash("per entry: two overlapping entries, one machine-day", [fed(paperRow(PAPER[0])), fed(paperRow(PAPER[1]))]);
addDash("per entry: a locked day counts once", PAPER.slice(0, 2).map((r) => fed(paperRow(r, { plannedOperatorShiftHours: 12, plannedLocked: true }))));
addDash("per entry: every paper row", PAPER.map((r, i) => fed(paperRow(r, { _id: `x${i}`, machine: `m${i % 3}` }))));
for (let i = 0; i < 60 * SCALE; i += 1) {
  const rows = [];
  for (let j = 0; j < int(1, 8); j += 1) {
    const r = saneRow(`s${i}_${j}`);
    r.date = pick(["2024-05-10", "2024-05-11"]);
    r.machine = pick(["m1", "m2", "c1"]);
    if (r.machine !== "c1") Object.assign(r, { calcMode: "perEntry" });
    if (chance(0.1)) r.lossesExceptLunch = true;
    rows.push(r);
  }
  addDash(`random ${i}`, rows);
}
write("dashboard_summary.json", dashCases);

console.log("ok", { rows: rowOut.length, days: dayCases.length, validation: valCases.length, payload: payloadCases.length, table: tableRows.length, dashboard: dashCases.length });
