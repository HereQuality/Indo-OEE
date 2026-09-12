const mongoose = require("mongoose");
const { MAX_CYCLE_OPS } = require("./Item");

/**
 * models/ProductionEntry.js
 * ────────────────────────────
 * One row of the Production Data Entry sheet (Indo "Section Wise Eff." CNC
 * sheet). The sheet shows three rows per machine per date; a row is keyed
 * by (date, machine, slot) and only exists once something has been typed
 * into it — clearing every field deletes it again.
 *
 * Only the entered values are stored. Every calculated column (Ideal Qty,
 * Effective Run Time, OEE, …) is derived from them on display — see
 * client/src/utils/productionSheet.js.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };

// Stoppage columns, in sheet order. Exported so the controller whitelists
// exactly these.
const STOPPAGE_KEYS = [
  "plannedDownMin",
  "setupMin",
  "noManPowerMin",
  "materialShiftingMin",
  "noMaterialMin",
  "bdMechMin",
  "bdEleMin",
  "noPowerMin",
  "lunchMin",
  "otherMin",
];

// Reject reasons offered in the entry form and grouped on the dashboard.
// Add to this list to offer a new reason — nothing else needs changing.
const REJECT_REASONS = [
  "Dimension Out",
  "Tool Mark",
  "Surface Finish",
  "Porosity / Blow Hole",
  "Material Defect",
  "Setting Mistake",
  "Operator Mistake",
  "Machine Fault",
  "Other",
];

const ProductionEntrySchema = new mongoose.Schema(
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
    setupNo: { type: String, trim: true, maxlength: 40, default: "" },
    // Op 1…Op 5 seconds; null keeps a blank cell blank.
    cycleOpsSec: {
      type: [{ type: Number, min: [0, "Cycle time cannot be negative"] }],
      default: [],
      validate: {
        validator: (v) => v.length <= MAX_CYCLE_OPS,
        message: `At most ${MAX_CYCLE_OPS} cycle time operations are allowed`,
      },
    },

    machineOnTime: { type: String, match: HHMM },
    machineOffTime: { type: String, match: HHMM },
    settingOnTime: { type: String, match: HHMM },
    settingOffTime: { type: String, match: HHMM },

    // Actual and OK are entered; Rejected is derived (Actual − OK) by the
    // controller on every save, so the three can never drift apart.
    actualQty: { type: Number, min: [0, "Actual Quantity cannot be negative"] },
    okQty: { type: Number, min: [0, "OK Quantity cannot be negative"] },
    rejectedQty: { type: Number, min: [0, "Rejected Quantity cannot be negative"] },
    // Why the rejected pieces were rejected — one of REJECT_REASONS, or ""
    // when nothing was rejected. Drives the Dashboard's reason breakdown.
    rejectReason: { type: String, trim: true, maxlength: 60, default: "" },
    plannedOperatorShiftHours: { type: Number, min: [0, "Planned Operator Shift Time cannot be negative"], max: 24 },

    ...Object.fromEntries(STOPPAGE_KEYS.map((k) => [k, minutes])),

    remarks: { type: String, trim: true, maxlength: 500, default: "" },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, refPath: "updatedByModel" },
    updatedByModel: { type: String, enum: ["User", "Operator"] },
  },
  { timestamps: true },
);

ProductionEntrySchema.index({ date: 1, machine: 1, slot: 1 }, { unique: true });

module.exports = mongoose.model("ProductionEntry", ProductionEntrySchema);
module.exports.STOPPAGE_KEYS = STOPPAGE_KEYS;
module.exports.REJECT_REASONS = REJECT_REASONS;
