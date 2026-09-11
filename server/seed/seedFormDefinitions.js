"use strict";
/**
 * seed/seedFormDefinitions.js
 * ────────────────────────────
 * Registers the Grinding Data Entry form with Form Builder by describing
 * the fields the page already renders (see client/src/pages/GrindingEntry.jsx
 * and server/controllers/productionEntry.controller.js).
 *
 * Safe to re-run. Presentation columns (label, section, order) are written
 * only on INSERT — re-running never clobbers a label an admin has since
 * changed in Form Builder. The structural columns (isCore, type,
 * isStoppageReason) are always re-asserted, because those describe what the
 * OEE engine actually reads and must not drift.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const FormDefinition = require("../models/FormDefinition");
const FormField = require("../models/FormField");

const FORM = {
  name: "Grinding Data Entry",
  slug: "grinding-data-entry",
  appliesTo: "production_entry",
};

// section, then order within it. Mirrors the page's current layout.
const CORE_FIELDS = [
  // ── Entry header ────────────────────────────────────────────────────────
  { key: "machine", label: "M/C Name", type: "dropdown", dropdownSource: "machineMaster", isRequired: true, section: "Entry", order: 1 },
  { key: "operator", label: "Operator", type: "dropdown", dropdownSource: "machineOperatorMaster", isRequired: false, section: "Entry", order: 2 },
  { key: "date", label: "Date", type: "date", isRequired: true, section: "Entry", order: 3 },
  { key: "mcStartTime", label: "M/C Start Time", type: "time", isRequired: true, section: "Entry", order: 4 },
  { key: "mcOffTime", label: "M/C Off Time", type: "time", isRequired: true, section: "Entry", order: 5 },

  // ── Glass / output ──────────────────────────────────────────────────────
  { key: "sizeWidthMm", label: "Size Width (mm)", type: "number", isRequired: true, section: "Production", order: 1 },
  { key: "sizeHeightMm", label: "Size Height (mm)", type: "number", isRequired: true, section: "Production", order: 2 },
  { key: "thicknessMm", label: "Thickness in mm", type: "number", isRequired: true, section: "Production", order: 3 },
  { key: "standardTimePerPieceMin", label: "Standard Time of Grinding One Glass (Minutes)", type: "number", isRequired: true, section: "Production", order: 4 },
  { key: "processQty", label: "Production Qty", type: "number", isRequired: true, section: "Production", order: 5 },
  { key: "okQty", label: "OK Qty", type: "number", isRequired: true, section: "Production", order: 6 },

  // ── Rejection reasons (sum into Rejected Qty, not Total Stoppage) ───────
  { key: "rejScratchesQty", label: "Scratches", type: "number", section: "Rejection Reasons", order: 1 },
  { key: "rejChippingQty", label: "Chipping", type: "number", section: "Rejection Reasons", order: 2 },
  { key: "rejCornerBreakageQty", label: "Corner Breakage", type: "number", section: "Rejection Reasons", order: 3 },
  { key: "rejSizeMismatchQty", label: "Size Mis-match", type: "number", section: "Rejection Reasons", order: 4 },
  { key: "rejHandlingBreakageQty", label: "Handling Breakage and Others", type: "number", section: "Rejection Reasons", order: 5 },

  // ── Downtime & stoppage reasons (sum into Total Stoppage) ───────────────
  { key: "plannedDowntimeMin", label: "Planned Downtime (Minutes)", type: "number", isStoppageReason: true, section: "Downtime & Stoppage", order: 1 },
  { key: "noManpowerMin", label: "No Manpower (Minutes)", type: "number", isStoppageReason: true, section: "Downtime & Stoppage", order: 2 },
  { key: "mechanicalBreakdownMin", label: "Mechanical Breakdown (Minutes)", type: "number", isStoppageReason: true, section: "Downtime & Stoppage", order: 3 },
  { key: "electricalBreakdownMin", label: "Electrical Breakdown (Minutes)", type: "number", isStoppageReason: true, section: "Downtime & Stoppage", order: 4 },
  { key: "rawMaterialNotAvailableMin", label: "Raw Material Not Available (Minutes)", type: "number", isStoppageReason: true, section: "Downtime & Stoppage", order: 5 },
  { key: "humanErrorStoppageMin", label: "Stoppage (Human Error) (Minutes)", type: "number", isStoppageReason: true, section: "Downtime & Stoppage", order: 6 },
  { key: "changeoverMin", label: "Changeover (Minutes)", type: "number", isStoppageReason: true, section: "Downtime & Stoppage", order: 7 },
  { key: "rawMaterialProblemMin", label: "Raw Material Problem (Minutes)", type: "number", isStoppageReason: true, section: "Downtime & Stoppage", order: 8 },
  { key: "noPowerMin", label: "No Power (Minutes)", type: "number", isStoppageReason: true, section: "Downtime & Stoppage", order: 9 },
  { key: "othersMin", label: "Others (Minutes)", type: "number", isStoppageReason: true, section: "Downtime & Stoppage", order: 10 },
];

async function run() {
  await connectDB();

  const form = await FormDefinition.findOneAndUpdate(
    { slug: FORM.slug },
    { $set: { name: FORM.name, appliesTo: FORM.appliesTo, isActive: true }, $setOnInsert: { version: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  let created = 0;
  for (const f of CORE_FIELDS) {
    const res = await FormField.updateOne(
      { formDefinitionId: form._id, key: f.key },
      {
        // Structural truths — always re-asserted so they can't drift away
        // from what the OEE engine reads.
        $set: {
          isCore: true,
          type: f.type,
          isStoppageReason: !!f.isStoppageReason,
          ...(f.dropdownSource ? { dropdownSource: f.dropdownSource } : {}),
        },
        // Presentation — insert-only, so admin edits survive a re-run.
        $setOnInsert: {
          formDefinitionId: form._id,
          key: f.key,
          label: f.label,
          section: f.section,
          order: f.order,
          isRequired: !!f.isRequired,
          isVisible: true,
        },
      },
      { upsert: true },
    );
    if (res.upsertedCount) created += 1;
  }

  console.log(`Form "${form.name}" (${form.slug}) seeded — ${CORE_FIELDS.length} core fields, ${created} newly created.`);
  console.log("Existing labels/order/visibility left untouched.");

  await mongoose.connection.close();
}

run().catch(async (err) => {
  console.error("Form definition seeding failed:", err);
  await mongoose.connection.close();
  process.exit(1);
});
