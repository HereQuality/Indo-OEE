// The INJECTION MOULDING sheet's saveRow rules, run against an in-memory
// stand-in for the models (no database is touched), with real rows from the
// paper sheet:  node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const InjectionEntry = require("../models/InjectionEntry");
const Machine = require("../models/Machine");
const Process = require("../models/Process");
const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const AuditLog = require("../models/AuditLog");
const User = require("../models/user.model");
const Operator = require("../models/Operator");
const RoleMaster = require("../models/RoleMaster");
const OperatorRoles = require("../models/OperatorRoles");
const { saveRow } = require("./injectionSheet.controller");

const MACHINE = "64b0c0ffee0000000000aaaa";
const PROCESS = "64b0c0ffee0000000000dddd";
const DATE = "2026-05-13";
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
      stub(InjectionEntry, "find", (q) => chain(match(q)));
      stub(InjectionEntry, "findOne", (q) => chain(match(q)[0] || null));
      stub(InjectionEntry, "findById", () => chain(existing));
      stub(InjectionEntry, "findOneAndUpdate", (key, update) => ({
        lean: async () => {
          const doc = { _id: "64b0c0ffee0000000000cccc", ...key, ...update.$set };
          saved.push(doc);
          return doc;
        },
      }));
      stub(InjectionEntry, "findByIdAndUpdate", (id, update) => ({
        lean: async () => {
          const doc = { ...existing, ...update.$set };
          for (const k of Object.keys(update.$unset || {})) delete doc[k];
          saved.push(doc);
          return doc;
        },
      }));
      stub(InjectionEntry, "deleteOne", async (q) => (deleted.push(q), { deletedCount: 1 }));
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

// Paper row 1: 08:30–18:00, Standard Time 20 s, TOTAL 1608, OK 1600, Lunch 30 —
// Ideal Quantity 1710, OEE 99.26%. Planned typed = its Machine Shift (9.5 h),
// as on an unlocked process.
const row1 = (o = {}) => ({
  date: DATE,
  machine: MACHINE,
  slot: "auto",
  workingMode: "Working",
  machineStatus: [],
  operator: "RAMESH",
  itemName: "Cap 20 mm",
  totalCycleSec: 20,
  machineOnTime: "08:30",
  machineOffTime: "18:00",
  actualQty: 1608,
  okQty: 1600,
  plannedOperatorShiftHours: 9.5,
  lunchMin: 30,
  remarks: "short shot",
  ...o,
});

// Paper row 2: 08:30–11:30, 15 s, TOTAL 608, OK 600, Setup 30 — the paper's own
// 101.33%: Performance over 100%.
const row2 = (o = {}) =>
  row1({ machineOnTime: "08:30", machineOffTime: "11:30", totalCycleSec: 15, actualQty: 608, okQty: 600, plannedOperatorShiftHours: 3, lunchMin: 0, setupMin: 30, ...o });

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
    assert.equal(doc.actualQty, 1608);
    assert.equal(doc.okQty, 1600);
    assert.equal(doc.rejectedQty, 8, "Rejected is derived: TOTAL − OK");
    assert.equal(doc.plannedOperatorShiftHours, 9.5);
    assert.equal(doc.plannedLocked, false, "typed, not from the lock");
    assert.equal(doc.remarks, "short shot");
    assert.equal(doc.review, undefined);
    // 1608 × 20 s over 540 min of operating time: 99.26%; nothing but Lunch lost: Availability 100%.
    assert.equal(doc.oee.availability, 1);
    assert.ok(Math.abs(doc.oee.performance - (1608 * 20) / 60 / 540) < 1e-4, "stored to 4 decimals");
    assert.ok(Math.abs(doc.oee.quality - 1600 / 1608) < 1e-4);
  });
});

test("paper row 2 (101.33%) saves and goes to OEE Review", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: row2() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.review?.status, "pending");
    assert.deepEqual(doc.review.flagged.map((f) => f.metric), ["performance"]);
    assert.ok(Math.abs(doc.oee.performance - 152 / 150) < 1e-4, "101.33%");
  });
});

test("Rejected is never taken from the client, and no reject split is stored", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: row1({ rejectedQty: 999, rejectBreakdown: { Other: 8 }, rejectReason: "Other", rejectOtherRemark: "x" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.rejectedQty, 8);
    assert.equal(doc.rejectBreakdown, undefined);
    assert.equal(doc.rejectReason, undefined);
    assert.equal(doc.rejectOtherRemark, undefined);
  });
});

test("Actual can't be more than Ideal Quantity rounded down (892.1 → 892)", async () => {
  // Paper row 5: 08:30–17:55 at 38 s — Ideal 892.105…
  const r5 = (actualQty) => row1({ machineOffTime: "17:55", totalCycleSec: 38, actualQty, okQty: 800, plannedOperatorShiftHours: 9.42 });
  await refused(r5(893), /Actual Quantity \(893\) can't be more than Ideal Quantity \(892\)/);
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: r5(892) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].rejectedQty, 92);
  });
});

test("OK can't be more than Actual; quantities are whole numbers", async () => {
  await refused(row1({ actualQty: 1600, okQty: 1608 }), /OK Quantity cannot be more than Actual Quantity/);
  await refused(row1({ actualQty: 1608.5 }), /Actual Quantity must be a whole number/);
});

test("required fields are named in the sheet's words", async () => {
  await refused(row1({ operator: "", itemName: "", totalCycleSec: "", actualQty: "", okQty: "" }), /^Required: Operator, Item Name, Standard Time per Piece, Actual Quantity, OK Quantity$/);
  await refused(row1({ plannedOperatorShiftHours: "" }), /^Required: Planned Operator Shift$/);
  await refused(row1({ totalCycleSec: 0 }), /Standard Time per Piece must be more than 0/);
});

test("OFF after ON, Planned not under the Machine Shift, stoppage within it, Others needs a remark", async () => {
  await refused(row1({ machineOffTime: "08:30" }), /Machine OFF Time must be after Machine ON Time/);
  await refused(row1({ plannedOperatorShiftHours: 9 }), /Planned Operator Shift \(9:00\) can't be less than Machine Shift \(9:30\)/);
  await refused(row1({ lunchMin: 500, setupMin: 71 }), /Total stoppage \(571 min\) can't be more than the Machine Shift \(570 min\)/);
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
  await refused(row1(), /This machine already has an entry from 09:00 – 10:00 on 13\/05\/2026/, {
    rows: [{ _id: "e1", slot: 1, machineOnTime: "09:00", machineOffTime: "10:00" }],
  });
  const full = [1, 2, 3].map((slot) => ({ _id: `e${slot}`, slot, machineOnTime: `0${slot}:00`, machineOffTime: `0${slot}:30` }));
  await refused(row1({ machineOnTime: "19:00", machineOffTime: "20:00", actualQty: 100, okQty: 100, plannedOperatorShiftHours: 1, lunchMin: 0 }), /already has 3 entries on 13\/05\/2026/, { rows: full });
});

test("a Non Working day saves just its reason — nothing else is asked for", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, {
      body: { date: DATE, machine: MACHINE, slot: "auto", workingMode: "Non Working", machineStatus: ["No Planning"], operator: "", remarks: "W.OFF" },
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.workingMode, "Non Working");
    assert.deepEqual(doc.machineStatus, ["No Planning"]);
    assert.equal(doc.remarks, "W.OFF");
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
    assert.equal(db.logs[0].sheet, "injection");
    const labels = db.logs[0].changes.map((c) => c.label);
    for (const label of ["Item Name", "Standard Time per Piece (sec)", "TOTAL QTY", "OK QTY", "Rejected QTY", "Reason/Remarks for Rejection/Rework"]) {
      assert.ok(labels.includes(label), `${label} missing from ${labels.join(", ")}`);
    }
    assert.ok(!labels.includes("Reject Reasons"));
  });
});
