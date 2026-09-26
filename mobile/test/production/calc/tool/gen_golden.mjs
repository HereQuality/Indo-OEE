// Golden-fixture generator for test/production/calc/*.
//
// Runs the REAL client/src/utils/productionSheet.js + entryValidation.js over a
// broad, deterministic (seeded) input set and writes the JSON the Dart tests
// compare against. client/ is only READ; nothing is written inside it.
//
//   ESB=/Users/hqepldev/HQEPL/Indo-OEE/client/node_modules/.bin/esbuild
//   $ESB test/production/calc/tool/gen_golden.mjs --bundle --platform=node \
//        --format=esm --outfile=<scratch>/calc-golden/gen.mjs
//   OUT_DIR=test/production/calc/fixtures TZ=Asia/Kolkata node <scratch>/calc-golden/gen.mjs
//
// JSON cannot carry NaN/Infinity/undefined, so those are written as markers:
//   {"$n":"NaN"|"Inf"|"-Inf"}   and   {"$u":1} (undefined).

import fs from "node:fs";
import path from "node:path";
import {
  CYCLE_OP_FIELDS,
  REJECT_REASONS,
  STOPPAGE_FIELDS,
  WORKING_STATUSES,
  SLOTS_PER_DAY,
  CYCLE_OPS,
  cycleOpLabel,
  dayCalc,
  daysOfMonth,
  displayDay,
  fmtNum,
  fmtPct,
  isSunday,
  isoDay,
  normalizeTime,
  remarkParts,
  rowCalc,
  rowKey,
  sortByMachineOn,
  spanMinutes,
  totalCycleSec,
} from "../../../../../client/src/utils/productionSheet.js";
import {
  DOWNTIME_KEYS,
  FIELD_ORDER,
  bookedRanges,
  cleanSplit,
  firstError,
  fmt12,
  isTimeRuleMessage,
  lunchRequired,
  overlapErrors,
  stoppageLimitMin,
  timeInterval,
  validateEntry,
} from "../../../../../client/src/utils/entryValidation.js";

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
const rnd = mulberry32(Number(process.env.SEED || 20260925));
const SCALE = Number(process.env.SCALE || 1); // bigger sets for one-off soak runs; the committed fixtures use 1
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// Marker encoding of values JSON can't hold.
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

// ── row generators ──────────────────────────────────────────────────────────
const TIMES_OK = ["06:00", "07:30", "08:00", "9", "930", "0930", "9:30", "9.30", "13:15", "14:00", "16:00", "21:30", "22:00", "23:59", "00:00", "02:00", "05:45", "06:00", "14:00", "22:00"];
const TIMES_BAD = ["24:00", "9:5", "abc", "12345", "", "  ", "25", "7:60", null, undefined, 930, 9, "9-30"];
const NUMS = ["", undefined, null, "0", "1", "5", "10", "12.5", 3, 7.5, "  ", "abc", "-4", "1e2", "0x10", "45", 45, "120", "0.5", "600"];
const QTY = ["", undefined, null, "0", "10", "100", "250", "300", "480", "599", "600", "640", 320, 55, "12.5", "-3", "abc", "  ", "9999"];
const ITEMS = ["Part A", "Bracket 7B", "Flange", " Part B ", "X"];

function saneRow(id) {
  const shifts = [["06:00", "14:00"], ["14:00", "22:00"], ["22:00", "06:00"], ["08:00", "16:00"], ["07:30", "15:45"], ["9", "17"], ["0930", "1330"], ["9:30", "18.15"]];
  const [on, off] = pick(shifts);
  const row = {
    _id: id,
    date: "2026-04-06",
    machine: "m" + int(1, 4),
    operator: "op" + int(1, 5),
    itemName: pick(ITEMS),
    machineOnTime: on,
    machineOffTime: off,
    totalCycleSec: pick(["45", "60", "36", "90", 45, "12.5", "3600"]),
    actualQty: String(int(0, 700)),
    okQty: String(int(0, 700)),
    plannedOperatorShiftHours: pick(["8", "8.5", "9", "12", "4", 8]),
    lunchMin: pick(["0", "20", "30", "45", "", 30]),
    setupMin: pick(["", "0", "10", "25"]),
    remarks: pick(["", "ok", "late start"]),
  };
  return row;
}

function junkRow(id) {
  const row = { _id: id };
  if (chance(0.85)) row.itemName = pick(["Part A", "Bracket", " ", "", null, undefined, 7]);
  if (chance(0.9)) row.machineOnTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.9)) row.machineOffTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.6)) row.totalCycleSec = pick(NUMS);
  for (const f of CYCLE_OP_FIELDS) if (chance(0.25)) row[f.key] = pick(NUMS);
  if (chance(0.2)) row.cycleTimeSec = pick(NUMS);
  if (chance(0.15)) row.cycleOpsSec = pick([[], [10, "20", null, ""], ["a", 5], null, [1, 2, 3, 4, 5]]);
  if (chance(0.3)) row.excludedOps = pick([[], ["drillingSec"], ["boringSec", "tappingSec"], ["otherOp1Sec", "otherOp2Sec", "clampDeclampSec"], ["nope"], null]);
  if (chance(0.85)) row.actualQty = pick(QTY);
  if (chance(0.85)) row.okQty = pick(QTY);
  if (chance(0.25)) row.rejectedQty = pick(QTY);
  for (const f of STOPPAGE_FIELDS) if (chance(0.35)) row[f.key] = pick(NUMS);
  return row;
}

// ── rowCalc ─────────────────────────────────────────────────────────────────
const curated = [
  // plain sane
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "600", okQty: "590", lunchMin: "30", setupMin: "10" },
  // legacy rows: no actualQty -> falls back to stored rejectedQty
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "60", okQty: "400", rejectedQty: "20" },
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "60", okQty: "400" },
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "60", rejectedQty: "20" },
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "60" },
  // OK above actual -> rejected clamps to 0
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "60", actualQty: "100", okQty: "150" },
  // overnight
  { itemName: "Part A", machineOnTime: "22:00", machineOffTime: "06:00", totalCycleSec: "36", actualQty: "700", okQty: "700" },
  { itemName: "Part A", machineOnTime: "23:59", machineOffTime: "00:00", totalCycleSec: "36", actualQty: "1", okQty: "1" },
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "08:00", totalCycleSec: "36", actualQty: "0", okQty: "0" },
  // missing part -> no cycle
  { itemName: "", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "6", okQty: "5" },
  { machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "6", okQty: "5" },
  { itemName: "   ", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45" },
  // cycle from named ops, excludedOps on/off
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", drillingSec: "10", boringSec: "20", tappingSec: "5", actualQty: "100", okQty: "90" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "50", drillingSec: "10", boringSec: "20", excludedOps: ["drillingSec"], actualQty: "100", okQty: "90" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "50", drillingSec: "10", boringSec: "20", excludedOps: ["drillingSec", "boringSec", "clampDeclampSec"], actualQty: "100", okQty: "90" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", drillingSec: "10", boringSec: "20", excludedOps: ["drillingSec"], actualQty: "100", okQty: "90" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", drillingSec: "10", excludedOps: ["drillingSec"], cycleTimeSec: "33", actualQty: "100", okQty: "90" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", cycleTimeSec: "33", actualQty: "100", okQty: "90" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", cycleOpsSec: [10, "20", null, "", "x"], actualQty: "100", okQty: "90" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", cycleOpsSec: [], actualQty: "100", okQty: "90" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "0", actualQty: "100", okQty: "90" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "-10", actualQty: "100", okQty: "90" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "abc", actualQty: "100", okQty: "90" },
  // fractional ideal floors
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "97", actualQty: "10", okQty: "10" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: 7.3, actualQty: "10", okQty: "10" },
  // spec examples: 8h no downtime -> 320 at 90s cycle; 3h with 90 min planned down -> 120
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "90", plannedDownMin: "0" },
  { itemName: "P", machineOnTime: "09:00", machineOffTime: "12:00", totalCycleSec: "90", plannedDownMin: "90" },
  // stoppage fields incl junk / whitespace
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", plannedDownMin: "5", setupMin: "10", noManPowerMin: "1", materialShiftingMin: "2", noMaterialMin: "3", bdMechMin: "4", bdEleMin: "5", noPowerMin: "6", lunchMin: "30", otherMin: "7" },
  { itemName: "P", plannedDownMin: "x", setupMin: "  ", lunchMin: 30, otherMin: "" },
  // numbers instead of strings, booleans, NaN-ish
  { itemName: "P", machineOnTime: 8, machineOffTime: 16, totalCycleSec: 45, actualQty: 600, okQty: 590 },
  { itemName: "P", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: 45, actualQty: true, okQty: false },
  { itemName: "P", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "1e400", actualQty: "5", okQty: "5" },
  { itemName: "P", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "abc", okQty: "5" },
  { itemName: "P", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "5", okQty: "abc" },
  { itemName: "P", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "0", rejectedQty: "0" },
  // no times at all
  { itemName: "P", totalCycleSec: "45", actualQty: "5", okQty: "5" },
  {},
];
const rowCases = [];
for (const row of curated) rowCases.push(row);
for (let i = 0; i < 600 * SCALE; i += 1) rowCases.push(chance(0.45) ? saneRow("r" + i) : junkRow("r" + i));
// hostile shapes rowCalc must survive
const rowCalcOut = rowCases.map((row) => ({ row: encIn(row), out: enc(rowCalc(row)) }));
rowCalcOut.push({ row: null, out: enc(rowCalc(null)) });
write("row_calc.json", rowCalcOut);

// ── dayCalc / sortByMachineOn ───────────────────────────────────────────────
const dayCases = [];
const addDay = (rows) => {
  const sorted = sortByMachineOn(rows);
  dayCases.push({
    rows: encIn(rows),
    order: sorted.map((r) => r._id),
    out: enc(dayCalc(rows)),
    calcs: enc(sorted.map(rowCalc)),
  });
};
const mk = (id, on, off, extra = {}) => ({ _id: id, itemName: "P", machineOnTime: on, machineOffTime: off, totalCycleSec: "45", actualQty: "100", okQty: "90", ...extra });
addDay([]);
addDay([mk("a", "06:00", "14:00", { lunchMin: "30", setupMin: "10", okQty: "600", actualQty: "620" })]);
addDay([mk("a", "14:00", "22:00", { lunchMin: "30" }), mk("b", "06:00", "13:30", { lunchMin: "20", setupMin: "5" }), mk("c", "22:00", "02:00")]);
addDay([mk("a", "06:00", "10:00"), mk("b", "10:00", "14:00"), mk("c", "13:00", "18:00")]); // touching + overlapping
addDay([mk("a", "06:00", "10:00"), mk("b", "11:15", "14:00"), mk("c", "16:45", "23:00")]); // gaps
addDay([mk("a", "", "10:00"), mk("b", "06:00", "10:00"), mk("c", "abc", "")]); // no valid ON sort last
addDay([mk("a", "", ""), mk("b", "", "")]); // no shift anywhere -> all null
addDay([mk("a", "08:00", "16:00"), mk("b", "08:00", "12:00"), mk("c", "08:00", "10:00")]); // ties keep input order
addDay([null, mk("a", "08:00", "16:00"), null]);
addDay([mk("a", "08:00", "16:00", { itemName: "" })]); // shift but no cycle -> effective null
addDay([mk("a", "08:00", "16:00", { lunchMin: "abc" })]); // NaN lunch propagates into unutilized
addDay([mk("a", "08:00", "16:00", { lunchMin: "" }), mk("b", "16:00", "20:00", { lunchMin: null })]);
addDay([mk("a", "08:00", "16:00", { plannedDownMin: "480", okQty: "0" })]); // shift - stoppage = 0 -> ratio null
addDay([mk("a", "08:00", "16:00", { lunchMin: "480", okQty: "10" })]);
addDay([mk("a", "08:00", "16:00", { setupMin: "480", lunchMin: "0" })]);
addDay([mk("a", "22:00", "06:00"), mk("b", "06:00", "14:00")]);
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

// ── validateEntry & friends ─────────────────────────────────────────────────
// A fully valid block: 8h shift, cycle 45s -> ideal 640, planned 8.5h -> 30 min
// allowance = the 30 min of lunch, split adds up to the 10 rejected.
const baseValid = () => ({
  date: "2026-04-06",
  machine: "m1",
  operator: "op1",
  itemName: "Part A",
  machineOnTime: "08:00",
  machineOffTime: "16:00",
  totalCycleSec: "45",
  actualQty: "600",
  okQty: "590",
  rejectBreakdown: { "Dimension Out": "10" },
  plannedOperatorShiftHours: "8.5",
  lunchMin: "30",
  remarks: "",
});
const valMutations = [
  {}, // valid
  { date: "" }, { date: null }, { date: "  " }, { machine: "" }, { machine: undefined }, { operator: "" }, { operator: "   " }, { itemName: "" }, { itemName: null },
  { machineOnTime: "" }, { machineOffTime: "" }, { machineOnTime: "abc" }, { machineOffTime: "25:00" }, { machineOnTime: "9" }, { machineOffTime: "17.30" }, { machineOnTime: "0800" }, { machineOnTime: 8 },
  { machineOnTime: "", machineOffTime: "" }, { machineOnTime: "22:00", machineOffTime: "06:00" }, { machineOnTime: "08:00", machineOffTime: "08:00" },
  // actual / ok
  { actualQty: "" }, { actualQty: undefined }, { actualQty: "abc" }, { actualQty: "-1" }, { actualQty: "  " }, { actualQty: "641" }, { actualQty: "640", okQty: "640", rejectBreakdown: {} }, { actualQty: "640" }, { actualQty: "0", okQty: "0", rejectBreakdown: {} },
  { actualQty: 600 }, { actualQty: "12.5", okQty: "12.5", rejectBreakdown: {} }, { actualQty: "1e2", okQty: "100", rejectBreakdown: {} }, { actualQty: "0x10", okQty: "16", rejectBreakdown: {} },
  { okQty: "" }, { okQty: "abc" }, { okQty: "-5" }, { okQty: "601" }, { okQty: "600", rejectBreakdown: {} }, { okQty: "0", rejectBreakdown: { "Machine Fault": "600" } }, { okQty: "599.5" },
  { totalCycleSec: "" }, { itemName: "", totalCycleSec: "" }, { totalCycleSec: "0" }, { totalCycleSec: "abc" }, { totalCycleSec: "-3" }, { totalCycleSec: "1" }, { totalCycleSec: "3600" }, { totalCycleSec: undefined, drillingSec: "20", boringSec: "25" },
  { machineOnTime: "", actualQty: "999999" }, // ideal unknown -> no Actual cap
  // reject split
  { rejectBreakdown: {} }, { rejectBreakdown: undefined }, { rejectBreakdown: null },
  { rejectBreakdown: { "Dimension Out": "5" } }, { rejectBreakdown: { "Dimension Out": "11" } }, { rejectBreakdown: { "Dimension Out": "6", "Tool Mark": "4" } },
  { rejectBreakdown: { "Dimension Out": "6", "Tool Mark": "5" } }, { rejectBreakdown: { "Dimension Out": "-1" } }, { rejectBreakdown: { "Dimension Out": "abc" } },
  { rejectBreakdown: { "Dimension Out": "" , "Tool Mark": "10" } }, { rejectBreakdown: { "Dimension Out": "0", "Tool Mark": "0" } }, { rejectBreakdown: { "Dimension Out": " " } },
  { rejectBreakdown: { "Dimension Out": "2.5", "Tool Mark": "7.5" } }, { rejectBreakdown: { "Dimension Out": 10 } }, { rejectBreakdown: { "Dimension Out": "0.1", "Tool Mark": "0.2", Other: "9.7" }, rejectOtherRemark: "x" },
  { okQty: "600", rejectBreakdown: { "Dimension Out": "3" } }, { okQty: "600", rejectBreakdown: { "Dimension Out": "0" } }, { okQty: "610", rejectBreakdown: { "Dimension Out": "3" } },
  { rejectBreakdown: { Other: "10" } }, { rejectBreakdown: { Other: "10" }, rejectOtherRemark: "" }, { rejectBreakdown: { Other: "10" }, rejectOtherRemark: "  " }, { rejectBreakdown: { Other: "10" }, rejectOtherRemark: "scratched" },
  { rejectBreakdown: { Other: "4", "Tool Mark": "6" }, rejectOtherRemark: "burr" }, { rejectBreakdown: { Other: "0", "Tool Mark": "10" } }, { rejectBreakdown: { Other: "" , "Tool Mark": "10" }, rejectOtherRemark: "" },
  // planned shift
  { plannedOperatorShiftHours: "" }, { plannedOperatorShiftHours: undefined }, { plannedOperatorShiftHours: "0" }, { plannedOperatorShiftHours: "-1" }, { plannedOperatorShiftHours: "24" }, { plannedOperatorShiftHours: "24.5" }, { plannedOperatorShiftHours: "abc" },
  { plannedOperatorShiftHours: "8" }, { plannedOperatorShiftHours: "8", lunchMin: "" }, { plannedOperatorShiftHours: "8", lunchMin: "0" }, { plannedOperatorShiftHours: "8", lunchMin: "5" },
  { plannedOperatorShiftHours: "7" }, { plannedOperatorShiftHours: "7", lunchMin: "" }, { plannedOperatorShiftHours: "0.5", lunchMin: "" }, { plannedOperatorShiftHours: "8.004", lunchMin: "" }, { plannedOperatorShiftHours: "8.0084", lunchMin: "" },
  { plannedOperatorShiftHours: 8.5 }, { plannedOperatorShiftHours: "8,5" },
  // lunch
  { lunchMin: "" }, { lunchMin: undefined }, { lunchMin: null }, { lunchMin: "0" }, { lunchMin: "abc" }, { lunchMin: "-1" }, { lunchMin: "1440" }, { lunchMin: "1441" }, { lunchMin: "  " }, { lunchMin: 30 }, { lunchMin: "12.5" },
  { machineOnTime: "", lunchMin: "" }, { plannedOperatorShiftHours: "", lunchMin: "" }, { machineOnTime: "abc", lunchMin: "" },
  // downtime range + stoppage cap
  { setupMin: "10" }, { setupMin: "1441" }, { setupMin: "-1" }, { setupMin: "abc" }, { setupMin: "  " }, { setupMin: "1440", lunchMin: "0" }, { noManPowerMin: "5" }, { materialShiftingMin: "5" }, { noMaterialMin: "5" }, { bdMechMin: "5" }, { bdEleMin: "5" }, { noPowerMin: "5" },
  { plannedDownMin: "50" }, { plannedDownMin: "500" },
  { lunchMin: "20", setupMin: "10" }, { lunchMin: "20", setupMin: "11" }, { lunchMin: "0", setupMin: "30" }, { lunchMin: "0", setupMin: "31" }, { lunchMin: "15", noPowerMin: "15" }, { lunchMin: "15", noPowerMin: "16" },
  { plannedOperatorShiftHours: "8", lunchMin: "0", setupMin: "1" }, { plannedOperatorShiftHours: "7", lunchMin: "0" }, { plannedOperatorShiftHours: "7", lunchMin: "0", setupMin: "5" },
  { machineOnTime: "22:00", machineOffTime: "06:00", plannedOperatorShiftHours: "9", lunchMin: "30" }, { machineOnTime: "22:00", machineOffTime: "06:00", plannedOperatorShiftHours: "9", lunchMin: "61" },
  { otherMin: "5" }, { otherMin: "5", otherMinRemark: "" }, { otherMin: "5", otherMinRemark: "  " }, { otherMin: "5", otherMinRemark: "power cut", lunchMin: "20" }, { otherMin: "0" }, { otherMin: "0", otherMinRemark: "" }, { otherMin: "abc" }, { otherMin: "-1" }, { otherMin: "1441", lunchMin: "0" }, { otherMin: "31", otherMinRemark: "x", lunchMin: "0" },
  { otherMin: "10", otherMinRemark: "r", lunchMin: "20" }, { otherMin: "10", lunchMin: "20" },
  // cycle-op numbers
  { drillingSec: "5" }, { drillingSec: "-5" }, { boringSec: "abc" }, { threadingSec: "  " }, { tappingSec: "0" }, { chamferingSec: "1e2" }, { otherOp1Sec: "-0.1" }, { otherOp2Sec: "x" }, { clampDeclampSec: "3" }, { clampDeclampSec: "-3" },
  // several at once
  { date: "", machine: "", operator: "", itemName: "" },
  { date: "", machine: "", operator: "", itemName: "", machineOnTime: "", machineOffTime: "", actualQty: "", okQty: "", plannedOperatorShiftHours: "", lunchMin: "" },
  { actualQty: "700", okQty: "800", plannedOperatorShiftHours: "0", lunchMin: "-1", setupMin: "9999", otherMin: "9", drillingSec: "-1" },
  { actualQty: "abc", okQty: "abc", rejectBreakdown: { Other: "3" } },
  { actualQty: "10", okQty: "3", rejectBreakdown: { Other: "7" } },
  { actualQty: "10", okQty: "3", rejectBreakdown: { Other: "7" }, rejectOtherRemark: "r" },
  { excludedOps: ["drillingSec"], drillingSec: "10", boringSec: "20", totalCycleSec: undefined },
  { excludedOps: ["drillingSec"], drillingSec: "10", totalCycleSec: "45" },
  { machineOnTime: "6:00", machineOffTime: "14:00", plannedOperatorShiftHours: "8", lunchMin: "" }, // no allowance, lunch optional
  { machineOnTime: "6:00", machineOffTime: "14:00", plannedOperatorShiftHours: "8", lunchMin: "0", noManPowerMin: "1" },
  { machineOnTime: "6:00", machineOffTime: "14:00", plannedOperatorShiftHours: "7.9", lunchMin: "" }, // negative allowance
  { machineOnTime: "6:00", machineOffTime: "14:00", plannedOperatorShiftHours: "7.9", lunchMin: "0", setupMin: "1" },
];
const valInputs = valMutations.map((m) => {
  const v = { ...baseValid(), ...m };
  for (const k of Object.keys(v)) if (v[k] === undefined) delete v[k];
  return v;
});
// pairs of random single mutations
for (let i = 0; i < 260 * SCALE; i += 1) {
  const a = pick(valMutations);
  const b = pick(valMutations);
  const v = { ...baseValid(), ...a, ...b };
  for (const k of Object.keys(v)) if (v[k] === undefined) delete v[k];
  valInputs.push(v);
}
// fully random blocks
const SPLIT_POOL = [{}, { "Dimension Out": "1" }, { Other: "2" }, { Other: "3", "Tool Mark": "3" }, { "Machine Fault": "abc" }, { "Tool Mark": "-1" }, { "Setting Mistake": "" }];
for (let i = 0; i < 260 * SCALE; i += 1) {
  const v = {
    date: pick(["2026-04-06", "", null]),
    machine: pick(["m1", "", undefined]),
    operator: pick(["o1", "", undefined]),
    itemName: pick(["P", "", " "]),
    machineOnTime: pick([...TIMES_OK, ...TIMES_BAD]),
    machineOffTime: pick([...TIMES_OK, ...TIMES_BAD]),
    totalCycleSec: pick(NUMS),
    actualQty: pick(QTY),
    okQty: pick(QTY),
    rejectBreakdown: pick(SPLIT_POOL),
    rejectOtherRemark: pick(["", "why", undefined]),
    plannedOperatorShiftHours: pick(["", "8", "8.5", "9", "24", "25", "0", "abc", 8]),
    lunchMin: pick(["", "0", "30", "60", "1441", "x", 15]),
    otherMinRemark: pick(["", "r", undefined]),
  };
  for (const f of STOPPAGE_FIELDS) if (f.key !== "lunchMin" && chance(0.3)) v[f.key] = pick(["", "0", "5", "10", "40", "1441", "-2", "z"]);
  for (const f of CYCLE_OP_FIELDS) if (chance(0.1)) v[f.key] = pick(NUMS);
  for (const k of Object.keys(v)) if (v[k] === undefined) delete v[k];
  valInputs.push(v);
}
const valCases = valInputs.map((v) => ({
  v: encIn(v),
  errors: enc(validateEntry(v)),
  keys: Object.keys(validateEntry(v)),
  limit: enc(stoppageLimitMin(v)),
  lunchRequired: lunchRequired(v),
  split: enc(cleanSplit(v.rejectBreakdown)),
  calc: enc(rowCalc(v)),
}));

// firstError: real validateEntry outputs grouped 1-4, plus hand-made lists
const feLists = [];
for (let i = 0; i + 3 < valCases.length && feLists.length < 160; i += 5) {
  const n = 1 + (i % 4);
  feLists.push(valCases.slice(i, i + n).map((c) => c.errors));
}
feLists.push([]);
feLists.push([{}]);
feLists.push([{}, {}]);
feLists.push([null, { okQty: "x" }]);
feLists.push([{ otherMinRemark: "b", date: "a" }]);
feLists.push([{ cycleTimeXyz: "unknown key" }]);
feLists.push([{ zzz: "first unknown", yyy: "second unknown" }]);
feLists.push([{ zzz: "unknown" , lunchMin: "L"}]);
feLists.push([{ stoppageTotal: "s", setupMin: "m" }, { date: "d" }]);
feLists.push([{ date: "" }, { machine: "m" }]);
feLists.push([{ date: "" , zzz: "u"}]);
feLists.push([{}, { rejectBreakdown: "r", rejectOtherRemark: "o", actualQty: "a" }, { date: "d" }]);
for (const f of FIELD_ORDER) feLists.push([{}, { [f]: "err" }]);
const firstErrorCases = feLists.map((list) => ({ list, out: enc(firstError(list)) }));

write("validation.json", {
  fieldOrder: FIELD_ORDER,
  downtimeKeys: DOWNTIME_KEYS,
  cases: valCases,
  firstError: firstErrorCases,
});

// ── time, cycle totals, dates ───────────────────────────────────────────────
const timeStrings = new Set();
for (let h = 0; h <= 26; h += 1) {
  timeStrings.add(String(h));
  timeStrings.add(String(h).padStart(2, "0"));
  for (const m of [0, 5, 9, 10, 30, 45, 59, 60, 61, 99]) {
    const mm = String(m).padStart(2, "0");
    timeStrings.add(`${h}${mm}`);
    timeStrings.add(`${String(h).padStart(2, "0")}${mm}`);
    timeStrings.add(`${h}:${mm}`);
    timeStrings.add(`${h}.${mm}`);
    timeStrings.add(`${String(h).padStart(2, "0")}:${mm}`);
    timeStrings.add(` ${h}:${mm} `);
  }
}
for (const s of ["", " ", "abc", "9:5", "9:", ":30", "930a", "1:2:3", "9.30.10", "9.3", "09.30", "12345", "123", "1", "001", "0009", "9 30", "9;30", "-9", "+9", "9e1", "１２", "12:30 PM", "8:60", "23:59", "24:00", "00:00", "0:0", "00:00:00", "7.", ".30", "9..30", "\t9:30\n", "9:3O", "0930 ", "\u0085930", "\u00a09:30\u00a0", "\ufeff9:30", "9:30\u2028"]) timeStrings.add(s);
const timeInputs = [...timeStrings, 9, 930, 9.3, 9.30, 0, 24, 1234, 2359, 2400, 12.5, null, undefined, true, NaN];
const normCases = timeInputs.map((raw) => ({ raw: enc(raw), out: normalizeTime(raw) }));

const spanPairs = [];
const spanSample = ["", null, "abc", "0", "00:00", "9", "930", "9:30", "09:30", "12:00", "17:45", "23:59", "22:00", "06:00", "6", "24:00"];
for (const a of spanSample) for (const b of spanSample) spanPairs.push([a, b]);
for (let i = 0; i < 150; i += 1) spanPairs.push([pick(TIMES_OK), pick(TIMES_OK)]);
const spanCases = spanPairs.map(([on, off]) => ({ on, off, out: spanMinutes(on, off) }));

const opsCases = [[], null, undefined, [1, 2, 3], ["1", "2", ""], [null, undefined, "x"], ["abc"], [10, "20", " ", "1e1"], [0], ["", ""], ["0x10", "1"], [NaN, 3], [1e308, 1e308], ["  ", 5], [true, 2]].map((ops) => ({
  ops: encIn(ops),
  out: enc(totalCycleSec(ops)),
}));

const dateCases = [];
for (const [y, m, d, hh] of [[2026, 1, 1, 0], [2026, 4, 6, 23], [2024, 2, 29, 12], [2026, 12, 31, 23], [2000, 1, 5, 0], [1999, 9, 9, 9], [2100, 2, 28, 12], [2026, 10, 5, 1], [2026, 11, 30, 0]]) {
  dateCases.push({ y, m, d, hh, out: isoDay(new Date(y, m - 1, d, hh, 30)) });
}
const monthInputs = ["2026-01", "2026-02", "2024-02", "2100-02", "2000-02", "1900-02", "2026-04", "2026-12", "2026-1", "2026-3", "2026-03-15", "2026-13", "2026-00", "2026-0", "26-02", "0026-02", "2026", "", "abc", "abc-def", "-", "2026-", "-04", "2026-04-", "  2026-04 ", "2026-4.5", "2026-04x", "1e3-01", "2026-02-x", "99-12", "100-02", "2026- 4", "2026--4"];
const monthCases = monthInputs.map((s) => ({ s, out: daysOfMonth(s) }));
const dayInputs = ["2026-04-06", "2026-04", "", "x", "2026-04-06-07", "6/4/2026", "2026-4-6", "2026-04-6"];
const displayCases = dayInputs.map((s) => ({ s, out: displayDay(s) }));
const sundayInputs = [];
for (let i = 0; i < 90; i += 1) {
  const d = new Date(2026, 3, 1 + i);
  sundayInputs.push(isoDay(d));
}
for (const s of ["2024-02-29", "2000-01-02", "2026-4-5", "2026-04-05", "2026-04-5", "2026-04", "", "abc", "2026-13-01", "2026-04-31", "2026-00-10", "2026-04-00", "2026-04-x", "26-04-05", "0026-04-05", "1900-01-07", "2026-04-05-01", " 2026-04-05", "2026-04-05 "]) sundayInputs.push(s);
const sundayCases = sundayInputs.map((s) => ({ s, out: isSunday(s) }));
const keyCases = [["2026-04-06", "m1", 1], ["2026-04-06", "m1", "2"], ["", "", 0], ["d", "m", 1.5], ["d", "m", 1e21], ["d", "m", -0]].map(([a, b, c]) => ({ a, b, c, out: rowKey(a, b, c) }));

write("time_and_dates.json", {
  normalizeTime: normCases,
  spanMinutes: spanCases,
  totalCycleSec: opsCases,
  isoDay: dateCases,
  daysOfMonth: monthCases,
  displayDay: displayCases,
  isSunday: sundayCases,
  rowKey: keyCases,
  cycleOpLabels: CYCLE_OP_FIELDS.map((f) => ({ key: f.key, label: cycleOpLabel(f) })),
  constants: {
    SLOTS_PER_DAY,
    CYCLE_OPS,
    CYCLE_OP_FIELDS,
    REJECT_REASONS,
    WORKING_STATUSES,
    STOPPAGE_FIELDS,
  },
});

// ── formatting / JS number semantics ────────────────────────────────────────
const fmtValues = [0, -0, 1, -1, 5, 10, 100, 1000, 0.5, 1.5, 2.5, 0.125, 0.375, 1.005, 2.675, 1.45, 8.345, 10.4, 100.5, 99.995, 99.999, 0.001, 0.0049, 0.005, 0.0051, 0.004999999, 0.1 + 0.2, 1 / 3, 2 / 3, 12.3456, 1234.5678, 123456789.123456789, 1e15 + 0.3, 4503599627370497.5, 1e20, 1e21, 1.5e21, 1e-7, 5e-324, 1.7976931348623157e308, Number.MAX_SAFE_INTEGER, -0.001, -2.5, -1.005, -1234.5678, -0.0049, 3600 / 7, 7 / 3600, 0.30000000000000004, 42.10000000000001, 1e-6, 1.5e-6, 123e-9, 99.5, 0.995, 0.9995, 12.5, 12.25, 12.75, 0.045, 1.0049999999999999];
const fmtInputs = [...fmtValues, NaN, Infinity, -Infinity, null, undefined, "5", "abc", true, [], {}];
for (let i = 0; i < 400 * SCALE; i += 1) {
  const mag = Math.pow(10, int(-6, 12));
  fmtInputs.push((rnd() - 0.4) * mag);
}
for (let i = 0; i < 200 * SCALE; i += 1) fmtInputs.push(int(-2000, 2000) / pick([2, 4, 8, 10, 100, 1000, 16, 3, 7]));
const fmtCases = fmtInputs.map((v) => ({
  v: enc(v),
  num: enc(fmtNum(v)),
  num0: fmtNum(v, 0),
  num1: fmtNum(v, 1),
  num3: fmtNum(v, 3),
  pct: fmtPct(v),
}));
// toFixed / String(number) / Number(string) — the primitives fmtNum leans on
const toFixedCases = [];
for (const v of fmtValues) for (const d of [0, 1, 2, 3, 5]) toFixedCases.push({ v, d, out: v.toFixed(d) });
for (let i = 0; i < 600 * SCALE; i += 1) {
  const v = (rnd() - 0.5) * Math.pow(10, int(-8, 20));
  const d = int(0, 6);
  toFixedCases.push({ v, d, out: v.toFixed(d) });
}
for (let i = 0; i < 300 * SCALE; i += 1) {
  const v = int(-100000, 100000) / pick([2, 4, 8, 16, 32, 64, 5, 25, 125]);
  const d = int(0, 4);
  toFixedCases.push({ v, d, out: v.toFixed(d) });
}
const strNumbers = [...fmtValues.filter((v) => Number.isFinite(v)), 123456789012345680000, 1e21, 1.2e21, 1e-6, 1.234e-7, 0.000001234, 100, 12345678901234567890, 0.1, 5e-7, 1e100, -1e-10, NaN, Infinity, -Infinity];
for (let i = 0; i < 300 * SCALE; i += 1) strNumbers.push((rnd() - 0.5) * Math.pow(10, int(-12, 25)));
const numStrCases = strNumbers.map((v) => ({ v: enc(v), out: String(v) }));
const parseStrings = ["", " ", "\t\n", "0", "1", "-1", "+1", "1.5", ".5", "5.", "-.5", "+.5e-2", ".", "-", "+", "e5", "5e", "5e+", "5e3", "5E3", "5e+3", "5e-3", "1e400", "-1e400", "1e-400", "0x10", "0X1f", "-0x10", "0o17", "0b101", "0b2", "0x", "0xg", "Infinity", "+Infinity", "-Infinity", "infinity", "INFINITY", "NaN", "nan", "1_000", "1,5", "1 5", " 12 ", "12abc", "abc", "١٢", "0.1", "00012", "-0", "1.", "1.e2", "1e2.5", "--1", "+-1", "0.0000001", "123456789012345678901234567890", "9007199254740993", "4.9e-324", "1.7976931348623157e308", "1.7976931348623159e308", " 12 ", "﻿12", "1 ", "true", "null", "undefined", "[]", "{}", "\u0085", "\u008512\u0085", "\u180e12", "\u200b12", "\u3000 12 \u2003"];
const parseCases = [...parseStrings.map((s) => ({ s, out: enc(Number(s)) }))];

write("formatting.json", { fmt: fmtCases, toFixed: toFixedCases.map((c) => ({ ...c, v: enc(c.v) })), numStr: numStrCases, parse: parseCases });

// ── remarkParts ─────────────────────────────────────────────────────────────
const remarkRows = [
  {},
  null,
  undefined,
  { remarks: "general" },
  { rejectOtherRemark: "burr", rejectBreakdown: { Other: "4" } },
  { rejectOtherRemark: "burr", rejectBreakdown: { Other: "0" } },
  { rejectOtherRemark: "burr", rejectBreakdown: {} },
  { rejectOtherRemark: "burr" },
  { rejectOtherRemark: "burr", rejectBreakdown: { Other: "abc" } },
  { rejectOtherRemark: "burr", rejectBreakdown: { Other: 2.5 } },
  { otherMinRemark: "power cut", otherMin: "15" },
  { otherMinRemark: "power cut", otherMin: 15.75 },
  { otherMinRemark: "power cut", otherMin: "0" },
  { otherMinRemark: "power cut" },
  { otherMinRemark: "  ", otherMin: "3" },
  { rejectOtherRemark: "a", otherMinRemark: "b", remarks: "c", rejectBreakdown: { Other: "1" }, otherMin: "2" },
  { rejectOtherRemark: "", otherMinRemark: "", remarks: "" },
  { rejectOtherRemark: null, otherMinRemark: null, remarks: null },
  { remarks: "   " },
  { rejectBreakdown: { Other: "3" }, otherMin: "3" },
  { rejectOtherRemark: "r", rejectBreakdown: { Other: "1e2" } },
];
const remarkCases = remarkRows.map((r) => ({ r: r === undefined ? null : encIn(r), out: enc(remarkParts(r)) }));
write("remarks.json", remarkCases);

// ── machine ON/OFF times: OFF-after-ON and the overlap rules ─────────────────
// Hand-built (no PRNG draws, so every other fixture above stays byte-identical).
// Every input runs through the REAL overlapErrors / bookedRanges / validateEntry.
const OV_TIMES = ["", "00:00", "06:00", "07:59", "08:00", "9:00", "11:59", "12:00", "13:00", "14:00", "17:59", "18:00", "21:00", "22:00", "23:30", "23:59", "abc"];
const OV_OCC = {
  "m1|2026-09-25": [
    { slot: 1, machineOnTime: "08:00", machineOffTime: "12:00" },
    { slot: 2, machineOnTime: "14:00", machineOffTime: "18:00" },
    { slot: 3, machineOnTime: "22:00", machineOffTime: "06:00" }, // an older row that ran through midnight
  ],
  "m2|2026-09-25": [{ slot: 1, machineOnTime: "", machineOffTime: "" }],
};
const ovEntry = (o = {}) => ({ date: "2026-09-25", machine: "m1", machineOnTime: "", machineOffTime: "", ...o });
const overlapCases = [];
const addOv = (entries, extra = {}) => {
  const occupied = extra.occupied ?? OV_OCC;
  const editSlot = extra.editSlot ?? null;
  const saved = extra.saved ?? null;
  overlapCases.push({
    entries,
    occupied,
    editSlot,
    saved,
    out: overlapErrors(entries, occupied, { editSlot, saved }),
    booked: entries.map((v) => bookedRanges(v, occupied, editSlot)),
    validate: entries.map((v) => validateEntry(v, { saved })),
  });
};
for (const on of OV_TIMES) for (const off of OV_TIMES) addOv([ovEntry({ machineOnTime: on, machineOffTime: off })]);
for (const editSlot of [1, 2, 3]) {
  for (const [on, off] of [["09:00", "11:00"], ["07:00", "13:00"], ["08:00", "15:00"], ["13:00", "19:00"], ["23:00", "23:30"]]) {
    addOv([ovEntry({ machineOnTime: on, machineOffTime: off })], { editSlot });
  }
}
// an older row: untouched times are exempt, changed times are not
for (const [on, off] of [["22:00", "06:00"], ["22:00", "05:00"], ["10:00", "13:00"], ["10:00", "13:05"]]) {
  addOv([ovEntry({ machineOnTime: on, machineOffTime: off })], { editSlot: 3, saved: { machineOnTime: on === "10:00" ? "10:00" : "22:00", machineOffTime: off === "13:00" ? "13:00" : "06:00" } });
}
// other machine / other date / blank neighbours / missing keys
addOv([ovEntry({ machine: "m2", machineOnTime: "09:00", machineOffTime: "10:00" })]);
addOv([ovEntry({ date: "2026-09-26", machineOnTime: "09:00", machineOffTime: "10:00" })]);
addOv([ovEntry({ machine: "", machineOnTime: "09:00", machineOffTime: "10:00" })]);
addOv([ovEntry({ date: "", machineOnTime: "09:00", machineOffTime: "10:00" })]);
addOv([ovEntry({ machineOnTime: "09:00", machineOffTime: "10:00" })], { occupied: {} });
// several blocks of one form
const blk = (on, off, o = {}) => ovEntry({ machineOnTime: on, machineOffTime: off, ...o });
const NONE = {};
addOv([blk("08:00", "10:00"), blk("09:00", "11:00")], { occupied: NONE });
addOv([blk("08:00", "10:00"), blk("10:00", "12:00")], { occupied: NONE });
addOv([blk("08:00", "10:00"), blk("09:00", "11:00", { machine: "m2" })], { occupied: NONE });
addOv([blk("08:00", "10:00"), blk("09:00", "11:00", { date: "2026-09-26" })], { occupied: NONE });
addOv([blk("08:00", "12:00"), blk("09:00", "10:00"), blk("11:00", "13:00")], { occupied: NONE });
addOv([blk("12:00", "14:00"), blk("13:00", "15:00")]);
addOv([blk("", ""), blk("09:00", "10:00")], { occupied: NONE });

const fmtMinutes = [0, 1, 5, 59, 60, 61, 300, 479, 480, 719, 720, 721, 780, 959, 960, 1319, 1320, 1439, 1440, 1441, 1500, 1800, 2879];
write("overlap.json", {
  cases: overlapCases,
  fmt12: fmtMinutes.map((m) => ({ m, out: fmt12(m) })),
  intervals: OV_TIMES.flatMap((on) => OV_TIMES.map((off) => ({ on, off, out: timeInterval(on, off) }))),
  ruleMessages: [
    "Machine OFF Time must be after Machine ON Time",
    "Machine ON Time overlaps another entry for this machine on this date (8:00 AM – 12:00 PM)",
    "Machine OFF Time overlaps another entry for this machine on this date (2:00 PM – 6:00 PM)",
    "Machine ON Time is required",
    "Enter a valid time",
    "Total stoppage is 5 min",
    "",
  ].map((m) => ({ m, out: isTimeRuleMessage(m) })),
});

console.log(
  JSON.stringify({
    rowCalc: rowCalcOut.length,
    dayCalc: dayCases.length,
    validate: valCases.length,
    firstError: firstErrorCases.length,
    normalizeTime: normCases.length,
    fmt: fmtCases.length,
    toFixed: toFixedCases.length,
    numStr: numStrCases.length,
    parse: parseCases.length,
    remarks: remarkCases.length,
    overlap: overlapCases.length,
  }),
);
