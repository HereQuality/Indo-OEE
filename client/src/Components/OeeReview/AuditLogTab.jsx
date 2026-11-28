import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { Input, Spinner } from "reactstrap";
import { getAuditLogs } from "../../api/oeeReview.api";
import { LogRow } from "../AuditTrail/AuditLogList";
import { AUDIT_ACTIONS } from "./reviewShared";

/**
 * Components/OeeReview/AuditLogTab.jsx
 * ──────────────────────────────────────
 * The audit log (server models/AuditLog.js), newest first, 50 to a page:
 * every create / edit / delete of an entry with each changed field's old →
 * new value, every time an entry went over 100% (or came back under), every
 * review decision, every unlock and every process setting change. Filtered
 * by kind of action on the server and by label / user on the page shown.
 * Rows are drawn by Components/AuditTrail/AuditLogList.jsx — the same
 * component the Logs page and the per-record History modal use.
 */

const PAGE = 50;

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
          {text.trim()
            ? `Nothing on this page matches “${text.trim()}”.`
            : action
              ? `Nothing matches the “${AUDIT_ACTIONS.find((a) => a.key === action)?.label || action}” filter.`
              : "Nothing recorded yet. Changes made from now on are listed here."}
        </div>
      ) : !error ? (
        filtered.map((log) => <LogRow key={log._id} log={log} showModule={false} />)
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
