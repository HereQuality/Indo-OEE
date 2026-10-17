const mongoose = require("mongoose");
const { entryCommonFields } = require("./entryCommon");
const { STOPPAGE_KEYS } = require("./ProductionEntry");

/**
 * models/TrobeEntry.js
 * ─────────────────────────
 * One row of the Trobe Data Entry sheet. Same idea as ProductionEntry/VmcEntry/
 * SpmEntry/RivetEntry — keyed by (date, machine, slot), up to three per machine
 * per date, only existing while something is typed into it — with the plain CNC
 * column set (Working Status, Setting ON/OFF Time included) but no named
 * operation breakdown: Total Cycle Time is prefilled from the Part (required
 * there for a Trobe part) and editable per entry — no excludedOps, since
 * there's nothing to tick off. A typed Actual OK and Rejected Quantity, same
 * as VMC/SPM/RIVET (no reject reason split). An entry whose Working Status is
 * anything but PRESENT is status-only: just Date, Machine, Working Status and
 * optionally Operator/Remarks.
 *
 * Only the entered values are stored. Every calculated column (Ideal Qty,
 * Effective Run Time, OEE, …) is derived on display — see
 * client/src/utils/trobeSheet.js, which feeds the same formulas the CNC
 * sheet uses, unchanged.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };

// Working Status choices — keep in step with WORKING_STATUSES in
// client/src/utils/productionSheet.js. Every one but PRESENT is a day the
// machine didn't produce: such an entry is status-only (no part, times or
// quantities — see trobeSheet.controller.js's saveRow).
const WORKING_STATUSES = [
  "PRESENT",
  "ABSENT",
  "LEAVE",
  "M/C OFF",
  "M/C STOP",
  "UNDER MAINT.",
  "SUNDAY",
  "W/OFF",
  "HOLIDAY",
  "STOCK COUNTING",
  "REPORT NOT FILLUP",
];
const NON_WORKING_STATUSES = WORKING_STATUSES.filter((s) => s !== "PRESENT");

const TrobeEntrySchema = new mongoose.Schema(
  {
    // UTC midnight of the sheet date.
    date: { type: Date, required: [true, "Date is required"] },
    machine: { type: mongoose.Schema.Types.ObjectId, ref: "Machine", required: [true, "Machine is required"] },
    slot: { type: Number, required: true, min: 1, max: 3 },

    operator: { type: String, trim: true, maxlength: 60, default: "" },
    workingStatus: { type: String, trim: true, maxlength: 40, default: "" },

    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", default: null },
    itemName: { type: String, trim: true, maxlength: 120, default: "" },
    drawingNo: { type: String, trim: true, maxlength: 40, default: "" },

    // The cycle time every formula uses — prefilled from the item's own Total
    // Cycle Time when picked, but this entry's own figure: the same part
    // really does run at a different cycle on different days, so it can be
    // changed here without touching the Part.
    totalCycleSec: { type: Number, min: [0, "Total Cycle Time cannot be negative"] },

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

    // Machine Working Status, the server-worked Availability / Performance /
    // Quality, and Admin review state — shared by every sheet (entryCommon.js).
    ...entryCommonFields,

    updatedBy: { type: mongoose.Schema.Types.ObjectId, refPath: "updatedByModel" },
    updatedByModel: { type: String, enum: ["User", "Operator"] },

    // Super Admin's 24-hour override of the 2-working-day lock — see
    // ProductionEntry.unlockedUntil.
    unlockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

TrobeEntrySchema.index({ date: 1, machine: 1, slot: 1 }, { unique: true });
TrobeEntrySchema.index({ "review.status": 1 }, { sparse: true });

module.exports = mongoose.model("TrobeEntry", TrobeEntrySchema);
module.exports.WORKING_STATUSES = WORKING_STATUSES;
module.exports.NON_WORKING_STATUSES = NON_WORKING_STATUSES;
