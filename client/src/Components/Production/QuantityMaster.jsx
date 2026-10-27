import React, { useId, useMemo } from "react";
import { Col, Input, Label, Row } from "reactstrap";
import NumberInput from "./NumberInput";
import { useAlert } from "../../context/AlertContext";
import { qtyNotice } from "../../utils/limitNotice";
import { REJECT_REASONS, fmtNum } from "../../utils/productionSheet";
import { cleanSplit } from "../../utils/entryValidation";

/**
 * components/Production/QuantityMaster.jsx
 * ──────────────────────────────────────────
 * The CNC form's "Production Master" and "Rejection Master (Qty)" lines,
 * shared by every other machine sheet's form so they look and behave the same:
 *
 *   ProductionMasterFields   Actual Quantity (never more than Ideal Quantity) and OK
 *                            Quantity (never more than Actual) are typed;
 *                            Rejected is Actual − OK, shown greyed.
 *   RejectionMasterFields    the rejected pieces split across REJECT_REASONS —
 *                            the boxes have to add up to Rejected; "Other" needs
 *                            a remark.
 *
 * Rules live in utils/quantityRules.js (client) and utils/rejectSplit.js (server).
 */
const labelClass = "form-label small text-muted mb-1";

// `md` is the width of each box from a wide screen up (3 beside three others, 4 for a row
// of three); the form sits in a modal only 500px wide until 992px, so below that the
// boxes go two to a row, and one to a row on a phone.
// `capByIdeal` false leaves Actual uncapped (RUBBER, which sends over-Ideal
// entries to OEE Review instead). `notice` is passed to qtyNotice (machine / words).
// `labels` names the three boxes the sheet's own way (BEFORE POWDER COATING:
// TOTAL QTY / OK QTY / Rejected QTY); left out, they read as on the CNC form.
export const ProductionMasterFields = ({
  values,
  calc,
  err,
  onChange,
  md = 3,
  capByIdeal = true,
  notice: noticeOpts = {},
  labels: { actual: actualLabel = "Actual Quantity", ok: okLabel = "OK Quantity", rejected: rejectedLabel = "Rejected" } = {},
}) => {
  const { warning, notice } = useAlert();
  const uid = useId();
  const actualTyped = values.actualQty !== "" && Number.isFinite(Number(values.actualQty));
  return (
    <Row className="g-1">
      <Col xs={12} sm={6} lg={md}>
        <div className="mb-1" data-field="actualQty">
          <Label htmlFor={`${uid}-actual`} className={labelClass}>
            {actualLabel} <span className="text-danger">*</span>
          </Label>
          <NumberInput
            id={`${uid}-actual`}
            name="actualQty"
            value={values.actualQty}
            onChange={onChange}
            decimals={false}
            invalid={!!err("actualQty")}
            {...(capByIdeal
              ? { max: calc.idealQty, onExceedMax: (max, typed) => notice(...qtyNotice({ calc, entered: typed, label: actualLabel, ...noticeOpts })) }
              : {})}
          />
          {err("actualQty") && <p className="text-danger mb-0 small mt-1">{err("actualQty")}</p>}
        </div>
      </Col>
      <Col xs={12} sm={6} lg={md}>
        <div className="mb-1" data-field="okQty">
          <Label htmlFor={`${uid}-ok`} className={labelClass}>
            {okLabel} <span className="text-danger">*</span>
          </Label>
          <NumberInput
            id={`${uid}-ok`}
            name="okQty"
            value={values.okQty}
            onChange={onChange}
            decimals={false}
            invalid={!!err("okQty")}
            max={actualTyped ? Number(values.actualQty) : capByIdeal ? calc.idealQty : undefined}
            onExceedMax={(max) => warning(`${okLabel} can't be more than ${actualLabel} (${fmtNum(max)})`)}
          />
          {err("okQty") && <p className="text-danger mb-0 small mt-1">{err("okQty")}</p>}
        </div>
      </Col>
      <Col xs={12} sm={6} lg={md}>
        <div className="mb-1" title={`${actualLabel} − ${okLabel}, so OK + Rejected = ${actualLabel}`}>
          <Label htmlFor={`${uid}-rejected`} className={labelClass}>{rejectedLabel}</Label>
          <Input id={`${uid}-rejected`} type="text" bsSize="sm" value={fmtNum(calc.rejectedQty) ?? ""} readOnly disabled className="bg-light" />
        </div>
      </Col>
    </Row>
  );
};

// `reasons`: the sheet's own reject reasons (BEFORE POWDER COATING has its own); the CNC list otherwise.
export const RejectionMasterFields = ({ values, calc, err, index, onChange, onRejectChange, reasons = REJECT_REASONS }) => {
  const { warning } = useAlert();
  const splitTotal = useMemo(() => Object.values(cleanSplit(values.rejectBreakdown)).reduce((sum, v) => sum + v, 0), [values.rejectBreakdown]);
  const rejected = calc.rejectedQty || 0;
  const splitMismatch = splitTotal !== rejected;
  const otherUsed = Number(values.rejectBreakdown?.Other) > 0;
  // What a box may still take: whatever of Rejected the other boxes haven't used.
  const room = (reason) => Math.max(0, rejected - (splitTotal - (Number(values.rejectBreakdown?.[reason]) || 0)));
  return (
    <>
      <div data-field="rejectBreakdown">
        <Row className="g-1">
          {reasons.map((reason) => (
            <Col xs={12} sm={6} lg={4} key={reason}>
              <div className="mb-2">
                <Label htmlFor={`reject-${index}-${reason.replace(/\W+/g, "-")}`} className={labelClass}>{reason}</Label>
                <NumberInput
                  id={`reject-${index}-${reason.replace(/\W+/g, "-")}`}
                  name={reason}
                  value={values.rejectBreakdown?.[reason] ?? ""}
                  onChange={(e) => onRejectChange(index, reason, e.target.value)}
                  decimals={false}
                  invalid={!!err("rejectBreakdown") && splitMismatch}
                  max={room(reason)}
                  onExceedMax={(max) =>
                    warning(
                      rejected === 0
                        ? "Rejected Quantity is 0 (Actual − OK), so there is nothing to split."
                        : `Only ${max} of the ${rejected} rejected pieces are left for “${reason}” — the boxes can't add up to more than Rejected.`,
                    )
                  }
                />
              </div>
            </Col>
          ))}
        </Row>
        {/* The split has to account for every rejected piece, so the running total sits next to the figure it must match. */}
        <div className="mb-2 small">
          <span className="text-muted">Split so far: </span>
          <span className={splitMismatch ? "text-danger fw-semibold" : "fw-semibold"}>{splitTotal}</span>
          <span className="text-muted"> of {fmtNum(calc.rejectedQty) || 0} rejected</span>
          {splitTotal < rejected && <span className="text-danger"> — {rejected - splitTotal} left to assign</span>}
          {err("rejectBreakdown") && <p className="text-danger mb-0 mt-1">{err("rejectBreakdown")}</p>}
        </div>
      </div>
      {otherUsed && (
        <Row className="g-1">
          <Col md={12}>
            <div className="mb-1" data-field="rejectOtherRemark">
              <Label htmlFor={`reject-other-remark-${index}`} className={labelClass}>
                Remark for “Other” rejection <span className="text-danger">*</span>
              </Label>
              <Input
                id={`reject-other-remark-${index}`}
                type="textarea"
                bsSize="sm"
                name="rejectOtherRemark"
                value={values.rejectOtherRemark || ""}
                onChange={onChange}
                maxLength={300}
                placeholder="Why were these pieces rejected as “Other”?"
                invalid={!!err("rejectOtherRemark")}
                style={{ height: "52px" }}
              />
              {err("rejectOtherRemark") && <p className="text-danger mb-0 small mt-1">{err("rejectOtherRemark")}</p>}
            </div>
          </Col>
        </Row>
      )}
    </>
  );
};
