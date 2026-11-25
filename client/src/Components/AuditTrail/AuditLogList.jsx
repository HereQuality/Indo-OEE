import React, { useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Col, Row, Spinner } from "reactstrap";
import { fmtNum } from "../../utils/productionSheet";
import { MetricsLine, flaggedText, fmtDateTime } from "../OeeReview/reviewShared";
import { actionLabel, badgeClass, badgeStyle, wholeSideOf } from "../../utils/auditTrail";

/**
 * Components/AuditTrail/AuditLogList.jsx
 * ───────────────────────────────────────
 * How one audit row (server models/AuditLog.js) is drawn — shared by the Audit
 * Trail page, the per-record History modal and the OEE Review audit tab, so
 * the same change reads the same everywhere:
 *
 *   [Created] [Machine Master] 7A                      25 Nov 2026, 14:03
 *   by Mann · Admin · Web
 *   Field            old → new
 *   …
 *
 * A create / delete lists the whole record (folded after 8 fields); a
 * Not-running mark lists its reasons and remarks; a sign-in row its remark.
 */

const show = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return fmtNum(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.map(show).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

// How many changed fields a row shows before folding the rest behind "Show all".
export const FOLD_AT = 8;

export const ActionBadge = ({ action }) => (
  <span className={`badge rounded-pill ${badgeClass(action)}`} style={badgeStyle(action)}>
    {actionLabel(action)}
  </span>
);

// The module a row belongs to ("Machine Master", "CNC data entry") — a small outline chip.
export const ModuleChip = ({ module }) =>
  module ? <span className="badge rounded-pill border text-body-secondary bg-transparent fw-normal">{module}</span> : null;

export const ChangeList = ({ changes, whole }) => {
  const [open, setOpen] = useState(false);
  const rows = open || changes.length <= FOLD_AT ? changes : changes.slice(0, FOLD_AT);
  return (
    <>
      {/* A label / value grid: the label takes ~40% on a phone and a quarter
          on a desktop, so values line up without drifting far from their labels. */}
      <Row className="g-0 row-gap-1 mt-2 small">
        {rows.map((c, i) => (
          <React.Fragment key={`${c.field || c.label}-${i}`}>
            <Col xs={5} sm={4} lg={3} className="text-muted pe-2">
              {c.label || c.field}
            </Col>
            <Col xs={7} sm={8} lg={9} className="text-break">
              {whole ? (
                show(c[whole])
              ) : (
                // A flex row: the icon is a block element under the app's base styles,
                // so it would otherwise put the old and new values on separate lines.
                <div className="d-flex align-items-center flex-wrap gap-2">
                  <span className="text-muted">{show(c.from)}</span>
                  <ArrowRight size={14} className="text-muted flex-shrink-0" />
                  <span className="fw-semibold">{show(c.to)}</span>
                </div>
              )}
            </Col>
          </React.Fragment>
        ))}
      </Row>
      {changes.length > FOLD_AT && (
        <button type="button" className="btn btn-link btn-sm p-0 small" onClick={() => setOpen((o) => !o)}>
          {open ? "Show fewer" : `Show all ${changes.length} fields`}
        </button>
      )}
    </>
  );
};

const Remark = ({ text }) => (text ? <div className="small mt-2 text-break">{text}</div> : null);

// A Not-running mark's changes are the whole mark when it was first made
// (no "from" side), old → new when its reason or remarks were edited.
const sideOnly = (changes, side) => changes.length > 0 && changes.every((c) => c[side] === undefined || c[side] === null || c[side] === "");

// What each kind of row has to say below its header line.
export const Detail = ({ log }) => {
  const changes = log.changes || [];
  switch (log.action) {
    case "create":
    case "update":
    case "delete":
    case "setting":
    case "import": {
      const whole = wholeSideOf(log.action);
      return (
        <>
          {changes.length > 0 ? <ChangeList changes={changes} whole={whole} /> : null}
          {(log.action === "setting" || log.action === "import" || changes.length === 0) && <Remark text={log.remark} />}
        </>
      );
    }
    case "marked":
    case "unmarked": {
      const whole = log.action === "unmarked" ? "from" : sideOnly(changes, "from") ? "to" : null;
      return (
        <>
          {changes.length > 0 ? <ChangeList changes={changes} whole={whole} /> : null}
          <Remark text={log.remark} />
        </>
      );
    }
    case "flagged":
    case "approved":
    case "rejected": {
      const over = flaggedText(log.flagged);
      // A flagged row's remark is the same "Over 100%: …" text — no point showing it twice.
      const remark = log.remark && log.remark !== `Over 100%: ${over}` ? log.remark : "";
      return (
        <div className="small mt-2">
          {over && (
            <div>
              <span className="text-muted">Over 100%:</span> <span className="text-danger fw-semibold">{over}</span>
            </div>
          )}
          {remark && (
            <div className="text-break">
              <span className="text-muted">Remark:</span> {remark}
            </div>
          )}
        </div>
      );
    }
    default:
      // cleared / unlocked / sign-ins / blocked … — the reason, in the server's own words.
      return <Remark text={log.remark} />;
  }
};

const clientLabel = (client) => (client === "web" ? "Web" : client === "app" ? "App" : "");

export const LogRow = ({ log, showModule = true }) => {
  const by = [log.actor?.name || "unknown user", log.actor?.role, showModule ? clientLabel(log.client) : ""].filter(Boolean).join(" · ");
  return (
    <div className="border rounded-3 p-3 mb-2 bg-body">
      <div className="d-flex flex-wrap align-items-center gap-2">
        <ActionBadge action={log.action} />
        {showModule && <ModuleChip module={log.module} />}
        <span className="fw-semibold text-break">{log.label || "—"}</span>
        <span className="ms-auto text-muted small text-nowrap">{fmtDateTime(log.createdAt)}</span>
      </div>
      <div className="text-muted small mt-1">by {by}</div>
      <Detail log={log} />
      <MetricsLine metrics={log.metrics} className="mt-2" />
    </div>
  );
};

// Prev / Next with the page count between them.
export const Pager = ({ page, totalPages, onChange, className = "" }) =>
  totalPages > 1 ? (
    <div className={`d-flex align-items-center justify-content-between gap-2 ${className}`}>
      <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" disabled={page <= 0} onClick={() => onChange(Math.max(0, page - 1))}>
        <ChevronLeft size={14} /> Prev
      </button>
      <span className="text-muted small text-center">
        Page {page + 1} of {totalPages}
      </span>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
        disabled={page >= totalPages - 1}
        onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
      >
        Next <ChevronRight size={14} />
      </button>
    </div>
  ) : null;

/**
 * The list itself with its loading / error / empty states.
 * logs, loading, error, onRetry, emptyText, showModule.
 */
const AuditLogList = ({ logs = [], loading = false, error = "", onRetry, emptyText = "Nothing recorded yet.", showModule = true }) => {
  if (error) {
    return (
      <div className="alert alert-danger d-flex flex-wrap align-items-center justify-content-between gap-2" role="alert">
        <span>{error}</span>
        {onRetry && (
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner size="sm" /> <span className="text-muted small ms-2">Loading…</span>
      </div>
    );
  }
  if (!logs.length) return <div className="text-center text-muted py-5 px-3">{emptyText}</div>;
  return logs.map((log) => <LogRow key={log._id} log={log} showModule={showModule} />);
};

export default AuditLogList;
