"use strict";
/**
 * seed/seedProcesses.js
 * ────────────────────────────
 * The Indo process list, as laid out on the dashboard landing page:
 *
 *   SPM · PRESS · RIVET · VMC · CNC · CONTACT · TROBE · SPRING FOR PINS · AFTER POWDER COATING · RUBBER
 *   · BEFORE POWDER COATING · RAW CASTING · MODULAR FRAME DRILLING · … · FINAL ASSEMBLY (last)
 *
 * Safe to re-run: a process that already exists (by name) is left exactly as
 * it is — its machines and chosen visuals are never overwritten. The
 * existing machines and parts come from the "Section Wise Eff. — CNC" sheet,
 * so any machine or part that isn't in a process yet is put under CNC; move
 * machines in Production › Processes, and parts in Production › Items, if
 * that's wrong.
 *
 *   node seed/seedProcesses.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Process = require("../models/Process");
const Machine = require("../models/Machine");
const Item = require("../models/Item");

const PROCESSES = [
  { processName: "SPM" },
  { processName: "PRESS" },
  { processName: "RIVET" },
  { processName: "VMC" },
  { processName: "CNC" },
  { processName: "CONTACT" },
  { processName: "TROBE" },
  { processName: "SPRING FOR PINS" },
  { processName: "AFTER POWDER COATING" },
  { processName: "RUBBER" },
  // Kept per operator — see seed/seedPrintingProcess.js for its page link,
  // tiles and graphs.
  { processName: "PRINTING" },
  // A machine process — see seed/seedInjectionProcess.js for its page link,
  // tiles and graphs.
  { processName: "INJECTION MOULDING" },
  // A different process from AFTER POWDER COATING — see seed/seedBpcProcess.js
  // for its page link, tiles and graphs.
  { processName: "BEFORE POWDER COATING" },
  // A worker inspection sheet on AFTER POWDER COATING's template — see
  // seed/seedRawCastingProcess.js for its page link, tiles and graphs.
  { processName: "RAW CASTING" },
  // A machine process — see seed/seedMfdProcess.js for its page link, tiles
  // and graphs.
  { processName: "MODULAR FRAME DRILLING" },
  // MODULAR FRAME ASSEMBLY, after MODULAR FRAME DRILLING — per worker, on RAW
  // CASTING's template; see seed/seedMfaProcess.js for its page link, tiles and graphs.
  { processName: "MODULAR FRAME ASSEMBLY" },
  // EMBOSSING, after MODULAR FRAME DRILLING — a machine process; see
  // seed/seedEmbossingProcess.js for its page link, tiles and graphs.
  { processName: "EMBOSSING" },
  // FINAL ASSEMBLY, last (after EMBOSSING) — per worker; see
  // seed/seedFinalAssemblyProcess.js for its page link, tiles and graphs.
  { processName: "FINAL ASSEMBLY" },
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
  // Parts too, so the CNC data entry page keeps offering every part it always
  // has once parts are told apart by process.
  const movedItems = cnc ? await Item.updateMany({ process: null }, { $set: { process: cnc._id } }) : { modifiedCount: 0 };

  console.log(
    `Processes: ${created} created, ${PROCESSES.length - created} already existed. Machines put under CNC: ${moved.modifiedCount}. Parts put under CNC: ${movedItems.modifiedCount}.`,
  );
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
