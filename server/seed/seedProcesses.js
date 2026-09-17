"use strict";
/**
 * seed/seedProcesses.js
 * ────────────────────────────
 * The Indo process list, as laid out on the dashboard landing page:
 *
 *   Hood/Housing   SPM · PRESS · Rivet · VMC · CNC
 *   Plug Pin       TRAUB M/C · Second Operation (Drilling)
 *
 * Safe to re-run: a process that already exists (by name) is left exactly as
 * it is — its group, machines and chosen visuals are never overwritten. The
 * existing machines come from the "Section Wise Eff. — CNC" sheet, so any
 * machine that isn't in a process yet is put under CNC; move them in
 * Production › Processes if that's wrong.
 *
 *   node seed/seedProcesses.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Process = require("../models/Process");
const Machine = require("../models/Machine");

const PROCESSES = [
  { processName: "SPM", group: "Hood/Housing" },
  { processName: "PRESS", group: "Hood/Housing" },
  { processName: "Rivet", group: "Hood/Housing" },
  { processName: "VMC", group: "Hood/Housing" },
  { processName: "CNC", group: "Hood/Housing" },
  { processName: "TRAUB M/C", group: "Plug Pin" },
  { processName: "Second Operation (Drilling)", group: "Plug Pin" },
];

async function run() {
  await connectDB();

  // Created one at a time, in chart order: processes have no sequence field —
  // they are listed in the order they were created.
  let created = 0;
  for (const def of PROCESSES) {
    const exists = await Process.exists({ processName: def.processName });
    if (exists) continue;
    await Process.create(def);
    created += 1;
  }

  const cnc = await Process.findOne({ processName: "CNC" });
  const moved = cnc ? await Machine.updateMany({ process: null }, { $set: { process: cnc._id } }) : { modifiedCount: 0 };

  console.log(`Processes: ${created} created, ${PROCESSES.length - created} already existed. Machines put under CNC: ${moved.modifiedCount}.`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
