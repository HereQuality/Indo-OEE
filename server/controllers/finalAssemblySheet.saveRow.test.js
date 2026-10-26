// The FINAL ASSEMBLY sheet's saveRow rules, run against an in-memory stand-in
// for the models (no database is touched), with real rows from the paper sheet:
//   node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const FinalAssemblyEntry = require("../models/FinalAssemblyEntry");
const { FA_DEFECT_REASONS, MAX_SLOTS } = require("../models/FinalAssemblyEntry");
const MachineOperator = require("../models/MachineOperator");
const Process = require("../models/Process");
const Machine = require("../models/Machine");
const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const AuditLog = require("../models/AuditLog");
const User = require("../models/user.model");
const Operator = require("../models/Operator");
const RoleMaster = require("../models/RoleMaster");
const OperatorRoles = require("../models/OperatorRoles");
const { saveRow } = require("./finalAssemblySheet.controller");

const WORKER = "64b0c0ffee0000000000aaaa";
const PROCESS = "64b0c0ffee0000000000dddd";

// `others`: what every FinalAssemblyEntry.find returns — the worker's other entries on the date.
const fakeDb = ({ process = { _id: PROCESS, plannedShiftLocked: false }, existing = null, others = [] } = {}) => {
  const chain = (rows) => ({ select: () => chain(rows), sort: () => chain(rows), populate: () => chain(rows), lean: async () => rows });
  const saved = [];
  const logs = [];
  return {
    saved,
    logs,
    install() {
      const restore = [];
      const stub = (obj, name, fn) => {
        const orig = obj[name];
        obj[name] = fn;
        restore.push(() => (obj[name] = orig));
      };
      stub(MachineOperator, "findOne", () => chain({ _id: WORKER, name: "ALKESH" }));
      stub(MachineOperator, "find", () => chain([{ _id: WORKER, name: "ALKESH" }]));
      // The audit log names what an entry is on: no machines here, the operator instead.
      stub(Machine, "find", () => chain([]));
      stub(Process, "exists", async () => ({ _id: PROCESS }));
      stub(Process, "findById", () => chain(process));
      stub(AuditLog, "create", async (row) => (logs.push(row), row));
      stub(User, "find", () => chain([]));
      stub(Operator, "find", () => chain([]));
      stub(RoleMaster, "find", () => chain([]));
      // Who an OEE Review flag is announced to — nobody here.
      stub(OperatorRoles, "find", () => chain([]));
      stub(FinalAssemblyEntry, "find", () => chain(others));
      stub(FinalAssemblyEntry, "findOne", () => chain(null));
      stub(FinalAssemblyEntry, "findOneAndUpdate", (key, update) => ({
        lean: async () => {
          const doc = { _id: "64b0c0ffee0000000000cccc", ...key, ...update.$set };
          saved.push(doc);
          return doc;
        },
      }));
      stub(FinalAssemblyEntry, "deleteOne", async () => ({ deletedCount: 1 }));
      // An edit: the saved entry, and the update made to it by _id.
      stub(FinalAssemblyEntry, "findById", () => chain(existing));
      stub(FinalAssemblyEntry, "findByIdAndUpdate", (id, update) => ({
        lean: async () => {
          const doc = { ...existing, ...update.$set };
          saved.push(doc);
          return doc;
        },
      }));
      stub(WeeklyOffSetting, "findOne", () => ({ lean: () => Promise.resolve(null) }));
      stub(CompanyHoliday, "find", () => ({ lean: async () => [] }));
      return () => restore.forEach((r) => r());
    },
  };
};

const call = async (handler, req) => {
  const res = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
  await handler({ user: { _id: "u1", constructor: { modelName: "User" } }, query: {}, ...req }, res);
  return res;
};

const withDb = async (opts, fn) => {
  const db = fakeDb(opts);
  const restore = db.install();
  try {
    await fn(db);
  } finally {
    restore();
  }
};

// Paper row 1 — 11/05/2024 (typed 05-11-2024), ALKESH, 24 PIN SIDE ENTRY B/M:
// 09:30–10:30, Std 30 s, Total 185 — 154.17% of Ideal; Planned typed = the hours.
const paperRow = (o = {}) => ({
  date: "2024-05-11",
  worker: WORKER,
  process: PROCESS,
  slot: "auto",
  workingMode: "Working",
  machineStatus: [],
  itemName: "24 PIN SIDE ENTRY B/M",
  totalCycleSec: 30,
  machineOnTime: "09:30",
  machineOffTime: "10:30",
  actualQty: 185,
  rejectBreakdown: {},
  plannedOperatorShiftHours: 1,
  lunchMin: 0,
  remarks: "AMIT , DILIP, AJAY",
  ...o,
});

// PACKING — no Standard Time; 16/05/2024 08:00–18:00, 170 pcs, 30 min lunch.
const packing = (o = {}) =>
  paperRow({ date: "2024-05-16", itemName: "PACKING", totalCycleSec: "", machineOnTime: "08:00", machineOffTime: "18:00", actualQty: 170, plannedOperatorShiftHours: 10, lunchMin: 30, remarks: "MAHESH", ...o });

const refused = async (body, message, opts = {}) =>
  withDb(opts, async (db) => {
    const res = await call(saveRow, { body });
    assert.equal(res.statusCode, 400, JSON.stringify(res.payload));
    assert.match(res.payload.message, message);
    assert.equal(db.saved.length, 0, "nothing saved");
  });

test("paper row 1 saves — OK = Total − Total Defects, and 154% of Ideal goes to OEE Review instead of being refused", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.slot, 1);
    assert.equal(doc.actualQty, 185);
    assert.equal(doc.okQty, 185);
    assert.equal(doc.rejectedQty, 0);
    assert.equal(doc.operator, "ALKESH");
    assert.equal(doc.remarks, "AMIT , DILIP, AJAY");
    assert.equal(doc.plannedLocked, false);
    assert.equal(doc.review?.status, "pending");
    assert.deepEqual(doc.review.flagged.map((f) => f.metric), ["performance"]);
    assert.ok(Math.abs(doc.oee.performance - (185 * 30) / 3600) < 1e-3, "154.17%");
  });
});

test("a blank Standard Time (PACKING) saves: no Performance, no error, Availability and Quality as usual", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: packing() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.totalCycleSec, undefined, "kept blank, not 0");
    assert.equal(doc.oee.performance, null);
    assert.equal(doc.oee.availability, 1, "570 operating of 570 planned");
    assert.equal(doc.oee.quality, 1);
    assert.equal(doc.review, undefined);
  });
  await refused(packing({ totalCycleSec: 0 }), /Standard Time per Piece must be more than 0 \(or left blank\)/);
});

test("the Types of Defects are this sheet's own; Total Defects and OK QTY are worked out, never taken from the client", async () => {
  await withDb({}, async (db) => {
    const split = Object.fromEntries(FA_DEFECT_REASONS.map((r, i) => [r, i + 1]));
    const res = await call(saveRow, {
      body: paperRow({ rejectBreakdown: split, rejectReason: "Other", rejectOtherRemark: "loose pin", okQty: 999, rejectedQty: 999 }),
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.deepEqual(db.saved[0].rejectBreakdown, split);
    assert.equal(db.saved[0].rejectedQty, 10);
    assert.equal(db.saved[0].okQty, 175);
  });
  await refused(paperRow({ rejectBreakdown: { "Tool Mark": 1 } }), /"Tool Mark" is not a valid reject reason/);
  await refused(paperRow({ rejectBreakdown: { "Wrong Assembly": 100, "Broken Screw": 90 } }), /Total Defects \(190\) can't be more than Total QTY \(185\)/);
  await refused(paperRow({ rejectBreakdown: { Other: 1 } }), /remark is required when "Other"/);
});

test("required fields are named in the sheet's words — and Standard Time isn't one of them", async () => {
  await refused(paperRow({ itemName: "", actualQty: "", totalCycleSec: "" }), /^Required: Item Name, Total QTY$/);
  await refused(paperRow({ machineOffTime: "09:30" }), /Assembly End Time must be after Assembly Start Time/);
});

test("overlapping times are allowed for one worker (ALKESH: three jobs 17:00–19:00)", async () => {
  const others = [
    { slot: 1, machineOnTime: "17:00", machineOffTime: "19:00" },
    { slot: 2, machineOnTime: "17:00", machineOffTime: "19:00" },
  ];
  await withDb({ others }, async (db) => {
    const res = await call(saveRow, {
      body: paperRow({ itemName: "6 PIN 35 A MALE WITH HOOD", totalCycleSec: 50, machineOnTime: "17:00", machineOffTime: "19:00", actualQty: 18, plannedOperatorShiftHours: 2, remarks: "" }),
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].slot, 3);
  });
});

test(`up to ${MAX_SLOTS} entries per worker per date (ALKESH has nine on 11/05); one more is refused`, async () => {
  assert.equal(MAX_SLOTS, 12);
  const day = (n) => Array.from({ length: n }, (_, i) => ({ slot: i + 1, machineOnTime: "09:30", machineOffTime: "10:30" }));
  await withDb({ others: day(11) }, async (db) => {
    const res = await call(saveRow, { body: paperRow() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].slot, 12);
  });
  await refused(paperRow(), /ALKESH already has 12 entries on 11\/05\/2024/, { others: day(12) });
});

test("Planned not under the Working Hours; Idle + Other Activity within them; Other Activity minutes need the activity", async () => {
  await refused(paperRow({ plannedOperatorShiftHours: 0.5 }), /Planned Operator Shift \(0:30\) can't be less than the Assembly Working Hours \(1:00\)/);
  await refused(paperRow({ lunchMin: 30, otherMin: 20, otherMinRemark: "x", otherActivity: "Material Shifting", otherActivityMin: 11 }), /Idle Time \+ Other Activity \(61 min\) can't be more than the Assembly Working Hours \(60 min\)/);
  await refused(paperRow({ otherActivityMin: 10 }), /Say what the Other Activity was/);
  await refused(paperRow({ otherMin: 5 }), /remark is required when Other idle/);
  // The paper's AMIT row: an activity named with no minutes is fine.
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: packing({ date: "2024-05-11", machineOnTime: "15:00", machineOffTime: "19:00", actualQty: 0, lunchMin: 0, plannedOperatorShiftHours: 4, otherActivity: "Material Shifting", remarks: "" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].otherActivity, "Material Shifting");
    assert.equal(db.saved[0].okQty, 0);
  });
});

test("a locked process saves its own 12 h, whatever was typed", async () => {
  await withDb({ process: { _id: PROCESS, plannedShiftLocked: true, plannedShiftHours: 12 } }, async (db) => {
    const res = await call(saveRow, { body: paperRow() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].plannedOperatorShiftHours, 12);
    assert.equal(db.saved[0].plannedLocked, true);
  });
});

test("a Non Working day saves only the day, the worker and the reason", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: { date: "2024-05-12", worker: WORKER, process: PROCESS, slot: "auto", workingMode: "Non Working", machineStatus: ["No Planning"], remarks: "no work" } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].workingMode, "Non Working");
    assert.deepEqual(db.saved[0].machineStatus, ["No Planning"]);
    assert.equal(db.saved[0].actualQty, undefined);
  });
});

test("the audit log words an entry the way the FINAL ASSEMBLY sheet does", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow({ rejectBreakdown: { "Wrong Clamping": 2 } }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.logs[0].sheet, "finalAssembly");
    assert.match(db.logs[0].label, /^FINAL ASSEMBLY · /);
    const labels = db.logs[0].changes.map((c) => c.label);
    for (const l of ["Item Name", "Standard Time per Piece (sec)", "Assembly Start Time", "Total QTY", "Types of Defects"]) {
      assert.ok(labels.includes(l), `${l} in ${labels.join(", ")}`);
    }
    assert.equal(db.logs[0].changes.find((c) => c.label === "Worker Name")?.to, "ALKESH");
  });
});
