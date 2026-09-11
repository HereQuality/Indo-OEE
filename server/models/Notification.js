const mongoose = require("mongoose");

/**
 * models/Notification.js
 * ────────────────────────
 * Generic notification, currently only fired by the support-ticket flow
 * (new ticket in your queue, new reply, forwarded to you, resolved, etc.)
 * but not tied to tickets specifically — `referenceId` + `type` are enough
 * to extend this to other features later without a schema change.
 */
const notificationSchema = new mongoose.Schema(
  {
    recipientModel: {
      type: String,
      enum: ["Operator", "User"],
      required: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "recipientModel",
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      default: "general",
      trim: true,
      index: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
