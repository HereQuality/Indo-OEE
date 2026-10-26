const mongoose = require("mongoose");
const { entryCommonFields } = require("./entryCommon");
const { STOPPAGE_KEYS } = require("./ProductionEntry");
const { WORKING_STATUSES, NON_WORKING_STATUSES } = require("./SpringEntry");

/**
 * models/PrintingEntry.js
 * ─────────────────────────
 * One row of the PRINTING sheet. Like RUBBER / AFTER POWDER COATING it is kept
 * per OPERATOR: an entry is keyed by (date, worker, slot) and the operator (an
 * Operator Master name) stands where the machine stands elsewhere. `process` is
 * stored on the entry itself (the Operator Planned Shift lock and the dashboard
 * both need it). The machine the job ran on — the sheet's MC No. — is optional
 * here (`mcMachine`, with its name as saved in `mcName`); it is NOT the row key,
 * and deliberately not called `machine`, which every shared helper reads as the
 * row key (utils/entryAudit.js keyOf, the dashboard feed).
 *
 * One operator may run two jobs at overlapping times (the real sheet has the same
 * operator 10:30–16:00 twice on one date), so entries of one operator on a date
 * are never checked for overlap, and up to MAX_SLOTS of them are allowed.
 *
 * Its figures are the SPRING FOR PINS sheet's: Standard Time per Piece
 * (totalCycleSec, prefilled from the Part), a typed TOTAL QTY (actualQty) and
 * OK QTY (Rejected = TOTAL − OK, derived on save) — no Rejection Master, only
 * the free-text "Reason/Remarks for Rejection/Rework" (remarks) — and Effective
 * Machine Run Time on TOTAL QTY. Its downtime is the ten shared columns plus
 * three of its own (PRINTING_EXTRA_STOPPAGE_KEYS), all of which count in Total
 * Idle Time, Operating Time and the stoppage limit.
 *
 * Only the entered values are stored; every calculated column is derived on
 * display — see client/src/utils/printingSheet.js.
 */
const HHMM = [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:mm"];

const minutes = { type: Number, min: [0, "Minutes cannot be negative"], max: [1440, "Minutes cannot exceed 1440"] };

// A date's entries per operator — the paper sheet has up to four; room for more.
const MAX_SLOTS = 8;

// Printing's own downtime columns, before the ten every sheet has — keep in step
// with PRINTING_EXTRA_STOPPAGE_FIELDS in client/src/utils/printingSheet.js and
// EXTRA_STOPPAGE_KEYS in utils/oeeMetrics.js.
const PRINTING_EXTRA_STOPPAGE_KEYS = ["askQueryQcMin", "emptyBagTuggingMin", "stockCountingMin"];
// Every downtime column of the sheet, in its own order.
const PRINTING_STOPPAGE_KEYS = [...PRINTING_EXTRA_STOPPAGE_KEYS, ...STOPPAGE_KEYS];

const PrintingEntrySchema = new mongoose.Schema(
  {
    // UTC midnight of the sheet date.
    date: { type: Date, required: [true, "Date is required"] },
    // The operator — this sheet's row key.
    worker: { type: mongoose.Schema.Types.ObjectId, ref: "MachineOperator", required: [true, "Operator is required"] },
    process: { type: mongoose.Schema.Types.ObjectId, ref: "Process", required: [true, "Process is required"] },
    slot: { type: Number, required: true, min: 1, max: MAX_SLOTS },

    // The operator's name as saved — what the shared Operator filters and charts read.
    operator: { type: String, trim: true, maxlength: 100, default: "" },
    workingStatus: { type: String, trim: true, maxlength: 40, default: "" },

    // MC No. — optional; the machine's name is kept as saved, so a renamed or
    // deleted machine still reads right.
    mcMachine: { type: mongoose.Schema.Types.ObjectId, ref: "Machine", default: null },
    mcName: { type: String, trim: true, maxlength: 100, default: "" },

    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", default: null },
    itemName: { type: String, trim: true, maxlength: 120, default: "" },

    // Standard Time per Piece (sec) — prefilled from the Part, this entry's own
    // (editable) figure.
    totalCycleSec: { type: Number, min: [0, "Standard Time per Piece cannot be negative"] },

    // Machine ON / OFF Time.
    machineOnTime: { type: String, match: HHMM },
    machineOffTime: { type: String, match: HHMM },

    // TOTAL QTY and OK QTY are typed; Rejected = TOTAL − OK (utils/rejectSplit.js).
    actualQty: { type: Number, min: [0, "Total Quantity cannot be negative"] },
    okQty: { type: Number, min: [0, "OK Quantity cannot be negative"] },
    rejectedQty: { type: Number, min: [0, "Rejected Quantity cannot be negative"] },

    plannedOperatorShiftHours: { type: Number, min: [0, "Planned Operator Shift Time cannot be negative"], max: 24 },

    ...Object.fromEntries(PRINTING_STOPPAGE_KEYS.map((k) => [k, minutes])),

    // Reason/Remarks for Rejection/Rework.
    remarks: { type: String, trim: true, maxlength: 500, default: "" },
    // Why "Other" downtime was used — required whenever that box has minutes.
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

PrintingEntrySchema.index({ date: 1, worker: 1, slot: 1 }, { unique: true });
PrintingEntrySchema.index({ process: 1, date: 1 });
PrintingEntrySchema.index({ mcMachine: 1 }, { sparse: true });
PrintingEntrySchema.index({ "review.status": 1 }, { sparse: true });

module.exports = mongoose.model("PrintingEntry", PrintingEntrySchema);
module.exports.WORKING_STATUSES = WORKING_STATUSES;
module.exports.NON_WORKING_STATUSES = NON_WORKING_STATUSES;
module.exports.MAX_SLOTS = MAX_SLOTS;
module.exports.PRINTING_EXTRA_STOPPAGE_KEYS = PRINTING_EXTRA_STOPPAGE_KEYS;
module.exports.PRINTING_STOPPAGE_KEYS = PRINTING_STOPPAGE_KEYS;
