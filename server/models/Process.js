const mongoose = require("mongoose");

/**
 * models/Process.js
 * ────────────────────────────
 * A production process (e.g. "VMC", "PRESS", "TRAUB M/C") — the unit the
 * Production Dashboard is organised around. Processes are listed on the
 * dashboard landing page in the order they were created; opening one shows
 * that process's own dashboard.
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
 *
 * `dataEntryMenu` is which existing sidebar page this process's own data
 * entry happens on — e.g. the CNC process points at the "CNC Data Entry"
 * page. That page then scopes its Machine picker to whichever process(es)
 * name it this way, instead of every data entry page offering every
 * process's machines. Optional — a process not linked to a page yet just
 * doesn't show up anywhere machine-scoping happens.
 *
 * Stored as the page's own menuUrl (a plain string, e.g.
 * "/hqepl/production/cnc-data-entry") rather than an ObjectId ref, because
 * the page picker in Process Master offers BOTH MenuMaster items (an entry
 * under some group, e.g. "Items") and MenuGroupMaster top-level links (e.g.
 * "CNC Data Entry" itself is one) — two different collections with no
 * single ref type to point at. Matching by URL also means this keeps
 * working across a promoteMenuToLinkGroup migration (seed/seedMenus.js),
 * which preserves a page's URL even when it moves from one collection to
 * the other. `dataEntryMenuLabel` is that page's display name, kept
 * alongside for anyone who can't re-fetch the menu list to look it up (see
 * the isAdmin-gated fetch in ProcessMaster.jsx).
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
    description: {
      type: String,
      trim: true,
      maxlength: [200, "Description must be 200 characters or fewer"],
    },
    // undefined = "never configured" → the dashboard falls back to the
    // catalog defaults; [] = deliberately empty.
    stats: widgetKeys,
    charts: widgetKeys,
    dataEntryMenu: { type: String, trim: true, default: null },
    dataEntryMenuLabel: { type: String, trim: true, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Process", ProcessSchema);
