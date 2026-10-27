// Server bug-fix checks (QC audit API-007..API-011, API-016): the error handler's
// client errors, bad ids and paging on the master controllers, login input types,
// the review controller's prototype keys, machine colour, and text-only fields.
// No database is touched:  node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const { globalErrorHandler } = require("../middlewares/errorHandler");
const { sendError, pageParams } = require("../utils/httpErrors");
const { insertNewEntry } = require("../utils/insertEntry");
const Machine = require("../models/Machine");
const Vendor = require("../models/Vendor");
const MachineOperator = require("../models/MachineOperator");
const { getVendorById, createVendor, listVendorsByParams } = require("./vendor.controller");
const { getMachineById } = require("./machine.controller");
const { getProcessById } = require("./process.controller");
const { getItemById } = require("./item.controller");
const { getRoleById } = require("./roleMaster.controller");
const { getOperatorRoles } = require("./operatorRoles.controller");
const { markNotificationRead } = require("./notification.controller");
const { createMachineOperator } = require("./machineOperator.controller");
const { login } = require("./auth.controller");
const { decide, reopen, applyShift } = require("./oeeReview.controller");

const fakeRes = () => ({
  statusCode: 200,
  payload: null,
  status(c) {
    this.statusCode = c;
    return this;
  },
  json(p) {
    this.payload = p;
    return this;
  },
});
const quietly = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
};

// ── API-008: the error handler ─────────────────────────────────────────────
const inProduction = async (fn) => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    return await fn();
  } finally {
    process.env.NODE_ENV = prev;
  }
};
const handle = (err) =>
  inProduction(() => {
    const res = fakeRes();
    globalErrorHandler(err, {}, res, () => {});
    return res;
  });

test("error handler: malformed JSON from body-parser is a 400, with no stack", async () => {
  const err = Object.assign(new SyntaxError("Unexpected token } in JSON at position 5"), {
    status: 400,
    statusCode: 400,
    expose: true,
    type: "entity.parse.failed",
    body: "{bad}",
  });
  const res = await handle(err);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.success, false);
  assert.match(res.payload.message, /Invalid JSON/);
  assert.equal(JSON.stringify(res.payload).includes("stack"), false);
  assert.equal(JSON.stringify(res.payload).includes("{bad}"), false);
});

test("error handler: an oversized body is a 413", async () => {
  const err = Object.assign(new Error("request entity too large"), { status: 413, statusCode: 413, expose: true, type: "entity.too.large" });
  const res = await handle(err);
  assert.equal(res.statusCode, 413);
  assert.match(res.payload.message, /too large/i);
});

test("error handler: any other 4xx keeps its status and a safe message", async () => {
  const exposed = await handle(Object.assign(new Error("unsupported charset \"X\""), { status: 415, statusCode: 415, expose: true }));
  assert.equal(exposed.statusCode, 415);
  assert.match(exposed.payload.message, /charset/);
  const hidden = await handle(Object.assign(new Error("internal detail /srv/app.js"), { status: 400, expose: false }));
  assert.equal(hidden.statusCode, 400);
  assert.equal(hidden.payload.message, "Bad request");
});

test("error handler: a real server error stays a 500 and hides its message", async () => {
  const res = await quietly(() => handle(new Error("db exploded at /srv/app.js")));
  assert.equal(res.statusCode, 500);
  assert.match(res.payload.message, /Something went wrong/);
  assert.equal(JSON.stringify(res.payload).includes("exploded"), false);
});

// ── API-009: bad ids, bad input, paging ────────────────────────────────────
test("sendError: CastError and ValidationError are 400, own 4xx kept, the rest 500", () => {
  let res = sendError(fakeRes(), Object.assign(new Error("Cast to ObjectId failed"), { name: "CastError" }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.message, "Invalid id");
  res = sendError(fakeRes(), Object.assign(new Error("Machine No. is required"), { name: "ValidationError" }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.message, "Machine No. is required");
  assert.equal(sendError(fakeRes(), Object.assign(new Error("nope"), { status: 404 })).statusCode, 404);
  assert.equal(sendError(fakeRes(), new Error("boom")).statusCode, 500);
});

test("pageParams: skip >= 0 and a page size of 1..max", () => {
  assert.deepEqual(pageParams(-5, -1), { skip: 0, limit: 1 });
  assert.deepEqual(pageParams("abc", "xyz"), { skip: 0, limit: 10 });
  assert.deepEqual(pageParams(20, 100), { skip: 20, limit: 100 });
  assert.deepEqual(pageParams(0, 999999), { skip: 0, limit: 200 });
  assert.deepEqual(pageParams(0, 1000, { max: 1000 }), { skip: 0, limit: 1000 });
});

test("master controllers answer 400 Invalid id for a malformed id", async () => {
  const cases = [
    [getVendorById, { params: { vendorId: "zzz" } }],
    [getMachineById, { params: { machineId: "zzz" } }],
    [getProcessById, { params: { processId: "zzz" } }],
    [getItemById, { params: { itemId: "zzz" } }],
    [getRoleById, { params: { roleId: "zzz" } }],
    [getOperatorRoles, { params: { roleId: "zzz" } }],
    [markNotificationRead, { params: { id: "zzz" }, user: { _id: "64b0c0ffee0000000000a001", constructor: { modelName: "User" } } }],
  ];
  for (const [handler, req] of cases) {
    const res = fakeRes();
    await quietly(() => handler({ body: {}, query: {}, ...req }, res));
    assert.equal(res.statusCode, 400, `${handler.name || "handler"}: ${JSON.stringify(res.payload)}`);
    assert.equal(res.payload.message, "Invalid id");
  }
});

test("search handlers clamp skip and per_page before the query", async () => {
  let seen = null;
  const chain = {
    collation: () => chain,
    sort: () => chain,
    skip(n) {
      seen = { skip: n };
      return chain;
    },
    limit(n) {
      seen.limit = n;
      return chain;
    },
    populate: () => chain,
    lean: async () => [],
  };
  const origFind = Vendor.find;
  const origCount = Vendor.countDocuments;
  Vendor.find = () => chain;
  Vendor.countDocuments = async () => 0;
  try {
    const res = fakeRes();
    await listVendorsByParams({ body: { skip: -50, per_page: 99999999 } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(seen, { skip: 0, limit: 200 });
    await listVendorsByParams({ body: { skip: 30, per_page: 25 } }, res);
    assert.deepEqual(seen, { skip: 30, limit: 25 });
  } finally {
    Vendor.find = origFind;
    Vendor.countDocuments = origCount;
  }
});

// ── API-010: login ─────────────────────────────────────────────────────────
test("login: a non-string username or password is a 400, not a 500", async () => {
  for (const body of [
    { username: { $ne: null }, password: { $ne: null } },
    { username: ["a"], password: "x" },
    { username: "admin", password: { $gt: "" } },
    { email: 12345, password: "x" },
  ]) {
    const res = fakeRes();
    await login({ body }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.doesNotMatch(res.payload.message, /toLowerCase/);
  }
});

// ── API-011: prototype keys as the sheet name ──────────────────────────────
test("review decisions: constructor / __proto__ / toString / hasOwnProperty are not sheets", async () => {
  const ID = "64b0c0ffee0000000000cccc";
  for (const sheet of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    for (const handler of [decide, reopen, applyShift]) {
      const res = fakeRes();
      await handler({ params: { sheet, id: ID }, body: { decision: "approved" }, query: {}, user: {} }, res);
      assert.equal(res.statusCode, 400, `${handler.name} ${sheet}: ${JSON.stringify(res.payload)}`);
      assert.equal(res.payload.message, "Invalid entry");
    }
  }
});

// ── API-016: machine colour ────────────────────────────────────────────────
test("Machine.color: a hex colour or blank is fine, anything else is a validation error", () => {
  const check = (color) => new Machine({ machineName: "7A", color }).validateSync();
  for (const ok of ["", "#FFC000", "#fff", "#A9D08E", "#ffffff80"]) assert.equal(check(ok), undefined, ok);
  for (const bad of ["red", "FFC000", "#12", "#GGGGGG", "<script>", "url(x)", "#FFC0001"]) {
    assert.match(check(bad)?.message || "", /Colour must be a hex colour/, bad);
  }
  assert.equal(new Machine({ machineName: "7A" }).validateSync(), undefined, "colour left out");
});

// ── API-007: names of vendors / operators must be text ─────────────────────
test("vendor and operator create: an object or array name is a 400, nothing stored", async () => {
  const origV = Vendor.create;
  const origO = MachineOperator.create;
  let created = 0;
  Vendor.create = MachineOperator.create = async () => (created += 1);
  try {
    for (const [handler, label] of [[createVendor, "Vendor"], [createMachineOperator, "Operator"]]) {
      for (const name of [{ $ne: null }, ["a"], { a: 1 }]) {
        const res = fakeRes();
        await handler({ body: { name, processes: ["64b0c0ffee0000000000dddd"] } }, res);
        assert.equal(res.statusCode, 400, JSON.stringify(name));
        assert.equal(res.payload.message, `${label} name must be text`);
      }
    }
    assert.equal(created, 0);
  } finally {
    Vendor.create = origV;
    MachineOperator.create = origO;
  }
});

// ── API-001: a new entry never overwrites a racing one ─────────────────────
const dup = () => Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
const fakeModel = ({ failTimes, taken }) => {
  const calls = [];
  const rows = taken.map((slot) => ({ slot }));
  return {
    calls,
    create: async (doc) => {
      calls.push(doc.slot);
      if (calls.length <= failTimes) throw dup();
      return { toObject: () => ({ _id: "x", ...doc }) };
    },
    find: () => ({ select: () => ({ lean: async () => rows }) }),
  };
};

test("insertNewEntry: inserts straight away when the slot is free", async () => {
  const M = fakeModel({ failTimes: 0, taken: [] });
  const r = await insertNewEntry(M, { filter: {}, slots: [1, 2, 3], slotNo: 1, payload: { a: 1 } });
  assert.equal(r.doc.slot, 1);
  assert.deepEqual(M.calls, [1]);
});

test("insertNewEntry: on a duplicate-key error it takes the next free slot", async () => {
  const M = fakeModel({ failTimes: 1, taken: [1] });
  const r = await insertNewEntry(M, { filter: {}, slots: [1, 2, 3], slotNo: 1, payload: { a: 1 } });
  assert.equal(r.doc.slot, 2);
  assert.deepEqual(M.calls, [1, 2]);
});

test("insertNewEntry: reports full once every slot is taken, and rethrows other errors", async () => {
  const full = fakeModel({ failTimes: 9, taken: [1, 2, 3] });
  assert.deepEqual(await insertNewEntry(full, { filter: {}, slots: [1, 2, 3], slotNo: 1, payload: {} }), { full: true });
  const broken = { create: async () => { throw new Error("disk"); }, find: () => ({}) };
  await assert.rejects(insertNewEntry(broken, { filter: {}, slots: [1], slotNo: 1, payload: {} }), /disk/);
});

test("insertNewEntry: a retry that now overlaps the winner's times is refused, not saved twice", async () => {
  const M = fakeModel({ failTimes: 1, taken: [1] });
  const r = await insertNewEntry(M, {
    filter: {},
    slots: [1, 2, 3],
    slotNo: 1,
    payload: {},
    recheck: async () => "This machine already has an entry from 08:00-10:00",
  });
  assert.deepEqual(r, { clash: "This machine already has an entry from 08:00-10:00" });
  assert.deepEqual(M.calls, [1], "nothing inserted after the clash");
});
