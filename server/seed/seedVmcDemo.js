"use strict";
/**
 * seed/seedVmcDemo.js
 * ─────────────────────
 * Demo data for the VMC Data Entry page: a few VMC parts and four days of entries
 * on VMC machines, and the VMC process linked to that page so its Machine and Part
 * pickers offer only VMC machines and VMC parts.
 *
 * It works with what is already there rather than adding to it:
 *   - machines: the machines already in the VMC process (the process is created if
 *     missing). Only when that has none are VMC-1…VMC-4 added, so a database that
 *     already has its real VMC machines gets no made-up ones;
 *   - operators: the shop-floor operators already in Operator Master (the demo's
 *     Ramesh, Suresh… are added only when there are none).
 *
 * Every figure satisfies the form's own rules — OK + Rejected within Ideal Quantity,
 * stoppage within Planned Operator Shift − Machine Shift, no overlapping times — so
 * each row can be opened and re-saved untouched.
 *
 * Safe to re-run and easy to undo, and it only ever touches its own rows: the demo
 * entries are the ones on the dates below made on one of the demo parts (named
 * below), so entries anyone types are never replaced or removed.
 *   node seed/seedVmcDemo.js          seed (replaces its own previous rows)
 *   node seed/seedVmcDemo.js --undo   remove everything it created
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Process = require("../models/Process");
const Machine = require("../models/Machine");
const Item = require("../models/Item");
const MachineOperator = require("../models/MachineOperator");
const VmcEntry = require("../models/VmcEntry");

const PAGE_URL = "/hqepl/production/vmc-data-entry";
const PAGE_LABEL = "VMC Data Entry";
// Added only when the VMC process has no machines of its own.
const FALLBACK_MACHINES = ["VMC-1", "VMC-2", "VMC-3", "VMC-4"];
const FALLBACK_OPERATORS = ["Ramesh", "Suresh", "Mahesh", "Dinesh"];

// The days this script owns, oldest first — all before the VMC page existed.
const DATES = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"];

// programTimeMin ÷ pcsPerProgram is the part's Product Cycle Time:
//   A 6 min / 2 pcs = 180 s · B 4 / 4 = 60 s · C 10 / 1 = 600 s · D 5 / 2 = 150 s
const PARTS = {
  A: { itemName: "Bracket VB-10", drawingNo: "DRG-V101", setupNo: "S-21", programTimeMin: 6, pcsPerProgram: 2 },
  B: { itemName: "Flange VF-24", drawingNo: "DRG-V224", setupNo: "S-22", programTimeMin: 4, pcsPerProgram: 4 },
  C: { itemName: "Housing VH-08", drawingNo: "DRG-V308", setupNo: "S-23", programTimeMin: 10, pcsPerProgram: 1 },
  D: { itemName: "Plate VP-16", drawingNo: "DRG-V416", setupNo: "S-24", programTimeMin: 5, pcsPerProgram: 2 },
};
const PART_NAMES = Object.values(PARTS).map((p) => p.itemName);

// `ago` = days before the newest date (1 = the last of DATES); `machine` and `op`
// are positions in the VMC machine / operator lists (they wrap if there are fewer).
// A 09:00–17:30 run is 510 min, so with 9.5 h planned there are 60 min of stoppage
// to account for; Ideal Quantity there is A 170 · B 510 · C 51 · D 204.
const FIRST = { machineOnTime: "09:00", machineOffTime: "17:30", plannedOperatorShiftHours: 9.5 };
const ENTRIES = [
  // ── newest day: four machines ──
  { ago: 1, machine: 0, op: 0, part: "A", ...FIRST,
    okQty: 160, rejectedQty: 4, setupMin: 20, lunchMin: 30, noMaterialMin: 10, remarks: "Smooth run" },
  { ago: 1, machine: 1, op: 1, part: "B", ...FIRST,
    okQty: 480, rejectedQty: 12, lunchMin: 30, bdMechMin: 25 },
  { ago: 1, machine: 2, op: 2, part: "C", ...FIRST,
    okQty: 47, rejectedQty: 2, setupMin: 30, lunchMin: 30 },
  { ago: 1, machine: 3, op: 3, part: "D", ...FIRST,
    okQty: 190, rejectedQty: 6, lunchMin: 30, noManPowerMin: 15, otherMin: 10, otherMinRemark: "Coolant top-up", remarks: "Waited for fixture" },

  // ── the day before: machine 2 also runs an evening shift with another operator ──
  { ago: 2, machine: 0, op: 0, part: "A", ...FIRST,
    okQty: 163, rejectedQty: 3, lunchMin: 30, materialShiftingMin: 20 },
  { ago: 2, machine: 1, op: 1, part: "B", ...FIRST,
    okQty: 495, rejectedQty: 8, lunchMin: 30, noPowerMin: 20 },
  { ago: 2, machine: 1, op: 3, part: "B", machineOnTime: "18:00", machineOffTime: "22:00", plannedOperatorShiftHours: 4.5,
    okQty: 228, rejectedQty: 4, lunchMin: 15, setupMin: 10, remarks: "Overtime shift" },
  { ago: 2, machine: 3, op: 3, part: "D", ...FIRST,
    okQty: 196, rejectedQty: 5, setupMin: 15, lunchMin: 30, bdEleMin: 15 },

  // ── earlier ──
  { ago: 3, machine: 0, op: 0, part: "A", ...FIRST,
    okQty: 158, rejectedQty: 6, lunchMin: 30, plannedDownMin: 20 },
  { ago: 3, machine: 2, op: 2, part: "C", ...FIRST,
    okQty: 49, rejectedQty: 1, lunchMin: 30, noMaterialMin: 25 },
  { ago: 4, machine: 1, op: 1, part: "B", ...FIRST,
    okQty: 470, rejectedQty: 15, lunchMin: 30, setupMin: 20 },
  { ago: 4, machine: 3, op: 3, part: "D", ...FIRST,
    okQty: 185, rejectedQty: 7, lunchMin: 30, bdMechMin: 30 },
];

const utcDay = (s) => new Date(`${s}T00:00:00.000Z`);
const dateOf = (ago) => DATES[DATES.length - ago];

// The rows this script owns: its dates, on one of its demo parts.
const ownRows = () => ({ date: { $in: DATES.map(utcDay) }, itemName: { $in: PART_NAMES } });

async function undo() {
  const entries = await VmcEntry.deleteMany(ownRows());
  const items = await Item.deleteMany({ itemName: { $in: PART_NAMES } });
  // Only the machines it added itself, and only while nothing else points at them.
  let machines = 0;
  for (const m of await Machine.find({ machineName: { $in: FALLBACK_MACHINES } }).select("_id").lean()) {
    if (!(await VmcEntry.exists({ machine: m._id }))) machines += (await Machine.deleteOne({ _id: m._id })).deletedCount;
  }
  console.log(`Removed ${entries.deletedCount} entries, ${items.deletedCount} parts, ${machines} added machines.`);
  console.log(`The VMC process, its link to ${PAGE_LABEL} and the operator names were left in place.`);
}

async function seed() {
  // The VMC process, linked to this page so the pickers scope to it.
  let vmcProcess = await Process.findOne({ processName: "VMC" });
  if (!vmcProcess) vmcProcess = await Process.create({ processName: "VMC" });
  await Process.updateOne({ _id: vmcProcess._id }, { $set: { dataEntryMenu: PAGE_URL, dataEntryMenuLabel: PAGE_LABEL } });

  // Its own machines, in sheet order; made-up ones only if it has none.
  let machines = (await Machine.find({ process: vmcProcess._id, isActive: true, isDeleted: { $ne: true } }).lean()).sort(
    (a, b) => (a.sequence || Infinity) - (b.sequence || Infinity) || a.machineName.localeCompare(b.machineName, undefined, { numeric: true }),
  );
  let addedMachines = 0;
  if (!machines.length) {
    for (const machineName of FALLBACK_MACHINES) {
      const doc = await Machine.findOneAndUpdate(
        { machineName },
        { $set: { process: vmcProcess._id, isActive: true, isDeleted: false }, $setOnInsert: { sequence: 0 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      machines.push(doc);
      addedMachines += 1;
    }
  }

  // The operators already in Operator Master; made-up ones only if there are none.
  let operators = (await MachineOperator.find({ isActive: true }).sort({ name: 1 }).lean()).map((o) => o.name);
  if (!operators.length) {
    for (const name of FALLBACK_OPERATORS) await MachineOperator.create({ name });
    operators = FALLBACK_OPERATORS;
  }

  // VMC parts: in the VMC process, with a program instead of operation times.
  const itemByKey = {};
  for (const [key, p] of Object.entries(PARTS)) {
    itemByKey[key] = await Item.findOneAndUpdate(
      { itemName: p.itemName },
      {
        itemName: p.itemName,
        drawingNo: p.drawingNo,
        setupNo: p.setupNo,
        process: vmcProcess._id,
        programTimeMin: p.programTimeMin,
        pcsPerProgram: p.pcsPerProgram,
        totalCycleSec: (p.programTimeMin * 60) / p.pcsPerProgram,
        isActive: true,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Replace this script's own previous rows only.
  const cleared = await VmcEntry.deleteMany(ownRows());

  // One slot per (day, machine) in the order listed. A slot someone else already
  // holds is skipped, never overwritten.
  const slotUsed = {};
  let inserted = 0;
  let skipped = 0;
  for (const { ago, machine, op, part, ...rest } of ENTRIES) {
    const m = machines[machine % machines.length];
    const key = `${ago}|${m._id}`;
    slotUsed[key] = (slotUsed[key] || 0) + 1;
    const p = PARTS[part];
    try {
      await VmcEntry.create({
        ...rest,
        date: utcDay(dateOf(ago)),
        machine: m._id,
        slot: slotUsed[key],
        operator: operators[op % operators.length],
        item: itemByKey[part]._id,
        itemName: p.itemName,
        drawingNo: p.drawingNo,
        setupNo: p.setupNo,
        programTimeMin: p.programTimeMin,
        pcsPerProgram: p.pcsPerProgram,
      });
      inserted += 1;
    } catch (err) {
      if (err.code !== 11000) throw err;
      skipped += 1;
    }
  }

  console.log(`Cleared ${cleared.deletedCount} old demo entries.`);
  console.log(
    `Seeded ${Object.keys(PARTS).length} VMC parts and ${inserted} entries on ${DATES[0]} … ${DATES[DATES.length - 1]}` +
      `${skipped ? ` (${skipped} skipped — slot already in use)` : ""}.`,
  );
  console.log(`Machines used: ${machines.map((m) => m.machineName).join(", ")}${addedMachines ? " (added — the VMC process had none)" : ""}.`);
  console.log(`VMC process linked to ${PAGE_URL}.`);
}

// Required (not run) by controllers/vmcSheet.demoSeed.test.js, which checks every row against the entry rules.
module.exports = { ENTRIES, PARTS, DATES, dateOf };

if (require.main === module) {
  (async () => {
    await connectDB();
    if (process.argv.includes("--undo")) await undo();
    else await seed();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((err) => {
    console.error("VMC demo seed failed:", err.message);
    process.exit(1);
  });
}
