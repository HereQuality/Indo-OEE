const test = require("node:test");
const assert = require("node:assert");
const ShiftLockAccess = require("../models/ShiftLockAccess");
const adminAccess = require("./adminAccess");
const { canChangeShift, validOperatorIds } = require("./shiftAccess");

const stub = (value) => { ShiftLockAccess.findOne = () => ({ select: () => ({ lean: async () => value }) }); };
const sa = { user: { roleType: "SuperAdmin", _id: "000000000000000000000001" } };
const op = (id) => ({ user: { roleType: "Operator", _id: id, roleId: "r" } });

test("Super Admin may always change the shift", async () => {
  stub({ operators: [] });
  assert.equal(await canChangeShift(sa), true);
});

test("once a list is saved, only listed operators may", async () => {
  stub({ operators: ["a1"] });
  assert.equal(await canChangeShift(op("a1")), true);
  assert.equal(await canChangeShift(op("b2")), false);
});

test("a listed role gives its members access", async () => {
  stub({ operators: [], roles: ["r9"] });
  assert.equal(await canChangeShift({ user: { roleType: "Operator", _id: "z", roleId: "r9" } }), true);
  assert.equal(await canChangeShift({ user: { roleType: "Operator", _id: "z", roleId: { _id: "r9" } } }), true);
  assert.equal(await canChangeShift({ user: { roleType: "Operator", _id: "z", roleId: "r1" } }), false);
});

test("an empty saved list lets nobody but the Super Admin", async () => {
  stub({ operators: [] });
  assert.equal(await canChangeShift(op("a1")), false);
});

test("before any list is saved, the Full access rule applies", async () => {
  stub(null);
  const req = { ...op("a1"), _access: { isAdmin: true } };
  assert.equal(await canChangeShift(req), true);
  assert.equal(await canChangeShift({ ...op("a1"), _access: { isAdmin: false } }), false);
});

test("operator ids must be valid", () => {
  assert.equal(validOperatorIds(["000000000000000000000001"]), true);
  assert.equal(validOperatorIds(["nope"]), false);
  assert.equal(validOperatorIds("x"), false);
});
