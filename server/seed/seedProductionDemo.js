"use strict";
/**
 * seed/seedProductionDemo.js
 * ────────────────────────────
 * Demo data for the Production Data Entry page and its Dashboard: a handful
 * of items and three days of entries across five machines, shaped so every
 * part of the dashboard has something to show — OEE that differs per machine,
 * an OK/Rejected split per day, downtime spread over several causes, and
 * rejections spread over several Rejection Master reasons.
 *
 * This is throwaway demo data, so it is safe to re-run and easy to undo:
 *   node seed/seedProductionDemo.js          seed (clears its own dates first)
 *   node seed/seedProductionDemo.js --undo   remove everything it created
 *
 * It only ever touches the three dates below and the items it created, so
 * real entries on other dates are never affected.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Machine = require("../models/Machine");
const Item = require("../models/Item");
const ProductionEntry = require("../models/ProductionEntry");

// The three days this script owns.
const DAY_1 = "2026-09-10";
const DAY_2 = "2026-09-11";
const DAY_3 = "2026-09-12";
const DATES = [DAY_1, DAY_2, DAY_3];

const ITEMS = [
  { itemName: "Terminal Block TB-40", drawingNo: "DRG-1042", setupNo: "S-11", cycleOpsSec: [120] },
  { itemName: "Contact Pin CP-12", drawingNo: "DRG-2218", setupNo: "S-04", cycleOpsSec: [90] },
  { itemName: "Housing Cover HC-88", drawingNo: "DRG-3307", setupNo: "S-19", cycleOpsSec: [150] },
  { itemName: "Bus Bar Link BL-25", drawingNo: "DRG-4415", setupNo: "S-07", cycleOpsSec: [200] },
];

// One row per entry. `rejectReason` is required wherever actual > ok, the same
// rule the form enforces. Numbers were chosen so Unreported Time stays positive
// and OEE lands in a believable 80–97% band.
const ENTRIES = [
  // ── Day 1: five machines on one day — the busy day the dashboard leans on ──
  { date: DAY_1, machine: "7A", slot: 1, operator: "Ramesh", item: "Terminal Block TB-40",
    machineOnTime: "09:00", machineOffTime: "17:30", actualQty: 198, okQty: 190, rejectReason: "Dimension Out",
    plannedOperatorShiftHours: 8.5, setupMin: 30, lunchMin: 40, noMaterialMin: 15, remarks: "Smooth run" },

  { date: DAY_1, machine: "7B", slot: 1, operator: "Suresh", item: "Contact Pin CP-12",
    machineOnTime: "09:00", machineOffTime: "17:30", actualQty: 266, okQty: 247, rejectReason: "Tool Mark",
    plannedOperatorShiftHours: 8.5, setupMin: 25, lunchMin: 40, bdMechMin: 35, remarks: "Tool changed mid-shift" },

  { date: DAY_1, machine: "7C", slot: 1, operator: "Mahesh", item: "Housing Cover HC-88",
    machineOnTime: "09:00", machineOffTime: "17:30", actualQty: 150, okQty: 144, rejectReason: "Surface Finish",
    plannedOperatorShiftHours: 8.5, setupMin: 45, lunchMin: 40, materialShiftingMin: 20 },

  { date: DAY_1, machine: "7D", slot: 1, operator: "Dinesh", item: "Bus Bar Link BL-25",
    machineOnTime: "09:00", machineOffTime: "17:30", actualQty: 118, okQty: 110, rejectReason: "Material Defect",
    plannedOperatorShiftHours: 8.5, setupMin: 35, lunchMin: 40, noPowerMin: 25, remarks: "Power cut 09:40–10:05" },

  { date: DAY_1, machine: "7E", slot: 1, operator: "Rakesh", item: "Terminal Block TB-40",
    machineOnTime: "09:00", machineOffTime: "17:30", actualQty: 188, okQty: 182, rejectReason: "Setting Mistake",
    plannedOperatorShiftHours: 8.5, setupMin: 40, lunchMin: 40, noManPowerMin: 20 },

  // ── Day 2: two machines, and 7B runs a second shift ──
  { date: DAY_2, machine: "7A", slot: 1, operator: "Ramesh", item: "Terminal Block TB-40",
    machineOnTime: "09:00", machineOffTime: "17:30", actualQty: 199, okQty: 195, rejectReason: "Dimension Out",
    plannedOperatorShiftHours: 8.5, setupMin: 20, lunchMin: 40, bdEleMin: 18 },

  { date: DAY_2, machine: "7B", slot: 1, operator: "Suresh", item: "Contact Pin CP-12",
    machineOnTime: "09:00", machineOffTime: "17:30", actualQty: 272, okQty: 260, rejectReason: "Tool Mark",
    plannedOperatorShiftHours: 8.5, setupMin: 20, lunchMin: 40, noMaterialMin: 22 },

  { date: DAY_2, machine: "7B", slot: 2, operator: "Vinod", item: "Contact Pin CP-12",
    machineOnTime: "18:00", machineOffTime: "23:30", actualQty: 171, okQty: 166, rejectReason: "Operator Mistake",
    plannedOperatorShiftHours: 5.5, setupMin: 15, lunchMin: 20, noManPowerMin: 10, remarks: "Overtime shift" },

  // ── Day 3: today — three machines ──
  { date: DAY_3, machine: "7B", slot: 1, operator: "Suresh", item: "Contact Pin CP-12",
    machineOnTime: "09:00", machineOffTime: "17:30", actualQty: 272, okQty: 257, rejectReason: "Porosity / Blow Hole",
    plannedOperatorShiftHours: 8.5, setupMin: 25, lunchMin: 40, materialShiftingMin: 18 },

  { date: DAY_3, machine: "7C", slot: 1, operator: "Mahesh", item: "Housing Cover HC-88",
    machineOnTime: "09:00", machineOffTime: "17:30", actualQty: 151, okQty: 148, rejectReason: "Machine Fault",
    plannedOperatorShiftHours: 8.5, setupMin: 30, lunchMin: 40, bdMechMin: 28 },

  { date: DAY_3, machine: "7E", slot: 1, operator: "Rakesh", item: "Bus Bar Link BL-25",
    machineOnTime: "09:00", machineOffTime: "17:30", actualQty: 112, okQty: 108, rejectReason: "Surface Finish",
    plannedOperatorShiftHours: 8.5, setupMin: 35, lunchMin: 40, plannedDownMin: 20, otherMin: 10 },
];

const utcDay = (s) => new Date(`${s}T00:00:00.000Z`);
const dateFilter = { date: { $in: DATES.map(utcDay) } };

async function undo() {
  const entries = await ProductionEntry.deleteMany(dateFilter);
  const items = await Item.deleteMany({ itemName: { $in: ITEMS.map((i) => i.itemName) } });
  console.log(`Removed ${entries.deletedCount} demo entries and ${items.deletedCount} demo items.`);
}

async function seed() {
  const machines = await Machine.find({ isActive: true }).lean();
  const machineByName = Object.fromEntries(machines.map((m) => [m.machineName, m._id]));

  const missing = [...new Set(ENTRIES.map((e) => e.machine))].filter((n) => !machineByName[n]);
  if (missing.length) {
    throw new Error(`These machines don't exist yet — add them in Machine Master first: ${missing.join(", ")}`);
  }

  // Upsert the demo items so re-running doesn't pile up duplicates.
  const itemByName = {};
  for (const item of ITEMS) {
    const doc = await Item.findOneAndUpdate(
      { itemName: item.itemName },
      { ...item, isActive: true },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    itemByName[item.itemName] = doc;
  }

  // Clear only this script's dates, so re-running replaces its own data.
  const cleared = await ProductionEntry.deleteMany(dateFilter);

  const docs = ENTRIES.map((e) => {
    const item = itemByName[e.item];
    const { item: _itemName, machine, date, actualQty, okQty, ...rest } = e;
    return {
      ...rest,
      date: utcDay(date),
      machine: machineByName[machine],
      actualQty,
      okQty,
      // Rejected is derived everywhere else too — keep the stored value in step.
      rejectedQty: actualQty - okQty,
      item: item._id,
      itemName: item.itemName,
      drawingNo: item.drawingNo,
      setupNo: item.setupNo,
      cycleOpsSec: item.cycleOpsSec,
    };
  });

  await ProductionEntry.insertMany(docs);
  console.log(`Cleared ${cleared.deletedCount} old demo entries.`);
  console.log(`Seeded ${ITEMS.length} items and ${docs.length} production entries across ${DATES.join(", ")}.`);
  console.log(`Machines used: ${[...new Set(ENTRIES.map((e) => e.machine))].join(", ")}`);
}

(async () => {
  await connectDB();
  if (process.argv.includes("--undo")) await undo();
  else await seed();
  await mongoose.connection.close();
  process.exit(0);
})().catch((err) => {
  console.error("Demo seed failed:", err.message);
  process.exit(1);
});
