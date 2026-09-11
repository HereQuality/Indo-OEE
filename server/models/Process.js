const mongoose = require("mongoose");

const ProcessSchema = new mongoose.Schema(
  {
    processName: {
      type: String,
      required: [true, "Process name is required"],
      trim: true,
      maxlength: [100, "Process name must be 100 characters or fewer"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, "Description must be 300 characters or fewer"],
    },
    // Default Shift for this process — Grinding Data Entry auto-fills the
    // entry's Shift (and Shift On/Off Time) from this the moment Process is
    // selected, so the operator doesn't have to also pick a Shift by hand.
    shift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Process", ProcessSchema);
