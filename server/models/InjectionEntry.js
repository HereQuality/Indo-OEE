const mongoose = require("mongoose");
const { entryCommonFields } = require("./entryCommon");
const { STOPPAGE_KEYS } = require("./ProductionEntry");
const { WORKING_STATUSES, NON_WORKING_STATUSES } = require("./SpringEntry");

/**
 * models/InjectionEntry.js
 * ──────────────────────────
 * One row of the INJECTION MOULDING sheet. SPRING FOR PINS's twin — keyed by
 * (date, machine, slot), up to three per machine per date, only existing while
 * something is typed into it — over that paper sheet's own columns:
 *
 *   Date | MC No. | Item Name | Operator | Working Status | Reasons For Not
 *   Working | Machine ON / OFF Time | Standard Time per Piece (in Sec) |
 *   TOTAL QTY. | OK QTY. | the ten downtime columns | Reason/Remarks for
 *   Rejection/Rework
 *
 * Standard Time per Piece is stored as totalCycleSec — prefilled from the Part,
 * this entry's own (editable) figure. TOTAL QTY. is actualQty, OK QTY. okQty;
 * Rejected QTY is TOTAL − OK, worked out on every save (utils/rejectSplit.js),
 * never taken from the client. There is no Rejection Master: the sheet splits
 * no rejected pieces across reasons, only the free-text remarks.
 *
 * Working Status / Reasons For Not Working are the Machine Working Status every
 * sheet carries (workingMode / machineStatus — entryCommon.js).
 *
 * Only the entered values are stored; every calculated column (Ideal Quantity,
 * Effective Machine Run Time on TOTAL QTY., Unreported Time, the three OEE
 * figures) is derived on display — see client/src/utils/injectionSheet.js.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };

const InjectionEntrySchema = new mongoose.Schema(
  {
    // UTC midnight of the sheet date.
    date: { type: Date, required: [true, "Date is required"] },
    machine: { type: mongoose.Schema.Types.ObjectId, ref: "Machine", required: [true, "Machine is required"] },
    slot: { type: Number, required: true, min: 1, max: 3 },

    operator: { type: String, trim: true, maxlength: 60, default: "" },
    // Kept with SPRING FOR PINS's choices (ABSENT, SUNDAY, …): any but PRESENT
    // makes the entry status-only.
    workingStatus: { type: String, trim: true, maxlength: 40, default: "" },

    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", default: null },
    itemName: { type: String, trim: true, maxlength: 120, default: "" },
    // Copied from the Part when picked — the sheet has no column for it, but the
    // page's search looks through it.
    drawingNo: { type: String, trim: true, maxlength: 40, default: "" },

    // Standard Time per Piece (in Sec) — prefilled from the Part, editable here.
    totalCycleSec: { type: Number, min: [0, "Standard Time per Piece cannot be negative"] },

    machineOnTime: { type: String, match: HHMM },
    machineOffTime: { type: String, match: HHMM },

    // TOTAL QTY. and OK QTY. are typed; Rejected QTY = TOTAL − OK (derived on save).
    actualQty: { type: Number, min: [0, "Total Quantity cannot be negative"] },
    okQty: { type: Number, min: [0, "OK Quantity cannot be negative"] },
    rejectedQty: { type: Number, min: [0, "Rejected Quantity cannot be negative"] },

    plannedOperatorShiftHours: { type: Number, min: [0, "Planned Operator Shift Time cannot be negative"], max: 24 },

    ...Object.fromEntries(STOPPAGE_KEYS.map((k) => [k, minutes])),

    // Reason/Remarks for Rejection/Rework.
    remarks: { type: String, trim: true, maxlength: 500, default: "" },
    // Why "Other" downtime was used — required whenever that box has minutes.
    otherMinRemark: { type: String, trim: true, maxlength: 300, default: "" },

    ...entryCommonFields,

    updatedBy: { type: mongoose.Schema.Types.ObjectId, refPath: "updatedByModel" },
    updatedByModel: { type: String, enum: ["User", "Operator"] },

    // Super Admin's 24-hour override of the 2-working-day lock — see
    // ProductionEntry.unlockedUntil.
    unlockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

InjectionEntrySchema.index({ date: 1, machine: 1, slot: 1 }, { unique: true });
InjectionEntrySchema.index({ "review.status": 1 }, { sparse: true });

module.exports = mongoose.model("InjectionEntry", InjectionEntrySchema);
module.exports.WORKING_STATUSES = WORKING_STATUSES;
module.exports.NON_WORKING_STATUSES = NON_WORKING_STATUSES;
