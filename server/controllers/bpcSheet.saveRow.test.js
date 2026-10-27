// The BEFORE POWDER COATING sheet's saveRow rules, run against an in-memory
// stand-in for the models (no database is touched), with real rows from the
// paper sheet:
//   node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const BeforePowderCoatingEntry = require("../models/BeforePowderCoatingEntry");
const { BPC_REJECT_REASONS, MAX_SLOTS } = require("../models/BeforePowderCoatingEntry");
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
const { applyQuantities } = require("../utils/rejectSplit");
const { saveRow } = require("./bpcSheet.controller");

const WORKER = "64b0c0ffee0000000000aaaa";
const PROCESS = "64b0c0ffee0000000000dddd";

// `others`: what every BeforePowderCoatingEntry.find returns — the operator's other entries on the date.
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
      stub(MachineOperator, "findOne", () => chain({ _id: WORKER, name: "SUREKHA" }));
      stub(MachineOperator, "find", () => chain([{ _id: WORKER, name: "SUREKHA" }]));
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
      stub(BeforePowderCoatingEntry, "find", () => chain(others));
      stub(BeforePowderCoatingEntry, "findOne", () => chain(null));
      // A new entry is inserted (utils/insertEntry.js), not upserted.
      stub(BeforePowderCoatingEntry, "create", async (payload) => {
        const doc = { _id: "64b0c0ffee0000000000cccc", ...payload };
        saved.push(doc);
        return { toObject: () => doc };
      });
      stub(BeforePowderCoatingEntry, "findOneAndUpdate", (key, update) => ({
        lean: async () => {
          const doc = { _id: "64b0c0ffee0000000000cccc", ...key, ...update.$set };
          saved.push(doc);
          return doc;
        },
      }));
      stub(BeforePowderCoatingEntry, "deleteOne", async () => ({ deletedCount: 1 }));
      // An edit: the saved entry, and the update made to it by _id.
      stub(BeforePowderCoatingEntry, "findById", () => chain(existing));
      stub(BeforePowderCoatingEntry, "findByIdAndUpdate", (id, update) => ({
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

// Paper row 1 — 08:15–15:00 (6.75 h), Standard Time 27 s, TOTAL 796, OK 795, Lunch 30;
// Planned typed = the Machine Shift (the paper has no Planned column).
const paperRow = (o = {}) => ({
  date: "2026-05-13",
  worker: WORKER,
  process: PROCESS,
  slot: "auto",
  workingMode: "Working",
  machineStatus: [],
  itemName: "BODY CASTING",
  totalCycleSec: 27,
  machineOnTime: "08:15",
  machineOffTime: "15:00",
  actualQty: 796,
  okQty: 795,
  rejectBreakdown: { "Blow Holes Casting": 1 },
  plannedOperatorShiftHours: 6.75,
  lunchMin: 30,
  ...o,
});

test("paper row 1 saves as typed — Rejected is TOTAL − OK, split over this sheet's own reasons", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.slot, 1);
    assert.equal(doc.actualQty, 796);
    assert.equal(doc.okQty, 795);
    assert.equal(doc.rejectedQty, 1, "Rejected is derived: TOTAL − OK");
    assert.deepEqual(doc.rejectBreakdown, { "Blow Holes Casting": 1 });
    assert.equal(doc.operator, "SUREKHA", "the operator's name is stored");
    assert.equal(doc.plannedLocked, false, "typed on an unlocked process");
    assert.equal(doc.review, undefined);
    // Lunch is a planned stop: Availability 375 ÷ 375 = 100%; Performance on TOTAL QTY.
    assert.equal(doc.oee.availability, 1);
    assert.ok(Math.abs(doc.oee.performance - (796 * 27) / 60 / 375) < 1e-3);
    assert.ok(Math.abs(doc.oee.quality - 795 / 796) < 1e-3);
  });
});

test("every one of this sheet's reasons is accepted — and the top one is kept as rejectReason", async () => {
  await withDb({}, async (db) => {
    const split = Object.fromEntries(BPC_REJECT_REASONS.map((r, i) => [r, i + 1]));
    const total = Object.values(split).reduce((s, n) => s + n, 0);
    const res = await call(saveRow, {
      body: paperRow({ okQty: 796 - total, rejectBreakdown: split, rejectReason: "Other", rejectOtherRemark: "chipped edge" }),
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.deepEqual(db.saved[0].rejectBreakdown, split);
    assert.equal(db.saved[0].rejectedQty, total);
  });
});

const refused = async (body, message, opts = {}) =>
  withDb(opts, async (db) => {
    const res = await call(saveRow, { body });
    assert.equal(res.statusCode, 400, JSON.stringify(res.payload));
    assert.match(res.payload.message, message);
    assert.equal(db.saved.length, 0, "nothing saved");
  });

test("a CNC reject reason is refused on this sheet, while the CNC rules still take their own", async () => {
  await refused(paperRow({ rejectBreakdown: { "Tool Mark": 1 } }), /"Tool Mark" is not a valid reject reason/);
  await refused(paperRow({ rejectReason: "Dimension Out" }), /"Dimension Out" is not a valid reject reason/);

  // Every other sheet calls applyQuantities without reasons: the CNC list, as before.
  const set = { actualQty: 10, okQty: 8 };
  const unset = {};
  applyQuantities({ actualQty: 10, okQty: 8, rejectBreakdown: { "Tool Mark": 2 } }, set, unset);
  assert.deepEqual(set.rejectBreakdown, { "Tool Mark": 2 });
  assert.throws(() => applyQuantities({ rejectBreakdown: { "Blow Holes Casting": 2 } }, {}, {}), /"Blow Holes Casting" is not a valid reject reason/);

  // …and the schemas agree: each sheet's own reasons only.
  const bpcDoc = (split) => new BeforePowderCoatingEntry({ date: new Date(), worker: WORKER, process: PROCESS, slot: 1, rejectBreakdown: split });
  assert.equal(bpcDoc({ "Crack/Damage Casting": 1 }).validateSync()?.errors?.rejectBreakdown, undefined);
  assert.ok(bpcDoc({ "Tool Mark": 1 }).validateSync()?.errors?.rejectBreakdown);
  const cncDoc = (split) => new ProductionEntry({ rejectBreakdown: split });
  assert.equal(cncDoc({ "Tool Mark": 1 }).validateSync()?.errors?.rejectBreakdown, undefined);
  assert.ok(cncDoc({ "TAP Broken Casting": 1 }).validateSync()?.errors?.rejectBreakdown);
});

test("required fields are named in the sheet's words — TOTAL QTY and OK QTY, not Rejected", async () => {
  await refused(paperRow({ itemName: "", actualQty: "", okQty: "", rejectBreakdown: {} }), /^Required: Item Name, TOTAL QTY, OK QTY$/);
  await refused(paperRow({ totalCycleSec: 0 }), /Standard Time per Piece must be more than 0/);
});

test("Rejected is TOTAL − OK, never taken from the client; OK can't be more than TOTAL", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow({ rejectedQty: 999 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].rejectedQty, 1);
  });
  await refused(paperRow({ actualQty: 790, okQty: 795, rejectBreakdown: {} }), /OK Quantity cannot be more than Actual Quantity/);
});

test('"Other" needs its remark — as a reject reason and as downtime', async () => {
  await refused(paperRow({ rejectBreakdown: { Other: 1 } }), /remark is required when "Other"/);
  await refused(paperRow({ otherMin: 5 }), /remark is required when Other downtime/);
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow({ otherMin: 5, otherMinRemark: "waiting for castings" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].otherMin, 5);
  });
});

test("B.D. (Breakdown) is stored and counts toward Total Idle Time, which can't pass the Machine Shift Time", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow({ setupMin: 10, bdMechMin: 20 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].bdMechMin, 20);
    assert.equal(db.saved[0].setupMin, 10);
    // 405 − 30 setup/BD − 30 lunch = 345 min operating; lunch is planned: 345 ÷ 375.
    assert.ok(Math.abs(db.saved[0].oee.availability - 345 / 375) < 1e-3);
  });
  await refused(paperRow({ setupMin: 100, bdMechMin: 200, lunchMin: 100, otherMin: 6, otherMinRemark: "x" }), /Total Idle Time \(406 min\) can't be more than the Machine Shift Time \(405 min\)/);
  // A box this sheet doesn't have isn't saved.
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow({ bdEleMin: 30, noPowerMin: 15 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].bdEleMin, undefined);
    assert.equal(db.saved[0].noPowerMin, undefined);
  });
});

test("Planned Operator Shift: typed decimal hours on an unlocked process, not under the Machine Shift Time", async () => {
  await refused(paperRow({ plannedOperatorShiftHours: 6.5 }), /Planned Operator Shift \(6:30\) can't be less than the Machine Shift Time \(6:45\)/);
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow({ plannedOperatorShiftHours: 8 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].plannedOperatorShiftHours, 8);
    assert.equal(db.saved[0].plannedLocked, false);
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

test("more than Ideal Quantity saves and goes to OEE Review instead of being refused", async () => {
  await withDb({}, async (db) => {
    // Ideal is 405 × 60 ÷ 27 = 900.
    const res = await call(saveRow, { body: paperRow({ actualQty: 950, okQty: 950, rejectBreakdown: {}, lunchMin: 0 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].review?.status, "pending");
    // Performance over 100% takes the day's OEE figures over 100% with it.
    assert.deepEqual(db.saved[0].review.flagged.map((f) => f.metric), ["performance", "oeeLosses", "oeeLunch"]);
  });
});

test(`up to ${MAX_SLOTS} entries per operator per date (the paper has six); one more is refused`, async () => {
  assert.ok(MAX_SLOTS >= 6);
  const day = (n) => Array.from({ length: n }, (_, i) => ({ slot: i + 1, machineOnTime: `0${i}:00`.slice(-5), machineOffTime: `0${i}:30`.slice(-5) }));
  await withDb({ others: day(5) }, async (db) => {
    const res = await call(saveRow, { body: paperRow({ machineOnTime: "16:00", machineOffTime: "17:00", plannedOperatorShiftHours: 1, lunchMin: 0, actualQty: 100, okQty: 100, rejectBreakdown: {} }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].slot, 6, "the sixth entry of the day");
  });
  await refused(
    paperRow({ machineOnTime: "16:00", machineOffTime: "17:00", plannedOperatorShiftHours: 1, lunchMin: 0, actualQty: 100, okQty: 100, rejectBreakdown: {} }),
    new RegExp(`SUREKHA already has ${MAX_SLOTS} entries on 13/05/2026`),
    { others: day(MAX_SLOTS) },
  );
});

test("one operator's times can't overlap on a date (RUBBER's rule)", async () => {
  await refused(paperRow(), /SUREKHA already has an entry from 14:00 – 16:00 on 13\/05\/2026\. An operator's times can't overlap/, {
    others: [{ slot: 1, machineOnTime: "14:00", machineOffTime: "16:00" }],
  });
});

test("a Non Working day saves only the day, the operator and the reason", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: { date: "2026-05-14", worker: WORKER, process: PROCESS, slot: "auto", workingMode: "Non Working", machineStatus: ["Machine Breakdown"], remarks: "furnace down" } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].workingMode, "Non Working");
    assert.deepEqual(db.saved[0].machineStatus, ["Machine Breakdown"]);
    assert.equal(db.saved[0].actualQty, undefined);
  });
});

test("a locked entry can't be edited", async () => {
  const existing = { ...paperRow(), _id: "64b0c0ffee0000000000eeee", date: new Date("2026-05-13T00:00:00.000Z"), slot: 1, createdAt: new Date(Date.now() - 30 * 86400000) };
  await withDb({ existing }, async (db) => {
    const res = await call(saveRow, { body: paperRow({ _id: existing._id, slot: 1, remarks: "late fix" }) });
    assert.equal(res.statusCode, 403, JSON.stringify(res.payload));
    assert.match(res.payload.message, /locked/);
    assert.equal(db.saved.length, 0);
  });
});

test("the audit log words an entry the way the BEFORE POWDER COATING sheet does", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: paperRow({ bdMechMin: 10 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.logs[0].sheet, "bpc");
    assert.match(db.logs[0].label, /^BEFORE POWDER COATING · /);
    const changes = db.logs[0].changes;
    const labels = changes.map((c) => c.label);
    for (const l of ["Item Name", "Standard Time per Piece (sec)", "Machine ON Time", "TOTAL QTY", "OK QTY", "B.D. (Breakdown) (min)"]) {
      assert.ok(labels.includes(l), `${l} in ${labels.join(", ")}`);
    }
    assert.equal(changes.find((c) => c.label === "Operator")?.to, "SUREKHA");
  });
});
