// Operators master is limited to the processes a role can view.
const test = require("node:test");
const assert = require("node:assert/strict");
const MachineOperator = require("../models/MachineOperator");
const Process = require("../models/Process");
const OperatorRoles = require("../models/OperatorRoles");
const MenuMaster = require("../models/MenuMaster");
const { listMachineOperatorsByParams, createMachineOperator } = require("./machineOperator.controller");

const P1 = "64b0c0ffee0000000000d001", P2 = "64b0c0ffee0000000000d002";
const chain = (v) => { const c = { select: () => c, lean: async () => v, then: (r) => r(v) }; return c; };
const call = async (fn, req) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
  await fn(req, res);
  return res;
};

test("a role that views one process sees only that process's operators", async () => {
  Process.find = () => chain([{ _id: P1, processName: "CNC", isActive: true }, { _id: P2, processName: "VMC", isActive: true }]);
  OperatorRoles.findOne = () => chain({ roles: [{ view: true, menuId: "m1" }] });
  MenuMaster.find = () => chain([{ menuUrl: "/hqepl/production/cnc-data-entry" }]);
  Process.countDocuments = async () => 1;
  let seen;
  MachineOperator.countDocuments = async (q) => { seen = q; return 1; };
  MachineOperator.find = () => ({ collation() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, populate() { return this; }, lean: async () => [{ name: "A", processes: [{ _id: P1, processName: "CNC" }, { _id: P2, processName: "VMC" }] }] });
  const r = await call(listMachineOperatorsByParams, { user: { roleType: "Operator", roleId: "r" }, body: {} });
  assert.deepEqual(seen.processes, { $in: [P1] });
  assert.deepEqual(r.payload.data[0].data[0].processes.map((p) => p.processName), ["CNC"]);
  const bad = await call(createMachineOperator, { user: { roleType: "Operator", roleId: "r" }, body: { name: "B", processes: [P2] } });
  assert.equal(bad.statusCode, 403);
  const sa = await call(listMachineOperatorsByParams, { user: { roleType: "SuperAdmin" }, body: {} });
  assert.equal(sa.payload.data[0].data[0].processes.length, 2);
});
