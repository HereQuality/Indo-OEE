import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, ExternalLink, RefreshCw, Search, X } from "lucide-react";
import { Col, Input, Row, Spinner } from "reactstrap";
import { getReviews } from "../../api/oeeReview.api";
import { displayDay } from "../../utils/productionSheet";
import { toRolePath } from "../../utils/roleUrl";
import DecisionModal from "./DecisionModal";
import { METRIC_KEYS, METRIC_LABELS, MetricValue, REVIEW_STYLE, SHEET_PATHS, StatusBadge, flaggedText, fmtDateTime, isWorkerSheet, useElementWidth } from "./reviewShared";

/**
 * Components/OeeReview/ReviewsTab.jsx
 * ─────────────────────────────────────
 * The review desk: every entry whose Availability, Performance or Quality
 * went above 100%, by status (Pending first — the ones waiting on a
 * decision), with a text search over machine (or worker) / operator / part /
 * drawing no. A pending row is approved or rejected through DecisionModal; every
 * row links to its sheet's data entry page.
 *
 * Given enough room (a desktop with the sidebar open, or a laptop with it
 * collapsed) the list is one row per entry in a table; anything narrower —
 * phones, tablets, small laptops — gets the same rows as stacked cards,
 * which read far better than a ten-column table in a horizontal scroller
 * that hides the Approve / Reject buttons off to the right.
 */

// The table's columns at their minimum widths add up to a little over
// 1000px; below this the cards take over.
const TABLE_MIN_WIDTH = 1060;

const STATUS_TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

const EMPTY_TEXT = {
  pending: "Nothing to review — no entry is waiting for a decision.",
  approved: "No approved entries yet.",
  rejected: "No rejected entries yet.",
  all: "No entry has gone over 100% yet.",
};

const dash = (v) => (v === "" || v === null || v === undefined ? "—" : v);
const sheetName = (row) => row.sheetLabel || String(row.sheet || "").toUpperCase();

// "Approved by Dhruv Patel (Super Admin) · 13 Oct 2026, 3:12 PM" and the
// remark — only once a decision has been made.
const DecidedInfo = ({ review, className = "" }) => {
  if (!review || review.status === "pending") return null;
  const by = review.decidedBy?.name || "—";
  const role = review.decidedBy?.role ? ` (${review.decidedBy.role})` : "";
  return (
    <div className={`small ${className}`}>
      <div className="text-muted">
        {REVIEW_STYLE[review.status]?.label || review.status} by {by}
        {role} · {fmtDateTime(review.decidedAt)}
      </div>
      {review.remark && (
        <div className="text-break">
          <span className="text-muted">Remark:</span> {review.remark}
        </div>
      )}
    </div>
  );
};

// "⚠ Performance 102.1%" — what put the entry up for review.
const FlaggedLine = ({ flagged, className = "", withLabel = false }) => (
  <div className={`small d-flex align-items-start gap-1 ${className}`}>
    <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-1" />
    <span>
      {withLabel && <span className="text-muted">Flagged: </span>}
      {flaggedText(flagged) || "—"}
    </span>
  </div>
);

const DecideButtons = ({ row, onDecide }) =>
  row.review?.status === "pending" ? (
    <>
      <button
        type="button"
        className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1 text-nowrap"
        onClick={() => onDecide(row, "approved")}
      >
        <Check size={14} /> Approve
      </button>
      <button
        type="button"
        className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1 text-nowrap"
        onClick={() => onDecide(row, "rejected")}
      >
        <X size={14} /> Reject
      </button>
    </>
  ) : null;

const OpenSheetLink = ({ row, roleSlug }) => (
  <Link
    to={toRolePath(SHEET_PATHS[row.sheet] || SHEET_PATHS.cnc, roleSlug)}
    className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1 text-nowrap"
    title={`Open the ${sheetName(row)} data entry page`}
  >
    Open sheet <ExternalLink size={13} />
  </Link>
);

const ReviewTable = ({ rows, roleSlug, onDecide }) => (
  <div className="table-responsive">
    <table className="table table-sm table-hover align-middle mb-0 small">
      <thead className="text-muted">
        <tr>
          <th scope="col">Sheet</th>
          <th scope="col">Date</th>
          {/* RUBBER / After Powder Coating rows name a worker here. */}
          <th scope="col">Machine / Worker</th>
          <th scope="col">Operator</th>
          <th scope="col">Part</th>
          <th scope="col" className="text-end">Availability</th>
          <th scope="col" className="text-end">Performance</th>
          <th scope="col" className="text-end">Quality</th>
          <th scope="col">Status</th>
          <th scope="col" className="text-end">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.sheet}-${row._id}`}>
            <td>
              <span className="badge rounded-pill bg-body-secondary text-body border">{sheetName(row)}</span>
            </td>
            <td className="text-nowrap">
              <div>{displayDay(row.date)}</div>
              <div className="text-muted">Entry {dash(row.slot)}</div>
            </td>
            <td>
              <div className="fw-semibold text-nowrap">{dash(row.machineName)}</div>
              {(isWorkerSheet(row.sheet) || row.processName) && (
                <div className="text-muted">{[isWorkerSheet(row.sheet) && "Worker", row.processName].filter(Boolean).join(" · ")}</div>
              )}
            </td>
            <td style={{ minWidth: 90 }}>{dash(row.operator)}</td>
            <td style={{ minWidth: 135 }}>
              <div>{dash(row.itemName)}</div>
              {row.drawingNo && <div className="text-muted">{row.drawingNo}</div>}
            </td>
            {METRIC_KEYS.map((k) => (
              <td key={k} className="text-end text-nowrap">
                <MetricValue value={row.oee?.[k]} />
              </td>
            ))}
            <td style={{ minWidth: 180 }}>
              <StatusBadge status={row.review?.status} />
              <FlaggedLine flagged={row.review?.flagged} className="mt-1" />
              <DecidedInfo review={row.review} className="mt-1" />
            </td>
            <td className="text-end">
              <div className="d-flex flex-column align-items-end gap-1">
                {row.review?.status === "pending" && (
                  <div className="d-flex gap-1">
                    <DecideButtons row={row} onDecide={onDecide} />
                  </div>
                )}
                <OpenSheetLink row={row} roleSlug={roleSlug} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ReviewCards = ({ rows, roleSlug, onDecide }) => (
  <Row className="g-2 g-md-3">
    {rows.map((row) => (
      <Col xs={12} md={6} key={`${row.sheet}-${row._id}`}>
        <div className="border rounded-3 p-3 h-100 d-flex flex-column">
          <div className="d-flex align-items-start justify-content-between gap-2">
            <div style={{ minWidth: 0 }}>
              <div className="fw-semibold">
                {sheetName(row)} · <span className="text-nowrap">{dash(row.machineName)}</span>
                {isWorkerSheet(row.sheet) && <span className="text-muted fw-normal small"> (worker)</span>}
              </div>
              <div className="text-muted small">
                {displayDay(row.date)} · Entry {dash(row.slot)}
                {row.processName ? ` · ${row.processName}` : ""}
              </div>
            </div>
            <StatusBadge status={row.review?.status} />
          </div>

          <div className="small mt-2">
            <div>
              <span className="text-muted">Operator:</span> {dash(row.operator)}
            </div>
            <div className="text-break">
              <span className="text-muted">Part:</span> {dash(row.itemName)}
              {row.drawingNo ? ` · ${row.drawingNo}` : ""}
            </div>
          </div>

          {/* One figure per line — three side-by-side tiles break words apart
              on a phone, and a two-up card grid on a tablet is no wider. */}
          <div className="border rounded-3 bg-body-tertiary px-3 py-1 mt-2 small">
            {METRIC_KEYS.map((k, i) => (
              <div key={k} className={`d-flex justify-content-between align-items-center gap-2 py-1 ${i ? "border-top" : ""}`}>
                <span className="text-muted">{METRIC_LABELS[k]}</span>
                <MetricValue value={row.oee?.[k]} />
              </div>
            ))}
          </div>

          <FlaggedLine flagged={row.review?.flagged} className="mt-2" withLabel />
          <DecidedInfo review={row.review} className="mt-2" />

          <div className="d-flex flex-wrap gap-1 mt-auto pt-3">
            <DecideButtons row={row} onDecide={onDecide} />
            <OpenSheetLink row={row} roleSlug={roleSlug} />
          </div>
        </div>
      </Col>
    ))}
  </Row>
);

const ReviewsTab = ({ roleSlug }) => {
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // The row (and decision) the modal is open on — kept through the close
  // animation, so the modal doesn't blank out while fading.
  const [decision, setDecision] = useState(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const hostRef = useRef(null);
  const wide = useElementWidth(hostRef) >= TABLE_MIN_WIDTH;
  // Only the newest request may fill the list — switch status twice quickly
  // and the first answer must not land after the second.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const res = await getReviews({ status });
      if (request !== latest.current) return;
      setRows(res?.data?.data || []);
    } catch (err) {
      if (request !== latest.current) return;
      setRows([]);
      setError(err?.response?.data?.message || "Failed to load the review list. Please try again.");
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.machineName, r.operator, r.itemName, r.drawingNo, r.processName].some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const openDecision = (row, kind) => {
    setDecision({ row, decision: kind });
    setDecisionOpen(true);
  };
  const closeDecision = () => setDecisionOpen(false);
  const onDecided = () => {
    setDecisionOpen(false);
    load();
  };

  const countText = loading
    ? ""
    : search.trim()
      ? `${filtered.length} of ${rows.length} ${rows.length === 1 ? "entry" : "entries"} match`
      : `${rows.length} ${status === "all" ? "flagged" : status} ${rows.length === 1 ? "entry" : "entries"}`;

  return (
    <div ref={hostRef}>
      {/* The search drops onto its own line when it can't sit beside the
          status pills with room to type (a tablet with the sidebar open). */}
      <div className="d-flex flex-column flex-md-row flex-md-wrap align-items-md-center gap-2">
        <div className="d-flex flex-wrap gap-1 flex-shrink-0" role="group" aria-label="Review status">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`btn btn-sm rounded-pill px-3 ${status === t.key ? "btn-primary" : "btn-outline-secondary"}`}
              aria-pressed={status === t.key}
              onClick={() => setStatus(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="d-flex align-items-center gap-2 flex-grow-1 justify-content-md-end" style={{ minWidth: 280 }}>
          <div className="position-relative flex-grow-1" style={{ maxWidth: 340 }}>
            <Search size={14} className="position-absolute text-muted" style={{ left: 10, top: 9, pointerEvents: "none" }} />
            <Input
              type="search"
              bsSize="sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search machine / worker, operator, part…"
              title="Search by machine or worker, operator, part name or drawing no."
              aria-label="Search by machine or worker, operator, part name or drawing no."
              style={{ paddingLeft: 30 }}
            />
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center flex-shrink-0"
            onClick={load}
            disabled={loading}
            title="Reload the list"
            aria-label="Reload the list"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="small text-muted mt-2 mb-3" style={{ minHeight: "1.25rem" }}>
        {countText}
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
          {search.trim() ? `No ${status === "all" ? "" : `${status} `}entries match “${search.trim()}”.` : EMPTY_TEXT[status]}
        </div>
      ) : !error && wide ? (
        <ReviewTable rows={filtered} roleSlug={roleSlug} onDecide={openDecision} />
      ) : !error ? (
        <ReviewCards rows={filtered} roleSlug={roleSlug} onDecide={openDecision} />
      ) : null}

      <DecisionModal
        isOpen={decisionOpen}
        row={decision?.row || null}
        decision={decision?.decision || "approved"}
        onClose={closeDecision}
        onDecided={onDecided}
      />
    </div>
  );
};

export default ReviewsTab;
