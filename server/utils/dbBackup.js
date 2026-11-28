"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { BSON } = require("mongodb");

const { EJSON, Binary } = BSON;

/**
 * utils/dbBackup.js
 * ──────────────────
 * A full copy of the database in one file, and the way back:
 *
 *   dumpDatabase(db)            every collection — its documents and its
 *                               indexes — read from a native MongoDB Db
 *   serializeBackup(backup)     → one gzip'd Extended-JSON buffer (canonical
 *                               EJSON, so ObjectIds, Dates and number types
 *                               survive the round trip exactly)
 *   parseBackup(buffer)         the reverse; refuses anything that isn't ours
 *   restoreDatabase(db, backup) writes it all back — only into an empty
 *                               database unless `drop` is passed
 *
 *   collectUploads(dir)         every uploaded file (profile pictures, logos,
 *                               ticket attachments) to put in the backup too
 *   restoreUploads(dir, backup) puts back the ones that are missing
 *
 * plus the file naming (IST date-time stamp) and the retention rule used by
 * jobs/dbBackup.js: every daily file for the last `keepDays` days, and the
 * first file of each month for ever.
 *
 * The database is small (under a megabyte of data), so the archive is a few
 * hundred kilobytes — small enough to be mailed every day.
 */
const FORMAT = "indo-backup/1";
const TZ = "Asia/Kolkata";

const dumpDatabase = async (db, { uploadsDir } = {}) => {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system."))
    .sort();
  const collections = [];
  for (const name of names) {
    const col = db.collection(name);
    const docs = await col.find({}).toArray();
    const indexes = (await col.indexes()).filter((i) => i.name !== "_id_").map(({ v, ns, key, name: n, ...o }) => ({ key, name: n, ...o }));
    collections.push({ name, count: docs.length, indexes, docs });
  }
  const backup = { format: FORMAT, database: db.databaseName, takenAt: new Date(), collections };
  if (uploadsDir) backup.uploads = collectUploads(uploadsDir);
  return backup;
};

const serializeBackup = (backup) => zlib.gzipSync(Buffer.from(EJSON.stringify(backup, { relaxed: false })));

const parseBackup = (buffer) => {
  let backup;
  try {
    // Written canonically (every type tagged); read relaxed, so ObjectIds,
    // Dates and Decimal128s come back as themselves and numbers as plain
    // numbers — what the driver stores them as.
    backup = EJSON.parse(zlib.gunzipSync(buffer).toString("utf8"), { relaxed: true });
  } catch (e) {
    throw new Error("Not an INDO backup file (couldn't read it)");
  }
  if (!backup || backup.format !== FORMAT || !Array.isArray(backup.collections)) throw new Error("Not an INDO backup file");
  return backup;
};

const summarize = (backup) => ({
  database: backup.database,
  takenAt: backup.takenAt instanceof Date ? backup.takenAt : new Date(backup.takenAt),
  collections: backup.collections.length,
  documents: backup.collections.reduce((s, c) => s + c.docs.length, 0),
  files: Array.isArray(backup.uploads) ? backup.uploads.length : 0,
  fileBytes: Array.isArray(backup.uploads) ? backup.uploads.reduce((s, f) => s + (f.size || 0), 0) : 0,
});

// ── uploaded files ──────────────────────────────────────────────────────────
// Every file under `dir` (server/uploads): [{ path: "profile/x.jpg", size, data }]
// with `data` as BSON Binary, so it rides in the same EJSON file. Hidden files
// are skipped; nothing outside `dir` is ever read (symlinks are not followed).
const collectUploads = (dir) => {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const data = fs.readFileSync(full);
        out.push({ path: path.relative(dir, full).split(path.sep).join("/"), size: data.length, data: new Binary(data) });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
};

// A stored path that stays inside the uploads folder, or null.
const safeUploadPath = (dir, rel) => {
  const target = path.resolve(dir, String(rel || ""));
  return target.startsWith(path.resolve(dir) + path.sep) ? target : null;
};

// Writes back the backup's uploaded files that are missing from `dir` (an
// existing file is never overwritten unless `overwrite`). Returns how many.
const restoreUploads = (dir, backup, { overwrite = false } = {}) => {
  let written = 0;
  for (const f of Array.isArray(backup.uploads) ? backup.uploads : []) {
    const target = safeUploadPath(dir, f.path);
    if (!target || (!overwrite && fs.existsSync(target))) continue;
    const bytes = f.data?.buffer ? Buffer.from(f.data.buffer) : Buffer.from(f.data || []);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    written += 1;
  }
  return written;
};

// Puts a backup into `db`. Refuses a database that already holds data unless
// `drop` is given, in which case the whole database is dropped first.
const restoreDatabase = async (db, backup, { drop = false } = {}) => {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith("system."));
  const filled = [];
  for (const n of names) if ((await db.collection(n).countDocuments()) > 0) filled.push(n);
  if (filled.length && !drop) throw new Error(`Database "${db.databaseName}" isn't empty (${filled.length} collection${filled.length === 1 ? "" : "s"} with data: ${filled.slice(0, 5).join(", ")}${filled.length > 5 ? "…" : ""}) — restore with drop to replace it`);
  if (drop && names.length) await db.dropDatabase();
  for (const c of backup.collections) {
    if (c.docs.length) await db.collection(c.name).insertMany(c.docs, { ordered: true });
    else await db.createCollection(c.name).catch(() => {});
    for (const { key, ...opts } of c.indexes || []) await db.collection(c.name).createIndex(key, opts).catch(() => {});
  }
  return summarize(backup);
};

// "2026-11-28_0230" in IST.
const istStamp = (at = new Date()) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}_${p.hour === "24" ? "00" : p.hour}${p.minute}`;
};
const backupFileName = (database, at = new Date()) => `${database}-${istStamp(at)}.json.gz`;
// The IST date in a backup file name, or null for any other file.
const dateOfFile = (fileName, database) => {
  const m = String(fileName).match(new RegExp(`^${database}-(\\d{4}-\\d{2}-\\d{2})_\\d{4}\\.json\\.gz$`));
  return m ? m[1] : null;
};

const shiftDay = (iso, days) => new Date(new Date(`${iso}T00:00:00.000Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

// Which of `fileNames` to delete on `today`: everything from the last
// `keepDays` days stays; of the older ones, the first file of each month stays
// for ever and the rest go. Files that aren't this database's backups are
// never touched.
const filesToDelete = (fileNames, database, { today, keepDays = 30 }) => {
  const oldest = shiftDay(today, -keepDays);
  const dated = fileNames.map((f) => ({ f, d: dateOfFile(f, database) })).filter((x) => x.d).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.f < b.f ? -1 : 1));
  const keptMonth = new Set();
  const out = [];
  for (const { f, d } of dated) {
    if (d >= oldest) continue;
    const month = d.slice(0, 7);
    if (!keptMonth.has(month)) {
      keptMonth.add(month);
      continue;
    }
    out.push(f);
  }
  return out;
};

module.exports = { FORMAT, dumpDatabase, serializeBackup, parseBackup, summarize, restoreDatabase, collectUploads, restoreUploads, safeUploadPath, backupFileName, dateOfFile, filesToDelete, istStamp };
