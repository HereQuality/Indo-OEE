const mongoose = require("mongoose");
const { entryCommonFields } = require("./entryCommon");
const { WORKING_STATUSES, NON_WORKING_STATUSES } = require("./SpringEntry");

/**
 * models/MfaEntry.js
 * ────────────────────
 * One row of the MODULAR FRAME ASSEMBLY sheet (sheet key "mfa") — its own
 * process, page and collection, on RAW CASTING's template (RawCastingEntry):
 * no machine, so an entry is keyed by (date, worker, slot) and the worker (an
 * Operator Master name) stands where the machine stands elsewhere. Up to
 * MAX_SLOTS entries per worker per date; their times may overlap. `process` is
 * stored on the entry itself, since there's no machine to find it through.
 *
 * Assembly Start / End Time are machineOnTime / machineOffTime and Standard
 * Assembly Time per Piece is totalCycleSec, so the shared formulas
 * (client/src/utils/productionSheet.js, server/utils/oeeMetrics.js) apply
 * unchanged. TOTAL QTY (actualQty) and OK QTY are typed; Rejected QTY is
 * TOTAL − OK, worked out on save. There is no reject reason split — only the
 * free-text Remarks, as on INJECTION MOULDING. No Vendor Name, no Challan No.
 *
 * Only the entered values are stored; every calculated column is derived on
 * display — see client/src/utils/mfaSheet.js.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };
const count = (label) => ({ type: Number, min: [0, `${label} cannot be negative`] });

// A date's entries per worker.
const MAX_SLOTS = 8;

// Idle Time on this sheet: Lunch / Tea / Washroom and Other only.
const IDLE_KEYS = ["lunchMin", "otherMin"];

// The sheet's timing columns, worded for assembly — the paper's own header for
// them wasn't sent, so these are the one place to rename them on the server
// (the controller's messages and the audit log read them from here). Keep in
// step with MFA_LABELS in client/src/utils/mfaSheet.js.
const MFA_LABELS = {
  start: "Assembly Start Time",
  end: "Assembly End Time",
  hours: "Assembly Working Hours",
  cycle: "Standard Assembly Time per Piece",
  idealQty: "Ideal Assembly Quantity",
  idealQtyPerHour: "Ideal Assembly Quantity/Hour",
  effective: "Ideal Assembly Time (In Hour)",
};

const MfaEntrySchema = new mongoose.Schema(
  {
    // UTC midnight of the sheet date.
    date: { type: Date, required: [true, "Date is required"] },
    worker: { type: mongoose.Schema.Types.ObjectId, ref: "MachineOperator", required: [true, "Worker is required"] },
    process: { type: mongoose.Schema.Types.ObjectId, ref: "Process", required: [true, "Process is required"] },
    slot: { type: Number, required: true, min: 1, max: MAX_SLOTS },

    // The worker's name as saved — what the shared Operator filters and charts read.
    operator: { type: String, trim: true, maxlength: 100, default: "" },
    workingStatus: { type: String, trim: true, maxlength: 40, default: "" },

    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", default: null },
    itemName: { type: String, trim: true, maxlength: 120, default: "" },

    // Standard Assembly Time per Piece (sec) — prefilled from the Part, this
    // entry's own (editable) figure.
    totalCycleSec: { type: Number, min: [0, "Standard Assembly Time cannot be negative"] },

    // Assembly Start / End Time.
    machineOnTime: { type: String, match: HHMM },
    machineOffTime: { type: String, match: HHMM },

    // TOTAL QTY and OK QTY typed; Rejected QTY = TOTAL − OK, set on save.
    actualQty: count("TOTAL QTY"),
    okQty: count("OK QTY"),
    rejectedQty: count("Rejected QTY"),

    otherActivity: { type: String, trim: true, maxlength: 200, default: "" },
    otherActivityMin: minutes,

    plannedOperatorShiftHours: { type: Number, min: [0, "Planned Operator Shift Time cannot be negative"], max: 24 },

    ...Object.fromEntries(IDLE_KEYS.map((k) => [k, minutes])),

    // Remarks.
    remarks: { type: String, trim: true, maxlength: 500, default: "" },
    // Why "Other" idle time was used — required whenever that box has minutes.
    otherMinRemark: { type: String, trim: true, maxlength: 300, default: "" },

    // Working Status (Working / Non Working + reasons), the server-worked
    // Availability / Performance / Quality, and Admin review state — shared by
    // every sheet (entryCommon.js). This sheet never sets its Vendor.
    ...entryCommonFields,

    updatedBy: { type: mongoose.Schema.Types.ObjectId, refPath: "updatedByModel" },
    updatedByModel: { type: String, enum: ["User", "Operator"] },

    // Super Admin's 24-hour override of the 2-working-day lock — see
    // ProductionEntry.unlockedUntil.
    unlockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

MfaEntrySchema.index({ date: 1, worker: 1, slot: 1 }, { unique: true });
MfaEntrySchema.index({ process: 1, date: 1 });
MfaEntrySchema.index({ "review.status": 1 }, { sparse: true });

module.exports = mongoose.model("MfaEntry", MfaEntrySchema);
module.exports.WORKING_STATUSES = WORKING_STATUSES;
module.exports.NON_WORKING_STATUSES = NON_WORKING_STATUSES;
module.exports.IDLE_KEYS = IDLE_KEYS;
module.exports.MAX_SLOTS = MAX_SLOTS;
module.exports.MFA_LABELS = MFA_LABELS;
