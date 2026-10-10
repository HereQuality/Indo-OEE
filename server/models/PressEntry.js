const mongoose = require("mongoose");
const { STOPPAGE_KEYS } = require("./ProductionEntry");

/**
 * models/PressEntry.js
 * ──────────────────────
 * One row of the PRESS Data Entry sheet (Indo "Process 3/10" sheet). Same idea
 * as VmcEntry — keyed by (date, machine, slot), up to three per machine per
 * date, and it only exists while something is typed into it — but with the
 * PRESS sheet's own columns: a Standard Time Taken and the number of pieces
 * made in that standard time (which together give the Product Cycle Time, the
 * same shape as VMC's Program Time/No. of Piece In One Program), plus
 * dropdown Operation and Setup No. fields.
 *
 * Only the entered values are stored. Every calculated column (Product Cycle
 * Time, Ideal Qty, Effective Run Time, OEE, …) is derived on display — see
 * client/src/utils/pressSheet.js, which feeds the same formulas the CNC/VMC
 * sheets use.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };

// The sheet's own Operation choices. Add to this list to offer a new one —
// nothing else needs changing. Keep in step with OPERATIONS in
// client/src/Components/Production/PressEntryForm.jsx.
const OPERATIONS = ["Bending", "Tapping", "Blank", "Blank/Bending"];
// The sheet's own Setup No. choices. Keep in step with SETUP_NUMBERS in
// client/src/Components/Production/PressEntryForm.jsx.
const SETUP_NUMBERS = ["1", "2", "3", "4", "5"];

const PressEntrySchema = new mongoose.Schema(
  {
    // UTC midnight of the sheet date.
    date: { type: Date, required: [true, "Date is required"] },
    machine: { type: mongoose.Schema.Types.ObjectId, ref: "Machine", required: [true, "Machine is required"] },
    slot: { type: Number, required: true, min: 1, max: 3 },

    operator: { type: String, trim: true, maxlength: 60, default: "" },

    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", default: null },
    itemName: { type: String, trim: true, maxlength: 120, default: "" },
    // The sheet's own "Operation" column — a short note of what was done
    // (e.g. "Piercing", "Blanking"), not tied to any formula.
    operation: { type: String, trim: true, maxlength: 120, default: "" },
    drawingNo: { type: String, trim: true, maxlength: 40, default: "" },
    setupNo: { type: String, trim: true, maxlength: 40, default: "" },

    // Product Cycle Time (sec) = (standardTimeMin ÷ pcsPerStandardTime) × 60.
    standardTimeMin: { type: Number, min: [0, "Standard Time Taken cannot be negative"] },
    pcsPerStandardTime: { type: Number, min: [1, "At least 1 piece in Standard Time"] },

    machineOnTime: { type: String, match: HHMM },
    machineOffTime: { type: String, match: HHMM },

    okQty: { type: Number, min: [0, "OK Quantity cannot be negative"] },
    rejectedQty: { type: Number, min: [0, "Rejected Quantity cannot be negative"] },

    plannedOperatorShiftHours: { type: Number, min: [0, "Planned Operator Shift Time cannot be negative"], max: 24 },

    ...Object.fromEntries(STOPPAGE_KEYS.map((k) => [k, minutes])),

    remarks: { type: String, trim: true, maxlength: 500, default: "" },
    // Why "Others" downtime was used — required whenever that box has minutes.
    otherMinRemark: { type: String, trim: true, maxlength: 300, default: "" },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, refPath: "updatedByModel" },
    updatedByModel: { type: String, enum: ["User", "Operator"] },

    // Super Admin's 24-hour override of the 2-working-day lock — see
    // ProductionEntry.unlockedUntil.
    unlockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

PressEntrySchema.index({ date: 1, machine: 1, slot: 1 }, { unique: true });

module.exports = mongoose.model("PressEntry", PressEntrySchema);
module.exports.OPERATIONS = OPERATIONS;
module.exports.SETUP_NUMBERS = SETUP_NUMBERS;
