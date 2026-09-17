"use strict";

const { getOrCreateAnnouncement } = require("../models/AnnouncementMode");
const { getSocketIo } = require("../socket");

// End-of-day for `endDate` so the announcement stays visible through the
// whole day an admin picked, not just up to midnight.
const endOfDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const computeIsLive = (doc) => {
  if (!doc.isActive) return false;
  const now = new Date();
  if (doc.startDate && now < doc.startDate) return false;
  if (doc.endDate && now > endOfDay(doc.endDate)) return false;
  return true;
};

const serialize = (doc) => ({
  isActive: !!doc.isActive,
  message: doc.message || "",
  startDate: doc.startDate || null,
  endDate: doc.endDate || null,
  updatedAt: doc.updatedAt,
  isLive: computeIsLive(doc),
});

// Public — no `protect`, same reasoning as getMaintenanceStatus: the
// frontend needs to read this for any logged-in user without a separate
// permission check gating the toast itself.
exports.getAnnouncementStatus = async (req, res) => {
  try {
    const doc = await getOrCreateAnnouncement();
    res.status(200).json({ isOk: true, success: true, data: serialize(doc) });
  } catch (error) {
    res.status(500).json({ isOk: false, success: false, message: error.message });
  }
};

// SuperAdmin only (see routes/announcement.routes.js).
exports.updateAnnouncement = async (req, res) => {
  try {
    const { isActive, message, startDate, endDate } = req.body;

    let parsedStart = undefined;
    if (startDate !== undefined) {
      if (startDate) {
        parsedStart = new Date(startDate);
        if (Number.isNaN(parsedStart.getTime())) {
          return res.status(400).json({ isOk: false, success: false, message: "Invalid start date." });
        }
      } else {
        parsedStart = null;
      }
    }

    let parsedEnd = undefined;
    if (endDate !== undefined) {
      if (endDate) {
        parsedEnd = new Date(endDate);
        if (Number.isNaN(parsedEnd.getTime())) {
          return res.status(400).json({ isOk: false, success: false, message: "Invalid end date." });
        }
      } else {
        parsedEnd = null;
      }
    }

    const doc = await getOrCreateAnnouncement();

    const effectiveStart = parsedStart !== undefined ? parsedStart : doc.startDate;
    const effectiveEnd = parsedEnd !== undefined ? parsedEnd : doc.endDate;
    if (effectiveStart && effectiveEnd && effectiveStart > effectiveEnd) {
      return res.status(400).json({ isOk: false, success: false, message: "Start date must be on or before the end date." });
    }

    if (isActive !== undefined) doc.isActive = !!isActive;
    if (message !== undefined) doc.message = String(message || "").slice(0, 1000);
    if (parsedStart !== undefined) doc.startDate = parsedStart;
    if (parsedEnd !== undefined) doc.endDate = parsedEnd;

    doc.updatedBy = req.user._id;
    doc.updatedByModel = req.user.roleType === "SuperAdmin" ? "User" : "Operator";

    await doc.save();

    const payload = serialize(doc);

    const io = getSocketIo();
    if (io) io.emit("announcement:update", payload);

    res.status(200).json({ isOk: true, success: true, data: payload });
  } catch (error) {
    res.status(400).json({ isOk: false, success: false, message: error.message || "Failed to update announcement settings" });
  }
};
