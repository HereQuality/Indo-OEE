const mongoose = require("mongoose");

/**
 * models/MaintenanceMode.js
 * ────────────────────────────
 * Single global maintenance-mode document (this is a single-tenant
 * deployment — same lazy find-or-create shape as models/Company.js).
 *
 * Two independent things live on this one doc, both set from
 * Administration > Company > Maintenance Mode:
 *   - `isActive`    — the live kill-switch. While true, every request
 *     is rejected for everyone except SuperAdmin — see
 *     middlewares/maintenance.middleware.js.
 *   - `scheduledAt` / `message` — a heads-up announcement shown to users
 *     as a once-a-day popup (before the switch is actually flipped). It is
 *     independent of `isActive`: an admin can announce a future window
 *     without locking the app yet, and the popup keeps showing (once per
 *     day) until the admin clears it or flips `isActive` on.
 */
const maintenanceModeSchema = new mongoose.Schema(
  {
    isActive: {
      type: Boolean,
      default: false,
    },
    message: {
      type: String,
      trim: true,
      default: "",
      maxlength: [500, "Message cannot exceed 500 characters"],
    },
    // When the announced maintenance window starts. Purely informational
    // for the popup — does NOT auto-flip `isActive`; the admin does that
    // explicitly once the work actually begins.
    scheduledAt: {
      type: Date,
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      refPath: "updatedByModel",
    },
    updatedByModel: {
      type: String,
      enum: ["User", "Operator"],
      default: "User",
    },
  },
  { timestamps: true }
);

const MaintenanceMode = mongoose.model("MaintenanceMode", maintenanceModeSchema);

let cachedId = null;

// Lazily finds (or creates, once) the single maintenance document. Cached
// by _id only (not the doc itself) so a fresh read always reflects the
// latest saved value — every caller still does its own findById/findOne.
const getOrCreateMaintenance = async () => {
  if (cachedId) {
    const existing = await MaintenanceMode.findById(cachedId);
    if (existing) return existing;
    cachedId = null; // was deleted out from under us somehow — recreate below
  }
  let doc = await MaintenanceMode.findOne({});
  if (!doc) doc = await MaintenanceMode.create({});
  cachedId = doc._id;
  return doc;
};

module.exports = { MaintenanceMode, getOrCreateMaintenance };
