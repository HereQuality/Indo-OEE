// The database backup: a dump survives the round trip exactly, a restore
// refuses a database that already has data, the file names carry the IST
// date, and old files are pruned by the retention rule — all against stand-ins
// for the native Db (no database is touched):  node --test utils/
const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectId, Decimal128 } = require("mongodb");

const { dumpDatabase, serializeBackup, parseBackup, restoreDatabase, summarize, backupFileName, dateOfFile, filesToDelete, FORMAT } = require("./dbBackup");

// A stand-in for a native Db: collections are { name: { docs, indexes } }.
const fakeDb = (name, collections) => {
  const store = Object.fromEntries(Object.entries(collections).map(([n, c]) => [n, { docs: [...(c.docs || [])], indexes: [...(c.indexes || [])] }]));
  const db = {
    databaseName: name,
    store,
    listCollections: () => ({ toArray: async () => Object.keys(store).map((n) => ({ name: n })) }),
    collection: (n) => ({
      find: () => ({ toArray: async () => [...(store[n]?.docs || [])] }),
      indexes: async () => [{ v: 2, key: { _id: 1 }, name: "_id_" }, ...(store[n]?.indexes || [])],
      countDocuments: async () => (store[n]?.docs || []).length,
      insertMany: async (docs) => {
        store[n] = store[n] || { docs: [], indexes: [] };
        store[n].docs.push(...docs);
      },
      createIndex: async (key, opts) => {
        store[n] = store[n] || { docs: [], indexes: [] };
        store[n].indexes.push({ key, ...opts });
      },
    }),
    createCollection: async (n) => {
      store[n] = store[n] || { docs: [], indexes: [] };
    },
    dropDatabase: async () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
  return db;
};

const id = new ObjectId("64b0c0ffee0000000000a001");
const when = new Date("2026-11-27T12:30:00.000Z");
const source = () =>
  fakeDb("INDO", {
    machines: { docs: [{ _id: id, name: "CNC 7B", createdAt: when, cycleSec: 57.5, count: 3, big: Decimal128.fromString("1.10") }], indexes: [{ v: 2, key: { name: 1 }, name: "name_1", unique: true }] },
    empty: { docs: [] },
    "system.views": { docs: [{ x: 1 }] },
  });

test("a dump lists every collection but system ones, with its indexes", async () => {
  const b = await dumpDatabase(source());
  assert.equal(b.format, FORMAT);
  assert.equal(b.database, "INDO");
  assert.deepEqual(b.collections.map((c) => c.name), ["empty", "machines"]);
  assert.deepEqual(b.collections[1].indexes, [{ key: { name: 1 }, name: "name_1", unique: true }]);
  assert.equal(summarize(b).documents, 1);
});

test("serialize → parse keeps ObjectIds, Dates, decimals and numbers exactly", async () => {
  const b = await dumpDatabase(source());
  const back = parseBackup(serializeBackup(b));
  const doc = back.collections[1].docs[0];
  assert.ok(doc._id instanceof ObjectId && doc._id.equals(id));
  assert.ok(doc.createdAt instanceof Date && doc.createdAt.getTime() === when.getTime());
  assert.equal(doc.cycleSec, 57.5);
  assert.equal(doc.count, 3);
  assert.equal(doc.big.toString(), "1.10");
  assert.ok(back.takenAt instanceof Date);
});

test("a file that isn't ours is refused", () => {
  assert.throws(() => parseBackup(Buffer.from("hello")), /Not an INDO backup/);
  const zlib = require("node:zlib");
  assert.throws(() => parseBackup(zlib.gzipSync(Buffer.from('{"format":"other"}'))), /Not an INDO backup/);
});

test("restore fills an empty database, refuses one with data unless dropped", async () => {
  const b = parseBackup(serializeBackup(await dumpDatabase(source())));
  const empty = fakeDb("INDO_copy", {});
  const s = await restoreDatabase(empty, b);
  assert.equal(s.documents, 1);
  assert.deepEqual(Object.keys(empty.store).sort(), ["empty", "machines"]);
  assert.ok(empty.store.machines.docs[0]._id.equals(id));
  assert.deepEqual(empty.store.machines.indexes, [{ key: { name: 1 }, name: "name_1", unique: true }]);

  const filled = fakeDb("INDO", { machines: { docs: [{ name: "old" }] } });
  await assert.rejects(restoreDatabase(filled, b), /isn't empty .*machines.*restore with drop/);
  assert.equal(filled.store.machines.docs[0].name, "old", "nothing written");

  await restoreDatabase(filled, b, { drop: true });
  assert.equal(filled.store.machines.docs.length, 1);
  assert.equal(filled.store.machines.docs[0].name, "CNC 7B");
});

test("file names carry the IST date and time, and are recognised", () => {
  // 21:00 UTC on the 27th is 02:30 IST on the 28th.
  assert.equal(backupFileName("INDO", new Date("2026-11-27T21:00:00.000Z")), "INDO-2026-11-28_0230.json.gz");
  assert.equal(dateOfFile("INDO-2026-11-28_0230.json.gz", "INDO"), "2026-11-28");
  assert.equal(dateOfFile("OTHER-2026-11-28_0230.json.gz", "INDO"), null);
  assert.equal(dateOfFile("notes.txt", "INDO"), null);
});

test("the standby address must name a database and must not be the main one", () => {
  const { parseTarget, sameDatabase } = require("../jobs/dbBackup");
  assert.deepEqual(parseTarget("mongodb://127.0.0.1:27017/INDO_backup"), { host: "127.0.0.1:27017", database: "INDO_backup" });
  assert.deepEqual(parseTarget("mongodb+srv://u:p@cluster0.abc.mongodb.net/INDO_backup?retryWrites=true"), { host: "cluster0.abc.mongodb.net", database: "INDO_backup" });
  assert.throws(() => parseTarget("mongodb://127.0.0.1:27017"), /needs the database name/);
  assert.throws(() => parseTarget("https://example.com/INDO"), /isn't a MongoDB address/);
  const main = { host: "127.0.0.1:27017", database: "INDO" };
  assert.ok(sameDatabase(parseTarget("mongodb://127.0.0.1:27017/INDO"), main));
  assert.ok(!sameDatabase(parseTarget("mongodb://127.0.0.1:27017/INDO_backup"), main));
  assert.ok(!sameDatabase(parseTarget("mongodb://other-host:27017/INDO"), main));
});

test("retention keeps 30 days of dailies and the first file of every older month", () => {
  const f = (d, t = "0230") => `INDO-${d}_${t}.json.gz`;
  const files = [
    f("2026-11-28"), f("2026-11-27"), f("2026-10-30"), // within 30 days of 28 Nov
    f("2026-10-28"), // exactly 31 days back → older
    f("2026-10-01"), f("2026-10-02"), f("2026-10-15"),
    f("2026-09-03"), f("2026-09-03", "1800"), f("2026-09-20"),
    "README.txt", "OTHER-2026-09-01_0230.json.gz",
  ];
  const gone = filesToDelete(files, "INDO", { today: "2026-11-28", keepDays: 30 });
  assert.deepEqual(gone.sort(), [f("2026-09-03", "1800"), f("2026-09-20"), f("2026-10-02"), f("2026-10-15"), f("2026-10-28")].sort());
  // Nothing to delete when everything is recent.
  assert.deepEqual(filesToDelete([f("2026-11-28"), f("2026-11-01")], "INDO", { today: "2026-11-28" }), []);
});

test("uploaded files ride in the backup and come back byte for byte; existing files are left alone; nothing escapes the folder", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { restoreUploads, safeUploadPath } = require("./dbBackup");
  const from = fs.mkdtempSync(path.join(os.tmpdir(), "indo-up-"));
  const to = fs.mkdtempSync(path.join(os.tmpdir(), "indo-up-"));
  try {
    fs.mkdirSync(path.join(from, "profile"));
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x10, 0x80]);
    fs.writeFileSync(path.join(from, "profile", "a.jpg"), jpeg);
    fs.writeFileSync(path.join(from, "logo.png"), "png");
    fs.writeFileSync(path.join(from, ".DS_Store"), "skip me");

    const backup = parseBackup(serializeBackup(await dumpDatabase(source(), { uploadsDir: from })));
    const s = summarize(backup);
    assert.equal(s.files, 2);
    assert.equal(s.fileBytes, jpeg.length + 3);

    fs.writeFileSync(path.join(to, "logo.png"), "newer");
    assert.equal(restoreUploads(to, backup), 1);
    assert.deepEqual(fs.readFileSync(path.join(to, "profile", "a.jpg")), jpeg);
    assert.equal(fs.readFileSync(path.join(to, "logo.png"), "utf8"), "newer");
    assert.equal(safeUploadPath(to, "../../etc/passwd"), null);
    // An old backup with no uploads still reads.
    assert.equal(summarize(parseBackup(serializeBackup(await dumpDatabase(source())))).files, 0);
  } finally {
    fs.rmSync(from, { recursive: true, force: true });
    fs.rmSync(to, { recursive: true, force: true });
  }
});
