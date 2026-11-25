// The Audit Trail API: how its filters become a query, its paging cap and its
// CSV export — plus two of the hooks that feed it (Not running marks, a failed
// sign-in). Run against stand-ins for the models (no database is touched):
//   node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const AuditLog = require("../models/AuditLog");
const MachineDayStatus = require("../models/MachineDayStatus");
const Machine = require("../models/Machine");
const MachineOperator = require("../models/MachineOperator");
const User = require("../models/user.model");
const Operator = require("../models/Operator");
const { _buildQuery: buildQuery, _paging: paging, _csvRows: csvRows, _toCsv: toCsv, _istStamp: istStamp, CSV_HEADER, list, exportCsv } = require("./auditTrail.controller");
const { upsert, remove } = require("./machineDayStatus.controller");
const { login } = require("./auth.controller");

const SUPER_ADMIN = { _id: "64b0c0ffee0000000000a001", roleType: "SuperAdmin", name: "HQEPL Admin", constructor: { modelName: "User" } };
const MACHINE = "64b0c0ffee0000000000aaaa";

const call = async (handler, req) => {
  const res = {
    statusCode: 200, payload: null, headers: {}, body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    send(b) { this.body = b; return this; },
  };
  await handler(req, res, (e) => { throw e; });
  return res;
};
const chain = (v) => ({ select: () => chain(v), sort: () => chain(v), skip: () => chain(v), limit: () => chain(v), populate: () => chain(v), lean: async () => v, then: (ok, ko) => Promise.resolve(v).then(ok, ko) });

// Swaps model methods for one test and puts them back after.
const withStubs = async (stubs, fn) => {
  const restore = [];
  for (const [obj, name, impl] of stubs) {
    const orig = obj[name];
    obj[name] = impl;
    restore.push(() => (obj[name] = orig));
  }
  try {
    await fn();
  } finally {
    restore.forEach((r) => r());
  }
};

// ── Filters ──────────────────────────────────────────────────────────────
test("from / to are IST calendar days on createdAt", () => {
  const { query } = buildQuery({ from: "2026-11-20", to: "2026-11-21" });
  assert.equal(query.createdAt.$gte.toISOString(), "2026-11-19T18:30:00.000Z");
  assert.equal(query.createdAt.$lte.toISOString(), "2026-11-21T18:29:59.999Z");
  assert.ok(buildQuery({ from: "20/11/2026" }).error);
  assert.equal(buildQuery({}).query.createdAt, undefined);
});

test("module and action take comma lists; actor / entity / machine must be ids; q searches the search text", () => {
  const actor = new mongoose.Types.ObjectId();
  const { query } = buildQuery({ module: "entry, notRunning", action: "marked,unmarked", actor: String(actor), sheet: "vmc", date: "2026-11-20", q: "  VMC-1 (A) " });
  assert.deepEqual(query.entityType, { $in: ["entry", "notRunning"] });
  assert.deepEqual(query.action, { $in: ["marked", "unmarked"] });
  assert.equal(String(query["actor.id"]), String(actor));
  assert.equal(query.sheet, "vmc");
  assert.equal(query.date, "2026-11-20");
  // Lowercased and escaped, so "(" can't break it and the match is case-insensitive.
  assert.deepEqual(query.search, { $regex: "vmc-1 \\(a\\)" });
  assert.ok(buildQuery({ actor: "not-an-id" }).error);
  assert.ok(buildQuery({ entity: "x" }).error);
  assert.ok(buildQuery({ machine: "x" }).error);
});

test("paging: 50 a page by default, 200 at most, never a negative skip", () => {
  assert.deepEqual(paging({}), { skip: 0, limit: 50 });
  assert.deepEqual(paging({ skip: "-5", limit: "1000" }), { skip: 0, limit: 200 });
  assert.deepEqual(paging({ skip: "20", limit: "0" }), { skip: 20, limit: 50 });
});

test("GET /audit-trail answers { isOk, data, total } from the query it built", async () => {
  let seenQuery = null;
  await withStubs(
    [
      [AuditLog, "countDocuments", async (q) => ((seenQuery = q), 3)],
      [AuditLog, "find", () => chain([{ label: "a" }, { label: "b" }])],
    ],
    async () => {
      const res = await call(list, { query: { module: "machine", limit: "2" } });
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.total, 3);
      assert.equal(res.payload.data.length, 2);
      assert.deepEqual(seenQuery, { entityType: { $in: ["machine"] } });
      const bad = await call(list, { query: { from: "nope" } });
      assert.equal(bad.statusCode, 400);
    },
  );
});

// ── CSV ──────────────────────────────────────────────────────────────────
test("the CSV header is exactly the agreed columns, prefixed with a BOM", () => {
  assert.deepEqual(CSV_HEADER, ["Date & time (IST)", "Module", "Action", "Record", "Sheet", "Record date", "Machine", "Field", "From", "To", "Remark", "User", "Role", "Client"]);
  const csv = toCsv([]);
  assert.ok(csv.startsWith("﻿"));
  assert.equal(csv, "﻿" + CSV_HEADER.join(",") + "\r\n");
});

test("one CSV row per change, one row for a log with none, dates in IST, quotes / commas / newlines escaped", () => {
  const at = new Date("2026-11-20T18:30:00.000Z"); // 21 Nov 00:00 IST
  const rows = csvRows([
    {
      createdAt: at, entityType: "entry", module: "Data Entry", action: "update", label: "VMC · VMC-1 · 20/11/2026 · Entry 1", sheet: "vmc", date: "2026-11-20", machineName: "VMC-1",
      changes: [{ field: "okQty", label: "OK Quantity", from: 10, to: 12 }, { field: "remarks", label: "Remarks", from: null, to: 'He said "go", then\nleft' }],
      remark: "", actor: { name: "Asha, R", role: "Admin" }, client: "app",
    },
    { createdAt: at, entityType: "auth", action: "login", label: "mann", changes: [], remark: "Web", actor: { name: "Mann", role: "Admin" }, client: "web" },
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ["21/11/2026 00:00:00", "Data Entry", "Edited", "VMC · VMC-1 · 20/11/2026 · Entry 1", "VMC", "20/11/2026", "VMC-1", "OK Quantity", 10, 12, "", "Asha, R", "Admin", "app"]);
  assert.deepEqual(rows[2], ["21/11/2026 00:00:00", "Sign in / Sign out", "Signed in", "mann", "", "", "", "", null, null, "Web", "Mann", "Admin", "web"]);
  const lines = toCsv(rows).split("\r\n");
  assert.equal(lines[1], '21/11/2026 00:00:00,Data Entry,Edited,VMC · VMC-1 · 20/11/2026 · Entry 1,VMC,20/11/2026,VMC-1,OK Quantity,10,12,,"Asha, R",Admin,app');
  // The newline inside a quoted cell stays inside its cell (rows end with \r\n).
  assert.equal(lines[2], '21/11/2026 00:00:00,Data Entry,Edited,VMC · VMC-1 · 20/11/2026 · Entry 1,VMC,20/11/2026,VMC-1,Remarks,,"He said ""go"", then\nleft",,"Asha, R",Admin,app');
  assert.equal(lines[3], "21/11/2026 00:00:00,Sign in / Sign out,Signed in,mann,,,,,,,Web,Mann,Admin,web");
  assert.equal(lines[4], "");
  assert.equal(istStamp("2026-01-01T20:00:00.000Z"), "02/01/2026 01:30:00");
});

test("GET /audit-trail/export.csv sets the CSV headers and file name", async () => {
  await withStubs([[AuditLog, "find", () => chain([])]], async () => {
    const res = await call(exportCsv, { query: { from: "2026-11-01", to: "2026-11-30" } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Content-Type"], "text/csv; charset=utf-8");
    assert.equal(res.headers["Content-Disposition"], 'attachment; filename="audit-trail-2026-11-01_2026-11-30.csv"');
    assert.ok(res.body.startsWith("﻿Date & time (IST)"));
  });
});

// ── Hooks ────────────────────────────────────────────────────────────────
test("marking a machine Not running writes a 'marked' row with its reasons joined; undoing it an 'unmarked' row", async () => {
  const logs = [];
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const mark = { _id: "m1", sheet: "vmc", date: today, machine: MACHINE, reason: "holiday", reasons: ["holiday", "power"], remarks: "Grid off", createdAt: new Date(), toObject() { return { ...this }; } };
  await withStubs(
    [
      [AuditLog, "create", async (row) => (logs.push(row), row)],
      [MachineDayStatus, "find", () => chain([])],
      [MachineDayStatus, "findOne", () => chain(mark)],
      [MachineDayStatus, "findOneAndUpdate", async () => mark],
      [MachineDayStatus, "deleteOne", async () => ({ deletedCount: 1 })],
      [Machine, "find", () => chain([{ _id: MACHINE, machineName: "VMC-1" }])],
      [MachineOperator, "find", () => chain([])],
    ],
    async () => {
      const req = { user: SUPER_ADMIN, body: { sheet: "vmc", date: today, machines: [MACHINE], reasons: ["holiday", "power"], remarks: "Grid off", client: "app" }, headers: {}, query: {} };
      const res = await call(upsert, req);
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.equal(logs.length, 1);
      const [row] = logs;
      assert.equal(row.entityType, "notRunning");
      assert.equal(row.action, "marked");
      assert.equal(row.module, "Not running marks");
      assert.equal(row.sheet, "vmc");
      assert.equal(row.date, today);
      assert.equal(row.machineName, "VMC-1");
      assert.equal(row.label, `VMC-1 · ${today.split("-").reverse().join("/")}`);
      assert.equal(row.client, "app");
      assert.deepEqual(row.changes, [
        { field: "reasons", label: "Reasons", from: null, to: "Holiday / plant off, Power cut" },
        { field: "remarks", label: "Remarks", from: null, to: "Grid off" },
      ]);
      assert.ok(row.search.includes("power cut"));

      const undone = await call(remove, { user: SUPER_ADMIN, body: { sheet: "vmc", date: today, machine: MACHINE }, headers: {}, query: {} });
      assert.equal(undone.statusCode, 200);
      assert.equal(logs.length, 2);
      assert.equal(logs[1].action, "unmarked");
      assert.deepEqual(logs[1].changes, [
        { field: "reasons", label: "Reasons", from: "Holiday / plant off, Power cut", to: null },
        { field: "remarks", label: "Remarks", from: "Grid off", to: null },
      ]);
    },
  );
});

test("a failed sign-in writes 'loginFailed' with the username typed and no password anywhere in the row", async () => {
  const logs = [];
  const account = { _id: "64b0c0ffee0000000000c001", username: "ravi", employeeName: "Ravi", roleId: { roleName: "Operator" }, loginAttempts: 0, isLocked: false, comparePassword: async () => false, async save() {} };
  await withStubs(
    [
      [AuditLog, "create", async (row) => (logs.push(row), row)],
      [User, "findOne", () => chain(null)],
      [Operator, "findOne", () => chain(account)],
    ],
    async () => {
      const res = await call(login, { body: { username: "ravi", password: "Secret123!" }, headers: {}, ip: "10.0.0.7" });
      assert.equal(res.statusCode, 401);
      assert.equal(logs.length, 1);
      const [row] = logs;
      assert.equal(row.entityType, "auth");
      assert.equal(row.action, "loginFailed");
      assert.equal(row.label, "ravi");
      assert.equal(String(row.entity), account._id);
      assert.equal(row.actor.name, "Ravi");
      assert.equal(row.remark, "Wrong password");
      assert.equal(row.ip, "10.0.0.7");
      assert.ok(!JSON.stringify(row).includes("Secret123"));
      assert.ok(!/attempt/i.test(row.remark));
    },
  );
  // An unknown username: no account, the name typed is all there is.
  await withStubs(
    [
      [AuditLog, "create", async (row) => (logs.push(row), row)],
      [User, "findOne", () => chain(null)],
      [Operator, "findOne", () => chain(null)],
    ],
    async () => {
      const res = await call(login, { body: { username: "ghost", password: "x" }, headers: {} });
      assert.equal(res.statusCode, 401);
      const row = logs[logs.length - 1];
      assert.equal(row.entity, null);
      assert.equal(row.label, "ghost");
      assert.equal(row.actor.name, "ghost");
      assert.equal(row.remark, "Unknown username");
    },
  );
});

test("an employee's audit view never carries the password, hash, OTP, lock or sign-in attempts", async () => {
  const Department = require("../models/Department");
  const Team = require("../models/Team");
  const RoleMaster = require("../models/RoleMaster");
  const { _employeeView } = require("./operator.controller");
  const DEPT = "64b0c0ffee0000000000d001";
  await withStubs(
    [
      [Department, "find", () => chain([{ _id: DEPT, departmentName: "Quality" }])],
      [Team, "find", () => chain([])],
      [RoleMaster, "find", () => chain([])],
      [Operator, "find", () => chain([])],
    ],
    async () => {
      const view = await _employeeView({
        _id: "e1", employeeName: "Ravi", username: "ravi", departmentIds: [DEPT], roleId: null, isActive: true, isBlocked: false,
        password: "$2a$10$hash", passwordHash: "h", otp: "123456", resetPasswordOtp: "abc", otpExpires: new Date(), resetToken: "t", loginAttempts: 2, lockUntil: new Date(), tokens: ["x"], preferences: { themeMode: "dark" },
      });
      assert.deepEqual(view.departmentIds, ["Quality"]);
      assert.equal(view.employeeName, "Ravi");
      const text = JSON.stringify(view);
      for (const secret of ["$2a$10$hash", "password", "otp", "123456", "resetToken", "loginAttempts", "lockUntil", "tokens", "preferences", "themeMode"]) assert.ok(!text.includes(secret), secret);
    },
  );
});
