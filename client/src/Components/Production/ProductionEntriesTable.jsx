import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Pencil, Trash2, X } from "lucide-react";
import { CYCLE_OP_FIELDS, STOPPAGE_FIELDS, displayDay, fmtNum, fmtPct, rowCalc } from "../../utils/productionSheet";

// The plain-English formula behind every calculated column — shown in a
// popover from the eye icon next to its header, so nobody has to remember or
// ask what a grey box actually computed.
const FORMULAS = {
  cycle: "The Part's own Total Cycle Time, minus any operation unticked for this entry.",
  shift: "Machine Shift Time = MOD(Machine OFF Time − Machine ON Time, 1) × 24",
  idealQty:
    "Ideal Quantity = FLOOR(Machine Shift Time × 3600 ÷ Total Cycle Time). There's no typed Actual Quantity — this stands in for it.",
  rejectedQty: "Rejected Quantity = Ideal Quantity − OK Quantity",
  pctOk: "% OK Quantity = OK Quantity ÷ (OK Quantity + Rejected Quantity)",
  unutilized:
    "Unutilized Machine Time = (12 − (Shift Hours − Lunch ÷ 60)) ÷ 11, over this entry + the next 2 entries of the same machine and date.",
  totalStoppage: "Total Stoppage = sum of the ten downtime columns.",
  effective: "Effective Machine Run Time = OK Quantity × Total Cycle Time ÷ 3600",
  unreported:
    "Unreported Time = (Shift Hours × 60) − (Effective Runtime × 60) − Total Downtime, over this entry + the next 2 entries.",
  setupEff: "Setup Efficiency = Effective Machine Run Time ÷ Machine Shift Time",
  oeeLosses:
    "OEE considering losses = Effective Run Time ÷ (Shift Hours − Total Downtime ÷ 60), over this entry + the next 2 entries.",
  oeeLunch:
    "OEE not considering losses but lunch = Effective Run Time ÷ (Shift Hours − Lunch ÷ 60), over this entry + the next 2 entries.",
  oeeLunchCot:
    "OEE not considering losses but lunch and COT = Effective Run Time ÷ (Shift Hours − Lunch ÷ 60 − Setup Time ÷ 60), over this entry + the next 2 entries.",
};

/**
 * components/Production/ProductionEntriesTable.jsx
 * ────────────────────────────────────────────────
 * One flat, locked header row — Date … Remarks … Actions, left to right, in
 * the sheet's own order. No section banner above it any more: every column
 * stands on its own name.
 *
 * Only two columns fold: Total Cycle Time (sec) and Total Stoppage (min).
 * Their total is always shown; the chevron beside it opens its breakdown —
 * Drilling…Clamp/Declamp for cycle time, the ten downtime reasons for
 * stoppage — right after it, without hiding the total or disturbing any
 * other column. Collapsing is display only: the same `rowCalc`/`dayCalc`
 * formulas the entry form uses fill every calculated cell, so the table
 * can't disagree with the form.
 *
 * A calculated cell carries a neutral grey tint (typed cells stay plain);
 * the three OEE percentage columns get their own indigo tint so the sheet's
 * headline numbers stand out from the rest. Every calculated header gets an
 * eye-icon button showing the formula behind it, and most headers wrap onto
 * a couple of lines rather than stretching their column wide. Rows of the
 * same date share a faint shade that flips as the date changes, and Date/
 * Machine are frozen at the left while the rest of the sheet scrolls under
 * them — with several entries per day, one Date cell spans that date's rows
 * and one Machine cell spans that machine's entries within it, so a
 * machine's shifts read as one day's work instead of repeating cells.
 */

// Headers wrap onto 2–3 lines instead of forcing their column wide — a
// column's width is set by `headW` below (auto/unconstrained where a value
// genuinely needs the room, e.g. Part Name or Remarks).
const thBase =
  "sticky top-0 z-20 align-bottom px-2 py-1.5 font-semibold whitespace-normal leading-tight border-r border-b border-slate-300 dark:border-slate-700";
const td = "px-2 py-1.5 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700";

// Date and Machine stay put while the rest of the columns scroll past. The
// last frozen column carries the shadow that marks the freeze line.
const FROZEN = {
  date: "sticky left-0 w-[104px] min-w-[104px]",
  machine: "sticky left-[104px] w-[96px] min-w-[96px] shadow-[4px_0_10px_rgba(0,0,0,0.06)]",
};

// One neutral colour for the header row — no per-section hues.
const HEAD_BG = "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200";

// Body cell tints, by what the cell is rather than where it sits. Both
// calculated tones share one shade — the point is just "not typed in", not
// which formula produced it. Machine is frozen (needs its own opaque
// background so scrolling columns can't show through underneath it);
// Operator isn't frozen, so it just takes the row's own tint plus weight.
const TONE = {
  calc: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium",
  day: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium",
  // The three OEE percentage columns get their own colour so they stand out
  // from the rest of the calculated (grey) cells as the sheet's headline numbers.
  oee: "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200 font-semibold",
  machine: "bg-slate-50 dark:bg-slate-900 font-semibold",
  operator: "font-medium",
};

// Rows of one date share a faint shade; it flips as the date changes.
const DAY_TINT = ["bg-white dark:bg-slate-900", "bg-slate-50 dark:bg-slate-900/60"];

const dash = (v) => (v === "" || v === null || v === undefined ? "—" : v);
const n = (v) => dash(fmtNum(v));
const pct = (v) => dash(fmtPct(v));
// A blank input reads better as a dash than as a 0 nobody typed.
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
  lunchMin: "Lunch/Tea/Washroom",
  otherMin: "Other",
};

// ── Columns, flat and in sheet order ─────────────────────────────────────
// `get(row, calc, day, ctx)` renders one cell. The two `expandable` columns
// always show their own `summary` (the total); opening them additionally
// appends their `columns` breakdown right after it — the total is never
// hidden, only the breakdown behind it folds away.
// `headW` caps a header's width (so its label wraps instead of stretching
// the column) — left unset for columns whose values genuinely need the room.
const COLUMNS = [
  { key: "date", label: "Date", get: (r) => displayDay(r.date), merge: "date", frozen: "date" },
  {
    key: "machine",
    label: "Machine",
    get: (r, c, d, ctx) => ctx.machineName[r.machine] || "—",
    merge: "machineDay",
    tone: "machine",
    frozen: "machine",
  },
  { key: "operator", label: "Operator", get: (r) => dash(r.operator), tone: "operator" },
  { key: "itemName", label: "Part Name", get: (r) => dash(r.itemName) },
  { key: "drawingNo", label: "Drawing No.", get: (r) => dash(r.drawingNo) },
  {
    key: "cycle",
    label: "Total Cycle Time (sec)",
    expandable: true,
    summary: {
      key: "cycle",
      label: "Total Cycle Time (sec)",
      get: (r, c) => n(c.totalCycleSec),
      align: "text-end",
      tone: "calc",
      headW: "w-[104px]",
    },
    columns: CYCLE_OP_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      get: (r) => dash(r[f.key]),
      align: "text-end",
    })),
  },
  { key: "on", label: "Machine ON Time", get: (r) => dash(r.machineOnTime) },
  { key: "off", label: "Machine OFF Time", get: (r) => dash(r.machineOffTime) },
  { key: "shift", label: "Machine Shift Time (hr)", get: (r, c) => n(c.shiftHours), align: "text-end", tone: "calc" },
  { key: "idealQty", label: "Ideal Quantity", get: (r, c) => n(c.idealQty), align: "text-end", tone: "calc" },
  { key: "okQty", label: "Actual OK Quantity", get: (r) => min(r.okQty), align: "text-end" },
  { key: "rejectedQty", label: "Rejected Quantity", get: (r, c) => n(c.rejectedQty), align: "text-end", tone: "calc" },
  { key: "pctOk", label: "% OK Quantity", get: (r, c) => pct(c.pctOk), align: "text-end", tone: "calc" },
  {
    key: "plannedShift",
    label: "Planned Operator Shift Time (hr)",
    get: (r) => min(r.plannedOperatorShiftHours),
    align: "text-end",
    headW: "w-[116px]",
  },
  {
    key: "unutilized",
    label: "Unutilized Machine Time (%)",
    // Shown as a percentage like every other efficiency column, not a raw ratio.
    get: (r, c, d) => pct(d.unutilized),
    align: "text-end",
    tone: "day",
    headW: "w-[110px]",
  },
  {
    key: "downtime",
    label: "Total Stoppage (min)",
    expandable: true,
    summary: {
      key: "totalStoppage",
      label: "Total Stoppage (min)",
      get: (r, c) => n(c.totalStoppageMin),
      align: "text-end",
      tone: "calc",
      headW: "w-[100px]",
    },
    columns: STOPPAGE_FIELDS.map((f) => ({
      key: f.key,
      label: DOWNTIME_LABEL[f.key] || f.label,
      get: (r) => min(r[f.key]),
      align: "text-end",
    })),
  },
  {
    key: "effective",
    label: "Effective Machine Run Time (hr)",
    get: (r, c) => n(c.effectiveHours),
    align: "text-end",
    tone: "calc",
    headW: "w-[110px]",
  },
  {
    key: "unreported",
    label: "Unreported Time (min)",
    get: (r, c, d) => n(d.unreportedMin),
    align: "text-end",
    tone: "day",
  },
  { key: "setupEff", label: "Setup Efficiency (%)", get: (r, c) => pct(c.setupEfficiency), align: "text-end", tone: "calc" },
  {
    key: "oeeLosses",
    label: "OEE considering losses (%)",
    get: (r, c, d) => pct(d.oeeLosses),
    align: "text-end",
    tone: "oee",
    headW: "w-[120px]",
  },
  {
    key: "oeeLunch",
    label: "OEE not considering losses but lunch (%)",
    get: (r, c, d) => pct(d.oeeLunch),
    align: "text-end",
    tone: "oee",
    headW: "w-[120px]",
  },
  {
    key: "oeeLunchCot",
    label: "OEE not considering losses but lunch and COT (%)",
    get: (r, c, d) => pct(d.oeeLunchCot),
    align: "text-end",
    tone: "oee",
    headW: "w-[130px]",
  },
  { key: "remarks", label: "Remarks", get: (r) => dash(r.remarks), wrap: true },
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
  // When true, the table box measures the real gap between itself and the
  // bottom of the window (via ref, not a guessed CSS number) and fills it —
  // so it's never too short (dead space below) or too tall (rows clipped
  // off the bottom of a small laptop screen) on any screen size.
  fillHeight = false,
}) => {
  // Both breakdowns start collapsed — the sheet opens showing just the two
  // totals, and either can be expanded on demand.
  const [open, setOpen] = useState({ cycle: false, downtime: false });
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  // Measures live rather than guessing: the box's own top (which already
  // accounts for the header, filters row, and pagination bar above it,
  // whatever their actual height turns out to be) to the bottom of the
  // window, minus a little breathing room — recomputed on resize so it
  // keeps up with the sidebar collapsing, the window resizing, or the
  // filters row wrapping to a second line.
  const scrollRef = useRef(null);
  const [scrollHeight, setScrollHeight] = useState(null);
  useEffect(() => {
    if (!fillHeight) return undefined;
    const el = scrollRef.current;
    if (!el) return undefined;
    const update = () => {
      const top = el.getBoundingClientRect().top;
      setScrollHeight(Math.max(240, Math.floor(window.innerHeight - top - 16)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [fillHeight]);

  // The formula popover, anchored to whichever eye icon was clicked — fixed-
  // position so it isn't clipped by the table's own scroll container.
  const [formulaPopup, setFormulaPopup] = useState(null); // { key, label, text, x, y }
  const showFormula = (e, key, label) => {
    e.stopPropagation();
    const text = FORMULAS[key];
    if (!text) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setFormulaPopup((prev) =>
      prev?.key === key ? null : { key, label, text, x: rect.left, y: rect.bottom + 6 },
    );
  };

  const ctx = useMemo(() => ({ machineName }), [machineName]);

  // Rows arrive sorted by date, then machine, then entry no., so a repeated
  // Date or Machine is always a run of adjacent rows. Each run's first row
  // carries the rowSpan and the rest skip that cell.
  const layout = useMemo(() => {
    const spans = rows.map(() => ({ dateStart: false, machineStart: false, dateSpan: 0, machineSpan: 0, dayIndex: 0 }));

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

  // The flat, left-to-right list of cell definitions this render actually
  // shows: an `expandable` column always contributes its own summary (the
  // total) with the expand/collapse chevron riding beside it; opening it
  // appends its breakdown columns straight after, to that total's right —
  // every other column passes straight through.
  const visible = useMemo(() => {
    const out = [];
    for (const col of COLUMNS) {
      if (!col.expandable) {
        out.push(col);
        continue;
      }
      const isOpen = open[col.key];
      out.push({ ...col.summary, expand: { id: col.key, isOpen, label: col.label } });
      if (isOpen) col.columns.forEach((sub) => out.push(sub));
    }
    return out;
  }, [open]);
  const totalCols = visible.length + 1; // + Actions

  const Chevron = ({ expand }) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle(expand.id);
      }}
      title={expand.isOpen ? `Collapse ${expand.label}` : `Expand ${expand.label}`}
      aria-label={expand.isOpen ? `Collapse ${expand.label}` : `Expand ${expand.label}`}
      className="inline-flex items-center justify-center rounded bg-white/80 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 hover:bg-white dark:hover:bg-slate-900 transition-colors flex-shrink-0"
      style={{ width: 18, height: 18 }}
    >
      {expand.isOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
    </button>
  );

  return (
    <>
      <div
        ref={scrollRef}
        className="table-scroll-x border border-slate-300 dark:border-slate-700 rounded-lg overflow-auto"
        style={
          fillHeight
            ? { maxHeight: scrollHeight ? `${scrollHeight}px` : "calc(100vh - 300px)" }
            : { maxHeight: "calc(100vh - 300px)" }
        }
      >
        <table className="w-full text-xs sm:text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              {visible.map((c) => (
                <th
                  key={c.key}
                  className={`${thBase} ${c.frozen ? `${FROZEN[c.frozen]} z-30` : ""} ${HEAD_BG} ${c.align || ""} ${c.headW || ""}`}
                >
                  <span className="inline-flex items-start gap-1">
                    {c.label}
                    {FORMULAS[c.key] && (
                      <button
                        type="button"
                        onClick={(e) => showFormula(e, c.key, c.label)}
                        title="How this is calculated"
                        aria-label={`How ${c.label} is calculated`}
                        className="inline-flex items-center justify-center rounded-full text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 flex-shrink-0"
                      >
                        <Eye size={13} />
                      </button>
                    )}
                    {c.expand && <Chevron expand={c.expand} />}
                  </span>
                </th>
              ))}
              <th className={`${thBase} ${HEAD_BG} text-center`}>Action</th>
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
                    {visible.map((c) => {
                      // Merged cells are drawn once, on the run's first row.
                      if (c.merge === "date" && !span.dateStart) return null;
                      if (c.merge === "machineDay" && !span.machineStart) return null;
                      const rowSpan =
                        c.merge === "date" ? span.dateSpan : c.merge === "machineDay" ? span.machineSpan : undefined;
                      // Every cell paints its own background: a frozen column
                      // would otherwise be see-through as the rest scrolls
                      // underneath it. Operator isn't frozen and has no bg of
                      // its own, so it still takes the row's alternating date
                      // tint; every other tone (or none) carries its own
                      // opaque bg.
                      const bg =
                        c.tone === "operator"
                          ? `${dayBg} ${TONE.operator}`
                          : c.tone
                            ? TONE[c.tone]
                            : `${dayBg} text-slate-700 dark:text-slate-200`;
                      return (
                        <td
                          key={c.key}
                          rowSpan={rowSpan > 1 ? rowSpan : undefined}
                          className={`${td} ${bg} ${c.align || ""} ${c.frozen ? `${FROZEN[c.frozen]} z-10` : ""} ${
                            c.merge ? "align-middle" : ""
                          }`}
                          style={c.wrap ? { whiteSpace: "normal", minWidth: 220 } : undefined}
                        >
                          {c.get(r, calc, day, ctx)}
                        </td>
                      );
                    })}
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

      {formulaPopup && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setFormulaPopup(null)} />
          <div
            className="fixed z-50 w-80 max-w-[90vw] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-lg p-3"
            style={{ left: Math.min(formulaPopup.x, window.innerWidth - 336), top: formulaPopup.y }}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">{formulaPopup.label}</span>
              <button
                type="button"
                onClick={() => setFormulaPopup(null)}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex-shrink-0"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 mb-0">{formulaPopup.text}</p>
          </div>
        </>
      )}
    </>
  );
};

export default ProductionEntriesTable;
