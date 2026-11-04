const mongoose = require("mongoose");

/**
 * models/CompanyHistory.js
 * ──────────────────────────
 * Company-wide OK Qty for one month, loaded from an old Excel sheet (Company
 * Level Objective › Upload Excel). Used for a month that has no data entries
 * at all — once entries exist for a month, they win.
 */
const CompanyHistorySchema = new mongoose.Schema(
  {
    year: { type: Number, required: true, min: 2000, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },
    okQty: { type: Number, required: true, min: 0 },
    uploadedByName: { type: String, trim: true },
  },
  { timestamps: true },
);

CompanyHistorySchema.index({ year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model("CompanyHistory", CompanyHistorySchema);
