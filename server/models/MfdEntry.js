const mongoose = require("mongoose");
const { entryCommonFields } = require("./entryCommon");
const { STOPPAGE_KEYS } = require("./ProductionEntry");

/**
 * models/MfdEntry.js
 * ────────────────────
 * One row of the MODULAR FRAME DRILLING sheet (sheet key "mfd"). A machine
 * sheet like INJECTION MOULDING — keyed by (date, machine, slot) — but with up
 * to MAX_SLOTS entries per machine per date, and entries of one machine MAY
 * overlap in time: the paper has 4/B 08:15–18:55 alongside 14:50–15:25, and
 * 4/A with two operators at once. Its columns, in the paper sheet's order:
 *
 *   Date | MC NO. | Operator | Working Status | Reasons For Not Working | Part
 *   Name | Drawing No. | Process | No. of Holes in One Piece | Stroke Required
 *   for One Piece | Total Cycle Time (Sec) | Machine Time ON / OFF | Setting
 *   Time ON / OFF | ACTUAL OK Quantity | Rejected Quantity | the ten downtime
 *   columns | REMARKS
 *
 * Drawing No., Process (`operation`), No. of Holes and Stroke Required are
 * copied from the Part when it is picked (read-only on the form, like SPM's
 * reference figures and RIVET / PRESS's Drawing No. and Process), so a later
 * change to the Part never rewrites a saved entry. Total Cycle Time is
 * prefilled from the Part and this entry's own (editable) figure, like
 * INJECTION MOULDING's Standard Time per Piece.
 *
 * Quantities are the CNC Production Master: Actual Quantity and OK typed,
 * Rejected = Actual − OK worked out on every save (utils/rejectSplit.js), never
 * taken from the client. There is no Rejection Master — the paper has only a
 * Rejected Quantity column and no reasons — so only the free-text REMARKS.
 *
 * Working Status / Reasons For Not Working are the Machine Working Status every
 * sheet carries (workingMode / machineStatus — entryCommon.js). Setting Time
 * ON / OFF are optional, informational times (CONTACT's pattern).
 *
 * Only the entered values are stored; every calculated column (IDEAL Quantity,
 * Effective Machine Run Time, Unreported Time, Efficiency, the three OEE
 * figures) is derived on display — see client/src/utils/mfdSheet.js.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };

// A date's entries per machine. Keep in step with MFD_MAX_SLOTS in client/src/utils/mfdSheet.js.
const MAX_SLOTS = 8;

const MfdEntrySchema = new mongoose.Schema(
  {
    // UTC midnight of the sheet date.
    date: { type: Date, required: [true, "Date is required"] },
    machine: { type: mongoose.Schema.Types.ObjectId, ref: "Machine", required: [true, "Machine is required"] },
    slot: { type: Number, required: true, min: 1, max: MAX_SLOTS },

    operator: { type: String, trim: true, maxlength: 60, default: "" },

    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", default: null },
    itemName: { type: String, trim: true, maxlength: 120, default: "" },
    // Copied from the Part when picked — see the file comment.
    drawingNo: { type: String, trim: true, maxlength: 40, default: "" },
    // The sheet's "Process" column (DRILLING, TAPPING, …) — the Part's own.
    operation: { type: String, trim: true, maxlength: 40, default: "" },
    noOfHoles: { type: Number, min: [0, "No. of Holes cannot be negative"] },
    strokeRequired: { type: Number, min: [0, "Stroke Required cannot be negative"] },

    // Total Cycle Time (Sec) — prefilled from the Part, editable here.
    totalCycleSec: { type: Number, min: [0, "Total Cycle Time cannot be negative"] },

    machineOnTime: { type: String, match: HHMM },
    machineOffTime: { type: String, match: HHMM },
    // Optional, informational only (no formula uses them).
    settingOnTime: { type: String, match: HHMM },
    settingOffTime: { type: String, match: HHMM },

    // Actual Quantity and ACTUAL OK Quantity are typed; Rejected = Actual − OK (derived on save).
    actualQty: { type: Number, min: [0, "Actual Quantity cannot be negative"] },
    okQty: { type: Number, min: [0, "OK Quantity cannot be negative"] },
    rejectedQty: { type: Number, min: [0, "Rejected Quantity cannot be negative"] },

    plannedOperatorShiftHours: { type: Number, min: [0, "Planned Operator Shift Time cannot be negative"], max: 24 },

    ...Object.fromEntries(STOPPAGE_KEYS.map((k) => [k, minutes])),

    // REMARKS.
    remarks: { type: String, trim: true, maxlength: 500, default: "" },
    // Why "Others" downtime was used — required whenever that box has minutes.
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

MfdEntrySchema.index({ date: 1, machine: 1, slot: 1 }, { unique: true });
MfdEntrySchema.index({ "review.status": 1 }, { sparse: true });

module.exports = mongoose.model("MfdEntry", MfdEntrySchema);
module.exports.MAX_SLOTS = MAX_SLOTS;
