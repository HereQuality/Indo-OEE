const mongoose = require("mongoose");

/**
 * models/MachineDayStatus.js
 * ───────────────────────────
 * A "Not running" mark on a data entry sheet: a machine (or, on a sheet kept
 * by worker, the whole day) that has no entry for a date on purpose — a
 * holiday, a breakdown, no order. It turns the sheet's "Not filled yet" row
 * into a grey "Not running" row with its reason and remarks, so a skipped
 * day is told apart from one somebody forgot to fill.
 *
 *   sheet    the sheet's key, as the client's bulk actions name it ("cnc", "vmc", "rawCasting", …)
 *   date     "YYYY-MM-DD"
 *   machine  the machine's id, or "" on a worker sheet (one mark per day)
 *   reasons  one or more of REASONS (`reason` is the first, kept for older clients);
 *            a mark with any unplanned reason counts as a loss
 */
const REASONS = {
  holiday: { label: "Holiday / plant off", kind: "planned" },
  noOrder: { label: "No order / no plan", kind: "planned" },
  maintenance: { label: "Planned maintenance", kind: "planned" },
  breakdown: { label: "Breakdown", kind: "unplanned" },
  noOperator: { label: "No operator", kind: "unplanned" },
  noMaterial: { label: "No material", kind: "unplanned" },
  power: { label: "Power cut", kind: "unplanned" },
  other: { label: "Other", kind: "unplanned" },
};

const SHEETS = ["cnc", "vmc", "spm", "rivet", "press", "contact", "trobe", "spring", "powder", "rubber", "injection", "embossing", "printing", "bpc", "finalAssembly", "rawCasting", "mfd", "mfa"];

const MachineDayStatusSchema = new mongoose.Schema(
  {
    sheet: { type: String, required: true, enum: SHEETS },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    machine: { type: String, default: "" },
    reason: { type: String, required: true, enum: Object.keys(REASONS) },
    reasons: { type: [{ type: String, enum: Object.keys(REASONS) }], default: undefined },
    remarks: { type: String, trim: true, default: "", maxlength: [300, "Remarks must be 300 characters or fewer"] },
    markedBy: { type: String, default: "" },
  },
  { timestamps: true },
);
MachineDayStatusSchema.index({ sheet: 1, date: 1, machine: 1 }, { unique: true });

module.exports = mongoose.model("MachineDayStatus", MachineDayStatusSchema);
module.exports.REASONS = REASONS;
module.exports.SHEETS = SHEETS;
