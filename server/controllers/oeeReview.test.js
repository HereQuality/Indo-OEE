// OEE above 100% → Admin review, the audit log, the Operator Planned Shift
// lock, and Machine Working Status — run against an in-memory stand-in for
// the models (no database is touched):  node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const ProductionEntry = require("../models/ProductionEntry");
const Machine = require("../models/Machine");
const Process = require("../models/Process");
const AuditLog = require("../models/AuditLog");
const User = require("../models/user.model");
const Operator = require("../models/Operator");
const RoleMaster = require("../models/RoleMaster");
const OperatorRoles = require("../models/OperatorRoles");
const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const Notification = require("../models/Notification");
const { saveRow } = require("./productionSheet.controller");
const { updateProcess } = require("./process.controller");
const { decide, getAccess, reopen, applyShift } = require("./oeeReview.controller");
const { requireAdmin } = require("../utils/adminAccess");
const { reviewFor } = require("../utils/entryAudit");

const MACHINE = "64b0c0ffee0000000000aaaa";
const PROCESS = "64b0c0ffee0000000000dddd";
const TODAY = new Date().toISOString().slice(0, 10);
let nextId = 1;
const newId = () => `64b0c0ffee00000000${String(nextId++).padStart(6, "0")}`;

const SUPER_ADMIN = { _id: "64b0c0ffee0000000000a001", roleType: "SuperAdmin", name: "HQEPL Admin", constructor: { modelName: "User" } };
const ADMIN_OP = { _id: "64b0c0ffee0000000000a002", roleType: "Operator", roleId: "role-admin", employeeName: "Asha", constructor: { modelName: "Operator" } };
const OTHER_OP = { _id: "64b0c0ffee0000000000a003", roleType: "Operator", roleId: "role-sup", employeeName: "Ravi", constructor: { modelName: "Operator" } };
const ROLES = {
  "role-admin": { roleName: "Admin", roleCode: "admin" },
  "role-sup": { roleName: "Supervisor", roleCode: "supervisor" },
  "role-full": { roleName: "Plant Head", roleCode: "head" },
  "role-unticked": { roleName: "Old Admin", roleCode: "admin" },
};
// What Manage Role saved per role — the "Full access" box. Absent = never saved.
const PERMS = { "role-full": { fullAccess: true }, "role-unticked": { fullAccess: false } };

// Everything the controllers touch, kept in plain arrays.
const fakeWorld = ({ process = null } = {}) => {
  const entries = [];
  const logs = [];
  const processes = process ? [{ _id: PROCESS, processName: "CNC", ...process }] : [];
  const chain = (v) => ({ select: () => chain(v), sort: () => chain(v), populate: () => chain(v), limit: () => chain(v), lean: async () => v });
  const sameId = (a, b) => String(a) === String(b);
  const match = (q = {}) =>
    entries.filter(
      (r) =>
        (!q._id || sameId(r._id, q._id)) &&
        (!q.date || q.date.$in || r.date.getTime() === q.date.getTime()) &&
        (!q.machine || sameId(r.machine, q.machine)) &&
        (!q.operator || r.operator === q.operator) &&
        (!q.$nor || !q.$nor.some((n) => sameId(r.machine, n.machine) && r.slot === n.slot)) &&
        (q.slot === undefined || (q.slot && q.slot.$ne !== undefined ? r.slot !== q.slot.$ne : r.slot === q.slot)) &&
        (!q["review.flaggedAt"] || (r.review && new Date(r.review.flaggedAt).getTime() === new Date(q["review.flaggedAt"]).getTime())) &&
        (!q["review.status"] || (r.review && r.review.status === q["review.status"])),
    );
  const apply = (doc, update) => {
    for (const [k, v] of Object.entries(update.$set || {})) {
      if (k.includes(".")) {
        const [a, b] = k.split(".");
        doc[a] = { ...(doc[a] || {}), [b]: v };
      } else doc[k] = v;
    }
    for (const k of Object.keys(update.$unset || {})) delete doc[k];
    return doc;
  };
  const clone = (v) => (v ? JSON.parse(JSON.stringify(v), (k, x) => (k === "date" || k === "createdAt" ? new Date(x) : x)) : v);

  const restore = [];
  const stub = (obj, name, fn) => {
    const orig = obj[name];
    obj[name] = fn;
    restore.push(() => (obj[name] = orig));
  };
  stub(ProductionEntry, "find", (q) => chain(clone(match(q))));
  stub(ProductionEntry, "findOne", (q) => chain(clone(match(q)[0] || null)));
  stub(ProductionEntry, "findById", (id) => chain(clone(entries.find((e) => sameId(e._id, id)) || null)));
  stub(ProductionEntry, "findOneAndUpdate", (q, update) => ({
    lean: async () => {
      let doc = match(q)[0];
      if (!doc && q.date) {
        doc = { _id: newId(), createdAt: new Date(), ...q };
        entries.push(doc);
      }
      return doc ? clone(apply(doc, update)) : null;
    },
  }));
  stub(ProductionEntry, "findByIdAndUpdate", (id, update) => ({
    lean: async () => {
      const doc = entries.find((e) => sameId(e._id, id));
      return doc ? clone(apply(doc, update)) : null;
    },
  }));
  stub(ProductionEntry, "deleteOne", async ({ _id }) => {
    const i = entries.findIndex((e) => sameId(e._id, _id));
    if (i >= 0) entries.splice(i, 1);
  });
  stub(Machine, "exists", async () => ({ _id: MACHINE }));
  stub(Machine, "findById", () => chain({ _id: MACHINE, process: process ? PROCESS : null }));
  stub(Machine, "find", () => chain([{ _id: MACHINE, machineName: "7A", process: process ? PROCESS : null }]));
  stub(Machine, "updateMany", async () => ({}));
  stub(Process, "findById", (id) => chain(clone(processes.find((p) => sameId(p._id, id)) || null)));
  stub(Process, "find", () => chain(processes));
  stub(Process, "exists", async () => null);
  stub(Process, "findByIdAndUpdate", async (id, update) => {
    const p = processes.find((x) => sameId(x._id, id));
    return p ? Object.assign(p, update) : null;
  });
  stub(AuditLog, "create", async (row) => (logs.push(row), row));
  stub(Notification, "create", async (p) => ({ toObject: () => p }));
  stub(User, "find", () => chain([]));
  stub(Operator, "find", () => chain([]));
  stub(RoleMaster, "find", () => chain([]));
  stub(RoleMaster, "findById", (id) => chain(ROLES[id] || null));
  stub(OperatorRoles, "findOne", (q) => chain(PERMS[q.roleId] || null));
  stub(OperatorRoles, "find", () => chain(Object.entries(PERMS).map(([roleId, p]) => ({ roleId, ...p }))));
  stub(WeeklyOffSetting, "findOne", () => ({ lean: () => Promise.resolve(null) }));
  stub(CompanyHoliday, "find", () => ({ lean: async () => [] }));
  return { entries, logs, processes, restore: () => restore.forEach((r) => r()) };
};

const call = async (handler, req) => {
  const res = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
  await handler({ user: SUPER_ADMIN, query: {}, params: {}, ...req }, res);
  return res;
};

const withWorld = async (opts, fn) => {
  const world = fakeWorld(opts);
  try {
    await fn(world);
  } finally {
    world.restore();
  }
};

// 08:00–16:00 (480 min), 8 h planned, no stoppage, 60 s cycle → 480 pieces is
// exactly 100% Performance; 490 is 102.08%.
const body = (o = {}) => ({
  date: TODAY,
  machine: MACHINE,
  slot: "auto",
  operator: "Asha",
  itemName: "Bracket",
  totalCycleSec: 60,
  machineOnTime: "08:00",
  machineOffTime: "16:00",
  actualQty: 400,
  okQty: 390,
  plannedOperatorShiftHours: 8,
  lunchMin: 0,
  ...o,
});

test("an entry with Performance over 100% saves, is held for review, and the figure is not capped", async () => {
  await withWorld({}, async ({ entries, logs }) => {
    const res = await call(saveRow, { body: body({ actualQty: 490, okQty: 485 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const saved = entries[0];
    assert.equal(saved.review.status, "pending");
    assert.deepEqual(saved.review.flagged.map((f) => f.metric), ["performance"]);
    assert.ok(Math.abs(saved.oee.performance - 490 / 480) < 1e-4, "kept at 102.08%, not 100%");
    assert.deepEqual(logs.map((l) => l.action), ["create", "flagged"]);
    assert.match(logs[1].remark, /Performance 102\.1%/);
  });
});

test("an entry at or under 100% everywhere needs no review", async () => {
  await withWorld({}, async ({ entries, logs }) => {
    const res = await call(saveRow, { body: body({ actualQty: 480, okQty: 480 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(entries[0].review, undefined);
    assert.ok(Math.abs(entries[0].oee.performance - 1) < 1e-9);
    assert.deepEqual(logs.map((l) => l.action), ["create"]);
  });
});

test("Availability over 100% alone triggers review too", () => {
  // Can't happen on a new entry (Planned Operator Shift must cover the Machine
  // Shift), but an older row saved before that rule — 13 h run, 12 h planned —
  // does go to review rather than being quietly accepted.
  const legacy = { ...body(), machineOnTime: "07:00", machineOffTime: "20:00", plannedOperatorShiftHours: 12 };
  const r = reviewFor("cnc", null, legacy, {});
  assert.equal(r.transition, "flagged");
  assert.deepEqual(r.over.map((f) => f.metric), ["availability"]);
  assert.ok(Math.abs(r.oee.availability - 780 / 720) < 1e-4);
});

test("approve, then: an edit that doesn't touch the figures keeps it approved; one that does sends it back", async () => {
  await withWorld({}, async ({ entries, logs }) => {
    await call(saveRow, { body: body({ actualQty: 490, okQty: 485 }) });
    const id = entries[0]._id;

    const approve = await call(decide, { params: { sheet: "cnc", id }, body: { decision: "approved", remark: "Checked cycle time", flaggedAt: entries[0].review.flaggedAt } });
    assert.equal(approve.statusCode, 200, JSON.stringify(approve.payload));
    assert.equal(entries[0].review.status, "approved");
    assert.equal(entries[0].review.decidedBy.name, "HQEPL Admin");
    assert.equal(logs.at(-1).action, "approved");
    assert.equal(logs.at(-1).remark, "Checked cycle time");

    // Remark-only edit: same over-100% figure → still approved, just an update row.
    await call(saveRow, { body: body({ _id: id, slot: 1, actualQty: 490, okQty: 485, remarks: "note" }) });
    assert.equal(entries[0].review.status, "approved");
    assert.equal(logs.at(-1).action, "update");
    assert.deepEqual(logs.at(-1).changes.map((c) => c.field), ["remarks"]);

    // Changing the quantity changes the figure → pending again.
    await call(saveRow, { body: body({ _id: id, slot: 1, actualQty: 495, okQty: 485, remarks: "note" }) });
    assert.equal(entries[0].review.status, "pending");
    assert.deepEqual(logs.slice(-2).map((l) => l.action), ["update", "flagged"]);
  });
});

test("an edit that brings every figure back to 100% or under clears the review", async () => {
  await withWorld({}, async ({ entries, logs }) => {
    await call(saveRow, { body: body({ actualQty: 490, okQty: 485 }) });
    const id = entries[0]._id;
    await call(saveRow, { body: body({ _id: id, slot: 1, actualQty: 470, okQty: 465 }) });
    assert.equal(entries[0].review, undefined);
    assert.equal(logs.at(-1).action, "cleared");
  });
});

test("every changed field is logged old → new; an unchanged save logs nothing new", async () => {
  await withWorld({}, async ({ entries, logs }) => {
    await call(saveRow, { body: body() });
    const id = entries[0]._id;
    await call(saveRow, { body: body({ _id: id, slot: 1, okQty: 380, setupMin: 15 }) });
    const update = logs.at(-1);
    assert.equal(update.action, "update");
    const byField = Object.fromEntries(update.changes.map((c) => [c.field, [c.from, c.to]]));
    assert.deepEqual(byField.okQty, [390, 380]);
    assert.deepEqual(byField.setupMin, [null, 15]);
    assert.equal(update.actor.role, "Super Admin");
    const count = logs.length;
    await call(saveRow, { body: body({ _id: id, slot: 1, okQty: 380, setupMin: 15 }) });
    assert.equal(logs.length, count, "nothing changed → no new row");
  });
});

test("locked process: a new entry gets 12 h whatever was typed; an edit keeps the shift it was saved with", async () => {
  await withWorld({ process: { plannedShiftLocked: true, plannedShiftHours: 12 } }, async ({ entries }) => {
    const res = await call(saveRow, { body: body({ plannedOperatorShiftHours: 8 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(entries[0].plannedOperatorShiftHours, 12);
    entries[0].plannedOperatorShiftHours = 11; // saved before the lock existed
    await call(saveRow, { body: body({ _id: entries[0]._id, slot: 1, plannedOperatorShiftHours: 9 }) });
    assert.equal(entries[0].plannedOperatorShiftHours, 11);
  });
});

test("locked process with its own hours (8): a new entry gets those hours", async () => {
  await withWorld({ process: { plannedShiftLocked: true, plannedShiftHours: 8 } }, async ({ entries }) => {
    const res = await call(saveRow, { body: body({ plannedOperatorShiftHours: 12 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(entries[0].plannedOperatorShiftHours, 8);
  });
});

test("unlocked process: the hours typed on the entry are kept", async () => {
  await withWorld({ process: { plannedShiftLocked: false, plannedShiftHours: 10 } }, async ({ entries }) => {
    const res = await call(saveRow, { body: body({ plannedOperatorShiftHours: 8 }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(entries[0].plannedOperatorShiftHours, 8);
  });
});

test("Machine Working Status: any of the three are saved; anything else is refused", async () => {
  await withWorld({}, async ({ entries }) => {
    const ok = await call(saveRow, { body: body({ machineStatus: ["No Planning", "Machine Breakdown"] }) });
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.payload));
    assert.deepEqual(entries[0].machineStatus, ["Machine Breakdown", "No Planning"]);
    const bad = await call(saveRow, { body: body({ machineOnTime: "17:00", machineOffTime: "18:00", plannedOperatorShiftHours: 1, actualQty: 10, okQty: 10, machineStatus: ["Holiday"] }) });
    assert.equal(bad.statusCode, 400);
    assert.match(bad.payload.message, /Unknown Machine Working Status/);
  });
});

test("only Admin / Super Admin may lock, unlock or change the planned shift — and it's logged", async () => {
  await withWorld({ process: { plannedShiftLocked: true, plannedShiftHours: 12 } }, async ({ processes, logs }) => {
    const denied = await call(updateProcess, { user: OTHER_OP, params: { processId: PROCESS }, body: { processName: "CNC", plannedShiftLocked: false, plannedShiftHours: 10 } });
    assert.equal(denied.statusCode, 403);
    assert.equal(processes[0].plannedShiftLocked, true);

    // The same user can still save the rest of the process with the setting unchanged.
    const unchanged = await call(updateProcess, { user: OTHER_OP, params: { processId: PROCESS }, body: { processName: "CNC", description: "x", plannedShiftLocked: true, plannedShiftHours: 12 } });
    assert.equal(unchanged.statusCode, 200, JSON.stringify(unchanged.payload));

    const bad = await call(updateProcess, { user: ADMIN_OP, params: { processId: PROCESS }, body: { processName: "CNC", plannedShiftLocked: false, plannedShiftHours: 0 } });
    assert.equal(bad.statusCode, 400);

    const allowed = await call(updateProcess, { user: ADMIN_OP, params: { processId: PROCESS }, body: { processName: "CNC", plannedShiftLocked: false, plannedShiftHours: 10 } });
    assert.equal(allowed.statusCode, 200, JSON.stringify(allowed.payload));
    assert.equal(processes[0].plannedShiftLocked, false);
    assert.equal(processes[0].plannedShiftHours, 10);
    const log = logs.at(-1);
    assert.equal(log.action, "setting");
    assert.match(log.changes[0].from, /^Locked — 12 hr/);
    assert.equal(log.changes[0].to, "Unlocked — entered on each entry");
    assert.equal(log.actor.role, "Admin");
  });
});

test("review decisions: Admin only, a reject needs a remark, and a stale screen can't decide", async () => {
  await withWorld({}, async ({ entries }) => {
    // The route guard.
    for (const [user, allowed] of [[SUPER_ADMIN, true], [ADMIN_OP, true], [OTHER_OP, false]]) {
      let passed = false;
      const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { return this; } };
      await requireAdmin({ user }, res, () => (passed = true));
      assert.equal(passed, allowed, user.employeeName || user.name);
      if (!allowed) assert.equal(res.statusCode, 403);
    }

    await call(saveRow, { body: body({ actualQty: 490, okQty: 485 }) });
    const id = entries[0]._id;
    const flaggedAt = entries[0].review.flaggedAt;

    const noRemark = await call(decide, { params: { sheet: "cnc", id }, body: { decision: "rejected", remark: " " } });
    assert.equal(noRemark.statusCode, 400);
    const stale = await call(decide, { params: { sheet: "cnc", id }, body: { decision: "approved", flaggedAt: new Date(0).toISOString() } });
    assert.equal(stale.statusCode, 409);
    const reject = await call(decide, { user: ADMIN_OP, params: { sheet: "cnc", id }, body: { decision: "rejected", remark: "Recount", flaggedAt } });
    assert.equal(reject.statusCode, 200, JSON.stringify(reject.payload));
    assert.equal(entries[0].review.status, "rejected");
    assert.equal(entries[0].review.remark, "Recount");
  });
});

test("two Admins on one entry: the second is told who decided it, and nothing is overwritten", async () => {
  await withWorld({}, async ({ entries, logs }) => {
    await call(saveRow, { body: body({ actualQty: 490, okQty: 485 }) });
    const id = entries[0]._id;
    const flaggedAt = entries[0].review.flaggedAt;

    const first = await call(decide, { user: ADMIN_OP, params: { sheet: "cnc", id }, body: { decision: "approved", remark: "OK", flaggedAt } });
    assert.equal(first.statusCode, 200, JSON.stringify(first.payload));
    const decisions = logs.length;

    // Opened before the first decision landed — same flag, but no longer pending.
    const second = await call(decide, { params: { sheet: "cnc", id }, body: { decision: "rejected", remark: "Recount", flaggedAt } });
    assert.equal(second.statusCode, 409);
    assert.equal(second.payload.message, "Already approved by Asha — reload");
    assert.equal(entries[0].review.status, "approved");
    assert.equal(entries[0].review.decidedBy.name, "Asha");
    assert.equal(logs.length, decisions, "no second decision logged");
  });
});

test("a decision racing another one is refused by the write itself, not only by the read before it", async () => {
  await withWorld({}, async ({ entries }) => {
    await call(saveRow, { body: body({ actualQty: 490, okQty: 485 }) });
    const id = entries[0]._id;
    const flaggedAt = entries[0].review.flaggedAt;
    // The reviewer's read still sees it pending; by the time it writes, Asha has rejected it.
    const pendingSnapshot = JSON.parse(JSON.stringify(entries[0]), (k, x) => (k === "date" ? new Date(x) : x));
    entries[0].review = { ...entries[0].review, status: "rejected", decidedBy: { name: "Asha" }, remark: "Recount" };
    const findById = ProductionEntry.findById;
    let reads = 0;
    ProductionEntry.findById = (...args) => (reads++ === 0 ? { lean: async () => pendingSnapshot } : findById(...args));
    try {
      const res = await call(decide, { params: { sheet: "cnc", id }, body: { decision: "approved", flaggedAt } });
      assert.equal(res.statusCode, 409);
      assert.equal(res.payload.message, "Already rejected by Asha — reload");
      assert.equal(entries[0].review.status, "rejected");
    } finally {
      ProductionEntry.findById = findById;
    }
  });
});

test("deciding an entry whose review has gone is a stale screen too (409)", async () => {
  await withWorld({}, async ({ entries }) => {
    await call(saveRow, { body: body({ actualQty: 490, okQty: 485 }) });
    const id = entries[0]._id;
    await call(saveRow, { body: body({ _id: id, slot: 1, actualQty: 470, okQty: 465 }) });
    const res = await call(decide, { params: { sheet: "cnc", id }, body: { decision: "approved" } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.message, "This entry doesn't need review any more");
  });
});

test("Machine Working Status: Non Working saves only the day, machine, operator, reason and remarks", async () => {
  await withWorld({}, async ({ entries }) => {
    const res = await call(saveRow, { body: body({ workingMode: "Non Working", machineStatus: ["No Manpower"], remarks: "No one on shift", operator: "" }) });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(entries.length, 1);
    const row = entries[0];
    assert.equal(row.workingMode, "Non Working");
    assert.deepEqual(row.machineStatus, ["No Manpower"]);
    assert.equal(row.remarks, "No one on shift");
    // Everything else typed before switching is dropped, and nothing gets reviewed.
    assert.ok(!row.itemName && !row.machineOnTime && row.okQty === undefined && row.actualQty === undefined);
    assert.ok(!row.review);
  });
});

test("Machine Working Status: anything but Working / Non Working is refused; Working stores nothing extra", async () => {
  await withWorld({}, async ({ entries }) => {
    const bad = await call(saveRow, { body: body({ workingMode: "Holiday" }) });
    assert.equal(bad.statusCode, 400);
    assert.match(bad.payload.message, /Working or Non Working/);
    const ok = await call(saveRow, { body: body({ workingMode: "Working" }) });
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.payload));
    assert.equal(entries[0].workingMode, undefined);
  });
});

test("Full access ticked in Manage Role lets any role in; unticking it takes an \"admin\"-coded role out", async () => {
  const op = (roleId) => ({ ...ADMIN_OP, roleId });
  await withWorld({}, async () => {
    const ask = async (roleId) => (await call(getAccess, { user: op(roleId) })).payload.data.canReview;
    assert.equal(await ask("role-full"), true, "ticked, whatever its code");
    assert.equal(await ask("role-admin"), true, "never saved: the legacy admin code still counts");
    assert.equal(await ask("role-unticked"), false, "unticked beats the admin code");
    assert.equal(await ask("role-sup"), false);
  });
});

test("a rejection unlocks the entry for 24 hours, and opening the notification later unlocks it again — for its maker only", async () => {
  await withWorld({}, async ({ entries, logs }) => {
    const MAKER = OTHER_OP;
    const THIRD = { ...OTHER_OP, _id: "64b0c0ffee0000000000a004", employeeName: "Meena" };
    await call(saveRow, { user: MAKER, body: body({ actualQty: 490, okQty: 485 }) });
    const id = entries[0]._id;
    const hours = (d) => (new Date(d).getTime() - Date.now()) / 3600000;

    // Not rejected yet: nothing to reopen.
    assert.equal((await call(reopen, { user: MAKER, params: { sheet: "cnc", id } })).statusCode, 409);

    const reject = await call(decide, { user: ADMIN_OP, params: { sheet: "cnc", id }, body: { decision: "rejected", remark: "Recount" } });
    assert.equal(reject.statusCode, 200, JSON.stringify(reject.payload));
    assert.ok(hours(entries[0].unlockedUntil) > 23.9 && hours(entries[0].unlockedUntil) <= 24, "open for 24 hours from the rejection");
    const unlock = logs.find((l) => l.action === "unlocked");
    assert.ok(unlock, "the unlock is in the audit log");
    assert.match(unlock.remark, /corrected after the OEE review rejection/);
    assert.equal(unlock.actor.name, "Asha", "by the reviewer");

    // The first window has run out; the maker opens the notification.
    entries[0].unlockedUntil = new Date(Date.now() - 3600000);
    assert.equal((await call(reopen, { user: THIRD, params: { sheet: "cnc", id } })).statusCode, 403, "someone else can't");
    const again = await call(reopen, { user: MAKER, params: { sheet: "cnc", id } });
    assert.equal(again.statusCode, 200, JSON.stringify(again.payload));
    assert.ok(hours(entries[0].unlockedUntil) > 23.9, "another 24 hours");
    assert.equal(logs.filter((l) => l.action === "unlocked").length, 2);

    // A Full access user may too; once approved, it can't be reopened.
    assert.equal((await call(reopen, { user: ADMIN_OP, params: { sheet: "cnc", id } })).statusCode, 200);
    entries[0].review.status = "approved";
    assert.equal((await call(reopen, { user: MAKER, params: { sheet: "cnc", id } })).statusCode, 409);
  });
});

test("changing a process's shift leaves past entries alone; \"apply current shift\" brings one earlier entry onto it, separately", async () => {
  await withWorld({ process: { plannedShiftLocked: true, plannedShiftHours: 12 } }, async ({ entries, processes, logs }) => {
    await call(saveRow, { body: body({ machineOnTime: "08:00", machineOffTime: "16:00", actualQty: 400, okQty: 390 }) });
    const id = entries[0]._id;
    assert.equal(entries[0].plannedOperatorShiftHours, 12);
    assert.ok(Math.abs(entries[0].oee.availability - 480 / 720) < 1e-3, "Availability on the 12 h shift");

    // The Admin changes the process to 8 h: yesterday's entry is untouched…
    processes[0].plannedShiftHours = 8;
    assert.equal(entries[0].plannedOperatorShiftHours, 12);
    // …a new one takes the new shift…
    await call(saveRow, { body: body({ machineOnTime: "17:00", machineOffTime: "20:00", plannedOperatorShiftHours: 12, actualQty: 100, okQty: 100 }) });
    assert.equal(entries[1].plannedOperatorShiftHours, 8);

    // …and the first is moved over on purpose.
    const run = (user = ADMIN_OP) => call(applyShift, { user, params: { sheet: "cnc", id } });
    const done = await run();
    assert.equal(done.statusCode, 200, JSON.stringify(done.payload));
    assert.equal(entries[0].plannedOperatorShiftHours, 8);
    assert.equal(entries[0].plannedLocked, true);
    assert.ok(Math.abs(entries[0].oee.availability - 1) < 1e-3, "figures worked out again on 8 h");
    const row = logs.filter((l) => l.action === "update").at(-1);
    assert.deepEqual(row.changes.map((c) => [c.field, c.from, c.to]), [["plannedOperatorShiftHours", 12, 8]]);
    assert.equal(row.actor.name, "Asha");

    // Already there: refused, nothing logged again.
    const logged = logs.length;
    assert.equal((await run()).statusCode, 409);
    assert.equal(logs.length, logged);
  });
});

test("apply current shift: not for a process with no fixed shift, nor when the run is longer than the shift", async () => {
  await withWorld({ process: { plannedShiftLocked: false, plannedShiftHours: 10 } }, async ({ entries }) => {
    await call(saveRow, { body: body({ plannedOperatorShiftHours: 8 }) });
    const res = await call(applyShift, { user: ADMIN_OP, params: { sheet: "cnc", id: entries[0]._id } });
    assert.equal(res.statusCode, 409);
    assert.match(res.payload.message, /no fixed shift/);
  });
  await withWorld({ process: { plannedShiftLocked: true, plannedShiftHours: 12 } }, async ({ entries, processes }) => {
    await call(saveRow, { body: body({ machineOnTime: "06:00", machineOffTime: "18:00", actualQty: 600, okQty: 600 }) });
    processes[0].plannedShiftHours = 8;
    const res = await call(applyShift, { user: ADMIN_OP, params: { sheet: "cnc", id: entries[0]._id } });
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /shorter than this entry's Machine Shift/);
    assert.equal(entries[0].plannedOperatorShiftHours, 12, "unchanged");
  });
});
