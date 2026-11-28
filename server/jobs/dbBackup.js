"use strict";
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const { MongoClient } = require("mongodb");
const logger = require("../config/logger");
const { isConfigured, sendMail } = require("../services/mailer");
const { recordAudit } = require("../utils/auditTrail");
const { dumpDatabase, serializeBackup, parseBackup, restoreDatabase, summarize, backupFileName, dateOfFile, filesToDelete } = require("../utils/dbBackup");
const { istNow } = require("./summaryMail");

/**
 * jobs/dbBackup.js
 * ─────────────────
 * A full copy of the database, every day, without anyone having to remember:
 *
 *   - taken at BACKUP_AT IST (2:30 AM by default) by the running server,
 *     checked once a minute like the summary mail; a day missed while the
 *     server was down is taken as soon as it is back
 *   - written to BACKUP_DIR (server/backups/, git-ignored) as
 *     INDO-YYYY-MM-DD_HHmm.json.gz — see utils/dbBackup.js for the format and
 *     seed/backupDb.js for taking one by hand or restoring one
 *   - kept for BACKUP_KEEP_DAYS days (30), and the first one of every month
 *     for ever
 *   - mailed to BACKUP_MAIL_TO (the sending mailbox itself when unset, so
 *     Gmail keeps an off-site copy of every day; "off" to disable) when SMTP
 *     is set up — the file is a few hundred kilobytes
 *   - loaded into the standby database BACKUP_MIRROR_URI when one is set (a
 *     second database, e.g. ".../INDO_backup" on the same cluster): dropped
 *     and refilled from the backup each day, so a ready-to-use copy always
 *     exists — point MONGO_URI at it if the main database is ever lost. It
 *     must be a different database from the main one; the job refuses to
 *     mirror onto itself.
 *   - recorded in the audit trail (module "Database backup", by Scheduler)
 *   - holds every uploaded file too (server/uploads: profile pictures, logos,
 *     ticket attachments), so one file brings the whole app back
 *   - one at a time: a second request while one runs is refused
 *     (BACKUP_RUNNING), and the last result is kept in <dir>/status.json for
 *     Administration › Backups (controllers/backup.controller.js)
 */
const SCHEDULER = { name: "Scheduler", role: "System" };
const UPLOADS_DIR = path.resolve(__dirname, "../uploads");
// Gmail refuses attachments over 25 MB; leave room for the base64 overhead.
const MAIL_MAX_BYTES = 18 * 1024 * 1024;

const settings = () => ({
  at: /^([01]\d|2[0-3]):[0-5]\d$/.test(process.env.BACKUP_AT || "") ? process.env.BACKUP_AT : "02:30",
  dir: process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.resolve(__dirname, "../backups"),
  mailTo: process.env.BACKUP_MAIL_TO === "off" ? "" : process.env.BACKUP_MAIL_TO || process.env.SMTP_USER || "",
  keepDays: Number(process.env.BACKUP_KEEP_DAYS) > 0 ? Number(process.env.BACKUP_KEEP_DAYS) : 30,
  mirrorUri: (process.env.BACKUP_MIRROR_URI || "").trim(),
});

// Where a mongodb:// or mongodb+srv:// address points: { host, database }.
// The database name must be in the address (".../INDO_backup").
const parseTarget = (uri) => {
  let u;
  try {
    u = new URL(uri);
  } catch {
    throw new Error("BACKUP_MIRROR_URI isn't a MongoDB address");
  }
  if (!/^mongodb(\+srv)?:$/.test(u.protocol)) throw new Error("BACKUP_MIRROR_URI isn't a MongoDB address");
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!database) throw new Error("BACKUP_MIRROR_URI needs the database name at the end (…/INDO_backup)");
  return { host: u.host.toLowerCase(), database };
};
// True when the mirror address is the main database itself.
const sameDatabase = (mirror, main) => mirror.database === main.database && mirror.host === main.host;

// Drops the standby database and refills it from `backup`.
const mirrorBackup = async (backup, mirrorUri, main) => {
  const target = parseTarget(mirrorUri);
  if (sameDatabase(target, main)) throw new Error(`BACKUP_MIRROR_URI points at the main database "${main.database}" itself`);
  const client = await MongoClient.connect(mirrorUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await restoreDatabase(client.db(target.database), backup, { drop: true });
  } finally {
    await client.close().catch(() => {});
  }
  return target.database;
};

const listFiles = (dir, database) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => dateOfFile(f, database)) : []);

// Every backup in the folder, newest first: { name, size, createdAt, day }.
const listBackups = (database = mongoose.connection.db?.databaseName) => {
  const { dir } = settings();
  if (!database) return [];
  return listFiles(dir, database)
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, createdAt: st.mtime.toISOString(), day: dateOfFile(name, database) };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
};

// The full path of backup `name` in the folder, or null (never a path outside it).
const backupPath = (name, database = mongoose.connection.db?.databaseName) => {
  if (typeof name !== "string" || !database || !dateOfFile(name, database)) return null;
  const file = path.join(settings().dir, name);
  return fs.existsSync(file) ? file : null;
};

// The last result: { lastSuccess: { name, bytes, documents, files, at, reason }, lastError, lastErrorAt }.
const statusFile = () => path.join(settings().dir, "status.json");
const readStatus = () => {
  try {
    return JSON.parse(fs.readFileSync(statusFile(), "utf8"));
  } catch {
    return {};
  }
};
const writeStatus = (patch) => {
  try {
    fs.mkdirSync(settings().dir, { recursive: true });
    fs.writeFileSync(statusFile(), JSON.stringify({ ...readStatus(), ...patch }, null, 2));
  } catch (e) {
    logger.warn(`Database backup: couldn't save the status file: ${e.message}`);
  }
};

let running = null;
const isRunning = () => !!running;

// Takes one backup now: file on disk, old files pruned, mailed when possible.
// `audit: false` skips the audit-trail row (the CLI, which may be pointed at a
// database it must not write to).
// `req` (a signed-in request) makes the audit row name the person who asked.
const runBackup = async (opts = {}) => {
  if (running) {
    const err = new Error("A backup is already running. Try again in a minute.");
    err.code = "BACKUP_RUNNING";
    throw err;
  }
  running = takeBackup(opts);
  try {
    const result = await running;
    writeStatus({ lastSuccess: { name: result.name, bytes: result.bytes, documents: result.documents, collections: result.collections, files: result.files, at: new Date().toISOString(), reason: opts.reason || "manual", mailed: result.mailed, mailError: result.mailError || "" }, lastError: null, lastErrorAt: null });
    return result;
  } catch (error) {
    writeStatus({ lastError: error.message, lastErrorAt: new Date().toISOString() });
    throw error;
  } finally {
    running = null;
  }
};

const takeBackup = async ({ reason = "manual", actor, req, audit = true, mail = true, mirror = true, uploads = true } = {}) => {
  const { dir, mailTo, keepDays, mirrorUri } = settings();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Not connected to the database");
  const backup = await dumpDatabase(db, { uploadsDir: uploads ? UPLOADS_DIR : null });
  const buffer = serializeBackup(backup);
  const name = backupFileName(db.databaseName, backup.takenAt);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  // Written to a .part file and renamed, so a crash mid-write never leaves a
  // broken file that looks like a backup; then read back to prove it opens.
  const part = `${file}.part`;
  fs.writeFileSync(part, buffer);
  const check = summarize(parseBackup(fs.readFileSync(part)));
  if (check.documents !== summarize(backup).documents) {
    fs.rmSync(part, { force: true });
    throw new Error("The backup file didn't read back the same — not saved");
  }
  fs.renameSync(part, file);
  const removed = filesToDelete(listFiles(dir, db.databaseName), db.databaseName, { today: istNow(backup.takenAt).date, keepDays });
  for (const f of removed) fs.rmSync(path.join(dir, f), { force: true });

  const s = summarize(backup);
  const kb = Math.round(buffer.length / 1024);
  const label = `${s.documents} records in ${s.collections} collections${s.files ? `, ${s.files} uploaded file${s.files === 1 ? "" : "s"}` : ""}, ${kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`}`;
  let mailed = false;
  let mailError = "";
  if (mail && mailTo && isConfigured() && buffer.length > MAIL_MAX_BYTES) {
    mailError = `file too big to mail (${Math.round(buffer.length / 1048576)} MB) — download it from Administration › Backups`;
  } else if (mail && mailTo && isConfigured()) {
    try {
      await sendMail({
        to: mailTo,
        subject: `INDO database backup — ${name}`,
        text: `Full backup of the "${db.databaseName}" database taken ${s.takenAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST: ${label}.\n\nKeep this mail: the attachment restores the whole database with\n  node seed/backupDb.js --restore ${name}\n\nSent automatically by ${process.env.APP_NAME || "the OEE app"}.`,
        attachments: [{ filename: name, content: buffer, contentType: "application/gzip" }],
      });
      mailed = true;
    } catch (e) {
      mailError = e.message;
    }
  }
  let mirrored = "";
  let mirrorError = "";
  if (mirror && mirrorUri) {
    try {
      mirrored = await mirrorBackup(backup, mirrorUri, { host: String(mongoose.connection.host || "").toLowerCase() + (mongoose.connection.port ? `:${mongoose.connection.port}` : ""), database: db.databaseName });
    } catch (e) {
      mirrorError = e.message;
    }
  }
  const outcome = `${mailed ? `, mailed to ${mailTo}` : mailError ? `, mail FAILED: ${mailError}` : ""}${mirrored ? `, standby "${mirrored}" refreshed` : mirrorError ? `, standby FAILED: ${mirrorError}` : ""}${removed.length ? `; removed ${removed.length} old file(s)` : ""}`;
  logger[mailError || mirrorError ? "warn" : "info"](`Database backup (${reason}): ${name} — ${label}${outcome}`);
  if (audit) {
    await recordAudit({ req, entityType: "backup", label: name, action: "create", actor: actor || SCHEDULER, remark: `${reason}: ${label}${outcome}` });
  }
  return { file, name, bytes: buffer.length, ...s, mailed, mailError, mirrored, mirrorError, removed };
};

let lastFor = "";
// One check: takes today's backup once its time has passed and none exists
// yet for today (a file from today in the folder counts, so a restart
// doesn't take a second one).
const tick = async (now = new Date()) => {
  const { at, dir } = settings();
  const clock = istNow(now);
  if (clock.hhmm < at || lastFor === clock.date) return;
  const db = mongoose.connection.db;
  if (!db) return;
  if (listFiles(dir, db.databaseName).some((f) => dateOfFile(f, db.databaseName) === clock.date)) {
    lastFor = clock.date;
    return;
  }
  try {
    await runBackup({ reason: "scheduled" });
  } catch (error) {
    if (error.code === "BACKUP_RUNNING") return; // one started by hand is running; check again next minute
    logger.error(`Database backup failed: ${error.message}`);
    await recordAudit({ entityType: "backup", label: "Database backup", action: "create", actor: SCHEDULER, remark: `scheduled backup FAILED: ${error.message}` });
  }
  lastFor = clock.date;
};

let timer = null;
const start = () => {
  if (timer) return;
  const { at, dir, mailTo, mirrorUri } = settings();
  timer = setInterval(() => tick().catch((e) => logger.error(`Database backup check failed: ${e.message}`)), 60 * 1000);
  timer.unref?.();
  let standby = "";
  if (mirrorUri) {
    try {
      standby = `, standby database "${parseTarget(mirrorUri).database}"`;
    } catch (e) {
      logger.warn(`Database backup: ${e.message} — no standby copy will be kept`);
    }
  }
  logger.info(`Database backup: daily at ${at} IST into ${dir}${mailTo && isConfigured() ? `, mailed to ${mailTo}` : ""}${standby}`);
};

module.exports = { start, tick, runBackup, isRunning, readStatus, listBackups, backupPath, settings, listFiles, parseTarget, sameDatabase, UPLOADS_DIR };
