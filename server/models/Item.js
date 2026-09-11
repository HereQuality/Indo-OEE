const mongoose = require("mongoose");

/**
 * models/Item.js
 * ────────────────────────────
 * An item/part produced on a specific Machine via a specific Process,
 * with the Cycle Time (minutes per piece) the user enters for it —
 * Management > List of Items, alongside List of Process/List of Machines.
 */
const ItemSchema = new mongoose.Schema(
  {
    itemName: {
      type: String,
      required: [true, "Item name is required"],
      trim: true,
      maxlength: [100, "Item name must be 100 characters or fewer"],
    },
    itemCode: {
      type: String,
      trim: true,
      maxlength: [20, "Item code must be 20 characters or fewer"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, "Description must be 300 characters or fewer"],
    },
    process: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Process",
      required: [true, "Process is required"],
    },
    machine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Machine",
      required: [true, "Machine is required"],
    },
    // Minutes per piece — same unit/naming convention as ProductionEntry's
    // standardTimePerPieceMin (see server/models/ProductionEntry.js).
    cycleTimeMin: {
      type: Number,
      required: [true, "Cycle time is required"],
      min: [0.01, "Cycle time must be greater than 0"],
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Item", ItemSchema);
