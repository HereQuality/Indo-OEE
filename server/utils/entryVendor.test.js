const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Vendor = require("../models/Vendor");
const { vendorFields } = require("./entryVendor");

const id = () => new mongoose.Types.ObjectId();
const SPRING = id();
const POWDER = id();

// Vendor.findById(...).select(...).lean() over a fixed list.
const withVendors = (list, fn) => async () => {
  const real = Vendor.findById;
  Vendor.findById = (vid) => ({ select: () => ({ lean: async () => list.find((v) => String(v._id) === String(vid)) || null }) });
  try {
    await fn();
  } finally {
    Vendor.findById = real;
  }
};

const acme = { _id: id(), name: "Acme", isActive: true, processes: [POWDER] };
const old = { _id: id(), name: "Old Co", isActive: false, processes: [POWDER] };

test("no vendor in the request leaves the entry's vendor alone", withVendors([acme], async () => {
  assert.deepEqual(await vendorFields({}, null, POWDER), { set: {}, unset: {} });
}));

test("a blank vendor clears it", withVendors([acme], async () => {
  assert.deepEqual(await vendorFields({ vendor: "" }, null, POWDER), { set: {}, unset: { vendor: "", vendorName: "" } });
  assert.deepEqual(await vendorFields({ vendor: null }, null, POWDER), { set: {}, unset: { vendor: "", vendorName: "" } });
}));

test("a vendor ticked for the entry's process is saved with its name", withVendors([acme], async () => {
  const { set } = await vendorFields({ vendor: String(acme._id) }, null, POWDER);
  assert.equal(String(set.vendor), String(acme._id));
  assert.equal(set.vendorName, "Acme");
}));

test("a vendor not ticked for this process is refused — the process is looked up only then", withVendors([acme], async () => {
  let asked = 0;
  await assert.rejects(
    vendorFields({ vendor: String(acme._id) }, null, async () => {
      asked += 1;
      return SPRING;
    }),
    (e) => e.status === 400 && /isn't used in this process/.test(e.message),
  );
  assert.equal(asked, 1);
  await vendorFields({ vendor: "" }, null, async () => {
    asked += 1;
  });
  assert.equal(asked, 1, "a blank vendor never needs the process");
}));

test("an inactive or unknown vendor is refused", withVendors([acme, old], async () => {
  await assert.rejects(vendorFields({ vendor: String(old._id) }, null, POWDER), /inactive/);
  await assert.rejects(vendorFields({ vendor: String(id()) }, null, POWDER), /not found/);
  await assert.rejects(vendorFields({ vendor: "nope" }, null, POWDER), /not found/);
}));

test("an entry keeping the vendor it already had stays editable after the vendor is deactivated or unticked", withVendors([old], async () => {
  const existing = { vendor: old._id, vendorName: "Old Co" };
  const { set } = await vendorFields({ vendor: String(old._id) }, existing, SPRING);
  assert.equal(set.vendorName, "Old Co");
}));
