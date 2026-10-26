// The MODULAR FRAME ASSEMBLY sheet's saveRow rules, run against an in-memory
// stand-in for the models (no database is touched), with real rows from the
// paper sheet:
//   node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const MfaEntry = require("../models/MfaEntry");
const { MAX_SLOTS, MFA_LABELS } = require("../models/MfaEntry");
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
const { entryMetrics } = require("../utils/oeeMetrics");
const { saveRow } = require("./mfaSheet.controller");

const WORKER = "64b0c0ffee0000000000aaaa";
const PROCESS = "64b0c0ffee0000000000dddd";

// `others`: what every MfaEntry.find returns — the worker's other entries on the date.
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
      stub(MachineOperator, "findOne", () => chain({ _id: WORKER, name: "PRATIKSHA" }));
      stub(MachineOperator, "find", () => chain([{ _id: WORKER, name: "PRATIKSHA" }]));
      // The audit log names what an entry is on: no machines here, the worker instead.
      stub(Machine, "find", () => chain([]));
      stub(Process, "exists", async () => ({ _id: PROCESS }));
      stub(Process, "findById", () => chain(process));
      stub(AuditLog, "create", async (row) => (logs.push(row), row));
      stub(User, "find", () => chain([]));
      stub(Operator, "find", () => chain([]));
      stub(RoleMaster, "find", () => chain([]));
      // Who an OEE Review flag is announced to — nobody here.
      stub(OperatorRoles, "find", () => chain([]));
      stub(MfaEntry, "find", () => chain(others));
      stub(MfaEntry, "findOne", () => chain(null));
      stub(MfaEntry, "findOneAndUpdate", (key, update) => ({
        lean: async () => {
          const doc = { _id: "64b0c0ffee0000000000cccc", ...key, ...update.$set };
          saved.push(doc);
          return doc;
        },
      }));
      stub(MfaEntry, "deleteOne", async () => ({ deletedCount: 1 }));
      // An edit: the saved entry, and the update made to it by _id.
      stub(MfaEntry, "findById", () => chain(existing));
      stub(MfaEntry, "findByIdAndUpdate", (id, update) => ({
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

// Paper row PRATIKSHA 13/05/2024 — 08:30–17:55 (565 min), Standard Assembly
// Time 43 s, TOTAL 728, OK 390 (Rejected 338), Lunch 30; Planned typed = the
// Assembly Working Hours (the paper has none).
const paperRow = (o = {}) => ({
  date: "2024-05-13",
  worker: WORKER,
  process: PROCESS,
  slot: "auto",
  workingMode: "Working",
  machineStatus: [],
  itemName: "24 PIN FRAME",
  totalCycleSec: 43,
  machineOnTime: "08:30",
  machineOffTime: "17:55",
  actualQty: 728,
  okQty: 390,
  plannedOperatorShiftHours: 565 / 60,
  lunchMin: 30,
  ...o,
});

test("a paper row saves as typed — Rejected QTY is TOTAL − OK", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.slot, 1);
    assert.equal(doc.actualQty, 728);
    assert.equal(doc.okQty, 390);
    assert.equal(doc.rejectedQty, 338);
    assert.equal(doc.operator, "PRATIKSHA", "the worker's name is stored");
    assert.equal(doc.plannedLocked, false, "typed on an unlocked process");
    assert.equal(doc.review, undefined);
    // Lunch is a planned stop: Availability 535 ÷ 535 = 100%; Performance on TOTAL QTY.
    assert.equal(doc.oee.availability, 1);
    assert.ok(Math.abs(doc.oee.performance - (728 * 43) / 60 / 535) < 1e-3);
    assert.ok(Math.abs(doc.oee.quality - 390 / 728) < 1e-3);
  });
});

test("Rejected QTY is never taken from the client; no reason split and no Vendor are stored", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow({ rejectedQty: 5, rejectBreakdown: { Other: 338 }, rejectReason: "Other", vendor: "64b0c0ffee0000000000beef", challanNo: "DC/1" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.rejectedQty, 338);
    assert.equal(doc.rejectBreakdown, undefined);
    assert.equal(doc.rejectReason, undefined);
    assert.equal(doc.vendor, undefined);
    assert.equal(doc.challanNo, undefined);
  });
});

const refused = async (body, message, opts = {}) =>
  withDb(opts, async (db) => {
    const res = await call(saveRow, { body });
    assert.equal(res.statusCode, 400, JSON.stringify(res.payload));
    assert.match(res.payload.message, message);
    assert.equal(db.saved.length, 0, "nothing saved");
  });

test("OK QTY can't be more than TOTAL QTY; both are whole numbers", async () => {
  await refused(paperRow({ okQty: 800 }), /OK QTY \(800\) can't be more than TOTAL QTY \(728\)/);
  await refused(paperRow({ actualQty: 728.5 }), /TOTAL QTY must be a whole number/);
});

test("required fields are named in the sheet's words — the assembly timing labels", async () => {
  assert.equal(MFA_LABELS.start, "Assembly Start Time");
  await refused(paperRow({ itemName: "", actualQty: "", okQty: "" }), /^Required: Item Name, TOTAL QTY, OK QTY$/);
  await refused(paperRow({ machineOnTime: "", plannedOperatorShiftHours: "" }), /^Required: Assembly Start Time, Planned Operator Shift$/);
  await refused(paperRow({ totalCycleSec: 0 }), /Standard Assembly Time per Piece must be more than 0/);
  await refused(paperRow({ machineOnTime: "18:00", machineOffTime: "17:55" }), /Assembly End Time must be after Assembly Start Time/);
});

test("TOTAL above Ideal saves and goes to OEE Review (the paper's PRATIKSHA 14/05 at 549%)", async () => {
  await withDb({}, async (db) => {
    // 10:50–11:24 (34 min), 80 s, 140 pieces: 3.11 h of work in 0.57 h.
    const res = await call(saveRow, {
      body: paperRow({ date: "2024-05-14", machineOnTime: "10:50", machineOffTime: "11:24", totalCycleSec: 80, actualQty: 140, okQty: 140, plannedOperatorShiftHours: 34 / 60, lunchMin: 0 }),
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].review?.status, "pending");
    assert.deepEqual(db.saved[0].review.flagged.map((f) => f.metric), ["performance"]);
    assert.ok(Math.abs(db.saved[0].oee.performance - (140 * 80) / 60 / 34) < 1e-3);
  });
});

test("overlapping times are allowed for one worker", async () => {
  await withDb({ others: [{ slot: 1, machineOnTime: "08:30", machineOffTime: "17:55" }] }, async (db) => {
    const res = await call(saveRow, { body: paperRow({ machineOnTime: "16:30", machineOffTime: "17:10", totalCycleSec: 80, actualQty: 35, okQty: 35, plannedOperatorShiftHours: 40 / 60, lunchMin: 0 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].slot, 2);
  });
});

test(`up to ${MAX_SLOTS} entries per worker per date; one more is refused`, async () => {
  const day = (n) => Array.from({ length: n }, (_, i) => ({ slot: i + 1, machineOnTime: "08:30", machineOffTime: "09:00" }));
  await withDb({ others: day(MAX_SLOTS - 1) }, async (db) => {
    const res = await call(saveRow, { body: paperRow() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].slot, MAX_SLOTS);
  });
  await refused(paperRow(), new RegExp(`PRATIKSHA already has ${MAX_SLOTS} entries on 13/05/2024`), { others: day(MAX_SLOTS) });
});

test("Planned Operator Shift: typed decimal hours on an unlocked process, not under the Assembly Working Hours", async () => {
  await refused(paperRow({ plannedOperatorShiftHours: 9 }), /Planned Operator Shift \(9:00\) can't be less than Assembly Working Hours \(9:25\)/);
  await withDb({ process: { _id: PROCESS, plannedShiftLocked: true, plannedShiftHours: 12 } }, async (db) => {
    const res = await call(saveRow, { body: paperRow() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].plannedOperatorShiftHours, 12);
    assert.equal(db.saved[0].plannedLocked, true);
  });
});

test("Idle Time and Other Activity fit in the working hours; Other idle needs a remark, Other Activity what it was", async () => {
  await refused(paperRow({ otherMin: 5 }), /remark is required when Other idle time/);
  await refused(paperRow({ otherActivityMin: 20 }), /Say what the Other Activity was/);
  await refused(paperRow({ lunchMin: 300, otherMin: 200, otherMinRemark: "x", otherActivityMin: 66, otherActivity: "Machining" }), /Idle Time \+ Other Activity \(566 min\) can't be more than the Assembly Working Hours \(565 min\)/);
});

test("a Non Working day saves only the day, the worker, the reason and the remark", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: { ...paperRow(), workingMode: "Non Working", machineStatus: ["No Planning"], remarks: "W.OFF" } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.workingMode, "Non Working");
    assert.deepEqual(doc.machineStatus, ["No Planning"]);
    assert.equal(doc.remarks, "W.OFF");
    assert.equal(doc.actualQty, undefined);
    assert.equal(doc.itemName, "");
  });
});

test("a locked entry can't be edited", async () => {
  const existing = { ...paperRow(), _id: "64b0c0ffee0000000000eeee", date: new Date("2024-05-13T00:00:00.000Z"), slot: 1, createdAt: new Date(Date.now() - 30 * 86400000) };
  await withDb({ existing }, async (db) => {
    const res = await call(saveRow, { body: paperRow({ _id: existing._id, slot: 1, remarks: "late fix" }) });
    assert.equal(res.statusCode, 403, JSON.stringify(res.payload));
    assert.match(res.payload.message, /locked/);
    assert.equal(db.saved.length, 0);
  });
});

test("the audit log words an entry the way the MODULAR FRAME ASSEMBLY sheet does", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.logs[0].sheet, "mfa");
    assert.match(db.logs[0].label, /^MODULAR FRAME ASSEMBLY · PRATIKSHA · 13\/05\/2024 · Entry 1$/);
    const labels = db.logs[0].changes.map((c) => c.label);
    for (const l of ["Item Name", "Standard Assembly Time per Piece (sec)", "Assembly Start Time", "Assembly End Time", "TOTAL QTY", "OK QTY", "Rejected QTY"]) {
      assert.ok(labels.includes(l), `${l} in ${labels.join(", ")}`);
    }
  });
});

test("the server's own OEE figures read this sheet's Standard Assembly Time", () => {
  const m = entryMetrics("mfa", { itemName: "P", totalCycleSec: 80, machineOnTime: "08:10", machineOffTime: "10:50", actualQty: 192, okQty: 140, plannedOperatorShiftHours: 160 / 60 });
  assert.ok(Math.abs(m.performance - 1.6) < 1e-9, "160%, as on the paper");
});
