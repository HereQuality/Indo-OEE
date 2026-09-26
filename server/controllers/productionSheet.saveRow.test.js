// saveRow's machine-time rules, run against an in-memory stand-in for the models
// (no database is touched):  node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const ProductionEntry = require("../models/ProductionEntry");
const Machine = require("../models/Machine");
const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const { saveRow, getOccupied } = require("./productionSheet.controller");

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
        (q.slot === undefined || (q.slot && q.slot.$ne !== undefined ? r.slot !== q.slot.$ne : r.slot === q.slot)),
    );
  const chain = (rows) => ({ select: () => chain(rows), sort: () => chain(rows), lean: async () => rows });
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
      stub(ProductionEntry, "find", (q) => chain(match(q)));
      stub(ProductionEntry, "findOne", (q) => chain(match(q)[0] || null));
      stub(ProductionEntry, "findOneAndUpdate", (key, update) => ({
        lean: async () => {
          const doc = { _id: "64b0c0ffee0000000000cccc", ...key, ...update.$set };
          saved.push(doc);
          return doc;
        },
      }));
      stub(ProductionEntry, "deleteOne", async () => ({ deletedCount: 1 }));
      stub(WeeklyOffSetting, "findOne", () => ({ lean: () => Promise.resolve(null) }));
      stub(CompanyHoliday, "find", () => ({ lean: async () => [] }));
      return () => restore.forEach((r) => r());
    },
  };
};

const body = (o = {}) => ({
  date: TODAY,
  machine: MACHINE,
  slot: "auto",
  operator: "Asha",
  itemName: "Bracket",
  machineOnTime: "08:00",
  machineOffTime: "12:00",
  actualQty: 10,
  okQty: 10,
  plannedOperatorShiftHours: 4,
  lunchMin: 0,
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

test("OFF must be after ON: equal and earlier times are refused, nothing is saved", async () => {
  await withDb([], async (db) => {
    for (const off of ["08:00", "07:59", "00:00"]) {
      const res = await call(saveRow, { body: body({ machineOffTime: off }) });
      assert.equal(res.statusCode, 400, off);
      assert.equal(res.payload.message, "Machine OFF Time must be after Machine ON Time");
    }
    assert.equal(db.saved.length, 0);
  });
});

test("a normal entry saves", async () => {
  await withDb([], async (db) => {
    const res = await call(saveRow, { body: body() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved.length, 1);
    assert.equal(db.saved[0].slot, 1, "lowest free slot");
  });
});

test("an entry that overlaps another of the same machine and date is refused with the clash named", async () => {
  await withDb([{ slot: 1, machineOnTime: "08:00", machineOffTime: "12:00" }], async (db) => {
    const res = await call(saveRow, { body: body({ machineOnTime: "10:00", machineOffTime: "14:00", plannedOperatorShiftHours: 4 }) });
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /already has an entry from 8:00 AM – 12:00 PM/);
    assert.match(res.payload.message, /can't overlap/);
    const [y, m, d] = TODAY.split("-");
    assert.ok(res.payload.message.includes(`${d}/${m}/${y}`), "dd/mm/yyyy date");
    assert.equal(db.saved.length, 0);
  });
});

test("back-to-back entries are fine (one ends where the next starts)", async () => {
  await withDb([{ slot: 1, machineOnTime: "08:00", machineOffTime: "12:00" }], async (db) => {
    const res = await call(saveRow, { body: body({ machineOnTime: "12:00", machineOffTime: "16:00" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(db.saved[0].slot, 2);
  });
});

test("editing an entry does not clash with itself, but does with its neighbour", async () => {
  const rows = [
    { slot: 1, machineOnTime: "08:00", machineOffTime: "12:00" },
    { slot: 2, machineOnTime: "13:00", machineOffTime: "17:00" },
  ];
  await withDb(rows, async () => {
    const shrink = await call(saveRow, { body: body({ slot: 1, machineOnTime: "09:00", machineOffTime: "11:00" }) });
    assert.equal(shrink.statusCode, 200, JSON.stringify(shrink.payload));
    const grow = await call(saveRow, { body: body({ slot: 1, machineOffTime: "13:30" }) });
    assert.equal(grow.statusCode, 400);
    assert.match(grow.payload.message, /1:00 PM – 5:00 PM/);
  });
});

test("other machines and other dates never block", async () => {
  await withDb([{ slot: 1, machine: "64b0c0ffee0000000000bbbb", machineOnTime: "08:00", machineOffTime: "12:00" }], async () => {
    const res = await call(saveRow, { body: body() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  });
});

test("an older row that already breaks the rules stays editable while its times are untouched", async () => {
  // Saved when overnight entries were allowed, and overlapping another row.
  const rows = [
    { slot: 1, machineOnTime: "22:00", machineOffTime: "06:00" },
    { slot: 2, machineOnTime: "23:00", machineOffTime: "23:30" },
  ];
  await withDb(rows, async () => {
    const untouched = await call(saveRow, {
      body: body({ slot: 1, machineOnTime: "22:00", machineOffTime: "06:00", plannedOperatorShiftHours: 8, remarks: "note" }),
    });
    assert.equal(untouched.statusCode, 200, JSON.stringify(untouched.payload));

    const changed = await call(saveRow, { body: body({ slot: 1, machineOnTime: "22:00", machineOffTime: "05:00" }) });
    assert.equal(changed.statusCode, 400, "changing the times brings the rules back");
    assert.equal(changed.payload.message, "Machine OFF Time must be after Machine ON Time");
  });
});

test("clearing a row (every field blank) is not blocked by the time rules", async () => {
  await withDb([{ slot: 1, machineOnTime: "08:00", machineOffTime: "12:00" }], async () => {
    const res = await call(saveRow, { body: { date: TODAY, machine: MACHINE, slot: 1 } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(res.payload.message, "Row cleared");
  });
});

test("GET /occupied lists a machine's slots on a date, and validates its input", async () => {
  await withDb(
    [
      { slot: 2, machineOnTime: "13:00", machineOffTime: "17:00" },
      { slot: 1, machineOnTime: "08:00", machineOffTime: "12:00" },
    ],
    async () => {
      const res = await call(getOccupied, { query: { date: TODAY, machine: MACHINE } });
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.data.length, 2);
      assert.deepEqual(res.payload.data[0], { slot: 2, machineOnTime: "13:00", machineOffTime: "17:00" });

      assert.equal((await call(getOccupied, { query: { date: "nope", machine: MACHINE } })).statusCode, 400);
      assert.equal((await call(getOccupied, { query: { date: TODAY, machine: "x" } })).statusCode, 400);
    },
  );
});
