import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { Col, Input, Row, Spinner } from "reactstrap";
import { getAuditLogs } from "../../api/oeeReview.api";
import { fmtNum } from "../../utils/productionSheet";
import { AUDIT_ACTIONS, ActionBadge, MetricsLine, flaggedText, fmtDateTime } from "./reviewShared";

/**
 * Components/OeeReview/AuditLogTab.jsx
 * ──────────────────────────────────────
 * The audit log (server models/AuditLog.js), newest first, 50 to a page:
 * every create / edit / delete of an entry with each changed field's old →
 * new value, every time an entry went over 100% (or came back under), every
 * review decision, every unlock and every process setting change. Filtered
 * by kind of action on the server and by label / user on the page shown.
 */

const PAGE = 50;

const show = (v) => (v === null || v === undefined || v === "" ? "—" : typeof v === "number" ? fmtNum(v) : String(v));

// How many changed fields a row shows before folding the rest behind
// "Show all" — a create or delete lists every field of the entry.
const FOLD_AT = 8;

const ChangeList = ({ changes, whole }) => {
  const [open, setOpen] = useState(false);
  const list = open || changes.length <= FOLD_AT ? changes : changes.slice(0, FOLD_AT);
  return (
    <>
      {/* A label / value grid: the label takes ~40% on a phone and a quarter
          on a desktop, so values line up without drifting far from their labels. */}
      <Row className="g-0 row-gap-1 mt-2 small">
        {list.map((c, i) => (
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

// What each kind of row has to say below its header line.
const Detail = ({ log }) => {
  const changes = log.changes || [];
  switch (log.action) {
    case "create":
    case "update":
    case "delete":
    case "setting": {
      // A create / delete lists the whole record, so there is no "before" or "after" to arrow between.
      const whole = log.action === "create" ? "to" : log.action === "delete" ? "from" : null;
      return (
        <>
          {changes.length > 0 ? <ChangeList changes={changes} whole={whole} /> : null}
          {log.action === "setting" && log.remark && <div className="small mt-1 text-break">{log.remark}</div>}
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
      // cleared / unlocked — the reason, in the server's own words.
      return log.remark ? <div className="small mt-2 text-break">{log.remark}</div> : null;
  }
};

const LogRow = ({ log }) => (
  <div className="border rounded-3 p-3 mb-2">
    <div className="d-flex flex-wrap align-items-center gap-2">
      <ActionBadge action={log.action} />
      <span className="fw-semibold text-break">{log.label || "—"}</span>
      <span className="ms-auto text-muted small text-nowrap">{fmtDateTime(log.createdAt)}</span>
    </div>
    <div className="text-muted small mt-1">
      by {log.actor?.name || "unknown user"}
      {log.actor?.role ? ` · ${log.actor.role}` : ""}
    </div>
    <Detail log={log} />
    <MetricsLine metrics={log.metrics} className="mt-2" />
  </div>
);

const AuditLogTab = () => {
  const [action, setAction] = useState("");
  const [text, setText] = useState("");
  const [page, setPage] = useState(0);
  const [state, setState] = useState({ logs: [], total: 0, loading: true, error: "" });
  // Only the newest request may fill the list.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const res = await getAuditLogs({ action: action || undefined, skip: page * PAGE, limit: PAGE });
      if (request !== latest.current) return;
      const rows = res?.data?.data || [];
      setState({ logs: rows, total: res?.data?.total ?? rows.length, loading: false, error: "" });
    } catch (err) {
      if (request !== latest.current) return;
      setState((s) => ({ ...s, loading: false, error: err?.response?.data?.message || "Failed to load the audit log. Please try again." }));
    }
  }, [action, page]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return state.logs;
    return state.logs.filter((l) => [l.label, l.actor?.name, l.actor?.role].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [state.logs, text]);

  const { logs, total, loading, error } = state;
  const totalPages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <>
      {/* The filter box drops onto its own line when it can't sit beside the
          action picker with room to type (a tablet with the sidebar open). */}
      <div className="d-flex flex-column flex-md-row flex-md-wrap align-items-md-center gap-2">
        <Input
          type="select"
          bsSize="sm"
          value={action}
          onChange={(e) => {
            setPage(0);
            setAction(e.target.value);
          }}
          aria-label="Kind of action"
          className="flex-shrink-0"
          // Full width on a phone (the column layout stretches it), sized to
          // its options beside the search box from md up.
          style={{ width: "auto" }}
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </Input>
        <div className="d-flex align-items-center gap-2 flex-grow-1 justify-content-md-end" style={{ minWidth: 280 }}>
          <div className="position-relative flex-grow-1" style={{ maxWidth: 340 }}>
            <Search size={14} className="position-absolute text-muted" style={{ left: 10, top: 9, pointerEvents: "none" }} />
            <Input
              type="search"
              bsSize="sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Filter by entry or user…"
              aria-label="Filter this page by entry label or user"
              style={{ paddingLeft: 30 }}
            />
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center flex-shrink-0"
            onClick={load}
            disabled={loading}
            title="Reload the log"
            aria-label="Reload the log"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="small text-muted mt-2 mb-3" style={{ minHeight: "1.25rem" }}>
        {loading
          ? ""
          : text.trim()
            ? `${filtered.length} of ${logs.length} on this page match`
            : `${total} ${total === 1 ? "record" : "records"}${total > PAGE ? ` · page ${page + 1} of ${totalPages}` : ""}`}
      </div>

      {error && (
        <div className="alert alert-danger d-flex flex-wrap align-items-center justify-content-between gap-2" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-5">
          <Spinner size="sm" /> <span className="text-muted small ms-2">Loading…</span>
        </div>
      ) : !error && filtered.length === 0 ? (
        <div className="text-center text-muted py-5">
          {text.trim() ? `Nothing on this page matches “${text.trim()}”.` : "Nothing recorded yet. Changes made from now on are listed here."}
        </div>
      ) : !error ? (
        filtered.map((log) => <LogRow key={log._id} log={log} />)
      ) : null}

      {!loading && !error && total > PAGE && (
        <div className="d-flex align-items-center justify-content-between gap-2 pt-3 border-top">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
            disabled={page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span className="text-muted small text-center">
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}
    </>
  );
};

export default AuditLogTab;
