const mongoose = require("mongoose");

/**
 * Shift Master
 *
 * A named shift (e.g. "Shift A") with a scheduled on/off time, used by
 * Grinding Data Entry to compute Overtime / Start Delay / Early Closed
 * against the actual machine on/off time reported for an entry.
 */
const ShiftSchema = new mongoose.Schema(
  {
    shiftName: {
      type: String,
      required: [true, "Shift name is required"],
      trim: true,
      maxlength: [50, "Shift name must be 50 characters or fewer"],
    },
    shiftOnTime: {
      type: String, // "HH:mm"
      required: [true, "Shift On Time is required"],
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Shift On Time must be HH:mm"],
    },
    shiftOffTime: {
      type: String, // "HH:mm"
      required: [true, "Shift Off Time is required"],
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Shift Off Time must be HH:mm"],
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Shift", ShiftSchema);
