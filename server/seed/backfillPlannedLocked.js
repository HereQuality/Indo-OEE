"use strict";
/**
 * seed/backfillPlannedLocked.js
 * ───────────────────────────────
 * One-time fill for `plannedLocked` (models/entryCommon.js) on entries saved
 * before it existed. A locked Planned Operator Shift now counts once per
 * machine per day (client/src/utils/productionSheet.js dayCalc), but only on
 * entries that say it came from the lock — older ones carry no mark, so a day
 * of several of them still counts 12 h each until they're marked.
 *
 * An entry is taken as locked when its Planned equals its process's lock
 * hours (12 unless changed in Process Master) — the same rule a save applies
 * to an older entry (utils/plannedShift.js). Anything else is typed. Entries
 * already marked, or with no Planned, are left alone.
 *
 *   node seed/backfillPlannedLocked.js           # dry run: counts only, writes nothing
 *   node seed/backfillPlannedLocked.js --write   # marks them
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Process = require("../models/Process");
const Machine = require("../models/Machine");
const { lockedHours } = require("../utils/plannedShift");

const SHEETS = [
  ["CNC", require("../models/ProductionEntry"), "machine"],
  ["VMC", require("../models/VmcEntry"), "machine"],
  ["SPM", require("../models/SpmEntry"), "machine"],
  ["RIVET", require("../models/RivetEntry"), "machine"],
  ["PRESS", require("../models/PressEntry"), "machine"],
  ["CONTACT", require("../models/ContactEntry"), "machine"],
  ["TROBE", require("../models/TrobeEntry"), "machine"],
  ["SPRING FOR PINS", require("../models/SpringEntry"), "machine"],
  ["AFTER POWDER COATING", require("../models/PowderCoatingEntry"), "process"],
  ["RUBBER", require("../models/RubberEntry"), "process"],
];

async function run() {
  const write = process.argv.includes("--write");
  await connectDB();

  const processes = await Process.find().select("plannedShiftHours").lean();
  const lockOf = new Map(processes.map((p) => [String(p._id), lockedHours(p)]));
  const machines = await Machine.find().select("process").lean();
  const processOfMachine = new Map(machines.map((m) => [String(m._id), m.process ? String(m.process) : null]));

  console.log(write ? "Marking entries…" : "Dry run — nothing is written. Add --write to mark them.");
  for (const [label, Model, by] of SHEETS) {
    const entries = await Model.find({ plannedLocked: { $exists: false }, plannedOperatorShiftHours: { $type: "number" } })
      .select(`${by} plannedOperatorShiftHours`)
      .lean();
    const locked = [];
    const typed = [];
    for (const e of entries) {
      const processId = by === "machine" ? processOfMachine.get(String(e.machine)) : e.process ? String(e.process) : null;
      const lock = processId ? lockOf.get(processId) : undefined;
      (lock !== undefined && Number(e.plannedOperatorShiftHours) === lock ? locked : typed).push(e._id);
    }
    console.log(`${label.padEnd(22)} ${String(entries.length).padStart(5)} unmarked → ${locked.length} locked, ${typed.length} typed`);
    if (write && entries.length) {
      if (locked.length) await Model.updateMany({ _id: { $in: locked } }, { $set: { plannedLocked: true } });
      if (typed.length) await Model.updateMany({ _id: { $in: typed } }, { $set: { plannedLocked: false } });
    }
  }
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
