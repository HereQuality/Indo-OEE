const mongoose = require("mongoose");

/**
 * models/entryCommon.js
 * ───────────────────────
 * Fields every sheet's entry carries (CNC, VMC, SPM, RIVET, PRESS, CONTACT, TROBE),
 * spread into each entry schema so the six stay identical.
 */

// Machine Working Status — any of these, ticked on the entry form. Kept in
// step with MACHINE_STATUSES in client/src/utils/productionSheet.js.
const MACHINE_STATUSES = ["Machine Breakdown", "No Manpower", "No Planning"];

const REVIEW_STATUSES = ["pending", "approved", "rejected"];

const reviewerSchema = new mongoose.Schema(
  {
    id: { type: mongoose.Schema.Types.ObjectId },
    model: { type: String, enum: ["User", "Operator"] },
    name: { type: String, default: "" },
    role: { type: String, default: "" },
  },
  { _id: false },
);

const entryCommonFields = {
  // "Non Working" = the machine did not run (see utils/workingMode.js); absent = Working.
  workingMode: { type: String, enum: ["Non Working"], default: undefined },
  machineStatus: {
    type: [{ type: String, enum: MACHINE_STATUSES }],
    default: undefined,
  },
  // Availability / Performance / Quality as last saved (fractions, 1 = 100%)
  // — worked out by the server on every save (utils/oeeMetrics.js), so the
  // review list and reports don't depend on the browser's figures.
  oee: {
    availability: { type: Number, default: null },
    performance: { type: Number, default: null },
    quality: { type: Number, default: null },
  },
  // Set only while one of those three is (or was, when reviewed) above 100%:
  // the entry is held for Admin review — see utils/entryAudit.js. The figures
  // themselves are never capped.
  review: {
    type: new mongoose.Schema(
      {
        status: { type: String, enum: REVIEW_STATUSES, required: true },
        flagged: { type: [{ metric: String, value: Number, _id: false }], default: [] },
        flaggedAt: { type: Date },
        decidedBy: { type: reviewerSchema, default: undefined },
        decidedAt: { type: Date },
        remark: { type: String, trim: true, maxlength: 500, default: "" },
      },
      { _id: false },
    ),
    default: undefined,
  },
};

module.exports = { MACHINE_STATUSES, REVIEW_STATUSES, entryCommonFields };
