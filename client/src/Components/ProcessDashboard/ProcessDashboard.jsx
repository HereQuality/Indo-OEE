import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarRange, LayoutDashboard, X } from "lucide-react";
import { Button, Modal, ModalBody, ModalFooter, ModalHeader, Spinner } from "reactstrap";
import { ThemeContext } from "../../context/ThemeContext";
import { MenuContext } from "../../context/MenuContext";
import { useAlert } from "../../context/AlertContext";
import { getDashboardEntries, updateProcess } from "../../api/processes.api";
import { useInvalidateProcesses } from "../../hooks/useProcesses";
import {
  CHARTS_BY_KEY, DEFAULT_CHARTS, DEFAULT_STATS, DIMENSIONS, EMPTY_FILTERS, FORMATS, MAX_RANGE_DAYS, STATS_BY_KEY,
  applyFilters, defaultRange, describeRange, hasFilters, quickRangeKey, QUICK_RANGES, rangeDays, resolveWidgets,
  statMeasure, summarize, timeBucket, toggleFilter,
} from "../../utils/processDashboard";
import { THEME } from "./chartTheme";
import { CHART_COMPONENTS, TABLE_ONLY } from "./charts";
import WidgetCard from "./WidgetCard";
import WidgetPicker from "./WidgetPicker";
import DrillModal from "./DrillModal";
import FilterPanel from "./FilterPanel";
import "./processDashboard.css";

/**
 * Components/ProcessDashboard/ProcessDashboard.jsx
 * ──────────────────────────────────────────────────
 * One process's dashboard (or every machine, when `process` is null).
 *
 * Works like a Power BI page: the entries for the chosen period are loaded
 * once (this is the only place they are requested — the landing page loads
 * none), and everything after that — the Filters panel's machine / operator /
 * item picks, clicking a bar to cross-filter, drill-downs — is computed in
 * the browser, so it responds instantly and every tile and graph always
 * agrees on the same slice.
 *
 * Which tiles and graphs appear, and in what order, comes from the process
 * (Production > Processes); SuperAdmin can also change them here via
 * Customize.
 */
// "All machines" (process === null) has no Process document of its own to
// save a widget selection on, so Super Admin's Customize picks here are kept
// in this browser's localStorage instead of the server — same shape as a
// process's own {stats, charts}, just not shared across devices/users.
const ALL_MACHINES_WIDGETS_KEY = "allMachinesDashboardWidgets";
const loadAllMachinesWidgets = () => {
  try {
    const raw = window.localStorage.getItem(ALL_MACHINES_WIDGETS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const ProcessDashboard = ({ process, machines, onBack }) => {
  const toast = useAlert();
  const { isDarkMode } = useContext(ThemeContext) || {};
  const { isAdmin } = useContext(MenuContext) || {};
  const c = isDarkMode ? THEME.dark : THEME.light;
  const invalidateProcesses = useInvalidateProcesses();

  const [range, setRange] = useState(defaultRange);
  // The range "no period filter" means, fixed when it was taken. Comparing
  // against a freshly computed "last 30 days" instead would turn an untouched
  // dashboard into an "active filter" the moment the date rolls past midnight.
  const [baseRange, setBaseRange] = useState(range);
  // First and last date this process has any entry on — feeds the panel's years.
  const [extent, setExtent] = useState(null);
  // Names for the machines in the loaded entries, including deactivated ones.
  const [entryMachineNames, setEntryMachineNames] = useState({});
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [drill, setDrill] = useState(null);
  const [customizing, setCustomizing] = useState(null); // { stats, charts } while the picker is open
  const [saving, setSaving] = useState(false);
  const [allMachinesWidgets, setAllMachinesWidgets] = useState(loadAllMachinesWidgets);

  const processId = process?._id;
  const [from, to] = range;

  useEffect(() => {
    if (!from || !to || to < from) return undefined;
    let stale = false;
    setLoading(true);
    getDashboardEntries({ from, to, process: processId })
      .then((res) => {
        if (stale) return;
        // A date/month clicked on the old (dimmed) view while this was loading
        // belongs to the old period — drop it together with the swap.
        setFilters((f) => (f.date.length || f.month.length ? { ...f, date: [], month: [] } : f));
        setRows(res.data.data || []);
        setExtent(res.data.extent || null);
        setEntryMachineNames(res.data.machineNames || {});
      })
      .catch((err) => {
        if (stale) return;
        toast.error(err?.response?.data?.message || "Failed to load entries");
        setRows([]);
      })
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [from, to, processId]);

  // A new period keeps the machine / operator / item picks (like a slicer
  // would) but drops a clicked date or month, which may not be in it at all.
  useEffect(() => setFilters((f) => (f.date.length || f.month.length ? { ...f, date: [], month: [] } : f)), [from, to]);

  const ctx = useMemo(
    () => ({ machineName: { ...entryMachineNames, ...Object.fromEntries(machines.map((m) => [m._id, m.machineName])) }, bucket: timeBucket(rows) }),
    [machines, rows, entryMachineNames],
  );

  // rowsFor(dim): everything filtered except `dim` itself — see applyFilters.
  const rowsByDim = useMemo(() => {
    const cache = { null: applyFilters(rows, filters) };
    for (const dim of Object.keys(DIMENSIONS)) cache[dim] = filters[dim].length ? applyFilters(rows, filters, dim) : cache.null;
    return cache;
  }, [rows, filters]);
  const rowsFor = useCallback((dim) => rowsByDim[dim ?? "null"], [rowsByDim]);
  const filtered = rowsByDim.null;

  const summary = useMemo(() => summarize(filtered), [filtered]);

  // What the panel's pickers offer: the values present in the loaded period,
  // plus anything already picked (so a pick never vanishes from its own list).
  const filterOptions = useMemo(() => {
    const options = (dim) =>
      // "" is a real bucket — "(no operator)" / "(no item)" — that a chart or
      // drill-down can pick, so it is offered like any other value.
      [...new Set([...rows.map(DIMENSIONS[dim].value), ...filters[dim]])]
        .map((value) => ({ value, label: DIMENSIONS[dim].text(value, ctx) }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    return { machine: options("machine"), operator: options("operator"), item: options("item") };
  }, [rows, ctx, filters]);

  const onToggle = useCallback((dim, value) => setFilters((f) => toggleFilter(f, dim, value)), []);
  const onFilterSet = useCallback((dim, values) => setFilters((f) => ({ ...f, [dim]: values })), []);

  const onRangeChange = useCallback((next) => {
    if (rangeDays(next) > MAX_RANGE_DAYS) {
      toast.error("That period is longer than 5 years — pick a shorter one.");
      return;
    }
    setRange(next);
  }, []);

  const isDefaultRange = range.join() === baseRange.join();
  // The untouched default is "this month" — named after the actual month
  // (e.g. "September 2026"), not a generic "Last 30 days"/"This month" label.
  const periodLabel = isDefaultRange ? describeRange(range) : QUICK_RANGES.find((q) => q.key === quickRangeKey(range))?.label || describeRange(range);
  const filtersActive = !isDefaultRange || hasFilters(filters);
  const resetRange = () => {
    const fresh = defaultRange();
    setBaseRange(fresh);
    setRange(fresh);
  };
  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    resetRange();
  };

  const stats = resolveWidgets(process ? process.stats : allMachinesWidgets?.stats, STATS_BY_KEY, DEFAULT_STATS);
  const charts = resolveWidgets(process ? process.charts : allMachinesWidgets?.charts, CHARTS_BY_KEY, DEFAULT_CHARTS);

  const saveCustomize = () => {
    if (!process) {
      // No Process document backs "All machines" — save locally instead.
      try {
        window.localStorage.setItem(ALL_MACHINES_WIDGETS_KEY, JSON.stringify(customizing));
      } catch {
        // localStorage unavailable — the picks just don't stick past this session.
      }
      setAllMachinesWidgets(customizing);
      toast.success("Dashboard updated");
      setCustomizing(null);
      return;
    }
    setSaving(true);
    updateProcess(processId, customizing)
      .then(() => {
        toast.success("Dashboard updated");
        invalidateProcesses();
        setCustomizing(null);
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Failed to save the dashboard"))
      .finally(() => setSaving(false));
  };

  const activeChips = Object.entries(filters).flatMap(([dim, vals]) => vals.map((v) => ({ dim, value: v, label: `${DIMENSIONS[dim].label}: ${DIMENSIONS[dim].text(v, ctx)}` })));

  return (
    <div className="pd-root">
      {/* Header: back, process name, date range */}
      <div className="pd-header">
        <button type="button" className="pd-back" onClick={onBack} aria-label="Back to all processes" title="Back to all processes">
          <ArrowLeft size={20} />
        </button>
        <div className="pd-title">
          <h4 className="mb-0 fw-bold">{process ? process.processName : "All machines"}</h4>
        </div>
        <div className="ms-auto d-flex flex-wrap align-items-center gap-2">
          <span className="pd-chip pd-chip-static d-inline-flex align-items-center gap-1">
            <CalendarRange size={13} /> {periodLabel}
            {!isDefaultRange && (
              <button type="button" className="pd-chip-x" onClick={resetRange} aria-label="Reset the period to this month" title="Reset to this month"><X size={12} /></button>
            )}
          </span>
          <FilterPanel range={range} onRangeChange={onRangeChange} extent={extent} filters={filters} onFilterSet={onFilterSet}
            options={filterOptions} active={filtersActive} onClearAll={clearAll} />
          {isAdmin && (
            <Button size="sm" color="light" className="pd-field-btn" onClick={() => setCustomizing({ stats: stats.map((s) => s.key), charts: charts.map((w) => w.key) })}>
              <LayoutDashboard size={15} /> Customize
            </Button>
          )}
        </div>
      </div>

      {/* What the dashboard's machine/operator/item filters are currently
          narrowed to — the period itself is shown on the header line above,
          not repeated here. Each chip removes itself. */}
      {activeChips.length > 0 && (
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          {activeChips.map((chip) => (
            <button key={`${chip.dim}:${chip.value}`} type="button" className="pd-chip is-on d-inline-flex align-items-center gap-1" onClick={() => onToggle(chip.dim, chip.value)} title="Remove this filter">
              {chip.label} <X size={12} />
            </button>
          ))}
        </div>
      )}

      {loading && !rows.length ? (
        <div className="text-center text-muted py-5"><Spinner size="sm" className="me-2" />Loading dashboard…</div>
      ) : !rows.length ? (
        <div className="pd-card text-center text-muted py-5">
          No entries for {process ? process.processName : "any machine"} in {periodLabel.toLowerCase()}.
          {extent && <div className="small mt-1">This process has entries from {describeRange([extent.from, extent.from])} to {describeRange([extent.to, extent.to])} — open Filters to pick a period inside that.</div>}
          {process && !process.machines?.length && <div className="small mt-1">This process has no machines yet — assign them in Production › Processes.</div>}
        </div>
      ) : (
        // While a new range loads, the previous render stays up, dimmed.
        <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
          <div className="pd-stats">
            {stats.map((stat) => (
              <button key={stat.key} type="button" className="pd-stat" onClick={() => setDrill(statMeasure(stat))} title="Click for the full breakdown">
                <span className="pd-stat-label">{stat.label}</span>
                <span className="pd-stat-value">
                  {stat.tone && <span className="pd-stat-dot" style={{ background: c[stat.tone] }} />}
                  {FORMATS[stat.format](summary[stat.key])}
                </span>
                {stat.hint && <span className="pd-stat-hint">{stat.hint}</span>}
              </button>
            ))}
          </div>

          <div className="pd-grid">
            {charts.map((w) => {
              const Chart = CHART_COMPONENTS[w.key];
              const measureStat = w.measure && STATS_BY_KEY[w.measure];
              return (
                <WidgetCard key={w.key} title={w.label} hint={w.hint} size={w.size} tableOnly={TABLE_ONLY.has(w.key)}
                  onDrill={measureStat ? () => setDrill(statMeasure(measureStat)) : undefined}>
                  {({ view, expanded }) => (
                    <Chart rowsFor={rowsFor} ctx={ctx} c={c} filters={filters} onToggle={onToggle} onDrill={setDrill} view={view} expanded={expanded} />
                  )}
                </WidgetCard>
              );
            })}
          </div>
          {!stats.length && !charts.length && (
            <div className="pd-card text-center text-muted py-5">No KPI tiles or graphs are selected for this process — use Customize to add some.</div>
          )}
        </div>
      )}

      {/* A row picked in the breakdown means "show me exactly this" — set, not
          toggle: the rows are already filtered, so toggling could only ever
          REMOVE the filter the user was looking at. */}
      <DrillModal measure={drill} rows={filtered} ctx={ctx} c={c} onClose={() => setDrill(null)} onPick={(dim, key) => onFilterSet(dim, [key])} />

      <Modal isOpen={!!customizing} toggle={() => setCustomizing(null)} size="xl" centered scrollable backdrop="static">
        <ModalHeader toggle={() => setCustomizing(null)} className="p-3 border-bottom">Customize — {process?.processName || "All machines"}</ModalHeader>
        <ModalBody>{customizing && <WidgetPicker stats={customizing.stats} charts={customizing.charts} onChange={setCustomizing} />}</ModalBody>
        <ModalFooter>
          <Button color="light" onClick={() => setCustomizing(null)} disabled={saving}>Cancel</Button>
          <Button color="primary" onClick={saveCustomize} disabled={saving}>{saving ? <><Spinner size="sm" className="me-1" />Saving…</> : "Save"}</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};

export default ProcessDashboard;
