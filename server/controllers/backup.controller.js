"use strict";
const fs = require("node:fs");
const jwt = require("jsonwebtoken");
const backups = require("../jobs/dbBackup");
const { recordAudit } = require("../utils/auditTrail");
const { istNow } = require("../jobs/summaryMail");

/**
 * controllers/backup.controller.js — Administration › Backups (Super Admin
 * only; routes/backup.routes.js). The backups themselves are made by
 * jobs/dbBackup.js: the whole database and every uploaded file, one dated
 * file per backup.
 *
 *   GET  /backups                the backups kept (newest first), the last result, the schedule, disk space
 *   POST /backups                take one now (answers when it is saved)
 *   POST /backups/:name/link     a download link for one backup, valid 5 minutes
 *   GET  /backups/download?token the file itself (the token is the proof; no cookie needed)
 *
 * Taking, failing and downloading a backup each write a row to the audit log.
 */

const LINK_TTL = "5m";
const PURPOSE = "backup-download";

const diskSpace = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const s = fs.statfsSync(dir);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return null;
  }
};

// Milliseconds until the next HH:MM in India.
const msUntil = (hhmm, now = new Date()) => {
  const [h, m] = hhmm.split(":").map(Number);
  const [nh, nm] = istNow(now).hhmm.split(":").map(Number);
  let wait = ((h * 60 + m) - (nh * 60 + nm)) * 60000 - now.getUTCSeconds() * 1000;
  if (wait <= 0) wait += 24 * 3600 * 1000;
  return wait;
};

exports.list = async (req, res) => {
  try {
    const { at, dir, keepDays, mirrorUri } = backups.settings();
    let standby = "";
    try {
      standby = mirrorUri ? backups.parseTarget(mirrorUri).database : "";
    } catch {
      standby = "";
    }
    res.set("Cache-Control", "no-store");
    res.status(200).json({
      isOk: true,
      data: {
        backups: backups.listBackups(),
        running: backups.isRunning(),
        status: backups.readStatus(),
        disk: diskSpace(dir),
        schedule: {
          enabled: true,
          time: at,
          nextInMs: msUntil(at),
          keepDays,
          standby,
        },
      },
    });
  } catch (error) {
    console.error("Error listing backups:", error);
    res.status(500).json({ isOk: false, message: "Could not load the backups." });
  }
};

exports.create = async (req, res) => {
  // A big database takes a while: give it time.
  req.setTimeout?.(30 * 60 * 1000);
  res.setTimeout?.(30 * 60 * 1000);
  try {
    const r = await backups.runBackup({ reason: "manual", req });
    res.status(201).json({
      isOk: true,
      message: "Backup saved.",
      data: { name: r.name, size: r.bytes, documents: r.documents, collections: r.collections, files: r.files, removed: r.removed },
    });
  } catch (error) {
    if (error.code === "BACKUP_RUNNING") return res.status(409).json({ isOk: false, message: error.message });
    console.error("Manual backup failed:", error);
    await recordAudit({ req, entityType: "backup", label: "Database backup", action: "create", remark: `manual backup FAILED: ${error.message}`, success: false, statusCode: 500 });
    res.status(500).json({ isOk: false, message: `Backup failed: ${error.message}` });
  }
};

exports.link = async (req, res) => {
  const { name } = req.params;
  if (!backups.backupPath(name)) return res.status(404).json({ isOk: false, message: "No such backup." });
  const token = jwt.sign({ purpose: PURPOSE, name, by: String(req.user?._id || "") }, process.env.JWT_SECRET, { expiresIn: LINK_TTL });
  // Who asked for it is logged here — the download itself carries no session.
  await recordAudit({ req, entityType: "backup", label: name, action: "download", remark: "Download link opened" });
  res.status(200).json({ isOk: true, data: { url: `/api/v1/backups/download?token=${encodeURIComponent(token)}`, expiresIn: 300 } });
};

exports.download = (req, res) => {
  let payload;
  try {
    payload = jwt.verify(String(req.query.token || ""), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ isOk: false, message: "This download link has expired. Open Backups and click Download again." });
  }
  if (payload?.purpose !== PURPOSE) return res.status(401).json({ isOk: false, message: "Not a backup download link." });
  const file = backups.backupPath(payload.name);
  if (!file) return res.status(404).json({ isOk: false, message: "No such backup." });
  res.setHeader("Content-Type", payload.name.endsWith(".zip") ? "application/zip" : "application/gzip");
  res.setHeader("Content-Length", fs.statSync(file).size);
  res.setHeader("Content-Disposition", `attachment; filename="${payload.name}"`);
  res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(file)
    .on("error", () => res.destroy())
    .pipe(res);
};

exports._msUntil = msUntil;
