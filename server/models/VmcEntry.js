const mongoose = require("mongoose");
const { STOPPAGE_KEYS } = require("./ProductionEntry");

/**
 * models/VmcEntry.js
 * ────────────────────
 * One row of the VMC Data Entry sheet (Indo "Section Wise Eff. — VMC"). Same
 * idea as ProductionEntry — keyed by (date, machine, slot), up to three per
 * machine per date, and it only exists while something is typed into it — but
 * with the VMC sheet's own columns: a Program Time and the number of pieces one
 * program makes (which together give the Product Cycle Time), Setup No., a
 * Setting Time ON/OFF, a typed Rejected Quantity, and a "Machine not run"
 * reason. There is no per-operation cycle breakdown and no reject-reason split.
 *
 * Only the entered values are stored. Every calculated column (Product Cycle
 * Time, Ideal Qty, Effective Run Time, OEE, …) is derived on display — see
 * client/src/utils/vmcSheet.js, which feeds the same formulas the CNC sheet uses.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };

// Why the machine did not run, when it did not. Add to this list to offer a new
// reason — nothing else needs changing. Keep in step with MACHINE_NOT_RUN in
// client/src/utils/vmcSheet.js.
const MACHINE_NOT_RUN = ["M/C OFF", "ABSENT", "SUNDAY", "HOLIDAY", "STOCK COUNTING", "REPORT NOT FILLUP"];

const VmcEntrySchema = new mongoose.Schema(
  {
    // UTC midnight of the sheet date.
    date: { type: Date, required: [true, "Date is required"] },
    machine: { type: mongoose.Schema.Types.ObjectId, ref: "Machine", required: [true, "Machine is required"] },
    slot: { type: Number, required: true, min: 1, max: 3 },

    operator: { type: String, trim: true, maxlength: 60, default: "" },
    machineNotRun: { type: String, trim: true, maxlength: 40, default: "" },

    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", default: null },
    itemName: { type: String, trim: true, maxlength: 120, default: "" },
    drawingNo: { type: String, trim: true, maxlength: 40, default: "" },
    setupNo: { type: String, trim: true, maxlength: 40, default: "" },

    // Product Cycle Time (sec) = programTimeMin × 60 ÷ pcsPerProgram.
    programTimeMin: { type: Number, min: [0, "Program Time cannot be negative"] },
    pcsPerProgram: { type: Number, min: [1, "At least 1 piece per program"] },

    machineOnTime: { type: String, match: HHMM },
    machineOffTime: { type: String, match: HHMM },
    settingOnTime: { type: String, match: HHMM },
    settingOffTime: { type: String, match: HHMM },

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

VmcEntrySchema.index({ date: 1, machine: 1, slot: 1 }, { unique: true });

module.exports = mongoose.model("VmcEntry", VmcEntrySchema);
module.exports.MACHINE_NOT_RUN = MACHINE_NOT_RUN;
