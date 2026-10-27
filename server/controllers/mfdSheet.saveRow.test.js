// The MODULAR FRAME DRILLING sheet's saveRow rules, run against an in-memory
// stand-in for the models (no database is touched), with real rows from the
// paper sheet:  node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const MfdEntry = require("../models/MfdEntry");
const Machine = require("../models/Machine");
const Process = require("../models/Process");
const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const AuditLog = require("../models/AuditLog");
const User = require("../models/user.model");
const Operator = require("../models/Operator");
const RoleMaster = require("../models/RoleMaster");
const OperatorRoles = require("../models/OperatorRoles");
const { saveRow } = require("./mfdSheet.controller");
const { CYCLE_SEC, entryMetrics } = require("../utils/oeeMetrics");

const MACHINE = "64b0c0ffee0000000000aaaa";
const OTHER_MACHINE = "64b0c0ffee0000000000bbbb";
const PROCESS = "64b0c0ffee0000000000dddd";
const DATE = "2024-05-10";
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
        (!q._id || !q._id.$ne || String(r._id) !== String(q._id.$ne)) &&
        (q.slot === undefined || (q.slot && q.slot.$ne !== undefined ? r.slot !== q.slot.$ne : r.slot === q.slot)),
    );
  // populate("machine", "machineName") — the other machine's name for the operator message.
  const named = (list) => list.map((r) => ({ ...r, machine: { _id: r.machine, machineName: r.machine === MACHINE ? "4/B" : "4/A" } }));
  const chain = (value, populated = value) => ({
    select: () => chain(value, populated),
    sort: () => chain(value, populated),
    populate: () => chain(populated, populated),
    lean: async () => value,
  });
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
      stub(Machine, "find", () => chain([{ _id: MACHINE, machineName: "4/B" }]));
      stub(Process, "findById", () => chain(process));
      stub(AuditLog, "create", async (row) => (logs.push(row), row));
      stub(User, "find", () => chain([]));
      stub(Operator, "find", () => chain([]));
      stub(RoleMaster, "find", () => chain([]));
      stub(RoleMaster, "findById", () => chain(null));
      stub(OperatorRoles, "find", () => chain([]));
      stub(OperatorRoles, "findOne", () => chain(null));
      stub(MfdEntry, "find", (q) => chain(match(q), named(match(q))));
      stub(MfdEntry, "findOne", (q) => chain(match(q)[0] || null));
      stub(MfdEntry, "findById", () => chain(existing));
      // A new entry is inserted (utils/insertEntry.js), not upserted.
      stub(MfdEntry, "create", async (payload) => {
        const doc = { _id: "64b0c0ffee0000000000cccc", ...payload };
        saved.push(doc);
        return { toObject: () => doc };
      });
      stub(MfdEntry, "findOneAndUpdate", (key, update) => ({
        lean: async () => {
          const doc = { _id: "64b0c0ffee0000000000cccc", ...key, ...update.$set };
          saved.push(doc);
          return doc;
        },
      }));
      stub(MfdEntry, "findByIdAndUpdate", (id, update) => ({
        lean: async () => {
          const doc = { ...existing, ...update.$set };
          for (const k of Object.keys(update.$unset || {})) delete doc[k];
          saved.push(doc);
          return doc;
        },
      }));
      stub(MfdEntry, "deleteOne", async (q) => (deleted.push(q), { deletedCount: 1 }));
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

// Paper row 2: 4/B VISHAL 10/05, 24 PIN FRAME BIG (IE0726, DRILLING, 2 holes,
// 2 strokes), 08:15–18:55 at 50 s, OK 99, Material Shifting 115 + Lunch 30 —
// IDEAL Quantity 732 (Lunch taken out). Planned typed = its Machine Shift.
const row2 = (o = {}) => ({
  date: DATE,
  machine: MACHINE,
  slot: "auto",
  workingMode: "Working",
  machineStatus: [],
  operator: "VISHAL",
  itemName: "24 PIN FRAME BIG",
  drawingNo: "IE0726",
  operation: "DRILLING",
  noOfHoles: 2,
  strokeRequired: 2,
  totalCycleSec: 50,
  machineOnTime: "08:15",
  machineOffTime: "18:55",
  actualQty: 99,
  okQty: 99,
  plannedOperatorShiftHours: 10.666667,
  materialShiftingMin: 115,
  lunchMin: 30,
  remarks: "",
  ...o,
});

// Paper row 1: the same machine and date, 14:50–15:25 at 20 s, OK 75 — inside row 2's run.
const row1 = (o = {}) =>
  row2({
    noOfHoles: 1,
    strokeRequired: 1,
    totalCycleSec: 20,
    machineOnTime: "14:50",
    machineOffTime: "15:25",
    actualQty: 75,
    okQty: 75,
    plannedOperatorShiftHours: 0.583333,
    materialShiftingMin: 0,
    lunchMin: 0,
    ...o,
  });

const refused = async (body, message, opts = {}) =>
  withDb(opts, async (db) => {
    const res = await call(saveRow, { body });
    assert.equal(res.statusCode, 400, JSON.stringify(res.payload));
    assert.match(res.payload.message, message);
    assert.equal(db.saved.length, 0, "nothing saved");
  });

test("paper row 2 saves as typed: the Part's figures, Rejected = Actual − OK, Planned as typed, no review", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: row2({ actualQty: 104, okQty: 99, settingOnTime: "08:00", settingOffTime: "08:15", remarks: "tool change" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.slot, 1);
    assert.equal(doc.drawingNo, "IE0726");
    assert.equal(doc.operation, "DRILLING");
    assert.equal(doc.noOfHoles, 2);
    assert.equal(doc.strokeRequired, 2);
    assert.equal(doc.totalCycleSec, 50);
    assert.equal(doc.settingOnTime, "08:00");
    assert.equal(doc.settingOffTime, "08:15");
    assert.equal(doc.rejectedQty, 5, "Rejected is derived: Actual − OK");
    assert.equal(doc.plannedLocked, false, "typed, not from the lock");
    assert.equal(doc.remarks, "tool change");
    assert.equal(doc.review, undefined);
    // 104 × 50 s over 640 − 145 = 495 min of operating time; Availability over Planned less Lunch.
    assert.ok(Math.abs(doc.oee.performance - (104 * 50) / 60 / 495) < 1e-4);
    assert.ok(Math.abs(doc.oee.availability - 495 / 610) < 1e-4);
    assert.ok(Math.abs(doc.oee.quality - 99 / 104) < 1e-4);
  });
});

test("the server's A/P/Q use the entry's own Total Cycle Time", () => {
  assert.equal(CYCLE_SEC.mfd({ totalCycleSec: 47 }), 47);
  const m = entryMetrics("mfd", { itemName: "DUST COVER CLAMP", totalCycleSec: 47, machineOnTime: "08:10", machineOffTime: "15:00", actualQty: 430, okQty: 425, plannedOperatorShiftHours: 6.833333, lunchMin: 30 });
  assert.ok(Math.abs(m.performance - (430 * 47) / 60 / 380) < 1e-9);
  assert.equal(m.availability, 1);
});

test("overlapping times on one machine are allowed — paper row 1 sits inside row 2", async () => {
  await withDb({ rows: [{ _id: "e2", slot: 1, operator: "VISHAL", machineOnTime: "08:15", machineOffTime: "18:55" }] }, async (db) => {
    const res = await call(saveRow, { body: row1() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].slot, 2, "the next free slot");
  });
  // 4/A 10/05: two operators at once on one machine.
  await withDb({ rows: [{ _id: "e3", slot: 1, operator: "LILABEN", machineOnTime: "08:15", machineOffTime: "12:00" }] }, async (db) => {
    const res = await call(saveRow, {
      body: row1({ operator: "PRATIKSHA", machineOnTime: "11:00", machineOffTime: "18:00", totalCycleSec: 23, actualQty: 946, okQty: 946, plannedOperatorShiftHours: 7, lunchMin: 30 }),
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  });
});

test("one operator still can't be on two machines at the same time", async () => {
  await refused(row1(), /Operator VISHAL is already on machine 4\/A from 14:00 – 15:00 on 10\/05\/2024/, {
    rows: [{ _id: "x1", slot: 1, machine: OTHER_MACHINE, operator: "VISHAL", machineOnTime: "14:00", machineOffTime: "15:00" }],
  });
});

test("up to 8 entries a machine a day", async () => {
  const seven = Array.from({ length: 7 }, (_, i) => ({ _id: `e${i + 1}`, slot: i + 1, machineOnTime: "08:15", machineOffTime: "18:55" }));
  await withDb({ rows: seven }, async (db) => {
    const res = await call(saveRow, { body: row1() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].slot, 8);
  });
  const eight = Array.from({ length: 8 }, (_, i) => ({ _id: `e${i + 1}`, slot: i + 1, machineOnTime: "08:15", machineOffTime: "18:55" }));
  await refused(row1(), /already has 8 entries on 10\/05\/2024/, { rows: eight });
});

test("Actual can't be more than the IDEAL Quantity — Lunch taken out — rounded down (732)", async () => {
  await refused(row2({ actualQty: 733, okQty: 700 }), /Actual Quantity \(733\) can't be more than IDEAL Quantity \(732\)/);
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: row2({ actualQty: 732, okQty: 700 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    // 732 × 50 s over 495 min of operating time: Performance over 100% — goes to OEE Review.
    assert.equal(db.saved[0].review?.status, "pending");
    // Performance over 100% takes the day's OEE figures over 100% with it.
    assert.deepEqual(db.saved[0].review.flagged.map((f) => f.metric), ["performance", "oeeLosses"]);
  });
});

test("Rejected is never taken from the client, and no reject split is stored", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: row2({ actualQty: 104, rejectedQty: 999, rejectBreakdown: { Other: 5 }, rejectReason: "Other", rejectOtherRemark: "x" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.rejectedQty, 5);
    assert.equal(doc.rejectBreakdown, undefined);
    assert.equal(doc.rejectReason, undefined);
    assert.equal(doc.rejectOtherRemark, undefined);
  });
});

test("required fields in the sheet's words; OFF after ON; Setting Time a real time; Planned; stoppage; Others", async () => {
  await refused(row2({ operator: "", itemName: "", totalCycleSec: "", actualQty: "", okQty: "" }), /^Required: Operator, Part Name, Total Cycle Time, Actual Quantity, OK Quantity$/);
  await refused(row2({ totalCycleSec: 0 }), /Total Cycle Time must be more than 0/);
  await refused(row2({ machineOffTime: "08:15" }), /Machine Time OFF must be after Machine Time ON/);
  await refused(row2({ settingOnTime: "8 am" }), /Setting Time ON must be HH:mm/);
  await refused(row2({ plannedOperatorShiftHours: 10 }), /Planned Operator Shift \(10:00\) can't be less than Machine Shift \(10:40\)/);
  await refused(row2({ setupMin: 496 }), /Total stoppage \(641 min\) can't be more than the Machine Shift \(640 min\)/);
  await refused(row2({ otherMin: 5 }), /remark is required when Others downtime/);
  await refused(row2({ actualQty: 99.5 }), /Actual Quantity must be a whole number/);
  await refused(row2({ actualQty: 90, okQty: 99 }), /OK Quantity cannot be more than Actual Quantity/);
});

test("a locked process saves its own 12 h (counted once a day), whatever was typed", async () => {
  await withDb({ process: { _id: PROCESS, plannedShiftLocked: true, plannedShiftHours: 12 } }, async (db) => {
    const res = await call(saveRow, { body: row2() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].plannedOperatorShiftHours, 12);
    assert.equal(db.saved[0].plannedLocked, true);
  });
});

test("a Non Working day saves just its reason — nothing else is asked for", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, {
      body: { ...row2(), workingMode: "Non Working", machineStatus: ["No Planning"], remarks: "W.OFF" },
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.workingMode, "Non Working");
    assert.deepEqual(doc.machineStatus, ["No Planning"]);
    assert.equal(doc.remarks, "W.OFF");
    assert.equal(doc.actualQty, undefined);
    assert.equal(doc.operation, "");
  });
});

test("a locked (old) entry can't be edited", async () => {
  const existing = { ...row2(), _id: "64b0c0ffee0000000000eeee", date: new Date(`${DATE}T00:00:00.000Z`), slot: 1, createdAt: new Date(Date.now() - 30 * 86400000) };
  await withDb({ existing }, async (db) => {
    const res = await call(saveRow, { body: row2({ _id: existing._id, slot: 1, remarks: "late fix" }) });
    assert.equal(res.statusCode, 403, JSON.stringify(res.payload));
    assert.match(res.payload.message, /locked/i);
    assert.equal(db.saved.length, 0);
  });
});

test("the audit log words an entry the way the paper sheet does", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: row2({ actualQty: 104, settingOnTime: "08:00", remarks: "tool change" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.logs[0].sheet, "mfd");
    assert.match(db.logs[0].label, /^MODULAR FRAME DRILLING · /);
    const labels = db.logs[0].changes.map((c) => c.label);
    for (const label of ["Part Name", "Drawing No.", "Process", "No. of Holes in One Piece", "Stroke Required for One Piece", "Total Cycle Time (sec)", "Machine Time ON", "Setting Time ON", "ACTUAL OK Quantity", "Rejected Quantity", "Lunch / Tea / Washroom etc (min)", "REMARKS"]) {
      assert.ok(labels.includes(label), `${label} missing from ${labels.join(", ")}`);
    }
    assert.ok(!labels.includes("Reject Reasons"));
  });
});
