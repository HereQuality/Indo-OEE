// The Part Master's edit history: what a create / edit / delete leaves behind, and how it is read back.
// Run against stand-ins for the models (no database is touched):  node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const Item = require("../models/Item");
const ItemLog = require("../models/ItemLog");
const Process = require("../models/Process");
const { createItem, updateItem, deleteItem, listItemLogs } = require("./item.controller");
const itemRoutes = require("../routes/item.routes");

const VMC = "64b0c0ffee0000000000aaaa";

const call = async (handler, req) => {
  const res = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
  await handler(req, res);
  return res;
};

// A logged-in Operator, the way the auth middleware hands one over (its model is its class).
class OperatorDoc {
  static modelName = "Operator";
  constructor(o) {
    Object.assign(this, o);
  }
}
const ravi = new OperatorDoc({ _id: "u1", employeeName: "Ravi" });

// A part as the database returns it: its fields, plus toObject() and save() that aren't among them.
const record = (fields) => {
  const doc = { ...fields };
  const hidden = {
    saves: 0,
    toObject: () => ({ ...doc }),
    async save() {
      this.saves += 1;
      return this;
    },
  };
  for (const [name, value] of Object.entries(hidden)) Object.defineProperty(doc, name, { value, writable: true, enumerable: false });
  return doc;
};
// A saved part: Flange, drawing DRG-1, setup S-1, 180 s, active — with `o` laid over it.
const stored = (o = {}) => record({ _id: "i1", itemName: "Flange", drawingNo: "DRG-1", setupNo: "S-1", totalCycleSec: 180, isActive: true, ...o });
// Mongo leaves out the keys of an update (or insert) that are undefined.
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// Stubs the models for one test. `seen.logs` collects the history rows written; `part` is what
// Item.findById finds (null = no such part).
const withModels = async ({ part = null, createLog } = {}, fn) => {
  const seen = { logs: [], deleted: null, processLookup: null, part };
  const restore = [];
  const stub = (obj, name, impl) => {
    const orig = obj[name];
    obj[name] = impl;
    restore.push(() => (obj[name] = orig));
  };
  stub(Process, "exists", async (q) => (String(q._id) === VMC ? { _id: VMC } : null));
  stub(Process, "find", (q) => {
    seen.processLookup = q;
    return { select: () => ({ lean: async () => [{ _id: VMC, processName: "VMC" }] }) };
  });
  stub(Item, "create", async (doc) => record({ _id: "i1", isActive: true, ...defined(doc) }));
  stub(Item, "findById", async () => seen.part);
  stub(Item, "findByIdAndUpdate", async (id, update) => (seen.part ? record({ ...seen.part.toObject(), ...defined(update) }) : null));
  stub(Item, "findByIdAndDelete", async (id) => {
    seen.deleted = id;
  });
  stub(ItemLog, "create", createLog || (async (row) => seen.logs.push(row)));
  try {
    await fn(seen);
  } finally {
    restore.forEach((r) => r());
  }
};

test("creating a part logs everything it was created with, and who made it", async () => {
  await withModels({}, async (seen) => {
    const res = await call(createItem, { user: ravi, body: { itemName: "Flange", process: VMC, drawingNo: "DRG-1", programTimeMin: "6", pcsPerProgram: "2", totalCycleSec: 180 } });
    assert.equal(res.statusCode, 201);
    assert.equal(seen.logs.length, 1);
    const [log] = seen.logs;
    assert.equal(log.action, "create");
    assert.equal(log.item, "i1");
    assert.deepEqual({ n: log.itemName, d: log.drawingNo, s: log.setupNo }, { n: "Flange", d: "DRG-1", s: "" });
    assert.deepEqual(log.actor, { id: "u1", model: "Operator", name: "Ravi" });
    assert.ok(log.changes.every((c) => c.from === null), "a create has nothing before it");
    const byField = Object.fromEntries(log.changes.map((c) => [c.field, c.to]));
    assert.equal(byField.itemName, "Flange");
    assert.equal(byField.process, "VMC", "the process by name, not id");
    assert.equal(byField.programTimeMin, 6);
    assert.equal(byField.totalCycleSec, 180);
    assert.deepEqual(seen.processLookup, { _id: { $in: [VMC] } });
  });
});

test("an edit logs only what it changed, old → new", async () => {
  await withModels({ part: stored() }, async (seen) => {
    // setupNo isn't sent, so it stays S-1 — and isn't a change.
    const res = await call(updateItem, { user: ravi, params: { itemId: "i1" }, body: { itemName: "Flange", drawingNo: "DRG-2", totalCycleSec: 200 } });
    assert.equal(res.statusCode, 200);
    assert.equal(seen.logs.length, 1);
    const [log] = seen.logs;
    assert.equal(log.action, "update");
    assert.equal(log.item, "i1");
    assert.equal(log.drawingNo, "DRG-2", "the part as it is named after the edit");
    assert.deepEqual(log.changes, [
      { field: "drawingNo", label: "Drawing No.", from: "DRG-1", to: "DRG-2" },
      { field: "totalCycleSec", label: "Total Cycle Time (sec)", from: 180, to: 200 },
    ]);
    assert.equal(log.actor.name, "Ravi");
  });
});

test("a save that changes nothing leaves no row", async () => {
  await withModels({ part: stored() }, async (seen) => {
    const res = await call(updateItem, { user: ravi, params: { itemId: "i1" }, body: { itemName: "Flange", drawingNo: "DRG-1  ", totalCycleSec: "180" } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(seen.logs, []);
  });
});

test("moving a part to another process is logged by process name", async () => {
  await withModels({ part: stored() }, async (seen) => {
    await call(updateItem, { user: ravi, params: { itemId: "i1" }, body: { itemName: "Flange", process: VMC } });
    assert.deepEqual(seen.logs[0].changes, [{ field: "process", label: "Process", from: null, to: "VMC" }]);
  });
});

test("an edit that only switches Is Active is a deactivate, and back a restore", async () => {
  await withModels({ part: stored() }, async (seen) => {
    await call(updateItem, { user: ravi, params: { itemId: "i1" }, body: { itemName: "Flange", isActive: false } });
    assert.equal(seen.logs[0].action, "deactivate");
    assert.deepEqual(seen.logs[0].changes, [{ field: "isActive", label: "Status", from: "Active", to: "Inactive" }]);
  });
  await withModels({ part: stored({ isActive: false }) }, async (seen) => {
    await call(updateItem, { user: ravi, params: { itemId: "i1" }, body: { itemName: "Flange", isActive: true } });
    assert.equal(seen.logs[0].action, "restore");
    // Brought back and changed in one go: that's an update, with Status among the changes.
    seen.logs.length = 0;
    seen.part = stored({ isActive: false });
    await call(updateItem, { user: ravi, params: { itemId: "i1" }, body: { itemName: "Flange", isActive: true, drawingNo: "DRG-9" } });
    assert.equal(seen.logs[0].action, "update");
    assert.deepEqual(seen.logs[0].changes.map((c) => c.field), ["drawingNo", "isActive"]);
  });
});

test("the first delete deactivates the part, the second deletes it — each is logged", async () => {
  const part = stored();
  await withModels({ part }, async (seen) => {
    const first = await call(deleteItem, { user: ravi, params: { itemId: "i1" } });
    assert.equal(first.payload.message, "Item deactivated successfully");
    assert.equal(part.saves, 1);
    assert.equal(seen.logs.length, 1);
    assert.equal(seen.logs[0].action, "deactivate");
    assert.deepEqual(seen.logs[0].changes, [{ field: "isActive", label: "Status", from: "Active", to: "Inactive" }]);

    const second = await call(deleteItem, { user: ravi, params: { itemId: "i1" } });
    assert.equal(second.payload.message, "Item deleted successfully");
    assert.equal(seen.deleted, part._id);
    assert.equal(seen.logs.length, 2);
    const gone = seen.logs[1];
    assert.equal(gone.action, "delete");
    assert.equal(gone.item, "i1", "kept against the part's id even though the part is gone");
    assert.equal(gone.itemName, "Flange");
    assert.ok(gone.changes.length > 0 && gone.changes.every((c) => c.from !== null && c.to === null), "what the part held when it was removed");
    assert.equal(gone.changes.find((c) => c.field === "drawingNo").from, "DRG-1");
  });
});

test("a part that isn't there is a 404 and nothing is logged", async () => {
  await withModels({ part: null }, async (seen) => {
    const res = await call(updateItem, { user: ravi, params: { itemId: "nope" }, body: { itemName: "Flange" } });
    assert.equal(res.statusCode, 404);
    const del = await call(deleteItem, { user: ravi, params: { itemId: "nope" } });
    assert.equal(del.statusCode, 404);
    assert.deepEqual(seen.logs, []);
  });
});

test("a history row that can't be written doesn't turn a saved part into an error", async () => {
  const log = console.error;
  console.error = () => {};
  try {
    await withModels({ part: stored(), createLog: async () => { throw new Error("db down"); } }, async () => {
      const made = await call(createItem, { user: ravi, body: { itemName: "Flange" } });
      assert.equal(made.statusCode, 201);
      const edited = await call(updateItem, { user: ravi, params: { itemId: "i1" }, body: { itemName: "Flange 2" } });
      assert.equal(edited.statusCode, 200);
    });
  } finally {
    console.error = log;
  }
});

// ── Reading it back ──────────────────────────────────────────────────────────
const withLogs = async (fn) => {
  const seen = { query: null, sort: null, skip: null, limit: null };
  const rows = [{ _id: "l2", action: "update" }, { _id: "l1", action: "create" }];
  const orig = { find: ItemLog.find, count: ItemLog.countDocuments };
  ItemLog.countDocuments = async (q) => {
    seen.query = q;
    return 7;
  };
  ItemLog.find = () => {
    const chain = {
      sort: (s) => ((seen.sort = s), chain),
      skip: (n) => ((seen.skip = n), chain),
      limit: (n) => ((seen.limit = n), chain),
      lean: async () => rows,
    };
    return chain;
  };
  try {
    await fn(seen, rows);
  } finally {
    ItemLog.find = orig.find;
    ItemLog.countDocuments = orig.count;
  }
};

test("one part's history comes back newest first, with the total for paging", async () => {
  await withLogs(async (seen, rows) => {
    const res = await call(listItemLogs, { params: { itemId: VMC }, query: {} });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { isOk: true, data: rows, total: 7 });
    assert.deepEqual(seen.query, { item: VMC });
    assert.deepEqual(seen.sort, { createdAt: -1, _id: -1 });
    assert.deepEqual([seen.skip, seen.limit], [0, 50]);
  });
});

test("without a part it is every part's history — where a deleted part's is found", async () => {
  await withLogs(async (seen) => {
    await call(listItemLogs, { params: {}, query: {} });
    assert.deepEqual(seen.query, {});
  });
});

test("paging: skip and limit are read, kept in range, and junk falls back to the defaults", async () => {
  await withLogs(async (seen) => {
    await call(listItemLogs, { params: {}, query: { skip: "50", limit: "25" } });
    assert.deepEqual([seen.skip, seen.limit], [50, 25]);
    await call(listItemLogs, { params: {}, query: { skip: "-5", limit: "99999" } });
    assert.deepEqual([seen.skip, seen.limit], [0, 200]);
    await call(listItemLogs, { params: {}, query: { skip: "x", limit: "0" } });
    assert.deepEqual([seen.skip, seen.limit], [0, 50]);
    await call(listItemLogs, { params: {} });
    assert.deepEqual([seen.skip, seen.limit], [0, 50], "no query string at all");
  });
});

test("an item id that isn't one is a 400", async () => {
  await withLogs(async () => {
    const res = await call(listItemLogs, { params: { itemId: "nope" }, query: {} });
    assert.equal(res.statusCode, 400);
  });
});

test("the history routes need Part Master read access, and /logs is matched before /:itemId", () => {
  const routes = itemRoutes.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, method: Object.keys(l.route.methods)[0], depth: l.route.stack.length }));
  const at = (path) => routes.findIndex((r) => r.path === path && r.method === "get");
  assert.ok(at("/logs") !== -1 && at("/:itemId/logs") !== -1);
  assert.ok(at("/logs") < at("/:itemId"), "else 'logs' would be read as an item id");
  // A permission check sits in front of the handler (two layers: it and the handler), like the other reads.
  assert.equal(routes[at("/logs")].depth, 2);
  assert.equal(routes[at("/:itemId/logs")].depth, 2);
});
