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
 * Colour carries meaning, the way it does on the Jajoo sheet:
 *   • group headers use the Indo Excel sheet's own section colours
 *   • violet cells are calculated from that row
 *   • blue cells are calculated per machine per day
 *   • teal is the machine, fuchsia the operator
 *   • rows of the same date share a tint, which flips as the date changes
 * Everything else is typed in.
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

// Section colours lifted from the Indo "Section Wise Eff. (CNC)" Excel sheet,
// so the headings read the way the printed sheet does.
//
// Every colour here is fully opaque, and must stay that way: the headers are
// sticky and the Date/Machine columns are frozen, so a translucent background
// lets the columns scrolling underneath show straight through the cell.
const HEAD = {
  details: "bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200",
  cycle: "bg-emerald-100 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-200",
  time: "bg-sky-200 dark:bg-sky-950 text-sky-900 dark:text-sky-200",
  calc: "bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-200",
  qty: "bg-orange-100 dark:bg-orange-950 text-orange-900 dark:text-orange-200",
  operatorShift: "bg-pink-100 dark:bg-pink-950 text-pink-900 dark:text-pink-200",
  stoppage: "bg-yellow-200 dark:bg-yellow-950 text-yellow-900 dark:text-yellow-200",
  effective: "bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-100",
  remarks: "bg-rose-100 dark:bg-rose-950 text-rose-900 dark:text-rose-200",
};

// Body cell tints, by what the cell is rather than where it sits.
const TONE = {
  calc: "bg-violet-50 dark:bg-violet-950 text-violet-800 dark:text-violet-300 font-medium",
  day: "bg-blue-50 dark:bg-blue-950 text-blue-800 dark:text-blue-300 font-medium",
  machine: "bg-teal-50 dark:bg-teal-950 text-teal-800 dark:text-teal-300 font-semibold",
  operator: "bg-fuchsia-50 dark:bg-fuchsia-950 text-fuchsia-800 dark:text-fuchsia-300 font-medium",
};

// Rows of one date share a tint; it flips as the date changes.
const DAY_TINT = ["bg-white dark:bg-slate-900", "bg-indigo-50 dark:bg-indigo-950"];

// Legend-only swatches: the body tints are too pale to read at 11px.
const SWATCH = {
  calc: "bg-violet-200 dark:bg-violet-800",
  day: "bg-blue-200 dark:bg-blue-800",
  machine: "bg-teal-200 dark:bg-teal-800",
  operator: "bg-fuchsia-200 dark:bg-fuchsia-800",
};

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
    head: HEAD.details,
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
    head: HEAD.cycle,
    columns: [
      { key: "itemName", label: "Part Name", get: (r) => dash(r.itemName) },
      { key: "drawingNo", label: "Drawing No.", get: (r) => dash(r.drawingNo) },
      { key: "cycle", label: "Cycle Time (sec)", get: (r, c) => n(c.totalCycleSec), align: "text-end", tone: "calc" },
    ],
  },
  {
    key: "machineTime",
    label: "Machine Timing",
    head: HEAD.time,
    columns: [
      { key: "on", label: "Machine ON Time", get: (r) => dash(r.machineOnTime) },
      { key: "off", label: "Machine OFF Time", get: (r) => dash(r.machineOffTime) },
      { key: "shift", label: "Machine Shift (hr)", get: (r, c) => n(c.shiftHours), align: "text-end", tone: "calc" },
    ],
  },
  {
    key: "ideal",
    label: "Ideal Quantity",
    head: HEAD.calc,
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
    head: HEAD.qty,
    columns: [
      { key: "actualQty", label: "Actual Quantity", get: (r, c) => n(c.actualQty), align: "text-end" },
      { key: "okQty", label: "OK Quantity", get: (r) => min(r.okQty), align: "text-end" },
      { key: "rejectedQty", label: "Rejected", get: (r, c) => n(c.rejectedQty), align: "text-end", tone: "calc" },
      { key: "pctOk", label: "% OK Quantity", get: (r, c) => pct(c.pctOk), align: "text-end", tone: "calc" },
      { key: "rejectReason", label: "Reject Master", get: (r) => dash(r.rejectReason) },
    ],
  },
  {
    key: "operatorShift",
    label: "Operator Shift",
    head: HEAD.operatorShift,
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
      // Blank until Indo confirms the formula — see the same note on the form.
      { key: "utilized", label: "Utilized Machine Time (hr)", get: () => "—", align: "text-end", tone: "calc" },
    ],
  },
  {
    key: "downtime",
    label: "Downtime (minutes)",
    head: HEAD.stoppage,
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
    head: HEAD.effective,
    collapsible: true,
    summary: {
      key: "oeeLosses",
      label: "OEE considering losses (%)",
      get: (r, c, d) => pct(d.oeeLosses),
      align: "text-end",
      tone: "day",
      merge: "machineDay",
    },
    columns: [
      {
        key: "effective",
        label: "Effective Machine Runtime (hr)",
        get: (r, c) => n(c.effectiveHours),
        align: "text-end",
        tone: "calc",
      },
      { key: "unreported", label: "Unreported Time (min)", get: (r, c, d) => n(d.unreportedMin), align: "text-end", tone: "day", merge: "machineDay" },
      { key: "setupEff", label: "Setup Efficiency (%)", get: (r, c) => pct(c.setupEfficiency), align: "text-end", tone: "calc" },
      { key: "oeeLosses", label: "OEE considering losses (%)", get: (r, c, d) => pct(d.oeeLosses), align: "text-end", tone: "day", merge: "machineDay" },
      {
        key: "oeeLunch",
        label: "OEE not considering losses but lunch (%)",
        get: (r, c, d) => pct(d.oeeLunch),
        align: "text-end",
        tone: "day",
        merge: "machineDay",
      },
      {
        key: "oeeLunchCot",
        label: "OEE not considering losses but lunch and COT (%)",
        get: (r, c, d) => pct(d.oeeLunchCot),
        align: "text-end",
        tone: "day",
        merge: "machineDay",
      },
    ],
  },
  {
    key: "remarks",
    label: "",
    head: HEAD.remarks,
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

  const Swatch = ({ className, children }) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block rounded-sm border border-slate-300 dark:border-slate-600 ${className}`} style={{ width: 11, height: 11 }} />
      {children}
    </span>
  );

  return (
    <>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-[11px] text-slate-500 dark:text-slate-400">
        <Swatch className={SWATCH.calc}>Calculated from the row</Swatch>
        <Swatch className={SWATCH.day}>Calculated per machine per day</Swatch>
        <Swatch className={SWATCH.machine}>Machine</Swatch>
        <Swatch className={SWATCH.operator}>Operator</Swatch>
        <span>Everything else is typed in.</span>
      </div>

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
              <th className={`${thBase} top-0 z-20 ${HEAD.details} text-center`}>Action</th>
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
              <th className={`${thBase} top-[37px] z-20 ${HEAD.details}`} />
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
                const day = dayResultByKey[`${r.machine}|${r.date}`] || {};
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
                        const bg = c.tone ? TONE[c.tone] : `${dayBg} text-slate-700 dark:text-slate-200`;
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
