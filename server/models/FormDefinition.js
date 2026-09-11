"use strict";
const mongoose = require("mongoose");

/**
 * models/FormDefinition.js
 * ────────────────────────────
 * A named, versioned form whose fields admins edit from Form Builder
 * instead of a developer editing JSX (PRD indo.md §4/§8 "Phase 4").
 *
 * SCOPE — read this before adding a field type.
 * The OEE engine (services/productionCalculation.service.js) computes off
 * SPECIFIC named columns on ProductionEntry — processQty, okQty,
 * standardTimePerPieceMin, the ten STOPPAGE_KEYS, the M/C time window, and
 * so on. Those columns are therefore structural: Form Builder can relabel,
 * reorder, hide or un-require them, but never delete or retype them (they
 * carry `isCore`, enforced in formBuilder.controller.js). Anything an admin
 * genuinely adds is additive and lands in ProductionEntry.extraValues, so
 * the calculation engine and its stored history stay intact.
 */
const FormDefinitionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Form name is required"],
      trim: true,
      maxlength: [120, "Form name must be 120 characters or fewer"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    // What the form drives, e.g. "production_entry". Lets a later form be
    // added without the client guessing by slug.
    appliesTo: {
      type: String,
      required: true,
      trim: true,
    },
    // Bumped on every structural edit. Entries stamp the version they were
    // saved under so historical rows stay interpretable after a relabel.
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("FormDefinition", FormDefinitionSchema);
