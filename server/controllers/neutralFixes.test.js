// Rule-neutral server fixes (QC audit WEB-003, API-005, API-012). No database is touched:
//   node --test controllers/neutralFixes.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../models/user.model");
const Operator = require("../models/Operator");
const Process = require("../models/Process");
const MenuMaster = require("../models/MenuMaster");
const Machine = require("../models/Machine");
const OperatorRoles = require("../models/OperatorRoles");
const { login } = require("./auth.controller");
const { createMachine, updateMachine } = require("./machine.controller");
const { createOperatorRoles, updateOperatorRoles } = require("./operatorRoles.controller");
const { strictNumber, isBlankNumber } = require("../utils/strictNumber");

const fakeRes = () => ({
  statusCode: 200,
  payload: null,
  status(c) { this.statusCode = c; return this; },
  json(p) { this.payload = p; return this; },
});
const quietly = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};
const stub = (obj, name, fn) => {
  const orig = obj[name];
  obj[name] = fn;
  return () => { obj[name] = orig; };
};

// ── WEB-003: login ─────────────────────────────────────────────────────────
test("login: unknown username and wrong password answer the same status and body", async () => {
  const noUser = { select: async () => null };
  const noOp = { populate() { return this; }, select: async () => null };
  const account = {
    isBlocked: false, isActive: true, isLocked: false, loginAttempts: 0, roleType: "SuperAdmin",
    comparePassword: async () => false,
    save: async () => {},
  };
  const restores = [];
  try {
    restores.push(stub(User, "findOne", () => noUser), stub(Operator, "findOne", () => noOp));
    const a = fakeRes();
    await login({ body: { username: "nobody", password: "x" } }, a);

    restores.push(stub(User, "findOne", () => ({ select: async () => account })));
    const b = fakeRes();
    await login({ body: { username: "real", password: "wrong" } }, b);
    assert.equal(b.statusCode, 401);
    assert.deepEqual(b.payload, a.payload);
    assert.equal(b.payload.message, "Incorrect username or password");
    assert.equal(b.payload.attemptsRemaining, undefined);
    assert.equal(account.loginAttempts, 1, "the failed attempt is still counted");

    // 2nd and 3rd failures: counted, and the 3rd locks (reset to 0 + lockUntil), as before
    await login({ body: { username: "real", password: "wrong" } }, fakeRes());
    assert.equal(account.loginAttempts, 2);
    const c = fakeRes();
    await login({ body: { username: "real", password: "wrong" } }, c);
    assert.equal(c.statusCode, 401);
    assert.match(c.payload.message, /locked/i);
    assert.equal(account.loginAttempts, 0);
    assert.ok(account.lockUntil > Date.now());
  } finally {
    restores.reverse().forEach((r) => r());
  }
});

// ── API-005: strict numbers ────────────────────────────────────────────────
test("strictNumber: numbers and plain decimal text pass; booleans, arrays, hex and words do not", () => {
  for (const [v, n] of [[5, 5], ["5", 5], ["5.5", 5.5], ["-1.5", -1.5], ["+2", 2], [" 7 ", 7], [".5", 0.5], ["1e3", 1000], [0, 0], ["0", 0]]) {
    assert.equal(strictNumber(v), n, String(v));
  }
  for (const v of [true, false, [5], [], {}, "0x10", "0b1", "0o7", "Infinity", "-Infinity", "NaN", "abc", "1,5", "5 5", Infinity, NaN, undefined, "1e999"]) {
    assert.ok(!Number.isFinite(strictNumber(v)), String(v));
  }
  for (const v of [null, "", "   "]) assert.equal(isBlankNumber(v), true);
  for (const v of [0, "0", true, [5]]) assert.equal(isBlankNumber(v), false);
});

test("sheet buildFields: strict numbers via the controllers' own parse", async () => {
  const sheets = ["vmc", "spm", "rivet", "press", "contact", "trobe", "spring", "injection", "embossing", "mfd", "mfa", "bpc", "printing", "rubber", "rawCasting", "finalAssembly", "powderCoating", "production"];
  const fs = require("node:fs");
  const path = require("node:path");
  for (const s of sheets) {
    const src = fs.readFileSync(path.join(__dirname, `${s}Sheet.controller.js`), "utf8");
    assert.ok(src.includes("strictNumber(body[k])") && src.includes("isBlankNumber(body[k])"), `${s} uses the strict parse`);
    assert.ok(!/const n = Number\(body\[k\]\)/.test(src), `${s} has no loose parse left`);
  }
});

// ── API-012: dangling references ───────────────────────────────────────────
const OID = "64b000000000000000000001";

test("machine create/update: a process id that does not exist is a 400 'Process not found'", async () => {
  const restores = [stub(Process, "exists", async () => null), stub(Machine, "exists", async () => null)];
  let created = false;
  restores.push(stub(Machine, "create", async () => { created = true; throw new Error("should not reach"); }));
  try {
    for (const [fn, req] of [
      [createMachine, { body: { machineName: "M1", process: OID }, user: {} }],
      [updateMachine, { params: { machineId: OID }, body: { machineName: "M1", process: OID }, user: {} }],
    ]) {
      const res = fakeRes();
      await quietly(() => fn(req, res));
      assert.equal(res.statusCode, 400);
      assert.equal(res.payload.message, "Process not found");
    }
    assert.equal(created, false);
  } finally {
    restores.reverse().forEach((r) => r());
  }
});

test("machine create: an existing process, or none, is not refused by the check", async () => {
  for (const [exists, body] of [[async () => ({ _id: OID }), { machineName: "M2", process: OID }], [async () => null, { machineName: "M3" }], [async () => null, { machineName: "M4", process: "" }]]) {
    let reached = false;
    const restores = [
      stub(Process, "exists", exists),
      stub(Machine, "exists", async () => null),
      stub(Machine, "create", async () => { reached = true; throw new Error("stop here"); }),
    ];
    try {
      const res = fakeRes();
      await quietly(() => createMachine({ body, user: {} }, res));
      assert.equal(reached, true, JSON.stringify(body));
      assert.notEqual(res.payload.message, "Process not found");
    } finally {
      restores.reverse().forEach((r) => r());
    }
  }
});

test("operator roles create/update: a menuId that does not exist is a 400 'Menu not found'", async () => {
  let wrote = false;
  const restores = [
    stub(MenuMaster, "countDocuments", async () => 0),
    stub(OperatorRoles, "findOne", () => ({ select: () => ({ lean: async () => null }) })),
    stub(OperatorRoles, "create", async () => { wrote = true; return {}; }),
    stub(OperatorRoles, "findOneAndUpdate", async () => { wrote = true; return {}; }),
  ];
  try {
    const roles = [{ menuId: OID, view: true }];
    for (const [fn, req] of [
      [createOperatorRoles, { body: { roleId: OID, roles }, user: {} }],
      [updateOperatorRoles, { params: { roleId: OID }, body: { roles }, user: {} }],
    ]) {
      const res = fakeRes();
      await quietly(() => fn(req, res));
      assert.equal(res.statusCode, 400);
      assert.equal(res.payload.message, "Menu not found");
    }
    assert.equal(wrote, false);
  } finally {
    restores.reverse().forEach((r) => r());
  }
});

test("operator roles update: existing menus, empty menuId and no roles go through as before", async () => {
  for (const roles of [[{ menuId: OID, view: true }], [{ menuId: null, view: true }, { view: true }], undefined]) {
    let wrote = false;
    const restores = [
      stub(MenuMaster, "countDocuments", async () => 1),
      stub(OperatorRoles, "findOne", () => ({ select: () => ({ lean: async () => null }) })),
      stub(OperatorRoles, "findOneAndUpdate", async () => { wrote = true; return { roles }; }),
    ];
    try {
      const res = fakeRes();
      await quietly(() => updateOperatorRoles({ params: { roleId: OID }, body: { roles }, user: {} }, res));
      assert.equal(wrote, true);
      assert.equal(res.statusCode, 200);
    } finally {
      restores.reverse().forEach((r) => r());
    }
  }
});
