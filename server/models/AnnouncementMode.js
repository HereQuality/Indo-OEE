const mongoose = require("mongoose");

/**
 * models/AnnouncementMode.js
 * ────────────────────────────
 * Single global announcement document (same lazy find-or-create shape as
 * models/MaintenanceMode.js). Unlike maintenance mode, this never blocks
 * anything — it only drives a once-a-day toast (see
 * Components/Common/AnnouncementModal.jsx) telling users about something
 * (a new feature, a holiday notice, etc.) while `isActive` is on AND
 * today falls within [startDate, endDate].
 */
const announcementModeSchema = new mongoose.Schema(
  {
    isActive: {
      type: Boolean,
      default: false,
    },
    message: {
      type: String,
      trim: true,
      default: "",
      maxlength: [1000, "Message cannot exceed 1000 characters"],
    },
    // Inclusive display window. Both optional — if either is left blank
    // the announcement runs open-ended on that side as long as `isActive`
    // stays on.
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
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

const AnnouncementMode = mongoose.model("AnnouncementMode", announcementModeSchema);

let cachedId = null;

const getOrCreateAnnouncement = async () => {
  if (cachedId) {
    const existing = await AnnouncementMode.findById(cachedId);
    if (existing) return existing;
    cachedId = null;
  }
  let doc = await AnnouncementMode.findOne({});
  if (!doc) doc = await AnnouncementMode.create({});
  cachedId = doc._id;
  return doc;
};

module.exports = { AnnouncementMode, getOrCreateAnnouncement };
