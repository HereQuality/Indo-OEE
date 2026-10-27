// The RAW CASTING sheet's saveRow rules, run against an in-memory stand-in for
// the models (no database is touched), with real rows from the paper sheet:
//   node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const RawCastingEntry = require("../models/RawCastingEntry");
const { RAW_CASTING_DEFECTS, MAX_SLOTS } = require("../models/RawCastingEntry");
const ProductionEntry = require("../models/ProductionEntry");
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
const { saveRow } = require("./rawCastingSheet.controller");

const WORKER = "64b0c0ffee0000000000aaaa";
const PROCESS = "64b0c0ffee0000000000dddd";

// `others`: what every RawCastingEntry.find returns — the worker's other entries on the date.
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
      stub(MachineOperator, "findOne", () => chain({ _id: WORKER, name: "MANJU" }));
      stub(MachineOperator, "find", () => chain([{ _id: WORKER, name: "MANJU" }]));
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
      stub(RawCastingEntry, "find", () => chain(others));
      stub(RawCastingEntry, "findOne", () => chain(null));
      // A new entry is inserted (utils/insertEntry.js), not upserted.
      stub(RawCastingEntry, "create", async (payload) => {
        const doc = { _id: "64b0c0ffee0000000000cccc", ...payload };
        saved.push(doc);
        return { toObject: () => doc };
      });
      stub(RawCastingEntry, "findOneAndUpdate", (key, update) => ({
        lean: async () => {
          const doc = { _id: "64b0c0ffee0000000000cccc", ...key, ...update.$set };
          saved.push(doc);
          return doc;
        },
      }));
      stub(RawCastingEntry, "deleteOne", async () => ({ deletedCount: 1 }));
      // An edit: the saved entry, and the update made to it by _id.
      stub(RawCastingEntry, "findById", () => chain(existing));
      stub(RawCastingEntry, "findByIdAndUpdate", (id, update) => ({
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

// Paper row MANJU 10/05/2024 — 08:15–16:00 (7.75 h), Standard Inspection Time
// 36 s, TOTAL 686, Blow Holes 5 + Crack/Damage 13 = 18 defects (OK 668),
// Lunch 30; Planned typed = the Inspection Working Hours (the paper has none).
const paperRow = (o = {}) => ({
  date: "2024-05-10",
  worker: WORKER,
  process: PROCESS,
  slot: "auto",
  workingMode: "Working",
  machineStatus: [],
  itemName: "24 PIN B/O D/C,P/C",
  challanNo: "DC/28",
  totalCycleSec: 36,
  machineOnTime: "08:15",
  machineOffTime: "16:00",
  actualQty: 686,
  rejectBreakdown: { "Blow Holes Casting": 5, "Crack/Damage Casting": 13 },
  plannedOperatorShiftHours: 7.75,
  lunchMin: 30,
  ...o,
});

test("a paper row saves as typed — Total Defects is the three added up, OK QTY what's left of TOTAL", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.slot, 1);
    assert.equal(doc.actualQty, 686);
    assert.equal(doc.rejectedQty, 18);
    assert.equal(doc.okQty, 668);
    assert.deepEqual(doc.rejectBreakdown, { "Blow Holes Casting": 5, "Crack/Damage Casting": 13 });
    assert.equal(doc.rejectReason, "Crack/Damage Casting", "the biggest defect is kept as the one reason");
    assert.equal(doc.challanNo, "DC/28");
    assert.equal(doc.operator, "MANJU", "the worker's name is stored");
    assert.equal(doc.plannedLocked, false, "typed on an unlocked process");
    assert.equal(doc.review, undefined);
    // Lunch is a planned stop: Availability 435 ÷ 435 = 100%; Performance on TOTAL QTY.
    assert.equal(doc.oee.availability, 1);
    assert.ok(Math.abs(doc.oee.performance - (686 * 36) / 60 / 435) < 1e-3);
    assert.ok(Math.abs(doc.oee.quality - 668 / 686) < 1e-3);
  });
});

test("OK QTY and Total Defects are never taken from the client — the paper's typo row saves OK 298", async () => {
  await withDb({}, async (db) => {
    // ANJU 14/05: TOTAL 317, Crack/Damage 19, but the paper wrote OK 324.
    const body = paperRow({ actualQty: 317, okQty: 324, rejectedQty: 0, rejectBreakdown: { "Crack/Damage Casting": 19 }, totalCycleSec: 40, machineOnTime: "14:10", machineOffTime: "17:55", plannedOperatorShiftHours: 3.75, lunchMin: 0 });
    const res = await call(saveRow, { body });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].okQty, 298);
    assert.equal(db.saved[0].rejectedQty, 19);
  });
});

test("every one of this sheet's defect types is accepted, and \"Other\" needs no remark (as on AFTER POWDER COATING)", async () => {
  await withDb({}, async (db) => {
    const split = Object.fromEntries(RAW_CASTING_DEFECTS.map((d, i) => [d, i + 1]));
    const res = await call(saveRow, { body: paperRow({ rejectBreakdown: split }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.deepEqual(db.saved[0].rejectBreakdown, split);
    assert.equal(db.saved[0].rejectedQty, 6);
    assert.equal(db.saved[0].okQty, 680);
  });
  // A blank or 0 defect is no defect.
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow({ rejectBreakdown: { "Blow Holes Casting": "", "Crack/Damage Casting": 0, Other: "" } }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].rejectBreakdown, undefined);
    assert.equal(db.saved[0].rejectedQty, 0);
    assert.equal(db.saved[0].okQty, 686);
    assert.equal(db.saved[0].rejectReason, "");
  });
});

const refused = async (body, message, opts = {}) =>
  withDb(opts, async (db) => {
    const res = await call(saveRow, { body });
    assert.equal(res.statusCode, 400, JSON.stringify(res.payload));
    assert.match(res.payload.message, message);
    assert.equal(db.saved.length, 0, "nothing saved");
  });

test("a defect another sheet has is refused here, and the schemas agree", async () => {
  await refused(paperRow({ rejectBreakdown: { "Tool Mark": 1 } }), /"Tool Mark" is not a defect type on this sheet/);
  await refused(paperRow({ rejectBreakdown: { "TAP Broken Casting": 1 } }), /"TAP Broken Casting" is not a defect type on this sheet/);
  await refused(paperRow({ rejectBreakdown: { Other: 1.5 } }), /Other must be a whole number/);
  await refused(paperRow({ rejectBreakdown: { Other: -1 } }), /Other must be a whole number/);

  const rawDoc = (split) => new RawCastingEntry({ date: new Date(), worker: WORKER, process: PROCESS, slot: 1, rejectBreakdown: split });
  assert.equal(rawDoc({ "Blow Holes Casting": 1 }).validateSync()?.errors?.rejectBreakdown, undefined);
  assert.ok(rawDoc({ "Tool Mark": 1 }).validateSync()?.errors?.rejectBreakdown);
  const cncDoc = (split) => new ProductionEntry({ rejectBreakdown: split });
  assert.ok(cncDoc({ "Crack/Damage Casting": 1 }).validateSync()?.errors?.rejectBreakdown);
});

test("Total Defects can't be more than TOTAL QTY", async () => {
  await refused(paperRow({ actualQty: 10 }), /Total Defects \(18\) can't be more than TOTAL QTY \(10\)/);
});

test("required fields are named in the sheet's words", async () => {
  await refused(paperRow({ itemName: "", actualQty: "", rejectBreakdown: {} }), /^Required: Item Name, TOTAL QTY$/);
  await refused(paperRow({ machineOnTime: "", plannedOperatorShiftHours: "" }), /^Required: Inspection Start Time, Planned Operator Shift$/);
  await refused(paperRow({ totalCycleSec: 0 }), /Standard Inspection Time per Piece must be more than 0/);
});

test("overlapping times are allowed for one worker (the paper's MANJU 15/05 10:10–16:30 and 16:10–18:50)", async () => {
  await withDb({ others: [{ slot: 1, machineOnTime: "10:10", machineOffTime: "16:30" }] }, async (db) => {
    const res = await call(saveRow, {
      body: paperRow({ date: "2024-05-15", machineOnTime: "16:10", machineOffTime: "18:50", totalCycleSec: 35, actualQty: 247, rejectBreakdown: { "Blow Holes Casting": 10 }, plannedOperatorShiftHours: 160 / 60, lunchMin: 0 }),
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].slot, 2);
    assert.equal(db.saved[0].okQty, 237);
  });
});

test(`up to ${MAX_SLOTS} entries per worker per date; one more is refused`, async () => {
  const day = (n) => Array.from({ length: n }, (_, i) => ({ slot: i + 1, machineOnTime: "08:15", machineOffTime: "09:00" }));
  await withDb({ others: day(MAX_SLOTS - 1) }, async (db) => {
    const res = await call(saveRow, { body: paperRow() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].slot, MAX_SLOTS);
  });
  await refused(paperRow(), new RegExp(`MANJU already has ${MAX_SLOTS} entries on 10/05/2024`), { others: day(MAX_SLOTS) });
});

test("Planned Operator Shift: typed decimal hours on an unlocked process, not under the Inspection Working Hours", async () => {
  await refused(paperRow({ plannedOperatorShiftHours: 7.5 }), /Planned Operator Shift \(7:30\) can't be less than Inspection Working Hours \(7:45\)/);
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow({ plannedOperatorShiftHours: 8 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].plannedOperatorShiftHours, 8);
  });
});

test("a locked process saves its own 12 h, whatever was typed, and marks it as the lock's", async () => {
  await withDb({ process: { _id: PROCESS, plannedShiftLocked: true, plannedShiftHours: 12 } }, async (db) => {
    const res = await call(saveRow, { body: paperRow() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].plannedOperatorShiftHours, 12);
    assert.equal(db.saved[0].plannedLocked, true);
  });
});

test("TOTAL above Ideal Inspection Quantity saves and goes to OEE Review instead of being refused", async () => {
  await withDb({}, async (db) => {
    // Ideal is 465 × 60 ÷ 36 = 775.
    const res = await call(saveRow, { body: paperRow({ actualQty: 800, rejectBreakdown: {}, lunchMin: 0 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].review?.status, "pending");
    // Performance over 100% takes the day's OEE figures over 100% with it.
    assert.deepEqual(db.saved[0].review.flagged.map((f) => f.metric), ["performance", "productivity", "productivityLunch"]);
  });
});

test("Idle Time and Other Activity fit in the working hours; Other idle needs a remark, Other Activity what it was", async () => {
  await refused(paperRow({ otherMin: 5 }), /remark is required when Other idle time/);
  await refused(paperRow({ otherActivityMin: 20 }), /Say what the Other Activity was/);
  await refused(paperRow({ lunchMin: 300, otherMin: 100, otherMinRemark: "x", otherActivityMin: 66, otherActivity: "Packing" }), /Idle Time \+ Other Activity \(466 min\) can't be more than the Inspection Working Hours \(465 min\)/);
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow({ otherMin: 240, otherMinRemark: "HOOD SAT IN CAGE", otherActivityMin: 20, otherActivity: "M-SEAL FILING" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].otherMin, 240);
    assert.equal(db.saved[0].otherActivityMin, 20);
    // Other Activity is out of Operating Time: 465 − 30 − 240 − 20 = 175 of 435.
    assert.ok(Math.abs(db.saved[0].oee.availability - 175 / 435) < 1e-3);
  });
});

test("a Non Working day saves only the day, the worker, the reason and the remark (the paper's W.OFF)", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, {
      body: { ...paperRow(), date: "2024-05-12", workingMode: "Non Working", machineStatus: ["No Planning"], remarks: "W.OFF" },
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.workingMode, "Non Working");
    assert.deepEqual(doc.machineStatus, ["No Planning"]);
    assert.equal(doc.remarks, "W.OFF");
    assert.equal(doc.actualQty, undefined);
    assert.equal(doc.rejectBreakdown, undefined);
    assert.equal(doc.challanNo, "");
    assert.equal(doc.itemName, "");
  });
});

test("a locked entry can't be edited", async () => {
  const existing = { ...paperRow(), _id: "64b0c0ffee0000000000eeee", date: new Date("2024-05-10T00:00:00.000Z"), slot: 1, createdAt: new Date(Date.now() - 30 * 86400000) };
  await withDb({ existing }, async (db) => {
    const res = await call(saveRow, { body: paperRow({ _id: existing._id, slot: 1, remarks: "late fix" }) });
    assert.equal(res.statusCode, 403, JSON.stringify(res.payload));
    assert.match(res.payload.message, /locked/);
    assert.equal(db.saved.length, 0);
  });
});

test("the audit log words an entry the way the RAW CASTING sheet does", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.logs[0].sheet, "rawCasting");
    assert.match(db.logs[0].label, /^RAW CASTING · MANJU · 10\/05\/2024 · Entry 1$/);
    const changes = db.logs[0].changes;
    const labels = changes.map((c) => c.label);
    for (const l of ["Item Name", "Challan No.", "Standard Inspection Time per Piece (sec)", "Inspection Start Time", "Inspection End Time", "TOTAL QTY", "OK QTY", "Total Defects", "Types of Defects"]) {
      assert.ok(labels.includes(l), `${l} in ${labels.join(", ")}`);
    }
    assert.equal(changes.find((c) => c.label === "Types of Defects")?.to, "Blow Holes Casting: 5, Crack/Damage Casting: 13");
    assert.equal(changes.find((c) => c.label === "Worker Name")?.to, "MANJU");
  });
});

test("the server's own OEE figures read this sheet's Standard Inspection Time", () => {
  const m = entryMetrics("rawCasting", { itemName: "P", totalCycleSec: 36, machineOnTime: "08:15", machineOffTime: "16:00", actualQty: 686, okQty: 668, plannedOperatorShiftHours: 7.75, lunchMin: 30 });
  assert.ok(Math.abs(m.performance - (686 * 36) / 60 / 435) < 1e-9);
});
