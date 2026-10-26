// The EMBOSSING sheet's saveRow rules, run against an in-memory
// stand-in for the models (no database is touched), with real rows from the
// paper sheet:  node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const EmbossingEntry = require("../models/EmbossingEntry");
const Machine = require("../models/Machine");
const Process = require("../models/Process");
const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const AuditLog = require("../models/AuditLog");
const User = require("../models/user.model");
const Operator = require("../models/Operator");
const RoleMaster = require("../models/RoleMaster");
const OperatorRoles = require("../models/OperatorRoles");
const { saveRow } = require("./embossingSheet.controller");

const MACHINE = "64b0c0ffee0000000000aaaa";
const PROCESS = "64b0c0ffee0000000000dddd";
const DATE = "2024-05-15";
const UNLOCKED = { _id: PROCESS, plannedShiftLocked: false };

// `rows`: the entries already saved (on any date/machine) — matched with just
// the query shapes the controller uses.
const fakeDb = ({ process = UNLOCKED, rows = [], existing = null } = {}) => {
  const table = rows.map((r) => ({ date: new Date(`${DATE}T00:00:00.000Z`), machine: MACHINE, createdAt: new Date(), ...r }));
  const match = (q) =>
    table.filter(
      (r) =>
        (!q.date || r.date.getTime() === q.date.getTime()) &&
        (!q.machine || r.machine === q.machine) &&
        (!q.operator || r.operator === q.operator) &&
        (!q.$nor || !q.$nor.some((n) => r.machine === n.machine && r.slot === n.slot)) &&
        (!q._id || !q._id.$ne || String(r._id) !== String(q._id.$ne)) &&
        (q.slot === undefined || (q.slot && q.slot.$ne !== undefined ? r.slot !== q.slot.$ne : r.slot === q.slot)),
    );
  const chain = (value) => ({ select: () => chain(value), sort: () => chain(value), populate: () => chain(value), lean: async () => value });
  const saved = [];
  const logs = [];
  const deleted = [];
  return {
    saved,
    logs,
    deleted,
    install() {
      const restore = [];
      const stub = (obj, name, fn) => {
        const orig = obj[name];
        obj[name] = fn;
        restore.push(() => (obj[name] = orig));
      };
      stub(Machine, "exists", async () => ({ _id: MACHINE }));
      // The machine's process — for the planned-shift rule — and its name for the audit log.
      stub(Machine, "findById", () => chain({ _id: MACHINE, process: process ? PROCESS : null }));
      stub(Machine, "find", () => chain([{ _id: MACHINE, machineName: "IM-1" }]));
      stub(Process, "findById", () => chain(process));
      stub(AuditLog, "create", async (row) => (logs.push(row), row));
      stub(User, "find", () => chain([]));
      stub(Operator, "find", () => chain([]));
      stub(RoleMaster, "find", () => chain([]));
      stub(RoleMaster, "findById", () => chain(null));
      stub(OperatorRoles, "find", () => chain([]));
      stub(OperatorRoles, "findOne", () => chain(null));
      stub(EmbossingEntry, "find", (q) => chain(match(q)));
      stub(EmbossingEntry, "findOne", (q) => chain(match(q)[0] || null));
      stub(EmbossingEntry, "findById", () => chain(existing));
      stub(EmbossingEntry, "findOneAndUpdate", (key, update) => ({
        lean: async () => {
          const doc = { _id: "64b0c0ffee0000000000cccc", ...key, ...update.$set };
          saved.push(doc);
          return doc;
        },
      }));
      stub(EmbossingEntry, "findByIdAndUpdate", (id, update) => ({
        lean: async () => {
          const doc = { ...existing, ...update.$set };
          for (const k of Object.keys(update.$unset || {})) delete doc[k];
          saved.push(doc);
          return doc;
        },
      }));
      stub(EmbossingEntry, "deleteOne", async (q) => (deleted.push(q), { deletedCount: 1 }));
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


// Paper row 1 (08-05-2024, M/c -6/c, JASHAL): 08:00–18:00, Standard Time 8.5 s,
// TOTAL 3791, OK 3791, Setup 15 + Lunch 30 — Ideal 4235.29, OEE 96.77%.
// Planned typed = its Machine Shift (10 h), as on an unlocked process.
const row1 = (o = {}) => ({
  date: DATE,
  machine: MACHINE,
  slot: "auto",
  workingMode: "Working",
  machineStatus: [],
  operator: "JASHAL",
  itemName: "S/P FOR-3 PIN",
  totalCycleSec: 8.5,
  machineOnTime: "08:00",
  machineOffTime: "18:00",
  actualQty: 3791,
  okQty: 3791,
  plannedOperatorShiftHours: 10,
  setupMin: 15,
  lunchMin: 30,
  remarks: "Other Inspection",
  ...o,
});

// Paper 15-05-2024, M/c -6/f, JAYA BEN: 7.5 s, TOTAL 5400 against an Ideal of
// 4800, OK 5378 — the paper's own 121.62%.
const jayaBen = (o = {}) =>
  row1({ operator: "JAYA BEN", itemName: "S/P -10Amp", totalCycleSec: 7.5, actualQty: 5400, okQty: 5378, remarks: "", ...o });

const refused = async (body, message, opts = {}) =>
  withDb(opts, async (db) => {
    const res = await call(saveRow, { body });
    assert.equal(res.statusCode, 400, JSON.stringify(res.payload));
    assert.match(res.payload.message, message);
    assert.equal(db.saved.length, 0, "nothing saved");
  });

test("paper row 1 saves as typed: Rejected = TOTAL − OK, Planned as typed, no review", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: row1() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.slot, 1);
    assert.equal(doc.actualQty, 3791);
    assert.equal(doc.okQty, 3791);
    assert.equal(doc.rejectedQty, 0, "Rejected is derived: TOTAL − OK");
    assert.equal(doc.plannedOperatorShiftHours, 10);
    assert.equal(doc.plannedLocked, false, "typed, not from the lock");
    assert.equal(doc.remarks, "Other Inspection");
    assert.equal(doc.review, undefined);
    // 3791 × 8.5 s over 555 min of operating time: 96.77%; nothing lost but Lunch and Setup.
    assert.ok(Math.abs(doc.oee.performance - (3791 * 8.5) / 60 / 555) < 1e-4, "stored to 4 decimals");
    assert.ok(Math.abs(doc.oee.availability - 555 / 570) < 1e-4);
    assert.equal(doc.oee.quality, 1);
  });
});

test("TOTAL above Ideal (JAYA BEN 15/05: 5400 against 4800) saves, and is held for OEE Review", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: jayaBen() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.actualQty, 5400);
    assert.equal(doc.rejectedQty, 22);
    assert.equal(doc.review?.status, "pending");
    assert.deepEqual(doc.review.flagged.map((f) => f.metric), ["performance"]);
    // 5400 × 7.5 s ÷ 60 over 555 min: the paper's 121.62%.
    assert.ok(Math.abs(doc.oee.performance - 675 / 555) < 1e-4);
    assert.equal(Math.round(doc.oee.performance * 10000) / 100, 121.62);
  });
});

test("Rejected is never taken from the client, and no reject split is stored", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: jayaBen({ rejectedQty: 999, rejectBreakdown: { Other: 22 }, rejectReason: "Other", rejectOtherRemark: "x" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.rejectedQty, 22);
    assert.equal(doc.rejectBreakdown, undefined);
    assert.equal(doc.rejectReason, undefined);
    assert.equal(doc.rejectOtherRemark, undefined);
  });
});

test("OK can't be more than TOTAL; quantities are whole numbers", async () => {
  await refused(row1({ actualQty: 3700, okQty: 3791 }), /OK Quantity cannot be more than Actual Quantity/);
  await refused(row1({ actualQty: 3791.5 }), /TOTAL QTY must be a whole number/);
  await refused(row1({ okQty: 3790.5 }), /OK QTY must be a whole number/);
});

test("required fields are named in the sheet's words", async () => {
  await refused(row1({ operator: "", itemName: "", totalCycleSec: "", actualQty: "", okQty: "" }), /^Required: Operator, Item Name, Standard Time per Piece, TOTAL QTY, OK QTY$/);
  await refused(row1({ plannedOperatorShiftHours: "" }), /^Required: Planned Operator Shift$/);
  await refused(row1({ totalCycleSec: 0 }), /Standard Time per Piece must be more than 0/);
});

test("OFF after ON, Planned not under the Machine Shift, stoppage within it, Other needs a remark", async () => {
  await refused(row1({ machineOffTime: "08:00" }), /Machine OFF Time must be after Machine ON Time/);
  await refused(row1({ plannedOperatorShiftHours: 9.5 }), /Planned Operator Shift \(9:30\) can't be less than Machine Shift \(10:00\)/);
  await refused(row1({ lunchMin: 500, setupMin: 101 }), /Total stoppage \(601 min\) can't be more than the Machine Shift \(600 min\)/);
  await refused(row1({ otherMin: 5 }), /remark is required when Others downtime/);
});

test("a locked process saves its own 12 h (counted once a day), whatever was typed", async () => {
  await withDb({ process: { _id: PROCESS, plannedShiftLocked: true, plannedShiftHours: 12 } }, async (db) => {
    const res = await call(saveRow, { body: row1() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].plannedOperatorShiftHours, 12);
    assert.equal(db.saved[0].plannedLocked, true);
  });
});

test("no overlapping times on one machine, and at most three entries a machine a day", async () => {
  await refused(row1(), /This machine already has an entry from 09:00 – 10:00 on 15\/05\/2024/, {
    rows: [{ _id: "e1", slot: 1, machineOnTime: "09:00", machineOffTime: "10:00" }],
  });
  const full = [1, 2, 3].map((slot) => ({ _id: `e${slot}`, slot, machineOnTime: `0${slot}:00`, machineOffTime: `0${slot}:30` }));
  await refused(row1({ machineOnTime: "19:00", machineOffTime: "20:00", actualQty: 100, okQty: 100, plannedOperatorShiftHours: 1, setupMin: 0, lunchMin: 0 }), /already has 3 entries on 15\/05\/2024/, { rows: full });
});

test("a Non Working day (17-05-2024 JAYA BEN, Leave) saves just its reason — nothing else is asked for", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, {
      body: { date: DATE, machine: MACHINE, slot: "auto", workingMode: "Non Working", machineStatus: [], operator: "JAYA BEN", remarks: "Leave" },
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.workingMode, "Non Working");
    assert.equal(doc.operator, "JAYA BEN");
    assert.equal(doc.remarks, "Leave");
    assert.equal(doc.actualQty, undefined);
  });
});

test("a locked (old) entry can't be edited", async () => {
  const existing = { ...row1(), _id: "64b0c0ffee0000000000eeee", date: new Date(`${DATE}T00:00:00.000Z`), slot: 1, createdAt: new Date(Date.now() - 30 * 86400000) };
  await withDb({ existing }, async (db) => {
    const res = await call(saveRow, { body: row1({ _id: existing._id, slot: 1, remarks: "late fix" }) });
    assert.equal(res.statusCode, 403, JSON.stringify(res.payload));
    assert.match(res.payload.message, /locked/i);
    assert.equal(db.saved.length, 0);
  });
});

test("the audit log words an entry the way the paper sheet does", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: row1() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.logs[0].sheet, "embossing");
    const labels = db.logs[0].changes.map((c) => c.label);
    for (const label of ["Item Name", "Standard Time per Piece (sec)", "TOTAL QTY", "OK QTY", "Rejected QTY", "Remarks"]) {
      assert.ok(labels.includes(label), `${label} missing from ${labels.join(", ")}`);
    }
    assert.ok(!labels.includes("Reject Reasons"));
  });
});
