const mongoose = require("mongoose");

/**
 * Production Data Entry — Glass Grinding
 *
 * Required fields:
 *   machine, date, mcStartTime, mcOffTime,
 *   sizeWidthMm, sizeHeightMm, thicknessMm,
 *   processQty, okQty, rejectedQty, standardTimePerPieceMin
 *
 * Overtime is not entered manually — it (along with Start Delay / Early
 * Closed) is derived server-side from `shiftOnTime`/`shiftOffTime` vs.
 * mcStartTime/mcOffTime. See productionCalculation.service.js.
 * `shiftOnTime`/`shiftOffTime` are a SNAPSHOT of the entry's Machine's own
 * Shift Time Start/End (machineOnTime/machineOffTime, set in Machine
 * Master) taken when the Machine was selected on this entry's form — not
 * re-derived from the machine's current config on every save. This is
 * deliberate: if the machine's Shift Time is later changed in Machine
 * Master (e.g. switched from Day to Night shift), already-saved entries
 * must keep calculating against the window they actually ran under, even
 * when later edited for an unrelated field (e.g. fixing OK Qty) — each
 * entry works off its own snapshot, independently of the others.
 * `lunchStartTime` is the same kind of snapshot, taken from the Machine's
 * optional Lunch Break config (also set in Machine Master) — when this
 * entry's own M/C time fully covers that 1-hour window, it's added to
 * Total Stoppage as `calculated.lunchMin` (see
 * productionCalculation.service.js's computeLunchMin).
 *
 * Optional stoppage / downtime fields (default 0, max 1440 min):
 *   plannedDowntimeMin, overtimeMin (auto-derived, see above),
 *   noManpowerMin, mechanicalBreakdownMin, electricalBreakdownMin,
 *   rawMaterialNotAvailableMin, humanErrorStoppageMin, changeoverMin,
 *   rawMaterialProblemMin, noPowerMin, othersMin
 *
 * `calculated` is computed server-side at save time and stored, so
 * historical rows never change if formulas are tweaked later.
 */
const ProductionEntrySchema = new mongoose.Schema(
  {
    machine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Machine",
      required: [true, "M/C Name is required"],
    },
    operator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MachineOperator",
    },
    date: {
      type: Date,
      required: [true, "Date is required"],
      default: Date.now,
    },
    mcStartTime: {
      type: String, // "HH:mm"
      required: [true, "M/C Start Time is required"],
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "M/C Start Time must be HH:mm"],
    },
    mcOffTime: {
      type: String, // "HH:mm"
      required: [true, "M/C Off Time is required"],
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "M/C Off Time must be HH:mm"],
    },
    // Extra M/C ON/OFF periods for THIS SAME entry, beyond the primary
    // mcStartTime/mcOffTime pair above — e.g. the machine ran, paused, then
    // resumed, but it's still one production/downtime record (added
    // 2026-09-06). Order doesn't matter; productionCalculation.service.js
    // sorts all of a row's periods chronologically before use. Any gap
    // between periods of the SAME row flows into that row's own Unreported
    // Time exactly like a gap between two different rows already does.
    additionalPeriods: {
      type: [
        {
          _id: false,
          startTime: {
            type: String, // "HH:mm"
            required: [true, "Additional period Start Time is required"],
            match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Additional period Start Time must be HH:mm"],
          },
          endTime: {
            type: String, // "HH:mm"
            required: [true, "Additional period Off Time is required"],
            match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Additional period Off Time must be HH:mm"],
          },
        },
      ],
      default: [],
    },
    // Snapshot of the Machine's Shift Time Start/End at save time — see the
    // file-level comment above for why this isn't re-derived on every save.
    shiftOnTime: {
      type: String, // "HH:mm"
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Shift On Time must be HH:mm"],
    },
    shiftOffTime: {
      type: String, // "HH:mm"
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Shift Off Time must be HH:mm"],
    },
    // Snapshot of the Machine's optional Lunch Break start time (1-hour
    // slot) at save time — same reasoning as shiftOnTime/shiftOffTime above.
    // Blank when the machine has no lunch break configured.
    lunchStartTime: {
      type: String, // "HH:mm"
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Lunch Start Time must be HH:mm"],
    },

    // ── Size & thickness (from StandardTime master) ──────────────────────
    sizeWidthMm: {
      type: Number,
      required: [true, "Size width is required"],
      min: [0.1, "Width must be > 0"],
    },
    sizeHeightMm: {
      type: Number,
      required: [true, "Size height is required"],
      min: [0.1, "Height must be > 0"],
    },
    thicknessMm: {
      type: String,
      required: [true, "Thickness is required"],
      trim: true,
    },

    // ── Output quantities ─────────────────────
    processQty: {
      type: Number,
      required: [true, "Number of Production Qty is required"],
      min: [1, "Production Qty must be at least 1"],
    },
    okQty: {
      type: Number,
      required: [true, "Number of OK Qty is required"],
      min: [0, "OK Qty cannot be negative"],
    },
    rejectedQty: {
      type: Number,
      required: [true, "Number of Rejected Qty is required"],
      min: [0, "Rejected Qty cannot be negative"],
    },

    // ── Rejection reason breakdown — rejectedQty above is never set
    // directly by the client, it's derived server-side as the sum of these
    // (see buildData() in the controller). Mirrors the Downtime & Stoppage
    // Reasons fields' pattern below. ─────────────────────────────────────
    rejScratchesQty:        { type: Number, default: 0, min: 0 },
    rejChippingQty:         { type: Number, default: 0, min: 0 },
    rejCornerBreakageQty:   { type: Number, default: 0, min: 0 },
    rejSizeMismatchQty:     { type: Number, default: 0, min: 0 },
    rejHandlingBreakageQty: { type: Number, default: 0, min: 0 }, // includes "Others"

    // ── Standard time (auto-fetched from StandardTime master) ────────────
    standardTimePerPieceMin: {
      type: Number,
      required: [true, "Standard Time per piece is required"],
      min: [0.01, "Standard Time must be > 0"],
    },

    // ── Optional downtime / stoppage fields (minutes) ────────────────────
    plannedDowntimeMin:         { type: Number, default: 0, min: 0, max: 1440 },
    overtimeMin:                { type: Number, default: 0, min: 0, max: 1440 },
    noManpowerMin:              { type: Number, default: 0, min: 0, max: 1440 },
    mechanicalBreakdownMin:     { type: Number, default: 0, min: 0, max: 1440 },
    electricalBreakdownMin:     { type: Number, default: 0, min: 0, max: 1440 },
    rawMaterialNotAvailableMin: { type: Number, default: 0, min: 0, max: 1440 },
    humanErrorStoppageMin:      { type: Number, default: 0, min: 0, max: 1440 },
    changeoverMin:              { type: Number, default: 0, min: 0, max: 1440 },
    rawMaterialProblemMin:      { type: Number, default: 0, min: 0, max: 1440 },
    noPowerMin:                 { type: Number, default: 0, min: 0, max: 1440 },
    othersMin:                  { type: Number, default: 0, min: 0, max: 1440 },
    othersRemark: {
      type: String,
      trim: true,
      maxlength: [300, "Remark cannot exceed 300 characters"],
      default: "",
    },

    // ── Server-calculated OEE fields (never set from client) ─────────────
    calculated: {
      shiftDurationMin:      { type: Number, default: 0 },
      lunchMin:              { type: Number, default: 0 },
      totalStoppageMin:      { type: Number, default: 0 },
      workingScheduleMin:    { type: Number, default: 0 },
      availableWorkingMin:   { type: Number, default: 0 },
      idealProductionQty:    { type: Number, default: 0 },
      effectiveMcRunTimeMin: { type: Number, default: 0 },
      unreportedTimeMin:     { type: Number, default: 0 },
      availabilityRatio:     { type: Number, default: 0 },
      performanceRatio:      { type: Number, default: 0 },
      qualityRatio:          { type: Number, default: 0 },
      oeePercent:            { type: Number, default: 0 },
      overtimeMin:           { type: Number, default: 0 },
      startDelayMin:         { type: Number, default: 0 },
      earlyClosedMin:        { type: Number, default: 0 },
    },

    // Links entries saved together from one "Add Entry" submission with
    // multiple rows (Process/M-C Name/Date/Operator shared, each row its own
    // timing/size/qty/downtime) — undefined for entries saved singly. Purely
    // a display grouping key for the sheet; never used in calculations.
    batchId: {
      type: String,
      index: true,
    },

    // ── Form Builder (see models/FormDefinition.js) ──────────────────────
    // Values for admin-added, non-core fields, keyed by FormField.key. Kept
    // as a Map rather than real columns so adding a field never needs a
    // schema migration — and kept SEPARATE from the typed columns above so
    // the OEE engine keeps computing off fields it can rely on existing.
    extraValues: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    // Sum of every extraValues entry whose FormField has isStoppageReason.
    // Derived server-side (never trusted from the client), exactly like
    // rejectedQty. This is one of productionCalculation.service.js's
    // STOPPAGE_KEYS, which is how a custom downtime reason reaches Total
    // Stoppage without the calc service needing to read the database.
    customStoppageMin: {
      type: Number,
      default: 0,
      min: 0,
      max: 1440,
    },
    // Which FormDefinition version this row was saved under, so a later
    // relabel/reorder doesn't make historical rows ambiguous.
    formVersion: {
      type: Number,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "createdByModel",
    },
    createdByModel: {
      type: String,
      enum: ["User", "Operator"],
    },
  },
  { timestamps: true },
);

// Cross-field validation
ProductionEntrySchema.pre("validate", function (next) {
  if (this.okQty != null && this.rejectedQty != null && this.processQty != null) {
    if (this.okQty + this.rejectedQty > this.processQty) {
      return next(new Error("OK Qty + Rejected Qty cannot exceed Production Qty"));
    }
  }
  next();
});

module.exports = mongoose.model("ProductionEntry", ProductionEntrySchema);
