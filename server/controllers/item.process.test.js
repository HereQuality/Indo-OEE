// Items belong to a process: how a save carries it, and how the list narrows by it.
// Run against stand-ins for the models (no database is touched):  node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const Item = require("../models/Item");
const ItemLog = require("../models/ItemLog");
const Process = require("../models/Process");
const { createItem, updateItem, listItemByParams } = require("./item.controller");

const VMC = "64b0c0ffee0000000000aaaa";
const NOPE = "64b0c0ffee0000000000bbbb";

const call = async (handler, req) => {
  const res = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
  await handler(req, res);
  return res;
};

// Stubs Item/Process for one test; `seen` records what the controller asked of them.
const withModels = async (fn) => {
  const seen = { created: null, updated: null, query: null };
  const restore = [];
  const stub = (obj, name, impl) => {
    const orig = obj[name];
    obj[name] = impl;
    restore.push(() => (obj[name] = orig));
  };
  stub(Process, "exists", async (q) => (String(q._id) === VMC ? { _id: VMC } : null));
  stub(Item, "create", async (doc) => {
    seen.created = doc;
    return { _id: "i1", ...doc };
  });
  stub(Item, "findById", async (id) => ({ _id: id, itemName: "Flange" }));
  stub(Item, "findByIdAndUpdate", async (id, doc) => {
    seen.updated = doc;
    return { _id: id, ...doc };
  });
  // Each save also adds a row to the part's history (item.log.test.js covers that).
  stub(Process, "find", () => ({ select: () => ({ lean: async () => [] }) }));
  stub(ItemLog, "create", async (row) => row);
  stub(Item, "countDocuments", async (q) => {
    seen.query = q;
    return 0;
  });
  stub(Item, "find", () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) }));
  try {
    await fn(seen);
  } finally {
    restore.forEach((r) => r());
  }
};

test("a part saves with its process, and the blank choice clears it", async () => {
  await withModels(async (seen) => {
    const res = await call(createItem, { body: { itemName: "Flange", process: VMC } });
    assert.equal(res.statusCode, 201);
    assert.equal(seen.created.process, VMC);

    await call(updateItem, { params: { itemId: "i1" }, body: { itemName: "Flange", process: "" } });
    assert.equal(seen.updated.process, null, "Not in any process");
  });
});

test("a save that doesn't mention process leaves it alone", async () => {
  await withModels(async (seen) => {
    await call(updateItem, { params: { itemId: "i1" }, body: { itemName: "Flange" } });
    assert.equal("process" in seen.updated, false);
  });
});

test("a process that doesn't exist is refused and nothing is saved", async () => {
  await withModels(async (seen) => {
    for (const process of [NOPE, "not-an-id"]) {
      const res = await call(createItem, { body: { itemName: "Flange", process } });
      assert.equal(res.statusCode, 400, process);
      assert.equal(res.payload.message, "Process not found");
    }
    assert.equal(seen.created, null);
  });
});

test("a VMC part's program is saved as numbers, blanks as unset", async () => {
  await withModels(async (seen) => {
    await call(createItem, { body: { itemName: "Flange", process: VMC, programTimeMin: "6", pcsPerProgram: "2", totalCycleSec: 180 } });
    assert.equal(seen.created.programTimeMin, 6);
    assert.equal(seen.created.pcsPerProgram, 2);
    assert.equal(seen.created.totalCycleSec, 180);

    await call(updateItem, { params: { itemId: "i1" }, body: { itemName: "Flange", programTimeMin: "", pcsPerProgram: "" } });
    assert.equal(seen.updated.programTimeMin, null);
    assert.equal(seen.updated.pcsPerProgram, null);
  });
});

test("the list narrows to one process, to parts in none, or lists everything", async () => {
  await withModels(async (seen) => {
    await call(listItemByParams, { body: { process: VMC } });
    assert.equal(seen.query.process, VMC);

    await call(listItemByParams, { body: { process: "none" } });
    assert.equal(seen.query.process, null, "null matches parts with no process, set or missing");

    await call(listItemByParams, { body: { process: "" } });
    assert.equal("process" in seen.query, false);
    await call(listItemByParams, { body: {} });
    assert.equal("process" in seen.query, false);

    const bad = await call(listItemByParams, { body: { process: "nope" } });
    assert.equal(bad.statusCode, 400);
  });
});
