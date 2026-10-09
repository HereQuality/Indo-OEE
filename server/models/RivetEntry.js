const mongoose = require("mongoose");
const { STOPPAGE_KEYS } = require("./ProductionEntry");

/**
 * models/RivetEntry.js
 * ──────────────────────
 * One row of the RIVET Data Entry sheet. Same idea as ProductionEntry/VmcEntry/
 * SpmEntry — keyed by (date, machine, slot), up to three per machine per date,
 * and it only exists while something is typed into it — with RIVET's own
 * columns: Total Cycle Time (sec) is typed directly on the entry (checked
 * against two real rows: Loading/Process/Unloading and Cleaning/Other
 * Operations were blank on both, so RIVET doesn't build its cycle time up
 * from those the way SPM does — it's just one typed number, same as CNC's own
 * totalCycleSec), plus one reference figure (No. of Holes in One Piece)
 * that's typed and shown on the sheet but doesn't feed any formula yet —
 * nobody has given us the rule connecting it to Ideal Quantity, so it stays
 * display-only until that's confirmed against real data. A typed Rejected
 * Quantity, same as VMC/SPM (no reject reason split).
 *
 * Only the entered values are stored. Every calculated column (Ideal Qty,
 * Effective Run Time, OEE, …) is derived on display — see
 * client/src/utils/rivetSheet.js, which feeds the same formulas the CNC sheet uses.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };

const RivetEntrySchema = new mongoose.Schema(
  {
    // UTC midnight of the sheet date.
    date: { type: Date, required: [true, "Date is required"] },
    machine: { type: mongoose.Schema.Types.ObjectId, ref: "Machine", required: [true, "Machine is required"] },
    slot: { type: Number, required: true, min: 1, max: 3 },

    operator: { type: String, trim: true, maxlength: 60, default: "" },

    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", default: null },
    itemName: { type: String, trim: true, maxlength: 120, default: "" },
    drawingNo: { type: String, trim: true, maxlength: 40, default: "" },

    // Reference figure only — not part of any formula yet.
    noOfHoles: { type: Number, min: [0, "No. of Holes cannot be negative"] },

    totalCycleSec: { type: Number, min: [0, "Total Cycle Time cannot be negative"] },

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

RivetEntrySchema.index({ date: 1, machine: 1, slot: 1 }, { unique: true });

module.exports = mongoose.model("RivetEntry", RivetEntrySchema);
