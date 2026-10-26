import React, { useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie, PieChart,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, RadialBar, RadialBarChart,
  ReferenceLine, ResponsiveContainer, Tooltip, Treemap, XAxis, YAxis,
} from "recharts";
import {
  DIMENSIONS, FORMATS, STOPPAGE_GROUPS, causeLabel, compareMachines, formatExact,
  reasonMeasure, summarize, summarizeBy,
} from "../../utils/processDashboard";
import { axisProps, markOpacity, tooltipProps } from "./chartTheme";
import { STOPPAGE_FIELDS } from "../../utils/productionSheet";

/**
 * Components/ProcessDashboard/charts.jsx
 * ────────────────────────────────────────
 * Every visual in the catalog (utils/processDashboard.js). Each one takes the
 * same props:
 *   rowsFor(dim) — the filtered entries; pass the dimension the chart itself
 *                  is sliced by so it keeps all its marks and dims the
 *                  unselected ones, or null for fully filtered rows
 *   ctx          — { machineName, bucket, words, stoppageKeys }
 *                  bucket = "date" | "month"; words / stoppageKeys = how
 *                  the process names its rows (machine or worker) and which
 *                  stoppage causes its sheet has (utils/processDashboard.js)
 *   c            — theme colours             filters — active cross-filters
 *   onToggle(dim, value) — cross-filter the whole dashboard
 *   onDrill(measure)     — open the breakdown for a measure
 *   view         — "chart" | "table"         expanded — true when maximized
 * and renders into whatever height its parent gives it.
 */

const truncate = (s, max = 18) => (String(s).length > max ? `${String(s).slice(0, max - 1)}…` : String(s));
const pct100 = (v) => (Number.isFinite(v) ? v * 100 : null);
const naturalSort = (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true });
const clickedKey = (d) => d?.payload?.key ?? d?.key;

// "Machine" — or "Worker" on a worker-based process — and what its times are
// called, for headings and empty-state hints. Wording only.
const unitOf = (ctx) => ctx.words?.one || "Machine";
const timesOf = (ctx) => ctx.words?.times || "machine ON/OFF times";

// The stoppage causes a table gives a column: the ones the process's sheet
// has (ctx.stoppageKeys — no B.D. Mech. / Ele. on RUBBER), plus any other
// that does carry minutes, so a column never hides time the totals include.
const causeColumns = (ctx, groups) =>
  STOPPAGE_FIELDS.filter((f) => !ctx.stoppageKeys || ctx.stoppageKeys.includes(f.key) || groups.some((g) => g.summary.downtimeByCause[f.key]));

export const Empty = ({ children }) => (
  <div className="d-flex align-items-center justify-content-center h-100 text-muted small text-center px-3">{children}</div>
);

// `hints` (optional, parallel to `columns`) become each header's hover text.
export const MiniTable = ({ columns, hints, rows, onRowClick, selected = [] }) => (
  <div className="h-100 overflow-auto">
    <table className="table table-sm align-middle mb-0 pd-table">
      <thead>
        <tr>
          {columns.map((col, i) => (
            <th key={col} className={i ? "text-end" : ""} title={hints?.[i]}>{col}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.key}
            onClick={onRowClick ? () => onRowClick(r.key) : undefined}
            className={selected.includes(r.key) ? "pd-row-selected" : ""}
            style={onRowClick ? { cursor: "pointer" } : undefined}
          >
            {r.cells.map((cell, i) => (
              <td key={i} className={i ? "text-end" : "fw-semibold"}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// Category-axis tick that stays on one line (Recharts would wrap a long label
// onto two) — truncated, with the full label as its hover title.
const CategoryTick = ({ x, y, payload, c }) => (
  <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill={c.axis}>
    <title>{payload.value}</title>
    {truncate(payload.value, 20)}
  </text>
);

// ── Shared: sorted horizontal bars ─────────────────────────────────────────
// Cards show the top rows; maximizing shows all of them in a scrolling body.
const CARD_ROWS = 12;

const HBars = ({ data, color, format, c, selected = [], onSelect, expanded, view, dimLabel, valueLabel, emptyText }) => {
  if (!data.length) return <Empty>{emptyText}</Empty>;
  if (view === "table") {
    return (
      <MiniTable
        columns={[dimLabel, valueLabel]}
        rows={data.map((d) => ({ key: d.key, cells: [d.label, formatExact(format, d.value)] }))}
        onRowClick={onSelect}
        selected={selected}
      />
    );
  }
  const shown = expanded ? data : data.slice(0, CARD_ROWS);
  const hidden = data.length - shown.length;
  const chart = (
    <ResponsiveContainer width="100%" height={expanded ? Math.max(shown.length * 28, 240) : "100%"}>
      <BarChart data={shown} layout="vertical" margin={{ top: 4, right: 64, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} horizontal={false} />
        <XAxis type="number" {...axisProps(c)} tickFormatter={(v) => FORMATS[format === "pct" ? "pct" : "qty"](v).replace(".00%", "%")} />
        <YAxis type="category" dataKey="label" width={126} {...axisProps(c)} tick={<CategoryTick c={c} />} interval={0} />
        <Tooltip {...tooltipProps(c)} formatter={(v) => [formatExact(format, v), valueLabel]} />
        <Bar isAnimationActive={false} dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={18} onClick={(d) => onSelect?.(clickedKey(d))} style={{ cursor: onSelect ? "pointer" : "default" }}>
          {shown.map((d) => (
            <Cell key={d.key} fillOpacity={markOpacity(selected, d.key)} />
          ))}
          <LabelList dataKey="value" position="right" fill={c.axis} fontSize={11} formatter={(v) => FORMATS[format](v)} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
  return (
    <div className="h-100 d-flex flex-column">
      <div className={expanded ? "flex-grow-1 overflow-auto" : "flex-grow-1"} style={{ minHeight: 0 }}>{chart}</div>
      {hidden > 0 && <div className="text-muted small pt-1">+{hidden} more — maximize to see all</div>}
    </div>
  );
};

// One bar per value of `dim`, for one measure of the summary.
const useDimBars = (rows, dim, ctx, pick, { sort = "value", positiveOnly = true } = {}) =>
  useMemo(() => {
    const data = summarizeBy(rows, dim, ctx)
      .map((g) => ({ key: g.key, label: g.label, value: pick(g.summary) }))
      .filter((d) => Number.isFinite(d.value) && (!positiveOnly || d.value > 0));
    if (sort === "machine") return data.sort(compareMachines(ctx));
    return sort === "label" ? data.sort(naturalSort) : data.sort((a, b) => b.value - a.value);
  }, [rows, dim, ctx]);

// ── Visuals ────────────────────────────────────────────────────────────────
const RunTimeByOperator = ({ rowsFor, ctx, c, filters, onToggle, ...rest }) => {
  const data = useDimBars(rowsFor("operator"), "operator", ctx, (s) => s.effectiveHours);
  return (
    <HBars {...rest} data={data} c={c} color={c.ok} format="hours" selected={filters.operator} onSelect={(k) => onToggle("operator", k)}
      dimLabel="Operator" valueLabel="Effective Run Time" emptyText="Needs cycle time and OK quantity." />
  );
};

const OkPctByOperator = ({ rowsFor, ctx, c, filters, onToggle, ...rest }) => {
  const data = useDimBars(rowsFor("operator"), "operator", ctx, (s) => s.okPct, { positiveOnly: false });
  return (
    <HBars {...rest} data={data} c={c} color={c.ok} format="pct" selected={filters.operator} onSelect={(k) => onToggle("operator", k)}
      dimLabel="Operator" valueLabel="OK Quantity %" emptyText="No quantities entered." />
  );
};

const OutputByItem = ({ rowsFor, ctx, c, filters, onToggle, ...rest }) => {
  const data = useDimBars(rowsFor("item"), "item", ctx, (s) => s.okQty);
  return (
    <HBars {...rest} data={data} c={c} color={c.ok} format="qty" selected={filters.item} onSelect={(k) => onToggle("item", k)}
      dimLabel="Part" valueLabel="OK Quantity" emptyText="No OK quantity entered." />
  );
};

const RejectByReason = ({ rowsFor, c, onDrill, view }) => {
  const rows = rowsFor(null);
  const data = useMemo(
    () => Object.entries(summarize(rows).rejectByReason)
      .map(([reason, value]) => ({ key: reason, label: reason, value }))
      .sort((a, b) => b.value - a.value),
    [rows],
  );
  if (!data.length) return <Empty>Nothing rejected in this period.</Empty>;
  if (view === "table") {
    return (
      <MiniTable columns={["Reason", "Rejected"]} onRowClick={(k) => onDrill(reasonMeasure(k))}
        rows={data.map((d) => ({ key: d.key, cells: [d.label, formatExact("qty", d.value)] }))} />
    );
  }
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className="d-flex flex-wrap align-items-center justify-content-center h-100 gap-3">
      <div style={{ flex: "1 1 200px", height: "100%", minHeight: 200, minWidth: 0, position: "relative" }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="92%" paddingAngle={2} stroke={c.surface} strokeWidth={2}
              isAnimationActive={false} onClick={(d) => onDrill(reasonMeasure(d.key ?? d.payload?.key))} style={{ cursor: "pointer" }}>
              {data.map((d, i) => <Cell key={d.key} fill={MACHINE_HUES[i % MACHINE_HUES.length]} />)}
            </Pie>
            <Tooltip {...tooltipProps(c)} formatter={(v, name) => [`${formatExact("qty", v)} (${((v / total) * 100).toFixed(1)}%)`, name]} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <b style={{ color: c.ink, fontSize: 20 }}>{formatExact("qty", total)}</b>
          <span style={{ color: c.muted, fontSize: 11 }}>rejected</span>
        </div>
      </div>
      <div style={{ flex: "1 1 150px", minWidth: 0, maxHeight: "100%", overflow: "auto" }}>
        {data.map((d, i) => (
          <button key={d.key} type="button" onClick={() => onDrill(reasonMeasure(d.key))}
            className="d-flex align-items-center justify-content-between gap-2 py-1 w-100 border-0 bg-transparent text-start" style={{ fontSize: 12.5, color: c.axis }}>
            <span className="d-inline-flex align-items-center gap-2" style={{ minWidth: 0 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: MACHINE_HUES[i % MACHINE_HUES.length], flex: "0 0 auto" }} />
              <span className="text-truncate">{d.label}</span>
            </span>
            <b style={{ color: c.ink }}>{formatExact("qty", d.value)}</b>
          </button>
        ))}
      </div>
    </div>
  );
};

const OeeByMachine = ({ rowsFor, ctx, c, filters, onToggle, view }) => {
  const data = useDimBars(rowsFor("machine"), "machine", ctx, (s) => pct100(s.oeeLosses), { sort: "machine", positiveOnly: false });
  if (!data.length) return <Empty>Needs {timesOf(ctx)} and OK quantity.</Empty>;
  if (view === "table") {
    return (
      <MiniTable columns={[unitOf(ctx), "OEE"]} selected={filters.machine} onRowClick={(k) => onToggle("machine", k)}
        rows={data.map((d) => ({ key: d.key, cells: [d.label, `${d.value.toFixed(2)}%`] }))} />
    );
  }
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 18, right: 8, left: -14, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="label" {...axisProps(c)} />
        <YAxis unit="%" {...axisProps(c)} />
        <Tooltip {...tooltipProps(c)} formatter={(v) => [`${v.toFixed(2)}%`, "OEE"]} />
        <Bar isAnimationActive={false} dataKey="value" fill={c.ok} radius={[4, 4, 0, 0]} maxBarSize={38} onClick={(d) => onToggle("machine", clickedKey(d))} style={{ cursor: "pointer" }}>
          {data.map((d) => <Cell key={d.key} fillOpacity={markOpacity(filters.machine, d.key)} />)}
          <LabelList dataKey="value" position="top" fill={c.axis} fontSize={11} formatter={(v) => `${v.toFixed(0)}%`} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// Effective run time per machine (or worker), in sheet order — one bar each, hours on top.
const RunTimeByMachineBars = ({ rowsFor, ctx, c, filters, onToggle, view }) => {
  const data = useDimBars(rowsFor("machine"), "machine", ctx, (s) => s.effectiveHours, { sort: "machine" });
  if (!data.length) return <Empty>Needs cycle time and OK quantity.</Empty>;
  if (view === "table") {
    return (
      <MiniTable columns={[unitOf(ctx), "Effective Run Time"]} selected={filters.machine} onRowClick={(k) => onToggle("machine", k)}
        rows={data.map((d) => ({ key: d.key, cells: [d.label, formatExact("hours", d.value)] }))} />
    );
  }
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 18, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="label" {...axisProps(c)} />
        <YAxis unit=" hr" {...axisProps(c)} />
        <Tooltip {...tooltipProps(c)} formatter={(v) => [formatExact("hours", v), "Effective Run Time"]} />
        <Bar isAnimationActive={false} dataKey="value" fill={c.ok} radius={[4, 4, 0, 0]} maxBarSize={38} onClick={(d) => onToggle("machine", clickedKey(d))} style={{ cursor: "pointer" }}>
          {data.map((d) => <Cell key={d.key} fillOpacity={markOpacity(filters.machine, d.key)} />)}
          <LabelList dataKey="value" position="top" fill={c.axis} fontSize={11} formatter={(v) => v.toFixed(1)} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

const OEE_SERIES = [
  { key: "oeeLosses", label: "Considering Losses" },
  { key: "oeeLunch", label: "Excl. Losses (Lunch Only)" },
  { key: "oeeLunchCot", label: "Excl. Losses (Lunch + Setup)" },
];

// The three OEE components — each the entries' minutes and pieces added up
// and divided once (summarize's oeeAvailability/…), not averaged percentages.
const APQ_SERIES = [
  { key: "oeeAvailability", label: "Availability" },
  { key: "oeePerformance", label: "Performance" },
  { key: "oeeQuality", label: "Quality" },
];

// Several percentage series over time (date, or month on long ranges) — the
// shape both OEE trend charts share. `ceiling` draws a dashed 100% line: the
// Availability / Performance / Quality chart needs it, since anything above
// it is an entry held for Admin review.
const PctTrend = ({ series, empty, ceiling = false, fit = false, area = false, rowsFor, ctx, c, filters, onToggle, view }) => {
  const dim = ctx.bucket;
  const rows = rowsFor(dim);
  // Clicking a legend entry hides/shows that one OEE line — a filter on the
  // series themselves, separate from onToggle's date/month cross-filter.
  const [hidden, setHidden] = useState(() => new Set());
  const toggleSeries = (key) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const data = useMemo(
    () => summarizeBy(rows, dim, ctx)
      .map((g) => ({ key: g.key, label: g.label, ...Object.fromEntries(series.map((s) => [s.key, pct100(g.summary[s.key])])) }))
      .filter((d) => series.some((s) => d[s.key] !== null))
      .sort((a, b) => a.key.localeCompare(b.key)),
    [rows, dim, ctx, series],
  );
  if (!data.length) return <Empty>{empty}</Empty>;
  if (view === "table") {
    return (
      <MiniTable columns={[DIMENSIONS[dim].label, ...series.map((s) => s.label)]} selected={filters[dim]} onRowClick={(k) => onToggle(dim, k)}
        rows={data.map((d) => ({ key: d.key, cells: [d.label, ...series.map((s) => (d[s.key] === null ? "—" : `${d[s.key].toFixed(2)}%`))] }))} />
    );
  }
  const few = data.length <= 45;
  const Chart2 = area ? AreaChart : LineChart;
  const Series = area ? Area : Line;
  return (
    <ResponsiveContainer>
      <Chart2 data={data} margin={{ top: 8, right: 12, left: -14, bottom: 0 }} onClick={(state) => state?.activeLabel && onToggle(dim, state.activeLabel)} style={{ cursor: "pointer" }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="key" {...axisProps(c)} tickFormatter={(k) => (dim === "date" ? `${k.slice(8)}/${k.slice(5, 7)}` : DIMENSIONS.month.text(k))} minTickGap={24} />
        <YAxis unit="%" {...axisProps(c)} domain={fit ? [0, (max) => Math.max(10, Math.ceil(max / 10) * 10)] : [0, (max) => Math.max(100, Math.ceil(max / 10) * 10)]} />
        <Tooltip {...tooltipProps(c)} cursor={{ stroke: c.muted }} labelFormatter={(k) => DIMENSIONS[dim].text(k)} formatter={(v, name) => [`${Number(v).toFixed(2)}%`, name]} />
        <Legend
          itemSorter={null}
          wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
          iconType="plainline"
          onClick={(d) => toggleSeries(d.dataKey)}
          formatter={(v, entry) => (
            <span style={{ color: c.axis, opacity: hidden.has(entry.dataKey) ? 0.4 : 1, textDecoration: hidden.has(entry.dataKey) ? "line-through" : "none" }}>
              {v}
            </span>
          )}
        />
        {ceiling && <ReferenceLine y={100} stroke={c.muted} strokeDasharray="4 4" label={{ value: "100%", position: "insideTopRight", fill: c.muted, fontSize: 10 }} />}
        {filters[dim].map((k) => <ReferenceLine key={k} x={k} stroke={c.muted} strokeDasharray="3 3" />)}
        {series.map((s, i) => (
          <Series key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.tone ? c[s.tone] : c.series[i]} strokeWidth={2} connectNulls
            {...(area ? { fill: s.tone ? c[s.tone] : c.series[i], fillOpacity: 0.22 } : {})}
            hide={hidden.has(s.key)}
            dot={few ? { r: 3, strokeWidth: 0, fill: s.tone ? c[s.tone] : c.series[i] } : false} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
        ))}
      </Chart2>
    </ResponsiveContainer>
  );
};

const OeeTrend = (props) => <PctTrend {...props} series={OEE_SERIES} empty={`Needs ${timesOf(props.ctx)} and OK quantity.`} />;

// Availability · Performance · Quality for the period as three concentric
// rings (a full ring is 100%), with the exact figures beside them. A figure
// over 100% fills its ring and is marked — that is an entry held for Admin
// review. The table view keeps the by-date numbers.
const ApqRings = (props) => {
  const { rowsFor, ctx, c, view } = props;
  const rows = rowsFor(null);
  const sum = useMemo(() => summarize(rows), [rows]);
  const needs = `Needs ${timesOf(ctx)}, Planned Operator Shift, a part's cycle time and quantities.`;
  if (view === "table") {
    return <PctTrend {...props} series={APQ_SERIES} ceiling empty={needs} />;
  }
  const items = APQ_SERIES.map((s, i) => ({ ...s, color: c.series[i], value: pct100(sum[s.key]) }));
  if (items.every((d) => d.value === null)) return <Empty>{needs}</Empty>;
  const data = [...items].reverse().map((d) => ({ name: d.label, value: Math.min(100, Math.max(0, d.value ?? 0)), fill: d.color }));
  return (
    <div className="d-flex flex-wrap align-items-center justify-content-center h-100 gap-3">
      <div style={{ flex: "1 1 220px", height: "100%", minHeight: 200, minWidth: 0 }}>
        <ResponsiveContainer>
          <RadialBarChart data={data} innerRadius="28%" outerRadius="100%" startAngle={90} endAngle={-270} barSize={16}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="value" background={{ fill: c.grid }} cornerRadius={8} isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ flex: "1 1 160px", minWidth: 0 }}>
        {items.map((d) => {
          const over = d.value !== null && d.value > 100 + 1e-9;
          return (
            <div key={d.key} className="d-flex align-items-center justify-content-between gap-2 py-2" style={{ borderBottom: `1px solid ${c.grid}` }}>
              <span className="d-inline-flex align-items-center gap-2" style={{ color: c.axis, fontSize: 13 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, display: "inline-block" }} />
                {d.label}
              </span>
              <b style={{ color: over ? "#e34948" : c.ink, fontSize: 18 }}>
                {d.value === null ? "—" : `${d.value.toFixed(1)}%`}
                {over ? " ▲" : ""}
              </b>
            </div>
          );
        })}
        <div className="small mt-2" style={{ color: c.muted }}>A full ring is 100%. ▲ = over 100%, held for Admin review.</div>
      </div>
    </div>
  );
};
const ApqTrend = ApqRings;

// Unutilized Machine Time over time — one filled area (every entry's own figure,
// averaged per date, or per month on long ranges). `fit` keeps the axis to the
// data instead of stretching it to 100%.
const UTIL_SERIES = [{ key: "unutilized", label: "Unutilized machine time", tone: "downtime" }];
const UTIL_SERIES_WORKER = [{ ...UTIL_SERIES[0], label: "Unutilized time" }];
const UnutilizedTrend = (props) => (
  <PctTrend {...props} series={props.ctx.words?.byWorker ? UTIL_SERIES_WORKER : UTIL_SERIES} fit area empty={`Needs ${timesOf(props.ctx)}.`} />
);

const OkRejectedTrend = ({ rowsFor, ctx, c, filters, onToggle, view }) => {
  const dim = ctx.bucket;
  const rows = rowsFor(dim);
  const data = useMemo(
    () => summarizeBy(rows, dim, ctx)
      .map((g) => ({ key: g.key, label: g.label, ok: g.summary.okQty, rejected: g.summary.rejectedQty }))
      .filter((d) => d.ok > 0 || d.rejected > 0)
      .sort((a, b) => a.key.localeCompare(b.key)),
    [rows, dim, ctx],
  );
  if (!data.length) return <Empty>No quantities entered for this period.</Empty>;
  if (view === "table") {
    return (
      <MiniTable columns={[DIMENSIONS[dim].label, "OK", "Rejected"]} selected={filters[dim]} onRowClick={(k) => onToggle(dim, k)}
        rows={data.map((d) => ({ key: d.key, cells: [d.label, formatExact("qty", d.ok), formatExact("qty", d.rejected)] }))} />
    );
  }
  const select = (d) => onToggle(dim, clickedKey(d));
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="key" {...axisProps(c)} tickFormatter={(k) => (dim === "date" ? `${k.slice(8)}/${k.slice(5, 7)}` : DIMENSIONS.month.text(k))} minTickGap={16} />
        <YAxis {...axisProps(c)} tickFormatter={(v) => FORMATS.qty(v)} />
        <Tooltip {...tooltipProps(c)} labelFormatter={(k) => DIMENSIONS[dim].text(k)} formatter={(v, name) => [formatExact("qty", v), name]} />
        <Legend itemSorter={null} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: c.axis }}>{v}</span>} />
        <Bar isAnimationActive={false} dataKey="ok" name="OK" stackId="q" fill={c.ok} stroke={c.surface} strokeWidth={1} maxBarSize={34} onClick={select} style={{ cursor: "pointer" }}>
          {data.map((d) => <Cell key={d.key} fillOpacity={markOpacity(filters[dim], d.key)} />)}
        </Bar>
        <Bar isAnimationActive={false} dataKey="rejected" name="Rejected" stackId="q" fill={c.reject} stroke={c.surface} strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={34} onClick={select} style={{ cursor: "pointer" }}>
          {data.map((d) => <Cell key={d.key} fillOpacity={markOpacity(filters[dim], d.key)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// One hue per machine (white text sits on all of them); a machine keeps its
// colour by its place in the sheet order, so filtering never repaints it.
const MACHINE_HUES = ["#2f6fe0", "#1e2a8a", "#d4682f", "#5b1a7a", "#17855f", "#a8700a", "#b02a5b", "#3a7f8c"];
const shortCause = (key) => causeLabel(key).replace(/Lunch\/Tea\/Wash room etc\./, "Lunch / Tea");

// Machine block → one tile per stoppage cause inside it, area = minutes.
const StoppageTile = ({ x, y, width, height, depth, name, value, parentName, first, color, nodeKey, selected, onSelect, c }) => {
  const fade = markOpacity(selected, nodeKey);
  if (depth === 2) {
    const room = width > 56 && height > 24;
    return (
      <g onClick={() => onSelect(nodeKey)} style={{ cursor: "pointer" }}>
        <rect x={x} y={y} width={width} height={height} fill={color} fillOpacity={fade} stroke="#ffffff" strokeOpacity={0.55} strokeWidth={1} />
        {/* A machine's biggest tile sits in its top-left corner, so the machine's name rides on it. */}
        {first && width > 30 && height > 20 && <text x={x + 6} y={y + 16} fill="#ffffff" fontSize={13} fontWeight={700}>{truncate(parentName, Math.floor(width / 8))}</text>}
        {room && (
          <>
            <text x={x + 6} y={y + height - (height > 42 ? 22 : 8)} fill="#ffffff" fontSize={11} fontWeight={600}>{truncate(name, Math.floor(width / 6.5))}</text>
            {height > 42 && <text x={x + 6} y={y + height - 7} fill="#ffffff" fontSize={11}>{FORMATS.minutes(value)}</text>}
          </>
        )}
      </g>
    );
  }
  if (depth !== 1) return null;
  return (
    <g onClick={() => onSelect(nodeKey)} style={{ cursor: "pointer" }}>
      <rect x={x} y={y} width={width} height={height} fill="none" stroke={c.surface} strokeWidth={3} />
      {width > 34 && height > 22 && <text x={x + 6} y={y + 16} fill="#ffffff" fontSize={13} fontWeight={700} stroke={color} strokeWidth={3} paintOrder="stroke">{truncate(name, Math.floor(width / 8))}</text>}
    </g>
  );
};

const StoppageTip = ({ active, payload, c }) => {
  const n = active && payload?.[0]?.payload;
  if (!n || n.children) return null;
  return (
    <div style={{ background: c.surface, border: `1px solid ${c.grid}`, borderRadius: 8, fontSize: 12, color: c.ink, padding: "6px 10px" }}>
      <div style={{ fontWeight: 600 }}>{n.parentName}</div>
      <div>{n.name} : {formatExact("minutes", n.value)}</div>
    </div>
  );
};

const DowntimeByMachine = ({ rowsFor, ctx, c, filters, onToggle, view }) => {
  const rows = rowsFor("machine");
  const machines = useMemo(
    () => summarizeBy(rows, "machine", ctx)
      .filter((g) => g.summary.downtimeMin > 0)
      .sort(compareMachines(ctx)),
    [rows, ctx],
  );
  if (!machines.length) return <Empty>No downtime recorded.</Empty>;
  const groupTotal = (g, grp) => grp.fields.reduce((sum, f) => sum + g.summary.downtimeByCause[f], 0);
  if (view === "table") {
    // Only the groups holding a cause this process has (no Breakdown on RUBBER).
    const shown = new Set(causeColumns(ctx, machines).map((f) => f.key));
    const groups = STOPPAGE_GROUPS.filter((grp) => grp.fields.some((f) => shown.has(f)));
    return (
      <MiniTable columns={[unitOf(ctx), ...groups.map((g) => `${g.label} (min)`)]} selected={filters.machine} onRowClick={(k) => onToggle("machine", k)}
        rows={machines.map((g) => ({ key: g.key, cells: [g.label, ...groups.map((grp) => formatExact("qty", groupTotal(g, grp)))] }))} />
    );
  }
  const data = machines.map((g, i) => {
    const color = MACHINE_HUES[i % MACHINE_HUES.length];
    return {
      name: g.label, nodeKey: g.key, color,
      children: STOPPAGE_FIELDS
        .map((f) => ({ name: shortCause(f.key), value: g.summary.downtimeByCause[f.key] || 0, parentName: g.label, color, nodeKey: g.key }))
        .filter((d) => d.value > 0)
        .sort((x, y) => y.value - x.value)
        .map((d, k) => ({ ...d, first: k === 0 })),
    };
  });
  return (
    <ResponsiveContainer>
      <Treemap data={data} dataKey="value" aspectRatio={4 / 3} isAnimationActive={false}
        content={<StoppageTile c={c} selected={filters.machine} onSelect={(k) => onToggle("machine", k)} />}>
        <Tooltip content={<StoppageTip c={c} />} />
      </Treemap>
    </ResponsiveContainer>
  );
};

// Treemap cell: one hue (area carries the magnitude), a 2px surface gap
// between cells, and a label only where it fits.
const TreemapCell = ({ x, y, width, height, depth, name, value, nodeKey, c, selected, onSelect }) => {
  if (depth !== 1) return null;
  const fits = width > 58 && height > 36;
  return (
    <g onClick={() => onSelect(nodeKey)} style={{ cursor: "pointer" }}>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={c.ok} fillOpacity={markOpacity(selected, nodeKey)} stroke={c.surface} strokeWidth={2} />
      {fits && (
        <>
          <text x={x + 8} y={y + 18} fill="#ffffff" fontSize={12} fontWeight={600}>{truncate(name, Math.floor(width / 8))}</text>
          <text x={x + 8} y={y + height - 8} fill="#ffffff" fontSize={11}>{FORMATS.hours(value)}</text>
        </>
      )}
    </g>
  );
};

// Every stoppage cause on one radar — a spoke per cause, the further out the
// more minutes lost. (All ten causes, none folded into "Other".) The table
// view adds each machine's split with its effective run time beside it.
const RunTimeByMachine = ({ rowsFor, ctx, c, filters, onToggle, view, ...rest }) => {
  const rows = rowsFor("machine");
  const causes = useMemo(() => {
    const total = summarize(rows).downtimeByCause;
    return STOPPAGE_FIELDS
      .map((f) => ({ key: f.key, label: shortCause(f.key), value: total[f.key] || 0 }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [rows]);
  const machines = useMemo(
    () => summarizeBy(rows, "machine", ctx).sort(compareMachines(ctx)),
    [rows, ctx],
  );
  if (view === "table") {
    if (!machines.length) return <Empty>No entries for this period.</Empty>;
    const causeFields = causeColumns(ctx, machines);
    return (
      <MiniTable
        columns={[unitOf(ctx), "Effective Run Time", ...causeFields.map((f) => `${causeLabel(f.key)} (min)`)]}
        selected={filters.machine}
        onRowClick={(k) => onToggle("machine", k)}
        rows={machines.map((g) => ({
          key: g.key,
          cells: [g.label, formatExact("hours", g.summary.effectiveHours), ...causeFields.map((f) => formatExact("qty", g.summary.downtimeByCause[f.key]))],
        }))}
      />
    );
  }
  // A radar needs at least three spokes; with fewer causes the bars read better.
  if (causes.length < 3) {
    return (
      <HBars {...rest} view="chart" data={causes} c={c} color={c.downtime} format="minutes"
        dimLabel="Stoppage" valueLabel="Time lost" emptyText="No stoppage recorded." />
    );
  }
  const spoke = ({ x, y, payload, textAnchor }) => {
    const d = causes.find((k) => k.label === payload.value);
    return (
      <text x={x} y={y} textAnchor={textAnchor} fontSize={11} fill={c.axis}>
        <tspan x={x} dy="0">{truncate(payload.value, 16)}</tspan>
        <tspan x={x} dy="13" fill={c.muted}>{d ? FORMATS.minutes(d.value) : ""}</tspan>
      </text>
    );
  };
  return (
    <ResponsiveContainer>
      <RadarChart data={causes} outerRadius="60%" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
        <PolarGrid stroke={c.grid} />
        <PolarAngleAxis dataKey="label" tick={spoke} />
        <PolarRadiusAxis tick={false} axisLine={false} />
        <Tooltip {...tooltipProps(c)} formatter={(v) => [formatExact("minutes", v), "Time lost"]} />
        <Radar dataKey="value" stroke={c.downtime} fill={c.downtime} fillOpacity={0.3} strokeWidth={2} dot={{ r: 3, fill: c.downtime, strokeWidth: 0 }} isAnimationActive={false} />
      </RadarChart>
    </ResponsiveContainer>
  );
};

// Rounds the value axis every panel shares outward to a 1/2/5 × 10ᵏ step (never
// finer than 1 minute) with 0 always on a tick, so the labels read as whole
// numbers instead of raw floats like -96.6666667.
const niceAxis = (min, max, intervals) => {
  const span = max - min;
  if (!(span > 0)) return { domain: [0, 10], ticks: [0, 5, 10] };
  const raw = span / intervals;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi; v += step) ticks.push(v);
  return { domain: [lo, hi], ticks };
};
const tickText = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

// Up to this many machines the panels split the card between them (so one, two
// or three machines fill it instead of huddling in a corner); past it they go
// into a scrolling grid of small fixed-height panels.
const FIT_PANELS = 6;

// One small chart per machine, all on one shared scale so the panels compare
// honestly. 1–3 machines sit side by side and use the card's full height; 4–6
// make two rows of up to three; more than that scroll.
const UnreportedByMachine = ({ rowsFor, ctx, c, filters, onToggle, view, expanded }) => {
  const dim = ctx.bucket;
  const rows = rowsFor(null);
  const { panels, values } = useMemo(() => {
    const list = summarizeBy(rows, "machine", ctx).sort(compareMachines(ctx)).map((m) => ({
      key: m.key,
      label: m.label,
      total: m.summary.unreportedMin,
      data: summarizeBy(rows.filter((r) => r.machine === m.key), dim, ctx)
        .map((g) => ({ key: g.key, value: g.summary.unreportedMin }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    }));
    return { panels: list, values: list.flatMap((p) => p.data.map((d) => d.value)) };
  }, [rows, dim, ctx]);

  const n = panels.length;
  const fits = n <= FIT_PANELS;
  const roomy = n <= 3;
  const { domain, ticks } = useMemo(
    () => niceAxis(Math.min(0, ...values), Math.max(0, ...values), fits ? 3 : 2),
    [values, fits],
  );
  const axisWidth = 12 + 7 * Math.max(...ticks.map((t) => tickText(t).length));

  if (!n) return <Empty>Needs {timesOf(ctx)}.</Empty>;
  if (view === "table") {
    return (
      <MiniTable columns={[unitOf(ctx), "Unreported time"]} selected={filters.machine} onRowClick={(k) => onToggle("machine", k)}
        rows={panels.map((p) => ({ key: p.key, cells: [p.label, formatExact("minutes", p.total)] }))} />
    );
  }

  const cols = Math.min(n, 3);
  const gridStyle = fits
    ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(n / cols)}, minmax(0, 1fr))` }
    : expanded
      ? { gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }
      : undefined;
  const plotHeight = expanded ? 170 : 104;
  const dateTick = (k) => (dim === "date" ? (roomy ? `${k.slice(8)}/${k.slice(5, 7)}` : k.slice(8)) : DIMENSIONS.month.text(k).slice(0, 3));

  return (
    <div className={`h-100 pd-multiples${fits ? " pd-multiples-fit" : ""}`} style={gridStyle}>
      {panels.map((p) => (
        <div key={p.key} className="pd-multiple">
          <button type="button" className="pd-multiple-title" onClick={() => onToggle("machine", p.key)} title={`Filter the dashboard to this ${unitOf(ctx).toLowerCase()}`}>
            {p.label} <span className="text-muted fw-normal">· {FORMATS.minutes(p.total)}</span>
          </button>
          <div className="pd-multiple-plot" style={fits ? undefined : { height: plotHeight, flex: "none" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={p.data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="key" {...axisProps(c)} tickFormatter={dateTick} minTickGap={roomy ? 16 : 12} />
                <YAxis {...axisProps(c)} width={axisWidth} domain={domain} ticks={ticks} tickFormatter={tickText} allowDecimals={false} />
                <ReferenceLine y={0} stroke={c.muted} />
                <Tooltip {...tooltipProps(c)} labelFormatter={(k) => DIMENSIONS[dim].text(k)} formatter={(v) => [formatExact("minutes", v), "Unreported"]} />
                <Bar dataKey="value" fill={c.ok} radius={[2, 2, 0, 0]} maxBarSize={roomy ? 36 : fits ? 28 : 14} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  );
};

// One row per machine (or worker). Read left to right: the quantities (Actual, OK, then OK %
// then the Rejected count and Rejected % that go with it), then run time,
// downtime and unreported time, and last the three OEE figures each in its own
// column — the same three the entries table shows — rather than one blended OEE.
const summaryColumns = (ctx) => {
  const unit = unitOf(ctx).toLowerCase();
  return [
    { label: unitOf(ctx) },
    { label: "Actual", hint: "Actual quantity produced" },
    { label: "OK", hint: "Pieces that passed" },
    { label: "% OK", hint: "OK ÷ (OK + Rejected)" },
    { label: "Rejected", hint: "Actual − OK" },
    { label: "% Rejected", hint: "Rejected ÷ Actual" },
    { label: "Effective Run", hint: "OK × cycle time" },
    { label: "Downtime", hint: "All stoppage causes" },
    { label: "Unreported", hint: `Planned shift − ${unit} shift − downtime, per ${unit}-day` },
    { label: "OEE · Losses", hint: `OEE considering losses — averaged over the ${unit}'s days` },
    { label: "OEE · Lunch", hint: `OEE not considering losses, but lunch — averaged over the ${unit}'s days` },
    { label: "OEE · Lunch + Setup Time", hint: `OEE not considering losses, but lunch and setup time — averaged over the ${unit}'s days` },
  ];
};

const MachineSummary = ({ rowsFor, ctx, filters, onToggle }) => {
  const rows = rowsFor("machine");
  const data = useMemo(() => summarizeBy(rows, "machine", ctx).sort(compareMachines(ctx)), [rows, ctx]);
  if (!data.length) return <Empty>No entries for this period.</Empty>;
  const columns = summaryColumns(ctx);
  return (
    <MiniTable
      columns={columns.map((c) => c.label)}
      hints={columns.map((c) => c.hint)}
      selected={filters.machine}
      onRowClick={(k) => onToggle("machine", k)}
      rows={data.map(({ key, label, summary: s }) => ({
        key,
        cells: [
          label,
          formatExact("qty", s.totalQty),
          formatExact("qty", s.okQty),
          FORMATS.pct(s.okPct),
          formatExact("qty", s.rejectedQty),
          FORMATS.pct(s.rejectionPct),
          FORMATS.hours(s.effectiveHours),
          FORMATS.minutes(s.downtimeMin),
          FORMATS.minutes(s.unreportedMin),
          FORMATS.pct(s.oeeLosses),
          FORMATS.pct(s.oeeLunch),
          FORMATS.pct(s.oeeLunchCot),
        ],
      }))}
    />
  );
};

export const CHART_COMPONENTS = {
  oeeTrend: OeeTrend,
  apqTrend: ApqTrend,
  runTimeByOperator: RunTimeByOperator,
  downtimeByMachine: DowntimeByMachine,
  runTimeByMachine: RunTimeByMachine,
  runTimeByMachineBars: RunTimeByMachineBars,
  unutilizedTrend: UnutilizedTrend,
  unreportedByMachine: UnreportedByMachine,
  okRejectedTrend: OkRejectedTrend,
  oeeByMachine: OeeByMachine,
  rejectByReason: RejectByReason,
  okPctByOperator: OkPctByOperator,
  outputByItem: OutputByItem,
  machineSummary: MachineSummary,
};

// Visuals that are already a table have no separate table view.
export const TABLE_ONLY = new Set(["machineSummary"]);
