import React, { useContext, useMemo } from "react";
import { Card, CardBody, Col, Row } from "reactstrap";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ThemeContext } from "../../context/ThemeContext";
import { STOPPAGE_FIELDS, dayCalc, displayDay, fmtNum, fmtPct, rowCalc } from "../../utils/productionSheet";

/**
 * components/Production/ProductionDashboard.jsx
 * ──────────────────────────────────────────────
 * Read-only roll-up of the entries the page has already loaded — no extra
 * request, and every number uses the same formulas as the entry form
 * (utils/productionSheet.js), so the two can never disagree.
 *
 * OEE is a per-machine-per-day figure, so it is averaged over machine/day
 * pairs rather than over entries — three entries on one machine on one day
 * count once, not three times.
 *
 * Colours come from the validated categorical palette and are assigned by
 * entity, not by rank: OK/efficiency = blue, rejection = orange, downtime =
 * aqua. Each chart carries direct labels, and the machine table below is the
 * table view — both are required relief because aqua sits under 3:1 contrast
 * on the light surface.
 */

const SERIES = {
  light: { ok: "#2a78d6", reject: "#eb6834", downtime: "#1baf7a", grid: "#e2e8f0", axis: "#52514e" },
  dark: { ok: "#3987e5", reject: "#d95926", downtime: "#199e70", grid: "#334155", axis: "#c3c2b7" },
};

const num = (v) => (Number.isFinite(v) ? v : 0);

const StatTile = ({ label, value, sub, accent }) => (
  <Col xs={6} md={4} xl={3} className="mb-3">
    <Card className="h-100 border-0 shadow-sm">
      <CardBody className="py-3">
        <div className="text-muted text-uppercase" style={{ fontSize: "0.68rem", letterSpacing: "0.05em" }}>
          {label}
        </div>
        <div className="fw-bold mt-1" style={{ fontSize: "1.6rem", lineHeight: 1.2, color: accent }}>
          {value}
        </div>
        {sub && <div className="text-muted small mt-1">{sub}</div>}
      </CardBody>
    </Card>
  </Col>
);

const ChartCard = ({ title, hint, height = 280, children }) => (
  <Card className="h-100 border-0 shadow-sm">
    <CardBody>
      <h6 className="fw-semibold mb-0">{title}</h6>
      {hint && <div className="text-muted small mb-2">{hint}</div>}
      <div style={{ width: "100%", height }}>{children}</div>
    </CardBody>
  </Card>
);

const EmptyChart = ({ children }) => (
  <div className="d-flex align-items-center justify-content-center h-100 text-muted small">{children}</div>
);

const ProductionDashboard = ({ rows = [], machines = [], loading = false, periodLabel = "" }) => {
  const { isDarkMode } = useContext(ThemeContext) || {};
  const c = isDarkMode ? SERIES.dark : SERIES.light;

  const machineName = useMemo(
    () => Object.fromEntries(machines.map((m) => [m._id, m.machineName])),
    [machines],
  );

  const stats = useMemo(() => {
    let actual = 0;
    let ok = 0;
    let rejected = 0;
    let effectiveHours = 0;
    let shiftHours = 0;
    let stoppageMin = 0;
    let idealQty = 0;
    let plannedShiftHours = 0;
    let unreportedMin = 0;
    const setupEff = [];

    const downtimeByCause = Object.fromEntries(STOPPAGE_FIELDS.map((f) => [f.key, 0]));
    const rejectByReason = {};
    // Grouped so OEE is averaged per machine-day, not per entry.
    const byMachineDay = {};
    const byMachine = {};
    const byDay = {};

    for (const row of rows) {
      const calc = rowCalc(row);
      actual += num(calc.actualQty);
      ok += num(Number(row.okQty));
      rejected += num(calc.rejectedQty);
      effectiveHours += num(calc.effectiveHours);
      shiftHours += num(calc.shiftHours);
      stoppageMin += num(calc.totalStoppageMin);
      idealQty += num(calc.idealQty);
      plannedShiftHours += num(Number(row.plannedOperatorShiftHours));
      if (Number.isFinite(calc.setupEfficiency)) setupEff.push(calc.setupEfficiency);

      for (const f of STOPPAGE_FIELDS) downtimeByCause[f.key] += num(Number(row[f.key]));

      const rej = num(calc.rejectedQty);
      if (rej > 0) {
        // Entries saved from the current form carry a per-reason split, which
        // is used as-is. Older ones carry a single reason for the whole lot,
        // and are counted against that reason so the two kinds add up in one
        // chart rather than needing two.
        const split = row.rejectBreakdown || {};
        const splitEntries = Object.entries(split).filter(([, qty]) => num(Number(qty)) > 0);
        if (splitEntries.length) {
          for (const [reason, qty] of splitEntries) {
            rejectByReason[reason] = (rejectByReason[reason] || 0) + num(Number(qty));
          }
        } else {
          const reason = row.rejectReason || "Not specified";
          rejectByReason[reason] = (rejectByReason[reason] || 0) + rej;
        }
      }

      (byMachineDay[`${row.machine}|${row.date}`] ||= []).push(row);

      const day = (byDay[row.date] ||= { date: row.date, ok: 0, rejected: 0 });
      day.ok += num(Number(row.okQty));
      day.rejected += rej;
    }

    const oeeLunchAll = [];
    const oeeLunchCotAll = [];

    // One dayCalc per machine-day pair; OEE is averaged across those pairs.
    for (const [key, group] of Object.entries(byMachineDay)) {
      const [machineId] = key.split("|");
      const d = dayCalc(group);
      const m = (byMachine[machineId] ||= { machineId, oeeSum: 0, oeeCount: 0, ok: 0, rejected: 0, effectiveHours: 0 });
      if (Number.isFinite(d.oeeLosses)) {
        m.oeeSum += d.oeeLosses;
        m.oeeCount += 1;
      }
      if (Number.isFinite(d.unreportedMin)) unreportedMin += d.unreportedMin;
      if (Number.isFinite(d.oeeLunch)) oeeLunchAll.push(d.oeeLunch);
      if (Number.isFinite(d.oeeLunchCot)) oeeLunchCotAll.push(d.oeeLunchCot);
      for (const row of group) {
        const calc = rowCalc(row);
        m.ok += num(Number(row.okQty));
        m.rejected += num(calc.rejectedQty);
        m.effectiveHours += num(calc.effectiveHours);
      }
    }

    const machineRows = Object.values(byMachine)
      .map((m) => ({
        ...m,
        name: machineName[m.machineId] || "—",
        oee: m.oeeCount ? m.oeeSum / m.oeeCount : null,
        pctOk: m.ok + m.rejected > 0 ? m.ok / (m.ok + m.rejected) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const oeeValues = machineRows.filter((m) => m.oee !== null);

    const mean = (arr) => (arr.length ? arr.reduce((sum, v) => sum + v, 0) / arr.length : null);

    return {
      actual,
      ok,
      rejected,
      effectiveHours,
      shiftHours,
      stoppageMin,
      idealQty,
      plannedShiftHours,
      unreportedMin,
      setupEfficiency: mean(setupEff),
      oeeLunch: mean(oeeLunchAll),
      oeeLunchCot: mean(oeeLunchCotAll),
      pctOk: actual > 0 ? ok / actual : null,
      avgOee: oeeValues.length ? oeeValues.reduce((s, m) => s + m.oee, 0) / oeeValues.length : null,
      machineRows,
      oeeChart: machineRows.filter((m) => m.oee !== null).map((m) => ({ name: m.name, oee: m.oee * 100 })),
      dayChart: Object.values(byDay)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => ({ ...d, label: d.date.slice(8) })),
      downtimeChart: STOPPAGE_FIELDS.map((f) => ({
        name: f.label.replace(" (min)", ""),
        minutes: downtimeByCause[f.key],
      }))
        .filter((d) => d.minutes > 0)
        .sort((a, b) => b.minutes - a.minutes),
      rejectChart: Object.entries(rejectByReason)
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty),
    };
  }, [rows, machineName]);

  const tooltipStyle = {
    contentStyle: {
      background: isDarkMode ? "#1a1a19" : "#ffffff",
      border: `1px solid ${c.grid}`,
      borderRadius: 8,
      fontSize: 12,
    },
  };
  const axisProps = { stroke: c.axis, tick: { fill: c.axis, fontSize: 11 } };

  if (loading) {
    return <div className="text-center text-muted py-5">Loading dashboard…</div>;
  }

  if (!rows.length) {
    return (
      <div className="text-center text-muted py-5">
        No entries for {periodLabel || "this period"}. Add an entry to see the dashboard.
      </div>
    );
  }

  return (
    <>
      <Row>
        <StatTile label="Machine Shift" value={`${fmtNum(stats.shiftHours)} hr`} sub={periodLabel} />
        <StatTile label="Ideal Quantity" value={fmtNum(stats.idealQty)} />
        <StatTile label="Actual Quantity" value={fmtNum(stats.actual)} />
        <StatTile label="OK Quantity" value={fmtNum(stats.ok)} accent={c.ok} />
        <StatTile label="Rejected" value={fmtNum(stats.rejected)} accent={c.reject} />
        <StatTile label="% OK Quantity" value={fmtPct(stats.pctOk)} sub="OK ÷ Actual" />
        <StatTile label="Planned Operator Shift Time" value={`${fmtNum(stats.plannedShiftHours)} hr`} />
        <StatTile label="Utilized Machine Time" value="—" sub="Formula pending" />
        <StatTile
          label="Downtime"
          value={`${fmtNum(stats.stoppageMin)} min`}
          sub={`${fmtNum(stats.stoppageMin / 60)} hr`}
          accent={c.downtime}
        />
        <StatTile label="Effective Machine Runtime" value={`${fmtNum(stats.effectiveHours)} hr`} />
        <StatTile label="Unreported Time" value={`${fmtNum(stats.unreportedMin)} min`} />
        <StatTile label="Setup Efficiency" value={fmtPct(stats.setupEfficiency)} />
        <StatTile label="OEE considering losses" value={fmtPct(stats.avgOee)} sub="Averaged per machine-day" />
        <StatTile label="OEE not considering losses but lunch" value={fmtPct(stats.oeeLunch)} />
        <StatTile label="OEE not considering losses but lunch and COT" value={fmtPct(stats.oeeLunchCot)} />
      </Row>

      <Row className="g-3 mb-3">
        <Col xl={6}>
          <ChartCard title="OEE by machine" hint="Considering losses — average of that machine's days.">
            {stats.oeeChart.length ? (
              <ResponsiveContainer>
                <BarChart data={stats.oeeChart} margin={{ top: 18, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis unit="%" {...axisProps} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v.toFixed(1)}%`, "OEE"]} />
                  <Bar dataKey="oee" fill={c.ok} radius={[4, 4, 0, 0]} maxBarSize={38}>
                    <LabelList
                      dataKey="oee"
                      position="top"
                      fill={c.axis}
                      fontSize={11}
                      formatter={(v) => `${v.toFixed(0)}%`}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart>Needs machine ON/OFF times and OK quantity.</EmptyChart>
            )}
          </ChartCard>
        </Col>

        <Col xl={6}>
          <ChartCard title="OK vs Rejected by day" hint="Stacked — the full bar is the day's actual quantity.">
            <ResponsiveContainer>
              <BarChart data={stats.dayChart} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip
                  {...tooltipStyle}
                  labelFormatter={(_, p) => (p?.[0] ? displayDay(p[0].payload.date) : "")}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: c.axis }} />
                <Bar dataKey="ok" name="OK" stackId="q" fill={c.ok} maxBarSize={34} />
                <Bar dataKey="rejected" name="Rejected" stackId="q" fill={c.reject} radius={[4, 4, 0, 0]} maxBarSize={34} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Col>
      </Row>

      <Row className="g-3 mb-3">
        <Col xl={6}>
          <ChartCard title="Downtime by cause" hint="Total minutes lost across the period.">
            {stats.downtimeChart.length ? (
              <ResponsiveContainer>
                <BarChart
                  data={stats.downtimeChart}
                  layout="vertical"
                  margin={{ top: 4, right: 44, left: 96, bottom: 0 }}
                >
                  <CartesianGrid stroke={c.grid} horizontal={false} />
                  <XAxis type="number" {...axisProps} />
                  <YAxis type="category" dataKey="name" width={150} {...axisProps} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${fmtNum(v)} min`, "Downtime"]} />
                  <Bar dataKey="minutes" fill={c.downtime} radius={[0, 4, 4, 0]} maxBarSize={18}>
                    <LabelList dataKey="minutes" position="right" fill={c.axis} fontSize={11} formatter={(v) => fmtNum(v)} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart>No downtime recorded.</EmptyChart>
            )}
          </ChartCard>
        </Col>

        <Col xl={6}>
          <ChartCard title="Rejections by reason" hint="Rejected quantity grouped by the reason on each entry.">
            {stats.rejectChart.length ? (
              <ResponsiveContainer>
                <BarChart data={stats.rejectChart} layout="vertical" margin={{ top: 4, right: 44, left: 96, bottom: 0 }}>
                  <CartesianGrid stroke={c.grid} horizontal={false} />
                  <XAxis type="number" {...axisProps} />
                  <YAxis type="category" dataKey="name" width={150} {...axisProps} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [fmtNum(v), "Rejected"]} />
                  <Bar dataKey="qty" fill={c.reject} radius={[0, 4, 4, 0]} maxBarSize={18}>
                    <LabelList dataKey="qty" position="right" fill={c.axis} fontSize={11} formatter={(v) => fmtNum(v)} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart>Nothing rejected in this period.</EmptyChart>
            )}
          </ChartCard>
        </Col>
      </Row>

      <Card className="border-0 shadow-sm">
        <CardBody>
          <h6 className="fw-semibold mb-2">Machine summary</h6>
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr className="text-muted small text-uppercase">
                  <th>Machine</th>
                  <th className="text-end">OK</th>
                  <th className="text-end">Rejected</th>
                  <th className="text-end">% OK</th>
                  <th className="text-end">Effective Run (hr)</th>
                  <th className="text-end">OEE</th>
                </tr>
              </thead>
              <tbody>
                {stats.machineRows.map((m) => (
                  <tr key={m.machineId}>
                    <td className="fw-semibold">{m.name}</td>
                    <td className="text-end">{fmtNum(m.ok)}</td>
                    <td className="text-end">{fmtNum(m.rejected)}</td>
                    <td className="text-end">{fmtPct(m.pctOk)}</td>
                    <td className="text-end">{fmtNum(m.effectiveHours)}</td>
                    <td className="text-end">{fmtPct(m.oee)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </>
  );
};

export default ProductionDashboard;
