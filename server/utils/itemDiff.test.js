// What a part's edit history records: which fields changed and how they read.
// Pure — no database:  node --test utils/
const test = require("node:test");
const assert = require("node:assert/strict");

const { LOGGED_FIELDS, diffItem, updateAction, partLabel } = require("./itemDiff");

const VMC = "64b0c0ffee0000000000aaaa";
const CNC = "64b0c0ffee0000000000bbbb";
const names = { [VMC]: "VMC", [CNC]: "CNC" };

const part = (o = {}) => ({ itemName: "Flange", drawingNo: "DRG-1", setupNo: "S-1", totalCycleSec: 180, isActive: true, ...o });
const fields = (changes) => changes.map((c) => c.field);

test("a save that changes nothing has no changes", () => {
  assert.deepEqual(diffItem(part(), part()), []);
  assert.deepEqual(diffItem({}, {}), []);
});

test("a blank is a blank however it is spelled, and stray spaces are not a change", () => {
  const before = part({ setupNo: "", boringSec: undefined, tappingSec: null, drawingNo: "DRG-1" });
  const after = part({ setupNo: undefined, boringSec: null, tappingSec: "", drawingNo: "  DRG-1 " });
  assert.deepEqual(diffItem(before, after), []);
});

test("a change lists the field, its label and old → new, in the order the form shows them", () => {
  const changes = diffItem(
    part({ drillingSec: 20, boringSec: 10 }),
    part({ itemName: "Flange VF-24", drillingSec: 25, boringSec: 10, totalCycleSec: 200, setupNo: "" }),
  );
  assert.deepEqual(changes, [
    { field: "itemName", label: "Part Name", from: "Flange", to: "Flange VF-24" },
    { field: "setupNo", label: "Setup No.", from: "S-1", to: null },
    { field: "drillingSec", label: "Drilling (sec)", from: 20, to: 25 },
    { field: "totalCycleSec", label: "Total Cycle Time (sec)", from: 180, to: 200 },
  ]);
});

test("every cycle-time field is watched, the second Other Operation under its own name", () => {
  const key = (k) => LOGGED_FIELDS.find((f) => f.key === k);
  for (const k of ["drillingSec", "boringSec", "threadingSec", "tappingSec", "chamferingSec", "otherOp1Sec", "otherOp2Sec", "clampDeclampSec", "totalCycleSec", "programTimeMin", "pcsPerProgram"]) {
    assert.ok(key(k), k);
  }
  assert.equal(key("otherOp1Sec").label, "Other Operation (sec)");
  assert.equal(key("otherOp2Sec").label, "Other Operation 2 (sec)");
  assert.deepEqual(fields(diffItem(part({ otherOp2Sec: 3 }), part({ otherOp2Sec: 4 }))), ["otherOp2Sec"]);
});

test("a VMC part's program is watched; 0 is a value, not a blank", () => {
  const changes = diffItem(part({ programTimeMin: 6, pcsPerProgram: 2 }), part({ programTimeMin: 6, pcsPerProgram: 4, clampDeclampSec: 0 }));
  assert.deepEqual(changes, [
    { field: "pcsPerProgram", label: "No. of Piece In One Program", from: 2, to: 4 },
    { field: "clampDeclampSec", label: "Clamp/Declamp (sec)", from: null, to: 0 },
  ]);
});

test("a process reads as its name, and is compared by id", () => {
  assert.deepEqual(diffItem(part({ process: CNC }), part({ process: VMC }), names), [{ field: "process", label: "Process", from: "CNC", to: "VMC" }]);
  assert.deepEqual(diffItem(part({ process: null }), part({ process: VMC }), names), [{ field: "process", label: "Process", from: null, to: "VMC" }]);
  assert.deepEqual(diffItem(part({ process: CNC }), part({ process: "" }), names), [{ field: "process", label: "Process", from: "CNC", to: null }]);
  // Same process saved again (an ObjectId-like value stringifies to its id): no change.
  assert.deepEqual(diffItem(part({ process: CNC }), part({ process: { toString: () => CNC } }), names), []);
  // Two processes with one name are still two processes; one that's gone has no name to show.
  assert.deepEqual(diffItem(part({ process: CNC }), part({ process: VMC }), { [CNC]: "Same", [VMC]: "Same" }).length, 1);
  assert.equal(diffItem(part({ process: CNC }), part({ process: VMC }), {})[0].to, "Deleted process");
});

test("Status reads Active / Inactive", () => {
  assert.deepEqual(diffItem(part({ isActive: true }), part({ isActive: false })), [{ field: "isActive", label: "Status", from: "Active", to: "Inactive" }]);
});

test("an edit that only switches Status is a deactivate or a restore; anything else an update", () => {
  const off = diffItem(part({ isActive: true }), part({ isActive: false }));
  const on = diffItem(part({ isActive: false }), part({ isActive: true }));
  assert.equal(updateAction(off), "deactivate");
  assert.equal(updateAction(on), "restore");
  assert.equal(updateAction(diffItem(part({ isActive: false }), part({ isActive: true, totalCycleSec: 90 }))), "update");
  assert.equal(updateAction(diffItem(part(), part({ totalCycleSec: 90 }))), "update");
});

test("old-format operation times are watched as a list", () => {
  assert.deepEqual(diffItem(part({ cycleOpsSec: [10, null, 5] }), part({ cycleOpsSec: [10, 4, 5] })), [
    { field: "cycleOpsSec", label: "Operation times, old format (sec)", from: "10, —, 5", to: "10, 4, 5" },
  ]);
  assert.deepEqual(diffItem(part({ cycleOpsSec: [] }), part({ cycleOpsSec: undefined })), []);
});

test("diffing against nothing gives the whole record — what was created, what was deleted", () => {
  const p = part({ process: VMC, programTimeMin: 6, pcsPerProgram: 2, drillingSec: null });
  const created = diffItem({}, p, names);
  assert.deepEqual(fields(created), ["itemName", "process", "drawingNo", "setupNo", "programTimeMin", "pcsPerProgram", "totalCycleSec", "isActive"]);
  assert.ok(created.every((c) => c.from === null && c.to !== null));
  assert.equal(created.find((c) => c.field === "process").to, "VMC");

  const deleted = diffItem(p, {}, names);
  assert.deepEqual(fields(deleted), fields(created));
  assert.ok(deleted.every((c) => c.to === null && c.from !== null));
});

test("a saved document is read through toObject()", () => {
  const doc = (o) => ({ toObject: () => part(o) });
  assert.deepEqual(fields(diffItem(doc(), doc({ drawingNo: "DRG-2" }))), ["drawingNo"]);
  assert.deepEqual(partLabel(doc({ itemName: "Plate", drawingNo: "D", setupNo: "S" })), { itemName: "Plate", drawingNo: "D", setupNo: "S" });
  assert.deepEqual(partLabel(undefined), { itemName: "", drawingNo: "", setupNo: "" });
});

test("SPRING FOR PINS and AFTER POWDER COATING name the cycle time as their forms do", () => {
  const SPRING = "64b0c0ffee0000000000cccc";
  const POWDER = "64b0c0ffee0000000000dddd";
  const procNames = { ...names, [SPRING]: "SPRING FOR PINS", [POWDER]: "AFTER POWDER COATING" };
  const label = (process, pages = {}) =>
    diffItem(part({ process }), part({ process, totalCycleSec: 90 }), procNames, pages).find((c) => c.field === "totalCycleSec").label;
  assert.equal(label(SPRING), "Standard Time per Piece (Sec)");
  assert.equal(label(POWDER), "Standard Inspection Time per Piece (Sec)");
  assert.equal(label(CNC), "Total Cycle Time (sec)");
  assert.equal(label(null), "Total Cycle Time (sec)");
  // The Data Entry Page decides over the name, as on the client.
  assert.equal(label(CNC, { [CNC]: "/hqepl/production/spring-data-entry" }), "Standard Time per Piece (Sec)");
  assert.equal(label(SPRING, { [SPRING]: "/hqepl/production/cnc-data-entry" }), "Total Cycle Time (sec)");
  // A deleted part is named by the process it was in.
  assert.equal(diffItem(part({ process: POWDER }), {}, procNames).find((c) => c.field === "totalCycleSec").label, "Standard Inspection Time per Piece (Sec)");
});

test("BEFORE POWDER COATING names its cycle time Standard Time per Piece — not AFTER POWDER COATING's", () => {
  const BPC = "64b0c0ffee0000000000eeee";
  const procNames = { ...names, [BPC]: "BEFORE POWDER COATING" };
  const label = (pages = {}) =>
    diffItem(part({ process: BPC }), part({ process: BPC, totalCycleSec: 27 }), procNames, pages).find((c) => c.field === "totalCycleSec").label;
  assert.equal(label(), "Standard Time per Piece (Sec)");
  assert.equal(label({ [BPC]: "/hqepl/production/before-powder-coating-data-entry" }), "Standard Time per Piece (Sec)");
});

test("PRINTING names its cycle time Standard Time per Piece, as its sheet does", () => {
  const PRINTING = "64b0c0ffee0000000000ffff";
  const procNames = { ...names, [PRINTING]: "PRINTING" };
  const label = (pages = {}) =>
    diffItem(part({ process: PRINTING }), part({ process: PRINTING, totalCycleSec: 21 }), procNames, pages).find((c) => c.field === "totalCycleSec").label;
  assert.equal(label(), "Standard Time per Piece (Sec)");
  assert.equal(label({ [PRINTING]: "/hqepl/production/printing-data-entry" }), "Standard Time per Piece (Sec)");
});

test("RAW CASTING names its cycle time Standard Inspection Time per Piece, as its sheet does", () => {
  const RAW = "64b0c0ffee0000000000abcd";
  const procNames = { ...names, [RAW]: "RAW CASTING" };
  const label = (pages = {}) =>
    diffItem(part({ process: RAW }), part({ process: RAW, totalCycleSec: 30 }), procNames, pages).find((c) => c.field === "totalCycleSec").label;
  assert.equal(label(), "Standard Inspection Time per Piece (Sec)");
  assert.equal(label({ [RAW]: "/hqepl/production/raw-casting-data-entry" }), "Standard Inspection Time per Piece (Sec)");
  // Linked to another page, the page decides.
  assert.equal(label({ [RAW]: "/hqepl/production/cnc-data-entry" }), "Total Cycle Time (sec)");
});

test("MODULAR FRAME ASSEMBLY names its cycle time Standard Assembly Time per Piece — not MODULAR FRAME DRILLING's", () => {
  const MFA = "64b0c0ffee0000000000abce";
  const procNames = { ...names, [MFA]: "MODULAR FRAME ASSEMBLY" };
  const label = (pages = {}) =>
    diffItem(part({ process: MFA }), part({ process: MFA, totalCycleSec: 80 }), procNames, pages).find((c) => c.field === "totalCycleSec").label;
  assert.equal(label(), "Standard Assembly Time per Piece (Sec)");
  assert.equal(label({ [MFA]: "/hqepl/production/modular-frame-assembly-data-entry" }), "Standard Assembly Time per Piece (Sec)");
  assert.notEqual(label({ [MFA]: "/hqepl/production/modular-frame-drilling-data-entry" }), "Standard Assembly Time per Piece (Sec)");
});
