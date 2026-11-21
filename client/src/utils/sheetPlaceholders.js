/**
 * utils/sheetPlaceholders.js
 * ───────────────────────────
 * The "Not filled yet" rows of a data entry sheet. The server pages every
 * working day up to today (server utils/sheetDates.js, `meta.dates`), and
 * for each of those days every machine of the page's process gets one
 * placeholder row until an entry is saved for it — so at midnight the new
 * day appears on every sheet with all its machines, and each machine's row
 * turns into its entries as they're entered. A sheet keyed by worker (no
 * machines) gets one placeholder per empty day instead.
 *
 * A placeholder is `{ _id: "ph|date|machine", _placeholder: true, date, machine, slot: 0 }`;
 * ProductionEntriesTable draws it as one muted row with an "Add entry" button.
 * Nothing is saved — they live only in the browser.
 */
export const isPlaceholder = (row) => !!row?._placeholder;

const placeholder = (date, machine = "") => ({ _id: `ph|${date}|${machine}`, _placeholder: true, date, machine, slot: 0 });

/**
 * @param {object[]} sortedRows  the page's rows, newest date first, then machine order
 * @param {object} o
 * @param {string[]} o.dates      the page's dates from the server ("YYYY-MM-DD")
 * @param {object[]} o.machines   the machines to expect a row from ({ _id, machineName }); [] on a worker sheet
 * @param {(id: string) => number} o.rankOf  a machine's place in the sheet order
 * @param {boolean} o.enabled     false (a search or an Operator / Part filter is on) returns the rows as they are
 */
export const withPlaceholders = (sortedRows, { dates = [], machines = [], rankOf = () => 0, enabled = true } = {}) => {
  if (!enabled || !dates.length) return sortedRows;
  const byDate = new Map();
  for (const r of sortedRows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  const allDates = [...new Set([...dates, ...byDate.keys()])].sort().reverse();
  const out = [];
  for (const date of allDates) {
    const rows = byDate.get(date) || [];
    if (!machines.length) {
      out.push(...(rows.length ? rows : [placeholder(date)]));
      continue;
    }
    const have = new Set(rows.map((r) => String(r.machine)));
    const missing = machines.filter((m) => !have.has(String(m._id))).map((m) => placeholder(date, m._id));
    // Rows already sit in machine order (then entry order); the sort is stable,
    // so a machine's entries keep their order and placeholders slot in by rank.
    out.push(...[...rows, ...missing].sort((a, b) => rankOf(a.machine) - rankOf(b.machine)));
  }
  return out;
};
