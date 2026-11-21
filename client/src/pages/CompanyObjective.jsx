import React, { useContext, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, FileSpreadsheet, Layers, Pencil, Plus, Target, Trash2, TrendingDown, TrendingUp, Upload, Users, Wallet, Zap } from "lucide-react";
import { Card, CardBody, CardHeader, Col, Container, Input, InputGroup, InputGroupText, Label, Modal, ModalBody, ModalFooter, ModalHeader, Row } from "reactstrap";
import * as XLSX from "xlsx";
import DeleteModal from "../Components/Common/DeleteModal";
import ExcelImportModal from "../Components/Kpi/ExcelImportModal";
import { Gauge, InventoryBar, MonthBars, MonthLines, monthRows } from "../Components/Kpi/CompanyCharts";
import { HowItWorks, MeasureInput, MonthSegments, PeriodPicker, Progress, StatusBadge, YearSelect, deltaPct } from "../Components/Kpi/kpiBits";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { createCompanyObjective, deleteCompanyObjective, getCompanySummary, importCompanyHistory, saveCompanyMonthly, updateCompanyObjective } from "../api/kpi.api";
import { MONTHS, blankMeasure, fmtPct, fmtQty, measureText, thisMonth, thisYear, yearOptions, yearRange } from "../utils/kpi";
import { METRICS, METRIC_GROUPS, SERIES, fmtMetric, fmtMoneyFull, fmtMoneyShort, fmtRatio, unitLabel } from "../utils/companyMetrics";

/**
 * Data Entry › Company Level Objective — the company board for the CEO / MD,
 * laid out like the Power BI one it replaces: headline tiles (Sales, Salary,
 * Electricity, Sales vs Target, OK Qty) for the year or one month, the
 * month-wise charts (sales & target, order booking, costs, labour
 * productivity, inventory turnover, OK Qty), FG / RM / WIP, on-time delivery,
 * complaints, then the objectives and the monthly figures behind it all.
 *
 * OK Qty is summed from the data entries; the business figures are typed per
 * month (Monthly Figures) or loaded from an old sheet (Upload Excel).
 */
const emptyForm = (year) => ({ objective: "", year, target: blankMeasure(), baseline: blankMeasure(), owner: "", remarks: "" });

const HELP = [
  "Pick the Year, then Whole year or one month — every tile and chart follows. Tap a bar or a month row to jump to that month.",
  "Monthly Figures: type the month's Sales, Target Sales, Order Booking, Salary, Electricity Bill, FG / RM / WIP value, Inventory Turnover, On Time Delivery % and Customer Complaints. Leave what you don't track blank.",
  "OK Qty is the whole company: every process's data entries added up. Nobody types it. Labour Productivity is Sales ÷ Salary.",
  "Money and counts add up over the year; percentages, ratios and stock values are averaged over the months that have a figure.",
  "Add Objective: a company-level objective with its Target (sales) and Baseline. Achieved % compares the year's OK Qty with a Target in Qty; On track from 100%, Near from 80%, Behind below.",
  "Upload Excel loads old years — one row per month with any of the figures; a month that already has data entries keeps the entries for OK Qty. Excel downloads everything shown for the year.",
];

const IMPORT_COLUMNS = [
  { key: "year", label: "Year", required: true },
  { key: "month", label: "Month", required: true, hint: "Jan, January or 1" },
  { key: "okQty", label: "OK Qty", hint: "the whole company's OK Qty — only used for months with no data entries" },
  ...METRICS.map((m) => ({ key: m.key, label: m.label, hint: m.unit === "₹" ? "in ₹" : m.unit === "%" ? "0–100" : m.unit === "ratio" ? "times a year" : "number", hideInPreview: !["sales", "targetSales", "salary", "electricityBill"].includes(m.key) })),
];
const IMPORT_SAMPLE = { year: 2025, month: "Jan", okQty: 185000, sales: 20500000, targetSales: 22000000, orderBooking: 21000000, salary: 1150000, electricityBill: 62000, fgValue: 27000000, rmValue: 24600000, wipValue: 23900000, inventoryTurnover: 6.4, onTimeDelivery: 87.5, customerComplaints: 16 };

const TILE_ICON = { sales: Banknote, salary: Users, electricityBill: Zap, okQty: Layers };

// A headline figure: label, big value, change vs the previous period, a line under.
const Tile = ({ label, value, full, icon: Icon, tone = "primary", delta, deltaLabel, hint }) => {
  const up = delta !== null && delta !== undefined && delta >= 0;
  return (
    <Col>
      <Card className="co-tile mb-0">
        <CardBody className="py-3 px-3">
          <div className="d-flex align-items-start justify-content-between gap-2">
            <div className="co-tile__label text-truncate">{label}</div>
            {Icon && <span className={`rounded-circle bg-${tone}-subtle text-${tone} d-inline-flex align-items-center justify-content-center flex-shrink-0`} style={{ width: 30, height: 30 }} aria-hidden="true"><Icon size={16} /></span>}
          </div>
          <div className="co-tile__value mt-1 text-truncate" title={full || undefined}>{value}</div>
          <div className="d-flex flex-wrap align-items-center gap-2 mt-1 co-tile__sub">
            {delta !== null && delta !== undefined && (
              <span className={`d-inline-flex align-items-center gap-1 fw-semibold ${up ? "text-success" : "text-danger"}`}>
                {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{up ? "+" : ""}{fmtPct(delta)}
                {deltaLabel && <span className="text-muted fw-normal">{deltaLabel}</span>}
              </span>
            )}
            {hint && <span className="text-truncate">{hint}</span>}
          </div>
        </CardBody>
      </Card>
    </Col>
  );
};

const Panel = ({ title, aside, children, className = "" }) => (
  <Card className={`mb-0 h-100 border-0 shadow-sm ${className}`}>
    <CardHeader className="bg-transparent d-flex flex-wrap justify-content-between align-items-center gap-2 py-2"><h6 className="mb-0">{title}</h6>{aside && <span className="text-muted small">{aside}</span>}</CardHeader>
    <CardBody className="pt-2 pb-2">{children}</CardBody>
  </Card>
);

const CompanyObjective = () => {
  const toast = useAlert();
  const { currentPagePermissions = { view: true, create: true, edit: true, delete: true } } = useContext(MenuContext) || {};
  const canWrite = currentPagePermissions.create || currentPagePermissions.edit;
  const [year, setYear] = useState(thisYear());
  const [month, setMonth] = useState(thisMonth()); // 0 = whole year
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [values, setValues] = useState(emptyForm(year));
  const [saving, setSaving] = useState(false);
  const [removeId, setRemoveId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [figOpen, setFigOpen] = useState(false);
  const [figMonth, setFigMonth] = useState(thisMonth());
  const [figValues, setFigValues] = useState({});
  const [figSaving, setFigSaving] = useState(false);

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

  // ── objectives ──
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

  // ── monthly figures ──
  const monthly = summary?.monthly || [];
  const storedFor = (m) => monthly.find((r) => r.month === m)?.values || {};
  const openFigures = (m = month || thisMonth()) => {
    setFigMonth(m);
    setFigValues(Object.fromEntries(METRICS.map((x) => [x.key, storedFor(m)[x.key] ?? ""])));
    setFigOpen(true);
  };
  const pickFigMonth = (m) => { setFigMonth(m); setFigValues(Object.fromEntries(METRICS.map((x) => [x.key, storedFor(m)[x.key] ?? ""]))); };
  const saveFigures = async () => {
    setFigSaving(true);
    try {
      const res = await saveCompanyMonthly({ year, month: figMonth, values: figValues });
      toast.success(res?.data?.message || "Monthly figures saved");
      setFigOpen(false);
      await load();
    } catch (ex) {
      toast.error(ex?.response?.data?.message || "Could not save the figures");
    } finally {
      setFigSaving(false);
    }
  };

  // ── the figures in scope (whole year or one month) ──
  const metrics = summary?.metrics || {};
  const byMonth = summary?.byMonth || [];
  const byYear = summary?.byYear || [];
  const objectives = summary?.objectives || [];
  const scopeLabel = month ? `${MONTHS[month - 1]} ${year}` : `${year}`;
  const prevLabel = month ? (month > 1 ? `vs ${MONTHS[month - 2]}` : "") : `vs ${year - 1}`;
  const val = (key) => (month ? metrics[key]?.months?.[month - 1] ?? null : metrics[key]?.year ?? null);
  const prev = (key) => (month ? (month > 1 ? metrics[key]?.months?.[month - 2] ?? null : null) : metrics[key]?.prevYear ?? null);
  const okInScope = month ? byMonth[month - 1]?.okQty ?? 0 : summary?.yearOkQty ?? 0;
  const okPrev = month ? (month > 1 ? byMonth[month - 2]?.okQty ?? null : null) : byYear.find((y) => y.year === year - 1)?.okQty ?? null;
  const sales = val("sales"), target = val("targetSales");
  const salesPct = target > 0 && sales !== null ? (sales / target) * 100 : null;
  const salesGap = target > 0 && sales !== null ? sales - target : null;
  const monthsWithSales = metrics.sales?.monthsWithData || 0;
  const avgMonthlySales = monthsWithSales ? metrics.sales.year / monthsWithSales : null;
  const monthsWithComplaints = metrics.customerComplaints?.monthsWithData || 0;
  const avgComplaints = monthsWithComplaints ? metrics.customerComplaints.year / monthsWithComplaints : null;
  const years = useMemo(() => yearOptions(byYear.map((y) => y.year)), [byYear]);
  const rows = useMemo(() => monthRows(year, metrics, byMonth), [year, metrics, byMonth]);
  const hasFigures = (summary?.monthsWithFigures || []).map((f, i) => f || byMonth[i]?.okQty > 0);
  const lp = metrics.labourProductivity;

  const downloadExcel = () => {
    const wb = XLSX.utils.book_new();
    const obj = [
      ["Objective", "Owner", "Baseline", "Unit", "Target (sales)", "Unit", `OK Qty ${year}`, "Achieved %", "Status", "Remarks"],
      ...objectives.map((o) => [o.objective, o.owner || "", o.baseline?.value ?? "", o.baseline?.uom || "", o.target?.value ?? "", o.target?.uom || "", summary?.yearOkQty ?? 0, o.achievedPct === null ? "" : Number(o.achievedPct.toFixed(1)), o.status || "", o.remarks || ""]),
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(obj);
    ws1["!cols"] = [{ wch: 36 }, { wch: 18 }, { wch: 12 }, { wch: 6 }, { wch: 14 }, { wch: 6 }, { wch: 14 }, { wch: 11 }, { wch: 10 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws1, `Objectives ${year}`);
    const fig = [
      ["Month", "OK Qty", ...METRICS.map((m) => `${m.label}${m.unit === "₹" ? " (₹)" : m.unit === "%" ? " (%)" : ""}`), "Labour Productivity (Sales ÷ Salary)"],
      ...rows.map((r) => [`${r.name} ${year}`, r.okQty, ...METRICS.map((m) => r[m.key] ?? ""), lp?.months?.[r.month - 1] === null || lp?.months?.[r.month - 1] === undefined ? "" : Number(lp.months[r.month - 1].toFixed(2))]),
      ["Year", summary?.yearOkQty ?? 0, ...METRICS.map((m) => (metrics[m.key]?.year ?? "") === "" ? "" : Number(metrics[m.key].year.toFixed(2))), lp?.year === null || lp?.year === undefined ? "" : Number(lp.year.toFixed(2))],
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(fig);
    ws2["!cols"] = [{ wch: 12 }, { wch: 12 }, ...METRICS.map(() => ({ wch: 18 })), { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws2, `Monthly figures ${year}`);
    const yrs = [["Year", "OK Qty"], ...byYear.map((y) => [y.year, y.okQty]), ["All", summary?.totalOkQty ?? 0]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(yrs), "OK Qty by year");
    XLSX.writeFile(wb, `Company-Level-Objective-${year}.xlsx`);
  };

  return (
    <Container fluid className="px-2 px-md-3">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div>
          <h4 className="mb-0">Company Level Objective</h4>
          <div className="text-muted small">Sales, costs, inventory, delivery and OK Qty against the year's objectives</div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline-success btn-sm d-inline-flex align-items-center gap-1" onClick={downloadExcel} disabled={!summary}><FileSpreadsheet size={16} /> Excel</button>
          {canWrite && (
            <>
              <button type="button" className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1" onClick={() => setImportOpen(true)}><Upload size={16} /> Upload Excel</button>
              <button type="button" className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1" onClick={() => openFigures()}><Pencil size={16} /> Monthly Figures</button>
            </>
          )}
          {currentPagePermissions.create && <button type="button" className="btn btn-primary btn-sm d-inline-flex align-items-center gap-1" onClick={openAdd}><Plus size={16} /> Add Objective</button>}
        </div>
      </div>
      <HowItWorks storageKey="company-objective-help" items={HELP} />

      <Card className="mb-3 border-0 shadow-sm">
        <CardBody className="py-2">
          <PeriodPicker years={years} year={year} onYear={setYear} month={month} onMonth={setMonth} hasData={hasFigures} allLabel="Whole year" />
        </CardBody>
      </Card>

      {/* Headline tiles */}
      <Row className="row-cols-2 row-cols-md-3 row-cols-xl-5 g-2 mb-3">
        <Tile label={`Total Sales · ${scopeLabel}`} value={fmtMoneyShort(sales)} full={fmtMoneyFull(sales)} icon={TILE_ICON.sales} tone="primary" delta={deltaPct(sales, prev("sales"))} deltaLabel={prevLabel} hint={sales === null ? "no figure yet" : ""} />
        <Tile label={`Total Salary · ${scopeLabel}`} value={fmtMoneyShort(val("salary"))} full={fmtMoneyFull(val("salary"))} icon={TILE_ICON.salary} tone="secondary" delta={deltaPct(val("salary"), prev("salary"))} deltaLabel={prevLabel} hint={lp && val("labourProductivity") !== null ? `productivity ${fmtRatio(val("labourProductivity"))}×` : ""} />
        <Tile label={`Electricity Bill · ${scopeLabel}`} value={fmtMoneyShort(val("electricityBill"))} full={fmtMoneyFull(val("electricityBill"))} icon={TILE_ICON.electricityBill} tone="warning" delta={deltaPct(val("electricityBill"), prev("electricityBill"))} deltaLabel={prevLabel} />
        <Tile label="Sales vs Target" value={salesPct === null ? "—" : fmtPct(salesPct)} icon={Target} tone={salesPct === null ? "secondary" : salesPct >= 100 ? "success" : salesPct >= 80 ? "warning" : "danger"} hint={target > 0 ? `${salesGap >= 0 ? "+" : "−"}${fmtMoneyShort(Math.abs(salesGap))} vs target ${fmtMoneyShort(target)}` : "set Target Sales in Monthly Figures"} />
        <Tile label={`OK Qty · ${scopeLabel}`} value={fmtQty(okInScope)} icon={TILE_ICON.okQty} tone="info" delta={deltaPct(okInScope, okPrev)} deltaLabel={prevLabel} hint="all processes, from entries" />
      </Row>

      {/* Month-wise charts */}
      <Row className="g-3 mb-3">
        <Col xs="12" lg="6" xl="4">
          <Panel title={`Sales & Target by month · ${year}`} aside="₹ · tap a bar">
            <MonthBars data={rows} series={[{ key: "sales", label: "Sales", color: SERIES.sales, metricKey: "sales" }]} target={{ key: "targetSales", label: "Target Sales", color: SERIES.targetSales, metricKey: "targetSales", dashed: true }} selected={month} onPick={setMonth} />
          </Panel>
        </Col>
        <Col xs="12" lg="6" xl="4">
          <Panel title={`Order Booking vs Sales · ${year}`} aside="₹">
            <MonthBars data={rows} series={[{ key: "orderBooking", label: "Order Booking", color: SERIES.orderBooking, metricKey: "orderBooking" }, { key: "sales", label: "Sales", color: SERIES.sales, metricKey: "sales" }]} selected={month} onPick={setMonth} />
          </Panel>
        </Col>
        <Col xs="12" lg="6" xl="4">
          <Panel title={`Salary & Electricity by month · ${year}`} aside="₹">
            <MonthBars data={rows} series={[{ key: "salary", label: "Total Salary", color: SERIES.salary, metricKey: "salary" }, { key: "electricityBill", label: "Electricity Bill", color: SERIES.electricityBill, metricKey: "electricityBill" }]} selected={month} onPick={setMonth} />
          </Panel>
        </Col>
        <Col xs="12" lg="6" xl="4">
          <Panel title={`Labour Productivity · ${year}`} aside="Sales ÷ Salary">
            <MonthLines data={rows} series={[{ key: "labourProductivity", label: "Labour Productivity", color: SERIES.line, fmtFull: (v) => `${fmtRatio(v)}×` }]} yFmt={fmtRatio} />
          </Panel>
        </Col>
        <Col xs="12" lg="6" xl="4">
          <Panel title={`Inventory Turnover · ${year}`} aside="times a year">
            <MonthLines data={rows} series={[{ key: "inventoryTurnover", label: "Inventory Turnover", color: SERIES.line, metricKey: "inventoryTurnover" }]} yFmt={fmtRatio} />
          </Panel>
        </Col>
        <Col xs="12" lg="6" xl="4">
          <Panel title={`OK Qty by month · ${year}`} aside="from entries · tap a bar">
            <MonthBars data={rows} series={[{ key: "okQty", label: "OK Qty", color: SERIES.okQty, fmtFull: fmtQty }]} yFmt={fmtMoneyShort} selected={month} onPick={setMonth} />
          </Panel>
        </Col>
      </Row>

      {/* Inventory, delivery, complaints, years */}
      <Row className="g-3 mb-3">
        <Col xs="12" lg="5">
          <Panel title={`FG · RM · WIP · ${scopeLabel}`} aside={month ? "stock value" : "average stock value"}>
            <InventoryBar parts={[{ key: "fgValue", label: "FG", color: SERIES.fgValue, value: val("fgValue") }, { key: "rmValue", label: "RM", color: SERIES.rmValue, value: val("rmValue") }, { key: "wipValue", label: "WIP", color: SERIES.wipValue, value: val("wipValue") }]} />
          </Panel>
        </Col>
        <Col xs="12" sm="6" lg="3">
          <Panel title="On Time Delivery" aside={scopeLabel}>
            <Gauge value={val("onTimeDelivery")} label="On time delivery" />
            <div className="text-center small text-muted mt-1">{prev("onTimeDelivery") !== null && val("onTimeDelivery") !== null ? `${prevLabel} ${fmtPct(prev("onTimeDelivery"))}` : month ? "" : `${metrics.onTimeDelivery?.monthsWithData || 0} month${metrics.onTimeDelivery?.monthsWithData === 1 ? "" : "s"} averaged`}</div>
          </Panel>
        </Col>
        <Col xs="12" sm="6" lg="4">
          <Row className="g-2 h-100">
            <Col xs="12"><Card className="co-tile mb-0"><CardBody className="py-3">
              <div className="d-flex justify-content-between"><div className="co-tile__label">Average Monthly Sales · {year}</div><Wallet size={16} className="text-primary" /></div>
              <div className="co-tile__value mt-1" title={fmtMoneyFull(avgMonthlySales)}>{fmtMoneyShort(avgMonthlySales)}</div>
              <div className="co-tile__sub">{monthsWithSales ? `over ${monthsWithSales} month${monthsWithSales === 1 ? "" : "s"} with sales` : "no sales figure yet"}</div>
            </CardBody></Card></Col>
            <Col xs="12"><Card className="co-tile mb-0"><CardBody className="py-3">
              <div className="d-flex justify-content-between"><div className="co-tile__label">{month ? `Customer Complaints · ${scopeLabel}` : `Average Customer Complaints · ${year}`}</div><AlertTriangle size={16} className="text-danger" /></div>
              <div className="co-tile__value mt-1">{month ? fmtQty(val("customerComplaints")) : avgComplaints === null ? "—" : fmtRatio(avgComplaints)}</div>
              <div className="co-tile__sub">{month ? (prev("customerComplaints") !== null ? `${prevLabel} ${fmtQty(prev("customerComplaints"))}` : "") : monthsWithComplaints ? `${fmtQty(metrics.customerComplaints.year)} in ${monthsWithComplaints} month${monthsWithComplaints === 1 ? "" : "s"}` : "no figure yet"}</div>
            </CardBody></Card></Col>
          </Row>
        </Col>
      </Row>

      {/* Objectives */}
      <Card className="mb-3 border-0 shadow-sm">
        <CardHeader className="bg-transparent py-2"><h6 className="mb-0">Objectives · {year}</h6></CardHeader>
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

      {/* Monthly figures and years */}
      <Row className="g-3 mb-3">
        <Col xs="12" xl="9">
          <Card className="mb-0 h-100 border-0 shadow-sm">
            <CardHeader className="bg-transparent d-flex flex-wrap justify-content-between align-items-center gap-2 py-2"><h6 className="mb-0">Monthly figures · {year}</h6><span className="text-muted small">tap a row to pick the month{canWrite ? " · pencil to edit" : ""}</span></CardHeader>
            <CardBody className="p-0">
              <div className="table-responsive">
                <table className="table table-sm table-hover mb-0 align-middle co-figures">
                  <thead className="table-light">
                    <tr>
                      <th scope="col" className="position-sticky start-0 bg-light">Month</th>
                      <th scope="col" className="text-end">OK Qty</th>
                      {METRICS.map((m) => <th key={m.key} scope="col" className="text-end" title={m.label}>{m.label.replace(/ \(.*\)/, "")}{m.unit === "%" ? " %" : m.unit === "₹" ? " ₹" : ""}</th>)}
                      <th scope="col" className="text-end" title="Sales ÷ Salary">Labour prod.</th>
                      {canWrite && <th scope="col" />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.month} className={r.month === month ? "table-primary" : ""} onClick={() => setMonth(r.month)} style={{ cursor: "pointer" }}>
                        <td className={`fw-semibold position-sticky start-0 ${r.month === month ? "" : "bg-body"}`}>{r.name} {year}</td>
                        <td className="text-end">{fmtQty(r.okQty)}{byMonth[r.month - 1]?.source === "excel" && <span className="badge bg-secondary-subtle text-secondary-emphasis ms-1" title="Loaded from Excel">Excel</span>}</td>
                        {METRICS.map((m) => <td key={m.key} className={`text-end ${r[m.key] === null || r[m.key] === undefined ? "is-blank" : ""}`} title={m.unit === "₹" ? fmtMoneyFull(r[m.key]) : undefined}>{fmtMetric(m, r[m.key])}</td>)}
                        <td className="text-end">{lp?.months?.[r.month - 1] === null || lp?.months?.[r.month - 1] === undefined ? <span className="is-blank text-muted">—</span> : `${fmtRatio(lp.months[r.month - 1])}×`}</td>
                        {canWrite && <td className="text-end"><button type="button" className="btn btn-sm btn-light border" aria-label={`Edit ${r.name} ${year} figures`} onClick={(e) => { e.stopPropagation(); openFigures(r.month); }}><Pencil size={14} /></button></td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="table-light">
                    <tr>
                      <th scope="row" className="position-sticky start-0 bg-light">Year</th>
                      <td className="text-end fw-bold">{fmtQty(summary?.yearOkQty ?? 0)}</td>
                      {METRICS.map((m) => <td key={m.key} className="text-end fw-bold" title={`${m.agg === "avg" ? "Average" : "Total"}${m.unit === "₹" ? ` · ${fmtMoneyFull(metrics[m.key]?.year)}` : ""}`}>{fmtMetric(m, metrics[m.key]?.year)}</td>)}
                      <td className="text-end fw-bold">{lp?.year === null || lp?.year === undefined ? "—" : `${fmtRatio(lp.year)}×`}</td>
                      {canWrite && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="text-muted small px-3 py-2">Year row: money and counts are totals; %, turnover and stock values are averages of the months with a figure.</div>
            </CardBody>
          </Card>
        </Col>
        <Col xs="12" xl="3">
          <Panel title="OK Qty by year" aside="all time">
            <div className="table-responsive">
              <table className="table table-sm table-hover mb-0 align-middle">
                <thead className="table-light"><tr><th scope="col">Year</th><th scope="col" className="text-end">OK Qty</th><th scope="col" className="text-end">vs prev.</th></tr></thead>
                <tbody>
                  {byYear.map((y, i) => {
                    const d = i > 0 ? deltaPct(y.okQty, byYear[i - 1].okQty) : null;
                    return (
                      <tr key={y.year} className={y.year === year ? "table-primary" : ""} onClick={() => setYear(y.year)} style={{ cursor: "pointer" }}>
                        <td className="fw-semibold">{y.year}</td>
                        <td className="text-end">{fmtQty(y.okQty)}</td>
                        <td className={`text-end ${d === null ? "text-muted" : d >= 0 ? "text-success" : "text-danger"}`}>{d === null ? "—" : `${d >= 0 ? "+" : ""}${fmtPct(d)}`}</td>
                      </tr>
                    );
                  })}
                  {!byYear.length && <tr><td colSpan="3" className="text-muted">No entries yet.</td></tr>}
                </tbody>
                <tfoot className="table-light"><tr><th scope="row">All</th><td className="text-end fw-bold">{fmtQty(summary?.totalOkQty ?? 0)}</td><td /></tr></tfoot>
              </table>
            </div>
            {byYear.length === 1 && <div className="text-muted small mt-2">One year of entries so far — upload old years with Upload Excel to compare year on year.</div>}
          </Panel>
        </Col>
      </Row>

      {/* Objective form */}
      <Modal isOpen={modal} toggle={() => setModal(false)} centered scrollable size="lg">
        <ModalHeader toggle={() => setModal(false)}>{editId ? "Update Objective" : "Add Objective"}</ModalHeader>
        <ModalBody>
          <div className="mb-3">
            <Label htmlFor="co-objective" className="mb-1">Objective <span className="text-danger">*</span></Label>
            <Input id="co-objective" value={values.objective} maxLength={200} onChange={(e) => setValues({ ...values, objective: e.target.value })} placeholder="e.g. Grow sales by 20%" />
          </div>
          <Row>
            <Col xs="12" sm="4" className="mb-3">
              <Label htmlFor="co-year" className="mb-1">Year</Label>
              <YearSelect id="co-year" years={yearRange([values.year])} value={values.year} onChange={(y) => setValues({ ...values, year: y })} />
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

      {/* Monthly figures form */}
      <Modal isOpen={figOpen} toggle={() => setFigOpen(false)} centered scrollable size="lg">
        <ModalHeader toggle={() => setFigOpen(false)}>Monthly Figures · {year}</ModalHeader>
        <ModalBody>
          <div className="mb-3">
            <MonthSegments value={figMonth} onChange={pickFigMonth} hasData={summary?.monthsWithFigures || []} />
            <div className="text-muted small mt-1">Figures for <strong>{MONTHS[figMonth - 1]} {year}</strong>. Leave blank what you don't track; a blank clears the stored figure.{monthly.find((r) => r.month === figMonth)?.updatedByName && <> Last saved by {monthly.find((r) => r.month === figMonth).updatedByName}.</>}</div>
          </div>
          {METRIC_GROUPS.map((g) => (
            <div key={g} className="mb-2">
              <div className="kpi-period__label">{g}</div>
              <Row className="g-2">
                {METRICS.filter((m) => m.group === g).map((m) => (
                  <Col key={m.key} xs="12" sm="6" md="4">
                    <Label htmlFor={`fig-${m.key}`} className="mb-1 small">{m.label}</Label>
                    <InputGroup size="sm">
                      {m.unit === "₹" && <InputGroupText>₹</InputGroupText>}
                      <Input id={`fig-${m.key}`} type="number" inputMode="decimal" min="0" max={m.unit === "%" ? 100 : undefined} step="any" value={figValues[m.key] ?? ""} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setFigValues({ ...figValues, [m.key]: e.target.value })} placeholder={m.unit === "₹" ? "0" : m.unit === "%" ? "0–100" : ""} />
                      {m.unit !== "₹" && unitLabel(m.unit) && <InputGroupText>{unitLabel(m.unit)}</InputGroupText>}
                    </InputGroup>
                    {m.unit === "₹" && figValues[m.key] !== "" && Number.isFinite(Number(figValues[m.key])) && <div className="text-muted" style={{ fontSize: ".72rem" }}>{fmtMoneyFull(figValues[m.key])} · {fmtMoneyShort(figValues[m.key])}</div>}
                  </Col>
                ))}
              </Row>
            </div>
          ))}
          <div className="text-muted small mt-2">Labour Productivity (Sales ÷ Salary) and OK Qty are worked out — nothing to type.</div>
        </ModalBody>
        <ModalFooter>
          <button type="button" className="btn btn-light" onClick={() => setFigOpen(false)} disabled={figSaving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={saveFigures} disabled={figSaving}>{figSaving ? "Saving…" : `Save ${MONTHS[figMonth - 1]} ${year}`}</button>
        </ModalFooter>
      </Modal>

      <DeleteModal show={!!removeId} handleDelete={remove} toggle={() => setRemoveId(null)} disabled={deleting} />
      <ExcelImportModal
        isOpen={importOpen}
        toggle={() => { setImportOpen(false); load(); }}
        title="Upload old company figures from Excel"
        intro="Load past months from your existing sheets — one row per month with any of the figures: OK Qty, Sales, Target Sales, Order Booking, Salary, Electricity Bill, FG / RM / WIP, Inventory Turnover, On Time Delivery %, Customer Complaints. Blank cells leave a stored figure as it is."
        columns={IMPORT_COLUMNS}
        sample={IMPORT_SAMPLE}
        templateName="Company-figures-upload-template"
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
