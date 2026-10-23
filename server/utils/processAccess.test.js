// utils/processAccess.js's rule: which processes a role may see on the
// Production Dashboard — the ones whose data-entry page it can View.
//   node --test utils/
const test = require("node:test");
const assert = require("node:assert/strict");

const MenuMaster = require("../models/MenuMaster");
const OperatorRoles = require("../models/OperatorRoles");
const { viewableProcessIds, pageOf } = require("./processAccess");

const CNC_PAGE = "/hqepl/production/cnc-data-entry";
const VMC_PAGE = "/hqepl/production/vmc-data-entry";
const CNC_MENU_ID = "64b0c0ffee000000000000c1";
const VMC_MENU_ID = "64b0c0ffee000000000000c2";
const ROLE_ID = "64b0c0ffee0000000000f00d";

const processes = [
  { _id: "64b0c0ffee000000000000a1", processName: "CNC", dataEntryMenu: CNC_PAGE, isActive: true },
  { _id: "64b0c0ffee000000000000a2", processName: "VMC", dataEntryMenu: VMC_PAGE, isActive: true },
];

const stub = (obj, name, fn) => {
  const orig = obj[name];
  obj[name] = fn;
  return () => (obj[name] = orig);
};

const chain = (rows) => ({ select: () => chain(rows), lean: async () => rows });

test("Super Admin: no limit (null)", async () => {
  const ids = await viewableProcessIds({ user: { roleType: "SuperAdmin" } }, processes);
  assert.equal(ids, null);
});

test("a role with no menus configured sees nothing", async () => {
  const restore = [
    stub(OperatorRoles, "findOne", () => chain(null)),
    stub(MenuMaster, "find", () => chain([])),
  ];
  try {
    const ids = await viewableProcessIds({ user: { roleType: "Operator", roleId: ROLE_ID } }, processes);
    assert.deepEqual([...ids], []);
  } finally {
    restore.forEach((r) => r());
  }
});

test("a role that can view only the CNC data-entry page sees only CNC", async () => {
  const restore = [
    stub(OperatorRoles, "findOne", () => chain({ roles: [{ menuId: CNC_MENU_ID, view: true }, { menuId: VMC_MENU_ID, view: false }] })),
    stub(MenuMaster, "find", () => chain([{ _id: CNC_MENU_ID, menuUrl: CNC_PAGE }])),
  ];
  try {
    const ids = await viewableProcessIds({ user: { roleType: "Operator", roleId: ROLE_ID } }, processes);
    assert.deepEqual([...ids], [String(processes[0]._id)]);
  } finally {
    restore.forEach((r) => r());
  }
});

test("a role that can view every active process's page gets no limit (null)", async () => {
  const restore = [
    stub(OperatorRoles, "findOne", () => chain({ roles: [{ menuId: CNC_MENU_ID, view: true }, { menuId: VMC_MENU_ID, view: true }] })),
    stub(MenuMaster, "find", () => chain([{ _id: CNC_MENU_ID, menuUrl: CNC_PAGE }, { _id: VMC_MENU_ID, menuUrl: VMC_PAGE }])),
  ];
  try {
    const ids = await viewableProcessIds({ user: { roleType: "Operator", roleId: ROLE_ID } }, processes);
    assert.equal(ids, null);
  } finally {
    restore.forEach((r) => r());
  }
});

test("pageOf falls back to the process name when it isn't linked to a page yet", () => {
  assert.equal(pageOf({ processName: "RUBBER", dataEntryMenu: null }), "/production/rubber-data-entry");
  assert.equal(pageOf({ processName: "Something Else", dataEntryMenu: null }), null);
});
