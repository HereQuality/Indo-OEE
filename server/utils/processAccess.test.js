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
  assert.equal(pageOf({ processName: "PRINTING", dataEntryMenu: null }), "/production/printing-data-entry");
  assert.equal(pageOf({ processName: "INJECTION MOULDING", dataEntryMenu: null }), "/production/injection-moulding-data-entry");
  assert.equal(pageOf({ processName: "EMBOSSING", dataEntryMenu: null }), "/production/embossing-data-entry");
  assert.equal(pageOf({ processName: "Something Else", dataEntryMenu: null }), null);
});

test("EMBOSSING is its own page — never taken for another process, nor another for it", () => {
  const EMB = "/production/embossing-data-entry";
  assert.equal(pageOf({ processName: "Embossing", dataEntryMenu: null }), EMB);
  const others = {
    CNC: "/production/cnc-data-entry",
    VMC: "/production/vmc-data-entry",
    SPM: "/production/spm-data-entry",
    RIVET: "/production/rivet-data-entry",
    PRESS: "/production/press-data-entry",
    CONTACT: "/production/contact-data-entry",
    TROBE: "/production/trobe-data-entry",
    "SPRING FOR PINS": "/production/spring-data-entry",
    "AFTER POWDER COATING": "/production/powder-coating-data-entry",
    RUBBER: "/production/rubber-data-entry",
    PRINTING: "/production/printing-data-entry",
    "INJECTION MOULDING": "/production/injection-moulding-data-entry",
    "BEFORE POWDER COATING": "/production/before-powder-coating-data-entry",
    "RAW CASTING": "/production/raw-casting-data-entry",
    "MODULAR FRAME DRILLING": "/production/modular-frame-drilling-data-entry",
  };
  for (const [processName, page] of Object.entries(others)) assert.equal(pageOf({ processName, dataEntryMenu: null }), page, processName);
  // A linked process goes by its page, whatever its name.
  assert.equal(pageOf({ processName: "EMBOSSING", dataEntryMenu: "/hqepl/production/cnc-data-entry" }), "/hqepl/production/cnc-data-entry");
  assert.equal(pageOf({ processName: "Anything", dataEntryMenu: `/hqepl${EMB}` }), `/hqepl${EMB}`);
});

test("BEFORE POWDER COATING is its own page, not AFTER POWDER COATING's", () => {
  assert.equal(pageOf({ processName: "BEFORE POWDER COATING", dataEntryMenu: null }), "/production/before-powder-coating-data-entry");
  assert.equal(pageOf({ processName: "AFTER POWDER COATING", dataEntryMenu: null }), "/production/powder-coating-data-entry");
});

test("RAW CASTING is its own page — never taken for another process, nor another for it", () => {
  const RAW = "/production/raw-casting-data-entry";
  assert.equal(pageOf({ processName: "RAW CASTING", dataEntryMenu: null }), RAW);
  assert.equal(pageOf({ processName: "Raw  Casting", dataEntryMenu: null }), RAW);
  const others = {
    CNC: "/production/cnc-data-entry",
    VMC: "/production/vmc-data-entry",
    SPM: "/production/spm-data-entry",
    RIVET: "/production/rivet-data-entry",
    PRESS: "/production/press-data-entry",
    CONTACT: "/production/contact-data-entry",
    TROBE: "/production/trobe-data-entry",
    "SPRING FOR PINS": "/production/spring-data-entry",
    "AFTER POWDER COATING": "/production/powder-coating-data-entry",
    RUBBER: "/production/rubber-data-entry",
    PRINTING: "/production/printing-data-entry",
    "INJECTION MOULDING": "/production/injection-moulding-data-entry",
    "BEFORE POWDER COATING": "/production/before-powder-coating-data-entry",
  };
  for (const [processName, page] of Object.entries(others)) assert.equal(pageOf({ processName, dataEntryMenu: null }), page, processName);
  // A linked process goes by its page, whatever its name.
  assert.equal(pageOf({ processName: "RAW CASTING", dataEntryMenu: "/hqepl/production/powder-coating-data-entry" }), "/hqepl/production/powder-coating-data-entry");
  assert.equal(pageOf({ processName: "Anything", dataEntryMenu: `/hqepl${RAW}` }), `/hqepl${RAW}`);
});

test("MODULAR FRAME DRILLING is its own page — never taken for another process, nor another for it", () => {
  const MFD = "/production/modular-frame-drilling-data-entry";
  assert.equal(pageOf({ processName: "MODULAR FRAME DRILLING", dataEntryMenu: null }), MFD);
  assert.equal(pageOf({ processName: "Modular  Frame Drilling", dataEntryMenu: null }), MFD);
  // Only the whole name: a bare "DRILLING" (or a CNC drilling process) is not it.
  assert.equal(pageOf({ processName: "DRILLING", dataEntryMenu: null }), null);
  assert.equal(pageOf({ processName: "MODULAR FRAME", dataEntryMenu: null }), null);
  assert.equal(pageOf({ processName: "CNC DRILLING", dataEntryMenu: null }), "/production/cnc-data-entry");
  const others = {
    CNC: "/production/cnc-data-entry",
    VMC: "/production/vmc-data-entry",
    SPM: "/production/spm-data-entry",
    RIVET: "/production/rivet-data-entry",
    PRESS: "/production/press-data-entry",
    CONTACT: "/production/contact-data-entry",
    TROBE: "/production/trobe-data-entry",
    "SPRING FOR PINS": "/production/spring-data-entry",
    "AFTER POWDER COATING": "/production/powder-coating-data-entry",
    RUBBER: "/production/rubber-data-entry",
    PRINTING: "/production/printing-data-entry",
    "INJECTION MOULDING": "/production/injection-moulding-data-entry",
    "BEFORE POWDER COATING": "/production/before-powder-coating-data-entry",
    "RAW CASTING": "/production/raw-casting-data-entry",
  };
  for (const [processName, page] of Object.entries(others)) assert.equal(pageOf({ processName, dataEntryMenu: null }), page, processName);
  // A linked process goes by its page, whatever its name.
  assert.equal(pageOf({ processName: "MODULAR FRAME DRILLING", dataEntryMenu: "/hqepl/production/cnc-data-entry" }), "/hqepl/production/cnc-data-entry");
  assert.equal(pageOf({ processName: "Anything", dataEntryMenu: `/hqepl${MFD}` }), `/hqepl${MFD}`);
});

test("FINAL ASSEMBLY is its own page — never MODULAR FRAME ASSEMBLY's, nor that one FINAL ASSEMBLY's", () => {
  const FA = "/production/final-assembly-data-entry";
  assert.equal(pageOf({ processName: "FINAL ASSEMBLY", dataEntryMenu: null }), FA);
  assert.equal(pageOf({ processName: "Final  Assembly", dataEntryMenu: null }), FA);
  assert.notEqual(pageOf({ processName: "MODULAR FRAME ASSEMBLY", dataEntryMenu: null }), FA);
  assert.notEqual(pageOf({ processName: "ASSEMBLY", dataEntryMenu: null }), FA);
});

test("MODULAR FRAME ASSEMBLY is its own page — never MODULAR FRAME DRILLING's or FINAL ASSEMBLY's, nor theirs it", () => {
  const MFA = "/production/modular-frame-assembly-data-entry";
  assert.equal(pageOf({ processName: "MODULAR FRAME ASSEMBLY", dataEntryMenu: null }), MFA);
  assert.equal(pageOf({ processName: "Modular  Frame Assembly", dataEntryMenu: null }), MFA);
  assert.equal(pageOf({ processName: "MODULAR FRAME DRILLING", dataEntryMenu: null }), "/production/modular-frame-drilling-data-entry");
  assert.equal(pageOf({ processName: "FINAL ASSEMBLY", dataEntryMenu: null }), "/production/final-assembly-data-entry");
  for (const processName of ["MODULAR FRAME", "FRAME ASSEMBLY", "ASSEMBLY", "RAW CASTING", "CNC", "PRINTING"]) {
    assert.notEqual(pageOf({ processName, dataEntryMenu: null }), MFA, processName);
  }
  // A linked process goes by its page, whatever its name.
  assert.equal(pageOf({ processName: "MODULAR FRAME ASSEMBLY", dataEntryMenu: "/hqepl/production/modular-frame-drilling-data-entry" }), "/hqepl/production/modular-frame-drilling-data-entry");
});
