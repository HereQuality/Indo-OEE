"use strict";
/**
 * seed/seedRealAugustData.js
 * ─────────────────────────────
 * Real "Section Wise Eff. (CNC)" sheet data for 17–29 Aug 2026, machines
 * 7A–7E, exactly as it was pasted from the original sheet — so the app's own
 * calculated columns (Machine Shift, Ideal Quantity, Effective Runtime, OEE,
 * …) can be checked against it row by row.
 *
 * Only rows that actually have a Part Name and times are entries; a row
 * whose Working Status was M/C OFF / ABSENT / SUNDAY / HOLIDAY has nothing
 * typed on the real sheet either, so it seeds nothing (no entry = no row,
 * same as the app itself).
 *
 * OK Quantity is the sheet's own "Actual OK Quantity" column. Ideal Quantity
 * (and so Rejected = Ideal − OK) is computed here with the exact formula
 * client/src/utils/productionSheet.js uses — floor(shift seconds ÷ cycle
 * seconds) — not copied from the sheet's own Ideal Quantity column, which is
 * left unfloored there; comparing the two is part of what this seed is for.
 *
 *   node seed/seedRealAugustData.js          seed (clears its own dates first)
 *   node seed/seedRealAugustData.js --undo   remove everything it created
 *
 * Only touches 2026-08-17 through 2026-08-29 and the items it created.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Machine = require("../models/Machine");
const Item = require("../models/Item");
const ProductionEntry = require("../models/ProductionEntry");

const DATES = [
  "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22",
  "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-29",
];

// Part Name -> [Drawing No., Total Cycle Time (sec)], exactly as given.
const ITEMS = [
  ["6 PIN HOOD L/C T/E PG16", "IE0192", 90],
  ["12 PIN HOOD S/E M32", "IE0022/C2M", 90],
  ["12 PIN HOOD S/E PG29", "IE0022/C1", 90],
  ["48 PIN HOOD L/C S/E PG36", "IE0029/C5", 100],
  ["16 PIN HOOD H/C S/E M40", "IE0519/C3M", 88],
  ["32 PIN MIN HOOD H/C S/E PG29", "IE0257", 83],
  ["6 PIN HOOD 3 SIDE CLOSE", "IE0192", 60],
  ["10 PIN HOOD L/C T/E PG16", "IE0203/D2", 90],
  ["24 PIN HOOD H/C T/E PG29 PC", "IE0026", 115],
  ["3 PIN HOOD T/E PG11", "IE0020/D4", 90],
  ["3 PIN HOOD S/E PG11", "IE0019/C4", 60],
  ["16 PIN HOOD L/C S/E M32", "IE0023/C2M", 90],
  ["16 PIN HOOD L/C T/E PG21", "IE0023/D0", 90],
  ["16 PIN MIN HOOD S/E PG21", "IE0024/C0", 80],
  ["24 PIN HOOD L/C S/E PG29", "IE0025/C1", 72],
  ["24 PIN HOOD H/C T/E PG29", "IE0026", 90],
  ["10 PIN HOOD H/C S/E PG21 PC", "IE0518/C0", 110],
  ["10 PIN B/C H/C S/E PG21 PC", "IE0635/E0", 110],
  ["24 PIN HOOD 3 SIDE CLOSE", "IE0026", 60],
].map(([itemName, drawingNo, totalCycleSec]) => ({ itemName, drawingNo, totalCycleSec }));

// date, machine, slot, operator, item, ON, OFF, OK Qty — one row per real
// sheet entry, in the sheet's own left-to-right, top-to-bottom order.
const ENTRIES = [
  ["2026-08-17", "7A", 1, "JATIN", "6 PIN HOOD L/C T/E PG16", "08:00", "20:00", 450],
  ["2026-08-17", "7B", 1, "JAYESH", "12 PIN HOOD S/E M32", "08:00", "14:30", 230],
  ["2026-08-17", "7B", 2, "JAYESH", "12 PIN HOOD S/E PG29", "14:30", "16:30", 40],
  ["2026-08-17", "7C", 1, "NITIN", "32 PIN MIN HOOD H/C S/E PG29", "08:00", "12:00", 170],
  // 7D/7E were M/C OFF this day.

  ["2026-08-18", "7A", 1, "JATIN", "6 PIN HOOD L/C T/E PG16", "08:30", "16:30", 270],
  ["2026-08-18", "7B", 1, "JAYESH", "12 PIN HOOD S/E PG29", "08:30", "10:00", 60],
  ["2026-08-18", "7B", 2, "JAYESH", "48 PIN HOOD L/C S/E PG36", "10:00", "15:30", 108],
  ["2026-08-18", "7B", 3, "JAYESH", "16 PIN HOOD H/C S/E M40", "15:30", "19:00", 60],
  ["2026-08-18", "7C", 1, "NITIN", "32 PIN MIN HOOD H/C S/E PG29", "08:00", "16:30", 340],
  ["2026-08-18", "7D", 1, "SANJU", "6 PIN HOOD 3 SIDE CLOSE", "08:00", "19:00", 620],

  ["2026-08-19", "7A", 1, "JATIN", "10 PIN HOOD L/C T/E PG16", "08:00", "20:00", 320],
  ["2026-08-19", "7B", 1, "JAYESH", "16 PIN HOOD H/C S/E M40", "08:00", "18:00", 117],
  ["2026-08-19", "7C", 1, "NITIN", "32 PIN MIN HOOD H/C S/E PG29", "08:00", "20:30", 422],
  ["2026-08-19", "7D", 1, "SANJU", "6 PIN HOOD 3 SIDE CLOSE", "08:00", "18:00", 500],
  ["2026-08-19", "7D", 2, "JAYESH", "6 PIN HOOD 3 SIDE CLOSE", "18:00", "20:30", 150],

  ["2026-08-20", "7A", 1, "JATIN", "24 PIN HOOD H/C T/E PG29 PC", "08:00", "12:00", 125],
  ["2026-08-20", "7A", 2, "JATIN", "10 PIN HOOD L/C T/E PG16", "12:30", "14:30", 20],
  ["2026-08-20", "7B", 1, "JAYESH", "3 PIN HOOD T/E PG11", "08:00", "20:30", 300],
  ["2026-08-20", "7C", 1, "NITIN", "3 PIN HOOD S/E PG11", "08:00", "19:00", 520],
  ["2026-08-20", "7D", 1, "SANJU", "6 PIN HOOD 3 SIDE CLOSE", "08:00", "19:00", 600],

  // 7A was M/C OFF, 7D was ABSENT this day — nothing to seed for either.
  ["2026-08-21", "7B", 1, "JAYESH", "3 PIN HOOD T/E PG11", "08:00", "16:30", 125],
  ["2026-08-21", "7C", 1, "NITIN", "3 PIN HOOD S/E PG11", "08:00", "16:30", 460],

  ["2026-08-22", "7A", 1, "JATIN", "10 PIN HOOD L/C T/E PG16", "08:00", "22:30", 470],
  ["2026-08-22", "7B", 1, "JAYESH", "3 PIN HOOD T/E PG11", "08:00", "12:00", 60],
  ["2026-08-22", "7B", 2, "JAYESH", "16 PIN HOOD L/C S/E M32", "12:30", "22:30", 270],
  // 7C/7D/7E were M/C OFF this day.

  // 23/08 — every machine SUNDAY, nothing to seed.

  ["2026-08-24", "7A", 1, "JATIN", "10 PIN HOOD L/C T/E PG16", "08:00", "13:30", 190],
  ["2026-08-24", "7A", 2, "JATIN", "16 PIN HOOD L/C T/E PG21", "13:30", "20:00", 180],
  ["2026-08-24", "7B", 1, "JAYESH", "16 PIN HOOD L/C S/E M32", "08:00", "10:00", 57],
  ["2026-08-24", "7B", 2, "JAYESH", "16 PIN MIN HOOD S/E PG21", "10:00", "18:00", 180],
  ["2026-08-24", "7C", 1, "NITIN", "3 PIN HOOD S/E PG11", "08:00", "20:00", 610],
  // 7D/7E were M/C OFF this day.

  ["2026-08-25", "7A", 1, "JATIN", "16 PIN HOOD L/C T/E PG21", "08:00", "18:30", 240],
  ["2026-08-25", "7C", 1, "SANJU", "3 PIN HOOD S/E PG11", "08:00", "18:00", 490],
  // 7B/7D/7E were M/C OFF this day.

  ["2026-08-26", "7A", 1, "JATIN", "16 PIN HOOD L/C T/E PG21", "08:00", "12:00", 80],
  ["2026-08-26", "7B", 1, "JAYESH", "16 PIN MIN HOOD S/E PG21", "08:00", "19:00", 350],
  ["2026-08-26", "7D", 1, "SANJU", "24 PIN HOOD L/C S/E PG29", "08:00", "19:00", 450],
  // 7C/7E were M/C OFF this day.

  ["2026-08-27", "7A", 1, "JATIN", "24 PIN HOOD H/C T/E PG29", "08:00", "23:30", 510],
  ["2026-08-27", "7B", 1, "JAYESH", "10 PIN HOOD H/C S/E PG21 PC", "08:00", "14:30", 90],
  ["2026-08-27", "7B", 2, "JAYESH", "10 PIN B/C H/C S/E PG21 PC", "14:30", "19:00", 87],
  ["2026-08-27", "7B", 3, "JAYESH", "16 PIN MIN HOOD S/E PG21", "19:00", "23:30", 90],
  ["2026-08-27", "7D", 1, "SANJU", "24 PIN HOOD L/C S/E PG29", "08:00", "19:00", 410],
  // 7C/7E were M/C OFF this day.

  // 28/08 — every machine HOLIDAY, nothing to seed.

  // 7A was M/C OFF, 7C was M/C OFF this day.
  ["2026-08-29", "7B", 1, "JAYESH", "16 PIN MIN HOOD S/E PG21", "08:00", "18:00", 290],
  ["2026-08-29", "7D", 1, "SANJU", "24 PIN HOOD L/C S/E PG29", "08:00", "10:30", 122],
  ["2026-08-29", "7E", 1, "SANJU", "24 PIN HOOD 3 SIDE CLOSE", "14:00", "19:00", 300],
].map(([date, machine, slot, operator, item, machineOnTime, machineOffTime, okQty]) => ({
  date, machine, slot, operator, item, machineOnTime, machineOffTime, okQty,
}));

// Same span/Ideal Quantity math as client/src/utils/productionSheet.js's
// rowCalc, so the seeded actualQty/rejectedQty agree with what the app
// itself would compute and save.
const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const shiftMinutesOf = (on, off) => {
  let span = toMinutes(off) - toMinutes(on);
  if (span < 0) span += 24 * 60;
  return span;
};
const idealQtyOf = (shiftMin, cycleSec) => Math.floor((shiftMin * 60) / cycleSec);

const utcDay = (s) => new Date(`${s}T00:00:00.000Z`);
const dateFilter = { date: { $in: DATES.map(utcDay) } };

async function undo() {
  const entries = await ProductionEntry.deleteMany(dateFilter);
  const items = await Item.deleteMany({ itemName: { $in: ITEMS.map((i) => i.itemName) } });
  console.log(`Removed ${entries.deletedCount} entries and ${items.deletedCount} items.`);
}

async function seed() {
  const machines = await Machine.find({ isActive: true }).lean();
  const machineByName = Object.fromEntries(machines.map((m) => [m.machineName, m._id]));

  const missingMachines = [...new Set(ENTRIES.map((e) => e.machine))].filter((n) => !machineByName[n]);
  if (missingMachines.length) {
    throw new Error(`These machines don't exist yet — add them in Machine Master first: ${missingMachines.join(", ")}`);
  }

  // Upsert items so re-running doesn't pile up duplicates.
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
    const shiftMin = shiftMinutesOf(e.machineOnTime, e.machineOffTime);
    const idealQty = idealQtyOf(shiftMin, item.totalCycleSec);
    const rejectedQty = Math.max(0, idealQty - e.okQty);
    return {
      date: utcDay(e.date),
      machine: machineByName[e.machine],
      slot: e.slot,
      operator: e.operator,
      item: item._id,
      itemName: item.itemName,
      drawingNo: item.drawingNo,
      totalCycleSec: item.totalCycleSec,
      excludedOps: [],
      machineOnTime: e.machineOnTime,
      machineOffTime: e.machineOffTime,
      okQty: e.okQty,
      // The sheet gave no per-reason reject split for these rows — Rejected
      // itself (Ideal − OK) is still exact, just not broken down by reason.
      actualQty: idealQty,
      rejectedQty,
      rejectBreakdown: {},
      rejectReason: "",
    };
  });

  await ProductionEntry.insertMany(docs);
  console.log(`Cleared ${cleared.deletedCount} old entries for these dates.`);
  console.log(`Seeded ${ITEMS.length} items and ${docs.length} production entries across ${DATES.join(", ")}.`);
}

(async () => {
  await connectDB();
  if (process.argv.includes("--undo")) await undo();
  else await seed();
  await mongoose.connection.close();
  process.exit(0);
})().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
