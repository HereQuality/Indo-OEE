import React, { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import dayjs from "dayjs";
import { Modal, ModalBody, ModalHeader, Spinner } from "reactstrap";
import { getItemLogs } from "../../api/items.api";
import { fmtNum } from "../../utils/productionSheet";

/**
 * components/Production/ItemHistoryModal.jsx
 * ────────────────────────────────────────────
 * The Part Master's edit history (server models/ItemLog.js): who changed a part,
 * when, and from what to what — newest first. Given a part it lists that part's
 * history; given none (item = null) every part's, which is also the only place a
 * deleted part's history can still be read.
 */

const PAGE = 25;

// How each kind of row is named and coloured.
const ACTIONS = {
  create: { label: "Created", badge: "bg-success-subtle text-success" },
  update: { label: "Updated", badge: "bg-primary-subtle text-primary" },
  deactivate: { label: "Deactivated", badge: "bg-warning-subtle text-warning" },
  restore: { label: "Reactivated", badge: "bg-info-subtle text-info" },
  delete: { label: "Deleted", badge: "bg-danger-subtle text-danger" },
};

const show = (v) => (v === null || v === undefined || v === "" ? "—" : typeof v === "number" ? fmtNum(v) : String(v));

// "Flange VF-24 · DRG-V224 · S-22" — a part is told apart by its name, drawing and setup.
const partTitle = (p) => [p.itemName, p.drawingNo, p.setupNo].filter(Boolean).join(" · ");

const LogEntry = ({ log, showPart }) => {
  const action = ACTIONS[log.action] || { label: log.action, badge: "bg-secondary-subtle text-secondary" };
  // A create / delete lists the whole record, so there is no "before" or "after" to arrow between.
  const whole = log.action === "create" ? "to" : log.action === "delete" ? "from" : null;

  return (
    <div className="border rounded p-3 mb-3">
      <div className="d-flex flex-wrap align-items-center gap-2">
        <span className={`badge ${action.badge}`}>{action.label}</span>
        {showPart && <span className="fw-semibold">{partTitle(log) || "—"}</span>}
        <span className="ms-auto text-muted small">{dayjs(log.createdAt).format("D MMM YYYY, h:mm A")}</span>
      </div>
      <div className="text-muted small mt-1">by {log.actor?.name || "unknown user"}</div>
      {log.changes?.length > 0 && (
        <table className="table table-sm table-borderless align-middle mb-0 mt-2">
          <tbody>
            {log.changes.map((c) => (
              <tr key={c.field}>
                <td className="text-muted" style={{ width: "40%" }}>
                  {c.label}
                </td>
                <td>
                  {whole ? (
                    show(c[whole])
                  ) : (
                    // A flex row: the icon is a block element under the app's base styles, so it
                    // would otherwise put the old and new values on separate lines.
                    <div className="d-flex align-items-center flex-wrap gap-2">
                      <span className="text-muted">{show(c.from)}</span>
                      <ArrowRight size={14} className="text-muted flex-shrink-0" />
                      <span className="fw-semibold">{show(c.to)}</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const ItemHistoryModal = ({ isOpen, toggle, item = null }) => {
  const itemId = item?._id;
  const [state, setState] = useState({ logs: [], total: 0, loading: false, error: "" });
  // Only the newest request may fill the list — close and reopen on another part quickly and
  // the first one's answer must not land in the second's.
  const latest = useRef(0);

  const load = (skip) => {
    const request = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    getItemLogs(itemId, { skip, limit: PAGE })
      .then((res) => {
        if (request !== latest.current) return;
        const rows = res.data?.data || [];
        setState((s) => ({ logs: skip ? [...s.logs, ...rows] : rows, total: res.data?.total ?? rows.length, loading: false, error: "" }));
      })
      .catch((err) => {
        if (request !== latest.current) return;
        setState((s) => ({ ...s, loading: false, error: err?.response?.data?.message || "Failed to load history. Please try again." }));
      });
  };

  useEffect(() => {
    if (!isOpen) return;
    setState({ logs: [], total: 0, loading: false, error: "" });
    load(0);
  }, [isOpen, itemId]);

  const { logs, total, loading, error } = state;

  return (
    <Modal isOpen={isOpen} toggle={toggle} centered scrollable size="lg">
      <ModalHeader className="p-3 border-bottom" toggle={toggle}>
        {item ? `History · ${item.itemName}` : "History · all parts"}
      </ModalHeader>
      <ModalBody>
        {item && partTitle(item) !== item.itemName && <div className="text-muted small mb-3">{partTitle(item)}</div>}

        {error && (
          <div className="alert alert-danger d-flex align-items-center justify-content-between" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => load(logs.length)}>
              Try again
            </button>
          </div>
        )}

        {!loading && !error && logs.length === 0 && (
          <div className="text-center text-muted py-4">Nothing recorded yet. Changes made from now on are listed here.</div>
        )}

        {logs.map((log) => (
          <LogEntry key={log._id} log={log} showPart={!item} />
        ))}

        {loading && (
          <div className="text-center py-3">
            <Spinner size="sm" />
          </div>
        )}

        {!loading && !error && logs.length < total && (
          <div className="text-center">
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => load(logs.length)}>
              Show older ({total - logs.length} more)
            </button>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
};

export default ItemHistoryModal;
