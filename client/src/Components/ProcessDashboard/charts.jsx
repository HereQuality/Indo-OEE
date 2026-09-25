import React, { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, Treemap, XAxis, YAxis,
} from "recharts";
import {
  DIMENSIONS, FORMATS, STOPPAGE_GROUPS, compareMachines, formatExact,
  reasonMeasure, summarize, summarizeBy,
} from "../../utils/processDashboard";
import { axisProps, markOpacity, tooltipProps } from "./chartTheme";

/**
 * Components/ProcessDashboard/charts.jsx
 * ────────────────────────────────────────
 * Every visual in the catalog (utils/processDashboard.js). Each one takes the
 * same props:
 *   rowsFor(dim) — the filtered entries; pass the dimension the chart itself
 *                  is sliced by so it keeps all its marks and dims the
 *                  unselected ones, or null for fully filtered rows
 *   ctx          — { machineName, bucket }   bucket = "date" | "month"
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
      dimLabel="Operator" valueLabel="Effective run time" emptyText="Needs cycle time and OK quantity." />
  );
};

const OkPctByOperator = ({ rowsFor, ctx, c, filters, onToggle, ...rest }) => {
  const data = useDimBars(rowsFor("operator"), "operator", ctx, (s) => s.okPct, { positiveOnly: false });
  return (
    <HBars {...rest} data={data} c={c} color={c.ok} format="pct" selected={filters.operator} onSelect={(k) => onToggle("operator", k)}
      dimLabel="Operator" valueLabel="% OK quantity" emptyText="No quantities entered." />
  );
};

const OutputByItem = ({ rowsFor, ctx, c, filters, onToggle, ...rest }) => {
  const data = useDimBars(rowsFor("item"), "item", ctx, (s) => s.okQty);
  return (
    <HBars {...rest} data={data} c={c} color={c.ok} format="qty" selected={filters.item} onSelect={(k) => onToggle("item", k)}
      dimLabel="Part" valueLabel="OK quantity" emptyText="No OK quantity entered." />
  );
};

const RejectByReason = ({ rowsFor, c, onDrill, ...rest }) => {
  const rows = rowsFor(null);
  const data = useMemo(
    () => Object.entries(summarize(rows).rejectByReason)
      .map(([reason, value]) => ({ key: reason, label: reason, value }))
      .sort((a, b) => b.value - a.value),
    [rows],
  );
  return (
    <HBars {...rest} data={data} c={c} color={c.reject} format="qty" onSelect={(k) => onDrill(reasonMeasure(k))}
      dimLabel="Reason" valueLabel="Rejected" emptyText="Nothing rejected in this period." />
  );
};

const OeeByMachine = ({ rowsFor, ctx, c, filters, onToggle, view }) => {
  const data = useDimBars(rowsFor("machine"), "machine", ctx, (s) => pct100(s.oeeLosses), { sort: "machine", positiveOnly: false });
  if (!data.length) return <Empty>Needs machine ON/OFF times and OK quantity.</Empty>;
  if (view === "table") {
    return (
      <MiniTable columns={["Machine", "OEE considering losses"]} selected={filters.machine} onRowClick={(k) => onToggle("machine", k)}
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

const OEE_SERIES = [
  { key: "oeeLosses", label: "Considering losses" },
  { key: "oeeLunch", label: "Not considering losses, but lunch" },
  { key: "oeeLunchCot", label: "Not considering losses, but lunch & setup time" },
];

const OeeTrend = ({ rowsFor, ctx, c, filters, onToggle, view }) => {
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
      .map((g) => ({ key: g.key, label: g.label, ...Object.fromEntries(OEE_SERIES.map((s) => [s.key, pct100(g.summary[s.key])])) }))
      .filter((d) => OEE_SERIES.some((s) => d[s.key] !== null))
      .sort((a, b) => a.key.localeCompare(b.key)),
    [rows, dim, ctx],
  );
  if (!data.length) return <Empty>Needs machine ON/OFF times and OK quantity.</Empty>;
  if (view === "table") {
    return (
      <MiniTable columns={[DIMENSIONS[dim].label, ...OEE_SERIES.map((s) => s.label)]} selected={filters[dim]} onRowClick={(k) => onToggle(dim, k)}
        rows={data.map((d) => ({ key: d.key, cells: [d.label, ...OEE_SERIES.map((s) => (d[s.key] === null ? "—" : `${d[s.key].toFixed(2)}%`))] }))} />
    );
  }
  const few = data.length <= 45;
  return (
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -14, bottom: 0 }} onClick={(state) => state?.activeLabel && onToggle(dim, state.activeLabel)} style={{ cursor: "pointer" }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="key" {...axisProps(c)} tickFormatter={(k) => (dim === "date" ? `${k.slice(8)}/${k.slice(5, 7)}` : DIMENSIONS.month.text(k))} minTickGap={24} />
        <YAxis unit="%" {...axisProps(c)} domain={[0, (max) => Math.max(100, Math.ceil(max / 10) * 10)]} />
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
        {filters[dim].map((k) => <ReferenceLine key={k} x={k} stroke={c.muted} strokeDasharray="3 3" />)}
        {OEE_SERIES.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={c.series[i]} strokeWidth={2} connectNulls
            hide={hidden.has(s.key)}
            dot={few ? { r: 3, strokeWidth: 0, fill: c.series[i] } : false} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

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

const DowntimeByMachine = ({ rowsFor, ctx, c, filters, onToggle, view }) => {
  const rows = rowsFor("machine");
  const data = useMemo(
    () => summarizeBy(rows, "machine", ctx)
      .map((g) => ({
        key: g.key,
        label: g.label,
        ...Object.fromEntries(STOPPAGE_GROUPS.map((grp) => [grp.key, grp.fields.reduce((sum, f) => sum + g.summary.downtimeByCause[f], 0)])),
      }))
      .filter((d) => STOPPAGE_GROUPS.some((grp) => d[grp.key] > 0))
      .sort(compareMachines(ctx)),
    [rows, ctx],
  );
  if (!data.length) return <Empty>No downtime recorded.</Empty>;
  if (view === "table") {
    return (
      <MiniTable columns={["Machine", ...STOPPAGE_GROUPS.map((g) => `${g.label} (min)`)]} selected={filters.machine} onRowClick={(k) => onToggle("machine", k)}
        rows={data.map((d) => ({ key: d.key, cells: [d.label, ...STOPPAGE_GROUPS.map((g) => formatExact("qty", d[g.key]))] }))} />
    );
  }
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="label" {...axisProps(c)} />
        <YAxis {...axisProps(c)} tickFormatter={(v) => FORMATS.qty(v)} />
        <Tooltip {...tooltipProps(c)} formatter={(v, name) => [formatExact("minutes", v), name]} />
        <Legend itemSorter={null} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: c.axis }}>{v}</span>} />
        {STOPPAGE_GROUPS.map((g, i) => (
          <Bar isAnimationActive={false} key={g.key} dataKey={g.key} name={g.label} stackId="d" fill={c.series[i]} stroke={c.surface} strokeWidth={1} maxBarSize={42}
            radius={i === STOPPAGE_GROUPS.length - 1 ? [4, 4, 0, 0] : 0} onClick={(d) => onToggle("machine", clickedKey(d))} style={{ cursor: "pointer" }}>
            {data.map((d) => <Cell key={d.key} fillOpacity={markOpacity(filters.machine, d.key)} />)}
          </Bar>
        ))}
      </BarChart>
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

const RunTimeByMachine = ({ rowsFor, ctx, c, filters, onToggle, view }) => {
  const bars = useDimBars(rowsFor("machine"), "machine", ctx, (s) => s.effectiveHours);
  if (!bars.length) return <Empty>Needs cycle time and OK quantity.</Empty>;
  if (view === "table") {
    return (
      <MiniTable columns={["Machine", "Effective run time"]} selected={filters.machine} onRowClick={(k) => onToggle("machine", k)}
        rows={bars.map((d) => ({ key: d.key, cells: [d.label, formatExact("hours", d.value)] }))} />
    );
  }
  const data = bars.map((d) => ({ name: d.label, value: d.value, nodeKey: d.key }));
  return (
    <ResponsiveContainer>
      <Treemap data={data} dataKey="value" aspectRatio={4 / 3} isAnimationActive={false}
        content={<TreemapCell c={c} selected={filters.machine} onSelect={(k) => onToggle("machine", k)} />}>
        <Tooltip {...tooltipProps(c)} formatter={(v) => [formatExact("hours", v), "Effective run time"]} labelFormatter={() => ""} />
      </Treemap>
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

  if (!n) return <Empty>Needs machine ON/OFF times.</Empty>;
  if (view === "table") {
    return (
      <MiniTable columns={["Machine", "Unreported time"]} selected={filters.machine} onRowClick={(k) => onToggle("machine", k)}
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
          <button type="button" className="pd-multiple-title" onClick={() => onToggle("machine", p.key)} title="Filter the dashboard to this machine">
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

// One row per machine. Read left to right: the quantities (Actual, OK, then OK %
// then the Rejected count and Rejected % that go with it), then run time,
// downtime and unreported time, and last the three OEE figures each in its own
// column — the same three the entries table shows — rather than one blended OEE.
const SUMMARY_COLUMNS = [
  { label: "Machine" },
  { label: "Actual", hint: "Actual quantity produced" },
  { label: "OK", hint: "Pieces that passed" },
  { label: "% OK", hint: "OK ÷ (OK + Rejected)" },
  { label: "Rejected", hint: "Actual − OK" },
  { label: "% Rejected", hint: "Rejected ÷ Actual" },
  { label: "Effective Run", hint: "OK × cycle time" },
  { label: "Downtime", hint: "All stoppage causes" },
  { label: "Unreported", hint: "Shift − effective run − downtime, per machine-day" },
  { label: "OEE · Losses", hint: "OEE considering losses — averaged over the machine's days" },
  { label: "OEE · Lunch", hint: "OEE not considering losses, but lunch — averaged over the machine's days" },
  { label: "OEE · Lunch + Setup Time", hint: "OEE not considering losses, but lunch and setup time — averaged over the machine's days" },
];

const MachineSummary = ({ rowsFor, ctx, filters, onToggle }) => {
  const rows = rowsFor("machine");
  const data = useMemo(() => summarizeBy(rows, "machine", ctx).sort(compareMachines(ctx)), [rows, ctx]);
  if (!data.length) return <Empty>No entries for this period.</Empty>;
  return (
    <MiniTable
      columns={SUMMARY_COLUMNS.map((c) => c.label)}
      hints={SUMMARY_COLUMNS.map((c) => c.hint)}
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
  runTimeByOperator: RunTimeByOperator,
  downtimeByMachine: DowntimeByMachine,
  runTimeByMachine: RunTimeByMachine,
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
