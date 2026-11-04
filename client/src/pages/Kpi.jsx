import React, { useContext, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, FileSpreadsheet, Layers, LineChart, Pencil, Plus, Table2, Target, Trash2, Upload } from "lucide-react";
import { Card, CardBody, CardHeader, Col, Container, Input, Label, Modal, ModalBody, ModalFooter, ModalHeader, Row } from "reactstrap";
import Select from "react-select";
import * as XLSX from "xlsx";
import DeleteModal from "../Components/Common/DeleteModal";
import KpiGraphPanel from "../Components/Kpi/KpiGraphPanel";
import ExcelImportModal from "../Components/Kpi/ExcelImportModal";
import { HowItWorks, MeasureInput, PeriodPicker, Progress, Stat, StatusBadge, YearChips } from "../Components/Kpi/kpiBits";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useProcesses } from "../hooks/useProcesses";
import { createKpiObjective, deleteKpiObjective, getKpiObjectives, importKpiObjectives, updateKpiObjective } from "../api/kpi.api";
import { createDepartment } from "../api/departments.api";
import { useInvalidateDepartments } from "../hooks/useDepartments";
import { MONTHS, blankMeasure, fmtPct, fmtQty, measureText, okQtyText, thisYear, yearOptions } from "../utils/kpi";

/**
 * Data Entry › KPI — one department at a time (or all), its objectives for a
 * year as month tables or as a graph (Components/Kpi/KpiGraphPanel).
 * Baseline and Target are typed once per objective (each with its own unit);
 * OK Qty is summed every month from the linked processes' entries, and each
 * month gets an Achievement % and a status against the Target.
 */
const emptyForm = (year, department) => ({
  objective: "",
  department: department || "",
  year,
  processes: [],
  baseline: blankMeasure(),
  target: blankMeasure(),
  targetPeriod: "Monthly",
  okQtyUom: "Qty",
  owner: "",
  remarks: "",
});

const HELP = [
  "Pick a department. Each department's own people add its objectives; Super Admin and Full access users can add for any department.",
  "Add Objective: name it, tick the processes it covers, and type the Baseline (where you are today) and the Target. Each has its own unit — Qty or %.",
  "Choose whether the Target is Monthly (each month is compared with it) or Yearly (the OK Qty so far is compared with it).",
  "OK Qty is never typed: every month is the sum of those processes' data entries. Achievement = OK Qty ÷ Target; On track from 100%, Near from 80%, Behind below.",
  "Switch to Graph for a line per objective, and download the table or the graph as Excel / PDF.",
  "Have old sheets? Upload Excel loads past months (one row per objective and month). A month that already has data entries keeps the entries; the rest take the uploaded figure, marked 'Excel'.",
];

const IMPORT_COLUMNS = [
  { key: "department", label: "Department", required: true, hint: "exactly as in Operator Management › Department" },
  { key: "objective", label: "Objective", required: true, hint: "same name on every month row; a new name makes a new objective" },
  { key: "year", label: "Year", required: true },
  { key: "month", label: "Month", required: true, hint: "Jan, January or 1" },
  { key: "okQty", label: "OK Qty", required: true },
  { key: "baseline", label: "Baseline", hint: "only read when the objective is new", hideInPreview: true },
  { key: "baselineUom", label: "Baseline Unit", hint: "Qty or %", hideInPreview: true },
  { key: "target", label: "Target", hint: "only read when the objective is new", hideInPreview: true },
  { key: "targetUom", label: "Target Unit", hint: "Qty or %", hideInPreview: true },
  { key: "targetPeriod", label: "Target Period", hint: "Monthly or Yearly", hideInPreview: true },
  { key: "owner", label: "Owner", hideInPreview: true },
  { key: "processes", label: "Processes", hint: "process names, comma-separated — optional for old data", hideInPreview: true },
];
const IMPORT_SAMPLE = { department: "Production", objective: "Increase OK output", year: 2025, month: "Jan", okQty: 12500, baseline: 10000, baselineUom: "Qty", target: 15000, targetUom: "Qty", targetPeriod: "Monthly", owner: "Plant Head", processes: "CNC, VMC" };

const Kpi = () => {
  const toast = useAlert();
  const { currentPagePermissions = { view: true, create: true, edit: true, delete: true } } = useContext(MenuContext) || {};
  const { data: processes = [] } = useProcesses();

  const [year, setYear] = useState(thisYear());
  const [departmentId, setDepartmentId] = useState("");
  const [view, setView] = useState("table");
  const [data, setData] = useState({ objectives: [], departments: [], canAddAnyDepartment: false });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [values, setValues] = useState(emptyForm(year, ""));
  const [saving, setSaving] = useState(false);
  const [removeId, setRemoveId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // "+ New department" — typed here, made in Operator Management › Department, picked at once.
  const [newDeptOpen, setNewDeptOpen] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [newDeptRemark, setNewDeptRemark] = useState("");
  const [newDeptSaving, setNewDeptSaving] = useState(false);
  const invalidateDepartments = useInvalidateDepartments();

  const load = async () => {
    setLoading(true);
    try {
      const res = await getKpiObjectives({ year });
      const objectives = res?.data?.data || [];
      const departments = res?.data?.departments || [];
      setData({ objectives, departments, canAddAnyDepartment: !!res?.data?.canAddAnyDepartment });
      if (!departmentId && departments.length === 1) setDepartmentId(String(departments[0]._id));
    } catch (ex) {
      toast.error(ex?.response?.data?.message || "Could not load KPI objectives");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const department = data.departments.find((d) => String(d._id) === departmentId);
  const objectives = useMemo(
    () => data.objectives.filter((o) => !departmentId || String(o.department?._id || o.department) === departmentId),
    [data, departmentId],
  );
  const countOf = (id) => data.objectives.filter((o) => String(o.department?._id || o.department) === String(id)).length;
  const departmentOptions = useMemo(
    () => [
      ...(data.departments.length > 1 ? [{ value: "", label: "All departments", count: data.objectives.length }] : []),
      ...data.departments.map((d) => ({ value: String(d._id), label: d.departmentName, count: countOf(d._id) })),
    ],
    [data], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // The strip at the top: this department's (or everyone's) year at a glance.
  const summary = useMemo(() => {
    const pcts = objectives.map((o) => o.yearPct).filter((p) => p !== null && p !== undefined);
    return {
      count: objectives.length,
      okQty: objectives.reduce((a, o) => a + (o.yearOkQty || 0), 0),
      avgPct: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
      onTrack: objectives.filter((o) => o.yearStatus === "On track").length,
      behind: objectives.filter((o) => o.yearStatus === "Behind").length,
    };
  }, [objectives]);

  const processOptions = processes.filter((p) => p.isActive !== false).map((p) => ({ value: p._id, label: p.processName }));

  const addDepartment = async (thenPick) => {
    const name = newDeptName.trim();
    if (!name) return toast.error("Type the department name");
    setNewDeptSaving(true);
    try {
      const res = await createDepartment({ departmentName: name, remark: newDeptRemark.trim(), isActive: true });
      const made = res?.data?.data;
      toast.success(`Department "${name}" added`);
      setNewDeptName("");
      setNewDeptRemark("");
      setNewDeptOpen(false);
      invalidateDepartments();
      await load();
      if (made?._id) {
        setDepartmentId(String(made._id));
        if (thenPick) setValues((v) => ({ ...v, department: String(made._id) }));
      }
    } catch (ex) {
      toast.error(ex?.response?.data?.message || "Could not add the department");
    } finally {
      setNewDeptSaving(false);
    }
  };

  const openAdd = () => { setEditId(null); setValues(emptyForm(year, departmentId)); setModal(true); };
  const openEdit = (o) => {
    setEditId(o._id);
    setValues({
      objective: o.objective,
      department: String(o.department?._id || o.department),
      year: o.year,
      processes: (o.processes || []).map((p) => String(p._id || p)),
      baseline: { value: o.baseline?.value ?? "", uom: o.baseline?.uom || "Qty" },
      target: { value: o.target?.value ?? "", uom: o.target?.uom || "Qty" },
      targetPeriod: o.targetPeriod || "Monthly",
      okQtyUom: o.okQtyUom || "Qty",
      owner: o.owner || "",
      remarks: o.remarks || "",
    });
    setModal(true);
  };

  const save = async () => {
    if (!values.objective.trim()) return toast.error("Type the objective");
    if (!values.department) return toast.error("Select a department");
    if (!values.processes.length) return toast.error("Select at least one process");
    if (values.target.value === "") return toast.error("Type the Target — Achievement is measured against it");
    setSaving(true);
    try {
      if (editId) await updateKpiObjective(editId, values);
      else await createKpiObjective(values);
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
      await deleteKpiObjective(removeId);
      toast.success("Objective deleted");
      setRemoveId(null);
      await load();
    } catch (ex) {
      toast.error(ex?.response?.data?.message || "Could not delete the objective");
    } finally {
      setDeleting(false);
    }
  };

  // The month tables as one Excel workbook, a sheet per objective.
  const downloadExcel = () => {
    const wb = XLSX.utils.book_new();
    const used = new Set();
    objectives.forEach((o, i) => {
      const yearly = o.targetPeriod === "Yearly";
      const rows = [
        ["Department", o.department?.departmentName || ""],
        ["Objective", o.objective],
        ["Owner", o.owner || ""],
        ["Processes", (o.processes || []).map((p) => p.processName).join(", ")],
        ["Baseline", o.baseline?.value ?? "", o.baseline?.uom || ""],
        ["Target", o.target?.value ?? "", o.target?.uom || "", o.targetPeriod || "Monthly"],
        ["Remarks", o.remarks || ""],
        [],
        ["Month", "Baseline", "Target", "OK Qty", ...(yearly ? ["OK Qty so far"] : []), "Achievement %", "Status"],
        ...o.months.map((m) => [`${MONTHS[m.month - 1]} ${o.year}`, o.baseline?.value ?? "", o.target?.value ?? "", m.okQty, ...(yearly ? [m.cumulative] : []), m.pctOfTarget === null ? "" : Number(m.pctOfTarget.toFixed(1)), m.status || ""]),
        ["Year", "", "", o.yearOkQty, ...(yearly ? [o.yearOkQty] : []), o.yearPct === null ? "" : Number(o.yearPct.toFixed(1)), o.yearStatus || ""],
      ];
      let name = `${i + 1} ${o.objective}`.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
      while (used.has(name)) name = `${name.slice(0, 28)}_${i}`;
      used.add(name);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    XLSX.writeFile(wb, `KPI-${year}${department ? `-${department.departmentName}` : ""}.xlsx`.replace(/\s+/g, "-"));
  };

  return (
    <Container fluid className="px-2 px-md-3">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div>
          <h4 className="mb-0">KPI</h4>
          <div className="text-muted small">Department objectives against the OK Qty from the data entries</div>
        </div>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <div className="btn-group btn-group-sm" role="group" aria-label="View">
            <button type="button" className={`btn ${view === "table" ? "btn-primary" : "btn-outline-primary"} d-inline-flex align-items-center gap-1`} onClick={() => setView("table")} aria-pressed={view === "table"}>
              <Table2 size={15} /> Table
            </button>
            <button type="button" className={`btn ${view === "graph" ? "btn-primary" : "btn-outline-primary"} d-inline-flex align-items-center gap-1`} onClick={() => setView("graph")} aria-pressed={view === "graph"}>
              <LineChart size={15} /> Graph
            </button>
          </div>
          {view === "table" && (
            <button type="button" className="btn btn-outline-success btn-sm d-inline-flex align-items-center gap-1" onClick={downloadExcel} disabled={!objectives.length}>
              <FileSpreadsheet size={16} /> Excel
            </button>
          )}
          {data.canAddAnyDepartment && (
            <button type="button" className="btn btn-outline-dark btn-sm d-inline-flex align-items-center gap-1" onClick={() => setNewDeptOpen(true)}>
              <Building2 size={16} /> Add Department
            </button>
          )}
          {currentPagePermissions.create && (
            <>
              <button type="button" className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1" onClick={() => setImportOpen(true)} disabled={!data.departments.length}>
                <Upload size={16} /> Upload Excel
              </button>
              <button type="button" className="btn btn-primary btn-sm d-inline-flex align-items-center gap-1" onClick={openAdd} disabled={!data.departments.length && !data.canAddAnyDepartment}>
                <Plus size={16} /> Add Objective
              </button>
            </>
          )}
        </div>
      </div>
      <HowItWorks storageKey="kpi-help" items={HELP} />

      <Card className="mb-3 border-0 shadow-sm">
        <CardBody className="py-2">
          <div className="kpi-period mb-2">
            <PeriodPicker years={yearOptions(data.objectives.map((o) => o.year)).filter((y) => y <= thisYear() + 1)} year={year} onYear={setYear} />
            <div className="min-w-0" style={{ flex: "1 1 260px", maxWidth: 420 }}>
              <div className="kpi-period__label">Department</div>
              {data.departments.length === 0 ? (
                <div className="text-muted small">
                  {loading ? "Loading…" : data.canAddAnyDepartment ? "No department yet — click Add Department." : "No department on your Employee record yet — ask the Super Admin."}
                </div>
              ) : (
                <Select
                  classNamePrefix="select"
                  aria-label="Department"
                  isSearchable
                  options={departmentOptions}
                  value={departmentOptions.find((o) => o.value === departmentId) || departmentOptions[0]}
                  onChange={(picked) => setDepartmentId(picked?.value || "")}
                  placeholder="Select department…"
                  noOptionsMessage={() => "No department matches"}
                  formatOptionLabel={(o) => (
                    <span className="d-flex justify-content-between align-items-center gap-2">
                      <span className="text-truncate">{o.label}</span>
                      <span className="badge bg-secondary-subtle text-secondary-emphasis">{o.count}</span>
                    </span>
                  )}
                />
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {data.departments.length > 0 && (
        <Row>
          <Stat label="Objectives" value={summary.count} icon={Target} tone="primary" hint={`${department ? department.departmentName : "all departments"} · ${year}`} />
          <Stat label={`OK Qty · ${year}`} value={fmtQty(summary.okQty)} icon={Layers} tone="info" hint="from the data entries" />
          <Stat label="Avg achievement" value={fmtPct(summary.avgPct)} icon={CheckCircle2} tone="success" hint="of the objectives with data" />
          <Stat label="On track / Behind" value={`${summary.onTrack} / ${summary.behind}`} icon={LineChart} tone="warning" hint="objectives this year" />
        </Row>
      )}

      {view === "graph" && data.departments.length > 0 && (
        <KpiGraphPanel year={year} objectives={objectives} departmentName={department?.departmentName || ""} loading={loading} />
      )}

      {view === "table" && data.departments.length > 0 && (
        <>
          {objectives.length === 0 && !loading && (
            <Card><CardBody className="text-muted">No objective {department ? `for ${department.departmentName} ` : ""}in {year} yet. Click Add Objective to start.</CardBody></Card>
          )}
          {objectives.map((o) => {
            const yearly = o.targetPeriod === "Yearly";
            return (
              <Card key={o._id} className="mb-3 border-0 shadow-sm">
                <CardHeader className="bg-transparent d-flex flex-wrap align-items-start justify-content-between gap-2">
                  <div className="min-w-0 flex-grow-1">
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      <span className="fw-semibold">{o.objective}</span>
                      <StatusBadge status={o.yearStatus} />
                      {!department && <span className="text-muted small">{o.department?.departmentName}</span>}
                    </div>
                    <div className="d-flex flex-wrap gap-1 mt-1">
                      {(o.processes || []).map((p) => <span key={p._id || p} className="badge bg-primary-subtle text-primary">{p.processName || "Process"}</span>)}
                    </div>
                    <div className="text-muted small mt-1">
                      Baseline <strong>{measureText(o.baseline)}</strong> · Target <strong>{measureText(o.target)}</strong> ({o.targetPeriod || "Monthly"}) · Achievement <strong>{fmtPct(o.yearPct)}</strong>
                      {o.owner && <> · Owner <strong>{o.owner}</strong></>}
                      {o.createdByName && <> · added by {o.createdByName}</>}
                    </div>
                    {o.remarks && <div className="small mt-1">{o.remarks}</div>}
                    <div className="mt-2" style={{ maxWidth: 360 }}><Progress pct={o.yearPct} status={o.yearStatus} /></div>
                  </div>
                  <div className="d-flex gap-1">
                    {currentPagePermissions.edit && (
                      <button type="button" className="btn btn-sm btn-light border" aria-label={`Edit ${o.objective}`} onClick={() => openEdit(o)}><Pencil size={15} /></button>
                    )}
                    {currentPagePermissions.delete && (
                      <button type="button" className="btn btn-sm btn-light border text-danger" aria-label={`Delete ${o.objective}`} onClick={() => setRemoveId(o._id)}><Trash2 size={15} /></button>
                    )}
                  </div>
                </CardHeader>
                <CardBody className="p-0">
                  <div className="table-responsive">
                    <table className="table table-sm table-hover mb-0 align-middle" style={{ minWidth: yearly ? 760 : 640 }}>
                      <thead className="table-light">
                        <tr>
                          <th scope="col">Month</th>
                          <th scope="col" className="text-end">Baseline ({o.baseline?.uom || "Qty"})</th>
                          <th scope="col" className="text-end">Target ({o.target?.uom || "Qty"})</th>
                          <th scope="col" className="text-end">OK Qty ({o.okQtyUom})</th>
                          {yearly && <th scope="col" className="text-end">OK Qty so far</th>}
                          <th scope="col" className="text-end">Achievement</th>
                          <th scope="col">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.months.map((m) => (
                          <tr key={m.month}>
                            <td>{MONTHS[m.month - 1]} {o.year}</td>
                            <td className="text-end">{measureText(o.baseline)}</td>
                            <td className="text-end">{measureText(o.target)}</td>
                            <td className="text-end fw-semibold">{okQtyText(m, o.okQtyUom)}{m.source === "excel" && <span className="badge bg-secondary-subtle text-secondary-emphasis ms-1" title="Loaded from Excel">Excel</span>}</td>
                            {yearly && <td className="text-end">{fmtQty(m.cumulative)}</td>}
                            <td className="text-end">{fmtPct(m.pctOfTarget)}</td>
                            <td><StatusBadge status={m.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="table-light">
                        <tr>
                          <th scope="row">Year</th>
                          <td />
                          <td />
                          <td className="text-end fw-semibold">{fmtQty(o.yearOkQty)}</td>
                          {yearly && <td className="text-end fw-semibold">{fmtQty(o.yearOkQty)}</td>}
                          <td className="text-end fw-semibold">{fmtPct(o.yearPct)}</td>
                          <td><StatusBadge status={o.yearStatus} /></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {o.target?.uom !== "Qty" && (
                    <div className="text-muted small px-3 py-2">Achievement and Status need a Target in Qty — set the Target unit to Qty to see them.</div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </>
      )}

      <Modal isOpen={modal} toggle={() => setModal(false)} centered scrollable size="lg">
        <ModalHeader toggle={() => setModal(false)}>{editId ? "Update Objective" : "Add Objective"}</ModalHeader>
        <ModalBody>
          <div className="mb-3">
            <Label htmlFor="kpi-objective" className="mb-1">Objective <span className="text-danger">*</span></Label>
            <Input id="kpi-objective" value={values.objective} maxLength={200} onChange={(e) => setValues({ ...values, objective: e.target.value })} placeholder="e.g. Increase OK output of CNC" />
          </div>
          <Row>
            <Col xs="12" sm="5" className="mb-3">
              <Label htmlFor="kpi-department" className="mb-1">Department <span className="text-danger">*</span></Label>
              <Input id="kpi-department" type="select" value={values.department} disabled={!data.canAddAnyDepartment && data.departments.length === 1} onChange={(e) => setValues({ ...values, department: e.target.value })}>
                <option value="">Select department</option>
                {data.departments.map((d) => <option key={d._id} value={d._id}>{d.departmentName}</option>)}
              </Input>
              {data.canAddAnyDepartment && (
                <button type="button" className="btn btn-sm btn-link p-0 mt-1 text-decoration-none d-inline-flex align-items-center gap-1" onClick={() => setNewDeptOpen(true)}><Plus size={14} /> Add department</button>
              )}
            </Col>
            <Col xs="12" sm="3" className="mb-3">
              <Label className="mb-1 d-block">Year</Label>
              <YearChips years={yearOptions([values.year]).filter((y) => y <= thisYear() + 1)} value={values.year} onChange={(y) => setValues({ ...values, year: y })} />
            </Col>
            <Col xs="6" sm="4" className="mb-3">
              <Label htmlFor="kpi-owner" className="mb-1">Owner</Label>
              <Input id="kpi-owner" value={values.owner} maxLength={100} onChange={(e) => setValues({ ...values, owner: e.target.value })} placeholder="Who is responsible" />
            </Col>
          </Row>
          <div className="mb-3">
            <Label className="mb-1">Processes <span className="text-danger">*</span></Label>
            <Select
              isMulti
              classNamePrefix="select"
              options={processOptions}
              value={processOptions.filter((p) => values.processes.includes(p.value))}
              onChange={(picked) => setValues({ ...values, processes: (picked || []).map((p) => p.value) })}
              placeholder="Select processes…"
              closeMenuOnSelect={false}
            />
            <div className="text-muted small mt-1">OK Qty for each month is the sum of these processes' entries — nobody types it.</div>
          </div>
          <Row>
            <Col xs="12" md="6">
              <MeasureInput id="kpi-baseline" label="Baseline" value={values.baseline} onChange={(baseline) => setValues({ ...values, baseline })} hint="Where you stand today — for reference on every row." />
            </Col>
            <Col xs="12" md="6">
              <MeasureInput id="kpi-target" label="Target" value={values.target} onChange={(target) => setValues({ ...values, target })} required hint="In Qty to get Achievement % and Status." />
            </Col>
          </Row>
          <Row>
            <Col xs="12" md="6" className="mb-3">
              <Label htmlFor="kpi-period" className="mb-1">Target is</Label>
              <Input id="kpi-period" type="select" value={values.targetPeriod} onChange={(e) => setValues({ ...values, targetPeriod: e.target.value })}>
                <option value="Monthly">Monthly — each month is compared with it</option>
                <option value="Yearly">Yearly — the OK Qty so far is compared with it</option>
              </Input>
            </Col>
            <Col xs="12" md="6" className="mb-3">
              <Label htmlFor="kpi-ok-uom" className="mb-1">OK Qty shown as</Label>
              <Input id="kpi-ok-uom" type="select" value={values.okQtyUom} onChange={(e) => setValues({ ...values, okQtyUom: e.target.value })}>
                <option value="Qty">Qty — the count</option>
                <option value="%">% — of the Target</option>
              </Input>
            </Col>
          </Row>
          <div className="mb-1">
            <Label htmlFor="kpi-remarks" className="mb-1">Remarks</Label>
            <Input id="kpi-remarks" type="textarea" rows="2" maxLength={500} value={values.remarks} onChange={(e) => setValues({ ...values, remarks: e.target.value })} placeholder="How it will be achieved, review dates, anything the team should know" />
          </div>
        </ModalBody>
        <ModalFooter>
          <button type="button" className="btn btn-light" onClick={() => setModal(false)} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : editId ? "Update" : "Save"}</button>
        </ModalFooter>
      </Modal>

      <Modal isOpen={newDeptOpen} toggle={() => setNewDeptOpen(false)} centered>
        <ModalHeader toggle={() => setNewDeptOpen(false)}>Add Department</ModalHeader>
        <ModalBody>
          <div className="mb-3">
            <Label htmlFor="kpi-new-dept" className="mb-1">Department name <span className="text-danger">*</span></Label>
            <Input id="kpi-new-dept" value={newDeptName} autoFocus maxLength={100} onChange={(e) => setNewDeptName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDepartment(modal); } }} placeholder="e.g. Production, Quality, Sales" />
          </div>
          <div className="mb-1">
            <Label htmlFor="kpi-new-dept-remark" className="mb-1">Remark</Label>
            <Input id="kpi-new-dept-remark" value={newDeptRemark} maxLength={200} onChange={(e) => setNewDeptRemark(e.target.value)} placeholder="Optional" />
          </div>
          <div className="text-muted small mt-2">The department is saved in Operator Management › Department and selected here at once. To give people access to it, add it on their Employee record.</div>
        </ModalBody>
        <ModalFooter>
          <button type="button" className="btn btn-light" onClick={() => setNewDeptOpen(false)} disabled={newDeptSaving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => addDepartment(modal)} disabled={newDeptSaving}>{newDeptSaving ? "Adding…" : "Add Department"}</button>
        </ModalFooter>
      </Modal>

      <DeleteModal show={!!removeId} handleDelete={remove} toggle={() => setRemoveId(null)} disabled={deleting} />
      <ExcelImportModal
        isOpen={importOpen}
        toggle={() => { setImportOpen(false); load(); }}
        title="Upload old KPI data from Excel"
        intro="Load past months from your existing sheets — one row per objective and month. Objectives that don't exist yet are created from the row."
        columns={IMPORT_COLUMNS}
        sample={IMPORT_SAMPLE}
        templateName="KPI-upload-template"
        onImport={async (rows) => {
          try {
            const res = await importKpiObjectives(rows);
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

export default Kpi;
