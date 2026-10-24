"use strict";
/**
 * seed/seedOeeReview.js
 * ───────────────────────
 * Test data for OEE Review: a handful of CNC entries whose Performance goes
 * over 100%, so the review desk, the flagged notifications,
 * Approve / Reject, the "rejected → fix it" notification and the audit log all
 * have something to work on.
 *
 *   node seed/seedOeeReview.js
 *
 * The entries are saved through each sheet's own saveRow, exactly as the data
 * entry form does — so the review flag, the audit-log rows and the "review
 * needed" notifications to the Full access people are real, not hand-written.
 * They are made by one ordinary operator (not a reviewer), so a reviewer can
 * decide them. Every seeded entry's remarks start with "[seed]"; running this
 * again first removes the previous ones. Local databases only.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const Operator = require("../models/Operator");
const Machine = require("../models/Machine");
const ProductionEntry = require("../models/ProductionEntry");
const cnc = require("../controllers/productionSheet.controller");

const TAG = "[seed]";
const LOCAL = /^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

// What each entry is meant to show. Only Performance can go over 100% through
// the forms: the sheets refuse a run longer than the shift (Availability), and
// every sheet but CNC refuses more pieces than the run can make. 8 h shift at
// 130 s a piece fits 221 pieces, so each count below is that many % over.
const base = { itemName: "24 Pin Bulkhead Mounting", drawingNo: "IE 0053", totalCycleSec: 130, machineOnTime: "08:00", machineOffTime: "16:00" };
const CNC_ENTRIES = [
  { ...base, machine: "7A", operator: "Seed Op 1", actualQty: 240, okQty: 236, why: "Performance about 108%" },
  { ...base, machine: "7B", operator: "Seed Op 2", actualQty: 255, okQty: 250, why: "Performance about 115%" },
  { ...base, machine: "7C", operator: "Seed Op 3", actualQty: 268, okQty: 262, daysAgo: 2, why: "Performance about 121%, two days ago" },
  { ...base, machine: "7D", operator: "Seed Op 4", actualQty: 230, okQty: 228, daysAgo: 2, why: "Performance about 104%" },
];

const main = async () => {
  const uri = process.env.MONGO_URI || "";
  if (!LOCAL.test(uri)) throw new Error("Refusing to seed: MONGO_URI must be a local database (mongodb://localhost…)");
  await mongoose.connect(uri);
  console.log(`Seeding ${uri}\n`);

  // The maker: an ordinary operator, so reviewers (Full access) can decide their entries.
  const maker = await Operator.findOne({ employeeName: /sanjay/i, isActive: { $ne: false } }) || (await Operator.findOne({ roleId: { $ne: null }, isActive: { $ne: false } }));
  if (!maker) throw new Error("No operator to make the entries as");
  console.log(`Entries are made by ${maker.employeeName || maker.name} (${maker.roleId})\n`);

  // Previous run's entries.
  for (const Model of [ProductionEntry]) {
    const gone = await Model.deleteMany({ remarks: new RegExp(`^\\${TAG}`) });
    if (gone.deletedCount) console.log(`Removed ${gone.deletedCount} earlier seeded ${Model.modelName}`);
  }

  const save = async (label, controller, entry) => {
    const { why, machine: machineName, daysAgo = 0, ...rest } = entry;
    const machine = await Machine.findOne({ machineName, isActive: true, isDeleted: { $ne: true } }).select("_id").lean();
    if (!machine) return console.log(`✗ ${label} ${machineName}: machine not found`);
    const res = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
    await controller.saveRow(
      { user: maker, query: {}, params: {}, body: { ...rest, machine: String(machine._id), date: iso(daysAgo), slot: "auto", plannedOperatorShiftHours: 8, remarks: `${TAG} ${why}` } },
      res,
    );
    const row = res.payload?.data;
    if (res.statusCode !== 200) return console.log(`✗ ${label} ${machineName}: ${res.payload?.message}`);
    const o = row.oee || {};
    const f = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");
    console.log(`✓ ${label} ${machineName}  ${row.date}  A ${f(o.availability)}  P ${f(o.performance)}  Q ${f(o.quality)}  → ${row.review?.status || "no review"}  (${why})`);
  };

  for (const e of CNC_ENTRIES) await save("CNC", cnc, e);

  // saveRow logs and notifies without awaiting — give those writes a moment.
  await new Promise((r) => setTimeout(r, 1500));
  await mongoose.disconnect();
  console.log("\nDone. Open OEE Review as a Full access user (e.g. the Head role) or the Super Admin.");
};

main().catch(async (error) => {
  console.error(`\nSeed failed: ${error.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
