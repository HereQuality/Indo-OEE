"use strict";

const { getOrCreateAppUpdate } = require("../models/AppUpdateMode");
const { getSocketIo } = require("../socket");
const { recordAudit } = require("../utils/auditTrail");

const serialize = (doc) => ({
  isActive: !!doc.isActive,
  minVersion: doc.minVersion || "",
  latestVersion: doc.latestVersion || "",
  reportedVersion: doc.reportedVersion || "",
  reportedAt: doc.reportedAt || null,
  message: doc.message || "",
  softMessage: doc.softMessage || "",
  updatedAt: doc.updatedAt,
});

// Plain "1.2.3" (or "1.2.3.4") — same shape pubspec.yaml's own `version:`
// line uses. Anything else is a client mistake, not a value worth storing.
const VERSION_RE = /^\d+(\.\d+){1,3}$/;

// Public — no `protect`. The mobile app checks this before login even
// resolves (an old build may not be able to talk to a changed API
// contract at all), same reasoning as getMaintenanceStatus.
exports.getAppUpdateStatus = async (req, res) => {
  try {
    const doc = await getOrCreateAppUpdate();
    res.status(200).json({ isOk: true, success: true, data: serialize(doc) });
  } catch (error) {
    res.status(500).json({ isOk: false, success: false, message: error.message });
  }
};

// SuperAdmin only (see routes/appUpdate.routes.js).
exports.updateAppUpdate = async (req, res) => {
  try {
    const { isActive, minVersion, latestVersion, message, softMessage } = req.body;

    // Same rule the web form applies — blank is allowed (means "off").
    const ADMIN_VERSION_RE = /^\d+(\.\d+){0,3}$/;
    for (const [label, value] of [["Minimum version", minVersion], ["Latest version", latestVersion]]) {
      const v = String(value ?? "").trim();
      if (v && !ADMIN_VERSION_RE.test(v)) {
        return res.status(400).json({ isOk: false, success: false, message: `${label} must look like "1.2.3", or be left blank.` });
      }
    }

    const doc = await getOrCreateAppUpdate();
    const before = serialize(doc);

    if (isActive !== undefined) doc.isActive = !!isActive;
    if (minVersion !== undefined) doc.minVersion = String(minVersion || "").trim().slice(0, 20);
    if (latestVersion !== undefined) doc.latestVersion = String(latestVersion || "").trim().slice(0, 20);
    if (message !== undefined) doc.message = String(message || "").slice(0, 500);
    if (softMessage !== undefined) doc.softMessage = String(softMessage || "").slice(0, 500);

    doc.updatedBy = req.user._id;
    doc.updatedByModel = req.user.roleType === "SuperAdmin" ? "User" : "Operator";

    await doc.save();

    const payload = serialize(doc);
    await recordAudit({ req, entityType: "appUpdate", entity: doc._id, label: "App Update", action: "setting", before, after: payload, fields: { isActive: "Forced update on", minVersion: "Minimum version", latestVersion: "Latest version", message: "Message", softMessage: "Soft update message" } });

    const io = getSocketIo();
    if (io) io.emit("app-update:update", payload);

    res.status(200).json({ isOk: true, success: true, data: payload });
  } catch (error) {
    res.status(400).json({ isOk: false, success: false, message: error.message || "Failed to save app update settings" });
  }
};

// Machine-to-machine — guarded by releaseAuth (shared secret), not a user
// session (see routes/appUpdate.routes.js). Called by
// mobile/scripts/report_version.sh right after a real
// build, so "what did we just publish" reflects the actual build instead
// of an admin's memory of it. Never touches `minVersion` — that stays a
// deliberate, separate admin decision.
exports.reportAppVersion = async (req, res) => {
  try {
    const { version } = req.body;

    if (!version || !VERSION_RE.test(String(version).trim())) {
      return res.status(400).json({ isOk: false, success: false, message: 'version must look like "1.2.3".' });
    }

    const doc = await getOrCreateAppUpdate();
    doc.reportedVersion = String(version).trim().slice(0, 20);
    doc.reportedAt = new Date();
    await doc.save();

    const payload = serialize(doc);

    const io = getSocketIo();
    if (io) io.emit("app-update:update", payload);

    res.status(200).json({ isOk: true, success: true, data: payload });
  } catch (error) {
    res.status(400).json({ isOk: false, success: false, message: error.message || "Failed to report app version" });
  }
};
