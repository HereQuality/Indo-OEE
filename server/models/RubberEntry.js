const mongoose = require("mongoose");
const { entryCommonFields } = require("./entryCommon");
const { WORKING_STATUSES, NON_WORKING_STATUSES } = require("./SpringEntry");

/**
 * models/RubberEntry.js
 * ───────────────────────
 * One row of the RUBBER sheet. Like After Powder Coating it has no machine:
 * the work is done by a worker, so an entry is keyed by (date, worker, slot) —
 * up to three per worker per date — and the worker (an Operator Master name)
 * stands where the machine stands elsewhere. `process` is stored on the entry
 * itself, since there's no machine to find it through (the Operator Planned
 * Shift lock and the dashboard both need it).
 *
 * Its figures are the Spring sheet's: a typed Actual OK and Rejected Quantity
 * and the stoppage columns (minus the two machine breakdowns — B.D. Mech. /
 * B.D. Ele. — a worker has no machine to break down). Working Start / End
 * Time are stored as machineOnTime / machineOffTime and Total Cycle Time as
 * totalCycleSec, so the formulas every sheet shares
 * (client/src/utils/productionSheet.js, server/utils/oeeMetrics.js) apply
 * unchanged.
 *
 * Only the entered values are stored; every calculated column is derived on
 * display — see client/src/utils/rubberSheet.js.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };

// The sheet's stoppage columns, in its own order — keep in step with
// RUBBER_STOPPAGE_FIELDS in client/src/utils/rubberSheet.js.
const RUBBER_STOPPAGE_KEYS = [
  "plannedDownMin",
  "setupMin",
  "noManPowerMin",
  "materialShiftingMin",
  "noMaterialMin",
  "noPowerMin",
  "lunchMin",
  "otherMin",
];

const RubberEntrySchema = new mongoose.Schema(
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

    // Total Cycle Time (sec) — prefilled from the Part, this entry's own
    // (editable) figure.
    totalCycleSec: { type: Number, min: [0, "Total Cycle Time cannot be negative"] },

    // Working Start / End Time.
    machineOnTime: { type: String, match: HHMM },
    machineOffTime: { type: String, match: HHMM },

    okQty: { type: Number, min: [0, "OK Quantity cannot be negative"] },
    rejectedQty: { type: Number, min: [0, "Rejected Quantity cannot be negative"] },

    plannedOperatorShiftHours: { type: Number, min: [0, "Planned Operator Shift Time cannot be negative"], max: 24 },

    ...Object.fromEntries(RUBBER_STOPPAGE_KEYS.map((k) => [k, minutes])),

    remarks: { type: String, trim: true, maxlength: 500, default: "" },
    // Why "Others" stoppage was used — required whenever that box has minutes.
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

RubberEntrySchema.index({ date: 1, worker: 1, slot: 1 }, { unique: true });
RubberEntrySchema.index({ process: 1, date: 1 });
RubberEntrySchema.index({ "review.status": 1 }, { sparse: true });

module.exports = mongoose.model("RubberEntry", RubberEntrySchema);
module.exports.WORKING_STATUSES = WORKING_STATUSES;
module.exports.NON_WORKING_STATUSES = NON_WORKING_STATUSES;
module.exports.RUBBER_STOPPAGE_KEYS = RUBBER_STOPPAGE_KEYS;
