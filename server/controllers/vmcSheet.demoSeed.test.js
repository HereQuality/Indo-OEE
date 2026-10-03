// Every row seed/seedVmcDemo.js would insert has to pass the VMC entry rules — so each can be
// opened on the page and re-saved untouched. Run against stand-ins for the models (no database
// is touched):  node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const VmcEntry = require("../models/VmcEntry");
const Machine = require("../models/Machine");
const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const { ENTRIES, PARTS, dateOf } = require("../seed/seedVmcDemo");
const { saveRow } = require("./vmcSheet.controller");

const MACHINES = ["64b0c0ffee0000000000a001", "64b0c0ffee0000000000a002", "64b0c0ffee0000000000a003", "64b0c0ffee0000000000a004"];
// Fewer operators than machines is the realistic case (Operator Master holds four names).
const OPERATORS = ["Jatin", "dhruv", "mann", "yash"];

const call = async (req) => {
  const res = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
  await saveRow({ user: { _id: "u1", constructor: { modelName: "User" } }, query: {}, ...req }, res);
  return res;
};

// A table that grows as rows are saved, so later rows are checked against earlier ones
// (same machine overlapping, same operator on two machines at once, a full day of slots).
const withGrowingTable = async (fn) => {
  const table = [];
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
  const restore = [];
  const stub = (obj, name, fn) => {
    const orig = obj[name];
    obj[name] = fn;
    restore.push(() => (obj[name] = orig));
  };
  stub(Machine, "exists", async () => ({ _id: "m" }));
  stub(VmcEntry, "find", (q) => chain(match(q)));
  stub(VmcEntry, "findOne", (q) => chain(match(q)[0] || null));
  stub(VmcEntry, "findOneAndUpdate", (key, update) => ({
    lean: async () => {
      const doc = { _id: `r${table.length}`, ...key, ...update.$set };
      table.push(doc);
      return doc;
    },
  }));
  stub(WeeklyOffSetting, "findOne", () => ({ lean: () => Promise.resolve(null) }));
  stub(CompanyHoliday, "find", () => ({ lean: async () => [] }));
  try {
    await fn(table);
  } finally {
    restore.forEach((r) => r());
  }
};

test("every demo entry passes the entry rules, one after another", async () => {
  await withGrowingTable(async (table) => {
    for (const { ago, machine, op, part, ...rest } of ENTRIES) {
      const p = PARTS[part];
      const res = await call({
        body: {
          ...rest,
          date: dateOf(ago),
          machine: MACHINES[machine],
          slot: "auto",
          operator: OPERATORS[op],
          itemName: p.itemName,
          drawingNo: p.drawingNo,
          setupNo: p.setupNo,
          programTimeMin: p.programTimeMin,
          pcsPerProgram: p.pcsPerProgram,
        },
      });
      assert.equal(res.statusCode, 200, `${dateOf(ago)} machine ${machine} ${p.itemName}: ${res.payload?.message}`);
    }
    assert.equal(table.length, ENTRIES.length);
  });
});

test("the demo spans several days and machines, with a second shift on one", () => {
  assert.ok(new Set(ENTRIES.map((e) => e.ago)).size >= 3, "several days");
  assert.ok(new Set(ENTRIES.map((e) => e.machine)).size >= 4, "four machines");
  const perMachineDay = {};
  for (const e of ENTRIES) perMachineDay[`${e.ago}|${e.machine}`] = (perMachineDay[`${e.ago}|${e.machine}`] || 0) + 1;
  assert.ok(Object.values(perMachineDay).some((n) => n > 1), "a machine with two shifts in a day");
});
