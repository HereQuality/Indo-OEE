const mongoose = require("mongoose");
const { entryCommonFields } = require("./entryCommon");
const { WORKING_STATUSES, NON_WORKING_STATUSES } = require("./SpringEntry");
const { rejectFieldsFor } = require("./rejectFields");

/**
 * models/BeforePowderCoatingEntry.js
 * ────────────────────────────────────
 * One row of the BEFORE POWDER COATING sheet (sheet key "bpc") — a different
 * process from AFTER POWDER COATING (PowderCoatingEntry). Like RUBBER it is
 * kept per OPERATOR, not per machine: the sheet has no MC No., so an entry is
 * keyed by (date, worker, slot) and the operator (an Operator Master name)
 * stands where the machine stands elsewhere. Up to MAX_SLOTS entries per
 * operator per date (the paper has up to six). `process` is stored on the
 * entry itself, since there's no machine to find it through (the Operator
 * Planned Shift lock and the dashboard both need it).
 *
 * Its figures are the SPRING FOR PINS model: Standard Time per Piece
 * (totalCycleSec, prefilled from the Part), TOTAL QTY (actualQty) and OK QTY
 * typed, Rejected = TOTAL − OK split across this sheet's OWN reject reasons
 * (BPC_REJECT_REASONS), and Effective Machine Run Time on TOTAL QTY. Machine
 * ON / OFF Time are machineOnTime / machineOffTime. The four downtime boxes
 * are Setup Time (setupMin), B.D. (Breakdown) (bdMechMin — the shared key, so
 * every formula and the server's oeeMetrics count it unchanged), Lunch / Tea /
 * Washroom (lunchMin) and Other (otherMin).
 *
 * Only the entered values are stored; every calculated column is derived on
 * display — see client/src/utils/bpcSheet.js.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };

// A date's entries per operator — the paper sheet has up to six.
const MAX_SLOTS = 8;

// The sheet's own Rejected QTY columns, in its order. Keep in step with
// BPC_REJECT_REASONS in client/src/utils/bpcSheet.js.
const BPC_REJECT_REASONS = ["Blow Holes Casting", "Crack/Damage Casting", "Threading Casting", "TAP Broken Casting", "Other"];

// The sheet's downtime columns, in its order — keep in step with
// BPC_STOPPAGE_FIELDS in client/src/utils/bpcSheet.js.
const BPC_STOPPAGE_KEYS = ["setupMin", "bdMechMin", "lunchMin", "otherMin"];

const BeforePowderCoatingEntrySchema = new mongoose.Schema(
  {
    // UTC midnight of the sheet date.
    date: { type: Date, required: [true, "Date is required"] },
    // The operator (Operator Master) — this sheet's row key.
    worker: { type: mongoose.Schema.Types.ObjectId, ref: "MachineOperator", required: [true, "Operator is required"] },
    process: { type: mongoose.Schema.Types.ObjectId, ref: "Process", required: [true, "Process is required"] },
    slot: { type: Number, required: true, min: 1, max: MAX_SLOTS },

    // The operator's name as saved — what the shared Operator filters and charts read.
    operator: { type: String, trim: true, maxlength: 100, default: "" },
    workingStatus: { type: String, trim: true, maxlength: 40, default: "" },

    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", default: null },
    itemName: { type: String, trim: true, maxlength: 120, default: "" },

    // Standard Time per Piece (sec) — prefilled from the Part, this entry's
    // own (editable) figure.
    totalCycleSec: { type: Number, min: [0, "Standard Time per Piece cannot be negative"] },

    // Machine ON / OFF Time.
    machineOnTime: { type: String, match: HHMM },
    machineOffTime: { type: String, match: HHMM },

    // TOTAL QTY and the Rejection Master split over this sheet's own reasons;
    // Rejected = TOTAL − OK.
    ...rejectFieldsFor(BPC_REJECT_REASONS),
    okQty: { type: Number, min: [0, "OK Quantity cannot be negative"] },
    rejectedQty: { type: Number, min: [0, "Rejected Quantity cannot be negative"] },

    plannedOperatorShiftHours: { type: Number, min: [0, "Planned Operator Shift Time cannot be negative"], max: 24 },

    ...Object.fromEntries(BPC_STOPPAGE_KEYS.map((k) => [k, minutes])),

    // Reason/Remarks.
    remarks: { type: String, trim: true, maxlength: 500, default: "" },
    // Why "Other" downtime was used — required whenever that box has minutes.
    otherMinRemark: { type: String, trim: true, maxlength: 300, default: "" },

    // Working Status (Working / Non Working + reasons), Vendor, the
    // server-worked Availability / Performance / Quality, and Admin review
    // state — shared by every sheet (entryCommon.js).
    ...entryCommonFields,

    updatedBy: { type: mongoose.Schema.Types.ObjectId, refPath: "updatedByModel" },
    updatedByModel: { type: String, enum: ["User", "Operator"] },

    // Super Admin's 24-hour override of the 2-working-day lock — see
    // ProductionEntry.unlockedUntil.
    unlockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

BeforePowderCoatingEntrySchema.index({ date: 1, worker: 1, slot: 1 }, { unique: true });
BeforePowderCoatingEntrySchema.index({ process: 1, date: 1 });
BeforePowderCoatingEntrySchema.index({ "review.status": 1 }, { sparse: true });

module.exports = mongoose.model("BeforePowderCoatingEntry", BeforePowderCoatingEntrySchema);
module.exports.WORKING_STATUSES = WORKING_STATUSES;
module.exports.NON_WORKING_STATUSES = NON_WORKING_STATUSES;
module.exports.BPC_REJECT_REASONS = BPC_REJECT_REASONS;
module.exports.BPC_STOPPAGE_KEYS = BPC_STOPPAGE_KEYS;
module.exports.MAX_SLOTS = MAX_SLOTS;
