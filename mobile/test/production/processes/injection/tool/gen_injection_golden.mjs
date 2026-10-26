// Golden-fixture generator for test/production/processes/injection/*.
//
// Runs the REAL client/src/utils/injectionSheet.js + injectionValidation.js (and
// the shared productionSheet.js / entryValidation.js / quantityRules.js /
// shiftHours.js / limitNotice.js they import), the REAL table columns
// (Components/Production/injectionColumns.jsx, rendered with react-dom/server)
// and the REAL dashboard `summarize` (utils/processDashboard.js) over a broad,
// deterministic (seeded) input set and writes the JSON the Dart tests compare
// against. client/ is only READ; nothing is written inside it. The page's own
// pure handlers (emptyEntry, toFormValues, toPayload, …) are copied from
// client/src/pages/InjectionDataEntry.jsx and the form's "has typed work" test
// from Components/Production/InjectionEntryForm.jsx below (pages are not importable).
//
//   cd mobile
//   ESB=../client/node_modules/.bin/esbuild
//   NODE_PATH=$PWD/../client/node_modules $ESB test/production/processes/injection/tool/gen_injection_golden.mjs \
//        --bundle --platform=node --format=esm --loader:.js=jsx --loader:.css=empty \
//        --define:import.meta.env='{}' \
//        --banner:js="import {createRequire} from 'module';const require=createRequire(import.meta.url);" \
//        --outfile=<scratch>/injection-golden/gen.mjs
//   OUT_DIR=test/production/processes/injection/fixtures TZ=Asia/Kolkata node <scratch>/injection-golden/gen.mjs
//
// JSON cannot carry NaN/Infinity/undefined, so those are written as markers:
//   {"$n":"NaN"|"Inf"|"-Inf"}   and   {"$u":1} (undefined).

import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { STOPPAGE_FIELDS, WORKING_STATUSES, isoDay, sortByMachineOn, spanMinutes } from "../../../../../../client/src/utils/productionSheet.js";
import {
  INJECTION_FORMULAS,
  INJECTION_STOPPAGE_FIELDS,
  NON_WORKING_STATUSES,
  injectionDayCalc,
  injectionRowCalc,
  isInjectionProcess,
  isStatusOnly,
} from "../../../../../../client/src/utils/injectionSheet.js";
import {
  INJECTION_DOWNTIME_KEYS,
  INJECTION_FIELD_ORDER,
  INJECTION_MINUTE_KEYS,
  firstInjectionError,
  validateInjectionEntry,
} from "../../../../../../client/src/utils/injectionValidation.js";
import { firstOverLimit } from "../../../../../../client/src/utils/limitNotice.js";
import { quantityFormValues } from "../../../../../../client/src/utils/quantityRules.js";
import { hmToWireHours, hoursToShiftInput, parseShiftHours } from "../../../../../../client/src/utils/shiftHours.js";
import { summarize } from "../../../../../../client/src/utils/processDashboard.js";
import { INJECTION_COLUMNS } from "../../../../../../client/src/Components/Production/injectionColumns.jsx";

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

// ── copies of the page's pure handlers (InjectionDataEntry.jsx) ─────────────
const STOPPAGE_KEYS = STOPPAGE_FIELDS.map((f) => f.key);
const TEXT_FIELDS = ["operator", "workingStatus", "itemName", "drawingNo", "remarks", "otherMinRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = ["totalCycleSec", "actualQty", "okQty", "plannedOperatorShiftHours", ...STOPPAGE_KEYS];

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

const STATUS_ONLY_KEPT = ["operator", "workingStatus", "workingMode", "machineStatus", "remarks"];
const toPayload = (v, isEdit) => {
  const body = toFullPayload(v, isEdit);
  if (!isStatusOnly(v) && v.workingMode !== "Non Working") return body;
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

const withPart = (v, it) => ({ ...v, item: it._id, itemName: it.itemName, drawingNo: it.drawingNo || "", totalCycleSec: it.totalCycleSec ?? "" });
const handleItemSelect = (v, itemId, items) => {
  if (!itemId) return { ...v, item: "", itemName: "", drawingNo: "", totalCycleSec: "" };
  const it = items.find((item) => item._id === itemId);
  if (!it) return { ...v, item: "" };
  return withPart(v, it);
};

// The form's per-block "has typed work" test (InjectionEntryForm.jsx LINES / DATA_KEYS / hasData).
const LINE_FIELDS = [
  ["date", "machine", "operator", "workingMode", "machineStatus"],
  ["itemName", "vendor", "totalCycleSec"],
  ["machineOnTime", "machineOffTime"],
  ["actualQty", "okQty"],
  ["plannedOperatorShiftHours", "lunchMin"],
  [...INJECTION_DOWNTIME_KEYS, "stoppageTotal", "otherMinRemark"],
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
const STD = ["20", "15", "9", "38", "0.9", "0.88", 20, 38, "45", "60", "0", "-2", "abc", "", "  ", "1e400", 0.88];
const PLANNED = ["", undefined, "8", "8.30", "8.5", "9", "9.5", "9.42", "3", "4", "7.45", "8.60", "0", "24", "24.5", "abc", "8,30", 8, 9.5, "1.5", "12", "-1"];
const ITEMS = ["Cap 12", "Bush", "Lever", " Knob ", "X"];
const STATUSES = ["", "", "", "PRESENT", "ABSENT", "SUNDAY", "LEAVE", "HOLIDAY", "REPORT NOT FILLUP", " absent ", "present", "W/OFF", "M/C OFF", undefined, null, 7];

// The paper sheet's rows (utils/injectionSheet.test.mjs): [ON, OFF, Std (s), TOTAL, OK, downtime].
const PAPER = [
  ["08:30", "18:00", 20, 1608, 1600, { lunchMin: 30 }],
  ["08:30", "11:30", 15, 608, 600, { setupMin: 30 }],
  ["12:30", "16:30", 9, 1500, 1500, {}],
  ["08:30", "17:55", 38, 828, 825, { lunchMin: 30 }],
  ["08:30", "17:55", 0.9, 35490, 35490, { lunchMin: 30 }],
  ["08:30", "18:55", 0.88, 40088, 40088, { lunchMin: 30 }],
];
const paperRow = ([on, off, std, total, ok, stops], o = {}) => ({
  _id: `${on}-${off}-${std}`,
  date: "2026-05-13",
  machine: "m1",
  operator: "RAMESH",
  itemName: "Part",
  totalCycleSec: std,
  machineOnTime: on,
  machineOffTime: off,
  actualQty: total,
  okQty: ok,
  plannedOperatorShiftHours: spanMinutes(on, off) / 60,
  ...stops,
  ...o,
});

function saneRow(id) {
  const [on, off] = pick([["08:30", "18:00"], ["08:30", "11:30"], ["12:30", "16:30"], ["08:30", "17:55"], ["06:00", "14:00"], ["14:00", "22:00"], ["9", "17"], ["0930", "1330"], ["9:30", "18.15"]]);
  const std = pick([20, 15, 9, 38, 0.9, 0.88, 45, 60, "20", "12.5"]);
  const shift = spanMinutes(on, off);
  const ideal = shift ? Math.floor((shift * 60) / Number(std)) : 100;
  const total = int(0, Math.max(0, chance(0.1) ? ideal + 5 : ideal));
  const row = {
    _id: id,
    date: "2026-05-13",
    machine: "m" + int(1, 3),
    operator: pick(["RAMESH", "Asha", "Op 7"]),
    itemName: pick(ITEMS),
    machineOnTime: on,
    machineOffTime: off,
    totalCycleSec: std,
    actualQty: chance(0.8) ? total : String(total),
    okQty: int(Math.max(0, total - 20), total),
    plannedOperatorShiftHours: pick([shift ? shift / 60 : 8, 8, 9.5, 12, 4, "8", 7.75]),
    remarks: pick(["", "ok", "flash on parting line"]),
  };
  for (const f of INJECTION_STOPPAGE_FIELDS) if (chance(0.3)) row[f.key] = pick([0, 5, 10, 15, 30, "20", ""]);
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
  for (const f of INJECTION_STOPPAGE_FIELDS) if (chance(0.25)) row[f.key] = pick(NUMS);
  if (chance(0.3)) row.workingStatus = pick(STATUSES);
  if (chance(0.15)) row.workingMode = pick(["Working", "Non Working", "", undefined]);
  if (chance(0.1)) row.plannedLocked = pick([true, false, "true"]);
  if (chance(0.1)) row.runQtyBasis = pick(["ok", "total"]);
  return row;
}

// ── rowCalc ─────────────────────────────────────────────────────────────────
const curated = [
  ...PAPER.map((r) => paperRow(r)),
  paperRow(PAPER[0], { actualQty: "", okQty: "1600" }),
  paperRow(PAPER[0], { actualQty: undefined, okQty: 1600, rejectedQty: 8 }), // legacy, no TOTAL
  paperRow(PAPER[0], { totalCycleSec: 0 }),
  paperRow(PAPER[0], { totalCycleSec: -5 }),
  paperRow(PAPER[0], { totalCycleSec: "abc" }),
  paperRow(PAPER[0], { totalCycleSec: "" }),
  paperRow(PAPER[0], { itemName: "" }),
  paperRow(PAPER[0], { machineOnTime: "" }),
  paperRow(PAPER[0], { machineOnTime: "22:00", machineOffTime: "06:00" }),
  paperRow(PAPER[0], { machineOnTime: "08:00", machineOffTime: "08:00" }),
  paperRow(PAPER[0], { okQty: 1700 }), // OK > TOTAL
  paperRow(PAPER[0], { actualQty: 5000 }), // over Ideal
  paperRow(PAPER[0], { runQtyBasis: "ok" }), // overridden: this sheet is always TOTAL
  paperRow(PAPER[0], { totalCycleSec: "1e400" }),
  {},
];
const rowCases = [...curated];
for (let i = 0; i < 700 * SCALE; i += 1) rowCases.push(chance(0.5) ? saneRow("r" + i) : junkRow("r" + i));
const rowOut = rowCases.map((row) => ({ row: encIn(row), out: enc(injectionRowCalc(row)) }));
rowOut.push({ row: null, out: enc(injectionRowCalc(null)) });
write("row_calc.json", rowOut);

// isStatusOnly on the same rows; the sheet's constants; isInjectionProcess.
const processes = [
  { dataEntryMenu: "/hqepl/production/injection-moulding-data-entry" },
  { dataEntryMenu: "/hqepl/production/injection-moulding-data-entry/" },
  { dataEntryMenu: "/production/injection-moulding-data-entry" },
  { processName: "INJECTION MOULDING" },
  { processName: "injection" },
  { processName: "Pre-injection" },
  { processName: "INJECTIONS" },
  { processName: "INJECTION MOULDING", dataEntryMenu: "/hqepl/production/cnc-data-entry" },
  { processName: "SPRING FOR PINS" },
  { processName: "", dataEntryMenu: "" },
  { dataEntryMenu: null, processName: "Injection Moulding 2" },
  {},
  null,
];
write("helpers.json", {
  rows: rowCases.map((row) => ({ row: encIn(row), statusOnly: isStatusOnly(row) })),
  processes: processes.map((p) => ({ process: p, isInjection: isInjectionProcess(p) })),
  stoppageFields: INJECTION_STOPPAGE_FIELDS,
  nonWorking: NON_WORKING_STATUSES,
  workingStatuses: WORKING_STATUSES,
});

// ── dayCalc ─────────────────────────────────────────────────────────────────
const dayCases = [];
const addDay = (rows) => {
  const sorted = sortByMachineOn(rows);
  dayCases.push({ rows: encIn(rows), order: sorted.map((r) => r._id), out: enc(injectionDayCalc(sorted)) });
};
addDay([]);
for (const r of PAPER) addDay([paperRow(r)]);
addDay(PAPER.slice(1, 3).map((r) => paperRow(r)));
addDay(PAPER.slice(1, 3).map((r) => paperRow(r, { plannedOperatorShiftHours: 12, plannedLocked: true })));
addDay([paperRow(PAPER[1], { plannedOperatorShiftHours: 12, plannedLocked: true }), paperRow(PAPER[2])]);
addDay([paperRow(PAPER[2]), paperRow(PAPER[1])]); // out of ON order
addDay([paperRow(PAPER[1], { plannedLocked: "true" }), paperRow(PAPER[2])]); // only `true` locks
addDay([null, paperRow(PAPER[0]), null]);
addDay([paperRow(PAPER[0], { plannedOperatorShiftHours: "" }), paperRow(PAPER[2], { plannedOperatorShiftHours: undefined })]);
addDay([paperRow(PAPER[0], { lunchMin: "abc" })]);
addDay([paperRow(PAPER[0], { machineOnTime: "", machineOffTime: "" }), paperRow(PAPER[2])]);
for (let i = 0; i < 300 * SCALE; i += 1) {
  const n = int(1, 3);
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

// ── validateInjectionEntry ──────────────────────────────────────────────────
// A fully valid block: the paper's first row typed on the form.
const baseValid = () => ({
  date: "2026-05-13",
  machine: "m1",
  machineStatus: [],
  workingMode: "Working",
  operator: "RAMESH",
  itemName: "Part",
  vendor: "",
  totalCycleSec: "20",
  machineOnTime: "08:30",
  machineOffTime: "18:00",
  actualQty: "1608",
  okQty: "1600",
  plannedOperatorShiftHours: "9.5",
  lunchMin: "30",
  plannedDownMin: "",
  setupMin: "",
  otherMin: "",
  otherMinRemark: "",
  remarks: "",
});
const valMutations = [
  {}, { date: "" }, { date: null }, { date: "  " }, { machine: "" }, { machine: undefined }, { operator: "" }, { operator: "  " }, { itemName: "" }, { itemName: null }, { itemName: "   " },
  { workingMode: "Non Working" }, { workingMode: "Non Working", date: "", machine: "" }, { workingMode: "Non Working", machineStatus: ["No Manpower"], operator: "" },
  { workingStatus: "ABSENT" }, { workingStatus: "SUNDAY", machine: "" }, { workingStatus: "PRESENT" }, { workingStatus: "present" }, { workingStatus: " LEAVE " }, { workingStatus: "ABSENT", date: "" },
  { workingStatus: "ABSENT", itemName: "", actualQty: "" }, { workingStatus: 5 }, { workingStatus: null },
  { machineOnTime: "" }, { machineOffTime: "" }, { machineOnTime: "abc" }, { machineOffTime: "25:00" }, { machineOnTime: "8.30" }, { machineOffTime: "1800" }, { machineOnTime: 830 },
  { machineOnTime: "", machineOffTime: "" }, { machineOnTime: "22:00", machineOffTime: "06:00" }, { machineOnTime: "08:30", machineOffTime: "08:30" }, { machineOnTime: "23:59", machineOffTime: "00:00" },
  { vendor: "v1" }, { vendorName: "Acme" },
  { totalCycleSec: "" }, { totalCycleSec: "0" }, { totalCycleSec: "abc" }, { totalCycleSec: "-3" }, { totalCycleSec: "38" }, { totalCycleSec: 20 }, { totalCycleSec: "  " }, { totalCycleSec: undefined },
  { totalCycleSec: "0.9" }, { totalCycleSec: "1e400" },
  { actualQty: "" }, { actualQty: undefined }, { actualQty: "abc" }, { actualQty: "-1" }, { actualQty: "  " }, { actualQty: "0", okQty: "0" }, { actualQty: "1710" }, { actualQty: "1711" },
  { actualQty: "1608.5" }, { actualQty: "1e3" }, { actualQty: 1608 }, { actualQty: "99999" },
  { okQty: "" }, { okQty: undefined }, { okQty: "abc" }, { okQty: "-1" }, { okQty: "1609" }, { okQty: "1608" }, { okQty: "1599.5" }, { okQty: 1600 }, { okQty: "0" },
  { actualQty: "", okQty: "5" }, { actualQty: "abc", okQty: "5" },
  { plannedOperatorShiftHours: "" }, { plannedOperatorShiftHours: undefined }, { plannedOperatorShiftHours: "0" }, { plannedOperatorShiftHours: "-1" }, { plannedOperatorShiftHours: "24" }, { plannedOperatorShiftHours: "24.01" }, { plannedOperatorShiftHours: "25" },
  { plannedOperatorShiftHours: "abc" }, { plannedOperatorShiftHours: "9" }, { plannedOperatorShiftHours: "9.49" }, { plannedOperatorShiftHours: "9.50" }, { plannedOperatorShiftHours: "12" }, { plannedOperatorShiftHours: "9,5" },
  { plannedOperatorShiftHours: "9.504" }, { plannedOperatorShiftHours: 9.5 }, { plannedOperatorShiftHours: 12 }, { plannedOperatorShiftHours: "1.5" }, { plannedOperatorShiftHours: ".5" },
  { plannedOperatorShiftHours: "9", machineOnTime: "22:00", machineOffTime: "06:00" }, { plannedOperatorShiftHours: "7", machineOnTime: "22:00", machineOffTime: "06:00" },
  { machineOnTime: "", plannedOperatorShiftHours: "0.30" }, { machineOffTime: "abc", plannedOperatorShiftHours: "0.30" },
  { lunchMin: "" }, { lunchMin: undefined }, { lunchMin: "0" }, { lunchMin: "abc" }, { lunchMin: "-1" }, { lunchMin: "1440" }, { lunchMin: "1441" }, { lunchMin: "  " }, { lunchMin: 30 }, { lunchMin: "12.5" },
  { lunchMin: "570" }, { lunchMin: "571" }, { lunchMin: "500", setupMin: "71" }, { lunchMin: "500", setupMin: "70" }, { lunchMin: "569", otherMin: "1", otherMinRemark: "r" }, { lunchMin: "569", otherMin: "2", otherMinRemark: "r" },
  { otherMin: "5" }, { otherMin: "5", otherMinRemark: "" }, { otherMin: "5", otherMinRemark: "  " }, { otherMin: "5", otherMinRemark: "mould change" }, { otherMin: "0" }, { otherMin: "0", otherMinRemark: "" },
  { otherMin: "abc" }, { otherMin: "-1" }, { otherMin: "1441", otherMinRemark: "r" }, { otherMin: "540", otherMinRemark: "r" }, { otherMin: "541", otherMinRemark: "r" },
  { machineOnTime: "", lunchMin: "5000" }, { machineOnTime: "", otherMin: "9999" },
  { setupMin: "50" }, { plannedDownMin: "600" }, { setupMin: "abc" }, { bdMechMin: "10", bdEleMin: "10", noPowerMin: "10" }, { noManPowerMin: "1441" }, { materialShiftingMin: "-2" }, { noMaterialMin: "  " },
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
  r.date = pick(["2026-05-13", "", undefined]);
  r.operator = pick(["RAMESH", "", undefined]);
  valInputs.push(dropUndefined(r));
}
const savedVariants = [
  null,
  { date: "2026-05-13", machine: "m1", machineOnTime: "08:30", machineOffTime: "18:00" },
  { date: "2026-05-13", machine: "m1", machineOnTime: "18:00", machineOffTime: "08:30" },
  { date: "2026-05-13", machine: "m1", machineOnTime: "22:00", machineOffTime: "06:00" },
  { date: "2026-05-12", machine: "m1", machineOnTime: "22:00", machineOffTime: "06:00" },
  { date: "2026-05-13", machine: "m1", machineOnTime: "0830", machineOffTime: "1800" },
];
const valCases = [];
for (const v of valInputs) {
  const saved = pick(savedVariants);
  const errors = saved ? validateInjectionEntry(v, { saved }) : validateInjectionEntry(v);
  valCases.push({ values: encIn(v), saved, errors });
}
write("validation.json", valCases);

// firstInjectionError over lists of error maps
const errLists = [];
for (let i = 0; i < 80; i += 1) {
  const list = [];
  for (let j = 0; j < int(0, 3); j += 1) list.push(pick(valCases).errors);
  if (chance(0.15)) list.push(null);
  errLists.push(list);
}
errLists.push([], [{}], [{ zzz: "x", date: "d" }], [{}, { zzz: "only unknown" }]);
write("first_error.json", {
  order: INJECTION_FIELD_ORDER,
  minuteKeys: INJECTION_MINUTE_KEYS,
  downtimeKeys: INJECTION_DOWNTIME_KEYS,
  cases: errLists.map((list) => ({ errors: list, first: firstInjectionError(list.map((e) => e || {})) })),
});

// ── values / payload ────────────────────────────────────────────────────────
const stored = (extra = {}) => ({
  _id: "e" + int(1, 99999),
  date: "2026-05-13",
  machine: "m1",
  operator: "RAMESH",
  slot: pick([1, 2, 3]),
  item: pick(["i1", null]),
  itemName: "Part",
  drawingNo: pick(["", "D-7"]),
  vendor: pick([null, "v1"]),
  vendorName: pick(["", "Acme Moulds"]),
  totalCycleSec: pick([20, 0.88, 38]),
  machineOnTime: "08:30",
  machineOffTime: "18:00",
  actualQty: pick([1608, undefined]),
  okQty: pick([1600, undefined, 0]),
  rejectedQty: pick([8, undefined]),
  plannedOperatorShiftHours: pick([9.5, 8, 12, 9.416667, 5.333333, null]),
  lunchMin: pick([30, 0, undefined]),
  setupMin: pick([undefined, 15]),
  otherMin: pick([undefined, 5]),
  otherMinRemark: pick(["", "mould change"]),
  remarks: pick(["", "flash", "W.OFF"]),
  review: pick([undefined, { status: "pending", flagged: [{ metric: "performance", value: 1.2 }] }]),
  workingMode: pick([undefined, "Non Working"]),
  machineStatus: pick([undefined, ["No Manpower"]]),
  workingStatus: pick([undefined, "", "ABSENT"]),
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
for (const extra of [{ workingStatus: "ABSENT" }, { workingMode: "Non Working", machineStatus: ["No Manpower", "Machine Breakdown"] }, { workingStatus: "SUNDAY", remarks: " note " }]) {
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
];
for (const v of dataInputs) dataCases.push({ values: encIn(v), blockHasData: blockHasData(v), anyData: hasAnyEntryData([v]) });
dataCases.push({ list: [encIn(emptyEntry()), encIn({ ...emptyEntry(), machine: "m1" })], anyData: true });
dataCases.push({ list: [encIn(emptyEntry()), encIn(emptyEntry())], anyData: false });
write("has_data.json", dataCases);

const items = [
  { _id: "i1", itemName: "Cap 12", drawingNo: "D-12", totalCycleSec: 20, process: "p1" },
  { _id: "i2", itemName: "Bush", totalCycleSec: null },
  { _id: "i3", itemName: "Lever", drawingNo: "", totalCycleSec: "" },
  { _id: "i4", itemName: "Knob", totalCycleSec: 0.88 },
];
const itemCases = [];
for (const id of ["", "i1", "i2", "i3", "i4", "nope"]) {
  const v = dropUndefined({ ...baseValid(), item: "iX", itemName: "Old", drawingNo: "OLD", totalCycleSec: "99" });
  itemCases.push({ values: encIn(v), itemId: id, out: enc(handleItemSelect(v, id, items)) });
}
write("item_select.json", { items, cases: itemCases });

write("formulas.json", INJECTION_FORMULAS);

// firstOverLimit as the page's Save calls it: TOTAL QTY. (actualQty) against
// Ideal Quantity rounded down, machines named by id.
const overCases = [];
const overNames = { m1: "IMM 1", m2: "IMM 2" };
const overBlock = () => {
  const b = dropUndefined({ ...baseValid(), ...pick(valMutations), machine: pick(["m1", "m2", "m9"]) });
  if (chance(0.7)) {
    b.machineOnTime = pick(["08:30", "09:30", "12:30"]);
    b.machineOffTime = pick(["09:00", "11:30", "16:30", "18:00", "08:30"]);
    b.lunchMin = pick(["", "0", "30", "45", "70"]);
    b.otherMin = pick(["", "0", "10", "40"]);
    b.otherMinRemark = pick(["", "why"]);
    b.actualQty = pick(["", "100", "1608", "99999"]);
    b.okQty = pick(["", "100", "50"]);
  }
  return b;
};
for (let i = 0; i < 160 * SCALE; i += 1) {
  const blocks = Array.from({ length: int(1, 3) }, overBlock);
  const errors = blocks.map((b) => validateInjectionEntry(b));
  const out = firstOverLimit(blocks, errors, injectionRowCalc, { qtyKey: "actualQty", machineName: overNames });
  overCases.push({ blocks: encIn(blocks), errors: encIn(errors), machineName: overNames, out: enc(out) });
}
write("first_over_limit.json", overCases);

// ── the table's cells (injectionColumns.jsx), as the page draws them ────────
// Each column's `get(row, calc, day, ctx)` — strings as they are, React cells
// rendered to text, plus whether a remark eye / red emphasis / review badge shows.
const machineName = { m1: "IMM 1", m2: "IMM 2" };
const flatColumns = INJECTION_COLUMNS.flatMap((c) => (c.expandable ? [c.summary, ...c.columns] : [c]));
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
  const base = { ...saneRow(id), date: pick(["2026-05-13", "2026-05-14"]), machine: pick(["m1", "m2", "m9"]), slot: int(1, 3) };
  if (chance(0.3)) base.vendorName = pick(["Acme Moulds", ""]);
  if (chance(0.2)) base.review = pick([{ status: "pending" }, { status: "approved", decidedBy: { name: "Admin" } }, { status: "rejected", remark: "no" }, { status: "weird" }]);
  if (chance(0.15)) Object.assign(base, { workingMode: "Non Working", machineStatus: pick([[], ["No Manpower"], ["Machine Breakdown", "No Planning"]]) });
  if (chance(0.1)) base.workingStatus = pick(["ABSENT", "PRESENT", " SUNDAY ", ""]);
  if (chance(0.25)) Object.assign(base, { otherMin: pick([5, 0, ""]), otherMinRemark: pick(["mould change", ""]) });
  if (chance(0.2)) base.remarks = pick(["W.OFF", "", "  flash  "]);
  if (chance(0.1)) base.totalCycleSec = pick(["", null, "abc"]);
  if (chance(0.1)) base.okQty = pick(["", null]);
  if (chance(0.05)) base.machineOnTime = "";
  return dropUndefined({ ...base, ...extra });
};
for (const r of PAPER) tableRows.push(paperRow(r, { _id: `p-${r[0]}-${r[2]}`, slot: 1 }));
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
  injectionDayCalc(sorted).forEach((d, i) => {
    dayById[sorted[i]._id] = d;
  });
}
write("table_cells.json", {
  columns: flatColumns.map((c) => ({ key: c.key, label: c.label })),
  machineName,
  rows: tableRows.map((r) => {
    const c = injectionRowCalc(r);
    const d = dayById[r._id] || {};
    return { row: encIn(r), cells: Object.fromEntries(flatColumns.map((col) => [col.key, cellOf(col, r, c, d)])) };
  }),
});

// ── the dashboard's per-entry counting (processDashboard.js summarize) ──────
// What GET /processes/entries hands over for this sheet (process.controller.js
// DASHBOARD_SHEETS): runQtyBasis "total", calcMode "perEntry".
const fed = (r) => ({ ...r, runQtyBasis: "total", calcMode: "perEntry" });
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
addDash("per entry: two entries, one machine-day", [fed(paperRow(PAPER[1])), fed(paperRow(PAPER[2]))]);
addDash("per entry: a locked day counts once", PAPER.slice(1, 3).map((r) => fed(paperRow(r, { plannedOperatorShiftHours: 12, plannedLocked: true }))));
addDash("per entry: one locked entry locks the day", [fed(paperRow(PAPER[1], { plannedOperatorShiftHours: 12, plannedLocked: true })), fed(paperRow(PAPER[2]))]);
addDash("not per entry: one figure per machine-day", [paperRow(PAPER[1]), paperRow(PAPER[2])]);
addDash("per entry: every paper row", PAPER.map((r) => fed(paperRow(r, { _id: `x-${r[0]}-${r[2]}` }))));
addDash("per entry with lossesExceptLunch", PAPER.slice(0, 2).map((r) => ({ ...fed(paperRow(r)), lossesExceptLunch: true })));
addDash("mixed sheets", [fed(paperRow(PAPER[1])), fed(paperRow(PAPER[2])), { ...paperRow(PAPER[0]), machine: "c1" }, { ...paperRow(PAPER[3]), machine: "c1" }]);
for (let i = 0; i < 60 * SCALE; i += 1) {
  const rows = [];
  for (let j = 0; j < int(1, 8); j += 1) {
    const r = saneRow(`s${i}_${j}`);
    r.date = pick(["2026-05-13", "2026-05-14"]);
    r.machine = pick(["m1", "m2", "c1"]);
    if (r.machine !== "c1") Object.assign(r, { runQtyBasis: "total", calcMode: "perEntry" });
    if (chance(0.1)) r.lossesExceptLunch = true;
    rows.push(r);
  }
  addDash(`random ${i}`, rows);
}
write("dashboard_summary.json", dashCases);

console.log("ok", { rows: rowOut.length, days: dayCases.length, validation: valCases.length, payload: payloadCases.length, table: tableRows.length, dashboard: dashCases.length });
