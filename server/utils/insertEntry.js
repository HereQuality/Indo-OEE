"use strict";
/**
 * utils/insertEntry.js — insert a NEW sheet entry without ever losing one.
 *
 * Two people saving a new entry for the same machine/operator and date at the
 * same moment both read "slot 1 is free". An upsert on (date, key, slot) then
 * merged the second save into the first and both answered 200 with one row
 * left. A plain insert hits the unique (date, key, slot) index instead; the
 * loser gets E11000, and here it takes the next free slot and tries again.
 *
 * `filter` is the (date, machine|worker) part of the key; `slots` the slot
 * numbers a sheet has. `recheck` (optional) runs before each retry and returns a
 * message when the entry now overlaps the one that won the race (the sheets'
 * no-overlap rule was checked before it existed — a double-clicked Save must not
 * leave two identical rows). Resolves to { doc } (a plain object), { full: true }
 * when every slot is taken, or { clash } with that message.
 */
const isDuplicateKey = (err) => Boolean(err) && (err.code === 11000 || err.code === 11001);

const insertNewEntry = async (Model, { filter, slots, slotNo, payload, recheck }) => {
  let slot = slotNo;
  for (let attempt = 0; attempt <= slots.length; attempt += 1) {
    try {
      const created = await Model.create({ ...payload, slot });
      return { doc: typeof created.toObject === "function" ? created.toObject() : created };
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const used = new Set((await Model.find(filter).select("slot").lean()).map((e) => e.slot));
      const free = slots.find((n) => !used.has(n));
      if (!free) return { full: true };
      slot = free;
      const clash = recheck ? await recheck() : null;
      if (clash) return { clash };
    }
  }
  return { full: true };
};

module.exports = { insertNewEntry, isDuplicateKey };
