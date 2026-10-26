// Deleting a machine hides it from Machine Master but leaves its data entries as
// they are.  Run against stand-ins for the models (no database is touched):  node --test controllers/
const test = require("node:test");
const assert = require("node:assert/strict");

const Machine = require("../models/Machine");
const ProductionEntry = require("../models/ProductionEntry");
const VmcEntry = require("../models/VmcEntry");
const SpmEntry = require("../models/SpmEntry");
const RivetEntry = require("../models/RivetEntry");
const PressEntry = require("../models/PressEntry");
const ContactEntry = require("../models/ContactEntry");
const TrobeEntry = require("../models/TrobeEntry");
const SpringEntry = require("../models/SpringEntry");
const InjectionEntry = require("../models/InjectionEntry");
const { deleteMachine, updateMachine, listMachineByParams } = require("./machine.controller");
const { machineNamesFor } = require("../utils/machineNames");

const ID = "64b0c0ffee0000000000aaaa";

const call = async (handler, req) => {
  const res = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
  await handler({ user: { roleType: "SuperAdmin" }, params: { machineId: ID }, body: {}, ...req }, res);
  return res;
};

// Every sheet whose entries are made on a machine.
const ENTRY_MODELS = { ProductionEntry, VmcEntry, SpmEntry, RivetEntry, PressEntry, ContactEntry, TrobeEntry, SpringEntry };
ENTRY_MODELS.InjectionEntry = InjectionEntry;
ENTRY_MODELS.EmbossingEntry = require("../models/EmbossingEntry");
ENTRY_MODELS.MfdEntry = require("../models/MfdEntry");
// PRINTING is kept per operator, but an entry may name its machine as MC No.
ENTRY_MODELS.PrintingEntry = require("../models/PrintingEntry");

// One machine, with `entries` CNC entries, `vmcEntries` VMC entries and `others`
// ({ SpmEntry: 2, … }) entries on the other sheets pointing at it.
const withModels = async ({ machine, entries = 0, vmcEntries = 0, others = {} }, fn) => {
  const seen = { saved: null, entryWrites: 0, machineQuery: null, bulk: null };
  const restore = [];
  const stub = (obj, name, impl) => {
    const orig = obj[name];
    obj[name] = impl;
    restore.push(() => (obj[name] = orig));
  };
  const doc = machine && {
    ...machine,
    async save() {
      seen.saved = { isActive: this.isActive, isDeleted: this.isDeleted, sequence: this.sequence };
    },
  };
  stub(Machine, "findOne", async (q) => {
    seen.machineQuery = q;
    // the controller must never see a machine that is already deleted
    return doc && !(machine.isDeleted && q.isDeleted) ? doc : null;
  });
  stub(Machine, "exists", async () => null);
  stub(Machine, "findOneAndUpdate", async (q) => (doc && !(machine.isDeleted && q.isDeleted) ? doc : null));
  stub(Machine, "find", () => ({ select: () => ({ lean: async () => [] }), lean: async () => [] }));
  stub(Machine, "bulkWrite", async (ops) => {
    seen.bulk = ops;
  });
  stub(Machine, "findByIdAndDelete", async () => {
    throw new Error("a machine must not be physically removed");
  });
  const counts = { ProductionEntry: entries, VmcEntry: vmcEntries, ...others };
  for (const [key, model] of Object.entries(ENTRY_MODELS)) {
    for (const name of ["deleteMany", "updateMany", "deleteOne", "findOneAndUpdate"]) {
      stub(model, name, async () => {
        seen.entryWrites += 1;
      });
    }
    stub(model, "countDocuments", async () => counts[key] || 0);
  }
  try {
    await fn(seen);
  } finally {
    restore.forEach((r) => r());
  }
};

test("deleting an active machine only deactivates it", async () => {
  await withModels({ machine: { machineName: "7E", isActive: true, isDeleted: false, sequence: 5 } }, async (seen) => {
    const res = await call(deleteMachine, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.message, "Machine deactivated successfully");
    assert.deepEqual(seen.saved, { isActive: false, isDeleted: false, sequence: 5 });
  });
});

test("an inactive machine with data entries can be deleted, and its entries are left alone", async () => {
  await withModels({ machine: { machineName: "7E", isActive: false, isDeleted: false, sequence: 5 }, entries: 3, vmcEntries: 1 }, async (seen) => {
    const res = await call(deleteMachine, {});
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.match(res.payload.message, /Machine deleted successfully\. Its 4 data entries are kept as they were\./);
    // hidden and out of the numbering — not removed
    assert.deepEqual(seen.saved, { isActive: false, isDeleted: true, sequence: 0 });
    assert.equal(seen.entryWrites, 0, "no entry is touched");
  });
});

test("a machine with a single entry says so in the singular, and one with none stays quiet", async () => {
  await withModels({ machine: { machineName: "7E", isActive: false, isDeleted: false }, entries: 1 }, async () => {
    const res = await call(deleteMachine, {});
    assert.match(res.payload.message, /Its 1 data entry is kept as it was\./);
  });
  await withModels({ machine: { machineName: "7E", isActive: false, isDeleted: false } }, async () => {
    const res = await call(deleteMachine, {});
    assert.equal(res.payload.message, "Machine deleted successfully");
  });
});

test("the kept-entries count takes in every machine sheet, not only CNC and VMC", async () => {
  const others = { SpmEntry: 1, RivetEntry: 1, PressEntry: 1, ContactEntry: 1, TrobeEntry: 1, SpringEntry: 2 };
  await withModels({ machine: { machineName: "7E", isActive: false, isDeleted: false }, entries: 1, vmcEntries: 1, others }, async (seen) => {
    const res = await call(deleteMachine, {});
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.match(res.payload.message, /Its 9 data entries are kept as they were\./);
    assert.equal(seen.entryWrites, 0, "no entry is touched");
  });
});

test("a machine that is already deleted is gone as far as Machine Master is concerned", async () => {
  await withModels({ machine: { machineName: "7E", isActive: false, isDeleted: true } }, async () => {
    assert.equal((await call(deleteMachine, {})).statusCode, 404);
    assert.equal((await call(updateMachine, { body: { machineName: "7E" } })).statusCode, 404);
  });
});

test("the Machine Master list leaves deleted machines out", async () => {
  await withModels({ machine: null }, async (seen) => {
    let query = null;
    const orig = Machine.find;
    Machine.find = (q) => {
      query = q;
      return { lean: async () => [] };
    };
    try {
      const res = await call(listMachineByParams, { body: { isActive: false } });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(query.isDeleted, { $ne: true });
    } finally {
      Machine.find = orig;
    }
  });
});

test("search text is matched as plain text, so \"(\" or \"*\" can't break it", async () => {
  await withModels({ machine: null }, async () => {
    let query = null;
    const orig = Machine.find;
    Machine.find = (q) => {
      query = q;
      return { lean: async () => [] };
    };
    try {
      const res = await call(listMachineByParams, { body: { match: "7A (old*" } });
      assert.equal(res.statusCode, 200);
      const pattern = query.$or[0].machineName.$regex;
      assert.doesNotThrow(() => new RegExp(pattern));
      assert.ok(new RegExp(pattern, "i").test("7a (OLD*"));
      assert.ok(!new RegExp(pattern, "i").test("7A old"));
    } finally {
      Machine.find = orig;
    }
  });
});

test("machineNamesFor names active, inactive and deleted machines alike", async () => {
  const orig = Machine.find;
  let asked = null;
  Machine.find = (q) => {
    asked = q;
    return { select: () => ({ lean: async () => [{ _id: "a", machineName: "7A" }, { _id: "b", machineName: "7E" }] }) };
  };
  try {
    assert.deepEqual(await machineNamesFor(["a", "b", "a"]), { a: "7A", b: "7E" });
    assert.deepEqual(asked, { _id: { $in: ["a", "b"] } }, "no isActive / isDeleted filter, each id once");
    assert.deepEqual(await machineNamesFor([]), {}, "nothing to look up");
  } finally {
    Machine.find = orig;
  }
});

test("INJECTION MOULDING entries count among the kept entries too", async () => {
  await withModels({ machine: { machineName: "IM-1", isActive: false, isDeleted: false }, others: { InjectionEntry: 3 } }, async (seen) => {
    const res = await call(deleteMachine, {});
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.match(res.payload.message, /Its 3 data entries are kept as they were\./);
    assert.equal(seen.entryWrites, 0, "no entry is touched");
  });
});

test("EMBOSSING entries count among the kept entries too", async () => {
  await withModels({ machine: { machineName: "M/c -6/c", isActive: false, isDeleted: false }, others: { EmbossingEntry: 5 } }, async (seen) => {
    const res = await call(deleteMachine, {});
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.match(res.payload.message, /Its 5 data entries are kept as they were\./);
    assert.equal(seen.entryWrites, 0, "no entry is touched");
  });
});

test("MODULAR FRAME DRILLING entries count among the kept entries too", async () => {
  await withModels({ machine: { machineName: "4/B", isActive: false, isDeleted: false }, others: { MfdEntry: 4 } }, async (seen) => {
    const res = await call(deleteMachine, {});
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.match(res.payload.message, /Its 4 data entries are kept as they were\./);
    assert.equal(seen.entryWrites, 0, "no entry is touched");
  });
});

test("PRINTING entries that name the machine as their MC No. count among the kept entries", async () => {
  const PrintingEntry = require("../models/PrintingEntry");
  await withModels({ machine: { machineName: "PR-1", isActive: false, isDeleted: false }, others: { PrintingEntry: 2 } }, async (seen) => {
    // Counted by its MC No. field — a PRINTING entry's row key is its operator.
    let asked = null;
    const counted = PrintingEntry.countDocuments;
    PrintingEntry.countDocuments = async (q) => ((asked = q), 2);
    try {
      const res = await call(deleteMachine, {});
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      assert.match(res.payload.message, /Its 2 data entries are kept as they were\./);
      assert.deepEqual(asked, { mcMachine: ID });
      assert.equal(seen.entryWrites, 0, "no entry is touched");
    } finally {
      PrintingEntry.countDocuments = counted;
    }
  });
});
