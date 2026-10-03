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
