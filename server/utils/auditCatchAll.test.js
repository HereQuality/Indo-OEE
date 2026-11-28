// The audit catch-all (middlewares/auditCatchAll.middleware.js): which
// requests it logs, and what the generic row says. No database is touched.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const AuditLog = require("../models/AuditLog");
const { auditCatchAll, describeRequest, shouldLog } = require("../middlewares/auditCatchAll.middleware");

const fakeReq = (method, url, extra = {}) => ({ method, originalUrl: url, headers: {}, body: {}, ip: "10.0.0.9", ...extra });
const fakeRes = (statusCode) => Object.assign(new EventEmitter(), { statusCode });

test("describeRequest: module from the first segment, action from the method or the last word", () => {
  assert.deepEqual(describeRequest("POST", "/tickets"), { entityType: "ticket", action: "create", label: "/tickets", entity: null });
  const reply = describeRequest("POST", "/tickets/64b0c0ffee0000000000a001/reply");
  assert.equal(reply.entityType, "ticket");
  assert.equal(reply.action, "update");
  assert.equal(reply.label, "Reply");
  assert.equal(reply.entity, "64b0c0ffee0000000000a001");
  assert.equal(describeRequest("DELETE", "/machines/64b0c0ffee0000000000a001").action, "delete");
  assert.equal(describeRequest("PUT", "/vmc-sheet/row").entityType, "entry");
  assert.equal(describeRequest("POST", "/summary-mail/send").action, "sent");
  assert.equal(describeRequest("POST", "/kpi/objectives/import").action, "import");
  assert.equal(describeRequest("PUT", "/something-new").entityType, "other");
  for (const key of ["ticket", "entry", "other", "appUpdate", "backup", "notification"]) assert.ok(AuditLog.ENTITY_TYPES.includes(key), key);
});

test("shouldLog: writes, and any request the server failed on; not already logged, not searches / sign-in calls / 404s / anonymous 401s", () => {
  assert.equal(shouldLog(fakeReq("GET", "/api/v1/machines"), fakeRes(200)), false);
  assert.equal(shouldLog(fakeReq("GET", "/api/v1/machines"), fakeRes(403)), false);
  assert.equal(shouldLog(fakeReq("GET", "/api/v1/machines"), fakeRes(500)), true);
  assert.equal(shouldLog(fakeReq("POST", "/api/v1/audit-trail/page-view"), fakeRes(400)), false);
  assert.equal(shouldLog(fakeReq("PUT", "/api/v1/machines/1"), fakeRes(200)), true);
  assert.equal(shouldLog(fakeReq("PUT", "/api/v1/machines/1", { auditCtx: { audited: true } }), fakeRes(200)), false);
  assert.equal(shouldLog(fakeReq("POST", "/api/v1/menus/search"), fakeRes(200)), false);
  assert.equal(shouldLog(fakeReq("POST", "/api/v1/auth/login"), fakeRes(401)), false);
  assert.equal(shouldLog(fakeReq("PATCH", "/api/v1/notifications/read-all"), fakeRes(200)), false);
  assert.equal(shouldLog(fakeReq("DELETE", "/api/v1/nope"), fakeRes(404)), false);
  assert.equal(shouldLog(fakeReq("DELETE", "/api/v1/tickets/1"), fakeRes(401)), false);
  // A signed-in person refused, or a server error, is logged.
  assert.equal(shouldLog(fakeReq("DELETE", "/api/v1/tickets/1", { user: { _id: "x" } }), fakeRes(403)), true);
  assert.equal(shouldLog(fakeReq("POST", "/api/v1/tickets"), fakeRes(500)), true);
});

test("the middleware writes one generic row after an unlogged change, none after a logged one", async () => {
  const written = [];
  const orig = AuditLog.create;
  AuditLog.create = async (row) => (written.push(row), row);
  try {
    const req = fakeReq("POST", "/api/v1/tickets/64b0c0ffee0000000000a001/forward?x=1");
    const res = fakeRes(500);
    auditCatchAll(req, res, () => {});
    res.emit("finish");
    await new Promise((r) => setImmediate(r));
    assert.equal(written.length, 1);
    assert.equal(written[0].entityType, "ticket");
    assert.equal(written[0].success, false);
    assert.equal(written[0].statusCode, 500);
    assert.equal(written[0].path, "/api/v1/tickets/64b0c0ffee0000000000a001/forward");
    assert.match(written[0].remark, /HTTP 500/);

    const req2 = fakeReq("PUT", "/api/v1/machines/1");
    const res2 = fakeRes(200);
    auditCatchAll(req2, res2, () => {});
    req2.auditCtx.audited = true; // the controller wrote its own row
    res2.emit("finish");
    await new Promise((r) => setImmediate(r));
    assert.equal(written.length, 1);
  } finally {
    AuditLog.create = orig;
  }
});

test("a server error on a read is an Error row carrying the message the user saw", async () => {
  const written = [];
  const orig = AuditLog.create;
  AuditLog.create = async (row) => (written.push(row), row);
  try {
    const req = fakeReq("GET", "/api/v1/machines", { user: undefined });
    const res = fakeRes(200);
    res.json = () => res;
    auditCatchAll(req, res, () => {});
    res.statusCode = 500;
    res.json({ isOk: false, message: "Cannot read properties of undefined (reading 'x')" });
    res.emit("finish");
    await new Promise((r) => setImmediate(r));
    assert.equal(written.length, 1);
    assert.equal(written[0].action, "error");
    assert.equal(written[0].entityType, "machine");
    assert.equal(written[0].success, false);
    assert.match(written[0].remark, /^Server error \(HTTP 500\): Cannot read properties/);
  } finally {
    AuditLog.create = orig;
  }
});
