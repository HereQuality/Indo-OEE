// Golden-fixture generator for test/production/oee_review/*.
//
// Runs the REAL client JS the entry forms use to decide the "goes to Admin review"
// banner — dayFiguresFor + withDayFigures + metricsOver100 (utils/productionSheet.js)
// with each process's own xxxRowCalc / xxxDayCalc — over seeded entries that share
// a machine and date with already-saved rows, and writes the metric keys the web
// finds above 100%. client/ is only READ.
//
//   cd mobile
//   ESB=../client/node_modules/.bin/esbuild
//   $ESB test/production/oee_review/tool/gen_oee_over_golden.mjs --bundle --platform=node \
//        --format=esm --outfile=<scratch>/oee-golden/gen.mjs
//   OUT_DIR=test/production/oee_review/fixtures TZ=Asia/Kolkata node <scratch>/oee-golden/gen.mjs
//
// SEED=.. / SCALE=.. give bigger one-off soak sets (the committed fixtures use SCALE=1).

import fs from "node:fs";
import path from "node:path";
import { dayCalc, rowCalc, dayFiguresFor, metricsOver100, withDayFigures, OEE_METRIC_LABELS, OEE_FIGURE_KEYS } from "../../../../../client/src/utils/productionSheet.js";
import { withDecimalPlanned } from "../../../../../client/src/utils/entryValidation.js";
import { vmcRowCalc, vmcDayCalc } from "../../../../../client/src/utils/vmcSheet.js";
import { spmRowCalc, spmDayCalc } from "../../../../../client/src/utils/spmSheet.js";
import { rivetRowCalc, rivetDayCalc } from "../../../../../client/src/utils/rivetSheet.js";
import { pressRowCalc, pressDayCalc } from "../../../../../client/src/utils/pressSheet.js";
import { contactRowCalc, contactDayCalc } from "../../../../../client/src/utils/contactSheet.js";
import { trobeRowCalc, trobeDayCalc } from "../../../../../client/src/utils/trobeSheet.js";
import { springRowCalc, springDayCalc } from "../../../../../client/src/utils/springSheet.js";
import { powderRowCalc, powderDayCalc } from "../../../../../client/src/utils/powderCoatingSheet.js";
import { rubberRowCalc, rubberDayCalc } from "../../../../../client/src/utils/rubberSheet.js";
import { printingRowCalc, printingDayCalc } from "../../../../../client/src/utils/printingSheet.js";
import { injectionRowCalc, injectionDayCalc } from "../../../../../client/src/utils/injectionSheet.js";
import { bpcRowCalc, bpcDayCalc } from "../../../../../client/src/utils/bpcSheet.js";
import { rawCastingRowCalc, rawCastingDayCalc } from "../../../../../client/src/utils/rawCastingSheet.js";
import { mfdRowCalc, mfdDayCalc } from "../../../../../client/src/utils/mfdSheet.js";
import { mfaRowCalc, mfaDayCalc } from "../../../../../client/src/utils/mfaSheet.js";
import { embossingRowCalc, embossingDayCalc } from "../../../../../client/src/utils/embossingSheet.js";
import { faRowCalc, faDayCalc } from "../../../../../client/src/utils/finalAssemblySheet.js";

const OUT_DIR = process.env.OUT_DIR || "test/production/oee_review/fixtures";
const SCALE = Number(process.env.SCALE || 1);
let seed = Number(process.env.SEED || 20261027) >>> 0;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (xs) => xs[int(0, xs.length - 1)];

// key (Dart ProcessSpec.key) -> sheet functions + which OEE figures its table has.
const SHEETS = {
  cnc: [rowCalc, dayCalc, "machine"],
  vmc: [vmcRowCalc, vmcDayCalc, "machine"],
  spm: [spmRowCalc, spmDayCalc, "machine"],
  rivet: [rivetRowCalc, rivetDayCalc, "machine"],
  press: [pressRowCalc, pressDayCalc, "machine"],
  contact: [contactRowCalc, contactDayCalc, "machine"],
  trobe: [trobeRowCalc, trobeDayCalc, "machine"],
  spring: [springRowCalc, springDayCalc, "machine"],
  "powder-coating": [powderRowCalc, powderDayCalc, "worker"],
  rubber: [rubberRowCalc, rubberDayCalc, "worker"],
  printing: [printingRowCalc, printingDayCalc, "machine"],
  injection: [injectionRowCalc, injectionDayCalc, "machine"],
  bpc: [bpcRowCalc, bpcDayCalc, "bpc"],
  "raw-casting": [rawCastingRowCalc, rawCastingDayCalc, "worker"],
  mfd: [mfdRowCalc, mfdDayCalc, "machine"],
  mfa: [mfaRowCalc, mfaDayCalc, "worker"],
  embossing: [embossingRowCalc, embossingDayCalc, "machine"],
  "final-assembly": [faRowCalc, faDayCalc, "worker"],
};

const TIMES = [["06:00", "10:00"], ["10:30", "14:30"], ["13:00", "17:00"], ["08:00", "12:00"], ["14:00", "20:00"], ["21:00", "05:00"]];
let idn = 0;
// One entry with the superset of the fields the sheets read (a sheet ignores the rest).
const entry = (machine, date, o = {}) => {
  const [on, off] = pick(TIMES);
  const qty = int(0, 420);
  return {
    _id: `r${++idn}`,
    machine,
    date,
    itemName: "Part",
    workingMode: "Working",
    workingStatus: "PRESENT",
    machineOnTime: on,
    machineOffTime: off,
    totalCycleSec: pick([30, 45, 60, 90]),
    standardTimeMin: pick([1, 2]),
    pcsPerStandardTime: pick([1, 2, 4]),
    programTimeMin: pick([1, 2]),
    pcsPerProgram: pick([1, 2, 4]),
    plannedOperatorShiftHours: pick([4, 6, 8, 8, 10]),
    plannedLocked: rnd() < 0.15,
    actualQty: qty,
    okQty: Math.max(0, qty - int(0, 15)),
    rejectedQty: int(0, 15),
    lunchMin: pick([0, 0, 15, 30]),
    ...o,
  };
};
// Entries as the server returns them: numbers where the form types strings.
const typed = (e) => ({ ...e, plannedOperatorShiftHours: pick([String(e.plannedOperatorShiftHours), String(e.plannedOperatorShiftHours)]) });

const cases = {};
let withOver = {};
for (const [key, [rowFn, dayFn, kind]] of Object.entries(SHEETS)) {
  const list = [];
  withOver[key] = 0;
  for (let i = 0; i < 90 * SCALE; i += 1) {
    const machine = `m${int(1, 2)}`;
    const date = "2026-10-20";
    const saved = Array.from({ length: int(0, 3) }, () => entry(machine, date));
    // rows of another machine / another date must never join the group
    if (rnd() < 0.5) saved.push(entry("other", date), entry(machine, "2026-10-19"));
    let values = entry(machine, date);
    if (saved.length && rnd() < 0.3) {
      // editing: the entry's own saved copy is replaced by what is typed
      const own = saved.find((r) => r.machine === machine && r.date === date);
      if (own) values = { ...values, _id: own._id };
    }
    values = typed(values);
    const sameDay = saved.filter((r) => String(r.machine) === String(values.machine) && r.date === values.date);
    const dec = withDecimalPlanned(values);
    const day = dayFiguresFor(dayFn, dec, sameDay);
    const over = metricsOver100(withDayFigures(rowFn(dec), day, kind));
    if (over.length) withOver[key] += 1;
    list.push({ values, saved, over, day: day ? Object.fromEntries(["oeeLosses", "oeeLunch", "oeeLunchCot", "productivity", "productivityLunch"].map((k) => [k, day[k] ?? null])) : null });
  }
  cases[key] = { kind, cases: list };
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "oee_over.json"), JSON.stringify({ labels: OEE_METRIC_LABELS, figureKeys: OEE_FIGURE_KEYS, sheets: cases }));
console.log("cases with a figure over 100% per process:", withOver);
