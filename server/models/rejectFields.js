const mongoose = require("mongoose");
const { REJECT_REASONS } = require("./ProductionEntry");

/**
 * models/rejectFields.js
 * ────────────────────────
 * The fields behind the entry form's "Production Master" (Actual + OK Quantity,
 * Rejected derived as Actual − OK) and "Rejection Master (Qty)" (how the
 * rejected pieces split across REJECT_REASONS) — the CNC sheet's own, spread
 * into every other machine sheet's schema so the sheets can't drift apart.
 * okQty / rejectedQty stay declared in each sheet's own schema.
 */
module.exports.rejectFields = {
  // Entered with OK Quantity; Rejected is derived from the two on every save
  // (utils/rejectSplit.js), so the three can never disagree. Absent on entries
  // saved before this existed — they read as OK + Rejected.
  actualQty: { type: Number, min: [0, "Actual Quantity cannot be negative"] },
  // The biggest reason in the split — the one-reason-per-entry shape older
  // records and the table column use.
  rejectReason: { type: String, trim: true, maxlength: 60, default: "" },
  // { reason: qty }, only reasons that actually cost pieces.
  rejectBreakdown: {
    type: Map,
    of: { type: Number, min: [0, "Rejected quantity cannot be negative"] },
    default: undefined,
    validate: {
      validator: (m) => !m || [...m.keys()].every((k) => REJECT_REASONS.includes(k)),
      message: "Unknown reject reason",
    },
  },
  // Why "Other" was used — required whenever the split has pieces against it.
  rejectOtherRemark: { type: String, trim: true, maxlength: 300, default: "" },
};
