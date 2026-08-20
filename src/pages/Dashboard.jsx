import React, { useState, useEffect, useContext, useMemo } from "react";
import { Factory, TrendingUp, AlertCircle, Clock, Activity, BarChart2, Calendar, Download, X } from "lucide-react";
import { toast as toastify } from "react-toastify";
import { useAlert } from "../context/AlertContext";
import { ThemeContext } from "../context/ThemeContext";
import { listProductionEntries } from "../api/productionEntries.api";
import { downloadOeeReport, downloadDailyOeeTrendReport, downloadDashboardOeeReport } from "../api/reports.api";
import { useMachines } from "../hooks/useMachines";
import { useProcesses } from "../hooks/useProcesses";
import DatePicker from "../Components/Common/DatePicker";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, Cell, LabelList
} from "recharts";

// ── Report column picker options (must match server/services/report.service.js ALL_COLUMNS keys) ──
const REPORT_COLUMNS = [
  { key: "availMin", label: "Available Working (min)" },
  { key: "workMin", label: "Working Schedule (min)" },
  { key: "availRatio", label: "Availability Ratio" },
  { key: "okQty", label: "OK Qty" },
  { key: "processQty", label: "Production Qty" },
  { key: "qualRatio", label: "Quality Ratio" },
  { key: "idealQty", label: "Ideal Qty" },
  { key: "perfRatio", label: "Performance Ratio" },
  { key: "oee", label: "OEE %" },
];

// Triggers a browser download from an axios blob response.
const triggerBlobDownload = (blobData, fallbackFilename) => {
  const blob = new Blob([blobData], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fallbackFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export default function Dashboard() {
  const { isDarkMode } = useContext(ThemeContext);
  const toast = useAlert() || toastify;
  const { data: machines = [] } = useMachines();
  const { data: processes = [] } = useProcesses();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloadingQuick, setDownloadingQuick] = useState(false);
  const [downloadingTrend, setDownloadingTrend] = useState(false);
  const [showCustomReport, setShowCustomReport] = useState(false);

  // Filters
  const [selectedMachine, setSelectedMachine] = useState("all");
  const [selectedProcess, setSelectedProcess] = useState("all");

  // Only show machines that belong to the selected process
  const filteredMachines = useMemo(() => {
    if (selectedProcess === "all") return machines;
    return machines.filter((m) =>
      (m.processes || []).some((p) => (typeof p === "object" ? p._id : p) === selectedProcess)
    );
  }, [machines, selectedProcess]);

  const handleProcessChange = (e) => {
    setSelectedProcess(e.target.value);
    setSelectedMachine("all"); // reset so a stale machine from another process can't stay selected
  };

  // Date filter for chart (Month-Year)
  const currentMonthStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const [chartMonth, setChartMonth] = useState(currentMonthStr);

  // Date range filter for Efficiency Report
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [reportFrom, setReportFrom] = useState(todayStr);
  const [reportTo, setReportTo] = useState(todayStr);

  const isReportRangeDefault = reportFrom === todayStr() && reportTo === todayStr();
  const isChartMonthDefault = chartMonth === currentMonthStr();
  const isAnyFilterActive =
    selectedProcess !== "all" || selectedMachine !== "all" || !isReportRangeDefault || !isChartMonthDefault;

  // Clears every filter on the page — Process/Machine, the Efficiency
  // Report's From/To range, and the chart's month — back to defaults.
  const clearAllFilters = () => {
    setSelectedProcess("all");
    setSelectedMachine("all");
    setReportFrom(todayStr());
    setReportTo(todayStr());
    setChartMonth(currentMonthStr());
  };

  useEffect(() => {
    fetchData();
  }, [selectedMachine, selectedProcess]); // Fetch monthly data

  // Pages through the full result set for the current Process/Machine
  // filter instead of capping at one page — a fixed per_page cap here
  // would silently drop older entries from the on-screen stat cards/chart
  // once a filter's total exceeds it, while the PDF downloads (which query
  // the DB directly with no limit) would still include everything, so the
  // two would quietly disagree.
  const fetchData = async () => {
    setLoading(true);
    try {
      const baseQuery = {};
      if (selectedMachine !== "all") baseQuery.machine = selectedMachine;
      if (selectedProcess !== "all") baseQuery.process = selectedProcess;

      const PAGE_SIZE = 2000;
      let all = [];
      let skip = 0;
      for (;;) {
        const res = await listProductionEntries({ ...baseQuery, skip, per_page: PAGE_SIZE });
        const page = res.data?.data || [];
        all = all.concat(page);
        const total = res.data?.count ?? all.length;
        skip += PAGE_SIZE;
        if (page.length === 0 || all.length >= total) break;
      }
      setEntries(all);
    } catch (err) {
      console.error("Failed to fetch dashboard data", err);
    } finally {
      setLoading(false);
    }
  };

  // Always downloads TODAY's data only — deliberately ignores both the
  // From/To range and the Process/Machine dropdown filters at the top of
  // the page (those only affect what's shown on screen). Every active
  // machine under every active process gets its own card (zero-filled if
  // it has no entries today), plus an overall grand total, so this is
  // meant to be run fresh each day as a daily report, not a range export.
  const runQuickDownload = async () => {
    setDownloadingQuick(true);
    try {
      const res = await downloadDashboardOeeReport({ from: todayStr(), to: todayStr() });
      triggerBlobDownload(res.data, `OEE-Report_${todayStr()}.pdf`);
    } catch (err) {
      console.error("Failed to download report", err);
      toast.error?.("Failed to download report");
    } finally {
      setDownloadingQuick(false);
    }
  };

  // ── OEE Chart Data (Image 2 logic) ──
  const trendData = useMemo(() => {
    const [year, month] = chartMonth.split('-');
    const monthPrefix = `${year}-${month}`;
    const dateStats = {};
    entries.forEach(e => {
      if (typeof e.date !== 'string' || !e.date.startsWith(monthPrefix)) return;
      // Use local date string YYYY-MM-DD
      // Extract just the YYYY-MM-DD part and split it to avoid timezone shifts
      const datePart = e.date.split('T')[0];
      const [y, m, d] = datePart.split('-');
      const dStr = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
      const realDateObj = new Date(Number(y), Number(m)-1, Number(d));
      if (!dateStats[dStr]) dateStats[dStr] = { dateStr: dStr, realDate: realDateObj, sumOee: 0, count: 0 };
      dateStats[dStr].sumOee += (e.calculated?.oeePercent || 0);
      dateStats[dStr].count += 1;
    });

    return Object.values(dateStats)
      .sort((a,b) => a.realDate - b.realDate)
      .map(d => ({
        date: d.dateStr,
        OEE: Number((d.sumOee / d.count).toFixed(2))
      }));
  }, [entries, chartMonth]);

  // ── Efficiency Report Data (Image 3 logic) ──
  const reportData = useMemo(() => {
    // Filter by selected date range (inclusive)
    const dayEntries = entries.filter(e => {
      if (typeof e.date !== 'string') return false;
      const datePart = e.date.split('T')[0];
      return datePart >= reportFrom && datePart <= reportTo;
    });

    let sumWork = 0;
    let sumAvail = 0;
    let sumProcess = 0;
    let sumOk = 0;
    let sumIdeal = 0;

    dayEntries.forEach(e => {
      sumWork += (e.calculated?.workingScheduleMin || 0);
      sumAvail += (e.calculated?.availableWorkingMin || 0);
      sumProcess += (Number(e.processQty) || 0);
      sumOk += (Number(e.okQty) || 0);
      sumIdeal += (e.calculated?.idealProductionQty || 0);
    });

    const availRatio = sumWork > 0 ? (sumAvail / sumWork) * 100 : 0;
    const qualRatio = sumProcess > 0 ? (sumOk / sumProcess) * 100 : 0;
    const perfRatio = sumIdeal > 0 ? (sumProcess / sumIdeal) * 100 : 0;
    const oee = (availRatio / 100) * (perfRatio / 100) * (qualRatio / 100) * 100;

    return {
      workMin: sumWork.toFixed(2),
      availMin: sumAvail.toFixed(2),
      availRatio: availRatio.toFixed(2) + "%",
      processQty: sumProcess,
      okQty: sumOk,
      qualRatio: qualRatio.toFixed(2) + "%",
      idealQty: sumIdeal.toFixed(2),
      perfRatio: perfRatio.toFixed(2) + "%",
      oee: oee.toFixed(2) + "%"
    };
  }, [entries, reportFrom, reportTo]);

  // Downloads the currently-displayed Daily OEE Trend chart (the month
  // picked above it) as a PDF that looks like the on-screen chart — sends
  // the already-computed { date, OEE } series so the PDF always matches
  // whatever process/machine filter is active on screen.
  const downloadTrendPdf = async () => {
    setDownloadingTrend(true);
    try {
      const processName = selectedProcess === "all" ? "All Processes" : (processes.find((p) => p._id === selectedProcess)?.processName || "Unknown Process");
      const machineName = selectedMachine === "all" ? "All Machines" : (machines.find((m) => m._id === selectedMachine)?.machineName || "Unknown Machine");
      const res = await downloadDailyOeeTrendReport({
        month: chartMonth,
        target: 75,
        filterDescription: `Process: ${processName}   ·   Machine: ${machineName}`,
        data: trendData,
      });
      triggerBlobDownload(res.data, `Daily-OEE-Trend_${chartMonth}.pdf`);
    } catch (err) {
      console.error("Failed to download Daily OEE Trend PDF", err);
      toast.error?.("Failed to download report");
    } finally {
      setDownloadingTrend(false);
    }
  };

  const cardStyle = "bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5";
  const titleStyle = "text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4";
  const inputStyle = "bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-500 dark:text-slate-200";

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      {/* Header & Global Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-brand-600 dark:text-brand-400" />
            Dashboard
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">OEE Analytics & Efficiency Reports</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedProcess}
            onChange={handleProcessChange}
            className={`w-full sm:w-auto ${inputStyle}`}
          >
            <option value="all">All Processes</option>
            {processes.map(p => <option key={p._id} value={p._id}>{p.processName}</option>)}
          </select>
          <select
            value={selectedMachine}
            onChange={e => setSelectedMachine(e.target.value)}
            className={`w-full sm:w-auto ${inputStyle}`}
          >
            <option value="all">All Machines</option>
            {filteredMachines.map(m => <option key={m._id} value={m._id}>{m.machineName}</option>)}
          </select>
          <button
            onClick={clearAllFilters}
            disabled={!isAnyFilterActive}
            title="Clear every filter on this page — Process, Machine, date range, and chart month"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-medium px-3 py-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent w-full sm:w-auto"
          >
            <X className="w-4 h-4" />
            Clear Filter
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center text-slate-400">Loading metrics...</div>
      ) : (
        <div className="space-y-6">

          {/* Efficiency Report Section */}
          <div className={cardStyle}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 pb-4 border-b border-slate-200 dark:border-slate-800 gap-4">
              <h2 className={titleStyle} style={{marginBottom: 0}}>Efficiency Report (OEE)</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-500" />
                <span className="text-sm text-slate-600 dark:text-slate-300 font-medium mr-1">From:</span>
                <div className="w-40">
                  <DatePicker
                    name="reportFrom"
                    value={reportFrom}
                    onChange={e => setReportFrom(e.target.value)}
                  />
                </div>
                <span className="text-sm text-slate-600 dark:text-slate-300 font-medium">To:</span>
                <div className="w-40">
                  <DatePicker
                    name="reportTo"
                    value={reportTo}
                    onChange={e => setReportTo(e.target.value)}
                  />
                </div>
                <button
                  onClick={runQuickDownload}
                  disabled={downloadingQuick}
                  title="Download today's Efficiency Report PDF — every machine, zero-filled if no entries today (always today's date; ignores the From/To range and the Process/Machine filters above)"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-3.5 py-2 shadow-sm transition-colors disabled:opacity-60"
                >
                  <Download className="w-4 h-4" />
                  {downloadingQuick ? "Downloading…" : "Download Today's PDF"}
                </button>
                <button
                  onClick={() => setShowCustomReport(true)}
                  title="Build a custom report (date range, machine/process, columns)"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-semibold px-3.5 py-2 transition-colors"
                >
                  Custom Report…
                </button>
              </div>
            </div>

            {/* Stat cards — grid instead of a fixed-width table, so it stacks
                to 1/2/3 columns instead of forcing horizontal scroll on
                tablet/phone. Every 3rd item (the ratio) keeps its distinct
                shaded background from the original table layout. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { label: "Available Working Time (mins)", value: reportData.availMin },
                { label: "Working/ scheduled time (min)", value: reportData.workMin },
                { label: "Availability Ratio", value: reportData.availRatio, highlight: true },
                { label: "OK Quantity", value: reportData.okQty },
                { label: "Process Quantity (Total Qty)", value: reportData.processQty },
                { label: "Quality Ratio", value: reportData.qualRatio, highlight: true },
                { label: "Process Quantity (Total Qty)", value: reportData.processQty },
                { label: "Ideal Quantity", value: reportData.idealQty },
                { label: "Performance Ratio", value: reportData.perfRatio, highlight: true },
              ].map((item, i) => (
                <div key={i} className="rounded-xl border border-slate-300 dark:border-slate-700 overflow-hidden">
                  <div className="bg-[#0a1930] text-white font-semibold py-2 px-4 text-sm">{item.label}</div>
                  <div className={`py-3 px-4 text-sm font-medium ${
                    item.highlight
                      ? "bg-[#f8f9fa] dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                      : "bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  }`}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 rounded-xl border border-slate-300 dark:border-slate-700 overflow-hidden">
              <div className="bg-[#0a1930] text-white font-bold text-lg py-3 px-4 tracking-wide uppercase text-center">OEE %</div>
              <div className="py-4 px-4 bg-[#f0f4f8] dark:bg-slate-800 text-[#0f172a] dark:text-white font-extrabold text-2xl text-center">
                {reportData.oee}
              </div>
            </div>

          </div>

          {/* Chart Section */}
          <div className={cardStyle}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={titleStyle} style={{marginBottom: 0}}>Daily OEE Trend</h2>
              <div className="flex items-center gap-3">

                <input
                  type="month"
                  value={chartMonth}
                  onChange={e => setChartMonth(e.target.value)}
                  className={inputStyle}
                />
                <button
                  onClick={downloadTrendPdf}
                  disabled={trendData.length === 0 || downloadingTrend}
                  title="Download this month's Daily OEE Trend as a PDF"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-3.5 py-2 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  {downloadingTrend ? "Downloading…" : "Download"}
                </button>
              </div>
            </div>

            {trendData.length === 0 ? (
              <div className="h-72 flex flex-col items-center justify-center text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                <BarChart2 className="w-8 h-8 mb-2 opacity-50" />
                <p>No production entries for {chartMonth}</p>
              </div>
            ) : (
              <div className="h-80 w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData} margin={{ top: 20, right: 30, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#334155' : '#e2e8f0'} />
                    <XAxis
                      dataKey="date"
                      axisLine={{ stroke: isDarkMode ? '#475569' : '#94a3b8' }}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: isDarkMode ? '#94a3b8' : '#64748b' }}
                      dy={10}
                      angle={-45}
                      textAnchor="end"
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: isDarkMode ? '#94a3b8' : '#64748b' }}
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: isDarkMode ? '#1e293b' : '#fff', borderRadius: '8px', border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', color: isDarkMode ? '#f8fafc' : '#0f172a' }}
                      cursor={{ fill: isDarkMode ? '#334155' : '#f1f5f9' }}
                    />

                    <ReferenceLine y={75} stroke="#dc2626" strokeWidth={2} label={{ position: 'insideTopRight', value: 'Target 75)', fill: '#dc2626', fontSize: 12 }} />

                    <Bar dataKey="OEE" fill="#1f77b4" maxBarSize={50}>
                       <LabelList dataKey="OEE" position="top" formatter={(val) => `${val}%`} style={{ fill: isDarkMode ? '#cbd5e1' : '#334155', fontSize: 11, fontWeight: 600 }} />
                       {trendData.map((entry, index) => (
                         <Cell key={`cell-${index}`} fill="#1f77b4" />
                       ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}

      {showCustomReport && (
        <CustomReportModal
          machines={machines}
          processes={processes}
          defaultFrom={reportFrom}
          defaultTo={reportTo}
          onClose={() => setShowCustomReport(false)}
        />
      )}
    </div>
  );
}

// ── Custom Report modal: date range + machine/process + column picker ──────
const CustomReportModal = ({ machines, processes, defaultFrom, defaultTo, onClose }) => {
  const toast = useAlert() || toastify;
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [machine, setMachine] = useState("all");
  const [process, setProcess] = useState("all");

  // Only show machines that belong to the selected process
  const filteredMachines = useMemo(() => {
    if (process === "all") return machines;
    return machines.filter((m) =>
      (m.processes || []).some((p) => (typeof p === "object" ? p._id : p) === process)
    );
  }, [machines, process]);

  const handleProcessChange = (e) => {
    setProcess(e.target.value);
    setMachine("all");
  };
  const [selectedColumns, setSelectedColumns] = useState(REPORT_COLUMNS.map((c) => c.key));
  const [downloading, setDownloading] = useState(false);

  const toggleColumn = (key) => {
    setSelectedColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleDownload = async () => {
    if (selectedColumns.length === 0) {
      toast.error?.("Select at least one column");
      return;
    }
    setDownloading(true);
    try {
      const params = { from, to, columns: selectedColumns.join(",") };
      if (machine !== "all") params.machine = machine;
      if (process !== "all") params.process = process;
      const res = await downloadOeeReport(params);
      const filename = `OEE-Report_${from}${to !== from ? `_to_${to}` : ""}.pdf`;
      triggerBlobDownload(res.data, filename);
      onClose();
    } catch (err) {
      console.error("Failed to download custom report", err);
      toast.error?.("Failed to download report");
    } finally {
      setDownloading(false);
    }
  };

  const inputStyle = "w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-500 dark:text-slate-200";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Custom Report</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">From</label>
              <DatePicker name="from" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">To</label>
              <DatePicker name="to" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Process</label>
              <select value={process} onChange={handleProcessChange} className={inputStyle}>
                <option value="all">All Processes</option>
                {processes.map((p) => <option key={p._id} value={p._id}>{p.processName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Machine</label>
              <select value={machine} onChange={(e) => setMachine(e.target.value)} className={inputStyle}>
                <option value="all">All Machines</option>
                {filteredMachines.map((m) => <option key={m._id} value={m._id}>{m.machineName}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">Columns</label>
            <div className="grid grid-cols-2 gap-y-1.5 gap-x-2 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
              {REPORT_COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedColumns.includes(c.key)}
                    onChange={() => toggleColumn(c.key)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            disabled={downloading}
            className="rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-sm font-medium px-4 py-2.5 transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors disabled:opacity-70"
          >
            <Download className="w-4 h-4" />
            {downloading ? "Downloading…" : "Download PDF"}
          </button>
        </div>
      </div>
    </div>
  );
};
