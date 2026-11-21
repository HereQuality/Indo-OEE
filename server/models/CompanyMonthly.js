const mongoose = require("mongoose");
const { METRIC_KEYS } = require("../utils/companyMetrics");

/**
 * models/CompanyMonthly.js
 * ──────────────────────────
 * The company's business figures for one month (Company Level Objective ›
 * Monthly Figures / Upload Excel): sales, salary, electricity bill, order
 * booking, FG / RM / WIP, inventory turnover, on-time delivery, customer
 * complaints — the keys in utils/companyMetrics.js. A metric left blank stays
 * null and is simply not counted.
 */
const values = Object.fromEntries(METRIC_KEYS.map((k) => [k, { type: Number, min: [0, "Figures cannot be negative"], default: null }]));

const CompanyMonthlySchema = new mongoose.Schema(
  {
    year: { type: Number, required: true, min: 2000, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },
    values: { type: new mongoose.Schema(values, { _id: false }), default: () => ({}) },
    updatedByName: { type: String, trim: true },
    source: { type: String, enum: ["entry", "excel"], default: "entry" },
  },
  { timestamps: true },
);

CompanyMonthlySchema.index({ year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model("CompanyMonthly", CompanyMonthlySchema);
