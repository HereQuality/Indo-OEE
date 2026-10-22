// Golden-fixture generator for test/production/processes/powder_coating/*.
//
// Runs the REAL client/src/utils/powderCoatingSheet.js + powderCoatingValidation.js
// (and the shared productionSheet.js / entryValidation.js / shiftHours.js they
// import) over a broad, deterministic (seeded) input set and writes the JSON the
// Dart tests compare against. client/ is only READ; nothing is written inside it.
// The page's own pure handlers (emptyEntry, toFormValues, toPayload, …) are
// copied from client/src/pages/PowderCoatingDataEntry.jsx and
// Components/Production/PowderCoatingEntryForm.jsx below (pages are not importable).
//
//   cd mobile
//   ESB=../client/node_modules/.bin/esbuild
//   $ESB test/production/processes/powder_coating/tool/gen_powder_golden.mjs --bundle \
//        --platform=node --format=esm --outfile=<scratch>/powder-golden/gen.mjs
//   OUT_DIR=test/production/processes/powder_coating/fixtures TZ=Asia/Kolkata node <scratch>/powder-golden/gen.mjs
//
// JSON cannot carry NaN/Infinity/undefined, so those are written as markers:
//   {"$n":"NaN"|"Inf"|"-Inf"}   and   {"$u":1} (undefined).

import fs from "node:fs";
import path from "node:path";
import { isoDay, sortByMachineOn } from "../../../../../../client/src/utils/productionSheet.js";
import {
  DEFECT_FIELDS,
  NON_WORKING_STATUSES,
  POWDER_FORMULAS,
  POWDER_IDLE_FIELDS,
  defectTotal,
  isStatusOnly,
  powderDayCalc,
  powderRowCalc,
} from "../../../../../../client/src/utils/powderCoatingSheet.js";
import { WORKER_WORDS, firstOverLimit } from "../../../../../../client/src/utils/limitNotice.js";
import { POWDER_FIELD_ORDER, POWDER_MINUTE_KEYS, firstPowderError, validatePowderEntry } from "../../../../../../client/src/utils/powderCoatingValidation.js";
import { hmToWireHours, hoursToHmInput, parseHm } from "../../../../../../client/src/utils/shiftHours.js";

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

// ── copies of the page's pure handlers ──────────────────────────────────────
const DEFECT_KEYS = DEFECT_FIELDS.map((f) => f.key);
const TEXT_FIELDS = ["workingStatus", "itemName", "otherActivity", "remarks", "otherMinRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = ["totalCycleSec", "actualQty", ...DEFECT_KEYS, "otherActivityMin", "plannedOperatorShiftHours", "lunchMin", "otherMin"];

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
  vendor: row.vendor || "",
  slot: row.slot,
  plannedOperatorShiftHours: hoursToHmInput(row.plannedOperatorShiftHours),
});

const STATUS_ONLY_KEPT = ["workingStatus", "workingMode", "machineStatus", "remarks"];
const toPayload = (v, isEdit, processId) => {
  const body = toFullPayload(v, isEdit, processId);
  if (!isStatusOnly(v) && v.workingMode !== "Non Working") return body;
  return Object.fromEntries(
    Object.entries(body).map(([k, val]) =>
      ["_id", "date", "machine", "process", "slot", ...STATUS_ONLY_KEPT].includes(k) ? [k, val] : [k, k === "item" ? null : ""],
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
  plannedOperatorShiftHours: (() => {
    const { hours } = parseHm(v.plannedOperatorShiftHours);
    return hours === null ? "" : hmToWireHours(hours);
  })(),
  lunchMin: v.lunchMin === "" || v.lunchMin === undefined ? 0 : Number(v.lunchMin),
});
// api/powderCoatingSheet.api.js savePowderRow: { machine, ...row } -> { ...row, worker: machine }
const savePayload = (body) => {
  const { machine, ...row } = body;
  return wire({ ...row, worker: machine });
};

// The form's per-block "has typed work" test (PowderCoatingEntryForm.jsx).
const FORM_DATA_KEYS = [
  "machineStatus", "itemName", "vendor", "totalCycleSec", "machineOnTime", "machineOffTime", "actualQty", ...DEFECT_KEYS,
  "otherActivity", "otherActivityMin", "plannedOperatorShiftHours", "lunchMin", "otherMin", "otherMinRemark", "remarks",
];
const blockHasData = (v) =>
  v.workingMode === "Non Working" ||
  FORM_DATA_KEYS.some((k) => (Array.isArray(v[k]) ? v[k].length > 0 : v[k] !== "" && v[k] !== undefined && v[k] !== null));

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
const QTY = ["", undefined, null, "0", "10", "50", "100", "250", "300", "480", "599", "640", 320, 55, "12.5", "-3", "abc", "  ", "9999"];
const DEF = ["", undefined, null, "0", "1", "2", "5", "10", 3, "0.5", "-1", "abc", "  ", "40"];
const PLANNED = ["", undefined, "8", "8.30", "8.5", "9", "4", "7.45", "8.60", "0", "24", "24.5", "abc", "8,30", 8, 8.5, "1.5", "12", "-1", "3"];
const ITEMS = ["Powder bracket", "Hinge 7B", "Panel", " Cap ", "X"];
const STATUSES = ["", "", "", "PRESENT", "ABSENT", "SUNDAY", "LEAVE", "HOLIDAY", "REPORT NOT FILLUP", " absent ", "present", "W/OFF", undefined, null, 7];

function saneRow(id) {
  const shifts = [["06:00", "14:00"], ["14:00", "22:00"], ["22:00", "06:00"], ["08:00", "16:00"], ["07:30", "15:45"], ["9", "17"], ["0930", "1330"], ["9:30", "18.15"]];
  const [on, off] = pick(shifts);
  const total = int(0, 700);
  const row = {
    _id: id,
    date: "2026-04-06",
    machine: "w" + int(1, 4),
    operator: "Worker " + int(1, 5),
    itemName: pick(ITEMS),
    machineOnTime: on,
    machineOffTime: off,
    totalCycleSec: pick(["30", "45", "60", "36", 45, "12.5", "3600"]),
    actualQty: String(total),
    plannedOperatorShiftHours: pick([8, 8.5, 9, 12, 4, "8", 7.75]),
    lunchMin: pick(["0", "20", "30", "45", "", 30]),
    otherMin: pick(["", "0", "5", "15"]),
    otherActivityMin: pick(["", "0", "10", "25"]),
    remarks: pick(["", "ok", "late start"]),
  };
  for (const k of DEFECT_KEYS) if (chance(0.6)) row[k] = String(int(0, Math.max(0, Math.floor(total / 6))));
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
  if (chance(0.3)) row.okQty = pick(QTY);
  if (chance(0.25)) row.rejectedQty = pick(QTY);
  for (const k of DEFECT_KEYS) if (chance(0.5)) row[k] = pick(DEF);
  if (chance(0.5)) row.otherActivityMin = pick(NUMS);
  if (chance(0.5)) row.plannedOperatorShiftHours = pick([...NUMS, 8.5, 12]);
  if (chance(0.5)) row.lunchMin = pick(NUMS);
  if (chance(0.5)) row.otherMin = pick(NUMS);
  for (const k of ["plannedDownMin", "setupMin", "noManPowerMin", "bdMechMin", "noPowerMin"]) if (chance(0.1)) row[k] = pick(NUMS);
  if (chance(0.3)) row.workingStatus = pick(STATUSES);
  if (chance(0.15)) row.workingMode = pick(["Working", "Non Working", "", undefined]);
  return row;
}

// ── rowCalc ─────────────────────────────────────────────────────────────────
const curated = [
  // the real sheet row quoted in the web source: 75 pcs where 60 was ideal
  { itemName: "Panel", machineOnTime: "09:00", machineOffTime: "10:00", totalCycleSec: "60", actualQty: "75", lessCoatingQty: "5", plannedOperatorShiftHours: 1 },
  { itemName: "Panel", machineOnTime: "09:00", machineOffTime: "10:00", totalCycleSec: "30", actualQty: "80", plannedOperatorShiftHours: 1 }, // 66.67%
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "600", lessCoatingQty: "4", dotsQty: "3", missCoatingQty: "2", otherDefectQty: "1", plannedOperatorShiftHours: 8.5, lunchMin: "30", otherMin: "10", otherActivityMin: "20" },
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "", dotsQty: "3" },
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", dotsQty: "3" },
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "0" },
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "10", dotsQty: "20" }, // defects > total
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "abc", dotsQty: "2" },
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "10", dotsQty: "abc" },
  { itemName: "", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "10" },
  { machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "10" },
  { itemName: "Panel", totalCycleSec: "45", actualQty: "10" },
  { itemName: "Panel", machineOnTime: "22:00", machineOffTime: "06:00", totalCycleSec: "36", actualQty: "700", plannedOperatorShiftHours: 9 },
  { itemName: "Panel", machineOnTime: "23:59", machineOffTime: "00:00", totalCycleSec: "36", actualQty: "1" },
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "08:00", totalCycleSec: "36", actualQty: "0" },
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "0", actualQty: "10" },
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "-10", actualQty: "10" },
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "abc", actualQty: "10" },
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "97", actualQty: "10", plannedOperatorShiftHours: 8, lunchMin: 480 },
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "97", actualQty: "10", plannedOperatorShiftHours: 0 },
  { itemName: "Panel", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "97", actualQty: "10", plannedOperatorShiftHours: 8, setupMin: "500", otherActivityMin: "100" },
  { itemName: "Panel", machineOnTime: 8, machineOffTime: 16, totalCycleSec: 45, actualQty: 600 },
  { itemName: "Panel", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "1e400", actualQty: "5" },
  { itemName: "Panel", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: true },
  { itemName: "Panel", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "5", rejectedQty: "1" }, // legacy, no Total Qty
  {},
];
const rowCases = [...curated];
for (let i = 0; i < 700 * SCALE; i += 1) rowCases.push(chance(0.5) ? saneRow("r" + i) : junkRow("r" + i));
const rowOut = rowCases.map((row) => ({ row: encIn(row), out: enc(powderRowCalc(row)) }));
rowOut.push({ row: null, out: enc(powderRowCalc(null)) });
write("row_calc.json", rowOut);

// defectTotal / isStatusOnly on the same rows
write(
  "helpers.json",
  rowCases.map((row) => ({ row: encIn(row), defectTotal: enc(defectTotal(row)), statusOnly: isStatusOnly(row) })),
);

// ── dayCalc ─────────────────────────────────────────────────────────────────
const dayCases = [];
const addDay = (rows) => {
  const sorted = sortByMachineOn(rows);
  dayCases.push({ rows: encIn(rows), order: sorted.map((r) => r._id), out: enc(powderDayCalc(sorted)) });
};
const mk = (id, on, off, extra = {}) => ({ _id: id, itemName: "Panel", machineOnTime: on, machineOffTime: off, totalCycleSec: "45", actualQty: "100", plannedOperatorShiftHours: 8, ...extra });
addDay([]);
addDay([mk("a", "09:00", "10:00", { totalCycleSec: "30", actualQty: "80", plannedOperatorShiftHours: 1 })]);
addDay([mk("a", "14:00", "22:00", { lunchMin: "30" }), mk("b", "06:00", "13:30", { lunchMin: "20", otherActivityMin: "15" }), mk("c", "22:00", "02:00")]);
addDay([mk("a", "06:00", "10:00"), mk("b", "10:00", "14:00"), mk("c", "13:00", "18:00")]);
addDay([mk("a", "06:00", "10:00"), mk("b", "11:15", "14:00"), mk("c", "16:45", "23:00")]);
addDay([mk("a", "", "10:00"), mk("b", "06:00", "10:00"), mk("c", "abc", "")]);
addDay([mk("a", "", ""), mk("b", "", "")]);
addDay([mk("a", "08:00", "16:00"), mk("b", "08:00", "12:00"), mk("c", "08:00", "10:00")]);
addDay([null, mk("a", "08:00", "16:00"), null]);
addDay([mk("a", "08:00", "16:00", { itemName: "" })]);
addDay([mk("a", "08:00", "16:00", { lunchMin: "abc", otherActivityMin: "x" })]);
addDay([mk("a", "08:00", "16:00", { plannedOperatorShiftHours: "" })]);
addDay([mk("a", "08:00", "16:00", { plannedOperatorShiftHours: undefined, actualQty: "" })]);
addDay([mk("a", "08:00", "16:00", { otherActivityMin: "480", actualQty: "10" })]);
addDay([mk("a", "08:00", "16:00", { otherActivityMin: "480", lunchMin: "0" })]);
addDay([mk("a", "08:00", "16:00", { lunchMin: "480", plannedOperatorShiftHours: 8 })]);
addDay([mk("a", "08:00", "16:00", { lessCoatingQty: "30", dotsQty: "20", actualQty: "40" })]);
for (let i = 0; i < 300 * SCALE; i += 1) {
  const n = int(1, 4);
  const rows = [];
  for (let j = 0; j < n; j += 1) {
    const r = chance(0.7) ? saneRow(`d${i}_${j}`) : junkRow(`d${i}_${j}`);
    if (chance(0.5)) r.machineOffTime = pick(TIMES_OK);
    if (chance(0.4)) r.lunchMin = pick(["", "0", "20", "30", 30, "abc"]);
    if (chance(0.4)) r.otherActivityMin = pick(["", "5", "15", "x", 20]);
    if (chance(0.2)) r.setupMin = pick(["", "5", "15", "x"]);
    rows.push(r);
  }
  addDay(rows);
}
write("day_calc.json", dayCases);

// ── validatePowderEntry ─────────────────────────────────────────────────────
// A fully valid block: 8h shift, 45s per piece, 600 inspected, planned 8.30.
const baseValid = () => ({
  date: "2026-04-06",
  machine: "w1",
  machineStatus: [],
  workingMode: "Working",
  itemName: "Panel",
  vendor: "",
  machineOnTime: "08:00",
  machineOffTime: "16:00",
  totalCycleSec: "45",
  actualQty: "600",
  lessCoatingQty: "5",
  dotsQty: "3",
  missCoatingQty: "",
  otherDefectQty: "",
  otherActivity: "",
  otherActivityMin: "",
  plannedOperatorShiftHours: "8.30",
  lunchMin: "30",
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
  { actualQty: "" }, { actualQty: undefined }, { actualQty: "abc" }, { actualQty: "-1" }, { actualQty: "  " }, { actualQty: "0", lessCoatingQty: "", dotsQty: "" }, { actualQty: "0" }, { actualQty: 600 },
  { actualQty: "12.5", lessCoatingQty: "", dotsQty: "" }, { actualQty: "1e2", lessCoatingQty: "", dotsQty: "" }, { actualQty: "9999" }, { actualQty: "8" }, { actualQty: "7" },
  { lessCoatingQty: "abc" }, { dotsQty: "-1" }, { missCoatingQty: "2.5" }, { otherDefectQty: "  " }, { otherDefectQty: "600" }, { lessCoatingQty: "300", dotsQty: "300" }, { lessCoatingQty: "300", dotsQty: "301" },
  { lessCoatingQty: "600", dotsQty: "0" }, { lessCoatingQty: "5.5", dotsQty: "3.25" }, { dotsQty: 4 }, { lessCoatingQty: "", dotsQty: "" }, { lessCoatingQty: "0", dotsQty: "0" },
  { actualQty: "", lessCoatingQty: "50" }, { actualQty: "abc", lessCoatingQty: "50" },
  { plannedOperatorShiftHours: "" }, { plannedOperatorShiftHours: undefined }, { plannedOperatorShiftHours: "0" }, { plannedOperatorShiftHours: "-1" }, { plannedOperatorShiftHours: "24" }, { plannedOperatorShiftHours: "24.01" }, { plannedOperatorShiftHours: "25" },
  { plannedOperatorShiftHours: "abc" }, { plannedOperatorShiftHours: "8" }, { plannedOperatorShiftHours: "7.59" }, { plannedOperatorShiftHours: "7.60" }, { plannedOperatorShiftHours: "8.5" }, { plannedOperatorShiftHours: "8,30" },
  { plannedOperatorShiftHours: "8.004" }, { plannedOperatorShiftHours: 8.5 }, { plannedOperatorShiftHours: 8 }, { plannedOperatorShiftHours: "1.5" }, { plannedOperatorShiftHours: "0.30" },
  { plannedOperatorShiftHours: "9", machineOnTime: "22:00", machineOffTime: "06:00" }, { plannedOperatorShiftHours: "7", machineOnTime: "22:00", machineOffTime: "06:00" },
  { machineOnTime: "", plannedOperatorShiftHours: "0.30" }, { machineOffTime: "abc", plannedOperatorShiftHours: "0.30" },
  { lunchMin: "" }, { lunchMin: undefined }, { lunchMin: "0" }, { lunchMin: "abc" }, { lunchMin: "-1" }, { lunchMin: "1440" }, { lunchMin: "1441" }, { lunchMin: "  " }, { lunchMin: 30 }, { lunchMin: "12.5" },
  { lunchMin: "480" }, { lunchMin: "481" }, { lunchMin: "479", otherMin: "1", otherMinRemark: "r" }, { lunchMin: "479", otherMin: "2", otherMinRemark: "r" },
  { otherActivityMin: "10" }, { otherActivityMin: "10", otherActivity: "Packing" }, { otherActivityMin: "10", otherActivity: "  " }, { otherActivityMin: "0" }, { otherActivityMin: "0", otherActivity: "" },
  { otherActivityMin: "abc" }, { otherActivityMin: "-1" }, { otherActivityMin: "1441" }, { otherActivityMin: "1440", otherActivity: "x" }, { otherActivityMin: "450", otherActivity: "x" }, { otherActivityMin: "451", otherActivity: "x" },
  { otherActivityMin: "20", otherActivity: "Shifting", lunchMin: "460" }, { otherActivityMin: "20", otherActivity: "Shifting", lunchMin: "461" },
  { otherActivity: "Packing" },
  { otherMin: "5" }, { otherMin: "5", otherMinRemark: "" }, { otherMin: "5", otherMinRemark: "  " }, { otherMin: "5", otherMinRemark: "power cut" }, { otherMin: "0" }, { otherMin: "0", otherMinRemark: "" },
  { otherMin: "abc" }, { otherMin: "-1" }, { otherMin: "1441", otherMinRemark: "r" }, { otherMin: "450", otherMinRemark: "r" }, { otherMin: "451", otherMinRemark: "r" }, { otherMin: "10", otherMinRemark: "r", lunchMin: "20" },
  { machineOnTime: "", lunchMin: "5000" }, { machineOnTime: "", otherMin: "9999" }, { machineOnTime: "abc", otherActivityMin: "5000", otherActivity: "x" },
  { setupMin: "50", lunchMin: "460" }, { plannedDownMin: "500" }, { setupMin: "abc" },
  { date: "", machine: "", itemName: "" },
  { date: "", machine: "", itemName: "", machineOnTime: "", machineOffTime: "", actualQty: "", plannedOperatorShiftHours: "", lunchMin: "", totalCycleSec: "" },
  { actualQty: "700", plannedOperatorShiftHours: "0", lunchMin: "-1", otherMin: "9", otherActivityMin: "9999", totalCycleSec: "0" },
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
  const errors = saved ? validatePowderEntry(v, { saved }) : validatePowderEntry(v);
  valCases.push({ values: encIn(v), saved, errors });
}
write("validation.json", valCases);

// firstPowderError over lists of error maps
const errLists = [];
for (let i = 0; i < 80; i += 1) {
  const list = [];
  for (let j = 0; j < int(0, 3); j += 1) list.push(pick(valCases).errors);
  if (chance(0.15)) list.push(null);
  errLists.push(list);
}
errLists.push([], [{}], [{ zzz: "x", date: "d" }], [{}, { zzz: "only unknown" }]);
write("first_error.json", {
  order: POWDER_FIELD_ORDER,
  minuteKeys: POWDER_MINUTE_KEYS,
  cases: errLists.map((list) => ({ errors: list, first: firstPowderError(list.map((e) => e || {})) })),
});

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
  itemName: "Panel",
  vendor: pick([null, "v1"]),
  vendorName: pick(["", "Acme"]),
  totalCycleSec: 45,
  machineOnTime: "08:00",
  machineOffTime: "16:00",
  actualQty: 600,
  lessCoatingQty: 5,
  dotsQty: 3,
  rejectedQty: 8,
  okQty: 592,
  otherActivity: pick(["", "Packing"]),
  otherActivityMin: pick([undefined, 10]),
  plannedOperatorShiftHours: pick([8.5, 8, 7.75, 3.833333, null]),
  lunchMin: pick([30, 0, undefined]),
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
const formBlocks = [];
for (let i = 0; i < 80 * SCALE; i += 1) {
  const row = dropUndefined(stored());
  const out = toFormValues(row);
  formCases.push({ row: encIn(row), out: enc({ ...out, date: out.date }) });
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
    const values = { ...baseValid(), ...extra, item: "i1", vendor: "v1", _id: "e9", slot: 2 };
    payloadCases.push({ values: encIn(values), isEdit, processId: "p1", payload: savePayload(toPayload(values, isEdit, "p1")) });
  }
}
write("payload.json", payloadCases);

// hasAnyEntryData / block has-data / item selection / draft merge
const dataCases = [];
const dataInputs = [...valInputs.slice(0, 60), emptyEntry(), { ...emptyEntry(), machine: "w1" }, { ...emptyEntry(), workingMode: "Non Working" }, { ...emptyEntry(), machineStatus: ["No Planning"] }, { ...emptyEntry(), workingStatus: "ABSENT" }, { ...emptyEntry(), remarks: "x" }, { ...emptyEntry(), lunchMin: "0" }, { ...emptyEntry(), vendor: "v1" }, { ...emptyEntry(), slot: 3 }];
for (const v of dataInputs) dataCases.push({ values: encIn(v), blockHasData: blockHasData(v), anyData: hasAnyEntryData([v]) });
dataCases.push({ list: [encIn(emptyEntry()), encIn({ ...emptyEntry(), machine: "w1" })], anyData: true });
dataCases.push({ list: [encIn(emptyEntry()), encIn(emptyEntry())], anyData: false });
write("has_data.json", dataCases);

const items = [
  { _id: "i1", itemName: "Panel", totalCycleSec: 45, process: "p1" },
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

// the formulas map (keys only — the texts are checked as strings)
write("formulas.json", POWDER_FORMULAS);
write("idle_fields.json", { defects: DEFECT_FIELDS, idle: POWDER_IDLE_FIELDS, nonWorking: NON_WORKING_STATUSES });
// firstOverLimit as the page's Save calls it: no quantity check (qtyKey null — Total Qty may
// beat Ideal and goes to OEE Review), the worker's words, workers named by id.
const overCases = [];
const overNames = { w1: "Asha", w2: "Ravi" };
const overBlock = () => {
  const b = dropUndefined({ ...baseValid(), ...pick(valMutations), machine: pick(["w1", "w2", "w9"]) });
  if (chance(0.7)) {
    const on = pick(["08:00", "09:30", "07:00"]);
    b.machineOnTime = on;
    b.machineOffTime = pick(["09:00", "10:30", "16:00", "08:00"]);
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
  const errors = blocks.map((b) => validatePowderEntry(b));
  const out = firstOverLimit(blocks, errors, powderRowCalc, { qtyKey: null, words: WORKER_WORDS, machineName: overNames });
  overCases.push({ blocks: encIn(blocks), errors: encIn(errors), machineName: overNames, out: enc(out) });
}
write("first_over_limit.json", overCases);

console.log("ok", { rows: rowOut.length, days: dayCases.length, validation: valCases.length, payload: payloadCases.length });
