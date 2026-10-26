// Golden-fixture generator for the Contact / Trobe / Spring parity tests.
//
// Runs the REAL client/src/utils/{contact,trobe,spring}{Sheet,Validation}.js
// (and quantityRules.js plus the pure parts of the three Data Entry pages) over a seeded, broad input
// set and writes the JSON the Dart tests compare against. client/ is only READ.
//
//   ESB=../client/node_modules/.bin/esbuild
//   $ESB test/production/processes/tool/gen_twin_golden.mjs --bundle --platform=node \
//        --format=esm --outfile=<scratch>/twin-golden/gen.mjs
//   OUT_DIR=test/production/processes TZ=Asia/Kolkata node <scratch>/twin-golden/gen.mjs
//
// Fixtures land in $OUT_DIR/{contact,trobe,spring}/fixtures/*.json. NaN/Infinity/
// undefined travel as {"$n":..} / {"$u":1} (see test/production/calc/golden_support.dart).
// SEED=.. SCALE=.. give bigger one-off soak runs.

import fs from "node:fs";
import path from "node:path";
import { REJECT_REASONS, sortByMachineOn, STOPPAGE_FIELDS } from "../../../../../client/src/utils/productionSheet.js";
import { hmToWireHours, hoursToShiftInput, parseShiftHours } from "../../../../../client/src/utils/shiftHours.js";
import { hasRejectData, quantityFormValues, rejectPayload } from "../../../../../client/src/utils/quantityRules.js";
import * as contactSheet from "../../../../../client/src/utils/contactSheet.js";
import * as trobeSheet from "../../../../../client/src/utils/trobeSheet.js";
import * as springSheet from "../../../../../client/src/utils/springSheet.js";
import * as contactVal from "../../../../../client/src/utils/contactValidation.js";
import * as trobeVal from "../../../../../client/src/utils/trobeValidation.js";
import * as springVal from "../../../../../client/src/utils/springValidation.js";

const OUT = process.env.OUT_DIR;
if (!OUT) throw new Error("set OUT_DIR");

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

const TIMES_OK = ["06:00", "07:30", "08:00", "9", "930", "0930", "9:30", "9.30", "13:15", "14:00", "16:00", "21:30", "22:00", "23:59", "00:00", "02:00", "05:45"];
const TIMES_BAD = ["24:00", "9:5", "abc", "12345", "", "  ", "25", "7:60", null, undefined, 930, 9, "9-30"];
const NUMS = ["", undefined, null, "0", "1", "5", "10", "12.5", 3, 7.5, "  ", "abc", "-4", "1e2", "0x10", "45", 45, "120", "0.5", "600"];
const QTY = ["", undefined, null, "0", "10", "100", "250", "300", "480", "599", "600", "640", 320, 55, "12.5", "-3", "abc", "  ", "9999"];
const ITEMS = ["Part A", "Bracket 7B", "Flange", " Part B ", "X"];

// Typed Actual + OK (Rejected = Actual − OK); now and then an old row with OK + Rejected only.
function sanePieces() {
  const ok = int(0, 500);
  const rej = int(0, 60);
  if (chance(0.2)) return { okQty: String(ok), rejectedQty: String(rej) };
  return { actualQty: String(ok + rej), okQty: String(ok), ...(chance(0.3) ? { rejectedQty: String(rej) } : {}) };
}
function saneRow(id) {
  const shifts = [["06:00", "14:00"], ["14:00", "22:00"], ["22:00", "06:00"], ["08:00", "16:00"], ["07:30", "15:45"], ["9", "17"], ["0930", "1330"], ["9:30", "18.15"]];
  const [on, off] = pick(shifts);
  return {
    _id: id,
    date: "2026-04-06",
    machine: "m" + int(1, 4),
    operator: "op" + int(1, 5),
    itemName: pick(ITEMS),
    machineOnTime: on,
    machineOffTime: off,
    totalCycleSec: pick(["45", "60", "36", "90", 45, "12.5", "3600"]),
    ...sanePieces(),
    plannedOperatorShiftHours: pick(["8", "8.5", "9", "12", "4", 8]),
    lunchMin: pick(["0", "20", "30", "45", "", 30]),
    setupMin: pick(["", "0", "10", "25"]),
    remarks: pick(["", "ok", "late start"]),
  };
}
function junkRow(id) {
  const row = { _id: id };
  if (chance(0.85)) row.itemName = pick(["Part A", "Bracket", " ", "", null, undefined, 7]);
  if (chance(0.9)) row.machineOnTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.9)) row.machineOffTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.7)) row.totalCycleSec = pick(NUMS);
  if (chance(0.85)) row.okQty = pick(QTY);
  if (chance(0.85)) row.rejectedQty = pick(QTY);
  if (chance(0.6)) row.actualQty = pick(QTY);
  if (chance(0.5)) row.plannedOperatorShiftHours = pick(NUMS);
  for (const f of STOPPAGE_FIELDS) if (chance(0.35)) row[f.key] = pick(NUMS);
  return row;
}

const curated = [
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "400", rejectedQty: "20", lunchMin: "30", setupMin: "10", plannedOperatorShiftHours: "8.5" },
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "420", okQty: "400", lunchMin: "30", setupMin: "10", plannedOperatorShiftHours: "8.5" },
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "420", okQty: "400", rejectedQty: "99" },
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "60", actualQty: "400" },
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "60", actualQty: "300", okQty: "400" },
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "60", actualQty: "0", okQty: "0" },
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "60", okQty: "400" },
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "60", rejectedQty: "20" },
  { itemName: "Part A", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "60", okQty: "0", rejectedQty: "0" },
  { itemName: "Part A", machineOnTime: "22:00", machineOffTime: "06:00", totalCycleSec: "36", okQty: "700", rejectedQty: "0", plannedOperatorShiftHours: 9 },
  { itemName: "", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "5", rejectedQty: "1" },
  { machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "5" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "0", okQty: "9", rejectedQty: "1" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "-10", okQty: "9", rejectedQty: "1" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "abc", okQty: "9", rejectedQty: "1" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "97", okQty: "10", rejectedQty: "0" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", plannedDownMin: "5", setupMin: "10", noManPowerMin: "1", materialShiftingMin: "2", noMaterialMin: "3", bdMechMin: "4", bdEleMin: "5", noPowerMin: "6", lunchMin: "30", otherMin: "7", okQty: "100", rejectedQty: "3", plannedOperatorShiftHours: "9" },
  { itemName: "P", plannedDownMin: "x", setupMin: "  ", lunchMin: 30, otherMin: "" },
  { itemName: "P", machineOnTime: 8, machineOffTime: 16, totalCycleSec: 45, okQty: 590, rejectedQty: 10 },
  { itemName: "P", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "abc", rejectedQty: "5" },
  { itemName: "P", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "5", rejectedQty: "abc" },
  { itemName: "P", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: true, rejectedQty: false },
  { itemName: "P", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "50", okQty: "40" },
  { itemName: "P", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "abc", okQty: "40", rejectedQty: "2" },
  { itemName: "P", machineOnTime: "8:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "", okQty: "40", rejectedQty: "2" },
  { itemName: "P", totalCycleSec: "45", okQty: "5", rejectedQty: "5" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "5", rejectedQty: "5", plannedOperatorShiftHours: "0" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "5", rejectedQty: "5", plannedOperatorShiftHours: "abc", lunchMin: "480" },
  { itemName: "P", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "5", rejectedQty: "5", plannedOperatorShiftHours: "8", otherActivityMin: "30", plannedDownMin: "20" },
  {},
];

function rowCases() {
  const out = [...curated];
  for (let i = 0; i < 600 * SCALE; i += 1) out.push(chance(0.45) ? saneRow("r" + i) : junkRow("r" + i));
  return out;
}

const mk = (id, on, off, extra = {}) => ({ _id: id, itemName: "P", machineOnTime: on, machineOffTime: off, totalCycleSec: "45", actualQty: "100", okQty: "90", ...extra });
function dayCaseRows() {
  const days = [
    [],
    [mk("a", "06:00", "14:00", { lunchMin: "30", setupMin: "10", actualQty: "610", okQty: "600", plannedOperatorShiftHours: "8.5" })],
    [mk("a", "14:00", "22:00", { lunchMin: "30" }), mk("b", "06:00", "13:30", { lunchMin: "20", setupMin: "5" }), mk("c", "22:00", "02:00")],
    [mk("a", "06:00", "10:00"), mk("b", "10:00", "14:00"), mk("c", "13:00", "18:00")],
    [mk("a", "06:00", "10:00"), mk("b", "11:15", "14:00"), mk("c", "16:45", "23:00")],
    [mk("a", "", "10:00"), mk("b", "06:00", "10:00"), mk("c", "abc", "")],
    [mk("a", "", ""), mk("b", "", "")],
    [mk("a", "08:00", "16:00"), mk("b", "08:00", "12:00"), mk("c", "08:00", "10:00")],
    [null, mk("a", "08:00", "16:00"), null],
    [mk("a", "08:00", "16:00", { itemName: "" })],
    [mk("a", "08:00", "16:00", { lunchMin: "abc" })],
    [mk("a", "08:00", "16:00", { lunchMin: "" }), mk("b", "16:00", "20:00", { lunchMin: null })],
    [mk("a", "08:00", "16:00", { plannedDownMin: "480", okQty: "0" })],
    [mk("a", "08:00", "16:00", { lunchMin: "480", okQty: "10" })],
    [mk("a", "08:00", "16:00", { setupMin: "480", lunchMin: "0" })],
    [mk("a", "22:00", "06:00"), mk("b", "06:00", "14:00")],
    [mk("a", "08:00", "16:00", { plannedOperatorShiftHours: "12", lunchMin: "30" }), mk("b", "16:00", "20:00", { plannedOperatorShiftHours: "3" })],
    [mk("a", "08:00", "16:00", { actualQty: "0", okQty: "0" })],
    [mk("a", "08:00", "16:00", { actualQty: undefined, okQty: "90", rejectedQty: "10" }), mk("b", "16:00", "20:00", { actualQty: "50", okQty: "50" })],
    [mk("a", "08:00", "16:00", { actualQty: "20", okQty: "30" })],
    [mk("a", "08:00", "16:00", { otherActivityMin: "60", plannedOperatorShiftHours: "9" })],
  ];
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
    days.push(rows);
  }
  return days;
}

const baseValid = () => ({
  date: "2026-04-06",
  machine: "m1",
  operator: "op1",
  itemName: "Part A",
  machineOnTime: "08:00",
  machineOffTime: "16:00",
  totalCycleSec: "45",
  actualQty: "510",
  okQty: "500",
  rejectBreakdown: { "Dimension Out": "6", "Tool Mark": "4" },
  plannedOperatorShiftHours: "8.5",
  lunchMin: "30",
  remarks: "",
});
const valMutations = [
  {}, { date: "" }, { date: null }, { date: "  " }, { machine: "" }, { machine: undefined }, { operator: "" }, { operator: "   " }, { itemName: "" }, { itemName: null },
  { machineOnTime: "" }, { machineOffTime: "" }, { machineOnTime: "abc" }, { machineOffTime: "25:00" }, { machineOnTime: "9" }, { machineOffTime: "17.30" }, { machineOnTime: "0800" }, { machineOnTime: 8 },
  { machineOnTime: "", machineOffTime: "" }, { machineOnTime: "22:00", machineOffTime: "06:00" }, { machineOnTime: "08:00", machineOffTime: "08:00" },
  // Production Master: Actual (<= Ideal 640) and OK (<= Actual), Rejected = Actual - OK
  { actualQty: "" }, { actualQty: undefined }, { actualQty: "abc" }, { actualQty: "-1" }, { actualQty: "  " }, { actualQty: "12.5" }, { actualQty: "1e2" }, { actualQty: "0x10" }, { actualQty: 510 },
  { actualQty: "640", okQty: "640", rejectBreakdown: {} }, { actualQty: "641" }, { actualQty: "9999" }, { actualQty: "0", okQty: "0", rejectBreakdown: {} },
  { okQty: "" }, { okQty: undefined }, { okQty: "abc" }, { okQty: "-1" }, { okQty: "  " }, { okQty: "511" }, { okQty: "510" }, { okQty: "510", rejectBreakdown: {} }, { okQty: "0" }, { okQty: 500 }, { okQty: "12.5" }, { okQty: "1e2" }, { okQty: "0x10" },
  { actualQty: "", okQty: "" }, { actualQty: "abc", okQty: "abc" }, { actualQty: "300", okQty: "320" }, { actualQty: "700", okQty: "650" }, { actualQty: "100", okQty: "100", rejectBreakdown: {} }, { actualQty: "100", okQty: "100" },
  // Rejection Master: the boxes add up to Rejected; Other needs a remark
  { rejectBreakdown: {} }, { rejectBreakdown: undefined }, { rejectBreakdown: null }, { rejectBreakdown: { "Dimension Out": "10" } }, { rejectBreakdown: { "Dimension Out": "11" } }, { rejectBreakdown: { "Dimension Out": "5" } },
  { rejectBreakdown: { "Dimension Out": 6, "Tool Mark": 4 } }, { rejectBreakdown: { "Dimension Out": "6", "Tool Mark": "" } }, { rejectBreakdown: { "Dimension Out": "6", "Tool Mark": "0" } },
  { rejectBreakdown: { "Dimension Out": "-1" } }, { rejectBreakdown: { "Dimension Out": "abc" } }, { rejectBreakdown: { "Dimension Out": "2.5", "Tool Mark": "7.5" } },
  { rejectBreakdown: { Other: "10" } }, { rejectBreakdown: { Other: "10" }, rejectOtherRemark: "bad weld" }, { rejectBreakdown: { Other: "10" }, rejectOtherRemark: "   " },
  { rejectBreakdown: { Other: "4", "Dimension Out": "6" }, rejectOtherRemark: "x" }, { rejectBreakdown: { Other: "0", "Dimension Out": "10" } }, { rejectOtherRemark: "stale remark" },
  { rejectBreakdown: { Bogus: "10" } }, { rejectBreakdown: { "Dimension Out": "6", "Tool Mark": "4", Broken: "1" } },
  { actualQty: "300", okQty: "300", rejectBreakdown: { "Dimension Out": "1" } }, { actualQty: "", rejectBreakdown: { "Dimension Out": "1" } }, { okQty: "", rejectBreakdown: {} },
  { totalCycleSec: "" }, { itemName: "", totalCycleSec: "" }, { totalCycleSec: "0" }, { totalCycleSec: "abc" }, { totalCycleSec: "-3" }, { totalCycleSec: "1" }, { totalCycleSec: "3600" }, { totalCycleSec: undefined }, { totalCycleSec: 45 },
  { machineOnTime: "", actualQty: "999999", okQty: "999999" },
  { settingOnTime: "08:30" }, { settingOnTime: "abc" }, { settingOffTime: "25:00" }, { settingOffTime: "9" }, { settingOnTime: "", settingOffTime: "" }, { settingOnTime: "  " }, { settingOnTime: "08:30", settingOffTime: "08:00" },
  { workingStatus: "PRESENT" }, { workingStatus: "ABSENT" }, { workingStatus: "ABSENT", operator: "", itemName: "" }, { workingStatus: "SUNDAY", okQty: "" }, { workingStatus: " LEAVE " }, { workingStatus: "" }, { workingStatus: "present" }, { workingStatus: "M/C OFF", date: "", machine: "" },
  { workingMode: "Non Working" }, { workingMode: "Non Working", operator: "", itemName: "", okQty: "" }, { workingMode: "Non Working", date: "", machine: "" }, { workingMode: "Working" }, { workingMode: "working" }, { workingMode: "Non Working", machineStatus: ["No Planning"] },
  { plannedOperatorShiftHours: "" }, { plannedOperatorShiftHours: undefined }, { plannedOperatorShiftHours: "0" }, { plannedOperatorShiftHours: "-1" }, { plannedOperatorShiftHours: "24" }, { plannedOperatorShiftHours: "24.5" }, { plannedOperatorShiftHours: "abc" },
  { plannedOperatorShiftHours: "8" }, { plannedOperatorShiftHours: "8", lunchMin: "" }, { plannedOperatorShiftHours: "8", lunchMin: "0" }, { plannedOperatorShiftHours: "8", lunchMin: "5" },
  { plannedOperatorShiftHours: "7" }, { plannedOperatorShiftHours: "7", lunchMin: "" }, { plannedOperatorShiftHours: "0.5", lunchMin: "" }, { plannedOperatorShiftHours: "8.004", lunchMin: "" }, { plannedOperatorShiftHours: "8.60" },
  { plannedOperatorShiftHours: 8.5 }, { plannedOperatorShiftHours: "8,5" }, { plannedOperatorShiftHours: "8.5.1" }, { plannedOperatorShiftHours: " 8.5 " },
  { lunchMin: "" }, { lunchMin: undefined }, { lunchMin: null }, { lunchMin: "0" }, { lunchMin: "abc" }, { lunchMin: "-1" }, { lunchMin: "1440" }, { lunchMin: "1441" }, { lunchMin: "  " }, { lunchMin: 30 }, { lunchMin: "12.5" },
  { machineOnTime: "", lunchMin: "" }, { plannedOperatorShiftHours: "", lunchMin: "" }, { machineOnTime: "abc", lunchMin: "" },
  { setupMin: "10" }, { setupMin: "1441" }, { setupMin: "-1" }, { setupMin: "abc" }, { setupMin: "  " }, { setupMin: "1440", lunchMin: "0" }, { noManPowerMin: "5" }, { materialShiftingMin: "5" }, { noMaterialMin: "5" }, { bdMechMin: "5" }, { bdEleMin: "5" }, { noPowerMin: "5" },
  { plannedDownMin: "20" }, { plannedDownMin: "50" }, { plannedDownMin: "500" }, { plannedDownMin: "-2" },
  { lunchMin: "20", setupMin: "10" }, { lunchMin: "20", setupMin: "11" }, { lunchMin: "0", setupMin: "30" }, { lunchMin: "0", setupMin: "31" }, { lunchMin: "15", noPowerMin: "15" }, { lunchMin: "15", noPowerMin: "16" },
  { machineOnTime: "22:00", machineOffTime: "06:00", plannedOperatorShiftHours: "9", lunchMin: "30" }, { machineOnTime: "22:00", machineOffTime: "06:00", plannedOperatorShiftHours: "9", lunchMin: "61" },
  { otherMin: "5" }, { otherMin: "5", otherMinRemark: "" }, { otherMin: "5", otherMinRemark: "  " }, { otherMin: "5", otherMinRemark: "power cut", lunchMin: "20" }, { otherMin: "0" }, { otherMin: "0", otherMinRemark: "" }, { otherMin: "abc" }, { otherMin: "-1" }, { otherMin: "1441", lunchMin: "0" }, { otherMin: "31", otherMinRemark: "x", lunchMin: "0" },
  { otherMin: "10", otherMinRemark: "r", lunchMin: "20" }, { otherMin: "10", lunchMin: "20" },
  { date: "", machine: "", operator: "", itemName: "" },
  { date: "", machine: "", operator: "", itemName: "", machineOnTime: "", machineOffTime: "", actualQty: "", okQty: "", rejectBreakdown: {}, plannedOperatorShiftHours: "", lunchMin: "", totalCycleSec: "" },
  { actualQty: "800", okQty: "700", rejectBreakdown: { Other: "5" }, plannedOperatorShiftHours: "0", lunchMin: "-1", setupMin: "9999", otherMin: "9" },
  { machineOnTime: "6:00", machineOffTime: "14:00", plannedOperatorShiftHours: "8", lunchMin: "" },
  { machineOnTime: "6:00", machineOffTime: "14:00", plannedOperatorShiftHours: "8", lunchMin: "0", noManPowerMin: "1" },
  { machineOnTime: "6:00", machineOffTime: "14:00", plannedOperatorShiftHours: "7.9", lunchMin: "" },
  { machineOnTime: "6:00", machineOffTime: "14:00", plannedOperatorShiftHours: "7.9", lunchMin: "0", setupMin: "1" },
];
const SAVED = [null, null, { machineOnTime: "08:00", machineOffTime: "16:00" }, { machineOnTime: "08:00", machineOffTime: "07:00" }, { machineOnTime: "9:00", machineOffTime: "09:00" }, {}];
function valCases() {
  const mkv = (...ms) => {
    const v = Object.assign(baseValid(), ...ms);
    for (const k of Object.keys(v)) if (v[k] === undefined) delete v[k];
    return v;
  };
  const out = valMutations.map((m) => ({ v: mkv(m), saved: null }));
  // older rows that already break a time rule stay editable
  for (const m of [{ machineOffTime: "07:00" }, { machineOnTime: "10:00", machineOffTime: "10:00" }, { machineOffTime: "08:00" }]) {
    for (const saved of SAVED) out.push({ v: mkv(m), saved });
  }
  for (let i = 0; i < 300 * SCALE; i += 1) out.push({ v: mkv(pick(valMutations), pick(valMutations)), saved: pick(SAVED) });
  for (let i = 0; i < 60 * SCALE; i += 1) out.push({ v: mkv(pick(valMutations), pick(valMutations), pick(valMutations)), saved: null });
  return out;
}

// ── the pages' toPayload (copied from pages/{Contact,Trobe,Spring}DataEntry.jsx —
// the three are identical bar their names; pages are not importable) ────────
const STOPPAGE_KEYS = STOPPAGE_FIELDS.map((f) => f.key);
const TEXT_FIELDS = ["operator", "workingStatus", "itemName", "drawingNo", "remarks", "rejectOtherRemark", "otherMinRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime", "settingOnTime", "settingOffTime"];
const NUMBER_FIELDS = ["totalCycleSec", "actualQty", "okQty", "plannedOperatorShiftHours", ...STOPPAGE_KEYS];
const STATUS_ONLY_KEPT = ["operator", "workingStatus", "workingMode", "machineStatus", "remarks"];
const makePayload = (isStatusOnly) => {
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
    // rejectedQty is deliberately absent: the server derives it from Actual − OK.
    ...rejectPayload(v),
    ...Object.fromEntries(TIME_FIELDS.map((k) => [k, v[k] ?? ""])),
    ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, v[k] === "" || v[k] === undefined ? "" : Number(v[k])])),
    plannedOperatorShiftHours: (() => {
      const { hours } = parseShiftHours(v.plannedOperatorShiftHours);
      return hours === null ? "" : hmToWireHours(hours);
    })(),
    lunchMin: v.lunchMin === "" || v.lunchMin === undefined ? 0 : Number(v.lunchMin),
  });
  return (v, isEdit) => {
    const body = toFullPayload(v, isEdit);
    if (!isStatusOnly(v) && v.workingMode !== "Non Working") return body;
    return Object.fromEntries(
      Object.entries(body).map(([k, val]) =>
        ["_id", "date", "machine", "slot", ...STATUS_ONLY_KEPT].includes(k) ? [k, val] : [k, k === "item" ? null : k === "rejectBreakdown" ? {} : ""],
      ),
    );
  };
};

const payloadValues = () => {
  const out = [];
  const ids = ["i1", "", undefined, null];
  const base = () => ({
    ...baseValid(), _id: "e1", slot: 2, item: "i1", drawingNo: " D-7 ", workingMode: "Working", machineStatus: [], vendor: "", vendorName: "", workingStatus: "",
    settingOnTime: "", settingOffTime: "", otherMinRemark: "", rejectOtherRemark: "",
    ...Object.fromEntries(STOPPAGE_KEYS.map((k) => [k, ""])),
  });
  const muts = [
    {}, { lunchMin: "" }, { lunchMin: "0" }, { lunchMin: "30" }, { setupMin: "10", otherMin: "5", otherMinRemark: "  power cut  " }, { otherMin: "0", otherMinRemark: "stale" }, { otherMin: "", otherMinRemark: "stale" },
    { plannedOperatorShiftHours: "8.30" }, { plannedOperatorShiftHours: "8.5" }, { plannedOperatorShiftHours: "3.50" }, { plannedOperatorShiftHours: "" }, { plannedOperatorShiftHours: "8.75" }, { plannedOperatorShiftHours: "7.20" },
    { actualQty: "", okQty: "" }, { actualQty: "0", okQty: "0", rejectBreakdown: {} }, { actualQty: "12", okQty: "12", rejectBreakdown: {} }, { totalCycleSec: "12.5" }, { totalCycleSec: "" },
    { rejectBreakdown: {} }, { rejectBreakdown: { "Dimension Out": "6", "Tool Mark": "4" } }, { rejectBreakdown: { "Dimension Out": 3, "Tool Mark": "7" } }, { rejectBreakdown: { "Tool Mark": "4", "Dimension Out": "4", Broken: "2" } },
    { rejectBreakdown: { Other: "10" }, rejectOtherRemark: "  bad weld  " }, { rejectBreakdown: { Other: "0", "Tool Mark": "10" }, rejectOtherRemark: "stale" }, { rejectBreakdown: { "Tool Mark": "10", "Dimension Out": "" }, rejectOtherRemark: "stale" },
    { rejectBreakdown: undefined }, { rejectBreakdown: { "Dimension Out": "0.5", "Tool Mark": "9.5" } },
    { workingMode: "Non Working", rejectBreakdown: { "Dimension Out": "10" }, actualQty: "9" },
    { workingStatus: "ABSENT", rejectBreakdown: { Other: "10" }, rejectOtherRemark: "x" },
    { operator: "  Ravi  " }, { remarks: " note " }, { itemName: " Part A " }, { drawingNo: "" },
    { settingOnTime: "08:30", settingOffTime: "09:00" }, { machineOnTime: "09:30", machineOffTime: "17:30" },
    { workingMode: "Non Working", machineStatus: ["No Manpower", "No Planning"] }, { workingMode: "Non Working", machineStatus: [] }, { workingMode: "Working", machineStatus: ["No Manpower"] }, { workingMode: undefined }, { workingMode: "" },
    { workingStatus: "ABSENT" }, { workingStatus: "SUNDAY", remarks: "holiday" }, { workingStatus: "PRESENT" }, { workingStatus: " LEAVE " }, { workingStatus: "present" },
    { vendor: "v1", vendorName: "Acme" }, { vendor: null },
    { item: "" }, { item: null }, { slot: 3 }, { slot: "1" },
  ];
  for (const m of muts) {
    for (const isEdit of [false, true]) {
      for (const _id of [true, false]) {
        if (!_id && !isEdit) continue;
        const v = { ...base(), ...m };
        if (!_id) delete v._id;
        for (const k of Object.keys(v)) if (v[k] === undefined) delete v[k];
        out.push({ v, isEdit });
      }
    }
  }
  void ids;
  return out;
};

// ── per process ─────────────────────────────────────────────────────────────
const write = (dir, name, data) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
};

const processes = {
  contact: { sheet: contactSheet, val: contactVal, rowCalc: contactSheet.contactRowCalc, dayCalc: contactSheet.contactDayCalc, validate: contactVal.validateContactEntry, first: contactVal.firstContactError, order: contactVal.CONTACT_FIELD_ORDER, down: contactVal.CONTACT_DOWNTIME_KEYS, formulas: contactSheet.CONTACT_FORMULAS },
  trobe: { sheet: trobeSheet, val: trobeVal, rowCalc: trobeSheet.trobeRowCalc, dayCalc: trobeSheet.trobeDayCalc, validate: trobeVal.validateTrobeEntry, first: trobeVal.firstTrobeError, order: trobeVal.TROBE_FIELD_ORDER, down: trobeVal.TROBE_DOWNTIME_KEYS, formulas: trobeSheet.TROBE_FORMULAS },
  spring: { sheet: springSheet, val: springVal, rowCalc: springSheet.springRowCalc, dayCalc: springSheet.springDayCalc, validate: springVal.validateSpringEntry, first: springVal.firstSpringError, order: springVal.SPRING_FIELD_ORDER, down: springVal.SPRING_DOWNTIME_KEYS, formulas: springSheet.SPRING_FORMULAS },
};

// One shared draw per kind so the three processes see the same inputs.
const rows = rowCases();
const days = dayCaseRows();
const vals = valCases();
const payloads = payloadValues();
// Saved rows as the server returns them (numbers) and as the old ones were saved.
const quantityRows = [
  { okQty: 400, rejectedQty: 20 }, { okQty: 400, rejectedQty: 20, rejectReason: "Tool Mark" }, { okQty: 400, rejectedQty: 0, rejectReason: "Tool Mark" },
  { okQty: 400, rejectedQty: 20, rejectReason: "Not A Reason" }, { actualQty: 420, okQty: 400, rejectedQty: 20, rejectBreakdown: { "Dimension Out": 12, "Tool Mark": 8 } },
  { actualQty: 420, okQty: 400, rejectBreakdown: { Other: 20 }, rejectOtherRemark: "bad weld" }, { actualQty: 420, okQty: 400, rejectBreakdown: { Bogus: 20, Broken: 5 } },
  { actualQty: 420, okQty: 400, rejectBreakdown: {}, rejectedQty: 20, rejectReason: "Broken" }, { okQty: 400 }, { rejectedQty: 20 }, { okQty: 0, rejectedQty: 0 }, { actualQty: 0, okQty: 0 },
  { actualQty: 55, okQty: 12.5 }, { actualQty: null, okQty: null, rejectedQty: null }, {}, { actualQty: "30", okQty: "20", rejectedQty: "10", rejectReason: "Broken" }, { okQty: "abc", rejectedQty: 5 },
  { actualQty: 300, okQty: 280, rejectBreakdown: { "Dimension Out": "20" } },
];
const rejectDataCases = [
  {}, { rejectBreakdown: {} }, { rejectBreakdown: { "Tool Mark": "" } }, { rejectBreakdown: { "Tool Mark": "0" } }, { rejectBreakdown: { "Tool Mark": 0 } }, { rejectBreakdown: { "Tool Mark": "3" } },
  { rejectBreakdown: { "Tool Mark": "", Broken: "2" } }, { rejectBreakdown: { "Tool Mark": null } }, { rejectBreakdown: null },
];
const processTexts = [
  { dataEntryMenu: "/hqepl/production/contact-data-entry" }, { dataEntryMenu: "/hqepl/production/trobe-data-entry/" }, { dataEntryMenu: "/hqepl/production/spring-data-entry" },
  { dataEntryMenu: "/production/cnc-data-entry" }, { dataEntryMenu: "" }, { processName: "Contact Assembly" }, { processName: "TROBE" }, { processName: "Spring for pins" }, { processName: "Contactor" }, {},
];

for (const [name, p] of Object.entries(processes)) {
  const dir = path.join(OUT, name, "fixtures");
  write(dir, "row_calc.json", rows.map((row) => ({ row: encIn(row), out: enc(p.rowCalc(row)) })).concat([{ row: null, out: enc(p.rowCalc(null)) }]));
  write(dir, "day_calc.json", days.map((r) => ({ rows: encIn(r), order: sortByMachineOn(r).map((x) => x._id), out: enc(p.dayCalc(r)) })));
  write(dir, "validation.json", vals.map(({ v, saved }) => ({ values: encIn(v), saved: saved ? encIn(saved) : null, errors: enc(p.validate(v, { saved })) })));
  const errorLists = [];
  for (let i = 0; i < 150; i += 1) {
    const n = int(1, 3);
    const list = [];
    for (let j = 0; j < n; j += 1) {
      const c = pick(vals);
      list.push(chance(0.2) ? null : p.validate(c.v, { saved: c.saved }));
    }
    errorLists.push({ errors: enc(list), first: enc(p.first(list.map((e) => e || {}))) });
  }
  write(dir, "first_error.json", { order: p.order, downtime: p.down, cases: errorLists });
  const isStatusOnly = p.sheet.isStatusOnly;
  const toPayload = makePayload(isStatusOnly);
  write(dir, "payload.json", payloads.map(({ v, isEdit }) => ({ values: encIn(v), isEdit, payload: enc(toPayload(v, isEdit)) })));
  write(dir, "misc.json", {
    formulas: p.formulas,
    statusOnly: ["PRESENT", "ABSENT", "LEAVE", "M/C OFF", " SUNDAY ", "", "present", null].map((s) => ({ v: { workingStatus: s }, out: isStatusOnly({ workingStatus: s }) })),
    isProcess: processTexts.map((t) => ({ process: t, out: name === "contact" ? p.sheet.isContactProcess(t) : name === "trobe" ? p.sheet.isTrobeProcess(t) : p.sheet.isSpringProcess(t) })),
    nonWorkingStatuses: p.sheet.NON_WORKING_STATUSES,
  });
  write(dir, "quantity_form.json", {
    forms: quantityRows.map((row) => ({ row: encIn(row), out: enc(quantityFormValues(row)) })),
    hasReject: rejectDataCases.map((v) => ({ v: encIn(v), out: hasRejectData(v) })),
    rejectReasons: REJECT_REASONS,
  });
}
console.log(`wrote ${rows.length} row, ${days.length} day, ${vals.length} validation, ${payloads.length} payload cases per process`);
