import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ClipboardCheck, History, ShieldAlert } from "lucide-react";
import { Card, CardBody, CardHeader, Col, Container, Row, Spinner } from "reactstrap";
import { useReviewAccess } from "../hooks/useReviewAccess";
import ReviewsTab from "../Components/OeeReview/ReviewsTab";
import AuditLogTab from "../Components/OeeReview/AuditLogTab";

/**
 * OEE Review — the Admin / Super Admin review desk and the audit log.
 *
 * Any production entry whose Availability, Performance, Quality or OEE figure is above
 * 100% is held for review (the figure itself is never capped). The Reviews
 * tab lists those entries by status and takes the approve / reject decision;
 * the Audit log tab is the permanent record of every entry change, flag,
 * decision, unlock and process setting change.
 *
 * Anyone else gets a plain "Admin only" card — and no data is requested,
 * since the server would refuse it anyway.
 */

const TABS = [
  { key: "reviews", label: "Reviews", Icon: ClipboardCheck },
  { key: "audit", label: "Audit log", Icon: History },
];

const OeeReviewPage = () => {
  const { roleSlug } = useParams();
  const { canReview, loading } = useReviewAccess();
  const [tab, setTab] = useState("reviews");

  useEffect(() => {
    document.title = `OEE Review | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;
  }, []);

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Card>
                <CardHeader>
                  <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                    <div style={{ minWidth: 0 }}>
                      <h5 className="mb-0 fs-6 fw-semibold">OEE Review</h5>
                      <div className="text-muted small">Entries with Availability, Performance, Quality or an OEE figure above 100%, and the audit log.</div>
                    </div>
                    {!loading && canReview && (
                      <ul className="nav nav-pills gap-1 mb-0" role="tablist">
                        {TABS.map(({ key, label, Icon }) => (
                          <li className="nav-item" role="presentation" key={key}>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={tab === key}
                              className={`nav-link btn-sm d-inline-flex align-items-center gap-1 ${tab === key ? "active" : ""}`}
                              onClick={() => setTab(key)}
                            >
                              <Icon size={15} /> {label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardHeader>
                <CardBody>
                  {loading ? (
                    <div className="text-center py-5">
                      <Spinner size="sm" /> <span className="text-muted small ms-2">Checking access…</span>
                    </div>
                  ) : !canReview ? (
                    <div className="text-center py-5 px-3">
                      <div
                        className="d-inline-flex align-items-center justify-content-center rounded-circle bg-warning-subtle text-warning-emphasis mb-3"
                        style={{ width: 56, height: 56 }}
                      >
                        <ShieldAlert size={28} />
                      </div>
                      <h6 className="fw-semibold mb-1">Only a Super Admin or a Full access user can review entries</h6>
                      <p className="text-muted small mb-0">
                        Entries that go above 100% are still saved and flagged — an administrator will take the decision here.
                      </p>
                    </div>
                  ) : tab === "audit" ? (
                    <AuditLogTab />
                  ) : (
                    <ReviewsTab roleSlug={roleSlug} />
                  )}
                </CardBody>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>
    </React.Fragment>
  );
};

export default OeeReviewPage;
