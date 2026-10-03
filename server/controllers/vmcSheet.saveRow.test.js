// The VMC sheet's saveRow rules, run against an in-memory stand-in for the models
// (no database is touched):  node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const VmcEntry = require("../models/VmcEntry");
const Machine = require("../models/Machine");
const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const WorkOrder = require("../models/WorkOrder");
const { saveRow, getOccupied } = require("./vmcSheet.controller");

const MACHINE = "64b0c0ffee0000000000aaaa";
const TODAY = new Date().toISOString().slice(0, 10);

// A tiny table of saved entries for one machine/date, with just the query
// shapes the controller uses.
const fakeDb = (rows = []) => {
  const table = rows.map((r) => ({ date: new Date(`${TODAY}T00:00:00.000Z`), machine: MACHINE, ...r }));
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
  return {
    saved,
    install() {
      const restore = [];
      const stub = (obj, name, fn) => {
        const orig = obj[name];
        obj[name] = fn;
        restore.push(() => (obj[name] = orig));
      };
      stub(Machine, "exists", async () => ({ _id: MACHINE }));
      stub(VmcEntry, "find", (q) => chain(match(q)));
      stub(VmcEntry, "findOne", (q) => chain(match(q)[0] || null));
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
  okQty: 160,
  rejectedQty: 4,
  plannedOperatorShiftHours: 9.5,
  lunchMin: 30,
  ...o,
});

const call = async (handler, req) => {
  const res = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
  await handler({ user: { _id: "u1", constructor: { modelName: "User" } }, query: {}, ...req }, res);
  return res;
};

const withDb = async (rows, fn) => {
  const db = fakeDb(rows);
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
    assert.equal(db.saved[0].rejectedQty, 4, "Rejected is typed on the VMC sheet and stored as sent");
  });
});

test("required fields are named", async () => {
  await refused({ operator: "", programTimeMin: "", pcsPerProgram: "", rejectedQty: "" }, /Required: Operator, Program Time, No\. of Piece In One Program, Rejected Quantity/);
});

test("OFF must be after ON", async () => {
  for (const off of ["09:00", "08:59"]) await refused({ machineOffTime: off }, /OFF Time must be after Machine ON Time/);
});

test("program time must be more than 0 and pieces a whole number", async () => {
  await refused({ programTimeMin: 0 }, /Program Time must be more than 0/);
  await refused({ pcsPerProgram: 2.5 }, /whole number/);
});

test("OK + Rejected can't be more than Ideal Quantity", async () => {
  await withDb([], async (db) => {
    const ok = await call(saveRow, { body: body({ okQty: 166, rejectedQty: 4 }) });
    assert.equal(ok.statusCode, 200, "170 = Ideal is fine");
    assert.equal(db.saved.length, 1);
  });
  await refused({ okQty: 167, rejectedQty: 4 }, /can't be more than Ideal Quantity \(170\)/);
});

test("Setting Time is both-or-neither, and OFF after ON", async () => {
  await withDb([], async (db) => {
    const res = await call(saveRow, { body: body({ settingOnTime: "09:00", settingOffTime: "09:20" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].settingOffTime, "09:20");
  });
  await refused({ settingOnTime: "09:00" }, /both Setting Time ON and OFF/);
  await refused({ settingOnTime: "09:20", settingOffTime: "09:00" }, /Setting Time OFF must be after/);
});

test("Planned Operator Shift can't be less than the Machine Shift, and stoppage fits what is left", async () => {
  await refused({ plannedOperatorShiftHours: 8 }, /can't be less than Machine Shift/);
  await refused({ lunchMin: 30, setupMin: 31 }, /Total stoppage \(61 min\) can't be more than .* \(60 min\)/);
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
    { machineOnTime: "10:00", machineOffTime: "14:00", plannedOperatorShiftHours: 4, okQty: 10, rejectedQty: 0, lunchMin: 0 },
    /already has an entry from 9:00 AM – 5:30 PM/,
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
