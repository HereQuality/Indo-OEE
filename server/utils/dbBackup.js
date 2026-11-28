"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { BSON } = require("mongodb");
const { createZip, readZip, isZip } = require("./zip");

const { EJSON, Binary } = BSON;

/**
 * utils/dbBackup.js
 * ──────────────────
 * A full copy of the database in one .zip file, and the way back:
 *
 *   dumpDatabase(db)            every collection — its documents and its
 *                               indexes — read from a native MongoDB Db
 *   packBackup(backup)          → the .zip (see ZIP LAYOUT below)
 *   readBackup(bufferOrFolder)  the reverse — from the .zip, from the folder
 *                               it unzips to, or from an old .json.gz backup
 *   restoreDatabase(db, backup) writes it all back — only into an empty
 *                               database unless `drop` is passed
 *
 * ZIP LAYOUT (INDO-2026-11-28_0230.zip):
 *
 *   INDO-2026-11-28_0230/
 *     README.txt               what is inside and how to use it
 *     manifest.json            when, which database, records per collection, every index
 *     database/<name>.json     every record EXACTLY as stored, one collection per file:
 *                              canonical Extended JSON (ObjectIds, dates, decimals keep their
 *                              type) — what a restore reads; `mongoimport --jsonArray` reads it too
 *     excel/<name>.csv         the same records as spreadsheets for Excel / Google Sheets
 *                              (India dates; passwords, tokens and secrets left out)
 *     uploads/...              every uploaded file as it is: profile pictures, logos,
 *                              ticket attachments
 *
 *   serializeBackup / parseBackup are the older single-file .json.gz form —
 *   kept so a backup taken before the switch to .zip still restores.
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
 * hundred kilobytes.
 */
const FORMAT = "indo-backup/1";
const ZIP_FORMAT = "indo-backup-zip/1";
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
// A file's bytes as a Buffer, whether held as a Buffer or as BSON Binary.
// (Never Buffer.from(buf.buffer): a small Buffer's .buffer is a shared pool.)
const bytesOf = (d) => {
  if (Buffer.isBuffer(d)) return d;
  if (d && d._bsontype === "Binary") return Buffer.from(d.buffer);
  if (d instanceof Uint8Array) return Buffer.from(d);
  return Buffer.from(d || []);
};
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
    const bytes = bytesOf(f.data);
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

// ── the .zip ────────────────────────────────────────────────────────────────
const IST_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
// "2026-11-28 14:05:09" in India — how dates read in the spreadsheets.
const istDateTime = (date) => {
  const p = Object.fromEntries(IST_FMT.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

// Never in the spreadsheets: password hashes, tokens, OTPs, secrets (they stay in database/ for a restore).
const SECRET_KEY = /pass(word)?|token|secret|api_?key|otp|hash|salt/i;
const MAX_COLUMNS = 400;
const isOid = (v) => v && typeof v === "object" && (v._bsontype === "ObjectId" || v._bsontype === "ObjectID");
const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !v._bsontype && !Buffer.isBuffer(v);
// A nested value as readable JSON: ids as text, dates in India time, secrets dropped.
const plainValue = (v) => {
  if (v == null || typeof v !== "object") return v;
  if (v instanceof Date || v._bsontype) return cellOf(v);
  if (Array.isArray(v)) return v.map(plainValue);
  const out = {};
  for (const [k, x] of Object.entries(v)) if (!SECRET_KEY.test(k)) out[k] = plainValue(x);
  return out;
};
function cellOf(v) {
  if (v == null) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : istDateTime(v);
  if (isOid(v)) return v.toHexString();
  if (v._bsontype === "Binary" || Buffer.isBuffer(v)) return "(binary)";
  if (typeof v === "object" && v._bsontype) return String(v.toString());
  if (Array.isArray(v)) return v.length ? JSON.stringify(v.map(plainValue)) : "";
  if (typeof v === "object") return JSON.stringify(plainValue(v));
  return String(v);
}
// { a: { b: 1 } } → { "a.b": 1 } two levels deep; deeper objects stay as JSON in one cell.
const flattenDoc = (doc, prefix = "", depth = 0, out = {}) => {
  for (const [key, value] of Object.entries(doc)) {
    if (SECRET_KEY.test(key)) continue;
    const name = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) && depth < 2 && Object.keys(value).length) flattenDoc(value, name, depth + 1, out);
    else out[name] = value;
  }
  return out;
};
const csvEscape = (text) => {
  let s = String(text);
  // A cell Excel would run as a formula (=, @, or +/- not followed by a digit) is kept as text.
  if (/^[=@]/.test(s) || /^[+-][^\d\s]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** One collection's records as a CSV sheet (BOM first, so Excel reads ₹ / Hindi names right). */
const toCsv = (docs) => {
  const rows = docs.map((d) => flattenDoc(d));
  const columns = [];
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k) && columns.length < MAX_COLUMNS) seen.add(k) && columns.push(k);
  columns.sort((a, b) => (a === "_id" ? -1 : b === "_id" ? 1 : 0));
  const lines = [columns.map(csvEscape).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvEscape(cellOf(r[c]))).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
};

const safeName = (name) => String(name).replace(/[^\w.-]+/g, "_");

const readme = (root, backup, counts) => `INDO OEE — DATABASE BACKUP
${"=".repeat(26)}
${root}
Taken ${istDateTime(backup.takenAt)} (India time) from the database "${backup.database}".
${counts.documents} records in ${counts.collections} collections, ${counts.files} uploaded file${counts.files === 1 ? "" : "s"}.


WHAT IS IN THIS FOLDER
----------------------
  excel/            Every list of the app as a spreadsheet (.csv). Open them in Excel,
                    Numbers or Google Sheets. Dates are India time. Passwords, tokens and
                    secrets are NOT in these files.
                      productionentries.csv, vmcentries.csv, …  the data-entry sheets
                      machines.csv, items.csv, operators.csv     the masters
                      auditlogs.csv                              the Logs (who did what, when)
  uploads/          Every uploaded file as it was: profile pictures, company logos,
                    support-ticket attachments.
  database/         Every record EXACTLY as stored, one file per collection. This is
                    what a restore uses — do not edit these files.
  manifest.json     Record counts per collection and every database index.


PUT THE DATA BACK (developer, on a computer with the project and MongoDB)
--------------------------------------------------------------------------
  cd server
  node seed/backupDb.js --restore /path/to/${root}.zip --uri mongodb://localhost:27017/INDO_restored
      -> loads everything into a NEW, empty database "INDO_restored".
         Your own data is not touched. Open it in MongoDB Compass to check it.

  Add --uploads to also copy back the uploaded files (only the missing ones).
  The unzipped folder works too:  --restore /path/to/${root}

  ON THE LIVE SERVER, only if the live data is lost or damaged:
  node seed/backupDb.js --restore ${root}.zip --uri <MONGO_URI of a NEW database> --live --uploads
      -> then point MONGO_URI in server/.env at that database and restart the app.
  (--drop replaces a database that already has data. Never use it on the live one
   without a fresh backup first.)


WITHOUT THIS APP (any MongoDB tools)
------------------------------------
  Each database/<name>.json is a JSON array in MongoDB Extended JSON, so:
  mongoimport --uri "mongodb://localhost:27017/INDO_restored" --collection machines \\
              --jsonArray --file database/machines.json
  (one command per file; the collection name is the file name). The indexes are
  listed in manifest.json.


KEEP IT SAFE
------------
  This file holds all of the company's production data. Keep a copy somewhere other
  than the server (Google Drive, an office computer) and do not share it.
`;

/** The backup as a .zip (Buffer). */
const packBackup = (backup) => {
  const takenAt = backup.takenAt instanceof Date ? backup.takenAt : new Date(backup.takenAt);
  const root = backupBaseName(backup.database, takenAt);
  const entries = [];
  const manifest = {
    format: ZIP_FORMAT,
    app: "INDO OEE",
    database: backup.database,
    takenAt: takenAt.toISOString(),
    takenAtIst: istDateTime(takenAt),
    collections: [],
    uploads: { files: 0, bytes: 0 },
  };
  for (const c of backup.collections) {
    const file = `${safeName(c.name)}.json`;
    // One record per line inside the array: still valid JSON, and readable in a text editor.
    const json = c.docs.length ? `[\n${c.docs.map((d) => EJSON.stringify(d, { relaxed: false })).join(",\n")}\n]\n` : "[]\n";
    entries.push({ name: `${root}/database/${file}`, data: Buffer.from(json, "utf8") });
    entries.push({ name: `${root}/excel/${safeName(c.name)}.csv`, data: Buffer.from(toCsv(c.docs), "utf8") });
    manifest.collections.push({ name: c.name, file: `database/${file}`, count: c.docs.length, indexes: JSON.parse(EJSON.stringify(c.indexes || [], { relaxed: false })) });
  }
  for (const f of backup.uploads || []) {
    const data = bytesOf(f.data);
    entries.push({ name: `${root}/uploads/${f.path}`, data });
    manifest.uploads.files += 1;
    manifest.uploads.bytes += data.length;
  }
  const counts = { collections: manifest.collections.length, documents: manifest.collections.reduce((n, c) => n + c.count, 0), files: manifest.uploads.files };
  entries.unshift({ name: `${root}/manifest.json`, data: Buffer.from(JSON.stringify(manifest, null, 2)) });
  entries.unshift({ name: `${root}/README.txt`, data: Buffer.from(readme(root, { ...backup, takenAt }, counts).replace(/\n/g, "\r\n")) });
  return createZip(entries, { date: takenAt });
};

// The backup inside a set of files (from the .zip or the unzipped folder), by path.
const fromFiles = (files) => {
  // The folder holding manifest.json — whatever it was renamed to, however deep.
  const manifestKey = [...files.keys()].filter((k) => k === "manifest.json" || k.endsWith("/manifest.json")).sort((a, b) => a.length - b.length)[0];
  if (!manifestKey) throw new Error("Not an INDO backup (no manifest.json inside)");
  const root = manifestKey.slice(0, -"manifest.json".length);
  let manifest;
  try {
    manifest = JSON.parse(files.get(manifestKey).toString("utf8"));
  } catch {
    throw new Error("Not an INDO backup (manifest.json can't be read)");
  }
  if (manifest.format !== ZIP_FORMAT || !Array.isArray(manifest.collections)) throw new Error("Not an INDO backup (unknown manifest)");
  const collections = manifest.collections.map((c) => {
    const raw = files.get(`${root}${c.file}`);
    if (!raw) throw new Error(`The backup is missing ${c.file}`);
    // Written canonically (every type tagged); read relaxed, so ObjectIds, Dates and Decimal128s
    // come back as themselves and numbers as plain numbers — what the driver stores them as.
    const docs = EJSON.parse(raw.toString("utf8"), { relaxed: true });
    if (!Array.isArray(docs)) throw new Error(`${c.file} isn't a list of records`);
    if (docs.length !== c.count) throw new Error(`${c.file} has ${docs.length} records, the manifest says ${c.count}`);
    return { name: c.name, count: docs.length, indexes: EJSON.parse(JSON.stringify(c.indexes || []), { relaxed: true }), docs };
  });
  const prefix = `${root}uploads/`;
  const uploads = [...files.entries()].filter(([k]) => k.startsWith(prefix) && k.length > prefix.length).map(([k, data]) => ({ path: k.slice(prefix.length), size: data.length, data }));
  return { format: ZIP_FORMAT, database: manifest.database, takenAt: new Date(manifest.takenAt), collections, uploads };
};

// Every file under `dir`, by its path relative to `dir` ("/"-separated).
const filesIn = (dir) => {
  const out = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && !e.name.startsWith(".")) out.set(path.relative(dir, full).split(path.sep).join("/"), fs.readFileSync(full));
    }
  };
  walk(dir);
  return out;
};

/**
 * A backup from: a .zip (Buffer or path), the folder it unzips to (path), or an
 * old .json.gz backup. Throws with a plain reason when it isn't one of ours or
 * is damaged.
 */
const readBackup = (input) => {
  if (typeof input === "string") {
    if (fs.statSync(input).isDirectory()) return fromFiles(filesIn(input));
    return readBackup(fs.readFileSync(input));
  }
  if (isZip(input)) return fromFiles(readZip(input));
  return parseBackup(input);
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
const backupBaseName = (database, at = new Date()) => `${database}-${istStamp(at)}`;
const backupFileName = (database, at = new Date()) => `${backupBaseName(database, at)}.zip`;
// The IST date in a backup file name (.zip, or an older .json.gz), or null for any other file.
const dateOfFile = (fileName, database) => {
  const m = String(fileName).match(new RegExp(`^${database}-(\\d{4}-\\d{2}-\\d{2})_\\d{4}\\.(zip|json\\.gz)$`));
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

module.exports = {
  FORMAT,
  ZIP_FORMAT,
  dumpDatabase,
  packBackup,
  readBackup,
  serializeBackup,
  parseBackup,
  summarize,
  restoreDatabase,
  collectUploads,
  restoreUploads,
  safeUploadPath,
  backupFileName,
  backupBaseName,
  dateOfFile,
  filesToDelete,
  istStamp,
  _internal: { toCsv, flattenDoc, cellOf, csvEscape },
};
