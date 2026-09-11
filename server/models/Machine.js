const mongoose = require("mongoose");

const MachineSchema = new mongoose.Schema(
  {
    machineName: {
      type: String,
      required: [true, "Machine name is required"],
      trim: true,
      maxlength: [100, "Machine name must be 100 characters or fewer"],
    },
    machineCode: {
      type: String,
      trim: true,
      maxlength: [20, "Machine code must be 20 characters or fewer"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, "Description must be 300 characters or fewer"],
    },
    processes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Process",
      },
    ],
    // A machine can run across more than one shift (e.g. Shift A and
    // Shift B both use this machine) — separate from its own On/Off Time
    // window below.
    shifts: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Shift" }],
      default: [],
    },
    // Machine's own Shift Time Start/End — the machine's scheduled
    // operating window, shown as-is in the Shift Time column elsewhere.
    machineOnTime: {
      type: String, // "HH:mm"
      trim: true,
      required: [true, "Shift Time Start is required"],
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Machine Start Time must be HH:mm"],
    },
    machineOffTime: {
      type: String, // "HH:mm"
      trim: true,
      required: [true, "Shift Time End is required"],
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Machine End Time must be HH:mm"],
    },
    // Optional 1-hour Lunch Break slot for this machine (e.g. "12:00" means
    // 12:00-13:00) — never required. When a Production Entry's own M/C time
    // fully covers this window, that hour is added to its Total Stoppage
    // (see productionCalculation.service.js's computeLunchMin). Blank means
    // this machine has no configured lunch break.
    lunchStartTime: {
      type: String, // "HH:mm"
      trim: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Lunch Start Time must be HH:mm"],
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Machine", MachineSchema);
