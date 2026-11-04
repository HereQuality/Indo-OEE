import React, { useContext, useEffect, useMemo, useState } from "react";
import { Building2, CalendarDays, FileSpreadsheet, Layers, Pencil, Plus, Target, Trash2, Upload } from "lucide-react";
import { Card, CardBody, CardHeader, Col, Container, Input, Label, Modal, ModalBody, ModalFooter, ModalHeader, Row } from "reactstrap";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as XLSX from "xlsx";
import DeleteModal from "../Components/Common/DeleteModal";
import ExcelImportModal from "../Components/Kpi/ExcelImportModal";
import { HowItWorks, MeasureInput, PeriodPicker, Progress, Stat, StatusBadge, YearChips, deltaPct } from "../Components/Kpi/kpiBits";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { createCompanyObjective, deleteCompanyObjective, getCompanySummary, importCompanyHistory, updateCompanyObjective } from "../api/kpi.api";
import { MONTHS, blankMeasure, fmtPct, fmtQty, measureText, thisMonth, thisYear, yearOptions } from "../utils/kpi";

/**
 * Data Entry › Company Level Objective — the company's objectives for a year
 * (objective, Target (sales), Baseline, each with its own unit) over the
 * company-wide OK Qty: by month, the year, and all time, plus the average
 * achievement % of the year's department KPIs. Laid out for the CEO / MD:
 * headline figures first, then the objectives, then the breakdown.
 */
const emptyForm = (year) => ({ objective: "", year, target: blankMeasure(), baseline: blankMeasure(), owner: "", remarks: "" });

const HELP = [
  "Add Objective: the company-level objective, its Target (sales) and Baseline, each with its own unit — Qty or %. Add an Owner and Remarks so everyone knows who drives it and how.",
  "OK Qty here is the whole company: every process's data entries added up — for the chosen month, the year, and all time. Nobody types it.",
  "Achieved % compares the year's OK Qty with a Target in Qty; On track from 100%, Near from 80%, Behind below.",
  "Avg achievement % is the average of the department KPIs' own achievement for the year (KPI page).",
  "Download the year's objectives and month-wise figures as Excel.",
  "Have old sheets? Upload Excel loads past months' company-wide OK Qty (Year, Month, OK Qty). A month that already has data entries keeps the entries; the rest take the uploaded figure, marked 'Excel'.",
];

const IMPORT_COLUMNS = [
  { key: "year", label: "Year", required: true },
  { key: "month", label: "Month", required: true, hint: "Jan, January or 1" },
  { key: "okQty", label: "OK Qty", required: true, hint: "the whole company's OK Qty for that month" },
];
const IMPORT_SAMPLE = { year: 2025, month: "Jan", okQty: 185000 };

const CompanyObjective = () => {
  const toast = useAlert();
  const { currentPagePermissions = { view: true, create: true, edit: true, delete: true } } = useContext(MenuContext) || {};
  const [year, setYear] = useState(thisYear());
  const [month, setMonth] = useState(thisMonth());
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [values, setValues] = useState(emptyForm(year));
  const [saving, setSaving] = useState(false);
  const [removeId, setRemoveId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getCompanySummary(year);
      setSummary(res?.data?.data || null);
    } catch (ex) {
      toast.error(ex?.response?.data?.message || "Could not load the company objectives");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const openAdd = () => { setEditId(null); setValues(emptyForm(year)); setModal(true); };
  const openEdit = (o) => {
    setEditId(o._id);
    setValues({ objective: o.objective, year: o.year, target: { value: o.target?.value ?? "", uom: o.target?.uom || "Qty" }, baseline: { value: o.baseline?.value ?? "", uom: o.baseline?.uom || "Qty" }, owner: o.owner || "", remarks: o.remarks || "" });
    setModal(true);
  };
  const save = async () => {
    if (!values.objective.trim()) return toast.error("Type the objective");
    if (values.target.value === "") return toast.error("Type the Target — Achieved % is measured against it");
    setSaving(true);
    try {
      if (editId) await updateCompanyObjective(editId, values);
      else await createCompanyObjective(values);
      toast.success(editId ? "Objective updated" : "Objective added");
      setModal(false);
      if (Number(values.year) !== year) setYear(Number(values.year));
      else await load();
    } catch (ex) {
      toast.error(ex?.response?.data?.message || "Could not save the objective");
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    setDeleting(true);
    try {
      await deleteCompanyObjective(removeId);
      toast.success("Objective deleted");
      setRemoveId(null);
      await load();
    } catch (ex) {
      toast.error(ex?.response?.data?.message || "Could not delete the objective");
    } finally {
      setDeleting(false);
    }
  };

  const byMonth = summary?.byMonth || [];
  const byYear = summary?.byYear || [];
  const objectives = summary?.objectives || [];
  const monthOk = byMonth[month - 1]?.okQty ?? 0;
  const prevMonthOk = month > 1 ? byMonth[month - 2]?.okQty ?? 0 : null;
  const prevYearOk = byYear.find((y) => y.year === year - 1)?.okQty ?? null;
  const years = useMemo(() => yearOptions(byYear.map((y) => y.year)).filter((y) => y <= thisYear() + 1), [byYear]);
  const chart = byMonth.map((m) => ({ name: MONTHS[m.month - 1], okQty: m.okQty, month: m.month }));
  const yearChart = byYear.map((y) => ({ name: String(y.year), okQty: y.okQty, year: y.year }));


  const downloadExcel = () => {
    const wb = XLSX.utils.book_new();
    const obj = [
      ["Objective", "Owner", "Baseline", "Unit", "Target (sales)", "Unit", `OK Qty ${year}`, "Achieved %", "Status", "Remarks"],
      ...objectives.map((o) => [o.objective, o.owner || "", o.baseline?.value ?? "", o.baseline?.uom || "", o.target?.value ?? "", o.target?.uom || "", summary?.yearOkQty ?? 0, o.achievedPct === null ? "" : Number(o.achievedPct.toFixed(1)), o.status || "", o.remarks || ""]),
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(obj);
    ws1["!cols"] = [{ wch: 36 }, { wch: 18 }, { wch: 12 }, { wch: 6 }, { wch: 14 }, { wch: 6 }, { wch: 14 }, { wch: 11 }, { wch: 10 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws1, `Objectives ${year}`);
    const months = [["Month", "OK Qty", "Share of year %"], ...byMonth.map((m) => [`${MONTHS[m.month - 1]} ${year}`, m.okQty, summary?.yearOkQty ? Number(((m.okQty / summary.yearOkQty) * 100).toFixed(1)) : ""]), ["Year", summary?.yearOkQty ?? 0, 100]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(months), `By month ${year}`);
    const yrs = [["Year", "OK Qty"], ...byYear.map((y) => [y.year, y.okQty]), ["All", summary?.totalOkQty ?? 0]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(yrs), "By year");
    XLSX.writeFile(wb, `Company-Objectives-${year}.xlsx`);
  };

  return (
    <Container fluid className="px-2 px-md-3">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div>
          <h4 className="mb-0">Company Level Objective</h4>
          <div className="text-muted small">Company-wide OK Qty against the year's objectives</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline-success btn-sm d-inline-flex align-items-center gap-1" onClick={downloadExcel} disabled={!summary}><FileSpreadsheet size={16} /> Excel</button>
          {currentPagePermissions.create && (
            <>
              <button type="button" className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1" onClick={() => setImportOpen(true)}><Upload size={16} /> Upload Excel</button>
              <button type="button" className="btn btn-primary btn-sm d-inline-flex align-items-center gap-1" onClick={openAdd}><Plus size={16} /> Add Objective</button>
            </>
          )}
        </div>
      </div>
      <HowItWorks storageKey="company-objective-help" items={HELP} />

      <Card className="mb-3 border-0 shadow-sm">
        <CardBody className="py-2">
          <PeriodPicker years={years} year={year} onYear={setYear} month={month} onMonth={setMonth} hasData={byMonth.map((m) => m.okQty > 0)} />
        </CardBody>
      </Card>

      <Row>
        <Stat label="Avg achievement" value={fmtPct(summary?.avgAchievementPct)} icon={Target} tone="success" hint={`${summary?.kpiObjectiveCount ?? 0} department KPI${summary?.kpiObjectiveCount === 1 ? "" : "s"} · ${summary?.kpiOnTrack ?? 0} on track · ${summary?.kpiBehind ?? 0} behind`} />
        <Stat label={`OK Qty · ${MONTHS[month - 1]} ${year}`} value={fmtQty(monthOk)} icon={CalendarDays} tone="primary" delta={deltaPct(monthOk, prevMonthOk)} deltaLabel={month > 1 ? `vs ${MONTHS[month - 2]}` : ""} hint="all processes" />
        <Stat label={`OK Qty · ${year}`} value={fmtQty(summary?.yearOkQty ?? 0)} icon={Building2} tone="info" delta={deltaPct(summary?.yearOkQty ?? 0, prevYearOk)} deltaLabel={`vs ${year - 1}`} hint="sum of the year" />
        <Stat label="OK Qty · all time" value={fmtQty(summary?.totalOkQty ?? 0)} icon={Layers} tone="secondary" hint={`${byYear.length} year${byYear.length === 1 ? "" : "s"} of entries`} />
      </Row>

      <Card className="mb-3 border-0 shadow-sm">
        <CardHeader className="bg-transparent"><h6 className="mb-0">Objectives · {year}</h6></CardHeader>
        <CardBody className="p-0">
          {objectives.length === 0 ? (
            <div className="text-muted p-3">{loading ? "Loading…" : "No company objective for this year yet. Click Add Objective to set the first one."}</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0 align-middle" style={{ minWidth: 820 }}>
                <thead className="table-light">
                  <tr>
                    <th scope="col">Objective</th>
                    <th scope="col" className="text-end">Baseline</th>
                    <th scope="col" className="text-end">Target (sales)</th>
                    <th scope="col" className="text-end">OK Qty · {year}</th>
                    <th scope="col" style={{ minWidth: 180 }}>Achieved</th>
                    {(currentPagePermissions.edit || currentPagePermissions.delete) && <th scope="col" className="text-end">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {objectives.map((o) => (
                    <tr key={o._id}>
                      <td>
                        <div className="fw-semibold">{o.objective}</div>
                        <div className="text-muted small">{o.owner && <>Owner {o.owner}</>}{o.owner && o.createdByName && " · "}{o.createdByName && <>added by {o.createdByName}</>}</div>
                        {o.remarks && <div className="small text-muted">{o.remarks}</div>}
                      </td>
                      <td className="text-end">{measureText(o.baseline)}</td>
                      <td className="text-end fw-semibold">{measureText(o.target)}</td>
                      <td className="text-end">{fmtQty(summary?.yearOkQty ?? 0)}</td>
                      <td>
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <span className="fw-bold">{o.achievedPct === null ? <span className="text-muted" title="Needs a Target in Qty">—</span> : fmtPct(o.achievedPct)}</span>
                          <StatusBadge status={o.status} />
                        </div>
                        <Progress pct={o.achievedPct} status={o.status} />
                      </td>
                      {(currentPagePermissions.edit || currentPagePermissions.delete) && (
                        <td className="text-end text-nowrap">
                          {currentPagePermissions.edit && <button type="button" className="btn btn-sm btn-light border me-1" aria-label={`Edit ${o.objective}`} onClick={() => openEdit(o)}><Pencil size={15} /></button>}
                          {currentPagePermissions.delete && <button type="button" className="btn btn-sm btn-light border text-danger" aria-label={`Delete ${o.objective}`} onClick={() => setRemoveId(o._id)}><Trash2 size={15} /></button>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Row>
        <Col xs="12" lg="8" className="mb-3">
          <Card className="h-100 mb-0 border-0 shadow-sm">
            <CardHeader className="bg-transparent d-flex flex-wrap justify-content-between gap-2"><h6 className="mb-0">OK Qty by month · {year}</h6><span className="text-muted small">tap a row to pick the month</span></CardHeader>
            <CardBody className="p-0">
              <div className="table-responsive">
                <table className="table table-sm table-hover mb-0 align-middle">
                  <thead className="table-light"><tr><th scope="col">Month</th><th scope="col" className="text-end">OK Qty</th><th scope="col" className="text-end">vs previous</th><th scope="col" className="text-end">Share of year</th></tr></thead>
                  <tbody>
                    {byMonth.map((m, i) => {
                      const d = i > 0 ? deltaPct(m.okQty, byMonth[i - 1].okQty) : null;
                      return (
                        <tr key={m.month} className={m.month === month ? "table-primary" : ""} onClick={() => setMonth(m.month)} style={{ cursor: "pointer" }}>
                          <td>{MONTHS[m.month - 1]} {year}</td>
                          <td className="text-end fw-semibold">{fmtQty(m.okQty)}{m.source === "excel" && <span className="badge bg-secondary-subtle text-secondary-emphasis ms-1" title="Loaded from Excel">Excel</span>}</td>
                          <td className={`text-end ${d === null ? "text-muted" : d >= 0 ? "text-success" : "text-danger"}`}>{d === null ? "—" : `${d >= 0 ? "+" : ""}${fmtPct(d)}`}</td>
                          <td className="text-end">{summary?.yearOkQty ? fmtPct((m.okQty / summary.yearOkQty) * 100) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="table-light"><tr><th scope="row">Year</th><td className="text-end fw-bold">{fmtQty(summary?.yearOkQty ?? 0)}</td><td /><td className="text-end">100%</td></tr></tfoot>
                </table>
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col xs="12" lg="4" className="mb-3 d-flex flex-column gap-3">
          <Card className="mb-0 border-0 shadow-sm">
            <CardHeader className="bg-transparent d-flex flex-wrap justify-content-between gap-2"><h6 className="mb-0">Month trend · {year}</h6><span className="text-muted small">tap a bar</span></CardHeader>
            <CardBody className="pb-2">
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(e) => e?.activePayload?.[0]?.payload?.month && setMonth(e.activePayload[0].payload.month)}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(v) => fmtQty(v)} width={64} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v) => [fmtQty(v), "OK Qty"]} />
                    <Bar dataKey="okQty" radius={[4, 4, 0, 0]} isAnimationActive={false} cursor="pointer">
                      {chart.map((c) => <Cell key={c.month} fill={c.month === month ? "#2563eb" : "#93c5fd"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>

          <Card className="mb-0 border-0 shadow-sm">
            <CardHeader className="bg-transparent"><h6 className="mb-0">OK Qty by year · all time</h6></CardHeader>
            <CardBody className="pb-2">
              {yearChart.length > 1 && (
                <div style={{ width: "100%", height: 36 + yearChart.length * 28 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={yearChart} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} onClick={(e) => e?.activePayload?.[0]?.payload?.year && setYear(e.activePayload[0].payload.year)}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={44} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v) => [fmtQty(v), "OK Qty"]} />
                      <Bar dataKey="okQty" radius={[0, 4, 4, 0]} isAnimationActive={false} cursor="pointer">
                        {yearChart.map((c) => <Cell key={c.year} fill={c.year === year ? "#2563eb" : "#93c5fd"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="table-responsive">
                <table className="table table-sm table-hover mb-0 align-middle">
                  <thead className="table-light"><tr><th scope="col">Year</th><th scope="col" className="text-end">OK Qty</th><th scope="col" className="text-end">vs previous</th></tr></thead>
                  <tbody>
                    {byYear.map((y, i) => {
                      const d = i > 0 ? deltaPct(y.okQty, byYear[i - 1].okQty) : null;
                      return (
                        <tr key={y.year} className={y.year === year ? "table-primary" : ""} onClick={() => setYear(y.year)} style={{ cursor: "pointer" }}>
                          <td className="fw-semibold">{y.year}</td>
                          <td className="text-end">{fmtQty(y.okQty)}</td>
                          <td className={`text-end ${d === null ? "text-muted" : d >= 0 ? "text-success" : "text-danger"}`}>{d === null ? <span title="No earlier year to compare">—</span> : `${d >= 0 ? "+" : ""}${fmtPct(d)}`}</td>
                        </tr>
                      );
                    })}
                    {!byYear.length && <tr><td colSpan="3" className="text-muted">No entries yet.</td></tr>}
                  </tbody>
                  <tfoot className="table-light"><tr><th scope="row">All</th><td className="text-end fw-bold">{fmtQty(summary?.totalOkQty ?? 0)}</td><td /></tr></tfoot>
                </table>
              </div>
              {byYear.length === 1 && <div className="text-muted small mt-2">One year of entries so far — upload old years with Upload Excel to compare year on year.</div>}
            </CardBody>
          </Card>

        </Col>
      </Row>

      <Modal isOpen={modal} toggle={() => setModal(false)} centered scrollable size="lg">
        <ModalHeader toggle={() => setModal(false)}>{editId ? "Update Objective" : "Add Objective"}</ModalHeader>
        <ModalBody>
          <div className="mb-3">
            <Label htmlFor="co-objective" className="mb-1">Objective <span className="text-danger">*</span></Label>
            <Input id="co-objective" value={values.objective} maxLength={200} onChange={(e) => setValues({ ...values, objective: e.target.value })} placeholder="e.g. Grow sales by 20%" />
          </div>
          <Row>
            <Col xs="12" sm="4" className="mb-3">
              <Label className="mb-1 d-block">Year</Label>
              <YearChips years={yearOptions([values.year]).filter((y) => y <= thisYear() + 1)} value={values.year} onChange={(y) => setValues({ ...values, year: y })} />
            </Col>
            <Col xs="12" sm="8" className="mb-3">
              <Label htmlFor="co-owner" className="mb-1">Owner</Label>
              <Input id="co-owner" value={values.owner} maxLength={100} onChange={(e) => setValues({ ...values, owner: e.target.value })} placeholder="Who is responsible" />
            </Col>
          </Row>
          <Row>
            <Col xs="12" md="6"><MeasureInput id="co-target" label="Target (sales)" value={values.target} onChange={(target) => setValues({ ...values, target })} required hint="In Qty to get Achieved % and Status." /></Col>
            <Col xs="12" md="6"><MeasureInput id="co-baseline" label="Baseline" value={values.baseline} onChange={(baseline) => setValues({ ...values, baseline })} hint="Where the company stands today." /></Col>
          </Row>
          <div className="mb-1">
            <Label htmlFor="co-remarks" className="mb-1">Remarks</Label>
            <Input id="co-remarks" type="textarea" rows="2" maxLength={500} value={values.remarks} onChange={(e) => setValues({ ...values, remarks: e.target.value })} placeholder="How it will be achieved, review dates, anything the team should know" />
          </div>
        </ModalBody>
        <ModalFooter>
          <button type="button" className="btn btn-light" onClick={() => setModal(false)} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : editId ? "Update" : "Save"}</button>
        </ModalFooter>
      </Modal>

      <DeleteModal show={!!removeId} handleDelete={remove} toggle={() => setRemoveId(null)} disabled={deleting} />
      <ExcelImportModal
        isOpen={importOpen}
        toggle={() => { setImportOpen(false); load(); }}
        title="Upload old company data from Excel"
        intro="Load past months' company-wide OK Qty from your existing sheets — one row per month."
        columns={IMPORT_COLUMNS}
        sample={IMPORT_SAMPLE}
        templateName="Company-OK-Qty-upload-template"
        onImport={async (rows) => {
          try {
            const res = await importCompanyHistory(rows);
            toast.success(res?.data?.message || "Loaded");
            return res?.data?.data || { imported: 0, errors: [] };
          } catch (ex) {
            toast.error(ex?.response?.data?.message || "Could not import");
            return { imported: 0, errors: [{ row: "-", message: ex?.response?.data?.message || "Could not import" }] };
          }
        }}
      />
    </Container>
  );
};

export default CompanyObjective;
