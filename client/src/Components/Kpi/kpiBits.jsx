import React, { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info, TrendingDown, TrendingUp } from "lucide-react";
import "./kpi.css";
import { Card, CardBody, Col, Input, Label } from "reactstrap";
import { MONTHS, UOMS, fmtPct } from "../../utils/kpi";

// Pieces the KPI and Company Level Objective pages share — built for a
// director-level read: big figures, one glance, no native dropdowns (their
// popups cover the page on Mac / iPad).

const STATUS_CLASS = { "On track": "bg-success-subtle text-success-emphasis", Near: "bg-warning-subtle text-warning-emphasis", Behind: "bg-danger-subtle text-danger-emphasis" };

export const StatusBadge = ({ status }) =>
  status ? <span className={`badge rounded-pill ${STATUS_CLASS[status] || "bg-secondary-subtle text-secondary-emphasis"}`}>{status}</span> : <span className="text-muted">—</span>;

// Achievement as a bar: full at 100%, coloured by status.
export const Progress = ({ pct, status, height = 6 }) => {
  if (pct === null || pct === undefined) return null;
  const width = Math.max(0, Math.min(100, pct));
  const colour = status === "On track" ? "bg-success" : status === "Near" ? "bg-warning" : "bg-danger";
  return (
    <div className="progress" style={{ height }} role="progressbar" aria-label="Achievement" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-bar ${colour}`} style={{ width: `${width}%` }} />
    </div>
  );
};

// A headline figure. `delta` is a % change against the previous period (null = none).
export const Stat = ({ label, value, hint, icon: Icon, tone = "primary", delta, deltaLabel, lg = 3 }) => {
  const up = delta !== null && delta !== undefined && delta >= 0;
  return (
    <Col xs="12" sm="6" lg={lg} className="mb-3">
      <Card className="h-100 mb-0 border-0 shadow-sm">
        <CardBody className="py-3">
          <div className="d-flex align-items-start justify-content-between gap-2">
            <div className="min-w-0">
              <div className="text-muted small text-uppercase" style={{ letterSpacing: ".04em" }}>{label}</div>
              <div className="fs-3 fw-bold text-truncate lh-sm mt-1">{value}</div>
            </div>
            {Icon && (
              <div className={`rounded-circle bg-${tone}-subtle text-${tone} d-flex align-items-center justify-content-center flex-shrink-0`} style={{ width: 40, height: 40 }} aria-hidden="true">
                <Icon size={20} />
              </div>
            )}
          </div>
          <div className="d-flex flex-wrap align-items-center gap-2 mt-1 small">
            {delta !== null && delta !== undefined && (
              <span className={`d-inline-flex align-items-center gap-1 fw-semibold ${up ? "text-success" : "text-danger"}`}>
                {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {up ? "+" : ""}{fmtPct(delta)}
                {deltaLabel && <span className="text-muted fw-normal">{deltaLabel}</span>}
              </span>
            )}
            {hint && <span className="text-muted">{hint}</span>}
          </div>
        </CardBody>
      </Card>
    </Col>
  );
};

// ‹ 2026 › — steps through `years` (ascending); the keyboard arrows work too.
export const YearStepper = ({ years, value, onChange, label = "Year" }) => {
  const list = [...new Set(years)].sort((a, b) => a - b);
  const i = list.indexOf(value);
  const prev = i > 0 ? list[i - 1] : null;
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  return (
    <div>
      {label && <div className="kpi-period__label">{label}</div>}
      <div className="kpi-year" role="group" aria-label={label || "Year"}>
        <button type="button" className="kpi-year__btn" onClick={() => onChange(prev)} disabled={prev === null} aria-label="Previous year"><ChevronLeft size={18} /></button>
        <span className="kpi-year__value" aria-live="polite">{value}</span>
        <button type="button" className="kpi-year__btn" onClick={() => onChange(next)} disabled={next === null} aria-label="Next year"><ChevronRight size={18} /></button>
      </div>
    </div>
  );
};

// Jan … Dec in a soft track; `hasData` marks the months with a figure.
// `allLabel` adds a first segment (value 0) for the whole year.
export const MonthSegments = ({ value, onChange, hasData = [], label = "Month", allLabel }) => (
  <div className="min-w-0">
    {label && <div className="kpi-period__label">{label}</div>}
    <div className="kpi-seg" role="tablist" aria-label={label || "Month"}>
      {allLabel && (
        <button type="button" role="tab" aria-selected={value === 0} className={`kpi-seg__btn kpi-seg__btn--all${value === 0 ? " is-active" : ""}`} onClick={() => onChange(0)}>{allLabel}</button>
      )}
      {MONTHS.map((m, i) => (
        <button key={m} type="button" role="tab" aria-selected={value === i + 1} className={`kpi-seg__btn${value === i + 1 ? " is-active" : ""}`} onClick={() => onChange(i + 1)}>
          {m}
          {hasData[i] && <span className="kpi-seg__dot" aria-hidden="true" />}
        </button>
      ))}
    </div>
  </div>
);

// The period bar both pages share: year, and the month when the page has one.
export const PeriodPicker = ({ years, year, onYear, month, onMonth, hasData, allLabel }) => (
  <div className="kpi-period">
    <YearStepper years={years} value={year} onChange={onYear} />
    {onMonth && <MonthSegments value={month} onChange={onMonth} hasData={hasData} allLabel={allLabel} />}
  </div>
);

// The forms' Year box: a dropdown over the given years (utils/kpi.js yearRange).
export const YearSelect = ({ id, years, value, onChange }) => (
  <Input id={id} type="select" value={value} onChange={(e) => onChange(Number(e.target.value))}>
    {years.map((y) => <option key={y} value={y}>{y}</option>)}
  </Input>
);

// A value with its own unit (Qty or %).
export const MeasureInput = ({ id, label, value, onChange, hint, required }) => (
  <div className="mb-3">
    <Label htmlFor={id} className="mb-1">{label}{required && <span className="text-danger"> *</span>}</Label>
    <div className="d-flex gap-2">
      <Input id={id} type="number" inputMode="decimal" min="0" step="any" className="flex-grow-1" value={value.value} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => onChange({ ...value, value: e.target.value })} placeholder="Value" />
      <div className="btn-group" role="group" aria-label={`${label} unit`}>
        {UOMS.map((u) => (
          <button key={u} type="button" className={`btn ${value.uom === u ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => onChange({ ...value, uom: u })} aria-pressed={value.uom === u}>{u}</button>
        ))}
      </div>
    </div>
    {hint && <div className="text-muted small mt-1">{hint}</div>}
  </div>
);

// A short "How this works", closed until asked for; remembered per browser.
export const HowItWorks = ({ storageKey, title = "How this page works", items }) => {
  const read = () => { try { return localStorage.getItem(storageKey) === "open"; } catch { return false; } };
  const [open, setOpen] = useState(read);
  const toggle = () => {
    setOpen((o) => { try { localStorage.setItem(storageKey, o ? "closed" : "open"); } catch { /* ignore */ } return !o; });
  };
  return (
    <div className={open ? "border rounded bg-light-subtle px-3 py-2 mb-3" : "mb-2"}>
      <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none d-inline-flex align-items-center gap-1 text-muted" onClick={toggle} aria-expanded={open}>
        <Info size={15} /> {title} {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <ol className="small mb-0 mt-2 ps-3">
          {items.map((t, i) => <li key={i} className="mb-1">{t}</li>)}
        </ol>
      )}
    </div>
  );
};

// % change from `prev` to `cur`; null when there's nothing to compare with.
export const deltaPct = (cur, prev) => (Number(prev) > 0 ? ((Number(cur) - Number(prev)) / Number(prev)) * 100 : null);
