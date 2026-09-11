"use strict";
const mongoose = require("mongoose");

/**
 * models/FormField.js
 * ────────────────────────────
 * One field on a FormDefinition. See FormDefinition.js for why `isCore`
 * exists — core fields map to real, engine-read ProductionEntry columns and
 * can only be relabelled/reordered/hidden, never deleted or retyped.
 * Non-core fields are admin-created and stored in ProductionEntry.extraValues.
 */
const FormFieldSchema = new mongoose.Schema(
  {
    formDefinitionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FormDefinition",
      required: true,
      index: true,
    },
    // Matches the ProductionEntry column name for core fields; for custom
    // fields it's the key inside ProductionEntry.extraValues.
    key: {
      type: String,
      required: [true, "Field key is required"],
      trim: true,
      match: [/^[a-zA-Z][a-zA-Z0-9_]*$/, "Key must start with a letter and contain only letters, numbers or underscores"],
    },
    label: {
      type: String,
      required: [true, "Field label is required"],
      trim: true,
      maxlength: [120, "Label must be 120 characters or fewer"],
    },
    type: {
      type: String,
      enum: ["text", "number", "date", "time", "dropdown", "textarea"],
      default: "number",
    },
    dropdownSource: {
      type: String,
      enum: ["none", "static", "machineMaster", "machineOperatorMaster", "processMaster"],
      default: "none",
    },
    staticOptions: {
      type: [String],
      default: [],
    },
    defaultValue: mongoose.Schema.Types.Mixed,
    isRequired: {
      type: Boolean,
      default: false,
    },
    // Summed into Total Stoppage. For custom fields the controller rolls
    // these up into ProductionEntry.customStoppageMin, which is itself one
    // of the engine's STOPPAGE_KEYS — that's how an admin-added downtime
    // reason reaches the OEE math without the calc service needing DB access.
    isStoppageReason: {
      type: Boolean,
      default: false,
    },
    // Structural field backed by a real ProductionEntry column — see
    // FormDefinition.js. Set by the seeder, never by the API.
    isCore: {
      type: Boolean,
      default: false,
    },
    // Hidden fields aren't rendered. A required core field can't be hidden
    // (guarded in formBuilder.controller.js) — the engine still needs it.
    isVisible: {
      type: Boolean,
      default: true,
    },
    section: {
      type: String,
      trim: true,
      default: "Details",
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

FormFieldSchema.index({ formDefinitionId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("FormField", FormFieldSchema);
