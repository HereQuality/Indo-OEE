import React, { useRef } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Card, CardBody, CardHeader } from "reactstrap";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as XLSX from "xlsx";
import { useAlert } from "../../context/AlertContext";
import { LINE_COLORS, MONTHS, fmtQty } from "../../utils/kpi";

/**
 * The KPI page's Graph tab — every objective's OK Qty, month by month, as one
 * line each; the same figures in a table under it. Downloads as Excel (the
 * table) or PDF (chart + table, through the browser's print-to-PDF).
 * `objectives` are already the year's and the picked department's.
 */
const KpiGraphPanel = ({ year, objectives, departmentName, loading }) => {
  const toast = useAlert();
  const chartRef = useRef(null);
  // One line per objective, named "Department · Objective" so two departments' same-named objectives read apart.
  const series = objectives.map((o, i) => ({ key: o._id, name: `${o.department?.departmentName || ""} · ${o.objective}`, color: LINE_COLORS[i % LINE_COLORS.length] }));
  const rows = MONTHS.map((m, i) => {
    const row = { month: m };
    objectives.forEach((o) => { row[o._id] = o.months[i]?.okQty ?? 0; });
    return row;
  });
  const totals = Object.fromEntries(objectives.map((o) => [o._id, o.months.reduce((a, m) => a + m.okQty, 0)]));

  const fileStem = `KPI-Graph-${year}${departmentName ? `-${departmentName}` : ""}`.replace(/\s+/g, "-");

  const downloadExcel = () => {
    const header = ["Month", ...series.map((s) => s.name)];
    const body = rows.map((r) => [`${r.month} ${year}`, ...series.map((s) => r[s.key])]);
    body.push(["Year total", ...series.map((s) => totals[s.key])]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws["!cols"] = header.map((h, i) => ({ wch: i === 0 ? 14 : Math.max(12, String(h).length) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "OK Qty by month");
    XLSX.writeFile(wb, `${fileStem}.xlsx`);
  };

  // The chart's own SVG and the table, printed on their own page — the print
  // dialog's "Save as PDF" writes the file.
  const downloadPdf = () => {
    const svg = chartRef.current?.querySelector("svg")?.outerHTML || "";
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const table = `<table><thead><tr><th>Month</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr><td>${r.month} ${year}</td>${series.map((s) => `<td class="n">${fmtQty(r[s.key])}</td>`).join("")}</tr>`)
      .join("")}<tr class="t"><td>Year total</td>${series.map((s) => `<td class="n">${fmtQty(totals[s.key])}</td>`).join("")}</tr></tbody></table>`;
    const w = window.open("", "_blank", "width=1000,height=800");
    if (!w) return toast.error("Allow pop-ups for this site to download the PDF");
    w.document.write(`<!doctype html><html><head><title>${esc(fileStem)}</title><style>
      body{font-family:Arial,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 16px;color:#555;font-size:12px}
      svg{max-width:100%;height:auto}table{border-collapse:collapse;width:100%;margin-top:16px;font-size:12px}th,td{border:1px solid #bbb;padding:4px 8px;text-align:left}
      td.n{text-align:right}tr.t td{font-weight:bold;background:#f2f2f2}@page{size:A4 landscape;margin:12mm}</style></head>
      <body><h1>KPI Graph — OK Qty by month, ${year}</h1><p>${esc(series.map((s) => s.name).join(" · ") || "No objectives")}</p>${svg}${table}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <>
      <Card className="mb-3 border-0 shadow-sm">
        <CardHeader className="bg-transparent d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h6 className="mb-0">OK Qty by month · {year}{departmentName ? ` · ${departmentName}` : ""}</h6>
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline-success btn-sm d-inline-flex align-items-center gap-1" onClick={downloadExcel} disabled={!series.length}>
              <FileSpreadsheet size={16} /> Excel
            </button>
            <button type="button" className="btn btn-outline-danger btn-sm d-inline-flex align-items-center gap-1" onClick={downloadPdf} disabled={!series.length}>
              <Download size={16} /> PDF
            </button>
          </div>
        </CardHeader>
        <CardBody>
          {!series.length ? (
            <div className="text-center text-muted py-4">
              {loading ? "Loading…" : (
                <>
                  <div className="fw-semibold">No line to draw yet</div>
                  <div className="small">The graph shows one line per objective. Add an objective for {year}{departmentName ? ` in ${departmentName}` : ""} with the <strong>Add Objective</strong> button, and its OK Qty by month appears here.</div>
                </>
              )}
            </div>
          ) : (
            <div ref={chartRef} style={{ width: "100%", height: "min(60vh, 420px)", minHeight: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(v) => fmtQty(v)} width={64} />
                  <Tooltip formatter={(v) => fmtQty(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {series.map((s) => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      {series.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader><h6 className="mb-0">OK Qty by month</h6></CardHeader>
          <CardBody className="p-0">
            <div className="table-responsive">
              <table className="table table-sm table-hover mb-0 align-middle" style={{ minWidth: 320 + series.length * 140 }}>
                <thead className="table-light">
                  <tr>
                    <th scope="col">Month</th>
                    {series.map((s) => <th key={s.key} scope="col" className="text-end" style={{ color: s.color }}>{s.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.month}>
                      <td>{r.month} {year}</td>
                      {series.map((s) => <td key={s.key} className="text-end">{fmtQty(r[s.key])}</td>)}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="table-light">
                  <tr>
                    <th scope="row">Year total</th>
                    {series.map((s) => <td key={s.key} className="text-end fw-semibold">{fmtQty(totals[s.key])}</td>)}
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
};

export default KpiGraphPanel;
