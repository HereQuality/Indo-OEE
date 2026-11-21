import React from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MONTHS, fmtPct } from "../../utils/kpi";
import { fmtMetric, fmtMoneyFull, fmtMoneyShort, metricByKey } from "../../utils/companyMetrics";

/**
 * The Company Level Objective board's charts — one axis each, recessive grid,
 * thin marks, a tooltip with the full figure, a legend whenever there are two
 * series. `data` is 12 rows { month, name, <key>… } built by the page.
 */
const TICK = { fontSize: 11, fill: "#64748b" };
const GRID = { strokeDasharray: "3 3", vertical: false, stroke: "#e2e8f0" };

const tip = (series) => ({
  contentStyle: { fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" },
  formatter: (v, name) => {
    const s = series.find((x) => x.label === name || x.key === name);
    const metric = s?.metricKey ? metricByKey(s.metricKey) : null;
    return [metric ? fmtMetric(metric, v, { full: true }) : s?.fmtFull ? s.fmtFull(v) : v, s?.label || name];
  },
  labelFormatter: (l, p) => (p?.[0]?.payload?.year ? `${l} ${p[0].payload.year}` : l),
});

export const Legend = ({ series }) =>
  series.length > 1 ? (
    <div className="co-legend mb-1" aria-label="Legend">
      {series.map((s) => <span key={s.key}><span className="co-legend__dot" style={{ background: s.color, ...(s.dashed ? { background: "transparent", borderTop: `2px dashed ${s.color}`, height: 0, verticalAlign: "3px" } : {}) }} />{s.label}</span>)}
    </div>
  ) : null;

const hasAny = (data, series) => data.some((d) => series.some((s) => d[s.key] !== null && d[s.key] !== undefined));

export const Empty = ({ children = "No figures for this year yet — add them with Monthly Figures or Upload Excel." }) => <div className="co-empty">{children}</div>;

// Grouped bars by month (one unit across the series); a dashed line for a target.
export const MonthBars = ({ data, series, target, yFmt = fmtMoneyShort, selected, onPick, short }) => {
  if (!hasAny(data, [...series, ...(target ? [target] : [])])) return <Empty />;
  const all = [...series, ...(target ? [target] : [])];
  return (
    <>
      <Legend series={all} />
      <div className={`co-chart${short ? " co-chart--short" : ""}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%" onClick={(e) => onPick && e?.activePayload?.[0]?.payload?.month && onPick(e.activePayload[0].payload.month)}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} interval={0} />
            <YAxis tickFormatter={yFmt} width={52} tick={TICK} axisLine={false} tickLine={false} />
            <Tooltip {...tip(all)} cursor={{ fill: "rgba(37, 99, 235, .06)" }} />
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={28} cursor={onPick ? "pointer" : undefined}>
                {selected !== undefined && data.map((d) => <Cell key={d.month} fill={d.month === selected || !selected ? s.color : `${s.color}66`} />)}
              </Bar>
            ))}
            {target && <Line type="monotone" dataKey={target.key} name={target.label} stroke={target.color} strokeDasharray="6 4" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
};

// Lines by month (≥ 8px markers so a single month still shows).
export const MonthLines = ({ data, series, yFmt, short, domain }) => {
  if (!hasAny(data, series)) return <Empty />;
  return (
    <>
      <Legend series={series} />
      <div className={`co-chart${short ? " co-chart--short" : ""}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} interval={0} />
            <YAxis tickFormatter={yFmt} width={44} tick={TICK} axisLine={false} tickLine={false} domain={domain} />
            <Tooltip {...tip(series)} />
            {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "6 4" : undefined} dot={{ r: 4, strokeWidth: 2, fill: "#fff" }} activeDot={{ r: 6 }} isAnimationActive={false} connectNulls />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
};

// A half gauge for a 0–100 % figure (on-time delivery).
export const Gauge = ({ value, label = "" }) => {
  const v = value === null || value === undefined ? null : Math.max(0, Math.min(100, Number(value)));
  const colour = v === null ? "#cbd5e1" : v >= 95 ? "#16a34a" : v >= 85 ? "#d97706" : "#dc2626";
  return (
    <div>
      <div className="co-gauge" role="img" aria-label={`${label} ${v === null ? "no figure" : fmtPct(v)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart cx="50%" cy="85%" innerRadius="72%" outerRadius="100%" startAngle={180} endAngle={0} data={[{ value: v ?? 0 }]} barSize={18}>
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar dataKey="value" cornerRadius={9} fill={colour} background={{ fill: "#e2e8f0" }} isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="co-gauge__value" style={{ color: v === null ? "#94a3b8" : undefined }}>{v === null ? "—" : fmtPct(v)}</div>
      </div>
      <div className="co-gauge__scale"><span>0%</span><span>100%</span></div>
    </div>
  );
};

// FG / RM / WIP as one segmented bar — the board's treemap, readable at a glance.
export const InventoryBar = ({ parts }) => {
  const have = parts.filter((p) => p.value !== null && p.value !== undefined && p.value > 0);
  const total = have.reduce((a, p) => a + p.value, 0);
  if (!total) return <Empty>No FG / RM / WIP figures yet.</Empty>;
  return (
    <>
      <div className="co-inv" role="img" aria-label={have.map((p) => `${p.label} ${fmtMoneyFull(p.value)}`).join(", ")}>
        {have.map((p) => (
          <div key={p.key} className="co-inv__seg" style={{ flex: `${Math.max(p.value / total, 0.12)} 1 0`, background: p.color }} title={`${p.label}: ${fmtMoneyFull(p.value)} · ${fmtPct((p.value / total) * 100)}`}>
            <small>{p.label}</small>
            <strong>{fmtMoneyShort(p.value)}</strong>
          </div>
        ))}
      </div>
      <div className="co-legend mt-2">
        {have.map((p) => <span key={p.key}><span className="co-legend__dot" style={{ background: p.color }} />{p.label} · {fmtPct((p.value / total) * 100)}</span>)}
        <span className="ms-auto fw-semibold text-body">Total {fmtMoneyShort(total)}</span>
      </div>
    </>
  );
};

export const monthRows = (year, metrics, byMonth) =>
  MONTHS.map((name, i) => {
    const row = { month: i + 1, name, year, okQty: byMonth?.[i]?.okQty ?? 0 };
    for (const [k, m] of Object.entries(metrics || {})) row[k] = m.months?.[i] ?? null;
    return row;
  });
