const PDFDocument = require("pdfkit");

/**
 * utils/oeeReportPdf.js
 * ──────────────────────
 * The Efficiency Report (OEE) as a PDF, from a utils/dashboardSummary.js
 * summary: the scope (period, process, machines), then in this order: the
 * process-wise table (all machines combined), the OEE band, the nine figure
 * tiles, the daily OEE chart, and one machine-wise table (each process a band
 * with its machines and total). One process: its machine-wise table opens it.
 * Returns a Buffer.
 */
const INK = "#0b1220";
const MUTED = "#6b7280";
const LINE = "#d1d5db";
const ACCENT = "#2563eb";
const TILE_HEAD = "#0f172a";
const TILE_BODY = "#f1f5f9";

const fmtQty = (n) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(n) || 0);
const fmtMin = (n) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n) || 0);
const fmtPct = (r) => (Number.isFinite(r) ? `${(r * 100).toFixed(2)}%` : "—");
const dmy = (iso) => {
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
};
const periodLabel = ({ from, to }) => (from === to ? dmy(from) : `${dmy(from)} to ${dmy(to)}`);

/**
 * @param {object} summary   summarizeRange's result
 * @param {object} scope     { title, processLabel, machineLabel, generatedBy }
 */
const buildOeeReportPdf = (summary, scope = {}) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, info: { Title: scope.title || "Efficiency Report (OEE)" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const need = (h) => {
      if (doc.y + h > bottom()) doc.addPage();
    };

    // ── header ──
    doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(scope.title || "Efficiency Report (OEE)", left, doc.y);
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(10).fillColor(MUTED);
    doc.text(`Period: ${periodLabel(summary)}`);
    doc.text(`Process: ${scope.processLabel || "All processes"}   ·   Machines: ${scope.machineLabel || "All machines"}`);
    doc.text(`Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}${scope.generatedBy ? ` by ${scope.generatedBy}` : ""}`);
    doc.moveDown(0.6);
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor(LINE).lineWidth(1).stroke();
    doc.moveDown(0.6);

    // ── tables ──
    const cols = [
      { label: "Entries", w: 44, get: (r) => fmtQty(r.entries) },
      { label: "OK Qty", w: 52, get: (r) => fmtQty(r.okQty) },
      { label: "Total Qty", w: 52, get: (r) => fmtQty(r.totalQty) },
      { label: "Rejected", w: 48, get: (r) => fmtQty(r.rejectedQty) },
      { label: "Avail.", w: 46, get: (r) => fmtPct(r.availability) },
      { label: "Perf.", w: 46, get: (r) => fmtPct(r.performance) },
      { label: "Quality", w: 46, get: (r) => fmtPct(r.quality) },
      { label: "OEE", w: 50, get: (r) => fmtPct(r.oee) },
    ];
    const numW = cols.reduce((s, c) => s + c.w, 0);
    const nameW = width - numW;
    const rowH = 17;
    // OEE at a glance: world class from 85%, a concern below 60%; over 100%
    // can't be right (it goes to OEE Review), so it gets its own colour.
    const oeeColor = (r) =>
      !Number.isFinite(r) ? INK : r > 1.0005 ? "#7c3aed" : r >= 0.85 ? "#047857" : r >= 0.6 ? "#b45309" : "#b91c1c";

    // One table, one header row: `table(title, nameLabel)` starts it; rows
    // follow. If the table runs onto a new page its header row is drawn again
    // there (marked "continued") so the columns stay readable.
    let head = null;
    let zebra = 0;
    const headRow = () => {
      const hy = doc.y;
      doc.rect(left, hy, width, rowH + 2).fillColor(TILE_HEAD).fill();
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff").text(head.nameLabel, left + 8, hy + 5, { width: nameW - 10, lineBreak: false });
      let x = left + nameW;
      for (const c of cols) {
        doc.text(c.label, x, hy + 5, { width: c.w - 6, align: "right", lineBreak: false });
        x += c.w;
      }
      doc.y = hy + rowH + 2;
    };
    const room = (h) => {
      if (doc.y + h <= bottom()) return;
      doc.addPage();
      if (head) {
        doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text(`${head.title} (continued)`, left, doc.y);
        doc.moveDown(0.3);
        headRow();
      }
    };
    const table = (title, nameLabel) => {
      head = null;
      need(rowH * 5);
      doc.moveDown(0.8);
      doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(title, left, doc.y);
      doc.moveDown(0.35);
      head = { title, nameLabel };
      zebra = 0;
      headRow();
    };
    const endTable = () => {
      head = null;
    };
    // A process's name band inside the machine-wise table.
    const band = (name, note) => {
      room(rowH * 3);
      const by = doc.y;
      doc.rect(left, by, width, rowH + 1).fillColor("#e0e7ff").fill();
      doc.rect(left, by, 3, rowH + 1).fillColor(ACCENT).fill();
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#1e3a8a").text(name.toUpperCase(), left + 10, by + 5, { continued: !!note, lineBreak: false });
      if (note) doc.font("Helvetica").fontSize(8).fillColor("#4b5563").text(`   ${note}`, { lineBreak: false });
      doc.y = by + rowH + 1;
      zebra = 0;
    };
    const line = (name, r, { total = false, indent = 0 } = {}) => {
      room(rowH);
      const ly = doc.y;
      if (total) doc.rect(left, ly, width, rowH).fillColor("#e2e8f0").fill();
      else if (zebra++ % 2 === 1) doc.rect(left, ly, width, rowH).fillColor("#f8fafc").fill();
      doc.font(total ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(INK);
      doc.text(name, left + 8 + indent, ly + 4.5, { width: nameW - 10 - indent, lineBreak: false, ellipsis: true });
      let x = left + nameW;
      for (const c of cols) {
        const isOee = c.label === "OEE";
        doc.font(total || isOee ? "Helvetica-Bold" : "Helvetica").fillColor(isOee ? oeeColor(r.oee) : INK);
        doc.text(c.get(r), x, ly + 4.5, { width: c.w - 6, align: "right", lineBreak: false });
        x += c.w;
      }
      doc.moveTo(left, ly + rowH).lineTo(left + width, ly + rowH).strokeColor(total ? "#94a3b8" : "#e5e7eb").lineWidth(total ? 0.8 : 0.5).stroke();
      doc.y = ly + rowH;
    };
    const legend = () => {
      doc.moveDown(0.35);
      const ly = doc.y;
      let x = left;
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text("OEE:", x, ly, { lineBreak: false });
      x += 24;
      for (const [c, t] of [["#047857", "85% to 100% (world class)"], ["#b45309", "60% to 85%"], ["#b91c1c", "below 60% (needs attention)"], ["#7c3aed", "over 100% (check the entries)"]]) {
        doc.circle(x + 3, ly + 3, 3).fillColor(c).fill();
        doc.fillColor(MUTED).text(t, x + 9, ly, { lineBreak: false });
        x += 9 + doc.widthOfString(t) + 14;
      }
      doc.y = ly + 10;
    };
    const machineCount = (p) => `${p.machines.length} machine${p.machines.length === 1 ? "" : "s"}`;

    // A report of one process opens with its machines (the by-process table
    // would only repeat that one process as its own total) and words
    // everything for that process; several processes get the by-process table.
    const single = summary.processes.length === 1 ? summary.processes[0] : null;

    // ── 1. by process (all machines combined), or the one process's machines ──
    if (single) {
      table(`${single.processName} — machine-wise performance`, "Machine / worker");
      for (const m of single.machines) line(m.ownerName, m);
      line(`${single.processName} — all machines`, single, { total: true });
    } else {
      table("Process-wise performance (all machines combined)", "Process");
      if (!summary.processes.length) line("No entries in this period", { entries: 0, okQty: 0, totalQty: 0, rejectedQty: 0 });
      for (const p of summary.processes) line(p.processName, p);
      line("All processes", summary, { total: true });
    }
    endTable();
    legend();

    // ── 2. OEE considering losses — the dashboard's figure ──
    const drawOee = () => {
      need(80);
      const y = doc.y;
      doc.rect(left, y, width, 20).fillColor(TILE_HEAD).fill();
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff").text(`${single ? `${single.processName} ` : ""}OEE %  (considering losses — the dashboard's figure)`, left, y + 5, { width, align: "center" });
      doc.rect(left, y + 20, width, 34).fillColor(TILE_BODY).fill();
      doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text(fmtPct(summary.oee), left, y + 27, { width, align: "center" });
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(
        `${single ? `${single.processName} · ${single.machines.length} machine${single.machines.length === 1 ? "" : "s"} · ` : ""}${summary.entries} entries · ${summary.machineDays} machine-day${summary.machineDays === 1 ? "" : "s"}`,
        left,
        y + 56,
        { width, align: "center" },
      );
      doc.y = y + 70;
    };
    doc.moveDown(0.8);
    drawOee();

    // ── 3. the figures ──
    const drawTiles = () => {
      const tiles = [
        ["Available Working Time (mins)", fmtMin(summary.availableMin)],
        ["Working / scheduled time (min)", fmtMin(summary.operatingMin)],
        ["Availability Ratio", fmtPct(summary.availability)],
        ["OK Quantity", fmtQty(summary.okQty)],
        ["Process Quantity (Total Qty)", fmtQty(summary.totalQty)],
        ["Quality Ratio", fmtPct(summary.quality)],
        ["Rejected Quantity", fmtQty(summary.rejectedQty)],
        ["Ideal Quantity", fmtQty(summary.idealQty)],
        ["Performance Ratio", fmtPct(summary.performance)],
      ];
      const gap = 8;
      const tw = (width - gap * 2) / 3;
      const th = 48;
      need(3 * (th + gap));
      const y = doc.y;
      tiles.forEach(([label, value], i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = left + col * (tw + gap);
        const ty = y + row * (th + gap);
        doc.roundedRect(x, ty, tw, th, 4).fillColor(TILE_BODY).fill();
        doc.rect(x, ty, tw, 18).fillColor(TILE_HEAD).fill();
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff").text(label, x + 8, ty + 5, { width: tw - 16, lineBreak: false });
        doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(value, x + 8, ty + 24, { width: tw - 16, lineBreak: false });
      });
      doc.y = y + 3 * (th + gap);
    };
    doc.moveDown(0.4);
    drawTiles();

    // ── 4. daily OEE trend ──
    const drawChart = () => {
    // ── daily OEE chart ──
    const series = summary.byDate.filter((d) => Number.isFinite(d.oee));
    if (series.length > 1 && series.length <= 62) {
      doc.moveDown(0.8);
      need(204);
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(single ? `${single.processName} — daily OEE trend` : "Daily OEE trend", left, doc.y);
      // Room above the 100% line for the value printed over a full-height bar.
      doc.y += 14;
      const cx = left + 30;
      const cw = width - 30;
      const ch = 120;
      const cy = doc.y;
      const max = Math.max(1, ...series.map((d) => d.oee));
      doc.font("Helvetica").fontSize(7).fillColor(MUTED);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const gy = cy + ch - (t / max) * ch;
        if (gy < cy) continue;
        doc.moveTo(cx, gy).lineTo(cx + cw, gy).strokeColor("#e5e7eb").lineWidth(0.5).dash(2, { space: 2 }).stroke().undash();
        doc.text(`${Math.round(t * 100)}%`, left, gy - 4, { width: 26, align: "right" });
      }
      const slot = cw / series.length;
      const bw = Math.min(28, slot * 0.6);
      series.forEach((d, i) => {
        const bx = cx + i * slot + (slot - bw) / 2;
        const bh = (d.oee / max) * ch;
        doc.rect(bx, cy + ch - bh, bw, bh).fillColor(ACCENT).fill();
        doc.fillColor(INK).fontSize(6.5).text(`${(d.oee * 100).toFixed(1)}%`, bx - 10, cy + ch - bh - 9, { width: bw + 20, align: "center", lineBreak: false });
        if (series.length <= 31 || i % 2 === 0) {
          doc.fillColor(MUTED).fontSize(6.5).text(dmy(d.date).slice(0, 5), bx - 10, cy + ch + 4, { width: bw + 20, align: "center", lineBreak: false });
        }
      });
      doc.moveTo(cx, cy + ch).lineTo(cx + cw, cy + ch).strokeColor(LINE).lineWidth(1).stroke();
      doc.y = cy + ch + 18;
    }

    };

    drawChart();

    // ── 5. machine-wise: one table, each process a band with its machines and
    //       its total (already at the top for a one-process report) ──
    if (!single && summary.processes.length) {
      table("Machine-wise performance", "Machine / worker");
      summary.processes.forEach((p) => {
        band(p.processName, machineCount(p));
        for (const m of p.machines) line(m.ownerName, m, { indent: 8 });
        line("Total", p, { total: true });
      });
      endTable();
      legend();
    }

    doc.moveDown(1);
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(
      `Availability = Operating Time ÷ Planned Production Time · Performance = Cycle Time × pieces ÷ Operating Time · Quality = OK ÷ Total, each over the period's totals${single ? ` for ${single.processName}` : ""}. OEE is each sheet's own OEE considering losses (Productivity on a worker sheet), averaged over ${single ? `${single.processName}'s ` : ""}machine-days, as on the Production Dashboard.`,
      left,
      doc.y,
      { width },
    );
    doc.end();
  });

module.exports = { buildOeeReportPdf, periodLabel };
