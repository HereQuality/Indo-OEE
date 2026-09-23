import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Pencil, Trash2, X } from "lucide-react";
import {
  CYCLE_OP_FIELDS,
  REJECT_REASONS,
  STOPPAGE_FIELDS,
  displayDay,
  fmtNum,
  fmtPct,
  rowCalc,
} from "../../utils/productionSheet";

// The plain-English formula behind every calculated column — shown in a
// popover from the eye icon next to its header, so nobody has to remember or
// ask what a grey box actually computed.
const FORMULAS = {
  cycle: "The Part's own Total Cycle Time, minus any operation unticked for this entry.",
  shift: "Machine Shift Time = MOD(Machine OFF Time − Machine ON Time, 1) × 24",
  idealQty:
    "Ideal Quantity = FLOOR(Machine Shift Time × 3600 ÷ Total Cycle Time). There's no typed Actual Quantity — this stands in for it.",
  rejectedQty:
    "Rejected Quantity = Ideal Quantity − OK Quantity. The breakdown shows how that total splits across the reasons entered on the form.",
  pctOk: "% OK Quantity = OK Quantity ÷ (OK Quantity + Rejected Quantity)",
  unutilized: "Unutilized Machine Time = (12 − (Shift Hours − Lunch ÷ 60)) ÷ 11, for this entry alone.",
  totalStoppage: "Total Stoppage = sum of the ten downtime columns.",
  effective: "Effective Machine Run Time = OK Quantity × Total Cycle Time ÷ 3600",
  unreported:
    "Unreported Time = (Shift Hours × 60) − (Effective Runtime × 60) − Total Downtime, combined across every entry of this machine's date — so every entry of that machine/date shows the same figure.",
  setupEff: "Setup Efficiency = Effective Machine Run Time ÷ Machine Shift Time",
  oeeLosses:
    "OEE considering losses = Effective Run Time ÷ (Shift Hours − Total Downtime ÷ 60), combined across every entry of this machine's date.",
  oeeLunch:
    "OEE not considering losses but lunch = Effective Run Time ÷ (Shift Hours − Lunch ÷ 60), combined across every entry of this machine's date.",
  oeeLunchCot:
    "OEE not considering losses but lunch and COT = Effective Run Time ÷ (Shift Hours − Lunch ÷ 60 − Setup Time ÷ 60), combined across every entry of this machine's date.",
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
 * Columns are told apart by colour, not by a dense grid of ruled lines: a
 * calculated cell carries a soft indigo wash with matching bold text (typed
 * cells stay plain), the day-window figures (Unutilized/Unreported) get
 * their own teal, and the three OEE percentage columns get blue so the
 * sheet's headline numbers stand out from the rest — see TONE/OEE_TINT/
 * HEAD_TEXT below. Every calculated header gets an eye-icon button showing
 * the formula behind it, and most headers wrap onto a couple of lines
 * rather than stretching their column wide. Rows of the same date share a
 * faint shade that flips as the date changes, and Date/Machine are frozen
 * at the left (Action frozen at the right) while the rest of the sheet
 * scrolls under them — with several entries per day, one Date cell spans
 * that date's rows and one Machine cell spans that machine's entries within
 * it, so a machine's shifts read as one day's work instead of repeating
 * cells.
 */

// Headers wrap onto a second line only once their own label passes 20
// characters — under that, a column gets its label's full width on one
// line rather than being squeezed down to some shared size. `ch` tracks the
// table's own font size rather than a guessed pixel count. This has to be
// an inline style, not a Tailwind class: the width is computed per-column
// at render time, and Tailwind's build-time scan can't see a class name
// assembled from a JS variable, so a `w-[Nch]` string built in JS never
// makes it into the compiled CSS. It's a minimum, not a cap — table layout
// is auto, so a column still grows past it for a wider value underneath
// (e.g. a long operator name); `headStyle` overrides it outright for the
// couple of columns (Part Name, Drawing No.) whose values run far longer
// than their own label.
// 24, not 20: a handful of labels (e.g. "Total Cycle Time (sec)", 23 chars;
// "Machine Shift Time (hr)", 24) sat just past 20, so their trailing "(sec)"/
// "(hr)" unit was wrapping onto a line by itself. 24 lets those sit on one
// line while the genuinely long OEE labels still wrap.
const HEAD_CH_CAP = 24;
// The eye (formula) and chevron (expand) buttons sit on the same line as the
// label, past its last character — so a column with one needs extra room
// beyond the label's own length, or that last word gets pushed onto a line
// of its own even though the label alone would have fit.
const ICON_CH = 3;
const autoHeadStyle = (label, { hasFormula = false, hasExpand = false } = {}) => {
  const ch = Math.min(label.length, HEAD_CH_CAP) + (hasFormula ? ICON_CH : 0) + (hasExpand ? ICON_CH : 0);
  return { width: `${ch}ch`, minWidth: `${ch}ch` };
};

// Columns are told apart by colour (a pastel wash + matching bold text per
// column family — see TONE/OEE_TINT/HEAD_TEXT below) *and* by a visible
// ruled grid — dropping the vertical rules read as too flat/washed-out, so
// they're back, darker than the row-separator lines to frame the header.
const thBase =
  "sticky top-0 z-20 align-bottom px-2 py-1.5 font-bold whitespace-normal leading-tight border-r-2 border-b-2 border-slate-400 dark:border-slate-500";
const td = "px-2 py-1.5 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-600";

// The row where one date's block of entries ends and the next begins gets a
// heavier top border than the plain row-to-row ones, so a day boundary is
// visibly darker than an ordinary line — not just a shade change.
const dayBoundary = "border-t-2 border-t-slate-400 dark:border-t-slate-500";

// Date and Machine stay put on the left while the rest of the columns
// scroll past underneath them; Action stays put on the right the same way.
// Whichever frozen column borders the scrolling middle carries the shadow
// that marks that freeze line.
const FROZEN = {
  date: "sticky left-0 w-[104px] min-w-[104px]",
  machine: "sticky left-[104px] w-[96px] min-w-[96px] shadow-[4px_0_10px_rgba(0,0,0,0.06)]",
  action: "sticky right-0 w-[96px] min-w-[96px] shadow-[-4px_0_10px_rgba(0,0,0,0.06)]",
};

// A white header, with each column family's own colour carried in its text
// rather than a solid header fill — keyed by `c.tone`, same key the body
// tones below use, so a column's header and its values always read as the
// same colour. Columns with no tone (Date, Part Name, typed values, …) fall
// back to a plain neutral header.
const HEAD_BG = "bg-white dark:bg-slate-900";
const HEAD_TEXT = {
  date: "text-blue-700 dark:text-blue-300",
  machine: "text-emerald-700 dark:text-emerald-300",
  calc: "text-indigo-700 dark:text-indigo-300",
  day: "text-teal-700 dark:text-teal-300",
  oee: "text-blue-700 dark:text-blue-300",
};
const HEAD_TEXT_DEFAULT = "text-slate-600 dark:text-slate-300";

// Body cell tints, by what the cell is rather than where it sits. `calc`
// and `day` each carry a soft pastel wash with matching bold text, so a
// calculated column stands apart from a typed one by colour, not by a flat
// grey fill. Date/Operator are text-only tones (see TEXT_ONLY_TONES below):
// they take the row's own alternating background rather than their own,
// since they're identity columns, not calculated ones. Machine is frozen
// and needs its own opaque background regardless, so scrolling columns
// can't show through underneath it.
const TONE = {
  calc: "bg-indigo-50/60 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 font-semibold",
  day: "bg-teal-50/60 dark:bg-teal-950/20 text-teal-700 dark:text-teal-300 font-semibold",
  machine: "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 font-semibold",
  date: "text-blue-700 dark:text-blue-300 font-semibold",
  operator: "font-medium",
};
// Tones that colour only the text, keeping the row's own alternating
// background rather than replacing it with their own opaque fill.
const TEXT_ONLY_TONES = new Set(["date", "operator"]);

// The three OEE percentage columns get their own colour so they stand out as
// the sheet's headline numbers — but still alternate by day (two blue
// shades, paired with DAY_TINT below) instead of sitting as one flat block
// that makes every row look the same regardless of date.
const OEE_TINT = [
  "bg-blue-50/70 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 font-bold",
  "bg-blue-100/50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold",
];

// Rows of one date share a faint shade; it flips as the date changes.
const DAY_TINT = ["bg-white dark:bg-slate-900", "bg-slate-50 dark:bg-slate-900/60"];

const dash = (v) => (v === "" || v === null || v === undefined ? "—" : v);
const n = (v) => dash(fmtNum(v));
const pct = (v) => dash(fmtPct(v));
// A blank input reads better as a dash than as a 0 nobody typed.
const min = (v) => (v === null || v === undefined || v === "" ? "—" : fmtNum(Number(v)));
// The downtime/stoppage breakdown reads easier as 0 than as a dash — these are
// the figures added up into Total Stoppage, so a row of numbers is quicker to
// scan and add up by eye than a row mixing dashes and numbers. Display only:
// the formulas already treat a blank the same as 0.
const zeroIfBlank = (v) => fmtNum(v === null || v === undefined || v === "" ? 0 : Number(v));

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
// `headStyle` overrides the label-length-based default (`autoHeadStyle`,
// applied at render time) for the few columns whose values genuinely need
// more room than their own label implies.
const COLUMNS = [
  { key: "date", label: "Date", get: (r) => displayDay(r.date), merge: "date", frozen: "date", tone: "date" },
  {
    key: "machine",
    label: "Machine",
    get: (r, c, d, ctx) => ctx.machineName[r.machine] || "—",
    merge: "machineDay",
    tone: "machine",
    frozen: "machine",
  },
  { key: "operator", label: "Operator", get: (r) => dash(r.operator), tone: "operator" },
  { key: "itemName", label: "Part Name", get: (r) => dash(r.itemName), headStyle: { minWidth: 160 } },
  { key: "drawingNo", label: "Drawing No.", get: (r) => dash(r.drawingNo), headStyle: { minWidth: 130 } },
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
    },
    columns: CYCLE_OP_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      get: (r) => dash(r[f.key]),
      align: "text-end",
    })),
  },
  { key: "on", label: "Machine ON Time", get: (r) => dash(r.machineOnTime), align: "text-end" },
  { key: "off", label: "Machine OFF Time", get: (r) => dash(r.machineOffTime), align: "text-end" },
  {
    key: "shift",
    label: "Machine Shift Time (hr)",
    get: (r, c) => n(c.shiftHours),
    align: "text-end",
    tone: "calc",
  },
  {
    key: "idealQty",
    label: "Ideal Quantity",
    get: (r, c) => n(c.idealQty),
    align: "text-end",
    tone: "calc",
  },
  { key: "okQty", label: "Actual OK Quantity", get: (r) => min(r.okQty), align: "text-end" },
  {
    key: "rejectedQty",
    label: "Rejected Quantity",
    expandable: true,
    summary: {
      key: "rejectedQty",
      label: "Rejected Quantity",
      get: (r, c) => n(c.rejectedQty),
      align: "text-end",
      tone: "calc",
    },
    columns: REJECT_REASONS.map((reason) => ({
      key: reason,
      label: reason,
      get: (r) => min(r.rejectBreakdown?.[reason]),
      align: "text-end",
    })),
  },
  { key: "pctOk", label: "% OK Quantity", get: (r, c) => pct(c.pctOk), align: "text-end", tone: "calc" },
  {
    key: "plannedShift",
    label: "Planned Operator Shift Time (hr)",
    get: (r) => min(r.plannedOperatorShiftHours),
    align: "text-end",
  },
  {
    key: "unutilized",
    label: "Unutilized Machine Time (%)",
    // Shown as a percentage like every other efficiency column, not a raw ratio.
    get: (r, c, d) => pct(d.unutilized),
    align: "text-end",
    tone: "day",
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
    },
    columns: STOPPAGE_FIELDS.map((f) => ({
      key: f.key,
      label: DOWNTIME_LABEL[f.key] || f.label,
      get: (r) => zeroIfBlank(r[f.key]),
      align: "text-end",
    })),
  },
  {
    key: "effective",
    label: "Effective Machine Run Time (hr)",
    get: (r, c) => n(c.effectiveHours),
    align: "text-end",
    tone: "calc",
  },
  {
    key: "unreported",
    label: "Unreported Time (min)",
    get: (r, c, d) => n(d.unreportedMin),
    align: "text-end",
    tone: "day",
    // Combined across every entry of this machine's date (see dayCalc), so
    // it's shown once per machine/date group — spanning its rows exactly
    // like Machine does — rather than repeating the same figure down every
    // one of that machine's entries for the day.
    merge: "machineDay",
  },
  {
    key: "setupEff",
    label: "Setup Efficiency (%)",
    get: (r, c) => pct(c.setupEfficiency),
    align: "text-end",
    tone: "calc",
  },
  {
    key: "oeeLosses",
    label: "OEE considering losses (%)",
    get: (r, c, d) => pct(d.oeeLosses),
    align: "text-end",
    tone: "oee",
    merge: "machineDay",
  },
  {
    key: "oeeLunch",
    label: "OEE not considering losses but lunch (%)",
    get: (r, c, d) => pct(d.oeeLunch),
    align: "text-end",
    tone: "oee",
    merge: "machineDay",
  },
  {
    key: "oeeLunchCot",
    label: "OEE not considering losses but lunch and COT (%)",
    get: (r, c, d) => pct(d.oeeLunchCot),
    align: "text-end",
    tone: "oee",
    merge: "machineDay",
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
  // When true, the table fills whatever vertical space its flex parent
  // gives it (that parent — ProductionSheet's Card/CardBody — is itself a
  // flex column sized to the page's own viewport slice) and scrolls
  // internally, instead of growing past it and leaving the whole page to
  // scroll. Pure CSS (height: 100% down a `min-height: 0` flex chain), not
  // a JS measurement of window height — that snapshot goes stale the
  // moment anything above the table changes size (a wrapped filter row, a
  // loading state, pagination text), which is what let the page scroll
  // grow underneath the table's own scrollbar.
  fillHeight = false,
}) => {
  // Both breakdowns start collapsed — the sheet opens showing just the two
  // totals, and either can be expanded on demand.
  const [open, setOpen] = useState({ cycle: false, downtime: false });
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));

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
      className="inline-flex items-center justify-center rounded-full bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-100 hover:bg-slate-400 dark:hover:bg-slate-500 flex-shrink-0 transition-colors"
      style={{ width: 16, height: 16 }}
    >
      {expand.isOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
    </button>
  );

  return (
    <>
      <div
        className={`table-scroll-x border border-slate-200 dark:border-slate-700 rounded-xl overflow-auto ${
          fillHeight ? "h-full" : ""
        }`}
        style={fillHeight ? undefined : { maxHeight: "calc(100vh - 300px)" }}
      >
        <table className="w-full text-xs sm:text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              {visible.map((c) => (
                <th
                  key={c.key}
                  className={`${thBase} ${c.frozen ? `${FROZEN[c.frozen]} z-30` : ""} ${HEAD_BG} ${
                    HEAD_TEXT[c.tone] || HEAD_TEXT_DEFAULT
                  } ${c.align || ""}`}
                  style={
                    c.frozen
                      ? undefined
                      : c.headStyle ||
                        autoHeadStyle(c.label, { hasFormula: !!FORMULAS[c.key], hasExpand: !!c.expand })
                  }
                >
                  <span className="inline-flex items-center gap-1">
                    <span>{c.label}</span>
                    {FORMULAS[c.key] && (
                      <button
                        type="button"
                        onClick={(e) => showFormula(e, c.key, c.label)}
                        title="How this is calculated"
                        aria-label={`How ${c.label} is calculated`}
                        className="inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 flex-shrink-0 transition-colors"
                      >
                        <Eye size={13} />
                      </button>
                    )}
                    {c.expand && <Chevron expand={c.expand} />}
                  </span>
                </th>
              ))}
              <th className={`${thBase} ${HEAD_BG} ${HEAD_TEXT_DEFAULT} text-center ${FROZEN.action} z-30`}>Action</th>
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
                // The row that starts a new date (other than the sheet's
                // very first row) gets the heavier top border marking where
                // one day's block ends and the next begins.
                const boundary = span.dateStart && span.dayIndex > 0 ? dayBoundary : "";

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
                        c.tone === "oee"
                          ? OEE_TINT[span.dayIndex % 2]
                          : c.tone && TEXT_ONLY_TONES.has(c.tone)
                            ? `${dayBg} ${TONE[c.tone]}`
                            : c.tone
                              ? TONE[c.tone]
                              : `${dayBg} text-slate-700 dark:text-slate-200`;
                      return (
                        <td
                          key={c.key}
                          rowSpan={rowSpan > 1 ? rowSpan : undefined}
                          className={`${td} ${bg} ${boundary} ${c.align || ""} ${
                            c.frozen ? `${FROZEN[c.frozen]} z-10` : ""
                          } ${c.merge ? "align-middle" : ""}`}
                          style={c.wrap ? { whiteSpace: "normal", minWidth: 220 } : undefined}
                        >
                          {c.get(r, calc, day, ctx)}
                        </td>
                      );
                    })}
                    <td className={`${td} ${dayBg} ${boundary} ${FROZEN.action} z-10`}>
                      <div className="flex gap-1.5">
                        {canEdit && (
                          <button
                            type="button"
                            className="inline-flex items-center justify-center w-7 h-7 rounded-full text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition-colors"
                            title="Edit"
                            onClick={() => onEdit(r)}
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="inline-flex items-center justify-center w-7 h-7 rounded-full text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition-colors"
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
