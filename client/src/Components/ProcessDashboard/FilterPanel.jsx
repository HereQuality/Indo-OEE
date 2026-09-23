import React, { useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
import { SlidersHorizontal, X } from "lucide-react";
import DateRangeField from "./DateRangeField";
import { MONTH_LABELS, describeRange, isoDate, monthRange, parseIsoDate, yearRange, yearsOfExtent } from "../../utils/processDashboard";

/**
 * Components/ProcessDashboard/FilterPanel.jsx
 * ─────────────────────────────────────────────
 * The dashboard's one Filters button (a red dot once anything is filtered)
 * and the panel it opens — every way to slice the dashboard in one place, so
 * the header stays a single tidy row on any screen:
 *
 *   Period     Date range (calendar + quick ranges) · Month · Year
 *              — this is what gets LOADED from the server
 *   MC No. / Operator / Item
 *              — narrow what is already loaded, instantly
 *
 * A red Clear button sits right beside Filters. It is ALWAYS rendered — just
 * disabled and dimmed while nothing is filtered — so it never appears or
 * disappears and nothing in the header shifts when a filter is applied.
 *
 * Clicking a bar on the dashboard cross-filters through the same state, so a
 * machine picked on a chart shows up ticked in here and vice versa.
 */
const PERIOD_TABS = [
  { key: "range", label: "Date range" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
];

const periodTabOf = (range) => {
  const label = describeRange(range);
  if (/^\d{4}$/.test(label)) return "year";
  if (/^[A-Z][a-z]+ \d{4}$/.test(label)) return "month";
  return "range";
};

const MultiSelect = ({ label, options, selected, onChange, placeholder }) => (
  <div>
    <div className="pd-filter-label">{label}</div>
    <Select
      isMulti
      classNamePrefix="select"
      options={options}
      value={options.filter((o) => selected.includes(o.value))}
      onChange={(picked) => onChange((picked || []).map((o) => o.value))}
      placeholder={placeholder}
      noOptionsMessage={() => "Nothing in this period"}
      closeMenuOnSelect={false}
      menuPlacement="auto"
      isClearable
    />
  </div>
);

const FilterPanel = ({ range, onRangeChange, extent, filters, onFilterSet, options, active, onClearAll }) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(() => periodTabOf(range));
  const wrapperRef = useRef(null);

  // Both listeners run in the CAPTURE phase, i.e. before React's own handlers.
  // React 18 commits a handler's state update before the event bubbles up to
  // `document`, so a bubble-phase check sees the DOM *after* the click: a
  // react-select "clear ×" has already removed itself (so it looks like an
  // outside click and the panel shuts), and an open calendar or select menu
  // has already closed (so Escape shuts the panel in the same keypress).
  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    // Escape closes the innermost thing first: an open calendar or select
    // menu takes this keypress; the panel takes the next one.
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (wrapperRef.current?.querySelector(".react-datepicker-popper, .select__menu")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // Reopening shows the tab that matches what is applied.
  useEffect(() => {
    if (open) setTab(periodTabOf(range));
  }, [open]);

  const years = useMemo(() => yearsOfExtent(extent), [extent]);
  // The Month tab's year: the applied range's year.
  const [monthYear, setMonthYear] = useState(() => Number(range[0].slice(0, 4)));
  useEffect(() => setMonthYear(Number(range[0].slice(0, 4))), [range[0]]);
  const monthYears = years.includes(monthYear) ? years : [monthYear, ...years].sort((a, b) => b - a);

  const appliedLabel = describeRange(range);
  const thisMonth = isoDate(new Date()).slice(0, 7);

  return (
    <div ref={wrapperRef} className="pd-filter">
      <button type="button" className="pd-field-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label={active ? "Filters (active)" : "Filters"}>
        <SlidersHorizontal size={15} />
        Filters
        {active && <span className="pd-filter-dot" aria-hidden="true" />}
      </button>
      <button type="button" className="pd-clear-btn" onClick={onClearAll} disabled={!active} title={active ? "Clear all filters" : "No filters applied"}>
        <X size={14} /> Clear
      </button>

      {/* Kept mounted so an open calendar or half-typed select survives a close. */}
      <div className="pd-filter-pop" role="dialog" aria-label="Filters" hidden={!open}>
        <div className="d-flex align-items-center justify-content-between">
          <span className="fw-semibold">Filters</span>
          <button type="button" className="pd-icon-btn" onClick={() => setOpen(false)} aria-label="Close filters"><X size={16} /></button>
        </div>

        <div>
          <div className="pd-filter-label">Period</div>
          <div className="pd-seg" role="tablist" aria-label="Period type">
            {PERIOD_TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`pd-seg-btn ${tab === t.key ? "is-on" : ""}`} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === "range" && (
            <DateRangeField value={range} onChange={onRangeChange} maxDate={new Date()} minDate={extent ? parseIsoDate(`${extent.from.slice(0, 4)}-01-01`) : undefined} />
          )}

          {tab === "month" && (
            <>
              <select className="form-select form-select-sm mb-2" value={monthYear} onChange={(e) => setMonthYear(Number(e.target.value))} aria-label="Year">
                {monthYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <div className="pd-month-grid">
                {MONTH_LABELS.map((name, i) => {
                  const yyyymm = `${monthYear}-${String(i + 1).padStart(2, "0")}`;
                  return (
                    <button key={name} type="button" disabled={yyyymm > thisMonth} onClick={() => onRangeChange(monthRange(yyyymm))}
                      className={`pd-chip ${appliedLabel === `${name} ${monthYear}` ? "is-on" : ""}`}>
                      {name.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {tab === "year" && (
            <div className="pd-month-grid">
              {years.map((y) => (
                <button key={y} type="button" className={`pd-chip ${appliedLabel === String(y) ? "is-on" : ""}`} onClick={() => onRangeChange(yearRange(y))}>
                  {y}
                </button>
              ))}
            </div>
          )}
          <div className="pd-filter-note">Showing <b>{appliedLabel}</b></div>
        </div>

        <MultiSelect label="MC No." options={options.machine} selected={filters.machine} onChange={(v) => onFilterSet("machine", v)} placeholder="All machines" />
        <MultiSelect label="Operator" options={options.operator} selected={filters.operator} onChange={(v) => onFilterSet("operator", v)} placeholder="All operators" />
        <MultiSelect label="Part" options={options.item} selected={filters.item} onChange={(v) => onFilterSet("item", v)} placeholder="All parts" />

        <div className="d-flex justify-content-end pt-1">
          <button type="button" className="btn btn-primary btn-sm px-3" onClick={() => setOpen(false)}>Done</button>
        </div>
      </div>
    </div>
  );
};

export default FilterPanel;
