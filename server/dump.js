"use strict";
/**
 * dump.js
 * ─────────
 * Copies the production (Atlas) database into the local one.
 *
 *   node dump.js                 copy every collection that is empty locally
 *   node dump.js --drop          replace local collections with production's
 *   node dump.js --only items,machines        just these collections
 *   node dump.js --exclude auditlogs          everything but these
 *   node dump.js --dry-run       count what would be copied, write nothing
 *
 * Source: SOURCE_URI in the environment, or else the commented-out
 *   "# MONGO_URI=mongodb+srv://…" line in server/.env (so the password never
 *   lives in this file).
 * Target: MONGO_URI from server/.env — must be a local database; the script
 *   refuses to write anywhere else.
 *
 * The source is only ever read. Indexes are copied along with the documents.
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { MongoClient } = require("mongoose").mongo;

const BATCH = 1000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const listOf = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : String(args[i + 1] || "").split(",").map((s) => s.trim()).filter(Boolean);
};

const sourceUri = () => {
  if (process.env.SOURCE_URI) return process.env.SOURCE_URI;
  const envFile = path.join(__dirname, ".env");
  if (!fs.existsSync(envFile)) return null;
  const line = fs.readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => /^\s*#\s*MONGO_URI\s*=\s*mongodb(\+srv)?:\/\//.test(l));
  return line ? line.replace(/^\s*#\s*MONGO_URI\s*=\s*/, "").trim() : null;
};

const parsed = (uri) => {
  const u = new URL(uri);
  return { host: u.hostname, db: decodeURIComponent(u.pathname.replace(/^\//, "")) };
};

const masked = (uri) => uri.replace(/\/\/([^:@/]+):[^@]+@/, "//$1:****@");

const copyCollection = async (src, dst, name, { drop, dry }) => {
  const total = await src.collection(name).estimatedDocumentCount();
  const existing = (await dst.listCollections({ name }).toArray()).length ? await dst.collection(name).estimatedDocumentCount() : 0;

  if (existing && !drop) return { name, total, copied: 0, note: `skipped — local already has ${existing} (use --drop to replace)` };
  if (dry) return { name, total, copied: 0, note: "dry run" };
  if (existing || drop) await dst.collection(name).drop().catch(() => {}); // nothing to drop is fine

  let copied = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    await dst.collection(name).insertMany(batch, { ordered: false });
    copied += batch.length;
    batch = [];
  };
  for await (const doc of src.collection(name).find({})) {
    batch.push(doc);
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  // Indexes after the data — a unique index can't reject what production already holds.
  const indexes = (await src.collection(name).indexes()).filter((i) => i.name !== "_id_");
  let indexNote = "";
  for (const { v, ns, ...index } of indexes) {
    const { key, ...options } = index;
    try {
      await dst.collection(name).createIndex(key, options);
    } catch (error) {
      indexNote += ` [index ${index.name}: ${error.message}]`;
    }
  }
  return { name, total, copied, note: indexNote.trim() };
};

const main = async () => {
  const from = sourceUri();
  const to = process.env.MONGO_URI;
  if (!from) throw new Error("No source: set SOURCE_URI, or keep the commented \"# MONGO_URI=mongodb+srv://…\" line in server/.env");
  if (!to) throw new Error("No target: MONGO_URI is not set in server/.env");

  const target = parsed(to);
  if (!LOCAL_HOSTS.has(target.host)) throw new Error(`Refusing to write to "${target.host}" — MONGO_URI must point at a local database`);
  const source = parsed(from);
  if (LOCAL_HOSTS.has(source.host) && source.db === target.db) throw new Error("Source and target are the same database");
  if (!target.db) throw new Error("MONGO_URI has no database name");

  console.log(`From  ${masked(from)}  (db "${source.db}")`);
  console.log(`To    ${masked(to)}  (db "${target.db}")${flag("--drop") ? "  — local collections will be REPLACED" : ""}${flag("--dry-run") ? "  — dry run" : ""}\n`);

  const srcClient = new MongoClient(from, { readPreference: "secondaryPreferred" });
  const dstClient = new MongoClient(to);
  try {
    await Promise.all([srcClient.connect(), dstClient.connect()]);
    const src = srcClient.db(source.db || undefined);
    const dst = dstClient.db(target.db);

    const only = listOf("--only");
    const exclude = listOf("--exclude") || [];
    const names = (await src.listCollections({ type: "collection" }).toArray())
      .map((c) => c.name)
      .filter((n) => !n.startsWith("system."))
      .filter((n) => (only ? only.includes(n) : true) && !exclude.includes(n))
      .sort();
    if (!names.length) throw new Error("No collections to copy");

    let docs = 0;
    for (const name of names) {
      const r = await copyCollection(src, dst, name, { drop: flag("--drop"), dry: flag("--dry-run") });
      docs += r.copied;
      console.log(`${r.name.padEnd(28)} ${String(r.copied).padStart(7)} / ${String(r.total).padEnd(7)} ${r.note}`);
    }
    console.log(`\nDone — ${docs} documents copied across ${names.length} collections.`);
  } finally {
    await Promise.allSettled([srcClient.close(), dstClient.close()]);
  }
};

main().catch((error) => {
  console.error(`\nDump failed: ${error.message}`);
  process.exit(1);
});
