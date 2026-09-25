/**
 * utils/machineOrder.js
 * ───────────────────────
 * The one definition of "sheet order" for machines: by `sequence`, then by
 * Machine No. with numbers compared as numbers ("7A" < "7B" < "10A").
 *
 * A machine whose sequence is 0 / missing has never been positioned (older
 * records, or one added before sequences were assigned automatically), so it
 * ranks AFTER every numbered machine instead of jumping to the top — which is
 * what a plain `{ sequence: 1 }` sort does with a 0.
 *
 * Machines number in the tens, so ordering happens in memory rather than in
 * MongoDB; that is what lets the "unsequenced last" rule live in one place.
 */
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const seqRank = (m) => (Number(m?.sequence) > 0 ? Number(m.sequence) : Infinity);

const compareBySequence = (a, b) => {
  const ra = seqRank(a);
  const rb = seqRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  return collator.compare(String(a?.machineName || ""), String(b?.machineName || ""));
};

// Any other column, for the Machine Master's sortable headers. Falls back to
// sheet order so equal values still come out in a stable, sensible order.
const compareByField = (field, dir) => (a, b) => {
  const av = a?.[field];
  const bv = b?.[field];
  let d;
  if (typeof av === "string" || typeof bv === "string") d = collator.compare(String(av ?? ""), String(bv ?? ""));
  else d = (Number(av) || 0) - (Number(bv) || 0);
  return d ? (dir === "desc" ? -d : d) : compareBySequence(a, b);
};

const sortMachines = (list, sorton, sortdir) => {
  const dir = sortdir === "desc" ? "desc" : "asc";
  if (!sorton || sorton === "sequence") {
    const sorted = [...list].sort(compareBySequence);
    return sorton === "sequence" && dir === "desc" ? sorted.reverse() : sorted;
  }
  return [...list].sort(compareByField(sorton, dir));
};

module.exports = { compareBySequence, sortMachines };
