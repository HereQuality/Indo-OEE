const mongoose = require("mongoose");

/**
 * models/KpiObjective.js
 * ────────────────────────
 * A department's KPI objective for one year (Data Entry › KPI). Baseline and
 * Target are set once per objective; OK Qty is never typed — it's summed each
 * month from the data entries of the processes linked here (utils/kpiOkQty.js).
 * Every figure column carries its own unit: "Qty" (a count) or "%" — the
 * objective's UOM choices in Process Master's words.
 */
const UOMS = ["Qty", "%"];
const TARGET_PERIODS = ["Monthly", "Yearly"];

const measure = {
  value: { type: Number, min: [0, "Value cannot be negative"], default: null },
  uom: { type: String, enum: UOMS, default: "Qty" },
};

const KpiObjectiveSchema = new mongoose.Schema(
  {
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", required: [true, "Department is required"] },
    objective: { type: String, required: [true, "Objective is required"], trim: true, maxlength: 200 },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    // Whose OK Qty counts toward this objective.
    processes: [{ type: mongoose.Schema.Types.ObjectId, ref: "Process" }],
    baseline: measure,
    target: measure,
    // How the OK Qty column reads: the count itself, or as a % of Target.
    okQtyUom: { type: String, enum: UOMS, default: "Qty" },
    // A Monthly target is compared with each month's OK Qty; a Yearly target
    // with the OK Qty so far (cumulative) — the KPI page's Achievement column.
    targetPeriod: { type: String, enum: TARGET_PERIODS, default: "Monthly" },
    // Old month-wise OK Qty loaded from Excel (KPI › Upload Excel): used for a
    // month that has no data entries; a month with entries keeps the entries.
    uploadedMonths: [{ _id: false, month: { type: Number, min: 1, max: 12 }, okQty: { type: Number, min: 0 } }],
    owner: { type: String, trim: true, maxlength: 100 },
    remarks: { type: String, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true },
    createdByName: { type: String, trim: true },
  },
  { timestamps: true },
);

KpiObjectiveSchema.index({ department: 1, year: 1 });

module.exports = mongoose.model("KpiObjective", KpiObjectiveSchema);
module.exports.UOMS = UOMS;
module.exports.TARGET_PERIODS = TARGET_PERIODS;
