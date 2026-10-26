const mongoose = require("mongoose");
const { entryCommonFields } = require("./entryCommon");
const { WORKING_STATUSES, NON_WORKING_STATUSES } = require("./SpringEntry");
const { rejectFieldsFor } = require("./rejectFields");

/**
 * models/FinalAssemblyEntry.js
 * ──────────────────────────────
 * One row of the FINAL ASSEMBLY sheet (sheet key "finalAssembly") — AFTER
 * POWDER COATING's shape (PowderCoatingEntry), kept as its own process and
 * collection. There is no machine: an entry is keyed by (date, worker, slot)
 * and the worker (an Operator Master name) stands where the machine stands
 * elsewhere. Up to MAX_SLOTS entries per worker per date (the paper has nine
 * for one worker on one date), and they MAY overlap in time — a worker runs
 * several assembly jobs at once (the paper has two 14:55–15:55 and three
 * 17:00–19:00 for one worker). `process` is stored on the entry itself.
 *
 * Start / End Time are stored as machineOnTime / machineOffTime and Standard
 * Time per Piece as totalCycleSec — OPTIONAL here: PACKING has none, and then
 * Ideal is blank, Effective Time 0 and Productivity 0%. TOTAL QTY (actualQty)
 * and the four Types of Defects (rejectBreakdown, over FA_DEFECT_REASONS) are
 * typed; Total Defects (rejectedQty) is their sum and OK QTY is TOTAL − Total
 * Defects, both worked out on save. Other Activity Carried out and its
 * minutes, and the two Idle boxes (Lunch / Tea / Washroom, Other), as on AFTER
 * POWDER COATING.
 *
 * Only the entered values are stored; every calculated column is derived on
 * display — see client/src/utils/finalAssemblySheet.js.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };

// A date's entries per worker — the paper has nine for one worker on one date.
const MAX_SLOTS = 12;

// The sheet's Types of Defects, in its order. Keep in step with
// FA_DEFECT_REASONS in client/src/utils/finalAssemblySheet.js.
const FA_DEFECT_REASONS = ["Wrong Assembly", "Broken Screw", "Wrong Clamping", "Other"];

// Idle Time on this sheet: Lunch / Tea / Washroom and Other only.
const FA_IDLE_KEYS = ["lunchMin", "otherMin"];

// What the server calls this sheet's fields in its messages and the audit log
// — the labels the paper's partial header didn't give, in assembly wording, in
// one place so they're easy to rename. Keep in step with FA_LABELS in
// client/src/utils/finalAssemblySheet.js.
const FA_LABELS = {
  worker: "Worker Name",
  itemName: "Item Name",
  totalCycleSec: "Standard Time per Piece (sec)",
  machineOnTime: "Assembly Start Time",
  machineOffTime: "Assembly End Time",
  shift: "Assembly Working Hours",
  actualQty: "Total QTY",
  okQty: "OK QTY",
  rejectedQty: "Total Defects",
  rejectBreakdown: "Types of Defects",
  rejectOtherRemark: "Remark (Other Defect)",
  otherActivity: "Other Activity Carried out",
  otherActivityMin: "Time consume in Other Activity (min)",
  lunchMin: "Lunch / Tea / Washroom etc (min)",
  otherMin: "Other Idle (min)",
  otherMinRemark: "Remark (Other Idle)",
  remarks: "Remarks",
};

const FinalAssemblyEntrySchema = new mongoose.Schema(
  {
    // UTC midnight of the sheet date.
    date: { type: Date, required: [true, "Date is required"] },
    worker: { type: mongoose.Schema.Types.ObjectId, ref: "MachineOperator", required: [true, "Worker is required"] },
    process: { type: mongoose.Schema.Types.ObjectId, ref: "Process", required: [true, "Process is required"] },
    slot: { type: Number, required: true, min: 1, max: MAX_SLOTS },

    // The worker's name as saved — what the shared Operator filters and charts read.
    operator: { type: String, trim: true, maxlength: 100, default: "" },
    workingStatus: { type: String, trim: true, maxlength: 40, default: "" },

    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", default: null },
    itemName: { type: String, trim: true, maxlength: 120, default: "" },

    // Standard Time per Piece (sec) — prefilled from the Part, this entry's own
    // (editable) figure. Optional: PACKING has none.
    totalCycleSec: { type: Number, min: [0, "Standard Time per Piece cannot be negative"] },

    // Assembly Start / End Time.
    machineOnTime: { type: String, match: HHMM },
    machineOffTime: { type: String, match: HHMM },

    // Total QTY and the Types of Defects split; Total Defects (rejectedQty) is
    // their sum and OK QTY what's left of Total — both set on save.
    ...rejectFieldsFor(FA_DEFECT_REASONS),
    rejectedQty: { type: Number, min: [0, "Total Defects cannot be negative"] },
    okQty: { type: Number, min: [0, "OK Quantity cannot be negative"] },

    otherActivity: { type: String, trim: true, maxlength: 200, default: "" },
    otherActivityMin: minutes,

    plannedOperatorShiftHours: { type: Number, min: [0, "Planned Operator Shift Time cannot be negative"], max: 24 },

    ...Object.fromEntries(FA_IDLE_KEYS.map((k) => [k, minutes])),

    // Remarks (the paper often names the helpers here).
    remarks: { type: String, trim: true, maxlength: 500, default: "" },
    // Why "Other" idle time was used — required whenever that box has minutes.
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

FinalAssemblyEntrySchema.index({ date: 1, worker: 1, slot: 1 }, { unique: true });
FinalAssemblyEntrySchema.index({ process: 1, date: 1 });
FinalAssemblyEntrySchema.index({ "review.status": 1 }, { sparse: true });

module.exports = mongoose.model("FinalAssemblyEntry", FinalAssemblyEntrySchema);
module.exports.WORKING_STATUSES = WORKING_STATUSES;
module.exports.NON_WORKING_STATUSES = NON_WORKING_STATUSES;
module.exports.FA_DEFECT_REASONS = FA_DEFECT_REASONS;
module.exports.FA_IDLE_KEYS = FA_IDLE_KEYS;
module.exports.FA_LABELS = FA_LABELS;
module.exports.MAX_SLOTS = MAX_SLOTS;
