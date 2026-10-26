const mongoose = require("mongoose");
const { entryCommonFields } = require("./entryCommon");
const { STOPPAGE_KEYS } = require("./ProductionEntry");
const { rejectFields } = require("./rejectFields");

/**
 * models/RivetEntry.js
 * ──────────────────────
 * One row of the RIVET Data Entry sheet. Same idea as ProductionEntry/VmcEntry/
 * SpmEntry — keyed by (date, machine, slot), up to three per machine per date,
 * and it only exists while something is typed into it — with RIVET's own
 * columns: four operation times (Loading, Process, Unloading and Cleaning,
 * Other Operations) that sum to Total Cycle Time, set once on the Part
 * (required there for a RIVET part) and copied onto the entry when picked —
 * same mechanism as SPM's own four operations (excludedOps lets an entry
 * tick one off, subtracting it from this entry's Total Cycle Time only) —
 * plus one reference figure (No. of Holes in One Piece) that's typed and
 * shown on the sheet but doesn't feed any formula yet — nobody has given us
 * the rule connecting it to Ideal Quantity, so it stays display-only until
 * that's confirmed against real data. Actual and OK Quantity are typed, Rejected is
 * Actual − OK and split across reject reasons (rejectFields.js), same as CNC.
 *
 * Only the entered values are stored. Every calculated column (Ideal Qty,
 * Effective Run Time, OEE, …) is derived on display — see
 * client/src/utils/rivetSheet.js, which feeds the same formulas the CNC sheet uses.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };
const seconds = { type: Number, min: [0, "Seconds cannot be negative"] };

// The sheet's own Process choices — which kind of work this entry's row is.
// Add to this list to offer a new one — nothing else needs changing. Keep in
// step with PROCESS_TYPES in client/src/Components/Production/RivetEntryForm.jsx.
const PROCESS_TYPES = ["Rivet", "Clamp"];

const RivetEntrySchema = new mongoose.Schema(
  {
    // UTC midnight of the sheet date.
    date: { type: Date, required: [true, "Date is required"] },
    machine: { type: mongoose.Schema.Types.ObjectId, ref: "Machine", required: [true, "Machine is required"] },
    slot: { type: Number, required: true, min: 1, max: 3 },

    operator: { type: String, trim: true, maxlength: 60, default: "" },

    // Which kind of work this row is — a required dropdown.
    processType: { type: String, trim: true, maxlength: 40, default: "" },

    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", default: null },
    itemName: { type: String, trim: true, maxlength: 120, default: "" },
    drawingNo: { type: String, trim: true, maxlength: 40, default: "" },

    // Reference figure only — not part of any formula yet.
    noOfHoles: { type: Number, min: [0, "No. of Holes cannot be negative"] },

    // Loading, Process, Unloading and Cleaning, Other Operations — copied from
    // the Part when picked (display only, like SPM's own four operations).
    rivetLoadingSec: seconds,
    rivetProcessSec: seconds,
    rivetUnloadingCleaningSec: seconds,
    rivetOtherOperationsSec: seconds,
    // The cycle time every formula actually uses, copied from the item's own
    // Total Cycle Time (the four operations' own sum there) — not derived from
    // the operations above, same reasoning as SpmEntry's own field.
    totalCycleSec: { type: Number, min: [0, "Total Cycle Time cannot be negative"] },
    // Which of the four operations above didn't apply on THIS entry — their
    // seconds are subtracted out of totalCycleSec for this entry only; the
    // item's own master values are never touched. Same mechanism as SpmEntry's
    // own excludedOps, just this sheet's own four keys.
    excludedOps: {
      type: [{ type: String, enum: ["rivetLoadingSec", "rivetProcessSec", "rivetUnloadingCleaningSec", "rivetOtherOperationsSec"] }],
      default: [],
    },

    machineOnTime: { type: String, match: HHMM },
    machineOffTime: { type: String, match: HHMM },

    ...rejectFields,
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

RivetEntrySchema.index({ date: 1, machine: 1, slot: 1 }, { unique: true });
RivetEntrySchema.index({ "review.status": 1 }, { sparse: true });

module.exports = mongoose.model("RivetEntry", RivetEntrySchema);
module.exports.PROCESS_TYPES = PROCESS_TYPES;
