"use strict";

/**
 * OEE PDF report builder — reuses `aggregateOee` (server/utils/oeeAggregate.js)
 * so the numbers here never drift from what the Dashboard's "Efficiency
 * Report (OEE)" table shows on screen.
 */

const PDFDocument = require("pdfkit");
const { aggregateOee } = require("../utils/oeeAggregate");

const ALL_COLUMNS = [
  { key: "availMin", label: "Available Working (min)", width: 78, fmt: (n) => n.toFixed(2) },
  { key: "workMin", label: "Working Schedule (min)", width: 78, fmt: (n) => n.toFixed(2) },
  { key: "availRatio", label: "Availability Ratio", width: 68, fmt: (n) => n.toFixed(2) + "%" },
  { key: "okQty", label: "OK Qty", width: 55, fmt: (n) => String(Math.round(n)) },
  { key: "processQty", label: "Production Qty", width: 68, fmt: (n) => String(Math.round(n)) },
  { key: "qualRatio", label: "Quality Ratio", width: 65, fmt: (n) => n.toFixed(2) + "%" },
  { key: "idealQty", label: "Ideal Qty", width: 62, fmt: (n) => n.toFixed(2) },
  { key: "perfRatio", label: "Performance Ratio", width: 70, fmt: (n) => n.toFixed(2) + "%" },
  { key: "oee", label: "OEE %", width: 58, fmt: (n) => n.toFixed(2) + "%" },
];

function resolveColumns(columns) {
  if (!Array.isArray(columns) || columns.length === 0) return ALL_COLUMNS;
  const set = new Set(columns);
  const filtered = ALL_COLUMNS.filter((c) => set.has(c.key));
  return filtered.length > 0 ? filtered : ALL_COLUMNS;
}

function dateStrOf(e) {
  const raw = typeof e.date === "string" ? e.date : new Date(e.date).toISOString();
  return raw.split("T")[0];
}

function machineNameOf(e) {
  return e.machine && typeof e.machine === "object" ? e.machine.machineName || "—" : "—";
}

function drawTable(doc, { x, columns, rows }) {
  const rowHeight = 24;
  const headerHeight = 30;
  let curY = doc.y;

  const drawHeader = () => {
    let curX = x;
    doc.font("Helvetica-Bold").fontSize(7.5);
    columns.forEach((col) => {
      doc.rect(curX, curY, col.width, headerHeight).fillAndStroke("#0a1930", "#0a1930");
      doc.fillColor("#ffffff").text(col.label, curX + 2, curY + 8, {
        width: col.width - 4,
        align: "center",
      });
      curX += col.width;
    });
    curY += headerHeight;
  };

  drawHeader();

  rows.forEach((row) => {
    if (curY + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage({ layout: "landscape", size: "A4", margin: 30 });
      curY = doc.page.margins.top;
      drawHeader();
    }
    let curX = x;
    row.forEach((cell, i) => {
      doc.rect(curX, curY, columns[i].width, rowHeight).fillAndStroke(
        row.__isTotal ? "#f0f4f8" : "#ffffff",
        "#cbd5e1"
      );
      doc.font(row.__isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      doc.fillColor("#0f172a").text(String(cell), curX + 2, curY + 7, {
        width: columns[i].width - 4,
        align: "center",
      });
      curX += columns[i].width;
    });
    curY += rowHeight;
  });

  doc.y = curY + 10;
}

/**
 * One row per individual production entry in the selected date range (not
 * aggregated by day) — every entry's own Date + Machine + selected metrics,
 * plus a TOTAL row for the whole range.
 * @returns {PDFDocument} a readable PDFKit stream — caller pipes it to the response.
 */
function buildOeeReportPdf({ entries, filterDescription, from, to, columns }) {
  const doc = new PDFDocument({ margin: 30, layout: "landscape", size: "A4" });

  doc.fontSize(16).font("Helvetica-Bold").fillColor("#0a1930").text("Efficiency Report (OEE)");
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica").fillColor("#334155").text(filterDescription);
  doc.fontSize(9).fillColor("#64748b").text(from === to ? `Date: ${from}` : `Date Range: ${from} to ${to}`);
  doc.moveDown(0.8);

  if (entries.length === 0) {
    doc.fontSize(11).fillColor("#64748b").text("No production entries found for the selected filters.");
    return doc;
  }

  const cols = resolveColumns(columns);
  const tableColumns = [
    { key: "date", label: "Date", width: 70 },
    { key: "machine", label: "Machine", width: 90 },
    ...cols,
  ];

  const sorted = [...entries].sort((a, b) => {
    const d = dateStrOf(a).localeCompare(dateStrOf(b));
    return d !== 0 ? d : machineNameOf(a).localeCompare(machineNameOf(b));
  });

  const rows = sorted.map((e) => {
    const agg = aggregateOee([e]);
    return [dateStrOf(e), machineNameOf(e), ...cols.map((c) => c.fmt(agg[c.key]))];
  });

  const totalAgg = aggregateOee(entries);
  const totalRow = ["TOTAL", "", ...cols.map((c) => c.fmt(totalAgg[c.key]))];
  totalRow.__isTotal = true;
  rows.push(totalRow);

  drawTable(doc, { x: 30, columns: tableColumns, rows });

  return doc;
}

// ── Per-machine "Efficiency Report (OEE)" PDF — mirrors the Dashboard's
// on-screen card (3-column grid, navy headers, big OEE% footer), repeated
// once per machine. This is what the Dashboard's quick "Download PDF"
// button uses — scoped to whichever process(es) the user picks in that
// popup (every machine tagged under them, zero-filled if no entries),
// unlike the more broadly filterable Custom Report (buildOeeReportPdf
// above), which also allows a single specific machine. ─────────────────
const minFmt = (n) => Number(n || 0).toFixed(2);
const qtyFmt = (n) => String(Math.round(Number(n || 0)));
const pctFmt = (n) => Number(n || 0).toFixed(2) + "%";

function drawEfficiencyCard(doc, { x, y, width, machineLabel, agg }) {
  const colW = width / 3;
  const headerH = 26;
  const valueH = 32;
  const spacer = 8;
  let curY = y;

  if (machineLabel) {
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0a1930").text(machineLabel, x, curY, { width });
    curY += 20;
  }

  const rows = [
    [
      ["Available Working Time (mins)", "Working/ scheduled time (min)", "Availability Ratio"],
      [minFmt(agg.availMin), minFmt(agg.workMin), pctFmt(agg.availRatio)],
    ],
    [
      ["OK Quantity", "Process Quantity (Total Qty)", "Quality Ratio"],
      [qtyFmt(agg.okQty), qtyFmt(agg.processQty), pctFmt(agg.qualRatio)],
    ],
    [
      ["Process Quantity (Total Qty)", "Ideal Quantity", "Performance Ratio"],
      [qtyFmt(agg.processQty), minFmt(agg.idealQty), pctFmt(agg.perfRatio)],
    ],
  ];

  rows.forEach(([headers, values]) => {
    headers.forEach((h, i) => {
      doc.rect(x + i * colW, curY, colW, headerH).fillAndStroke("#0a1930", "#0a1930");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5).text(h, x + i * colW + 3, curY + 8, {
        width: colW - 6,
        align: "center",
      });
    });
    curY += headerH;
    values.forEach((v, i) => {
      const isRatioCol = i === 2;
      doc.rect(x + i * colW, curY, colW, valueH).fillAndStroke(isRatioCol ? "#f8f9fa" : "#ffffff", "#cbd5e1");
      doc.fillColor("#0f172a").font(isRatioCol ? "Helvetica-Bold" : "Helvetica").fontSize(9).text(v, x + i * colW + 3, curY + 11, {
        width: colW - 6,
        align: "center",
      });
    });
    curY += valueH + spacer;
  });

  doc.rect(x, curY, width, headerH).fillAndStroke("#0a1930", "#0a1930");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9).text("OEE %", x, curY + 8, { width, align: "center" });
  curY += headerH;

  const oeeH = 40;
  doc.rect(x, curY, width, oeeH).fillAndStroke("#f0f4f8", "#cbd5e1");
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(18).text(pctFmt(agg.oee), x, curY + 9, { width, align: "center" });
  curY += oeeH;

  return curY;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "YYYY-MM-DD" → weekday name, parsed as a local date so it never shifts a
// day off because of UTC conversion.
function weekdayName(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return WEEKDAY_NAMES[new Date(y, m - 1, d).getDay()];
}

const CARD_HEIGHT = 20 + 3 * (26 + 32 + 8) + 26 + 40;
const GROUP_HEADER_HEIGHT = 26;

const TOTAL_ACCENT_WIDTH = 5;

// Draws the process's combined-total card with a colored left accent strip
// so it reads as distinct from the individual machine cards below it —
// same table format either way (zero-filled machines look identical to
// ones with real data, just all-0 values).
function drawProcessTotalCard(doc, { x, y, width, processName, agg }) {
  doc.rect(x, y, TOTAL_ACCENT_WIDTH, CARD_HEIGHT).fill("#2563eb");
  return drawEfficiencyCard(doc, {
    x: x + TOTAL_ACCENT_WIDTH + 8,
    y,
    width: width - TOTAL_ACCENT_WIDTH - 8,
    machineLabel: `Process Total — ${processName}`,
    agg,
  });
}

// Same shape as drawProcessTotalCard but for the report-wide grand total
// (every machine across every process, counted once each) — a distinct
// accent color so it reads as "the one number that matters most" above
// the per-process/per-machine detail below it.
function drawOverallTotalCard(doc, { x, y, width, agg }) {
  doc.rect(x, y, TOTAL_ACCENT_WIDTH, CARD_HEIGHT).fill("#059669");
  return drawEfficiencyCard(doc, {
    x: x + TOTAL_ACCENT_WIDTH + 8,
    y,
    width: width - TOTAL_ACCENT_WIDTH - 8,
    machineLabel: "All Machines — Grand Total",
    agg,
  });
}

/**
 * @param grouped [{ processName, total, machines: [{ machineName, agg }] }]
 * @param overall aggregateOee() result across every unique machine (counted once each)
 * @returns {PDFDocument} a readable PDFKit stream — caller pipes it to the response.
 */
function buildOeeDashboardPdf({ grouped, overall, from, to }) {
  const doc = new PDFDocument({ margin: 30, size: "A4" });
  const x = 30;
  const width = doc.page.width - 60;
  const cardGap = 24;
  const groupGap = 16;

  doc.fontSize(16).font("Helvetica-Bold").fillColor("#0a1930").text("Efficiency Report (OEE) — By Process");
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor("#64748b").text(
    from === to ? `Date: ${from} (${weekdayName(from)})` : `Date Range: ${from} to ${to}`
  );
  doc.moveDown(0.8);

  if (grouped.length === 0) {
    doc.fontSize(11).fillColor("#64748b").text("No matching process found.");
    return doc;
  }

  let curY = doc.y;

  if (overall) {
    curY = drawOverallTotalCard(doc, { x, y: curY, width, agg: overall });
    curY += cardGap + groupGap;
  }
  grouped.forEach(({ processName, total, machines }) => {
    // Keep the process header glued to at least its total card.
    if (curY + GROUP_HEADER_HEIGHT + CARD_HEIGHT > doc.page.height - doc.page.margins.bottom) {
      doc.addPage({ size: "A4", margin: 30 });
      curY = doc.page.margins.top;
    }

    doc.rect(x, curY, width, GROUP_HEADER_HEIGHT).fillAndStroke("#1f2937", "#1f2937");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10).text(`Process: ${processName}`, x + 8, curY + 7);
    curY += GROUP_HEADER_HEIGHT + 10;

    if (curY + CARD_HEIGHT > doc.page.height - doc.page.margins.bottom) {
      doc.addPage({ size: "A4", margin: 30 });
      curY = doc.page.margins.top;
    }
    curY = drawProcessTotalCard(doc, { x, y: curY, width, processName, agg: total });
    curY += cardGap;

    // Every machine under this process — including ones with no entries
    // today, shown with all-0 values rather than skipped.
    machines.forEach(({ machineName, agg }) => {
      if (curY + CARD_HEIGHT > doc.page.height - doc.page.margins.bottom) {
        doc.addPage({ size: "A4", margin: 30 });
        curY = doc.page.margins.top;
      }
      curY = drawEfficiencyCard(doc, { x, y: curY, width, machineLabel: `Machine: ${machineName}`, agg });
      curY += cardGap;
    });

    curY += groupGap;
  });

  return doc;
}

// ── Daily OEE Trend chart PDF — mirrors the Dashboard's on-screen Recharts
// bar chart (blue bars, % labels on top, dashed gridlines, red Target 75%
// reference line, rotated date labels) so the download looks like the chart
// the user is looking at. Drawn with PDFKit vector primitives (no headless
// browser/canvas dependency) since every other report in this file already
// works that way. ───────────────────────────────────────────────────────
function drawBarChart(doc, { x, y, width, height, data, target, color = "#1f77b4" }) {
  const gridColor = "#e2e8f0";
  const axisColor = "#94a3b8";
  const textColor = "#64748b";

  const chartX = x + 34; // room for y-axis % labels
  const chartWidth = width - 34;
  const chartBottom = y + height;
  const maxVal = 100;

  // Y-axis gridlines + labels at 0/25/50/75/100%
  doc.font("Helvetica").fontSize(9);
  [0, 25, 50, 75, 100].forEach((tick) => {
    const ty = chartBottom - (tick / maxVal) * height;
    doc.strokeColor(gridColor).lineWidth(0.5)
      .moveTo(chartX, ty).lineTo(chartX + chartWidth, ty).dash(3, { space: 2 }).stroke().undash();
    doc.fillColor(textColor).text(`${tick}%`, x, ty - 4, { width: 30, align: "right" });
  });

  // X-axis baseline
  doc.strokeColor(axisColor).lineWidth(1).moveTo(chartX, chartBottom).lineTo(chartX + chartWidth, chartBottom).stroke();

  // Target reference line
  if (target != null) {
    const targetY = chartBottom - (target / maxVal) * height;
    doc.strokeColor("#dc2626").lineWidth(1.5)
      .moveTo(chartX, targetY).lineTo(chartX + chartWidth, targetY).dash(4, { space: 2 }).stroke().undash();
    doc.fillColor("#dc2626").font("Helvetica-Bold").fontSize(8)
      .text(`Target ${target}%`, chartX + chartWidth - 70, targetY - 12, { width: 70, align: "right" });
  }

  // Bars
  const n = data.length || 1;
  const slotWidth = chartWidth / n;
  const barWidth = Math.min(36, slotWidth * 0.55);

  data.forEach((d, i) => {
    const val = Number(d.OEE) || 0;
    const barHeight = (Math.min(val, maxVal) / maxVal) * height;
    const barX = chartX + i * slotWidth + (slotWidth - barWidth) / 2;
    const barY = chartBottom - barHeight;

    doc.fillColor(color).rect(barX, barY, barWidth, barHeight).fill();

    doc.fillColor("#334155").font("Helvetica-Bold").fontSize(7)
      .text(`${val}%`, barX - 10, barY - 11, { width: barWidth + 20, align: "center" });

    // Rotated date label under the bar, matching the on-screen -45° x-axis.
    const labelX = barX + barWidth / 2;
    doc.save();
    doc.rotate(-45, { origin: [labelX, chartBottom + 4] });
    doc.fillColor(textColor).font("Helvetica").fontSize(7.5)
      .text(d.date, labelX - 60, chartBottom + 4, { width: 60, align: "right" });
    doc.restore();
  });

  doc.y = chartBottom + 45;
}

/**
 * @param data [{ date, OEE }] — already-aggregated per-day OEE%, exactly as
 * shown in the Dashboard's Daily OEE Trend chart for the selected month.
 * @returns {PDFDocument} a readable PDFKit stream — caller pipes it to the response.
 */
function buildDailyOeeTrendPdf({ data, month, target = 75, filterDescription }) {
  const doc = new PDFDocument({ margin: 30, size: "A4" });

  doc.fontSize(16).font("Helvetica-Bold").fillColor("#0a1930").text("Daily OEE Trend");
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica").fillColor("#334155").text(`Month: ${month}`);
  if (filterDescription) {
    doc.fontSize(9).fillColor("#64748b").text(filterDescription);
  }
  doc.moveDown(0.8);

  if (!data || data.length === 0) {
    doc.fontSize(11).fillColor("#64748b").text("No production entries for this month.");
    return doc;
  }

  drawBarChart(doc, {
    x: 30,
    y: doc.y,
    width: doc.page.width - 60,
    height: 300,
    data,
    target,
  });

  return doc;
}

// ── Quick "Download PDF" on the Dashboard's Efficiency Report card — draws
// the exact same single card (same 3-column stat grid + big OEE% footer)
// the user is already looking at, for whatever From/To range and
// Process/Machine filter is currently active on screen. Reuses
// drawEfficiencyCard so this can never visually drift from the per-machine
// cards in buildOeeDashboardPdf above.
function buildEfficiencyCardPdf({ agg, from, to, filterDescription }) {
  const doc = new PDFDocument({ margin: 30, size: "A4" });

  doc.fontSize(16).font("Helvetica-Bold").fillColor("#0a1930").text("Efficiency Report (OEE)");
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica").fillColor("#334155").text(filterDescription);
  doc.fontSize(9).fillColor("#64748b").text(from === to ? `Date: ${from}` : `Date Range: ${from} to ${to}`);
  doc.moveDown(0.8);

  drawEfficiencyCard(doc, {
    x: 30,
    y: doc.y,
    width: doc.page.width - 60,
    machineLabel: null,
    agg,
  });

  return doc;
}

// Grinding Efficiency Report (Machine Efficiency / Operator Efficiency tabs)
// — one row per machine/operator, mirroring the on-screen table in
// GrindingEntry.jsx's EfficiencyModal (MACHINE_COLUMNS / OPERATOR_COLUMNS).
const fmtPctOrNa = (n) => (n == null ? "NA" : `${Number(n).toFixed(2)}%`);
const fmtQtyOrNa = (n) => (n == null ? "NA" : String(Math.round(Number(n))));

function buildGrindingEfficiencyPdf({ tab, rows, from, to, filterDescription }) {
  const doc = new PDFDocument({ margin: 30, layout: "landscape", size: "A4" });

  const nameLabel = tab === "operators" ? "Operator" : "Machine";
  doc.fontSize(16).font("Helvetica-Bold").fillColor("#0a1930").text(`Grinding ${nameLabel} Efficiency Report`);
  doc.moveDown(0.3);
  if (filterDescription) doc.fontSize(10).font("Helvetica").fillColor("#334155").text(filterDescription);
  doc.fontSize(9).fillColor("#64748b").text(from === to ? `Date: ${from}` : `Date Range: ${from} to ${to}`);
  doc.moveDown(0.8);

  if (!rows || rows.length === 0) {
    doc.fontSize(11).fillColor("#64748b").text(`No ${nameLabel.toLowerCase()} entries found for the selected filters.`);
    return doc;
  }

  const cols = tab === "operators"
    ? [
        { key: "name", label: nameLabel, width: 160 },
        { key: "processQty", label: "Actual Total Qty Produced", width: 120, fmt: fmtQtyOrNa },
        { key: "okQty", label: "Total OK Qty", width: 100, fmt: fmtQtyOrNa },
        { key: "performanceRatio", label: "Performance Ratio", width: 110, fmt: fmtPctOrNa },
        { key: "qualityRatio", label: "Quality Ratio", width: 100, fmt: fmtPctOrNa },
      ]
    : [
        { key: "name", label: nameLabel, width: 140 },
        { key: "processQty", label: "Production Qty", width: 90, fmt: fmtQtyOrNa },
        { key: "okQty", label: "OK Qty", width: 80, fmt: fmtQtyOrNa },
        { key: "oeePercent", label: "OEE %", width: 80, fmt: fmtPctOrNa },
        { key: "availabilityRatio", label: "Availability", width: 90, fmt: fmtPctOrNa },
        { key: "performanceRatio", label: "Performance", width: 90, fmt: fmtPctOrNa },
        { key: "qualityRatio", label: "Quality", width: 80, fmt: fmtPctOrNa },
      ];

  const tableColumns = cols.map((c) => ({ key: c.key, label: c.label, width: c.width }));
  const tableRows = rows.map((r) => cols.map((c) => (c.key === "name" ? r.name : c.fmt(r[c.key]))));

  drawTable(doc, { x: 30, columns: tableColumns, rows: tableRows });

  return doc;
}

module.exports = {
  buildOeeReportPdf, buildOeeDashboardPdf, buildDailyOeeTrendPdf, buildEfficiencyCardPdf,
  buildGrindingEfficiencyPdf, drawTable, ALL_COLUMNS,
};
