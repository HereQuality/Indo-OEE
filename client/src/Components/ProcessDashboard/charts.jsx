import React, { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, Treemap, XAxis, YAxis,
} from "recharts";
import { STOPPAGE_FIELDS } from "../../utils/productionSheet";
import {
  DIMENSIONS, FORMATS, STOPPAGE_GROUPS, causeLabel, causeMeasure, formatExact,
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

export const MiniTable = ({ columns, rows, onRowClick, selected = [] }) => (
  <div className="h-100 overflow-auto">
    <table className="table table-sm align-middle mb-0 pd-table">
      <thead>
        <tr>
          {columns.map((col, i) => (
            <th key={col} className={i ? "text-end" : ""}>{col}</th>
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
      dimLabel="Item" valueLabel="OK quantity" emptyText="No OK quantity entered." />
  );
};

const DowntimeByCause = ({ rowsFor, c, onDrill, ...rest }) => {
  const rows = rowsFor(null);
  const data = useMemo(() => {
    const by = summarize(rows).downtimeByCause;
    return STOPPAGE_FIELDS.map((f) => ({ key: f.key, label: causeLabel(f.key), value: by[f.key] }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [rows]);
  return (
    <HBars {...rest} data={data} c={c} color={c.downtime} format="minutes" onSelect={(k) => onDrill(causeMeasure(k))}
      dimLabel="Cause" valueLabel="Downtime" emptyText="No downtime recorded." />
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
  const data = useDimBars(rowsFor("machine"), "machine", ctx, (s) => pct100(s.oeeLosses), { sort: "label", positiveOnly: false });
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
  { key: "oeeLunchCot", label: "…but lunch & COT" },
];

const OeeTrend = ({ rowsFor, ctx, c, filters, onToggle, view }) => {
  const dim = ctx.bucket;
  const rows = rowsFor(dim);
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
        <Legend itemSorter={null} wrapperStyle={{ fontSize: 12 }} iconType="plainline" formatter={(v) => <span style={{ color: c.axis }}>{v}</span>} />
        {filters[dim].map((k) => <ReferenceLine key={k} x={k} stroke={c.muted} strokeDasharray="3 3" />)}
        {OEE_SERIES.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={c.series[i]} strokeWidth={2} connectNulls
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
      .sort(naturalSort),
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

const UnreportedByMachine = ({ rowsFor, ctx, c, filters, onToggle, view }) => {
  const dim = ctx.bucket;
  const rows = rowsFor(null);
  const { panels, domain } = useMemo(() => {
    const list = summarizeBy(rows, "machine", ctx).sort(naturalSort).map((m) => ({
      key: m.key,
      label: m.label,
      total: m.summary.unreportedMin,
      data: summarizeBy(rows.filter((r) => r.machine === m.key), dim, ctx)
        .map((g) => ({ key: g.key, value: g.summary.unreportedMin }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    }));
    const values = list.flatMap((p) => p.data.map((d) => d.value));
    return { panels: list, domain: [Math.min(0, ...values), Math.max(0, ...values)] };
  }, [rows, dim, ctx]);

  if (!panels.length) return <Empty>Needs machine ON/OFF times.</Empty>;
  if (view === "table") {
    return (
      <MiniTable columns={["Machine", "Unreported time"]} selected={filters.machine} onRowClick={(k) => onToggle("machine", k)}
        rows={panels.map((p) => ({ key: p.key, cells: [p.label, formatExact("minutes", p.total)] }))} />
    );
  }
  // Small multiples on one shared scale, so the panels compare honestly.
  return (
    <div className="h-100 overflow-auto pd-multiples">
      {panels.map((p) => (
        <div key={p.key}>
          <button type="button" className="pd-multiple-title" onClick={() => onToggle("machine", p.key)} title="Filter the dashboard to this machine">
            {p.label} <span className="text-muted fw-normal">· {FORMATS.minutes(p.total)}</span>
          </button>
          <div style={{ height: 104 }}>
            <ResponsiveContainer>
              <BarChart data={p.data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="key" {...axisProps(c)} tickFormatter={(k) => (dim === "date" ? k.slice(8) : DIMENSIONS.month.text(k).slice(0, 3))} minTickGap={12} />
                <YAxis {...axisProps(c)} domain={domain} tickCount={3} />
                <ReferenceLine y={0} stroke={c.muted} />
                <Tooltip {...tooltipProps(c)} labelFormatter={(k) => DIMENSIONS[dim].text(k)} formatter={(v) => [formatExact("minutes", v), "Unreported"]} />
                <Bar dataKey="value" fill={c.ok} radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  );
};

const MachineSummary = ({ rowsFor, ctx, filters, onToggle }) => {
  const rows = rowsFor("machine");
  const data = useMemo(() => summarizeBy(rows, "machine", ctx).sort(naturalSort), [rows, ctx]);
  if (!data.length) return <Empty>No entries for this period.</Empty>;
  return (
    <MiniTable
      columns={["Machine", "Actual", "OK", "Rejected", "% OK", "Effective Run", "Downtime", "Unreported", "OEE"]}
      selected={filters.machine}
      onRowClick={(k) => onToggle("machine", k)}
      rows={data.map(({ key, label, summary: s }) => ({
        key,
        cells: [label, formatExact("qty", s.totalQty), formatExact("qty", s.okQty), formatExact("qty", s.rejectedQty), FORMATS.pct(s.okPct),
          FORMATS.hours(s.effectiveHours), FORMATS.minutes(s.downtimeMin), FORMATS.minutes(s.unreportedMin), FORMATS.pct(s.oeeLosses)],
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
  downtimeByCause: DowntimeByCause,
  rejectByReason: RejectByReason,
  okPctByOperator: OkPctByOperator,
  outputByItem: OutputByItem,
  machineSummary: MachineSummary,
};

// Visuals that are already a table have no separate table view.
export const TABLE_ONLY = new Set(["machineSummary"]);
