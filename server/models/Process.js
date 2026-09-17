const mongoose = require("mongoose");

/**
 * models/Process.js
 * ────────────────────────────
 * A production process (e.g. "VMC", "PRESS", "TRAUB M/C") — the unit the
 * Production Dashboard is organised around. Processes are shown grouped by
 * `group` (e.g. "Hood/Housing", "Plug Pin") on the dashboard landing page;
 * opening one shows that process's own dashboard.
 *
 * There is no manual ordering: processes (and so their groups) appear in the
 * order they were created. A group is just a shared name — it exists for as
 * long as some process carries it (see canonicalGroup in the controller,
 * which keeps one spelling per group).
 *
 * Which machines belong to a process lives on the machine (Machine.process),
 * so a machine can only ever be in one process. The Process Master form
 * sends `machineIds` and the controller moves the machines across.
 *
 * `stats` and `charts` are the KPI tiles and visuals this process's dashboard
 * shows, in display order. They hold keys from the catalog in
 * client/src/utils/processDashboard.js — the server stores them as-is and the
 * client ignores any key it doesn't know, so adding a visual never needs a
 * server change.
 */
const widgetKeys = {
  type: [{ type: String, trim: true, match: [/^[A-Za-z][A-Za-z0-9]{0,39}$/, "Invalid widget key"] }],
  default: undefined,
  validate: { validator: (v) => !v || v.length <= 40, message: "Too many widgets" },
};

const ProcessSchema = new mongoose.Schema(
  {
    processName: {
      type: String,
      required: [true, "Process name is required"],
      trim: true,
      maxlength: [40, "Process name must be 40 characters or fewer"],
    },
    group: {
      type: String,
      trim: true,
      maxlength: [40, "Group must be 40 characters or fewer"],
      default: "",
    },
    description: {
      type: String,
      trim: true,
      maxlength: [200, "Description must be 200 characters or fewer"],
    },
    // undefined = "never configured" → the dashboard falls back to the
    // catalog defaults; [] = deliberately empty.
    stats: widgetKeys,
    charts: widgetKeys,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Process", ProcessSchema);
