import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { STOPPAGE_FIELDS, displayDay, fmtNum, fmtPct, rowCalc } from "../../utils/productionSheet";

/**
 * components/Production/ProductionEntriesTable.jsx
 * ────────────────────────────────────────────────
 * Every field of every saved entry, in the sheet's own order and under its
 * own name — nothing abbreviated away.
 *
 * That is far more than fits on a screen, so the wide groups (Ideal Quantity,
 * Operator Shift, the ten Downtime columns, and the Results/OEE block) each
 * collapse behind a chevron; collapsed, a group shows one summary column
 * instead. This is display only — collapsing never changes what is stored,
 * and the same `rowCalc`/`dayCalc` formulas the form uses fill every
 * calculated cell, so the table can't disagree with the form.
 *
 * Colour is kept to a minimum: every group header is the same neutral grey,
 * and the only tint on a body cell marks it as calculated rather than typed
 * — nothing is colour-coded by group or column. Rows of the same date share
 * a faint shade, which flips as the date changes, so a many-row day still
 * reads as one block without needing its own colour.
 *
 * With several entries per day the repeated cells are merged rather than
 * restated: one Date cell spans that date's rows, one Machine cell spans that
 * machine's entries within the date, and the day-level OEE/Unreported figures
 * span the same block — so a machine's three shifts read as one day's work
 * instead of three rows repeating the same percentages.
 */

const thBase =
  "sticky px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700";
const td = "px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700";

// Date and Machine stay put while the other thirty-odd columns scroll past.
// The last frozen column carries the shadow that marks the freeze line.
const FROZEN = {
  date: "sticky left-0 w-[104px] min-w-[104px]",
  machine: "sticky left-[104px] w-[96px] min-w-[96px] shadow-[4px_0_10px_rgba(0,0,0,0.06)]",
};

// One neutral colour for every group header — no per-section hues.
//
// It must stay fully opaque: the headers are sticky and the Date/Machine
// columns are frozen, so a translucent background would let the columns
// scrolling underneath show straight through the cell.
const HEAD_BG = "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200";

// Body cell tints, by what the cell is rather than where it sits. Both
// calculated tones share one shade — the point is just "not typed in",
// not which formula produced it. Machine is frozen (needs its own opaque
// background so scrolling columns can't show through underneath it);
// Operator isn't frozen, so it just takes the row's own tint plus weight.
const TONE = {
  calc: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium",
  day: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium",
  machine: "bg-slate-50 dark:bg-slate-900 font-semibold",
  operator: "font-medium",
};

// Rows of one date share a faint shade; it flips as the date changes.
const DAY_TINT = ["bg-white dark:bg-slate-900", "bg-slate-50 dark:bg-slate-900/60"];

const dash = (v) => (v === "" || v === null || v === undefined ? "—" : v);
const n = (v) => dash(fmtNum(v));
const pct = (v) => dash(fmtPct(v));
// A stoppage cell reads better blank than as a 0 nobody typed.
const min = (v) => (v === null || v === undefined || v === "" ? "—" : fmtNum(Number(v)));

// The downtime columns are headed with the same wording as the form, rather
// than the longer labels the old Excel grid used.
const DOWNTIME_LABEL = {
  plannedDownMin: "Downtime",
  setupMin: "Setup Time",
  noManPowerMin: "No Man Power",
  materialShiftingMin: "Material Shifting",
  noMaterialMin: "No Material",
  bdMechMin: "Breakdown Mechanical",
  bdEleMin: "BD Electricity",
  noPowerMin: "No Power",
  lunchMin: "Lunch / Rest",
  otherMin: "Other",
};

// ── Column groups, in sheet order ────────────────────────────────────────
// `get(row, calc, day)` renders one cell. `collapsible` groups fold down to
// their `summary` column.
const GROUPS = [
  {
    key: "entry",
    label: "Entry",
    head: HEAD_BG,
    columns: [
      { key: "date", label: "Date", get: (r) => displayDay(r.date), merge: "date", frozen: "date" },
      { key: "machine", label: "Machine No.", get: (r, c, d, ctx) => ctx.machineName[r.machine] || "—", merge: "machineDay", tone: "machine", frozen: "machine" },
      { key: "slot", label: "Entry No.", get: (r) => r.slot, align: "text-center" },
      { key: "operator", label: "Operator", get: (r) => dash(r.operator), tone: "operator" },
    ],
  },
  {
    key: "part",
    label: "Part Details",
    head: HEAD_BG,
    columns: [
      { key: "itemName", label: "Part Name", get: (r) => dash(r.itemName) },
      { key: "drawingNo", label: "Drawing No.", get: (r) => dash(r.drawingNo) },
      { key: "cycle", label: "Total Cycle Time (sec)", get: (r, c) => n(c.totalCycleSec), align: "text-end", tone: "calc" },
    ],
  },
  {
    key: "machineTime",
    label: "Machine Timing",
    head: HEAD_BG,
    columns: [
      { key: "on", label: "Machine ON Time", get: (r) => dash(r.machineOnTime) },
      { key: "off", label: "Machine OFF Time", get: (r) => dash(r.machineOffTime) },
      { key: "shift", label: "Machine Shift (hr)", get: (r, c) => n(c.shiftHours), align: "text-end", tone: "calc" },
    ],
  },
  {
    key: "ideal",
    label: "Ideal Quantity",
    head: HEAD_BG,
    collapsible: true,
    summary: { key: "idealQty", label: "Ideal Quantity", get: (r, c) => n(c.idealQty), align: "text-end", tone: "calc" },
    columns: [
      { key: "idealQty", label: "Ideal Quantity", get: (r, c) => n(c.idealQty), align: "text-end", tone: "calc" },
      { key: "idealPerHour", label: "Ideal Quantity per Hour", get: (r, c) => n(c.idealQtyPerHour), align: "text-end", tone: "calc" },
    ],
  },
  {
    key: "quantity",
    label: "Quantity",
    head: HEAD_BG,
    columns: [
      { key: "actualQty", label: "Ideal Quantity", get: (r, c) => n(c.actualQty), align: "text-end" },
      { key: "okQty", label: "OK Quantity", get: (r) => min(r.okQty), align: "text-end" },
      { key: "rejectedQty", label: "Rejected", get: (r, c) => n(c.rejectedQty), align: "text-end", tone: "calc" },
      { key: "pctOk", label: "% OK Quantity", get: (r, c) => pct(c.pctOk), align: "text-end", tone: "calc" },
      { key: "rejectReason", label: "Reject Master", get: (r) => dash(r.rejectReason) },
    ],
  },
  {
    key: "operatorShift",
    label: "Operator Shift",
    head: HEAD_BG,
    collapsible: true,
    summary: {
      key: "plannedShift",
      label: "Planned Operator Shift Time (hr)",
      get: (r) => min(r.plannedOperatorShiftHours),
      align: "text-end",
    },
    columns: [
      {
        key: "plannedShift",
        label: "Planned Operator Shift Time (hr)",
        get: (r) => min(r.plannedOperatorShiftHours),
        align: "text-end",
      },
      {
        key: "unutilized",
        label: "Unutilized Machine Time",
        get: (r, c, d) => n(d.unutilized),
        align: "text-end",
        tone: "day",
      },
    ],
  },
  {
    key: "downtime",
    label: "Downtime (minutes)",
    head: HEAD_BG,
    collapsible: true,
    summary: {
      key: "totalStoppage",
      label: "Total Downtime (min)",
      get: (r, c) => n(c.totalStoppageMin),
      align: "text-end",
      tone: "calc",
    },
    columns: STOPPAGE_FIELDS.map((f) => ({
      key: f.key,
      // "Planned Down Time (min)" -> "Downtime", matching the form's wording.
      label: DOWNTIME_LABEL[f.key] || f.label,
      get: (r) => min(r[f.key]),
      align: "text-end",
    })),
  },
  {
    key: "results",
    label: "Results",
    head: HEAD_BG,
    collapsible: true,
    summary: {
      key: "oeeLosses",
      label: "OEE considering losses (%)",
      get: (r, c, d) => pct(d.oeeLosses),
      align: "text-end",
      tone: "day",
    },
    columns: [
      {
        key: "effective",
        label: "Effective Machine Runtime (hr)",
        get: (r, c) => n(c.effectiveHours),
        align: "text-end",
        tone: "calc",
      },
      { key: "unreported", label: "Unreported Time (min)", get: (r, c, d) => n(d.unreportedMin), align: "text-end", tone: "day" },
      {
        key: "gap",
        label: "Gap to Next Entry (min)",
        // Just the clock gap to the next entry on this machine — never a
        // stoppage reason, never folded into Total Stoppage or Unreported.
        // Blank for the day's last entry (nothing after it yet to compare).
        get: (r, c, d) => n(d.gapMin),
        align: "text-end",
        tone: "day",
      },
      { key: "setupEff", label: "Setup Efficiency (%)", get: (r, c) => pct(c.setupEfficiency), align: "text-end", tone: "calc" },
      { key: "oeeLosses", label: "OEE considering losses (%)", get: (r, c, d) => pct(d.oeeLosses), align: "text-end", tone: "day" },
      {
        key: "oeeLunch",
        label: "OEE not considering losses but lunch (%)",
        get: (r, c, d) => pct(d.oeeLunch),
        align: "text-end",
        tone: "day",
      },
      {
        key: "oeeLunchCot",
        label: "OEE not considering losses but lunch and COT (%)",
        get: (r, c, d) => pct(d.oeeLunchCot),
        align: "text-end",
        tone: "day",
      },
    ],
  },
  {
    key: "remarks",
    label: "",
    head: HEAD_BG,
    columns: [{ key: "remarks", label: "Remarks", get: (r) => dash(r.remarks), wrap: true }],
  },
];

const ProductionEntriesTable = ({
  rows = [],
  machineName = {},
  dayResultByKey = {},
  loading = false,
  emptyText = "No entries.",
  canEdit = true,
  canDelete = true,
  onEdit,
  onDelete,
}) => {
  // Wide groups start collapsed — the sheet is readable on open, and any group
  // can be expanded on demand.
  const [open, setOpen] = useState({ ideal: false, operatorShift: false, downtime: false, results: false });
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  const ctx = useMemo(() => ({ machineName }), [machineName]);

  // Rows arrive sorted by date, then machine, then entry no., so a repeated
  // Date or Machine is always a run of adjacent rows. Each run's first row
  // carries the rowSpan and the rest skip that cell.
  const layout = useMemo(() => {
    const spans = rows.map(() => ({ dateStart: false, machineStart: false, dateSpan: 0, machineSpan: 0, dayIndex: 0 }));

    // Each run's first row carries the rowSpan; the rest render nothing for
    // that cell. Runs are found by scanning forward, so a run of three rows
    // gets a span of three rather than of one.
    let dayIndex = -1;
    for (let i = 0; i < rows.length; ) {
      let j = i;
      while (j < rows.length && rows[j].date === rows[i].date) j += 1;
      dayIndex += 1;
      spans[i].dateStart = true;
      spans[i].dateSpan = j - i;
      for (let k = i; k < j; k += 1) spans[k].dayIndex = dayIndex;

      // Within the date, the same machine's entries are adjacent too.
      for (let m = i; m < j; ) {
        let q = m;
        while (q < j && rows[q].machine === rows[m].machine) q += 1;
        spans[m].machineStart = true;
        spans[m].machineSpan = q - m;
        m = q;
      }
      i = j;
    }
    return spans;
  }, [rows]);

  // What each group actually renders right now.
  const visible = GROUPS.map((g) => ({
    ...g,
    shown: g.collapsible && !open[g.key] ? [g.summary] : g.columns,
    isCollapsed: g.collapsible && !open[g.key],
  }));
  const totalCols = visible.reduce((sum, g) => sum + g.shown.length, 0) + 1; // + Actions

  const Chevron = ({ group, className = "" }) => (
    <button
      type="button"
      onClick={() => toggle(group.key)}
      title={group.isCollapsed ? `Expand ${group.label}` : `Collapse ${group.label}`}
      aria-label={group.isCollapsed ? `Expand ${group.label}` : `Collapse ${group.label}`}
      className={`inline-flex items-center justify-center rounded bg-white/80 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 hover:bg-white dark:hover:bg-slate-900 transition-colors ${className}`}
      style={{ width: 20, height: 20 }}
    >
      {group.isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
    </button>
  );

  return (
    <>
      <div
        className="border border-slate-300 dark:border-slate-700 rounded-lg overflow-auto"
        style={{ maxHeight: "calc(100vh - 300px)" }}
      >
        <table className="w-full text-xs sm:text-sm border-separate border-spacing-0">
          <thead>
            {/* Group row — the chevrons live here. */}
            <tr>
              {visible.map((g) => {
                const firstFrozen = g.shown[0]?.frozen;
                return (
                  <th
                    key={g.key}
                    colSpan={g.shown.length}
                    className={`${thBase} top-0 ${firstFrozen ? `${FROZEN[firstFrozen]} z-30` : "z-20"} ${g.head} text-center`}
                  >
                    <div className="relative flex items-center justify-center min-h-[20px]">
                      {g.label && <span>{g.label}</span>}
                      {g.collapsible &&
                        (g.isCollapsed ? (
                          // One column wide — the chevron rides beside the label.
                          <Chevron group={g} className="ml-1.5" />
                        ) : (
                          // Open, the group spans many columns: park the close
                          // control against its right edge, over the section's
                          // last column, so it reads as "close this section"
                          // rather than floating in the middle of the heading.
                          <Chevron group={g} className="absolute right-0 top-1/2 -translate-y-1/2" />
                        ))}
                    </div>
                  </th>
                );
              })}
              <th className={`${thBase} top-0 z-20 ${HEAD_BG} text-center`}>Action</th>
            </tr>
            {/* Column row */}
            <tr>
              {visible.flatMap((g) =>
                g.shown.map((c) => (
                  <th
                    key={`${g.key}-${c.key}`}
                    className={`${thBase} top-[37px] ${c.frozen ? `${FROZEN[c.frozen]} z-30` : "z-20"} ${g.head} ${c.align || ""}`}
                  >
                    {c.label}
                  </th>
                )),
              )}
              <th className={`${thBase} top-[37px] z-20 ${HEAD_BG}`} />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={totalCols} className="px-4 py-8 text-center text-slate-500 font-medium">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && !rows.length && (
              <tr>
                <td colSpan={totalCols} className="px-4 py-8 text-center text-slate-500 font-medium">
                  {emptyText}
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r, i) => {
                const calc = rowCalc(r);
                const day = dayResultByKey[r._id] || {};
                const span = layout[i];
                const dayBg = DAY_TINT[span.dayIndex % 2];

                return (
                  <tr key={r._id} className="group">
                    {visible.flatMap((g) =>
                      g.shown.map((c) => {
                        // Merged cells are drawn once, on the run's first row.
                        if (c.merge === "date" && !span.dateStart) return null;
                        if (c.merge === "machineDay" && !span.machineStart) return null;
                        const rowSpan =
                          c.merge === "date" ? span.dateSpan : c.merge === "machineDay" ? span.machineSpan : undefined;
                        // Every cell paints its own background: a frozen column
                        // would otherwise be see-through as the rest scrolls
                        // underneath it.
                        // Operator isn't frozen and has no bg of its own, so it
                        // still takes the row's alternating date tint; every
                        // other tone (or none) carries its own opaque bg.
                        const bg =
                          c.tone === "operator"
                            ? `${dayBg} ${TONE.operator}`
                            : c.tone
                              ? TONE[c.tone]
                              : `${dayBg} text-slate-700 dark:text-slate-200`;
                        return (
                          <td
                            key={`${g.key}-${c.key}`}
                            rowSpan={rowSpan > 1 ? rowSpan : undefined}
                            className={`${td} ${bg} ${c.align || ""} ${c.frozen ? `${FROZEN[c.frozen]} z-10` : ""} ${
                              c.merge ? "align-middle" : ""
                            }`}
                            style={c.wrap ? { whiteSpace: "normal", minWidth: 220 } : undefined}
                          >
                            {c.get(r, calc, day, ctx)}
                          </td>
                        );
                      }),
                    )}
                    <td className={`${td} ${dayBg}`}>
                      <div className="flex gap-1.5">
                        {canEdit && (
                          <button
                            type="button"
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors"
                            title="Edit"
                            onClick={() => onEdit(r)}
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition-colors"
                            title="Remove"
                            onClick={() => onDelete(r)}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default ProductionEntriesTable;
