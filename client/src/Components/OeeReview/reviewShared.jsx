import React, { useLayoutEffect, useState } from "react";
import dayjs from "dayjs";
import { displayDay, fmtPct } from "../../utils/productionSheet";

/**
 * Components/OeeReview/reviewShared.jsx
 * ───────────────────────────────────────
 * What the OEE Review page's tabs and modal share: the metric / sheet /
 * action vocabularies (kept in step with server/utils/entryAudit.js and
 * models/AuditLog.js), the small badges, and the formatting helpers.
 */

export const METRIC_LABELS = {
  availability: "Availability",
  performance: "Performance",
  quality: "Quality",
  oeeLosses: "OEE considering losses",
  oeeLunch: "OEE not considering losses but lunch",
  oeeLunchCot: "OEE not considering losses but lunch & setup time",
  productivity: "Productivity without considering Lunch, Tea, etc.",
  productivityLunch: "Productivity considering Lunch, Tea, etc.",
};
export const METRIC_KEYS = ["availability", "performance", "quality"];
// The OEE figures an entry also is held for (the day's: a machine sheet's three,
// BEFORE POWDER COATING's two, a worker sheet's two Productivity figures).
export const OEE_KEYS = ["oeeLosses", "oeeLunch", "oeeLunchCot", "productivity", "productivityLunch"];
// The ones this row / audit entry actually carries.
export const oeeKeysOf = (metrics) => OEE_KEYS.filter((k) => metrics && metrics[k] !== null && metrics[k] !== undefined && Number.isFinite(metrics[k]));

// Where each sheet's entries are edited — stored like a menu URL ("/hqepl/…"),
// so toRolePath() swaps the leading slug for whichever role is browsing.
export const SHEET_PATHS = {
  cnc: "/hqepl/production/cnc-data-entry",
  vmc: "/hqepl/production/vmc-data-entry",
  spm: "/hqepl/production/spm-data-entry",
  rivet: "/hqepl/production/rivet-data-entry",
  press: "/hqepl/production/press-data-entry",
  contact: "/hqepl/production/contact-data-entry",
  trobe: "/hqepl/production/trobe-data-entry",
  spring: "/hqepl/production/spring-data-entry",
  powder: "/hqepl/production/powder-coating-data-entry",
  rubber: "/hqepl/production/rubber-data-entry",
  injection: "/hqepl/production/injection-moulding-data-entry",
  embossing: "/hqepl/production/embossing-data-entry",
  bpc: "/hqepl/production/before-powder-coating-data-entry",
  finalAssembly: "/hqepl/production/final-assembly-data-entry",
  printing: "/hqepl/production/printing-data-entry",
  rawCasting: "/hqepl/production/raw-casting-data-entry",
  mfd: "/hqepl/production/modular-frame-drilling-data-entry",
  mfa: "/hqepl/production/modular-frame-assembly-data-entry",
};

// RUBBER and After Powder Coating have no machines: their entries are made
// per worker, and the review row carries the worker where the others carry
// the machine (server keyOf — entry.machine ?? entry.worker).
const WORKER_SHEETS = new Set(["rubber", "powder"]);
// BEFORE POWDER COATING is kept per operator too.
WORKER_SHEETS.add("bpc");
// FINAL ASSEMBLY is kept per worker too.
WORKER_SHEETS.add("finalAssembly");
// PRINTING is kept per operator too (its MC No. is optional, never the row key).
WORKER_SHEETS.add("printing");
// RAW CASTING is kept per worker (AFTER POWDER COATING's template).
WORKER_SHEETS.add("rawCasting");
// MODULAR FRAME ASSEMBLY is kept per worker (RAW CASTING's template).
WORKER_SHEETS.add("mfa");
export const isWorkerSheet = (sheet) => WORKER_SHEETS.has(sheet);

export const REVIEW_STYLE = {
  pending: { label: "Pending", badge: "bg-warning-subtle text-warning-emphasis" },
  approved: { label: "Approved", badge: "bg-success-subtle text-success-emphasis" },
  rejected: { label: "Rejected", badge: "bg-danger-subtle text-danger-emphasis" },
};

// Every kind of audit row, in the order the filter offers them.
export const AUDIT_ACTIONS = [
  { key: "create", label: "Created", badge: "bg-success-subtle text-success-emphasis" },
  { key: "update", label: "Updated", badge: "bg-primary-subtle text-primary-emphasis" },
  { key: "delete", label: "Deleted", badge: "bg-danger-subtle text-danger-emphasis" },
  { key: "flagged", label: "Flagged", badge: "bg-warning-subtle text-warning-emphasis" },
  { key: "cleared", label: "Cleared", badge: "bg-info-subtle text-info-emphasis" },
  { key: "approved", label: "Approved", badge: "bg-success-subtle text-success-emphasis" },
  { key: "rejected", label: "Rejected", badge: "bg-danger-subtle text-danger-emphasis" },
  { key: "unlocked", label: "Unlocked", badge: "bg-secondary-subtle text-secondary-emphasis" },
  { key: "setting", label: "Setting changed", badge: "bg-dark-subtle text-body-emphasis" },
];
const ACTION_BY_KEY = Object.fromEntries(AUDIT_ACTIONS.map((a) => [a.key, a]));

export const isOver = (v) => Number.isFinite(v) && v > 1 + 1e-9;
const hasValue = (v) => v !== null && v !== undefined && Number.isFinite(v);

// "Performance 102.1%, Quality 101.0%" — the same one-decimal wording the
// server puts in notifications and the flagged audit rows.
export const flaggedText = (flagged = []) =>
  (flagged || []).map((f) => `${METRIC_LABELS[f.metric] || f.metric} ${(f.value * 100).toFixed(1)}%`).join(", ");

// "CNC · 7A · 13/10/2026 · Entry 1" — how a review row names its entry.
export const entryTitle = (row) =>
  [row.sheetLabel || String(row.sheet || "").toUpperCase(), row.machineName, row.date ? displayDay(row.date) : "", row.slot ? `Entry ${row.slot}` : ""]
    .filter(Boolean)
    .join(" · ");

export const fmtDateTime = (iso) => (iso ? dayjs(iso).format("D MMM YYYY, HH:mm") : "—");

// A metric as a percentage — in red and bold when it's over 100%, since
// that's exactly what the entry is being reviewed for. Never capped.
export const MetricValue = ({ value, className = "" }) => {
  if (!hasValue(value)) return <span className={`text-muted ${className}`}>—</span>;
  return <span className={`${isOver(value) ? "pct-over fw-bold" : "fw-semibold"} ${className}`}>{fmtPct(value)}</span>;
};

export const StatusBadge = ({ status }) => {
  const style = REVIEW_STYLE[status] || { label: status || "—", badge: "bg-secondary-subtle text-secondary-emphasis" };
  return <span className={`badge rounded-pill ${style.badge}`}>{style.label}</span>;
};

export const ActionBadge = ({ action }) => {
  const style = ACTION_BY_KEY[action] || { label: action || "—", badge: "bg-secondary-subtle text-secondary-emphasis" };
  return <span className={`badge rounded-pill ${style.badge}`}>{style.label}</span>;
};

// "Availability 86.96% · Performance 102.10% · Quality 100.00%", or null when
// a row carries no figures at all (a process setting change, say).
export const MetricsLine = ({ metrics, className = "" }) => {
  if (!metrics || !METRIC_KEYS.some((k) => hasValue(metrics[k]))) return null;
  return (
    <div className={`d-flex flex-wrap column-gap-3 row-gap-1 small ${className}`}>
      {[...METRIC_KEYS, ...oeeKeysOf(metrics)].map((k) => (
        <span key={k} className="text-nowrap">
          <span className="text-muted">{METRIC_LABELS[k]}</span> <MetricValue value={metrics[k]} />
        </span>
      ))}
    </div>
  );
};

// The live width of the element `ref` points at — so the review list can be
// a table only when the space it actually has (which depends on the sidebar
// being open or collapsed, not just the screen) fits every column, and
// stacked cards otherwise, without keeping both in the DOM at once. Measured
// before paint, so a wide screen never flashes cards first.
export const useElementWidth = (ref) => {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
};
