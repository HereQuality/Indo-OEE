import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ExternalLink, History } from "lucide-react";
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from "reactstrap";
import { getAuditTrail } from "../../api/auditTrail.api";
import AuditLogList, { Pager } from "./AuditLogList";
import { toRolePath } from "../../utils/roleUrl";

/**
 * Components/AuditTrail/RecordHistoryModal.jsx
 * ─────────────────────────────────────────────
 * One record's history — every change made to it, newest first — opened from
 * a sheet row's "History" button or a Not-running mark's. Same rows as the
 * Audit Trail page (AuditLogList), a few to a page.
 *
 * props: { isOpen, onClose, title, query }
 *   query = { entity } for a saved entry / master record,
 *           { sheet, date, machine } for a Not-running mark (machine "" on a worker sheet).
 */

const PAGE = 10;
export const AUDIT_TRAIL_PATH = "/hqepl/production/audit-trail";

// The ?query the Audit Trail page reads to show the same record (utils/auditTrail.js isRecordQuery).
export const recordSearch = (query = {}) => {
  const p = new URLSearchParams();
  if (query.entity) p.set("entity", query.entity);
  else {
    if (query.sheet) p.set("sheet", query.sheet);
    if (query.date) p.set("date", query.date);
    if (query.machine) p.set("machine", query.machine);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
};

export default function RecordHistoryModal({ isOpen, onClose, title, query }) {
  const { roleSlug } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [state, setState] = useState({ logs: [], total: 0, loading: true, error: "" });
  const latest = useRef(0);

  const key = JSON.stringify(query || {});
  useEffect(() => {
    setPage(0);
  }, [key]);
  // Closed: forget the rows, so reopening for another record starts from "Loading…".
  useEffect(() => {
    if (!isOpen) setState({ logs: [], total: 0, loading: true, error: "" });
  }, [isOpen]);

  const load = useCallback(async () => {
    if (!isOpen || !query) return;
    const request = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const res = await getAuditTrail(query, { skip: page * PAGE, limit: PAGE });
      if (request !== latest.current) return;
      const rows = res?.data?.data || [];
      setState({ logs: rows, total: res?.data?.total ?? rows.length, loading: false, error: "" });
    } catch (err) {
      if (request !== latest.current) return;
      setState((s) => ({ ...s, loading: false, error: err?.response?.data?.message || "Couldn't load the history. Please try again." }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, key, page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(state.total / PAGE));
  const openInTrail = () => {
    onClose?.();
    navigate(`${toRolePath(AUDIT_TRAIL_PATH, roleSlug || "hqepl")}${recordSearch(query)}`);
  };

  return (
    <Modal isOpen={!!isOpen} toggle={onClose} centered scrollable size="lg">
      <ModalHeader toggle={onClose} className="align-items-start">
        <span className="d-inline-flex align-items-center gap-2">
          <History size={18} className="text-muted flex-shrink-0" />
          <span>
            History
            {title ? <span className="text-muted fw-normal fs-6"> · {title}</span> : null}
          </span>
        </span>
      </ModalHeader>
      <ModalBody>
        {!state.loading && !state.error && state.total > 0 && (
          <div className="small text-muted mb-2">
            {state.total} {state.total === 1 ? "change" : "changes"}
            {state.total > PAGE ? ` · page ${page + 1} of ${totalPages}` : ""} · Times are IST.
          </div>
        )}
        <AuditLogList
          logs={state.logs}
          loading={state.loading}
          error={state.error}
          onRetry={load}
          emptyText="No changes recorded for this record yet. Changes made from now on are listed here."
        />
        {!state.loading && !state.error && <Pager page={page} totalPages={totalPages} onChange={setPage} className="pt-2" />}
      </ModalBody>
      <ModalFooter className="flex-wrap gap-2 justify-content-between">
        <Button type="button" color="link" className="d-inline-flex align-items-center gap-1 px-0 text-decoration-none" onClick={openInTrail}>
          <ExternalLink size={14} /> Open in Audit Trail
        </Button>
        <Button type="button" color="light" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}
