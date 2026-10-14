import React, { useEffect, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { Col, Input, Label, Modal, ModalBody, ModalFooter, ModalHeader, Row, Spinner } from "reactstrap";
import { decideReview } from "../../api/oeeReview.api";
import { useAlert } from "../../context/AlertContext";
import { METRIC_KEYS, METRIC_LABELS, MetricValue, entryTitle, flaggedText } from "./reviewShared";

/**
 * Components/OeeReview/DecisionModal.jsx
 * ────────────────────────────────────────
 * Approve or reject one flagged entry: its details and the figures over
 * 100%, a remark (required to reject, optional to approve, 500 characters at
 * most), Confirm / Cancel. The decision is sent with the flag the reviewer
 * was looking at (flaggedAt) — if the entry was edited meanwhile the server
 * answers 409, which is shown and the list reloaded rather than deciding on
 * figures nobody reviewed.
 */

const REMARK_MAX = 500;

const DecisionModal = ({ isOpen, row, decision, onClose, onDecided }) => {
  const toast = useAlert();
  const isReject = decision === "rejected";
  const [remark, setRemark] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // A fresh remark every time the modal opens on an entry.
  useEffect(() => {
    if (isOpen) {
      setRemark("");
      setError("");
      setSubmitting(false);
    }
  }, [isOpen, row?._id, decision]);

  const close = () => {
    if (!submitting) onClose();
  };

  const confirm = async () => {
    if (!row) return;
    const text = remark.trim();
    if (isReject && !text) {
      setError("A remark is required to reject an entry");
      return;
    }
    if (text.length > REMARK_MAX) {
      setError(`Remark must be ${REMARK_MAX} characters or fewer`);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await decideReview(row.sheet, row._id, { decision, remark: text, flaggedAt: row.review?.flaggedAt });
      toast.success(res?.data?.message || (isReject ? "Entry rejected" : "Entry approved"));
      onDecided();
    } catch (err) {
      const status = err?.response?.status;
      const message = err?.response?.data?.message || "Could not save the decision. Please try again.";
      toast.error(message);
      // Edited after it was opened: the figures on screen are stale, so
      // the modal closes and the list reloads with the new flag.
      if (status === 409) onDecided();
      else if (status === 400) setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const details = row
    ? [
        ["Process", row.processName],
        ["Operator", row.operator],
        ["Part", row.itemName],
        ["Drawing No.", row.drawingNo],
      ]
    : [];

  return (
    <Modal isOpen={isOpen} toggle={close} centered backdrop="static" scrollable>
      <ModalHeader className="p-3 border-bottom" toggle={close}>
        {isReject ? "Reject entry" : "Approve entry"}
      </ModalHeader>
      {row && (
        <>
          <ModalBody>
            <div className="fw-semibold">{entryTitle(row)}</div>
            <Row className="g-2 mt-1 small">
              {details.map(([label, value]) => (
                <Col xs={12} sm={6} key={label}>
                  <span className="text-muted">{label}:</span> <span className="text-break">{value || "—"}</span>
                </Col>
              ))}
            </Row>

            <Row className="g-2 mt-2">
              {METRIC_KEYS.map((k) => (
                <Col xs={12} sm={4} key={k}>
                  <div className="border rounded-3 px-3 py-2 d-flex d-sm-block align-items-center justify-content-between bg-body-tertiary">
                    <div className="text-muted small">{METRIC_LABELS[k]}</div>
                    <MetricValue value={row.oee?.[k]} className="fs-6" />
                  </div>
                </Col>
              ))}
            </Row>

            <div className="alert alert-warning d-flex align-items-start gap-2 small py-2 px-3 mt-3 mb-3" role="alert">
              <AlertTriangle size={16} className="flex-shrink-0 mt-1" />
              <div>
                <span className="fw-semibold">Over 100%:</span> {flaggedText(row.review?.flagged) || "—"}
              </div>
            </div>

            <Label for="oee-review-remark" className="form-label small fw-semibold mb-1">
              Remark {isReject ? <span className="text-danger">*</span> : <span className="text-muted fw-normal">(optional)</span>}
            </Label>
            <Input
              id="oee-review-remark"
              type="textarea"
              rows={3}
              maxLength={REMARK_MAX}
              value={remark}
              invalid={!!error}
              disabled={submitting}
              onChange={(e) => {
                setRemark(e.target.value);
                if (error) setError("");
              }}
              placeholder={isReject ? "Why is this entry rejected?" : "Anything to note for the record"}
            />
            <div className="d-flex justify-content-between gap-2 small mt-1">
              <span className="text-danger">{error}</span>
              <span className="text-muted text-nowrap">
                {remark.length}/{REMARK_MAX}
              </span>
            </div>
          </ModalBody>
          <ModalFooter className="flex-wrap gap-2">
            <button type="button" className="btn btn-outline-secondary" onClick={close} disabled={submitting}>
              Cancel
            </button>
            <button
              type="button"
              className={`btn ${isReject ? "btn-danger" : "btn-success"} d-inline-flex align-items-center gap-1`}
              onClick={confirm}
              disabled={submitting}
            >
              {submitting ? <Spinner size="sm" /> : isReject ? <X size={16} /> : <Check size={16} />}
              {isReject ? "Confirm rejection" : "Confirm approval"}
            </button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
};

export default DecisionModal;
