const mongoose = require("mongoose");

/**
 * models/Machine.js
 * ────────────────────────────
 * A CNC machine on the shop floor (e.g. "7A"). Every active machine gets
 * three locked rows per date on the Production Data Entry sheet, ordered
 * by `sequence`; `color` tints its M.C. No. cell like the Excel sheet.
 *
 * `sequence` is the machine's 1-based place in that order. Only a Super Admin
 * sets it, and it is kept contiguous (1..N, no duplicates) by
 * controllers/machine.controller.js; 0 only means "never positioned" and
 * sorts last (utils/machineOrder.js). It lives on the machine, not on each
 * entry, so re-ordering re-orders every date — past and future — at once.
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
    // The production process this machine belongs to (see models/Process.js)
    // — decides which process dashboard its entries roll up into.
    process: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Process",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Machine", MachineSchema);
