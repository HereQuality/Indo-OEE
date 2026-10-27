// The VMC sheet's saveRow rules, run against an in-memory stand-in for the models
// (no database is touched):  node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const VmcEntry = require("../models/VmcEntry");
const Machine = require("../models/Machine");
const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const Process = require("../models/Process");
const AuditLog = require("../models/AuditLog");
const User = require("../models/user.model");
const Operator = require("../models/Operator");
const RoleMaster = require("../models/RoleMaster");
const WorkOrder = require("../models/WorkOrder");
const { saveRow, getOccupied } = require("./vmcSheet.controller");

const MACHINE = "64b0c0ffee0000000000aaaa";
const TODAY = new Date().toISOString().slice(0, 10);

// A tiny table of saved entries for one machine/date, with just the query
// shapes the controller uses.
const fakeDb = (rows = [], process = null) => {
  const table = rows.map((r) => ({ date: new Date(`${TODAY}T00:00:00.000Z`), machine: MACHINE, createdAt: new Date(), ...r }));
  const match = (q) =>
    table.filter(
      (r) =>
        (!q.date || r.date.getTime() === q.date.getTime()) &&
        (!q.machine || r.machine === q.machine) &&
        (!q.operator || r.operator === q.operator) &&
        (!q.$nor || !q.$nor.some((n) => r.machine === n.machine && r.slot === n.slot)) &&
        (q.slot === undefined || (q.slot && q.slot.$ne !== undefined ? r.slot !== q.slot.$ne : r.slot === q.slot)),
    );
  const chain = (rows) => ({ select: () => chain(rows), sort: () => chain(rows), populate: () => chain(rows), lean: async () => rows });
  const saved = [];
  const logs = [];
  return {
    saved,
    logs,
    table,
    install() {
      const restore = [];
      const stub = (obj, name, fn) => {
        const orig = obj[name];
        obj[name] = fn;
        restore.push(() => (obj[name] = orig));
      };
      stub(Machine, "exists", async () => ({ _id: MACHINE }));
      // The machine's process (none unless a test says so) and its name, for the
      // planned-shift rule and the audit log; the audit log itself is captured.
      stub(Machine, "findById", () => chain(process ? { _id: MACHINE, process: "64b0c0ffee0000000000dddd" } : { _id: MACHINE, process: null }));
      stub(Machine, "find", () => chain([{ _id: MACHINE, machineName: "7A" }]));
      stub(Process, "findById", () => chain(process));
      stub(AuditLog, "create", async (row) => (logs.push(row), row));
      stub(User, "find", () => chain([]));
      stub(Operator, "find", () => chain([]));
      stub(RoleMaster, "find", () => chain([]));
      stub(VmcEntry, "find", (q) => chain(match(q)));
      stub(VmcEntry, "findOne", (q) => chain(match(q)[0] || null));
      // A new entry is inserted (utils/insertEntry.js), not upserted.
      stub(VmcEntry, "create", async (payload) => {
        const doc = { _id: "64b0c0ffee0000000000cccc", ...payload };
        saved.push(doc);
        return { toObject: () => doc };
      });
      stub(VmcEntry, "findOneAndUpdate", (key, update) => ({
        lean: async () => {
          const doc = { _id: "64b0c0ffee0000000000cccc", ...key, ...update.$set };
          saved.push(doc);
          return doc;
        },
      }));
      stub(VmcEntry, "deleteOne", async () => ({ deletedCount: 1 }));
      stub(WeeklyOffSetting, "findOne", () => ({ lean: () => Promise.resolve(null) }));
      stub(CompanyHoliday, "find", () => ({ lean: async () => [] }));
      return () => restore.forEach((r) => r());
    },
  };
};

// A valid 09:00–17:30 entry: 6 min program, 2 pieces → 180 s cycle → Ideal 170;
// planned 9.30 h leaves 60 min for stoppage.
const body = (o = {}) => ({
  date: TODAY,
  machine: MACHINE,
  slot: "auto",
  operator: "Asha",
  itemName: "Bracket",
  programTimeMin: 6,
  pcsPerProgram: 2,
  machineOnTime: "09:00",
  machineOffTime: "17:30",
  actualQty: 164,
  okQty: 160,
  rejectBreakdown: { "Tool Mark": 4 },
  plannedOperatorShiftHours: 9.5,
  lunchMin: 30,
  ...o,
});

const call = async (handler, req) => {
  const res = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
  await handler({ user: { _id: "u1", constructor: { modelName: "User" } }, query: {}, ...req }, res);
  return res;
};

const withDb = async (rows, fn, process = null) => {
  const db = fakeDb(rows, process);
  const restore = db.install();
  try {
    await fn(db);
  } finally {
    restore();
  }
};

const refused = async (overrides, message, rows = []) =>
  withDb(rows, async (db) => {
    const res = await call(saveRow, { body: body(overrides) });
    assert.equal(res.statusCode, 400, JSON.stringify(res.payload));
    assert.match(res.payload.message, message);
    assert.equal(db.saved.length, 0, "nothing saved");
  });

test("a normal entry saves into the lowest free slot", async () => {
  await withDb([], async (db) => {
    const res = await call(saveRow, { body: body() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved.length, 1);
    assert.equal(db.saved[0].slot, 1);
    assert.equal(db.saved[0].programTimeMin, 6);
    assert.equal(db.saved[0].rejectedQty, 4, "Rejected is derived as Actual − OK and stored");
    assert.deepEqual(db.saved[0].rejectBreakdown, { "Tool Mark": 4 });
  });
});

test("required fields are named", async () => {
  // Program Time / pieces come from the Part now, not typed on the entry.
  await refused({ operator: "", actualQty: "" }, /Required: Operator, Actual Quantity/);
});

test("OFF must be after ON", async () => {
  for (const off of ["09:00", "08:59"]) await refused({ machineOffTime: off }, /OFF Time must be after Machine ON Time/);
});

test("program time must be more than 0 and pieces a whole number", async () => {
  await refused({ programTimeMin: 0 }, /Program Time must be more than 0/);
  await refused({ pcsPerProgram: 2.5 }, /whole number/);
});

test("Actual Quantity can't be more than Ideal Quantity", async () => {
  await withDb([], async (db) => {
    const ok = await call(saveRow, { body: body({ actualQty: 170, okQty: 166 }) });
    assert.equal(ok.statusCode, 200, "170 = Ideal is fine");
    assert.equal(db.saved.length, 1);
  });
  await refused({ actualQty: 171, okQty: 167 }, /Actual Quantity \(171\) can't be more than Ideal Quantity \(170\)/);
});

test("OK Quantity can't be more than Actual Quantity", async () => {
  await refused({ actualQty: 100, okQty: 101, rejectBreakdown: {} }, /OK Quantity cannot be more than Actual Quantity/);
});

test('"Other" in the reject split needs a remark', async () => {
  await refused({ rejectBreakdown: { Other: 4 } }, /remark is required when "Other"/);
  await withDb([], async (db) => {
    const res = await call(saveRow, { body: body({ rejectBreakdown: { Other: 4 }, rejectOtherRemark: "scratched" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  });
});

test("Planned Operator Shift can't be less than the Machine Shift, and stoppage fits what is left", async () => {
  await refused({ plannedOperatorShiftHours: 8 }, /can't be less than Machine Shift/);
  // 09:00–17:30 is a 510 min run — stoppage has to fit inside it.
  await refused({ lunchMin: 30, setupMin: 481 }, /Total stoppage \(511 min\) can't be more than the Machine Shift \(510 min\)/);
});

test("Others downtime needs a remark", async () => {
  await refused({ otherMin: 5 }, /remark is required when Others downtime/);
});

test("Machine not run must be one of the offered reasons", async () => {
  await withDb([], async (db) => {
    const res = await call(saveRow, { body: body({ machineNotRun: "M/C OFF" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].machineNotRun, "M/C OFF");
  });
  await refused({ machineNotRun: "Lunch" }, /not a valid Machine not run reason/);
});

test("an entry that overlaps another of the same machine and date is refused with the clash named", async () => {
  await refused(
    { machineOnTime: "10:00", machineOffTime: "14:00", plannedOperatorShiftHours: 4, actualQty: 10, okQty: 10, rejectBreakdown: {}, lunchMin: 0 },
    /already has an entry from 09:00 – 17:30/,
    [{ slot: 1, machineOnTime: "09:00", machineOffTime: "17:30" }],
  );
});

test("a fourth entry on one machine and date is refused", async () => {
  const rows = [
    { slot: 1, machineOnTime: "01:00", machineOffTime: "02:00" },
    { slot: 2, machineOnTime: "03:00", machineOffTime: "04:00" },
    { slot: 3, machineOnTime: "05:00", machineOffTime: "06:00" },
  ];
  await refused({}, /already has 3 entries/, rows);
});

test("an operator can't be on two machines at overlapping times", async () => {
  const OTHER = "64b0c0ffee0000000000bbbb";
  await refused({}, /Operator Asha is already on machine/, [
    { machine: OTHER, slot: 1, operator: "Asha", machineOnTime: "09:00", machineOffTime: "17:30" },
  ]);
});

test("a row with every field blank clears instead of failing the rules", async () => {
  await withDb([], async () => {
    const res = await call(saveRow, {
      body: { date: TODAY, machine: MACHINE, slot: "auto", operator: "", itemName: "", machineOnTime: "", machineOffTime: "" },
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  });
});

// Work orders: a stand-in for WorkOrder.findById over a few rows.
const ITEM = "64b0c0ffee0000000000e001";
const OTHER_ITEM = "64b0c0ffee0000000000e002";
const WO = "64b0c0ffee0000000000d001";
const withWorkOrders = async (rows, fn) => {
  const orig = WorkOrder.findById;
  WorkOrder.findById = (id) => ({ select: () => ({ lean: async () => rows.find((r) => String(r._id) === String(id)) || null }) });
  try {
    await fn();
  } finally {
    WorkOrder.findById = orig;
  }
};
const workOrder = (o = {}) => ({ _id: WO, workOrderNo: "WO-101", item: ITEM, isActive: true, ...o });

test("a picked work order is stored with its own number, not the one the client sent", async () => {
  await withWorkOrders([workOrder()], async () => {
    await withDb([], async (db) => {
      const res = await call(saveRow, { body: body({ item: ITEM, workOrder: WO, workOrderNo: "typed by hand" }) });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.equal(String(db.saved[0].workOrder), WO);
      assert.equal(db.saved[0].workOrderNo, "WO-101");
    });
  });
});

test("a work order is optional, and sending none clears it", async () => {
  await withDb([], async (db) => {
    const res = await call(saveRow, { body: body({ workOrder: null }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].workOrder, null);
    assert.equal(db.saved[0].workOrderNo, "");
  });
});

test("a work order for another part, an inactive one, or an unknown one is refused", async () => {
  await withWorkOrders([workOrder({ item: OTHER_ITEM }), workOrder({ _id: "64b0c0ffee0000000000d002", isActive: false })], async () => {
    await refused({ item: ITEM, workOrder: WO }, /Work Order WO-101 is for a different part/);
    await refused({ item: ITEM, workOrder: "64b0c0ffee0000000000d002" }, /not found or inactive/);
    await refused({ item: ITEM, workOrder: "64b0c0ffee0000000000d003" }, /not found or inactive/);
    await refused({ item: ITEM, workOrder: "nope" }, /Invalid work order/);
  });
});

test("an entry keeps its work order when edited, even after the work order is gone", async () => {
  await withWorkOrders([], async () => {
    const saved = { slot: 1, machineOnTime: "09:00", machineOffTime: "17:30", operator: "Asha", workOrder: WO, workOrderNo: "WO-7" };
    await withDb([saved], async (db) => {
      const res = await call(saveRow, { body: body({ slot: 1, item: ITEM, workOrder: WO, remarks: "edited" }) });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.equal(db.saved[0].workOrderNo, "WO-7");
      assert.equal(db.saved[0].remarks, "edited");
    });
  });
});

test("occupied: lists the slots a machine already has", async () => {
  await withDb([{ slot: 1, machineOnTime: "09:00", machineOffTime: "17:30" }], async () => {
    const res = await call(getOccupied, { query: { date: TODAY, machine: MACHINE } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.data, [{ slot: 1, machineOnTime: "09:00", machineOffTime: "17:30" }]);
  });
});

// ── QC audit: API-001 / API-015 / API-007 ──────────────────────────────────
const dupKey = () => Object.assign(new Error("E11000 duplicate key error collection: vmcentries index: date_1_machine_1_slot_1"), { code: 11000 });
const OTHER_ID = "64b0c0ffee0000000000bbbb";

test("two saves racing for the same free slot: the loser lands in the next one, nothing is lost", async () => {
  await withDb([], async (db) => {
    const create = VmcEntry.create;
    let calls = 0;
    const slots = [];
    VmcEntry.create = async (payload) => {
      calls += 1;
      slots.push(payload.slot);
      if (calls === 1) {
        // The other request got slot 1 first.
        db.table.push({ _id: OTHER_ID, date: payload.date, machine: payload.machine, slot: 1, createdAt: new Date() });
        throw dupKey();
      }
      return create(payload);
    };
    try {
      const res = await call(saveRow, { body: body() });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.deepEqual(slots, [1, 2]);
      assert.equal(res.payload.data.slot, 2);
      assert.equal(db.saved.length, 1);
    } finally {
      VmcEntry.create = create;
    }
  });
});

test("racing for the last free slot: the loser gets the same full-day message", async () => {
  await withDb([], async (db) => {
    const create = VmcEntry.create;
    VmcEntry.create = async (payload) => {
      for (const slot of [1, 2, 3]) db.table.push({ _id: OTHER_ID, date: payload.date, machine: payload.machine, slot, createdAt: new Date() });
      throw dupKey();
    };
    try {
      const res = await call(saveRow, { body: body() });
      assert.equal(res.statusCode, 400);
      assert.match(res.payload.message, /already has 3 entries on/);
      assert.equal(db.saved.length, 0);
    } finally {
      VmcEntry.create = create;
    }
  });
});

test("editing with slot auto keeps the entry's own slot while its date and machine are unchanged", async () => {
  const mine = { _id: "64b0c0ffee0000000000e002", slot: 2, operator: "Asha", machineOnTime: "09:00", machineOffTime: "17:30" };
  await withDb([mine], async () => {
    const findById = VmcEntry.findById;
    const findByIdAndUpdate = VmcEntry.findByIdAndUpdate;
    let update = null;
    VmcEntry.findById = () => ({ lean: async () => ({ ...mine, date: new Date(`${TODAY}T00:00:00.000Z`), machine: MACHINE, createdAt: new Date() }) });
    VmcEntry.findByIdAndUpdate = (id, u) => ({
      lean: async () => {
        update = u;
        return { _id: id, ...u.$set };
      },
    });
    try {
      const res = await call(saveRow, { body: body({ _id: mine._id, slot: "auto", remarks: "edited" }) });
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.equal(update.$set.slot, 2, "kept slot 2, not the lowest free slot (1)");
      assert.equal(res.payload.data.slot, 2);
    } finally {
      VmcEntry.findById = findById;
      VmcEntry.findByIdAndUpdate = findByIdAndUpdate;
    }
  });
});

test("text fields must be text: an object or array is refused, a number is stringified", async () => {
  await refused({ itemName: { $ne: null } }, /"itemName" must be text/);
  await refused({ operator: ["Asha"] }, /"operator" must be text/);
  await refused({ remarks: { a: 1 } }, /"remarks" must be text/);
  await withDb([], async (db) => {
    const res = await call(saveRow, { body: body({ itemName: 4501 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].itemName, "4501");
  });
});

test("CALC-001: Ideal Quantity is 1000 for 180 min × 15 pieces ÷ 2.7 min, not 999", async () => {
  const r = (actualQty) => body({ machineOnTime: "00:00", machineOffTime: "03:00", programTimeMin: 2.7, pcsPerProgram: 15, actualQty, okQty: 1000, rejectBreakdown: {}, plannedOperatorShiftHours: 3, lunchMin: 0 });
  await withDb([], async (db) => {
    const ok = await call(saveRow, { body: r(1000) });
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.payload));
    assert.equal(db.saved.length, 1);
  });
  await refused(r(1001), /Actual Quantity \(1001\) can't be more than Ideal Quantity \(1000\)/);
});
