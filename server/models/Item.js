const mongoose = require("mongoose");

/**
 * models/Item.js
 * ────────────────────────────
 * A part that can be run on a machine, with its Drawing No., Setup No. and
 * cycle time. Picking an item on a Production Data Entry sheet copies these
 * onto the row (still editable there), so later changes to the master never
 * rewrite already-entered rows.
 *
 * A part belongs to one process (`process`, see models/Process.js), which
 * decides which data entry page offers it — the CNC sheet lists CNC parts, the
 * VMC sheet VMC parts — and which cycle-time fields it carries: a part on the
 * CNC sheet has operation-wise times that sum to its Total Cycle Time; a part
 * on the VMC sheet has a Program Time and the pieces one program makes, which
 * give its cycle time instead. A part with no process yet (older records, or
 * not classified) is offered on every sheet until it is given one.
 */
const MAX_CYCLE_OPS = 5;

// The named operation-time boxes, in sheet order — Total Cycle Time is their
// sum. Kept in one place so the Item master, Production Entry row and the
// client's own copy of this list (client/src/utils/productionSheet.js) name
// the same eight fields the same way. Two operations really are both called
// "Other Operation (sec)" on the sheet; they're told apart here only by key.
const CYCLE_OP_FIELDS = [
  { key: "drillingSec", label: "Drilling (sec)" },
  { key: "boringSec", label: "Boring (sec)" },
  { key: "threadingSec", label: "Threading (sec)" },
  { key: "tappingSec", label: "Tapping (sec)" },
  { key: "chamferingSec", label: "Chamfering (sec)" },
  { key: "otherOp1Sec", label: "Other Operation (sec)" },
  { key: "otherOp2Sec", label: "Other Operation (sec)" },
  { key: "clampDeclampSec", label: "Clamp/Declamp (sec)" },
];

const cycleOpNumber = { type: Number, min: [0, "Cycle time cannot be negative"] };

// An SPM part's own four named operations, in sheet order — Total Cycle Time
// is their sum, the same shape as CYCLE_OP_FIELDS above but SPM's own field
// names. Kept in one place so the Item master, SPM entry row and the client's
// own copy (client/src/utils/spmSheet.js) name the same four fields the same way.
const SPM_OP_FIELDS = [
  { key: "loadingSec", label: "Loading (sec)" },
  { key: "processSec", label: "Process (sec)" },
  { key: "unloadingCleaningSec", label: "Unloading and Cleaning (sec)" },
  { key: "otherOperationsSec", label: "Other Operations (sec)" },
];

// A RIVET part's own four named operations — the same shape as SPM_OP_FIELDS
// above (SPM and RIVET share this sheet layout), but kept as its own named
// constant/fields so a part's RIVET values and SPM values stay independent.
// Kept in step with the client's own copy (client/src/utils/rivetSheet.js).
const RIVET_OP_FIELDS = [
  { key: "rivetLoadingSec", label: "Loading (sec)" },
  { key: "rivetProcessSec", label: "Process (sec)" },
  { key: "rivetUnloadingCleaningSec", label: "Unloading and Cleaning (sec)" },
  { key: "rivetOtherOperationsSec", label: "Other Operations (sec)" },
];

// A RIVET part's own Process choice — which kind of work this part is. Kept in
// step with PROCESS_TYPES in server/models/RivetEntry.js and
// client/src/Components/Production/RivetEntryForm.jsx.
const RIVET_PROCESS_TYPES = ["Rivet", "Clamp"];

// A PRESS part's own Operation choice — which kind of work this part is, the
// same shape as RIVET_PROCESS_TYPES above. Kept in step with OPERATIONS in
// server/models/PressEntry.js and PRESS_OPERATIONS in
// client/src/utils/pressSheet.js.
const PRESS_OPERATIONS = ["Bending", "Tapping", "Blank"];

// An SPM part's own three reference figures — No. of Holes in One Piece, No.
// of Piece in One Cycle, Stroke Required for One Piece. Not part of any
// formula (nobody has given us the rule connecting them to Ideal Quantity
// yet), but set once here and copied onto an SPM entry read-only, the same
// way Drawing No. is — required there, so they can't drift between entries
// of the same part. Kept in step with the client's own copy
// (client/src/utils/spmSheet.js's SPM_REFERENCE_FIELDS).
const SPM_REFERENCE_FIELDS = [
  { key: "noOfHoles", label: "No. of Holes in One Piece" },
  { key: "piecesPerCycle", label: "No. of Piece in One Cycle" },
  { key: "strokeRequired", label: "Stroke Required for One Piece" },
];

const ItemSchema = new mongoose.Schema(
  {
    itemName: {
      type: String,
      required: [true, "Item name is required"],
      trim: true,
      maxlength: [120, "Item name must be 120 characters or fewer"],
    },
    drawingNo: {
      type: String,
      trim: true,
      maxlength: [40, "Drawing No. must be 40 characters or fewer"],
      default: "",
    },
    setupNo: {
      type: String,
      trim: true,
      maxlength: [40, "Setup No. must be 40 characters or fewer"],
      default: "",
    },
    ...Object.fromEntries(CYCLE_OP_FIELDS.map((f) => [f.key, cycleOpNumber])),
    // The authoritative cycle time every formula uses — typed on its own,
    // not the sum of the eight operations above. On the real sheet the two
    // can genuinely differ (an item's measured operations don't always add
    // up to its set cycle time), so Total Cycle Time is never derived from
    // them; it's just its own number.
    totalCycleSec: cycleOpNumber,
    // The process this part is run in — decides which data entry page offers it
    // (see the file comment). null = not classified yet.
    process: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Process",
      default: null,
    },
    // VMC parts: Program Time (min) and how many pieces one program makes —
    // copied onto a VMC entry when the part is picked. Product Cycle Time =
    // programTimeMin × 60 ÷ pcsPerProgram (stored in totalCycleSec too).
    programTimeMin: { type: Number, min: [0, "Program Time cannot be negative"] },
    pcsPerProgram: { type: Number, min: [1, "At least 1 piece per program"] },
    // PRESS parts: Standard Time Taken (min) and how many pieces are made in
    // it — the same shape as VMC's program above, copied onto a PRESS entry
    // when the part is picked. Product Cycle Time = standardTimeMin × 60 ÷
    // pcsPerStandardTime (stored in totalCycleSec too).
    standardTimeMin: { type: Number, min: [0, "Standard Time Taken cannot be negative"] },
    pcsPerStandardTime: { type: Number, min: [1, "At least 1 piece in Standard Time"] },
    // PRESS parts: which kind of work this part is (Bending, Tapping, …) — a
    // required dropdown, independent of the entry's own Operation box.
    pressOperation: { type: String, trim: true, maxlength: 40, default: "" },
    // SPM parts: Loading/Process/Unloading and Cleaning/Other Operations
    // (sec), copied onto an SPM entry when the part is picked — Total Cycle
    // Time is their sum (stored in totalCycleSec too, same as CNC).
    ...Object.fromEntries(SPM_OP_FIELDS.map((f) => [f.key, cycleOpNumber])),
    // SPM parts: No. of Holes in One Piece, No. of Piece in One Cycle, Stroke
    // Required for One Piece — reference figures only, set once here.
    ...Object.fromEntries(SPM_REFERENCE_FIELDS.map((f) => [f.key, cycleOpNumber])),
    // RIVET parts: the same four operations, RIVET's own fields — copied onto
    // a RIVET entry when the part is picked, same mechanism as SPM's above.
    ...Object.fromEntries(RIVET_OP_FIELDS.map((f) => [f.key, cycleOpNumber])),
    // RIVET parts: which kind of work this part is (Rivet or Clamp) — a
    // required dropdown, independent of the entry's own Process box.
    rivetProcessType: { type: String, trim: true, maxlength: 40, default: "" },
    // Superseded by the eight named fields above; kept only so items saved
    // before they existed don't lose their Op 1…Op 5 cycle times.
    cycleOpsSec: {
      type: [{ type: Number, min: [0, "Cycle time cannot be negative"] }],
      default: [],
      validate: {
        validator: (v) => v.length <= MAX_CYCLE_OPS,
        message: `At most ${MAX_CYCLE_OPS} cycle time operations are allowed`,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Item", ItemSchema);
module.exports.MAX_CYCLE_OPS = MAX_CYCLE_OPS;
module.exports.CYCLE_OP_FIELDS = CYCLE_OP_FIELDS;
module.exports.SPM_OP_FIELDS = SPM_OP_FIELDS;
module.exports.RIVET_OP_FIELDS = RIVET_OP_FIELDS;
module.exports.RIVET_PROCESS_TYPES = RIVET_PROCESS_TYPES;
module.exports.PRESS_OPERATIONS = PRESS_OPERATIONS;
module.exports.SPM_REFERENCE_FIELDS = SPM_REFERENCE_FIELDS;
