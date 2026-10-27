// The RUBBER sheet's saveRow rules, run against an in-memory stand-in for the
// models (no database is touched), with the two real rows from the sheet:
//   node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const RubberEntry = require("../models/RubberEntry");
const MachineOperator = require("../models/MachineOperator");
const Process = require("../models/Process");
const Machine = require("../models/Machine");
const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const AuditLog = require("../models/AuditLog");
const User = require("../models/user.model");
const Operator = require("../models/Operator");
const RoleMaster = require("../models/RoleMaster");
const { saveRow } = require("./rubberSheet.controller");

const WORKER = "64b0c0ffee0000000000aaaa";
const PROCESS = "64b0c0ffee0000000000dddd";

// `others`: what every RubberEntry.find returns — the worker's other entries on the date.
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
      stub(MachineOperator, "findOne", () => chain({ _id: WORKER, name: "SAVITA" }));
      stub(MachineOperator, "find", () => chain([{ _id: WORKER, name: "SAVITA" }]));
      // The audit log names what an entry is on: no machines here, the worker instead.
      stub(Machine, "find", () => chain([]));
      stub(Process, "exists", async () => ({ _id: PROCESS }));
      stub(Process, "findById", () => chain(process));
      stub(AuditLog, "create", async (row) => (logs.push(row), row));
      stub(User, "find", () => chain([]));
      stub(Operator, "find", () => chain([]));
      stub(RoleMaster, "find", () => chain([]));
      stub(RubberEntry, "find", () => chain(others));
      stub(RubberEntry, "findOne", () => chain(null));
      // A new entry is inserted (utils/insertEntry.js), not upserted.
      stub(RubberEntry, "create", async (payload) => {
        const doc = { _id: "64b0c0ffee0000000000cccc", ...payload };
        saved.push(doc);
        return { toObject: () => doc };
      });
      stub(RubberEntry, "findOneAndUpdate", (key, update) => ({
        lean: async () => {
          const doc = { _id: "64b0c0ffee0000000000cccc", ...key, ...update.$set };
          saved.push(doc);
          return doc;
        },
      }));
      stub(RubberEntry, "deleteOne", async () => ({ deletedCount: 1 }));
      // An edit: the saved entry, and the update made to it by _id.
      stub(RubberEntry, "findById", () => chain(existing));
      stub(RubberEntry, "findByIdAndUpdate", (id, update) => ({
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

// Sheet row 1 — 07/01/25, SAVITA, 06 pin b/o cheaking: 30 s, 08:10–12:00, 311 OK, Actual 311.
const savita = (o = {}) => ({
  date: "2025-01-07",
  worker: WORKER,
  process: PROCESS,
  slot: "auto",
  workingMode: "Working",
  machineStatus: [],
  itemName: "06 pin b/o cheaking",
  totalCycleSec: 30,
  machineOnTime: "08:10",
  machineOffTime: "12:00",
  actualQty: 311,
  okQty: 311,
  plannedOperatorShiftHours: 3 + 50 / 60,
  lunchMin: 0,
  ...o,
});

// Sheet row 2 — 07/01/2025, LEELA, 10 PIN HOOD TOP ENTRY MIN: 22 s, 12:30–13:30, 166 OK.
const leela = (o = {}) =>
  savita({ itemName: "10 PIN HOOD TOP ENTRY MIN", totalCycleSec: 22, machineOnTime: "12:30", machineOffTime: "13:30", actualQty: 166, okQty: 166, plannedOperatorShiftHours: 1, ...o });

test("sheet row 1 saves as typed — Rejected is Actual − OK (0), no review", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: savita() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.slot, 1);
    assert.equal(doc.okQty, 311);
    assert.equal(doc.actualQty, 311);
    assert.equal(doc.rejectedQty, 0, "Rejected is derived: Actual − OK");
    assert.equal(doc.operator, "SAVITA", "the worker's name is stored");
    assert.equal(doc.review, undefined);
    // 311 × 30 s over 230 min run: Performance 67.61%; nothing lost: Availability 100%.
    assert.equal(doc.oee.availability, 1);
    assert.ok(Math.abs(doc.oee.performance - (311 * 30) / 60 / 230) < 1e-3);
    assert.equal(doc.oee.quality, 1);
  });
});

test("sheet row 2 — more than Ideal — saves and goes to OEE Review instead of being refused", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: leela() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.review?.status, "pending");
    // Performance over 100% takes the day's OEE figures over 100% with it.
    assert.deepEqual(doc.review.flagged.map((f) => f.metric), ["performance", "productivity", "productivityLunch"]);
    assert.ok(Math.abs(doc.oee.performance - (166 * 22) / 3600) < 1e-3, "101.44%");
  });
});

test("a locked process saves its own 12 h, whatever was typed", async () => {
  await withDb({ process: { _id: PROCESS, plannedShiftLocked: true, plannedShiftHours: 12 } }, async (db) => {
    const res = await call(saveRow, { body: savita() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].plannedOperatorShiftHours, 12);
  });
});

const refused = async (body, message) =>
  withDb({}, async (db) => {
    const res = await call(saveRow, { body });
    assert.equal(res.statusCode, 400, JSON.stringify(res.payload));
    assert.match(res.payload.message, message);
    assert.equal(db.saved.length, 0, "nothing saved");
  });

test("required fields are named — Actual and OK Quantity, not Rejected", async () => {
  await refused(savita({ itemName: "", actualQty: "", okQty: "" }), /^Required: Part Name, Actual Quantity, OK Quantity$/);
});

test("Rejected is Actual − OK, never taken from the client; the split is stored", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: savita({ actualQty: 311, okQty: 300, rejectedQty: 999, rejectBreakdown: { "Tool Mark": 0, Other: 11 }, rejectOtherRemark: "dented" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].rejectedQty, 11);
    assert.deepEqual(db.saved[0].rejectBreakdown, { Other: 11 });
  });
});

test("OK can't be more than Actual, and an Other split needs its remark", async () => {
  await refused(savita({ actualQty: 300, okQty: 311 }), /OK Quantity cannot be more than Actual Quantity/);
  await refused(savita({ actualQty: 311, okQty: 300, rejectBreakdown: { Other: 11 } }), /remark is required when "Other"/);
});

test("End after Start, Planned not under the Worker Shift Time, stoppage within it", async () => {
  await refused(savita({ machineOffTime: "08:10" }), /Working End Time must be after Working Start Time/);
  await refused(savita({ plannedOperatorShiftHours: 3 }), /can't be less than the Worker Shift Time \(3:50\)/);
  await refused(savita({ lunchMin: 200, setupMin: 31 }), /Total stoppage \(231 min\) can't be more than the Worker Shift Time \(230 min\)/);
  await refused(savita({ otherMin: 5 }), /remark is required/);
});

test("a machine-breakdown box isn't on this sheet, so it isn't saved", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: savita({ bdMechMin: 30 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].bdMechMin, undefined);
  });
});

test("saved at 12 h while locked, then RUBBER unlocked and edited: the typed Planned Operator Shift is what's saved", async () => {
  const existing = { ...savita({ plannedOperatorShiftHours: 12 }), _id: "64b0c0ffee0000000000eeee", date: new Date("2025-01-07T00:00:00.000Z"), slot: 1, createdAt: new Date() };
  // Still locked: the edit keeps the 12 h it was saved with.
  await withDb({ existing, process: { _id: PROCESS, plannedShiftLocked: true, plannedShiftHours: 12 } }, async (db) => {
    const res = await call(saveRow, { body: savita({ _id: existing._id, slot: 1 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].plannedOperatorShiftHours, 12);
  });
  // Unlocked: 3:50 as typed — the sheet's own figure.
  await withDb({ existing }, async (db) => {
    const res = await call(saveRow, { body: savita({ _id: existing._id, slot: 1 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.ok(Math.abs(db.saved[0].plannedOperatorShiftHours - (3 + 50 / 60)) < 1e-9);
    assert.equal(db.saved[0].oee.availability, 1, "Availability 100% once Planned = the Worker Shift Time");
  });
});

const ENTRY = "64b0c0ffee0000000000eeee";
const savedRow = (o = {}) => ({ ...savita(), _id: ENTRY, date: new Date("2025-01-07T00:00:00.000Z"), slot: 1, createdAt: new Date(), ...o });

test("a locked entry can't be edited, whatever slot the save names", async () => {
  // Saved a month ago: well past the 2-working-day window.
  const existing = savedRow({ createdAt: new Date(Date.now() - 30 * 86400000) });
  await withDb({ existing }, async (db) => {
    // slot "auto" with the entry's _id used to skip the lock check.
    for (const slot of [1, "auto"]) {
      const res = await call(saveRow, { body: savita({ _id: ENTRY, slot, remarks: "late fix" }) });
      assert.equal(res.statusCode, 403, `slot ${slot}: ${JSON.stringify(res.payload)}`);
      assert.match(res.payload.message, /locked/);
    }
    assert.equal(db.saved.length, 0);
  });
});

test("moving an entry to another Date checks the worker's times there, even with its own times unchanged", async () => {
  // SAVITA already has 10:00–11:00 on 08/01/2025.
  const others = [{ slot: 1, machineOnTime: "10:00", machineOffTime: "11:00" }];
  await withDb({ existing: savedRow(), others }, async (db) => {
    const moved = await call(saveRow, { body: savita({ _id: ENTRY, slot: 1, date: "2025-01-08" }) });
    assert.equal(moved.statusCode, 400, JSON.stringify(moved.payload));
    assert.match(moved.payload.message, /SAVITA already has an entry from 10:00 – 11:00 on 08\/01\/2025/);
    assert.equal(db.saved.length, 0);
    // Left on its own date with its times untouched, an older row stays editable.
    const stays = await call(saveRow, { body: savita({ _id: ENTRY, slot: 1, remarks: "note" }) });
    assert.equal(stays.statusCode, 200, JSON.stringify(stays.payload));
  });
});

test("the audit log words an entry the way the RUBBER sheet does, and names the worker once", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: savita() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const changes = db.logs[0].changes;
    const labels = changes.map((c) => c.label);
    assert.ok(labels.includes("Working Start Time") && labels.includes("Working End Time"), labels.join(", "));
    assert.ok(!labels.includes("Machine ON Time") && !labels.includes("Machine OFF Time"));
    assert.equal(changes.find((c) => c.label === "Worker Name")?.to, "SAVITA");
    assert.ok(!labels.includes("Operator"), "the worker's name isn't logged a second time as Operator");
  });
});
