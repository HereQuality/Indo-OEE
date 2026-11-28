"use strict";
/**
 * seed/backupDb.js — take or restore a full database backup by hand.
 *
 *   node seed/backupDb.js                       back up the database in .env (MONGO_URI)
 *                                               into server/backups/ (or BACKUP_DIR)
 *       --out <dir>                             write it somewhere else
 *       --uri <mongodb uri>                     back up another database (read only)
 *   node seed/backupDb.js --list                the backup files in the folder
 *   node seed/backupDb.js --restore <file>      put a backup into the database in .env
 *                                               (<file>: a .zip, the folder it unzips to,
 *                                               or an older .json.gz)
 *       --uri <mongodb uri>                     ...or into another one
 *       --drop                                  replace a database that already has data
 *       --live                                  required to restore into anything but a
 *                                               local (127.0.0.1 / localhost) database
 *       --uploads                               also put back uploaded files missing
 *                                               from server/uploads (never overwrites)
 *
 * A backup by hand never writes an audit-trail row (it may be pointed at a
 * database that must not be touched); the server's own daily backup
 * (jobs/dbBackup.js) does.
 */
const path = require("node:path");
const fs = require("node:fs");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const { readBackup, restoreDatabase, restoreUploads, summarize } = require("../utils/dbBackup");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};
if (value("out")) process.env.BACKUP_DIR = value("out");
const { runBackup, settings, listFiles, UPLOADS_DIR } = require("../jobs/dbBackup");

const isLocal = (uri) => /^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(uri);
const uri = value("uri") || process.env.MONGO_URI;

(async () => {
  if (!uri) throw new Error("No database: set MONGO_URI in .env or pass --uri");
  const { dir } = settings();

  if (flag("list")) {
    await mongoose.connect(uri);
    const files = listFiles(dir, mongoose.connection.db.databaseName);
    console.log(files.length ? files.map((f) => `${f}  ${Math.round(fs.statSync(path.join(dir, f)).size / 1024)} KB`).join("\n") : `No backups in ${dir}`);
    return;
  }

  if (flag("restore")) {
    const file = value("restore");
    if (!file) throw new Error("--restore needs the backup file");
    const full = fs.existsSync(file) ? file : path.join(dir, file);
    // A .zip, the folder it unzips to, or an older .json.gz.
    const backup = readBackup(full);
    const s = summarize(backup);
    if (!isLocal(uri) && !flag("live")) throw new Error("Refusing to restore into a non-local database — pass --live if you really mean it");
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    console.log(`Restoring ${path.basename(full)} (${s.documents} records, ${s.collections} collections, taken ${s.takenAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST) into "${db.databaseName}" on ${isLocal(uri) ? "localhost" : "a remote server"}${flag("drop") ? ", dropping what's there first" : ""}…`);
    await restoreDatabase(db, backup, { drop: flag("drop") });
    if (flag("uploads")) console.log(`Uploaded files put back: ${restoreUploads(UPLOADS_DIR, backup)} of ${s.files} (existing ones left alone).`);
    else if (s.files) console.log(`(The backup also holds ${s.files} uploaded file(s) — add --uploads to put back the missing ones.)`);
    console.log("Restored.");
    return;
  }

  await mongoose.connect(uri);
  const r = await runBackup({ reason: "manual", audit: false });
  console.log(`${r.file}\n${r.documents} records in ${r.collections} collections, ${r.files} uploaded files, ${Math.round(r.bytes / 1024)} KB${r.removed.length ? `\nremoved ${r.removed.length} old file(s)` : ""}`);
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => {}));
