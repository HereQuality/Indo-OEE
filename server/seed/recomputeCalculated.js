"use strict";
/**
 * seed/recomputeCalculated.js
 *
 * Maintenance script: re-runs computeCalculations() against every existing
 * ProductionEntry and updates ONLY its `calculated` sub-document (+ the
 * derived top-level `overtimeMin`) in place. Every other field — machine,
 * operator, quantities, stoppage minutes, etc. — is left untouched.
 *
 * Use this (not a wipe-and-reseed) whenever a formula in
 * productionCalculation.service.js changes and needs to apply
 * retroactively to real, already-entered production data — reseeding
 * would destroy real entries; this only touches derived fields.
 *
 * Usage: node server/seed/recomputeCalculated.js
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const ProductionEntry = require("../models/ProductionEntry");
require("../models/Shift");
const { computeCalculations } = require("../services/productionCalculation.service");

async function run() {
  await connectDB();

  const entries = await ProductionEntry.find({}).populate("shift", "shiftOnTime shiftOffTime");
  console.log(`Recomputing calculated fields for ${entries.length} entries...`);

  let updated = 0;
  for (const entry of entries) {
    const calculated = computeCalculations({
      ...entry.toObject(),
      shiftOnTime: entry.shift?.shiftOnTime,
      shiftOffTime: entry.shift?.shiftOffTime,
    });
    entry.calculated = calculated;
    entry.overtimeMin = calculated.overtimeMin;
    await entry.save();
    updated++;
  }

  console.log(`Done — recomputed ${updated} entries in place (no entries created/deleted).`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("Recompute failed:", err);
  process.exit(1);
});
