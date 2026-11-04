const mongoose = require("mongoose");
const { UOMS } = require("./KpiObjective");

/**
 * models/CompanyObjective.js
 * ────────────────────────────
 * A company-level objective for one year (Data Entry › Company Level
 * Objective): the objective, its Target (sales) and Baseline, each with its
 * own unit ("Qty" or "%"). The page's OK Qty totals come from every process's
 * entries (utils/kpiOkQty.js), not from here.
 */
const measure = {
  value: { type: Number, min: [0, "Value cannot be negative"], default: null },
  uom: { type: String, enum: UOMS, default: "Qty" },
};

const CompanyObjectiveSchema = new mongoose.Schema(
  {
    objective: { type: String, required: [true, "Objective is required"], trim: true, maxlength: 200 },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    target: measure,
    baseline: measure,
    owner: { type: String, trim: true, maxlength: 100 },
    remarks: { type: String, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true },
    createdByName: { type: String, trim: true },
  },
  { timestamps: true },
);

CompanyObjectiveSchema.index({ year: 1 });

module.exports = mongoose.model("CompanyObjective", CompanyObjectiveSchema);
