// Machine ON/OFF times of production entries: parsing, and the rule that two
// entries of the same machine on the same date must not overlap.
//
// Keep in step with the entry form's own check (client/src/utils/entryValidation.js
// and mobile/lib/features/production/shared/production_entry_validation.dart).

// "HH:mm" -> minutes past midnight, or null.
const clockMinutes = (t) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// The stretch of the day an entry occupies, in minutes: { start, end }, or null
// when either time is missing / not HH:mm. A new entry always ends after it
// starts, but rows saved before that rule may have run through midnight
// (OFF <= ON); those are stretched into the next day so they keep blocking
// the late hours they really covered.
const intervalOf = (on, off) => {
  const start = clockMinutes(on);
  const end = clockMinutes(off);
  if (start === null || end === null) return null;
  return { start, end: end > start ? end : end + 1440 };
};

// Touching is fine (one ends at 16:00, the next starts at 16:00).
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

// 0..1439 (or a next-day stretch beyond it) -> "8:05 AM".
const fmt12 = (minutes) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

// The first of `others` ({ slot, machineOnTime, machineOffTime }) that the
// interval [on, off) runs into, as { slot, start, end, text } — or null.
// `text` reads "8:00 AM – 4:00 PM".
const findOverlap = (on, off, others) => {
  const mine = intervalOf(on, off);
  if (!mine) return null;
  for (const o of others || []) {
    const theirs = intervalOf(o.machineOnTime, o.machineOffTime);
    if (theirs && overlaps(mine, theirs)) {
      return { slot: o.slot, ...theirs, text: `${fmt12(theirs.start)} – ${fmt12(theirs.end)}` };
    }
  }
  return null;
};

module.exports = { clockMinutes, intervalOf, overlaps, fmt12, findOverlap };
