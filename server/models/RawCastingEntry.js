const mongoose = require("mongoose");
const { entryCommonFields } = require("./entryCommon");
const { WORKING_STATUSES, NON_WORKING_STATUSES } = require("./SpringEntry");
const { rejectFieldsFor } = require("./rejectFields");

/**
 * models/RawCastingEntry.js
 * ───────────────────────────
 * One row of the RAW CASTING inspection sheet (sheet key "rawCasting") — its
 * own process, page and collection, on AFTER POWDER COATING's template
 * (PowderCoatingEntry): no machine, so an entry is keyed by (date, worker,
 * slot) and the worker (an Operator Master name) stands where the machine
 * stands elsewhere. Up to MAX_SLOTS entries per worker per date; their times
 * may overlap (the paper has MANJU 10:10–16:30 and 16:10–18:50 on one date).
 * `process` is stored on the entry itself, since there's no machine to find
 * it through (the Operator Planned Shift lock and the dashboard both need it).
 *
 * Inspection Start / End Time are machineOnTime / machineOffTime and Standard
 * Inspection Time per Piece is totalCycleSec, so the shared formulas
 * (client/src/utils/productionSheet.js, server/utils/oeeMetrics.js) apply
 * unchanged. TOTAL QTY (actualQty) and the three Types of Defects are typed;
 * the defects are kept as this sheet's own Rejection Master split
 * (rejectBreakdown over RAW_CASTING_DEFECTS — what the dashboard's Rejection
 * by Reason reads), Total Defects (rejectedQty) is their sum and OK QTY is
 * TOTAL − Total Defects, both worked out on save.
 *
 * Only the entered values are stored; every calculated column is derived on
 * display — see client/src/utils/rawCastingSheet.js.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };

// A date's entries per worker.
const MAX_SLOTS = 8;

// The sheet's Types of Defects, in its own order. Keep in step with
// RAW_CASTING_DEFECTS in client/src/utils/rawCastingSheet.js.
const RAW_CASTING_DEFECTS = ["Blow Holes Casting", "Crack/Damage Casting", "Other"];

// Idle Time on this sheet: Lunch / Tea / Washroom and Other only.
const IDLE_KEYS = ["lunchMin", "otherMin"];

const RawCastingEntrySchema = new mongoose.Schema(
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
    // Vendor / Vendor Name come with every sheet's common fields (entryCommon.js);
    // Challan No. is this sheet's own, free text as written on the paper.
    challanNo: { type: String, trim: true, maxlength: 40, default: "" },

    // Standard Inspection Time per Piece (sec) — prefilled from the Part,
    // this entry's own (editable) figure.
    totalCycleSec: { type: Number, min: [0, "Standard Inspection Time cannot be negative"] },

    // Inspection Start / End Time.
    machineOnTime: { type: String, match: HHMM },
    machineOffTime: { type: String, match: HHMM },

    // TOTAL QTY and the Types of Defects as the split over this sheet's own
    // defect names; Total Defects (rejectedQty) and OK QTY are set on save.
    ...rejectFieldsFor(RAW_CASTING_DEFECTS),
    okQty: { type: Number, min: [0, "OK Quantity cannot be negative"] },
    rejectedQty: { type: Number, min: [0, "Total Defects cannot be negative"] },

    otherActivity: { type: String, trim: true, maxlength: 200, default: "" },
    otherActivityMin: minutes,

    plannedOperatorShiftHours: { type: Number, min: [0, "Planned Operator Shift Time cannot be negative"], max: 24 },

    ...Object.fromEntries(IDLE_KEYS.map((k) => [k, minutes])),

    // Reason/Remarks for Rejection.
    remarks: { type: String, trim: true, maxlength: 500, default: "" },
    // Why "Other" idle time was used — required whenever that box has minutes.
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

RawCastingEntrySchema.index({ date: 1, worker: 1, slot: 1 }, { unique: true });
RawCastingEntrySchema.index({ process: 1, date: 1 });
RawCastingEntrySchema.index({ "review.status": 1 }, { sparse: true });

module.exports = mongoose.model("RawCastingEntry", RawCastingEntrySchema);
module.exports.WORKING_STATUSES = WORKING_STATUSES;
module.exports.NON_WORKING_STATUSES = NON_WORKING_STATUSES;
module.exports.RAW_CASTING_DEFECTS = RAW_CASTING_DEFECTS;
module.exports.IDLE_KEYS = IDLE_KEYS;
module.exports.MAX_SLOTS = MAX_SLOTS;
