const mongoose = require("mongoose");

/**
 * Standard Time Master
 *
 * Stores the standard grinding time (minutes per piece) for a specific
 * combination of Machine + Size (Width × Height) + Thickness.
 * Used to auto-fill the standard time in the Production Data Entry form.
 */
const StandardTimeSchema = new mongoose.Schema(
  {
    machine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Machine",
      required: [true, "Machine is required"],
    },
    sizeWidthMm: {
      type: Number,
      required: [true, "Width (mm) is required"],
      min: [0.1, "Width must be greater than 0"],
    },
    sizeHeightMm: {
      type: Number,
      required: [true, "Height (mm) is required"],
      min: [0.1, "Height must be greater than 0"],
    },
    thicknessMm: {
      type: String,
      required: [true, "Thickness (mm) is required"],
      trim: true,
    },
    standardTimeMin: {
      type: Number,
      required: [true, "Standard Time (minutes) is required"],
      min: [0.01, "Standard Time must be greater than 0"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// A machine cannot have duplicate entries for the same size+thickness combo
StandardTimeSchema.index(
  { machine: 1, sizeWidthMm: 1, sizeHeightMm: 1, thicknessMm: 1 },
  { unique: true },
);

module.exports = mongoose.model("StandardTime", StandardTimeSchema);
