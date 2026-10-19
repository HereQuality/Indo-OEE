const mongoose = require("mongoose");
const { entryCommonFields } = require("./entryCommon");
const { WORKING_STATUSES, NON_WORKING_STATUSES } = require("./SpringEntry");

/**
 * models/PowderCoatingEntry.js
 * ──────────────────────────────
 * One row of the After Powder Coating inspection sheet. Unlike every other
 * sheet it has no machine: an inspection is done by a worker, so an entry is
 * keyed by (date, worker, slot) — up to three per worker per date — and the
 * worker (an Operator Master name) stands where the machine stands elsewhere.
 * `process` is stored on the entry itself, since there's no machine to find
 * it through (the Operator Planned Shift lock and the dashboard both need it).
 *
 * Inspection Start / End Time are stored as machineOnTime / machineOffTime and
 * Standard Inspection Time per Piece as totalCycleSec, so the formulas every
 * sheet shares (client/src/utils/productionSheet.js, server/utils/oeeMetrics.js)
 * apply unchanged. TOTAL QTY (actualQty) and the four defect / rework counts
 * are typed, as on the sheet; Total Defect / Rework (rejectedQty) is their sum
 * and OK Qty is Total − Total Defect, both worked out on save — the same
 * Actual / OK / Rejected the CNC sheet's formulas read.
 *
 * Only the entered values are stored; every calculated column is derived on
 * display — see client/src/utils/powderCoatingSheet.js.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };
const count = (label) => ({ type: Number, min: [0, `${label} cannot be negative`] });

// The sheet's Types of defect / rework, in its own order — keep in step with
// DEFECT_FIELDS in client/src/utils/powderCoatingSheet.js.
const DEFECT_KEYS = ["lessCoatingQty", "dotsQty", "missCoatingQty", "otherDefectQty"];
// Idle Time on this sheet: Lunch / Tea / Washroom and Other only.
const IDLE_KEYS = ["lunchMin", "otherMin"];

const PowderCoatingEntrySchema = new mongoose.Schema(
  {
    // UTC midnight of the sheet date.
    date: { type: Date, required: [true, "Date is required"] },
    worker: { type: mongoose.Schema.Types.ObjectId, ref: "MachineOperator", required: [true, "Worker is required"] },
    process: { type: mongoose.Schema.Types.ObjectId, ref: "Process", required: [true, "Process is required"] },
    slot: { type: Number, required: true, min: 1, max: 3 },

    // The worker's name as saved — what the shared Operator filters and charts read.
    operator: { type: String, trim: true, maxlength: 100, default: "" },
    workingStatus: { type: String, trim: true, maxlength: 40, default: "" },

    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", default: null },
    itemName: { type: String, trim: true, maxlength: 120, default: "" },
    // Vendor / Vendor Name come with every sheet's common fields (entryCommon.js).

    // Standard Inspection Time per Piece (sec) — prefilled from the Part,
    // this entry's own (editable) figure.
    totalCycleSec: { type: Number, min: [0, "Standard Inspection Time cannot be negative"] },

    // Inspection Start / End Time.
    machineOnTime: { type: String, match: HHMM },
    machineOffTime: { type: String, match: HHMM },

    // TOTAL QTY — every piece inspected.
    actualQty: count("Total Qty"),
    ...Object.fromEntries(DEFECT_KEYS.map((k) => [k, count("Defect / Rework")])),
    // Total Defect / Rework — the sum of the four above — and OK Qty, what's
    // left of Total; both set on save.
    rejectedQty: count("Total Defect / Rework"),
    okQty: count("OK Quantity"),

    otherActivity: { type: String, trim: true, maxlength: 200, default: "" },
    otherActivityMin: minutes,

    plannedOperatorShiftHours: { type: Number, min: [0, "Planned Operator Shift Time cannot be negative"], max: 24 },

    ...Object.fromEntries(IDLE_KEYS.map((k) => [k, minutes])),

    remarks: { type: String, trim: true, maxlength: 500, default: "" },
    // Why "Other" idle time was used — required whenever that box has minutes.
    otherMinRemark: { type: String, trim: true, maxlength: 300, default: "" },

    // Working Status (Working / Non Working + reasons), the server-worked
    // Availability / Performance / Quality, and Admin review state — shared by
    // every sheet (entryCommon.js).
    ...entryCommonFields,

    updatedBy: { type: mongoose.Schema.Types.ObjectId, refPath: "updatedByModel" },
    updatedByModel: { type: String, enum: ["User", "Operator"] },

    // Super Admin's 24-hour override of the 2-working-day lock — see
    // ProductionEntry.unlockedUntil.
    unlockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

PowderCoatingEntrySchema.index({ date: 1, worker: 1, slot: 1 }, { unique: true });
PowderCoatingEntrySchema.index({ process: 1, date: 1 });
PowderCoatingEntrySchema.index({ "review.status": 1 }, { sparse: true });

module.exports = mongoose.model("PowderCoatingEntry", PowderCoatingEntrySchema);
module.exports.WORKING_STATUSES = WORKING_STATUSES;
module.exports.NON_WORKING_STATUSES = NON_WORKING_STATUSES;
module.exports.DEFECT_KEYS = DEFECT_KEYS;
module.exports.IDLE_KEYS = IDLE_KEYS;
