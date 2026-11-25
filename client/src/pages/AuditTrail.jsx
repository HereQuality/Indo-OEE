import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import { Download, History, RotateCcw, Search, X } from "lucide-react";
import { Card, CardBody, CardHeader, Col, Container, Input, Label, Row, Spinner } from "reactstrap";
import { useAlert } from "../context/AlertContext";
import { exportAuditTrailCsv, getAuditTrail, getAuditTrailFilters } from "../api/auditTrail.api";
import AuditLogList, { Pager } from "../Components/AuditTrail/AuditLogList";
import { AUDIT_ACTIONS, EMPTY_FILTERS, PAGE_SIZE, activeChips, isRecordQuery } from "../utils/auditTrail";
import { displayDay } from "../utils/productionSheet";

/**
 * Data Entry › Audit Trail — every change made in the software, who made it,
 * what changed and when (server models/AuditLog.js): entries, Not-running
 * marks, masters, roles and permissions, sign-ins, mails … newest first, 50
 * to a page, filtered by date range / module / action / user / free text on
 * the server, exported as CSV with the same filters.
 *
 * ?entity=<id> or ?sheet=…&date=…&machine=… narrows it to one record's
 * history — where a row's "History" button's "Open in Audit Trail" leads.
 *
 * Who may open it is decided by the menu permission system (Manage Role);
 * the page itself shows the same thing to everyone the server answers.
 */

const ISO = "YYYY-MM-DD";
const today = () => dayjs().format(ISO);
const daysAgo = (n) => dayjs().subtract(n, "day").format(ISO);
const defaultRange = () => ({ from: daysAgo(29), to: today() });

const QUICK_PICKS = [
  { key: "today", label: "Today", range: () => ({ from: today(), to: today() }) },
  { key: "7", label: "7 days", range: () => ({ from: daysAgo(6), to: today() }) },
  { key: "30", label: "30 days", range: () => defaultRange() },
  { key: "month", label: "This month", range: () => ({ from: dayjs().startOf("month").format(ISO), to: today() }) },
];

const sameRange = (a, b) => a.from === b.from && a.to === b.to;

// The record a ?entity / ?sheet&date&machine query points at, read from the URL.
const recordFromSearch = (sp) => ({
  entity: sp.get("entity") || "",
  sheet: sp.get("sheet") || "",
  date: sp.get("date") || "",
  machine: sp.get("machine") || "",
});

const AuditTrail = () => {
  const toast = useAlert();
  const [searchParams, setSearchParams] = useSearchParams();
  const record = useMemo(() => recordFromSearch(searchParams), [searchParams]);
  const recordMode = isRecordQuery(record);

  const [range, setRange] = useState(defaultRange);
  const [module, setModule] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [options, setOptions] = useState({ modules: [], actions: AUDIT_ACTIONS, actors: [] });
  const [state, setState] = useState({ logs: [], total: 0, loading: true, error: "" });
  const [exporting, setExporting] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    document.title = `Audit Trail | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;
  }, []);

  // The modules / actions / users to filter by — the server's lists, with the
  // built-in action vocabulary as the fallback if that call fails.
  useEffect(() => {
    let live = true;
    getAuditTrailFilters()
      .then((res) => {
        if (!live) return;
        const d = res?.data?.data || {};
        setOptions({
          modules: Array.isArray(d.modules) ? d.modules : [],
          actions: Array.isArray(d.actions) && d.actions.length ? d.actions : AUDIT_ACTIONS,
          actors: Array.isArray(d.actors) ? d.actors : [],
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // The search box waits 400 ms after the last keystroke before asking the server.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ((cur) => {
        if (cur !== text.trim()) setPage(0);
        return text.trim();
      });
    }, 400);
    return () => clearTimeout(t);
  }, [text]);

  // In record mode the date range is left out: a record's whole history is wanted.
  const filters = useMemo(
    () => ({
      ...EMPTY_FILTERS,
      ...(recordMode ? {} : range),
      module: module ? [module] : [],
      action: action ? [action] : [],
      actor,
      q,
      ...record,
    }),
    [recordMode, range, module, action, actor, q, record],
  );

  const load = useCallback(async () => {
    const request = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const res = await getAuditTrail(filters, { skip: page * PAGE_SIZE, limit: PAGE_SIZE });
      if (request !== latest.current) return;
      const rows = res?.data?.data || [];
      setState({ logs: rows, total: res?.data?.total ?? rows.length, loading: false, error: "" });
    } catch (err) {
      if (request !== latest.current) return;
      setState((s) => ({ ...s, loading: false, error: err?.response?.data?.message || "Couldn't load the audit trail. Please try again." }));
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  const { logs, total, loading, error } = state;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const chips = useMemo(() => activeChips(filters, options), [filters, options]);
  const filtered = chips.length > 0 || (!recordMode && !sameRange(range, defaultRange()));

  const set = (fn) => {
    setPage(0);
    fn();
  };
  const resetFilters = () =>
    set(() => {
      setRange(defaultRange());
      setModule("");
      setAction("");
      setActor("");
      setText("");
      setQ("");
    });
  const removeChip = (chip) =>
    set(() => {
      if (chip.key === "module") setModule("");
      if (chip.key === "action") setAction("");
      if (chip.key === "actor") setActor("");
      if (chip.key === "q") {
        setText("");
        setQ("");
      }
    });
  const showEverything = () => {
    setPage(0);
    setSearchParams({}, { replace: true });
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await exportAuditTrailCsv(filters);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Couldn't export the CSV. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  // "History of: CNC · 7A · 25/11/2026" — the record's own label from its newest
  // row, or the query spelled out until the rows arrive.
  const recordLabel =
    logs[0]?.label ||
    (record.entity
      ? `record ${record.entity}`
      : [String(record.sheet || "").toUpperCase(), logs[0]?.machineName || record.machine, record.date ? displayDay(record.date) : ""].filter(Boolean).join(" · "));

  const emptyText = recordMode
    ? "No changes recorded for this record yet. Changes made from now on are listed here."
    : q
      ? `Nothing matches “${q}” in this date range.`
      : chips.length
        ? "Nothing matches these filters in this date range. Widen the dates or remove a filter."
        : `Nothing recorded between ${displayDay(range.from)} and ${displayDay(range.to)}.`;

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
                      <h5 className="mb-0 fs-6 fw-semibold d-flex align-items-center gap-2">
                        <History size={18} className="text-muted" /> Audit Trail
                      </h5>
                      <div className="text-muted small">Every change made in the software — who did it, what changed and when. Times are IST.</div>
                    </div>
                    <div className="d-flex flex-wrap gap-2">
                      <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={resetFilters} disabled={!filtered}>
                        <RotateCcw size={14} /> Reset filters
                      </button>
                      <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={exportCsv} disabled={exporting || loading || total === 0}>
                        {exporting ? <Spinner size="sm" /> : <Download size={14} />} {exporting ? "Exporting…" : "Export CSV"}
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardBody>
                  {recordMode && (
                    <div className="alert alert-info d-flex flex-wrap align-items-center justify-content-between gap-2 py-2 mb-3" role="status">
                      <span className="d-inline-flex align-items-center gap-2 text-break">
                        <History size={16} className="flex-shrink-0" />
                        <span>
                          <span className="text-muted">History of:</span> <b>{recordLabel || "this record"}</b>
                        </span>
                      </span>
                      <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" onClick={showEverything}>
                        <X size={14} /> Show everything
                      </button>
                    </div>
                  )}

                  {/* Filter bar — stacked on a phone, two per row on a tablet, one row on a desktop. */}
                  <Row className="g-2 align-items-end">
                    {!recordMode && (
                      <>
                        <Col xs={6} md={3} lg={2}>
                          <Label htmlFor="at-from" className="small text-muted mb-1">
                            From
                          </Label>
                          <Input id="at-from" type="date" bsSize="sm" value={range.from} max={range.to || undefined} onChange={(e) => set(() => setRange((r) => ({ ...r, from: e.target.value })))} />
                        </Col>
                        <Col xs={6} md={3} lg={2}>
                          <Label htmlFor="at-to" className="small text-muted mb-1">
                            To
                          </Label>
                          <Input id="at-to" type="date" bsSize="sm" value={range.to} min={range.from || undefined} onChange={(e) => set(() => setRange((r) => ({ ...r, to: e.target.value })))} />
                        </Col>
                      </>
                    )}
                    <Col xs={12} sm={6} md={recordMode ? 4 : 3} lg={recordMode ? 3 : 2}>
                      <Label htmlFor="at-module" className="small text-muted mb-1">
                        Module
                      </Label>
                      <Input id="at-module" type="select" bsSize="sm" value={module} onChange={(e) => set(() => setModule(e.target.value))}>
                        <option value="">All modules</option>
                        {options.modules.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.label}
                          </option>
                        ))}
                      </Input>
                    </Col>
                    <Col xs={12} sm={6} md={recordMode ? 4 : 3} lg={recordMode ? 3 : 2}>
                      <Label htmlFor="at-action" className="small text-muted mb-1">
                        Action
                      </Label>
                      <Input id="at-action" type="select" bsSize="sm" value={action} onChange={(e) => set(() => setAction(e.target.value))}>
                        <option value="">All actions</option>
                        {options.actions.map((a) => (
                          <option key={a.key} value={a.key}>
                            {a.label}
                          </option>
                        ))}
                      </Input>
                    </Col>
                    <Col xs={12} sm={6} md={recordMode ? 4 : 6} lg={recordMode ? 3 : 2}>
                      <Label htmlFor="at-actor" className="small text-muted mb-1">
                        User
                      </Label>
                      <Input id="at-actor" type="select" bsSize="sm" value={actor} onChange={(e) => set(() => setActor(e.target.value))}>
                        <option value="">All users</option>
                        {options.actors.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                            {u.role ? ` (${u.role})` : ""}
                          </option>
                        ))}
                      </Input>
                    </Col>
                    <Col xs={12} sm={6} md={recordMode ? 12 : 6} lg={recordMode ? 3 : 2}>
                      <Label htmlFor="at-q" className="small text-muted mb-1">
                        Search
                      </Label>
                      <div className="position-relative">
                        <Search size={14} className="position-absolute text-muted" style={{ left: 10, top: 9, pointerEvents: "none" }} />
                        <Input id="at-q" type="search" bsSize="sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Record, user, value…" aria-label="Search the audit trail" style={{ paddingLeft: 30 }} />
                      </div>
                    </Col>
                  </Row>
                  {!recordMode && (
                    <div className="d-flex flex-wrap align-items-center gap-1 mt-2">
                      <span className="small text-muted me-1">Quick pick:</span>
                      {QUICK_PICKS.map((p) => {
                        const on = sameRange(range, p.range());
                        return (
                          <button key={p.key} type="button" className={`btn btn-sm rounded-pill py-0 ${on ? "btn-primary" : "btn-outline-secondary"}`} aria-pressed={on} onClick={() => set(() => setRange(p.range()))}>
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Summary line and the filters in force, each removable. */}
                  <div className="d-flex flex-wrap align-items-center gap-2 mt-3 mb-2" style={{ minHeight: "1.5rem" }}>
                    <span className="small text-muted">
                      {loading ? "Loading…" : error ? "" : `${total} ${total === 1 ? "record" : "records"} · page ${Math.min(page + 1, totalPages)} of ${totalPages}`}
                    </span>
                    {chips.map((c) => (
                      <button key={`${c.key}-${c.value}`} type="button" className="btn btn-sm btn-light rounded-pill py-0 d-inline-flex align-items-center gap-1 small" onClick={() => removeChip(c)} title="Remove this filter">
                        {c.label} <X size={12} />
                      </button>
                    ))}
                  </div>

                  <AuditLogList logs={logs} loading={loading} error={error} onRetry={load} emptyText={emptyText} />

                  {!loading && !error && <Pager page={page} totalPages={totalPages} onChange={setPage} className="pt-3 border-top" />}
                </CardBody>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>
    </React.Fragment>
  );
};

export default AuditTrail;
