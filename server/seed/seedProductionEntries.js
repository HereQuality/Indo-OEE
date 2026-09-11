"use strict";
/**
 * seed/seedProductionEntries.js
 *
 * Dev/demo seeder for the Dashboard's OEE data — uses the REAL machines
 * and operators already set up in Machine Master / Operator Master (does
 * not invent synthetic ones; an earlier version of this script did, which
 * polluted the DB with duplicate/orphaned Machine records once those
 * synthetic machines were deleted).
 *
 * What it does, in order:
 *   1. Upserts the real "General Shift" (09:00–18:00) by name — never
 *      deleted/recreated, so its _id (and any entries referencing it)
 *      stays stable across re-runs.
 *   2. Picks 2-3 realistic size/thickness/time combos per active Grinding
 *      machine from STANDARD_TIME_TEMPLATES below (sane sizes/thicknesses/
 *      times — Grinding Data Entry's own Standard Time Master is gone, so
 *      these are no longer persisted as their own records; they're used
 *      in-memory purely to build realistic ProductionEntry rows).
 *   3. Wipes ALL ProductionEntry records and inserts exactly ONE entry
 *      per active Grinding machine per day, for the last 14 days
 *      (including today) — so the Dashboard's Daily OEE Trend has a
 *      clean, realistic multi-day history instead of a jumble of
 *      multiple/duplicate same-day entries. M/C Start/Off Time is jittered
 *      around the shift's own schedule so Overtime/Start Delay/Early
 *      Closed (all derived, never manual) show a realistic mix.
 *
 * SAFETY GUARD: this script wipes ALL ProductionEntry records before
 * regenerating them. That is only safe on a fresh/dev database with no
 * real entries yet. Before touching anything, `run()` checks for any
 * ProductionEntry that ISN'T tagged with SEED_TAG (i.e. a real,
 * client-entered row) and ABORTS immediately if it finds one — refusing
 * to run rather than silently deleting real production data. Pass
 * --force to bypass this check (only ever do that on a database you know
 * is safe to wipe, e.g. a scratch/dev environment).
 *
 * Usage: node server/seed/seedProductionEntries.js [--force]
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const Machine = require("../models/Machine");
const MachineOperator = require("../models/MachineOperator");
const Process = require("../models/Process");
const Shift = require("../models/Shift");
const ProductionEntry = require("../models/ProductionEntry");
const { computeCalculations } = require("../services/productionCalculation.service");

const SEED_TAG = "[seed-data]";
const DAYS_BACK = 13; // + today = 14 days total

// Deterministic PRNG so re-runs produce the same numbers (no faker dep in this repo).
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260811);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (min, max) => Math.floor(min + rand() * (max - min + 1));

// 2-3 realistic size/thickness/time combos per machine — real industrial
// glass panel sizes (mm) and sane grinding times (minutes/piece), not the
// placeholder 5x5 / 0.12min / 2222min style test values that were here
// before. Used purely in-memory to build each demo ProductionEntry.
const STANDARD_TIME_TEMPLATES = [
  [
    { sizeWidthMm: 100, sizeHeightMm: 200, thicknessMm: 2, standardTimeMin: 2.5 },
    { sizeWidthMm: 150, sizeHeightMm: 250, thicknessMm: 4, standardTimeMin: 3.5 },
    { sizeWidthMm: 200, sizeHeightMm: 300, thicknessMm: 5, standardTimeMin: 4.5 },
  ],
  [
    { sizeWidthMm: 100, sizeHeightMm: 200, thicknessMm: 2, standardTimeMin: 2.2 },
    { sizeWidthMm: 120, sizeHeightMm: 180, thicknessMm: 4, standardTimeMin: 2.8 },
    { sizeWidthMm: 150, sizeHeightMm: 250, thicknessMm: 5, standardTimeMin: 3.6 },
  ],
  [
    { sizeWidthMm: 100, sizeHeightMm: 200, thicknessMm: 2, standardTimeMin: 2.4 },
    { sizeWidthMm: 150, sizeHeightMm: 250, thicknessMm: 4, standardTimeMin: 3.3 },
    { sizeWidthMm: 200, sizeHeightMm: 300, thicknessMm: 6, standardTimeMin: 4.8 },
  ],
  [
    { sizeWidthMm: 120, sizeHeightMm: 180, thicknessMm: 2, standardTimeMin: 2.1 },
    { sizeWidthMm: 150, sizeHeightMm: 250, thicknessMm: 5, standardTimeMin: 3.7 },
    { sizeWidthMm: 200, sizeHeightMm: 300, thicknessMm: 8, standardTimeMin: 5.2 },
  ],
  [
    { sizeWidthMm: 100, sizeHeightMm: 200, thicknessMm: 4, standardTimeMin: 3.0 },
    { sizeWidthMm: 150, sizeHeightMm: 250, thicknessMm: 6, standardTimeMin: 4.0 },
    { sizeWidthMm: 200, sizeHeightMm: 300, thicknessMm: 8, standardTimeMin: 5.5 },
  ],
];

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

// Real Indo shift — upserted (never deleted/recreated) so its _id
// stays stable across re-runs, same as seedMenus.js's approach for menus.
async function seedShift() {
  return Shift.findOneAndUpdate(
    { shiftName: "General Shift" },
    { shiftName: "General Shift", shiftOnTime: "09:00", shiftOffTime: "18:00", isActive: true },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

// Jitters an "HH:mm" time by a random offset (minutes, may be negative),
// wrapping around midnight — used to give M/C Start/Off Time realistic
// variance around the shift's own On/Off Time, so the Shift Time Report
// actually shows a mix of on-time / delayed-start / early-close / overtime
// entries instead of every row being identical to the shift schedule.
function jitterTime(base, minDelta, maxDelta) {
  const [h, m] = base.split(":").map(Number);
  let total = ((h * 60 + m + int(minDelta, maxDelta)) % 1440 + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

async function seedProductionEntries(machines, operators, shift) {
  await ProductionEntry.deleteMany({});

  const templatesByMachine = new Map();
  machines.forEach((machine, i) => {
    templatesByMachine.set(String(machine._id), STANDARD_TIME_TEMPLATES[i % STANDARD_TIME_TEMPLATES.length]);
  });

  const docs = [];
  for (let dayOffset = DAYS_BACK; dayOffset >= 0; dayOffset--) {
    const dateStr = dateNDaysAgo(dayOffset);

    for (const machine of machines) {
      const templates = templatesByMachine.get(String(machine._id));
      if (!templates || templates.length === 0) continue;

      const st = pick(templates);
      const operator = pick(operators);

      const plannedDowntimeMin = int(0, 30);
      const noManpowerMin = int(0, 15);
      const mechanicalBreakdownMin = int(0, 20);
      const electricalBreakdownMin = int(0, 10);
      const rawMaterialNotAvailableMin = int(0, 15);
      const humanErrorStoppageMin = int(0, 10);
      const changeoverMin = int(0, 20);
      const rawMaterialProblemMin = int(0, 10);
      const noPowerMin = int(0, 5);
      const othersMin = 0;

      // M/C Start/Off Time varies around the shift's own schedule — most
      // days close to on-time, some days early-start/late-finish
      // (overtime), some days late-start/early-close (delay/early closed) —
      // so the Shift Time Report has a realistic mix to show, not identical
      // rows. Overtime/Start Delay/Early Closed are NOT set manually here;
      // they're derived below by computeCalculations, exactly as the real
      // app derives them from `shift` vs. mcStartTime/mcOffTime.
      const mcStartTime = jitterTime(shift.shiftOnTime, -15, 20);
      const mcOffTime = jitterTime(shift.shiftOffTime, -20, 15);

      const entry = {
        date: new Date(dateStr),
        mcStartTime,
        mcOffTime,
        machine: machine._id,
        operator: operator._id,
        shift: shift._id,
        sizeWidthMm: st.sizeWidthMm,
        sizeHeightMm: st.sizeHeightMm,
        thicknessMm: st.thicknessMm,
        standardTimePerPieceMin: st.standardTimeMin,
        plannedDowntimeMin,
        noManpowerMin,
        mechanicalBreakdownMin,
        electricalBreakdownMin,
        rawMaterialNotAvailableMin,
        humanErrorStoppageMin,
        changeoverMin,
        rawMaterialProblemMin,
        noPowerMin,
        othersMin,
        othersRemark: SEED_TAG,
      };

      // computeCalculations reads shiftOnTime/shiftOffTime off the entry
      // object (not `shift`, which is just the stored ref) — same contract
      // as productionEntry.controller.js's applyShiftCalculations.
      const calcInput = { ...entry, shiftOnTime: shift.shiftOnTime, shiftOffTime: shift.shiftOffTime };
      const calculated = computeCalculations(calcInput);
      // Keep Production Qty comfortably inside what the shift can actually
      // produce (Ideal Production), same as the real form's own capacity
      // check would require — a realistic 75-95% of ideal, not more.
      const idealQty = calculated.idealProductionQty || 0;
      const processQty = Math.max(1, Math.round(idealQty * (0.75 + rand() * 0.2)));
      const okQty = Math.max(0, Math.round(processQty * (0.85 + rand() * 0.13)));
      const rejectedQty = Math.max(0, processQty - okQty);

      entry.processQty = processQty;
      entry.okQty = okQty;
      entry.rejectedQty = rejectedQty;
      entry.calculated = computeCalculations({ ...entry, shiftOnTime: shift.shiftOnTime, shiftOffTime: shift.shiftOffTime });
      entry.overtimeMin = entry.calculated.overtimeMin;

      docs.push(entry);
    }
  }

  await ProductionEntry.insertMany(docs);
  console.log(`Seeded ${docs.length} production entries (${machines.length} machines × ${DAYS_BACK + 1} days, one entry per machine per day, tied to "${shift.shiftName}").`);
}

async function run() {
  await connectDB();

  const force = process.argv.includes("--force");
  const realEntryCount = await ProductionEntry.countDocuments({ othersRemark: { $ne: SEED_TAG } });
  if (realEntryCount > 0 && !force) {
    console.error(
      `ABORTING: found ${realEntryCount} real (non-seed-tagged) ProductionEntry record(s) — ` +
      `this script wipes ALL entries and would destroy them. Re-run with --force only if you ` +
      `are certain this database is safe to wipe.`,
    );
    await mongoose.connection.close();
    process.exit(1);
  }

  const grinding = await Process.findOne({ processName: "Grinding" });
  if (!grinding) {
    throw new Error('No "Grinding" process found — seed/seedMenus.js or the DB\'s existing Process data must define one first.');
  }

  const machines = await Machine.find({ isActive: true, processes: grinding._id }).sort({ machineCode: 1 }).lean();
  if (machines.length === 0) {
    throw new Error("No active Grinding machines found — nothing to seed against.");
  }

  const operators = await MachineOperator.find({ isActive: true }).lean();
  if (operators.length === 0) {
    throw new Error("No active operators found — nothing to assign entries to.");
  }

  console.log(`Using ${machines.length} real active Grinding machines and ${operators.length} real active operators.`);

  const shift = await seedShift();
  console.log(`Using shift "${shift.shiftName}" (${shift.shiftOnTime}–${shift.shiftOffTime}).`);

  await seedProductionEntries(machines, operators, shift);

  console.log("Done.");
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
