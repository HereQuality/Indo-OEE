"use strict";

const { getOrCreateMaintenance } = require("../models/MaintenanceMode");
const { getSocketIo } = require("../socket");

const serialize = (doc) => ({
  isActive: !!doc.isActive,
  message: doc.message || "",
  scheduledAt: doc.scheduledAt || null,
  updatedAt: doc.updatedAt,
});

// Public — no `protect`. Has to be reachable by a logged-out visitor and
// by the client before it even knows who's logged in, so the block
// screen/popup can render without an authenticated call first.
exports.getMaintenanceStatus = async (req, res) => {
  try {
    const doc = await getOrCreateMaintenance();
    res.status(200).json({ isOk: true, success: true, data: serialize(doc) });
  } catch (error) {
    res.status(500).json({ isOk: false, success: false, message: error.message });
  }
};

// SuperAdmin only (see routes/maintenance.routes.js). Updates the single
// maintenance doc and broadcasts it over socket.io so every already-open
// session reacts immediately instead of waiting for their
// next poll.
exports.updateMaintenance = async (req, res) => {
  try {
    const { isActive, message, scheduledAt } = req.body;

    if (scheduledAt !== undefined && scheduledAt !== null && scheduledAt !== "") {
      const parsed = new Date(scheduledAt);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ isOk: false, success: false, message: "Invalid scheduledAt date/time." });
      }
    }

    const doc = await getOrCreateMaintenance();

    if (isActive !== undefined) doc.isActive = !!isActive;
    if (message !== undefined) doc.message = String(message || "").slice(0, 500);
    if (scheduledAt !== undefined) doc.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;

    doc.updatedBy = req.user._id;
    doc.updatedByModel = req.user.roleType === "SuperAdmin" ? "User" : "Operator";

    await doc.save();

    const payload = serialize(doc);

    const io = getSocketIo();
    if (io) io.emit("maintenance:update", payload);

    res.status(200).json({ isOk: true, success: true, data: payload });
  } catch (error) {
    res.status(400).json({ isOk: false, success: false, message: error.message || "Failed to update maintenance settings" });
  }
};
