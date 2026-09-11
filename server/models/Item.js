const mongoose = require("mongoose");

/**
 * models/Item.js
 * ────────────────────────────
 * A part that can be run on a machine, with its Drawing No., Setup No. and
 * operation-wise cycle times. Picking an item on the Production Data Entry
 * sheet copies these onto the row (still editable there), so later changes
 * to the master never rewrite already-entered rows.
 */
const MAX_CYCLE_OPS = 5;

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
    // Seconds per operation (Op 1…Op 5); Total cycle time is their sum.
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
