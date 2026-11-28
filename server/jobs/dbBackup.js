"use strict";
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const { MongoClient } = require("mongodb");
const logger = require("../config/logger");
const { isConfigured, sendMail } = require("../services/mailer");
const { recordAudit } = require("../utils/auditTrail");
const { dumpDatabase, serializeBackup, restoreDatabase, summarize, backupFileName, dateOfFile, filesToDelete } = require("../utils/dbBackup");
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
 */
const SCHEDULER = { name: "Scheduler", role: "System" };

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

// Takes one backup now: file on disk, old files pruned, mailed when possible.
// `audit: false` skips the audit-trail row (the CLI, which may be pointed at a
// database it must not write to).
const runBackup = async ({ reason = "manual", actor, audit = true, mail = true, mirror = true } = {}) => {
  const { dir, mailTo, keepDays, mirrorUri } = settings();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Not connected to the database");
  const backup = await dumpDatabase(db);
  const buffer = serializeBackup(backup);
  const name = backupFileName(db.databaseName, backup.takenAt);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, buffer);
  const removed = filesToDelete(listFiles(dir, db.databaseName), db.databaseName, { today: istNow(backup.takenAt).date, keepDays });
  for (const f of removed) fs.rmSync(path.join(dir, f), { force: true });

  const s = summarize(backup);
  const kb = Math.round(buffer.length / 1024);
  const label = `${s.documents} records in ${s.collections} collections, ${kb} KB`;
  let mailed = false;
  let mailError = "";
  if (mail && mailTo && isConfigured()) {
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
    await recordAudit({ entityType: "backup", label: "Database backup", action: "create", actor: actor || SCHEDULER, remark: `${reason}: ${name} — ${label}${outcome}` });
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

module.exports = { start, tick, runBackup, settings, listFiles, parseTarget, sameDatabase };
