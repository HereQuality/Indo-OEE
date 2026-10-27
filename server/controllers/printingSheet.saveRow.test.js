// The PRINTING sheet's saveRow rules, run against an in-memory stand-in for the
// models (no database is touched), with real rows from the paper sheet:
//   node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const PrintingEntry = require("../models/PrintingEntry");
const MachineOperator = require("../models/MachineOperator");
const Process = require("../models/Process");
const Machine = require("../models/Machine");
const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const AuditLog = require("../models/AuditLog");
const User = require("../models/user.model");
const Operator = require("../models/Operator");
const RoleMaster = require("../models/RoleMaster");
const { entryMetrics } = require("../utils/oeeMetrics");
const { saveRow } = require("./printingSheet.controller");

const WORKER = "64b0c0ffee0000000000aaaa";
const PROCESS = "64b0c0ffee0000000000dddd";
const MC = "64b0c0ffee0000000000bbbb";

// `others`: what every PrintingEntry.find returns — the operator's other entries on the date.
// `machines`: the Machine Master records an MC No. may name.
const fakeDb = ({ process = { _id: PROCESS, plannedShiftLocked: false }, existing = null, others = [], machines = [{ _id: MC, machineName: "P-1" }] } = {}) => {
  const chain = (rows) => ({ select: () => chain(rows), sort: () => chain(rows), populate: () => chain(rows), lean: async () => rows });
  const saved = [];
  const logs = [];
  const machineAsked = [];
  return {
    saved,
    logs,
    machineAsked,
    install() {
      const restore = [];
      const stub = (obj, name, fn) => {
        const orig = obj[name];
        obj[name] = fn;
        restore.push(() => (obj[name] = orig));
      };
      stub(MachineOperator, "findOne", () => chain({ _id: WORKER, name: "SUREKHA" }));
      stub(MachineOperator, "find", () => chain([{ _id: WORKER, name: "SUREKHA" }]));
      stub(Machine, "find", () => chain([]));
      stub(Machine, "findOne", (q) => {
        machineAsked.push(q);
        return chain(machines.find((m) => String(m._id) === String(q._id)) || null);
      });
      stub(Process, "exists", async () => ({ _id: PROCESS }));
      stub(Process, "findById", () => chain(process));
      stub(AuditLog, "create", async (row) => (logs.push(row), row));
      stub(User, "find", () => chain([]));
      stub(Operator, "find", () => chain([]));
      stub(RoleMaster, "find", () => chain([]));
      stub(PrintingEntry, "find", () => chain(others));
      stub(PrintingEntry, "findOne", () => chain(null));
      // A new entry is inserted (utils/insertEntry.js), not upserted.
      stub(PrintingEntry, "create", async (payload) => {
        const doc = { _id: "64b0c0ffee0000000000cccc", ...payload };
        saved.push(doc);
        return { toObject: () => doc };
      });
      stub(PrintingEntry, "findOneAndUpdate", (key, update) => ({
        lean: async () => {
          const doc = { _id: "64b0c0ffee0000000000cccc", ...key, ...update.$set };
          saved.push(doc);
          return doc;
        },
      }));
      stub(PrintingEntry, "deleteOne", async () => ({ deletedCount: 1 }));
      // An edit: the saved entry, and the update made to it by _id.
      stub(PrintingEntry, "findById", () => chain(existing));
      stub(PrintingEntry, "findByIdAndUpdate", (id, update) => ({
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

// Paper sheet, 14/05: SUREKHA 10:30–16:00, 6 s per piece, 3000 TOTAL / 3000 OK,
// 30 min lunch — 100.00% on all three OEE columns. Planned typed = its Machine
// Shift (5.5 h), the process unlocked: the paper has no Planned column.
const surekha = (o = {}) => ({
  date: "2025-05-14",
  worker: WORKER,
  process: PROCESS,
  slot: "auto",
  workingMode: "Working",
  machineStatus: [],
  mcMachine: "",
  itemName: "PRINTED LABEL",
  totalCycleSec: 6,
  machineOnTime: "10:30",
  machineOffTime: "16:00",
  actualQty: 3000,
  okQty: 3000,
  plannedOperatorShiftHours: 5.5,
  lunchMin: 30,
  remarks: "",
  ...o,
});

const refused = async (body, message, opts = {}) =>
  withDb(opts, async (db) => {
    const res = await call(saveRow, { body });
    assert.equal(res.statusCode, 400, JSON.stringify(res.payload));
    assert.match(res.payload.message, message);
    assert.equal(db.saved.length, 0, "nothing saved");
  });

test("a paper row saves as typed — the operator's name stored, no MC No., no review at 100%", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: surekha() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.slot, 1);
    assert.equal(doc.operator, "SUREKHA");
    assert.equal(doc.mcMachine, null, "MC No. left blank");
    assert.equal(doc.rejectedQty, 0);
    assert.equal(doc.plannedLocked, false, "typed on an unlocked process");
    assert.equal(doc.review, undefined);
    assert.equal(doc.oee.availability, 1);
    assert.equal(doc.oee.performance, 1);
    assert.equal(res.payload.data.machine, WORKER, "the operator stands in the machine's place");
  });
});

test("Rejected is TOTAL − OK, never taken from the client — and no reject split is ever stored", async () => {
  await withDb({}, async (db) => {
    const body = surekha({ okQty: 2990, rejectedQty: 999, rejectBreakdown: { Other: 10 }, rejectReason: "Other", rejectOtherRemark: "smudged", remarks: "ink smudge" });
    const res = await call(saveRow, { body });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.rejectedQty, 10);
    assert.equal(doc.rejectBreakdown, undefined);
    assert.equal(doc.rejectReason, undefined);
    assert.equal(doc.rejectOtherRemark, undefined);
    assert.equal(doc.remarks, "ink smudge", "Reason/Remarks for Rejection/Rework");
  });
  await refused(surekha({ actualQty: 100, okQty: 101 }), /OK Quantity cannot be more than Actual Quantity/);
});

test("over 100% (paper row 874 pcs × 21 s in 10:30–16:00) saves and goes to OEE Review", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: surekha({ totalCycleSec: 21, actualQty: 874, okQty: 874 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.review?.status, "pending");
    // Performance over 100% takes the day's OEE figures over 100% with it.
    assert.deepEqual(doc.review.flagged.map((f) => f.metric), ["performance", "oeeLosses", "oeeLunch", "oeeLunchCot"]);
    assert.ok(Math.abs(doc.oee.performance - (874 * 21) / 60 / 300) < 1e-3, "101.97%");
  });
});

test("TOTAL can't be more than the Ideal Quantity rounded down (942.86 → 942)", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: surekha({ totalCycleSec: 21, actualQty: 942, okQty: 942 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  });
  await refused(surekha({ totalCycleSec: 21, actualQty: 943, okQty: 943 }), /Total Quantity \(943\) can't be more than Ideal Quantity \(942\)/);
});

test("one operator may run two jobs at overlapping times — no overlap rule", async () => {
  // SUREKHA already has 10:30–16:00 on 14/05 (the paper sheet has it twice).
  const others = [{ slot: 1, machineOnTime: "10:30", machineOffTime: "16:00" }];
  await withDb({ others }, async (db) => {
    const res = await call(saveRow, { body: surekha({ totalCycleSec: 21, actualQty: 874, okQty: 874 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].slot, 2);
  });
});

test("up to eight entries per operator per date; a ninth is refused", async () => {
  const slots = (n) => Array.from({ length: n }, (_, i) => ({ slot: i + 1, machineOnTime: "09:00", machineOffTime: "10:00" }));
  await withDb({ others: slots(7) }, async (db) => {
    const res = await call(saveRow, { body: surekha() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].slot, 8);
  });
  await refused(surekha(), /SUREKHA already has 8 entries on 14\/05\/2025/, { others: slots(8) });
});

test("MC No. is optional: a picked machine is saved with its name; an unknown one is refused", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: surekha({ mcMachine: MC }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(String(db.saved[0].mcMachine), MC);
    assert.equal(db.saved[0].mcName, "P-1");
    assert.equal(res.payload.data.mcMachine, MC);
    assert.deepEqual(db.machineAsked[0].isDeleted, { $ne: true }, "a newly picked machine must not be deleted");
    // The MC No. is not the row key: the entry stays the operator's.
    assert.equal(res.payload.data.machine, WORKER);
  });
  await refused(surekha({ mcMachine: "64b0c0ffee0000000000ffff" }), /MC No\. not found/);
  await refused(surekha({ mcMachine: "nope" }), /Invalid MC No\./);
});

test("Printing's three own downtime columns count toward the Machine Shift limit and come off Operating Time", async () => {
  // 330 min shift: 100 + 100 + 101 + 30 lunch = 331.
  await refused(
    surekha({ askQueryQcMin: 100, emptyBagTuggingMin: 100, stockCountingMin: 101 }),
    /Total Idle Time \(331 min\) can't be more than the Machine Shift \(330 min\)/,
  );
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: surekha({ actualQty: 2700, okQty: 2700, askQueryQcMin: 10, emptyBagTuggingMin: 10, stockCountingMin: 10 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.askQueryQcMin, 10);
    assert.equal(doc.emptyBagTuggingMin, 10);
    assert.equal(doc.stockCountingMin, 10);
    // Operating = 330 − 30 lunch − 30 = 270; Planned Production = 330 − 30 = 300.
    assert.ok(Math.abs(doc.oee.availability - 0.9) < 1e-9);
    assert.ok(Math.abs(doc.oee.performance - (2700 * 6) / 60 / 270) < 1e-3);
  });
});

test("server OEE: the three Printing keys are stoppage on the PRINTING sheet only", () => {
  const row = { itemName: "X", totalCycleSec: 6, machineOnTime: "10:30", machineOffTime: "16:00", actualQty: 2700, okQty: 2700, plannedOperatorShiftHours: 5.5, lunchMin: 30, askQueryQcMin: 30 };
  assert.ok(Math.abs(entryMetrics("printing", row).availability - 0.9) < 1e-9);
  assert.equal(entryMetrics("rubber", row).availability, 1, "another sheet doesn't read Printing's keys");
});

test("Planned Operator Shift: locked → the process's 12 h; unlocked → typed, never less than the Machine Shift", async () => {
  await withDb({ process: { _id: PROCESS, plannedShiftLocked: true, plannedShiftHours: 12 } }, async (db) => {
    const res = await call(saveRow, { body: surekha() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].plannedOperatorShiftHours, 12);
    assert.equal(db.saved[0].plannedLocked, true);
  });
  await refused(surekha({ plannedOperatorShiftHours: 5 }), /Planned Operator Shift \(5:00\) can't be less than Machine Shift \(5:30\)/);
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: surekha({ plannedOperatorShiftHours: 8.5 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].plannedOperatorShiftHours, 8.5);
  });
});

test("required fields are named in the sheet's words; MC No. is not one of them", async () => {
  await refused(surekha({ itemName: "", totalCycleSec: "", actualQty: "", okQty: "" }), /^Required: Item Name, Standard Time per Piece, Total Quantity, OK Quantity$/);
  await refused(surekha({ machineOffTime: "10:30" }), /Machine OFF Time must be after Machine ON Time/);
  await refused(surekha({ otherMin: 5 }), /remark is required when Other downtime/);
});

test("a Non Working day keeps only its reasons and remarks — no figures, no MC No.", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: surekha({ workingMode: "Non Working", machineStatus: ["No Planning"], mcMachine: MC, remarks: "W.OFF" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const doc = db.saved[0];
    assert.equal(doc.workingMode, "Non Working");
    assert.deepEqual(doc.machineStatus, ["No Planning"]);
    assert.equal(doc.remarks, "W.OFF");
    assert.equal(doc.mcMachine, null);
    assert.equal(doc.actualQty, undefined);
  });
});

test("a locked entry can't be edited, whatever slot the save names", async () => {
  const existing = { ...surekha(), _id: "64b0c0ffee0000000000eeee", date: new Date("2025-05-14T00:00:00.000Z"), slot: 1, createdAt: new Date(Date.now() - 30 * 86400000) };
  await withDb({ existing }, async (db) => {
    for (const slot of [1, "auto"]) {
      const res = await call(saveRow, { body: surekha({ _id: existing._id, slot, remarks: "late fix" }) });
      assert.equal(res.statusCode, 403, `slot ${slot}: ${JSON.stringify(res.payload)}`);
      assert.match(res.payload.message, /locked/);
    }
    assert.equal(db.saved.length, 0);
  });
});

test("the audit log words an entry the way the PRINTING sheet does", async () => {
  await withDb({}, async (db) => {
    const res = await call(saveRow, { body: surekha({ mcMachine: MC, askQueryQcMin: 5 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const log = db.logs[0];
    assert.equal(log.sheet, "printing");
    assert.match(log.label, /^PRINTING · SUREKHA · 14\/05\/2025 · Entry 1$/);
    const changes = log.changes;
    const labels = changes.map((c) => c.label);
    assert.equal(changes.find((c) => c.label === "Operator")?.to, "SUREKHA");
    assert.equal(changes.find((c) => c.label === "MC No.")?.to, "P-1");
    assert.ok(labels.includes("Standard Time per Piece (sec)") && labels.includes("TOTAL QTY") && labels.includes("Ask Query To QC Team (min)"), labels.join(", "));
  });
});
