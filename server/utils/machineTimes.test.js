const test = require("node:test");
const assert = require("node:assert/strict");
const { clockMinutes, intervalOf, overlaps, fmt12, findOverlap } = require("./machineTimes");

test("clockMinutes accepts only HH:mm", () => {
  assert.equal(clockMinutes("00:00"), 0);
  assert.equal(clockMinutes("08:30"), 510);
  assert.equal(clockMinutes("23:59"), 1439);
  for (const bad of ["24:00", "8:30", "08:60", "0830", "", null, undefined, "ab:cd"]) assert.equal(clockMinutes(bad), null, String(bad));
});

test("an entry ends after it starts; a legacy midnight-crossing row is stretched into the next day", () => {
  assert.deepEqual(intervalOf("08:00", "16:00"), { start: 480, end: 960 });
  assert.deepEqual(intervalOf("22:00", "06:00"), { start: 1320, end: 1800 });
  assert.deepEqual(intervalOf("08:00", "08:00"), { start: 480, end: 1920 }, "equal times are a full stretch, never an empty one");
  assert.equal(intervalOf("08:00", ""), null);
});

test("touching intervals do not overlap; crossing ones do", () => {
  const a = intervalOf("08:00", "12:00");
  assert.equal(overlaps(a, intervalOf("12:00", "16:00")), false, "back to back is fine");
  assert.equal(overlaps(a, intervalOf("06:00", "08:00")), false);
  assert.equal(overlaps(a, intervalOf("11:59", "13:00")), true);
  assert.equal(overlaps(a, intervalOf("09:00", "10:00")), true, "fully inside");
  assert.equal(overlaps(a, intervalOf("07:00", "13:00")), true, "swallowing it");
  assert.equal(overlaps(a, intervalOf("08:00", "12:00")), true, "identical");
});

test("fmt12", () => {
  assert.equal(fmt12(0), "12:00 AM");
  assert.equal(fmt12(5), "12:05 AM");
  assert.equal(fmt12(480), "8:00 AM");
  assert.equal(fmt12(720), "12:00 PM");
  assert.equal(fmt12(960), "4:00 PM");
  assert.equal(fmt12(1439), "11:59 PM");
  assert.equal(fmt12(1500), "1:00 AM", "a next-day stretch wraps");
});

test("findOverlap names the entry that is in the way", () => {
  const others = [
    { slot: 1, machineOnTime: "08:00", machineOffTime: "12:00" },
    { slot: 2, machineOnTime: "14:00", machineOffTime: "18:00" },
  ];
  assert.equal(findOverlap("12:00", "14:00", others), null, "fits exactly between them");
  const hit = findOverlap("11:00", "13:00", others);
  assert.equal(hit.slot, 1);
  assert.equal(hit.text, "8:00 AM – 12:00 PM");
  assert.equal(findOverlap("13:00", "15:00", others).slot, 2);
  assert.equal(findOverlap("", "15:00", others), null, "no times, nothing to compare");
  assert.equal(findOverlap("09:00", "10:00", []), null);
  assert.equal(findOverlap("09:00", "10:00", [{ slot: 1, machineOnTime: "", machineOffTime: "" }]), null, "a blank neighbour never blocks");
});

test("a legacy overnight neighbour blocks the late hours", () => {
  const others = [{ slot: 1, machineOnTime: "22:00", machineOffTime: "06:00" }];
  assert.equal(findOverlap("23:00", "23:30", others).slot, 1);
  assert.equal(findOverlap("08:00", "10:00", others), null);
});
