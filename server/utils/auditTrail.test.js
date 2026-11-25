// The audit trail helper: how changes are worked out, and that writing a row
// never fails the request it describes — run against a stand-in for the model
// (no database is touched):  node --test utils/
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const AuditLog = require("../models/AuditLog");
const { recordAudit, diffChanges, requestMeta, searchText, MODULE_LABELS, ACTION_LABELS, ENTITY_TYPES, ACTIONS } = require("./auditTrail");

const SUPER_ADMIN = { _id: "64b0c0ffee0000000000a001", roleType: "SuperAdmin", name: "HQEPL Admin", constructor: { modelName: "User" } };

// Stubs AuditLog.create for one test; `seen` collects the rows written.
const withLog = async (fn, create) => {
  const seen = [];
  const orig = AuditLog.create;
  AuditLog.create = create || (async (row) => (seen.push(row), { ...row, _id: "log1" }));
  try {
    await fn(seen);
  } finally {
    AuditLog.create = orig;
  }
};

test("the model exports one module and action list, each with a label", () => {
  assert.equal(ENTITY_TYPES.length, 27);
  assert.ok(ENTITY_TYPES.includes("entry") && ENTITY_TYPES.includes("notRunning") && ENTITY_TYPES.includes("auth"));
  for (const k of ENTITY_TYPES) assert.ok(MODULE_LABELS[k]);
  for (const k of ACTIONS) assert.ok(ACTION_LABELS[k]);
  assert.equal(ACTION_LABELS.marked, "Marked Not running");
  assert.equal(AuditLog.schema.path("entityType").enumValues.length, ENTITY_TYPES.length);
  assert.ok(!AuditLog.schema.path("entity").isRequired);
  assert.ok(AuditLog.schema.path("search"));
});

test("diffChanges: nested paths, ids as text, Yes / No, unchanged fields left out", () => {
  const id = new mongoose.Types.ObjectId();
  const before = { name: "A", meta: { colour: "red" }, process: id, active: true, same: 1, list: ["x"] };
  const after = { name: "A", meta: { colour: "blue" }, process: String(id), active: false, same: 1, list: ["x", "y"] };
  const changes = diffChanges(before, after, { name: "Name", "meta.colour": "Colour", process: "Process", active: "Active", same: "Same", list: "List" });
  assert.deepEqual(changes, [
    { field: "meta.colour", label: "Colour", from: "red", to: "blue" },
    { field: "active", label: "Active", from: "Yes", to: "No" },
    { field: "list", label: "List", from: "x", to: "x, y" },
  ]);
  // An array of paths labels each by its path; with no fields, every key is compared.
  assert.deepEqual(diffChanges({ a: 1 }, { a: 2 }, ["a"]), [{ field: "a", label: "a", from: 1, to: 2 }]);
  assert.deepEqual(diffChanges({ a: 1, _id: "x" }, { a: 1, b: "", _id: "y" }), []);
});

test("diffChanges: a create shows every field from null, a delete every field to null; dates as ISO", () => {
  const d = new Date("2026-11-20T00:00:00.000Z");
  assert.deepEqual(diffChanges(null, { name: "Lathe", when: d, blank: "" }, { name: "Name", when: "When", blank: "Blank" }, "create"), [
    { field: "name", label: "Name", from: null, to: "Lathe" },
    { field: "when", label: "When", from: null, to: "2026-11-20T00:00:00.000Z" },
  ]);
  assert.deepEqual(diffChanges({ name: "Lathe", active: true }, null, { name: "Name", active: "Active" }, "delete"), [
    { field: "name", label: "Name", from: "Lathe", to: null },
    { field: "active", label: "Active", from: "Yes", to: null },
  ]);
  // A mongoose-style document is read through toObject().
  assert.deepEqual(diffChanges({ toObject: () => ({ a: 1 }) }, { toObject: () => ({ a: 2 }) }, ["a"]), [{ field: "a", label: "a", from: 1, to: 2 }]);
});

test("requestMeta: the app says so in its body or header; the address comes from the proxy first", () => {
  assert.deepEqual(requestMeta({ body: {}, headers: {}, ip: "10.0.0.5" }), { client: "web", ip: "10.0.0.5" });
  assert.deepEqual(requestMeta({ body: { client: "app" }, headers: {}, ip: "10.0.0.5" }), { client: "app", ip: "10.0.0.5" });
  assert.deepEqual(requestMeta({ body: {}, headers: { "x-client": "app", "x-forwarded-for": "1.2.3.4, 10.0.0.1" }, ip: "10.0.0.5" }), { client: "app", ip: "1.2.3.4" });
  assert.deepEqual(requestMeta(undefined), { client: "", ip: "" });
});

test("recordAudit fills module, client, ip, actor and search, and returns the row", async () => {
  await withLog(async (seen) => {
    const req = { user: SUPER_ADMIN, body: {}, headers: {}, ip: "10.0.0.9" };
    const row = await recordAudit({ req, entityType: "machine", entity: "64b0c0ffee0000000000bbbb", label: "VMC-1", action: "update", before: { machineName: "VMC-1", isActive: true }, after: { machineName: "VMC-1", isActive: false }, fields: { machineName: "Machine", isActive: "Active" }, remark: "Switched off" });
    assert.ok(row);
    assert.equal(seen.length, 1);
    const w = seen[0];
    assert.equal(w.module, "Machine Master");
    assert.equal(w.client, "web");
    assert.equal(w.ip, "10.0.0.9");
    assert.equal(w.actor.name, "HQEPL Admin");
    assert.equal(w.actor.role, "Super Admin");
    assert.equal(w.actor.model, "User");
    assert.deepEqual(w.changes, [{ field: "isActive", label: "Active", from: "Yes", to: "No" }]);
    assert.equal(w.search, searchText(w));
    for (const needle of ["vmc-1", "hqepl admin", "switched off", "active", "yes", "no"]) assert.ok(w.search.includes(needle), needle);
  });
});

test("recordAudit skips an update that changed nothing, unless a remark says why", async () => {
  await withLog(async (seen) => {
    const req = { user: SUPER_ADMIN, body: {}, headers: {} };
    assert.equal(await recordAudit({ req, entityType: "vendor", entity: "v1", action: "update", before: { name: "A" }, after: { name: "A" }, fields: ["name"] }), null);
    assert.equal(seen.length, 0);
    assert.ok(await recordAudit({ req, entityType: "vendor", entity: "v1", action: "update", before: { name: "A" }, after: { name: "A" }, fields: ["name"], remark: "Re-saved" }));
    assert.equal(seen.length, 1);
    // A create with nothing in it is still a row.
    assert.ok(await recordAudit({ req, entityType: "vendor", action: "create", after: {}, fields: ["name"] }));
  });
});

test("recordAudit never throws: a model that rejects, or a missing request, gives null", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    await withLog(
      async () => {
        assert.equal(await recordAudit({ req: { user: SUPER_ADMIN, body: {}, headers: {} }, entityType: "machine", action: "create", after: { a: 1 } }), null);
      },
      async () => {
        throw new Error("database down");
      },
    );
    assert.equal(await recordAudit(), null);
  } finally {
    console.error = quiet;
  }
});

test("with nobody signed in the given actor is used (a failed sign-in names the username typed)", async () => {
  await withLog(async (seen) => {
    await recordAudit({ req: { body: { username: "ravi", password: "Secret123" }, headers: {} }, entityType: "auth", action: "loginFailed", label: "ravi", actor: { name: "ravi" }, remark: "Wrong password" });
    assert.equal(seen[0].actor.name, "ravi");
    assert.equal(seen[0].entity, null);
    assert.equal(seen[0].module, "Sign in / Sign out");
    assert.ok(!JSON.stringify(seen[0]).includes("Secret123"));
  });
});
