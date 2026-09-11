const mongoose = require("mongoose");

/**
 * models/Machine.js
 * ────────────────────────────
 * A CNC machine on the shop floor (e.g. "7A"). Every active machine gets
 * three locked rows per date on the Production Data Entry sheet, ordered
 * by `sequence`; `color` tints its M.C. No. cell like the Excel sheet.
 */
const MachineSchema = new mongoose.Schema(
  {
    machineName: {
      type: String,
      required: [true, "Machine No. is required"],
      trim: true,
      maxlength: [20, "Machine No. must be 20 characters or fewer"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [200, "Description must be 200 characters or fewer"],
    },
    color: {
      type: String,
      trim: true,
      default: "",
    },
    sequence: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Machine", MachineSchema);
