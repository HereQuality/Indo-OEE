import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Clock, Eye, Lock, LockOpen, Pencil, Trash2, X } from "lucide-react";
import ConfirmAlert from "../Common/ConfirmAlert";
import BulkActionBar from "./BulkActionBar";
import { applyEntryShift } from "../../api/oeeReview.api";
import {
  CYCLE_OP_FIELDS,
  OEE_METRIC_LABELS,
  REJECT_REASONS,
  STOPPAGE_FIELDS,
  cycleOpLabel,
  displayDay,
  spanMinutes,
  fmtNum,
  fmtPct,
  remarkParts,
  rowCalc,
} from "../../utils/productionSheet";
import { hoursToHm } from "../../utils/shiftHours";
import { FORMULAS } from "../../utils/sheetFormulas";
import useDragScrollX from "../../hooks/useDragScrollX";

/**
 * components/Production/ProductionEntriesTable.jsx
 * ────────────────────────────────────────────────
 * One flat, locked header row — Date … Remarks … Actions, left to right, in
 * the sheet's own order. No section banner above it any more: every column
 * stands on its own name.
 *
 * Three columns fold, each into the same group the entry form shows it in:
 * Total Cycle Time (sec) → Drilling…Clamp/Declamp; Rejected Quantity → the
 * Rejection Master reasons; Total Stoppage (min) → Lunch / Rest and the
 * downtime boxes. (Planned Operator Shift and Stoppage Allowed are plain columns.) The total is
 * always shown; the chevron beside it opens its breakdown right after it,
 * without hiding the total or disturbing any other column. The Other reject
 * and Other downtime figures carry an eye with their required remark; the
 * general Remarks column comes last. Collapsing is display only: the same `rowCalc`/`dayCalc`
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
// that marks that freeze line. On a phone (below `sm`) the three together
// took 296px of a 375px screen, leaving the data columns no room to scroll
// into view. Below `lg` (phones and tablets, where the sidebar also eats
// width) only Date is frozen; Machine and Action scroll with the rest.
const FROZEN = {
  date: "sticky left-0 w-[84px] min-w-[84px] sm:w-[104px] sm:min-w-[104px] max-lg:shadow-[4px_0_10px_rgba(0,0,0,0.06)]",
  machine:
    "w-[88px] min-w-[88px] max-sm:whitespace-normal sm:w-[96px] sm:min-w-[96px] lg:sticky lg:left-[104px] lg:shadow-[4px_0_10px_rgba(0,0,0,0.06)]",
  action: "w-[136px] min-w-[136px] lg:sticky lg:right-0 lg:shadow-[-4px_0_10px_rgba(0,0,0,0.06)]",
};

// A white header, with each column family's own colour carried in its text
// rather than a solid header fill — keyed by `c.tone`, same key the body
// tones below use, so a column's header and its values always read as the
// same colour. Columns with no tone (Date, Part Name, typed values, …) fall
// back to a plain neutral header.
const HEAD_BG = "bg-white dark:bg-slate-900";
const HEAD_TEXT = {
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
  machine: "bg-white dark:bg-slate-900 font-semibold",
  date: "font-semibold",
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

export const dash = (v) => (v === "" || v === null || v === undefined ? "—" : v);
export const n = (v) => dash(fmtNum(v));
// Decimal hours as a clock reads them: 3.5 → "3:30".
export const hm = (v) => dash(hoursToHm(v));
export const pct = (v) => dash(fmtPct(v));
// A blank input reads better as a dash than as a 0 nobody typed.
export const min = (v) => (v === null || v === undefined || v === "" ? "—" : fmtNum(Number(v)));
// The downtime/stoppage breakdown reads easier as 0 than as a dash — these are
// the figures added up into Total Stoppage, so a row of numbers is quicker to
// scan and add up by eye than a row mixing dashes and numbers. Display only:
// the formulas already treat a blank the same as 0.
export const zeroIfBlank = (v) => fmtNum(v === null || v === undefined || v === "" ? 0 : Number(v));

// What the table says when it has nothing to list. Entries that are there but
// don't match the search box or the Filters are not the same as there being
// none yet, so only the plain "none" invites adding one. `sheet` names the
// entries ("RUBBER" → "No RUBBER entries…"); search only looks through the
// page on screen, so its message says so.
export const emptyEntriesText = ({ sheet = "", period, search = "", searchedOut = false, filtered = false }) => {
  const entries = sheet ? `${sheet} entries` : "entries";
  if (searchedOut) return `No ${entries} on this page match “${search.trim()}”.`;
  if (filtered) return `No ${entries} match the Filters for ${period}.`;
  return `No ${entries} for ${period}. Click “Add Entry” to start.`;
};

// Remarks used to sit in the table as full wrapped text, which forced the
// column wide and pushed most rows down whether or not that entry actually
// had one. Now it's just an eye icon — click to see them in a small popover,
// same idea as the header's "how this is calculated" icon.
//
// An entry can carry up to three (see remarkParts): why "Other" was used as a
// reject reason, why it was used as downtime, and the general Remarks box. The
// Remarks column shows only the general one; the other two open from the eye
// beside their own figure in the expanded breakdown (WithRemark below). Whatever
// it shows, the popover gives each remark its own labelled section, with the
// figure it explains, in the colour that figure has on the dashboard (rejected
// orange, downtime teal).
//
// It is drawn in a portal, positioned from the eye's own screen position,
// rather than inside the cell: the table scrolls and clips, so a popover
// anchored in the cell got cut off at the right edge and at the bottom rows.
// Its right edge lines up with the eye and it flips above the eye when there
// isn't room below; scrolling or resizing closes it, since the eye moves.
const REMARK_TONE = {
  reject: "text-orange-600 dark:text-orange-400",
  downtime: "text-teal-600 dark:text-teal-400",
  general: "text-slate-500 dark:text-slate-400",
};
// The eye beside a figure takes its section's colour, so a remark stands out
// from the plain grey eye of the Remarks column.
const REMARK_EYE = {
  reject: "text-orange-500 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300",
  downtime: "text-teal-500 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300",
  general: "text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200",
};
const POP_WIDTH = 300;
const POP_GAP = 6;
const POP_MARGIN = 8;

export const RemarkCell = ({ parts, inline = false }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current || !popRef.current) {
      setPos(null);
      return;
    }
    const eye = btnRef.current.getBoundingClientRect();
    const height = popRef.current.offsetHeight;
    const left = Math.min(Math.max(POP_MARGIN, eye.right - POP_WIDTH), window.innerWidth - POP_WIDTH - POP_MARGIN);
    const below = eye.bottom + POP_GAP;
    const top = below + height + POP_MARGIN <= window.innerHeight ? below : Math.max(POP_MARGIN, eye.top - POP_GAP - height);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onScroll = (e) => {
      if (!popRef.current?.contains(e.target)) close();
    };
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Beside a figure, no remark means nothing to show; in the Remarks column it
  // means a dash.
  if (!parts.length) return inline ? null : <span className="text-slate-300 dark:text-slate-600">—</span>;

  const summary = parts.map((p) => p.title).join(" · ");
  return (
    <div className="inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title={`View remarks — ${summary}`}
        aria-label="View remarks"
        aria-expanded={open}
        className={`inline-flex items-center justify-center transition-colors ${
          REMARK_EYE[inline ? parts[0].key : "general"]
        }`}
      >
        <Eye size={14} />
      </button>
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[999]" onClick={() => setOpen(false)} />
            <div
              ref={popRef}
              role="dialog"
              aria-label="Remarks"
              style={{ position: "fixed", width: POP_WIDTH, top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
              className="z-[1000] max-w-[calc(100vw-16px)] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-lg p-3 text-left"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="font-semibold text-xs text-slate-800 dark:text-slate-100">Remarks</span>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex-shrink-0">
                  <X size={14} />
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {parts.map((p, i) => (
                  <div key={p.key} className={i ? "mt-2.5 pt-2.5 border-t border-slate-200 dark:border-slate-700" : ""}>
                    {(parts.length > 1 || p.key !== "general") && (
                      <div className="flex items-baseline justify-between gap-2 mb-0.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wide ${REMARK_TONE[p.key]}`}>{p.title}</span>
                        {p.figure && <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">{p.figure}</span>}
                      </div>
                    )}
                    <p className="text-xs text-slate-700 dark:text-slate-200 mb-0 whitespace-pre-line break-words">{p.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
};

// A figure with an eye beside it when a remark explains it — the reject "Other"
// count and the Other downtime minutes, each of which the form requires a
// remark for. Used only in the expanded breakdown's Other column, so the remark
// sits right next to the number it explains rather than out in the Remarks
// column. `kind` is a remarkParts key.
export const WithRemark = ({ value, row, kind }) => {
  const parts = remarkParts(row).filter((p) => p.key === kind);
  if (!parts.length) return value;
  return (
    <span className="inline-flex items-center justify-center gap-1.5">
      {value}
      <RemarkCell parts={parts} inline />
    </span>
  );
};

// The downtime columns are headed with the same wording as the form, rather
// than the longer labels the old Excel grid used.
export const DOWNTIME_LABEL = {
  lunchMin: "Lunch / Rest",
  setupMin: "Setup Time",
  noManPowerMin: "No Man Power",
  materialShiftingMin: "Material Shifting",
  noMaterialMin: "No Material",
  bdMechMin: "Breakdown Mechanical",
  bdEleMin: "BD Electricity",
  noPowerMin: "No Power",
  otherMin: "Other",
};

// ── Columns, flat and in sheet order ─────────────────────────────────────
// `get(row, calc, day, ctx)` renders one cell. The `expandable` columns
// always show their own `summary` (the total); opening them additionally
// appends their `columns` breakdown right after it — the total is never
// hidden, only the breakdown behind it folds away.
// `headStyle` overrides the label-length-based default (`autoHeadStyle`,
// applied at render time) for the few columns whose values genuinely need
// more room than their own label implies.
// Machine Working Status — any of Machine Breakdown / No Manpower / No
// Planning, ticked on the entry form. Shared by every sheet's column list.
export const MACHINE_STATUS_COLUMN = {
  key: "machineStatus",
  label: "Machine Working Status",
  // Working unless the entry says Non Working; then the reason(s) follow.
  get: (r) => (r.workingMode === "Non Working" ? ["Non Working", ...(r.machineStatus || [])].join(" — ") : (r.machineStatus || []).length ? `Working — ${(r.machineStatus || []).join(", ")}` : "Working"),
  headStyle: { minWidth: 150 },
};

// A percentage, in red when it's over 100% — such an entry is held for Admin
// review, and the figure is shown exactly as worked out, never capped.
export const pctOver = (v) =>
  Number.isFinite(v) && v > 1 + 1e-9 ? <span className="text-danger fw-semibold">{fmtPct(v)}</span> : pct(v);

const REVIEW_STYLE = {
  pending: ["Pending review", "bg-warning-subtle text-warning-emphasis"],
  approved: ["Approved", "bg-success-subtle text-success-emphasis"],
  rejected: ["Rejected", "bg-danger-subtle text-danger-emphasis"],
};
const METRIC_LABEL = OEE_METRIC_LABELS;

// The entry's Admin review state, with what was over 100% (and any reviewer's
// remark) on hover. "—" for an entry that never needed review.
export const ReviewBadge = ({ review }) => {
  const style = review && REVIEW_STYLE[review.status];
  if (!style) return "—";
  const over = (review.flagged || []).map((f) => `${METRIC_LABEL[f.metric] || f.metric} ${fmtPct(f.value)}`).join(", ");
  const by = review.decidedBy?.name ? ` — ${review.status} by ${review.decidedBy.name}` : "";
  const title = [over && `Over 100%: ${over}`, by && by.slice(3), review.remark && `Remark: ${review.remark}`].filter(Boolean).join("\n");
  return (
    <span className={`badge rounded-pill ${style[1]}`} title={title} style={{ whiteSpace: "nowrap" }}>
      {style[0]}
    </span>
  );
};

// Availability / Performance / Quality for this entry alone (rowCalc), and its
// review state — the same four columns, in the same place, on every sheet.
export const APQ_COLUMNS = [
  { key: "availability", label: "Availability (%)", get: (r, c) => pctOver(c.availability), align: "text-center", tone: "calc" },
  { key: "performance", label: "Performance (%)", get: (r, c) => pctOver(c.performance), align: "text-center", tone: "calc" },
  { key: "quality", label: "Quality (%)", get: (r, c) => pctOver(c.quality), align: "text-center", tone: "calc" },
];

// The review state sits after the OEE columns.
export const REVIEW_COLUMN = { key: "review", label: "OEE Review", get: (r) => <ReviewBadge review={r.review} />, align: "text-center", headStyle: { minWidth: 120 } };

// Who did the entry — the person who first saved it (the audit log's create row)
// and, when someone else has edited it since, who saved it last. An entry from
// before the log existed shows its last saver alone. Added to every sheet's
// table here, last; the server sends it (utils/entryAudit.js withAuthors).
const authorTime = (p) => {
  const d = p?.at ? new Date(p.at) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
};
const EnteredByCell = ({ row }) => {
  const by = row.enteredBy || row.savedBy;
  if (!by) return "—";
  const edited = row.enteredBy && row.savedBy && row.savedBy.name !== row.enteredBy.name ? row.savedBy : null;
  return (
    <div className="text-start" title={[`Entered by ${by.name}${by.role ? ` (${by.role})` : ""}`, authorTime(by)].filter(Boolean).join(" · ")}>
      <div className="fw-semibold text-nowrap">{by.name}</div>
      <div className="text-muted small text-nowrap">{[by.role, authorTime(by)].filter(Boolean).join(" · ")}</div>
      {edited && <div className="text-muted small text-nowrap">edited by {edited.name}</div>}
    </div>
  );
};
export const ENTERED_BY_COLUMN = { key: "enteredBy", label: "Entered By", get: (r) => <EnteredByCell row={r} />, headStyle: { minWidth: 150 } };

// Vendor Name — right after Part Name on every sheet, but shown only on a
// process that uses vendors (the page's `showVendor`; see utils/vendorsFor.js).
export const VENDOR_COLUMN = { key: "vendorName", label: "Vendor Name", get: (r) => dash(r.vendorName), headStyle: { minWidth: 140 } };

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
  MACHINE_STATUS_COLUMN,
  { key: "itemName", label: "Part Name", get: (r) => dash(r.itemName), headStyle: { minWidth: 160 } },
  VENDOR_COLUMN,
  { key: "drawingNo", label: "Drawing No.", get: (r) => dash(r.drawingNo), headStyle: { minWidth: 130 } },
  {
    key: "cycle",
    label: "Total Cycle Time (sec)",
    expandable: true,
    summary: {
      key: "cycle",
      label: "Total Cycle Time (sec)",
      get: (r, c) => n(c.totalCycleSec),
      align: "text-center",
      tone: "calc",
    },
    columns: CYCLE_OP_FIELDS.map((f) => ({
      key: f.key,
      label: cycleOpLabel(f),
      get: (r) => dash(r[f.key]),
      align: "text-center",
    })),
  },
  { key: "on", label: "Machine ON Time", get: (r) => dash(r.machineOnTime), align: "text-center" },
  { key: "off", label: "Machine OFF Time", get: (r) => dash(r.machineOffTime), align: "text-center" },
  {
    key: "shift",
    label: "Machine Shift Time (hr:min)",
    get: (r, c) => hm(c.shiftHours),
    align: "text-center",
    tone: "calc",
  },
  {
    key: "idealQty",
    label: "Ideal Quantity",
    get: (r, c) => n(c.idealQty),
    align: "text-center",
    tone: "calc",
  },
  { key: "actualQty", label: "Actual Quantity", get: (r, c) => n(c.actualQty), align: "text-center" },
  { key: "okQty", label: "Actual OK Quantity", get: (r) => min(r.okQty), align: "text-center" },
  {
    key: "rejectedQty",
    label: "Rejected Quantity",
    expandable: true,
    summary: {
      key: "rejectedQty",
      label: "Rejected Quantity",
      get: (r, c) => n(c.rejectedQty),
      align: "text-center",
      tone: "calc",
    },
    columns: REJECT_REASONS.map((reason) => ({
      key: reason,
      label: reason,
      get: (r) => {
        const value = min(r.rejectBreakdown?.[reason]);
        return reason === "Other" ? <WithRemark value={value} row={r} kind="reject" /> : value;
      },
      align: "text-center",
    })),
  },
  { key: "pctOk", label: "% OK Quantity", get: (r, c) => pct(c.pctOk), align: "text-center", tone: "calc" },
  { key: "plannedShift", label: "Planned Operator Shift Time (hr:min)", get: (r) => hm(r.plannedOperatorShiftHours), align: "text-center" },
  {
    key: "unutilized",
    label: "Unutilized Machine Time (%)",
    // Shown as a percentage like every other efficiency column, not a raw ratio.
    get: (r, c, d) => pct(d.unutilized),
    align: "text-center",
    tone: "day",
    // Combined across every entry of this machine's date (see dayCalc), so
    // it's shown once per machine/date group — spanning its rows exactly
    // like Unreported Time and the three OEE columns — rather than
    // repeating the same figure down every one of that machine's entries.
    merge: "machineDay",
  },
  {
    key: "downtime",
    label: "Total Stoppage (min)",
    expandable: true,
    summary: {
      key: "totalStoppage",
      label: "Total Stoppage (min)",
      get: (r, c) => n(c.totalStoppageMin),
      align: "text-center",
      tone: "calc",
    },
    // The stoppage columns: Lunch / Rest plus the form's Downtime / Stoppage boxes.
    // plannedDownMin has no box on the form (and no entry uses it); it still
    // counts toward the total.
    // Lunch / Rest is stoppage time, so it is listed first among the stoppage columns.
    columns: [...STOPPAGE_FIELDS].filter((f) => f.key !== "plannedDownMin").sort((a, b) => (b.key === "lunchMin") - (a.key === "lunchMin")).map((f) => ({
      key: f.key,
      label: DOWNTIME_LABEL[f.key] || f.label,
      get: (r) => {
        const value = zeroIfBlank(r[f.key]);
        return f.key === "otherMin" ? <WithRemark value={value} row={r} kind="downtime" /> : value;
      },
      align: "text-center",
    })),
  },
  {
    key: "effective",
    label: "Effective Machine Run Time (hr:min)",
    get: (r, c) => hm(c.effectiveHours),
    align: "text-center",
    tone: "calc",
  },
  {
    key: "unreported",
    label: "Unreported Time (min)",
    get: (r, c, d) => n(d.unreportedMin),
    align: "text-center",
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
    align: "text-center",
    tone: "calc",
  },
  ...APQ_COLUMNS,
  {
    key: "oeeLosses",
    label: "OEE considering losses (%)",
    get: (r, c, d) => pctOver(d.oeeLosses),
    align: "text-center",
    tone: "oee",
    merge: "machineDay",
  },
  {
    key: "oeeLunch",
    label: "OEE not considering losses but lunch (%)",
    get: (r, c, d) => pctOver(d.oeeLunch),
    align: "text-center",
    tone: "oee",
    merge: "machineDay",
  },
  {
    key: "oeeLunchCot",
    label: "OEE not considering losses but lunch and setup time (%)",
    get: (r, c, d) => pctOver(d.oeeLunchCot),
    align: "text-center",
    tone: "oee",
    merge: "machineDay",
  },
  // The general Remarks box only. The two "Other" remarks are shown where their
  // figure is — the Other column of the Rejected Quantity and Total Stoppage
  // breakdowns (see WithRemark) — not repeated out here.
  REVIEW_COLUMN,
  {
    key: "remarks",
    label: "Remarks",
    get: (r) => <RemarkCell parts={remarkParts(r).filter((p) => p.key === "general")} />,
    align: "text-center",
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
  // (row) => a lock deadline string ("locked as of DD/MM/YYYY") or "" when
  // the row is still editable — see ProductionSheet.jsx's rowLockInfo.
  // Locked rows show a lock icon instead of the Edit/Delete buttons; the
  // server enforces the same rule regardless of what this says.
  lockInfo = () => "",
  // Super Admin only: a locked row shows an "Unlock" button instead of
  // Edit/Delete, calling onUnlock(row) — grants 24h access on that one
  // entry (see ProductionSheet.jsx's handleUnlock). unlockingId marks
  // whichever row's unlock request is in flight, so its button can show a
  // spinner instead of being clickable twice.
  isAdmin = false,
  onUnlock,
  unlockingId = null,
  // Super Admin / Full access: a row saved on an older shift gets a clock button
  // that moves just that entry onto the process's current Operator Planned Shift
  // (a change to the process only reaches new entries). currentShiftOf(row) is
  // the process's fixed hours for that row, or null when hours are typed per entry.
  currentShiftOf = () => null,
  // Ticking rows in the Action column turns on a bar of actions for all of them
  // at once. { sheet, unlock(id), remove(id), onDone({ type, message }) } — the
  // sheet's own single-row calls, run one after another; null = no ticking.
  bulk = null,
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
  // The sheet this table shows. Defaults are the CNC sheet; another sheet (the
  // VMC one) passes its own column list, the formula popovers for its calculated
  // headers, and the function that works one row's figures out.
  columns = COLUMNS,
  formulas = FORMULAS,
  calcRow = rowCalc,
  // Whether the Vendor Name column shows — only on a process that uses vendors.
  showVendor = false,
}) => {
  // Both breakdowns start collapsed — the sheet opens showing just the two
  // totals, and either can be expanded on demand.
  const [open, setOpen] = useState({ cycle: false, downtime: false });
  // Ticked rows (by id), the action waiting on its confirmation, and a running batch.
  const [selected, setSelected] = useState(() => new Set());
  // Ticking rows is for Super Admin / Full access only (isAdmin) — everyone else sees the plain table.
  const bulkOn = !!bulk && isAdmin;
  // The last row ticked, for Shift-click to tick everything between it and the next.
  const lastTicked = useRef(null);
  const [confirm, setConfirm] = useState(null); // { kind: "shift" | "delete", rows, was?, now? }
  const [progress, setProgress] = useState(null); // { label, done, total }

  // A row saved on a different shift from its process's current one: { was, now, tooShort }, else null.
  // tooShort: its machine ran longer than the current shift, which the entry form (and the server) refuse.
  const shiftChange = (r) => {
    const now = currentShiftOf(r);
    const was = r.plannedOperatorShiftHours;
    if (now === null || now === undefined || was === null || was === undefined || was === "" || !Number.isFinite(Number(was))) return null;
    if (Math.abs(Number(was) - now) < 0.0005 && r.plannedLocked !== false) return null;
    const run = spanMinutes(r.machineOnTime, r.machineOffTime);
    return { was: Number(was), now, run, tooShort: run !== null && now * 60 < run - 1e-9 };
  };
  // What each bulk action can do to a row — the rest of the selection is skipped.
  const canBulk = {
    delete: (r) => !!bulk?.remove && canDelete && !lockInfo(r),
    unlock: (r) => !!bulk?.unlock && isAdmin && !!lockInfo(r),
    shift: (r) => !!bulk?.sheet && isAdmin && !lockInfo(r) && !!shiftChange(r) && !shiftChange(r).tooShort,
  };

  // Only rows still on the page stay ticked (a new page, filter or save drops the rest).
  useEffect(() => {
    lastTicked.current = null;
    setSelected((prev) => {
      if (!prev.size) return prev;
      const ids = new Set(rows.map((r) => r._id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r._id)), [rows, selected]);
  // Tick or untick a row; with Shift held, every row between the last one ticked and this one
  // (in the order shown) gets the same state.
  const tick = (index, withShift) => {
    const id = rows[index]._id;
    const anchor = lastTicked.current;
    setSelected((prev) => {
      const next = new Set(prev);
      const adding = !prev.has(id);
      const [from, to] = withShift && anchor !== null && rows[anchor] ? [Math.min(anchor, index), Math.max(anchor, index)] : [index, index];
      for (let i = from; i <= to; i += 1) {
        if (adding) next.add(rows[i]._id);
        else next.delete(rows[i]._id);
      }
      return next;
    });
    lastTicked.current = index;
  };
  const clearSelection = () => {
    setSelected(new Set());
    lastTicked.current = null;
  };

  const KINDS = {
    delete: { run: (id) => bulk.remove(id), label: "Deleting", done: "Deleted" },
    unlock: { run: (id) => bulk.unlock(id), label: "Unlocking", done: "Unlocked for 24 hours:" },
    shift: { run: (id) => applyEntryShift(bulk.sheet, id), label: "Applying the current shift to", done: "Applied the current shift to" },
  };
  // One after another, not in parallel: the sheet's slot and overlap rules look at what is already saved.
  const runBatch = async (kind, list) => {
    if (!list.length) return;
    const { run, label, done } = KINDS[kind];
    const failures = [];
    const succeeded = [];
    setProgress({ label, done: 0, total: list.length });
    for (const [i, r] of list.entries()) {
      try {
        await run(r._id);
        succeeded.push(r._id);
      } catch (err) {
        failures.push(err?.response?.data?.message || err?.message || "failed");
      }
      setProgress({ label, done: i + 1, total: list.length });
    }
    setProgress(null);
    setSelected((prev) => new Set([...prev].filter((id) => !succeeded.includes(id))));
    const noun = (n) => `${n} ${n === 1 ? "entry" : "entries"}`;
    const type = !failures.length ? "success" : succeeded.length ? "warning" : "error";
    const message = failures.length
      ? `${succeeded.length ? `${done} ${noun(succeeded.length)}; ` : ""}${noun(failures.length)} failed — ${failures[0]}`
      : `${done} ${noun(succeeded.length)}`;
    bulk?.onDone?.({ type, message });
  };
  const eligible = (kind) => selectedRows.filter(canBulk[kind]);
  const askOrRun = (kind) => {
    const list = eligible(kind);
    if (kind === "unlock") runBatch(kind, list);
    else setConfirm({ kind, rows: list });
  };
  // Expanding/collapsing a breakdown changes how many columns sit to its
  // right without moving anything to its left — but the browser doesn't
  // know that, so when the table gets narrower it just clamps the native
  // scrollLeft down to the new (smaller) max, which reads as being thrown
  // to the far right regardless of where the toggled column actually was.
  // This remembers that column's on-screen position right before the
  // toggle and restores it once the new column set has rendered, so the
  // same header stays under the same spot on screen either way.
  const scrollAnchorRef = useRef(null);
  const toggle = (key) => {
    const th = bodyRef.current?.querySelector(`th[data-col-key="${key}"]`);
    if (th && bodyRef.current) {
      scrollAnchorRef.current = { key, offsetFromContainerLeft: th.getBoundingClientRect().left - bodyRef.current.getBoundingClientRect().left };
    }
    setOpen((o) => ({ ...o, [key]: !o[key] }));
  };
  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current;
    scrollAnchorRef.current = null;
    if (!anchor || !bodyRef.current) return;
    const th = bodyRef.current.querySelector(`th[data-col-key="${anchor.key}"]`);
    if (!th) return;
    const containerLeft = bodyRef.current.getBoundingClientRect().left;
    const thAbsoluteLeft = th.getBoundingClientRect().left - containerLeft + bodyRef.current.scrollLeft;
    const desired = Math.max(0, thAbsoluteLeft - anchor.offsetFromContainerLeft);
    bodyRef.current.scrollLeft = desired;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The table scrolls inside its own box. Left/right is by click-and-drag
  // anywhere on it (hand cursor, see hooks/useDragScrollX), the wheel/trackpad, or
  // the scrollbar along its bottom edge.
  const bodyRef = useRef(null);
  useDragScrollX(bodyRef);

  // The formula popover, anchored to whichever eye icon was clicked — fixed-
  // position so it isn't clipped by the table's own scroll container.
  const [formulaPopup, setFormulaPopup] = useState(null); // { key, label, text, x, y }
  const showFormula = (e, key, label) => {
    e.stopPropagation();
    const text = formulas[key];
    if (!text) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setFormulaPopup((prev) =>
      prev?.key === key ? null : { key, label, text, x: rect.left, y: rect.bottom + 6 },
    );
  };

  // Escape closes the formula popover, as it does the remarks one.
  useEffect(() => {
    if (!formulaPopup) return undefined;
    const onKey = (e) => e.key === "Escape" && setFormulaPopup(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [formulaPopup]);

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
  // every other column passes straight through. While open, the LAST
  // breakdown column also gets its own collapse chevron, so collapsing a
  // wide breakdown (e.g. the ten downtime reasons, or Drilling…Clamp/Declamp)
  // doesn't mean scrolling all the way back to the summary column first.
  const visible = useMemo(() => {
    const out = [];
    for (const col of [...columns, ENTERED_BY_COLUMN]) {
      if (col.key === VENDOR_COLUMN.key && !showVendor) continue;
      if (!col.expandable) {
        out.push(col);
        continue;
      }
      const isOpen = open[col.key];
      out.push({ ...col.summary, expand: { id: col.key, isOpen, label: col.label } });
      if (isOpen) {
        col.columns.forEach((sub, i) => {
          const isLast = i === col.columns.length - 1;
          out.push(isLast ? { ...sub, expand: { id: col.key, isOpen: true, label: col.label } } : sub);
        });
      }
    }
    return out;
  }, [open, columns, showVendor]);
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
        ref={bodyRef}
        className={`table-scroll-x border border-slate-200 dark:border-slate-700 rounded-xl overflow-auto ${
          fillHeight ? "h-full" : ""
        }`}
        // Room under the last rows for the bulk bar while rows are ticked.
        style={{ ...(fillHeight ? {} : { maxHeight: "calc(100vh - 300px)" }), ...(selected.size ? { paddingBottom: 96 } : {}) }}
      >
        <table className="w-full text-xs sm:text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              {visible.map((c) => (
                <th
                  key={c.key}
                  data-col-key={c.key}
                  className={`${thBase} ${c.frozen ? `${FROZEN[c.frozen]} z-30` : ""} ${HEAD_BG} ${
                    HEAD_TEXT[c.tone] || HEAD_TEXT_DEFAULT
                  } ${c.align || ""}`}
                  style={
                    c.frozen
                      ? undefined
                      : c.headStyle ||
                        autoHeadStyle(c.label, { hasFormula: !!formulas[c.key], hasExpand: !!c.expand })
                  }
                >
                  <span className={`flex items-center gap-1 ${c.align === "text-center" ? "justify-center" : c.align === "text-end" ? "justify-end" : ""}`}>
                    <span>{c.label}</span>
                    {formulas[c.key] && (
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
              <th className={`${thBase} ${HEAD_BG} ${HEAD_TEXT_DEFAULT} text-center ${FROZEN.action} z-30`}>
                Action
              </th>
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
                const calc = calcRow(r);
                const day = dayResultByKey[r._id] || {};
                const span = layout[i];
                const isPicked = selected.has(r._id);
                const dayBg = isPicked ? "bg-sky-100 dark:bg-sky-950/60" : DAY_TINT[span.dayIndex % 2];
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
                      // A merged cell (Date, Machine) stands for several rows, so
                      // ticking one of them doesn't tint it.
                      const cellBg = c.merge ? DAY_TINT[span.dayIndex % 2] : dayBg;
                      const bg =
                        c.tone === "oee"
                          ? OEE_TINT[span.dayIndex % 2]
                          : c.tone && TEXT_ONLY_TONES.has(c.tone)
                            ? `${cellBg} ${TONE[c.tone]}`
                            : c.tone
                              ? TONE[c.tone]
                              : `${cellBg} text-slate-700 dark:text-slate-200`;
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
                      {(() => {
                        const locked = lockInfo(r);
                        const box = bulkOn ? (
                          // The label gives the small checkbox a 44px tap area on touch screens.
                          <label className="touch-hit-label m-0 inline-flex flex-shrink-0 items-center justify-center leading-none cursor-pointer">
                            <input
                              type="checkbox"
                              className="h-4 w-4 flex-shrink-0 rounded border-slate-300 accent-blue-600 cursor-pointer"
                              checked={isPicked}
                              onChange={(e) => tick(i, e.nativeEvent.shiftKey)}
                              // Shift + click shouldn't also highlight the text between the two rows.
                              onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                              title="Tick — hold Shift and tick another to tick every row in between"
                              aria-label="Select this entry"
                            />
                          </label>
                        ) : null;
                        if (locked) {
                          if (isAdmin) {
                            const busy = unlockingId === r._id;
                            return (
                              <div className="flex items-center justify-center gap-2">
                                {box}
                                <button
                                  type="button"
                                  disabled={busy}
                                  className="touch-hit inline-flex items-center gap-1 px-2 h-7 rounded-full text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40 transition-colors disabled:opacity-60 text-xs font-medium"
                                  title={`${locked} — click to unlock for 24 hours`}
                                  onClick={() => onUnlock?.(r)}
                                >
                                  <LockOpen size={13} />
                                  {busy ? "Unlocking…" : "Unlock"}
                                </button>
                              </div>
                            );
                          }
                          return (
                            <div className="flex items-center justify-center gap-2" title={locked}>
                              {box}
                              <Lock size={14} className="text-slate-400 dark:text-slate-500" />
                            </div>
                          );
                        }
                        return (
                          <div className="flex items-center gap-1.5">
                            {box}
                            {canEdit && (
                              <button
                                type="button"
                                className="touch-hit inline-flex items-center justify-center w-7 h-7 rounded-full text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition-colors"
                                title="Edit"
                                onClick={() => onEdit(r)}
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            {isAdmin && bulk?.sheet && (() => {
                              const change = shiftChange(r);
                              if (!change) return null;
                              if (change.tooShort) {
                                return (
                                  <span
                                    className="touch-hit inline-flex items-center justify-center w-7 h-7 rounded-full text-slate-300 dark:text-slate-600 cursor-not-allowed"
                                    title={`Can't apply the current ${hoursToHm(change.now)} shift: this entry's machine ran ${hoursToHm(change.run / 60)}, longer than that. Edit its ON/OFF times first.`}
                                  >
                                    <Clock size={14} />
                                  </span>
                                );
                              }
                              return (
                                <button
                                  type="button"
                                  className="touch-hit inline-flex items-center justify-center w-7 h-7 rounded-full text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40 transition-colors"
                                  title={`Saved on a ${hoursToHm(change.was)} shift — apply the current ${hoursToHm(change.now)} shift to this entry`}
                                  onClick={() => setConfirm({ kind: "shift", rows: [r], ...change })}
                                >
                                  <Clock size={14} />
                                </button>
                              );
                            })()}
                            {canDelete && (
                              <button
                                type="button"
                                className="touch-hit inline-flex items-center justify-center w-7 h-7 rounded-full text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition-colors"
                                title="Remove"
                                onClick={() => onDelete(r)}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <ConfirmAlert
        isOpen={!!confirm}
        variant={confirm?.kind === "delete" ? "danger" : "warning"}
        title={
          confirm?.kind === "delete"
            ? `Delete ${confirm.rows.length} ${confirm.rows.length === 1 ? "entry" : "entries"}?`
            : confirm?.rows.length === 1
              ? "Apply the current shift to this entry?"
              : `Apply the current shift to ${confirm?.rows.length} entries?`
        }
        message={
          !confirm
            ? ""
            : confirm.kind === "delete"
              ? "They are removed from the sheet for good (the audit log keeps a record of each). Entries that are locked are left out."
              : confirm.rows.length === 1
                ? `${displayDay(confirm.rows[0].date)} · ${machineName[confirm.rows[0].machine] || confirm.rows[0].operator || "entry"}: Planned Operator Shift ${hoursToHm(confirm.was)} → ${hoursToHm(confirm.now)}. Its Availability, Performance and Quality are worked out again, and it may go to OEE Review. The change is logged.`
                : "Each one moves onto its process's current Operator Planned Shift. Their Availability, Performance and Quality are worked out again, and some may go to OEE Review. Every change is logged."
        }
        confirmText={confirm?.kind === "delete" ? "Delete" : "Apply shift"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const { kind, rows: list } = confirm;
          setConfirm(null);
          runBatch(kind, list);
        }}
      />

      {bulkOn && (
        <BulkActionBar
          count={selectedRows.length}
          progress={progress}
          onClear={clearSelection}
          actions={[
            isAdmin && bulk.sheet && { key: "shift", label: "Apply shift", icon: Clock, tone: "amber", count: eligible("shift").length, title: "needs an unlocked entry saved on a different shift from its process's current one, whose machine run fits in it", onClick: () => askOrRun("shift") },
            isAdmin && bulk.unlock && { key: "unlock", label: "Unlock", icon: LockOpen, tone: "blue", count: eligible("unlock").length, title: "needs a locked entry", onClick: () => askOrRun("unlock") },
            canDelete && bulk.remove && { key: "delete", label: "Delete", icon: Trash2, tone: "rose", count: eligible("delete").length, title: "needs an unlocked entry", onClick: () => askOrRun("delete") },
          ].filter(Boolean)}
        />
      )}

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
