import React, { useState, useEffect, useMemo } from "react";
import ReactDOM from "react-dom";
import Select, { components as selectComponents } from "react-select";
import { Plus, X, Factory, Eye, Pencil, Trash2, Gauge, AlertTriangle, Search, Download, Clock } from "lucide-react";
import { toast as toastify } from "react-toastify";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useMachines } from "../hooks/useMachines";
import { useProcesses } from "../hooks/useProcesses";
import { useOperators } from "../hooks/useOperators";
import { useDebounce } from "../hooks/useDebounce";
import { listStandardTimes } from "../api/standardTime.api";
import {
  createProductionEntry, listProductionEntries, updateProductionEntry, deleteProductionEntry,
  getProductionEfficiency, downloadGrindingEfficiencyPdf, getShiftTimeReport,
} from "../api/productionEntries.api";
import DatePicker from "../Components/Common/DatePicker";
import TimePicker from "../Components/Common/TimePicker";
import DeleteModal from "../Components/Common/DeleteModal";
import { isEntryEditable, parseLocalDate } from "../utils/workingDays";

// ── Stoppage fields ───────────────────────────────────────────────────────
const PAGE_SIZE = 20;

const STOPPAGE_FIELDS = [
  { key: "plannedDowntimeMin",         label: "Planned Downtime (Minutes)" },
  { key: "noManpowerMin",              label: "No Manpower (Minutes)" },
  { key: "mechanicalBreakdownMin",     label: "Mechanical Breakdown (Minutes)" },
  { key: "electricalBreakdownMin",     label: "Electrical Breakdown (Minutes)" },
  { key: "rawMaterialNotAvailableMin", label: "Raw Material Not Available (Minutes)" },
  { key: "humanErrorStoppageMin",      label: "Stoppage (Human Error) (Minutes)" },
  { key: "changeoverMin",              label: "Changeover (Minutes)" },
  { key: "rawMaterialProblemMin",      label: "Raw Material Problem (Minutes)" },
  { key: "noPowerMin",                 label: "No Power (Minutes)" },
  { key: "othersMin",                  label: "Others (Minutes)" },
];

// Fields that feed the Total Stoppage sum — Planned Downtime is still an
// entered/stored field (STOPPAGE_FIELDS above), it just doesn't count
// toward Total Stoppage. Mirrors server/services/productionCalculation
// .service.js's STOPPAGE_KEYS exactly.
const TOTAL_STOPPAGE_FIELDS = STOPPAGE_FIELDS.filter((f) => f.key !== "plannedDowntimeMin");

// ── Calculated (derived) columns shown in the sheet, in order ────────────
// Each entry: key inside e.calculated, label, and the exact formula text
// shown when the "eye" icon on that column header is clicked.
const CALC_COLUMNS = [
  {
    key: "workingScheduleMin",
    label: "Working Schedule Time",
    unit: "min",
    formula: "Working Schedule Time = span from the earlier of Shift On Time/M/C Start Time to the later of Shift Off Time/M/C Off Time",
  },
  {
    key: "totalStoppageMin",
    label: "Total Stoppage",
    unit: "min",
    formula:
      "Total Stoppage = No Manpower + Mechanical Breakdown + Electrical Breakdown + Raw Material Not Available + Stoppage (Human Error) + Changeover + Raw Material Problem + No Power + Others (Planned Downtime is entered separately and not included here)",
  },
  {
    key: "availableWorkingMin",
    label: "Available Working Time",
    unit: "min",
    formula: "Available Working Time = Working Schedule Time − Total Stoppage (NA if Total Stoppage ≥ Working Schedule Time)",
  },
  {
    key: "idealProductionQty",
    label: "Ideal Production",
    unit: "qty",
    formula: "Ideal Production = Available Working Time ÷ Standard Time per Glass (NA if Available Working Time is NA)",
  },
  {
    key: "effectiveMcRunTimeMin",
    label: "Effective M/C Run Time",
    unit: "min",
    formula: "Effective M/C Run Time = Production Qty (Total Qty) × Standard Time per Glass",
  },
  {
    key: "unreportedTimeMin",
    label: "Unreported Time",
    unit: "min",
    formula: "Unreported Time = Available Working Time − Effective M/C Run Time (NA if Available Working Time is NA)",
  },
  {
    key: "availabilityRatio",
    label: "Availability Ratio",
    unit: "",
    formula: "Availability Ratio = Available Working Time ÷ Working Schedule Time (NA if Available Working Time is NA)",
  },
  {
    key: "performanceRatio",
    label: "Performance Ratio",
    unit: "",
    formula: "Performance Ratio = Production Qty (Total Qty) ÷ Ideal Production (NA if Ideal Production is NA)",
  },
  {
    key: "qualityRatio",
    label: "Quality Ratio",
    unit: "",
    formula: "Quality Ratio = OK Qty ÷ Production Qty",
  },
];

const OEE_FORMULA = "OEE % = Availability Ratio × Performance Ratio × Quality Ratio × 100 (NA if Available Working Time is NA)";
const OVERTIME_FORMULA = "Overtime = max(0, Shift On − M/C Start) + max(0, M/C Off − Shift Off) — minutes the machine ran outside its scheduled Shift window";
const DELAY_EARLY_FORMULA = "Start Delay = max(0, M/C Start − Shift On)  ·  Early Closed = max(0, Shift Off − M/C Off) — computed independently, so both can be non-zero on the same entry (e.g. machine starts late AND finishes early)";

const buildInit = (machineId = "") => ({
  date: new Date().toISOString().split("T")[0],
  mcStartTime: "",
  mcOffTime: "",
  machine: machineId,
  operator: "",
  shiftOnTime: "",
  shiftOffTime: "",
  sizeWidthMm: "",
  sizeHeightMm: "",
  thicknessMm: "",
  standardTimePerPieceMin: "",
  processQty: "",
  okQty: "",
  othersRemark: "",
  ...Object.fromEntries(STOPPAGE_FIELDS.map((f) => [f.key, "0"])),
});

// ── Capacity check helper — mirrors server/services/productionCalculation
// .service.js exactly (Available Working Time ÷ Standard Time = Ideal
// Production), so the pre-save warning here never disagrees with what the
// server would have stored. ───────────────────────────────────────────────
// React attaches wheel listeners as passive by default, so calling
// preventDefault() from a plain onWheel prop silently does nothing — the
// browser still lets mouse-wheel/trackpad scroll bump a focused number
// input's value. Attaching a real (non-passive) DOM listener via ref is the
// only way to actually block it, on every browser.
const noWheelChange = (el) => {
  if (el) el.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
};

const timeToMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};

// Shortest signed distance (minutes) from `from` (HH:mm) to `to` (HH:mm) —
// mirrors server/services/productionCalculation.service.js's signedDiffMin.
const signedDiffMin = (from, to) => {
  let diff = (timeToMinutes(to) - timeToMinutes(from) + 1440) % 1440;
  if (diff > 720) diff -= 1440;
  return diff;
};

// Overtime / Start Delay / Early Closed, derived from the selected Shift's
// On/Off Time vs. the entered M/C Start/Off Time — mirrors
// server/services/productionCalculation.service.js's deriveShiftDelta
// exactly, so the client-side preview never disagrees with what gets saved.
// Informational only — does NOT feed into Working Schedule Time below.
const deriveShiftDelta = (shiftOnTime, shiftOffTime, mcStartTime, mcOffTime) => {
  if (!shiftOnTime || !shiftOffTime) return { overtimeMin: 0, startDelayMin: 0, earlyClosedMin: 0 };
  const startDeltaMin = signedDiffMin(shiftOnTime, mcStartTime);
  const offDeltaMin = signedDiffMin(shiftOffTime, mcOffTime);
  const startDelayMin = Math.max(0, startDeltaMin);
  const earlyStartMin = Math.max(0, -startDeltaMin);
  const lateFinishMin = Math.max(0, offDeltaMin);
  const earlyClosedMin = Math.max(0, -offDeltaMin);
  return { overtimeMin: earlyStartMin + lateFinishMin, startDelayMin, earlyClosedMin };
};

// Working Schedule Time = span from the earlier of Shift On/M-C Start Time
// to the later of Shift Off/M-C Off Time — a direct min/max condition,
// mirrors server/services/productionCalculation.service.js's
// workingScheduleEnvelopeMin exactly (computed independently of Overtime).
const computeWorkingScheduleMin = (shiftOnTime, shiftOffTime, mcStartTime, mcOffTime) => {
  if (!shiftOnTime || !shiftOffTime) {
    let d = timeToMinutes(mcOffTime) - timeToMinutes(mcStartTime);
    if (d <= 0) d += 24 * 60;
    return d;
  }
  let shiftOwnDurationMin = timeToMinutes(shiftOffTime) - timeToMinutes(shiftOnTime);
  if (shiftOwnDurationMin <= 0) shiftOwnDurationMin += 24 * 60;
  const startDeltaMin = signedDiffMin(shiftOnTime, mcStartTime);
  const offDeltaMin = signedDiffMin(shiftOffTime, mcOffTime);
  const effectiveStartOffsetMin = Math.min(0, startDeltaMin);
  const effectiveEndOffsetMin = Math.max(0, offDeltaMin);
  return Math.max(shiftOwnDurationMin - effectiveStartOffsetMin + effectiveEndOffsetMin, 0);
};

// Returns null (NA) when total stoppage consumes the whole working schedule
// — mirrors server/services/productionCalculation.service.js exactly,
// including excluding Planned Downtime from the Total Stoppage sum (see
// TOTAL_STOPPAGE_FIELDS above).
const computeIdealProductionQty = (v) => {
  const num = (x) => Number(x) || 0;
  const totalStoppageMin = TOTAL_STOPPAGE_FIELDS.reduce((s, f) => s + num(v[f.key]), 0);
  const workingScheduleMin = computeWorkingScheduleMin(v.shiftOnTime, v.shiftOffTime, v.mcStartTime, v.mcOffTime);
  if (totalStoppageMin >= workingScheduleMin) return null;
  const availableWorkingMin = workingScheduleMin - totalStoppageMin;
  const std = num(v.standardTimePerPieceMin);
  return std > 0 ? availableWorkingMin / std : 0;
};

// ── Client-side validation ────────────────────────────────────────────────
const validate = (v) => {
  const e = {};
  if (!v.date) e.date = "Date is required";

  const timeRx = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!v.mcStartTime) e.mcStartTime = "M/C Start Time is required";
  else if (!timeRx.test(v.mcStartTime)) e.mcStartTime = "Use HH:mm format";
  if (!v.mcOffTime) e.mcOffTime = "M/C Off Time is required";
  else if (!timeRx.test(v.mcOffTime)) e.mcOffTime = "Use HH:mm format";
  else if (!e.mcStartTime && v.mcStartTime === v.mcOffTime) e.mcOffTime = "Off Time cannot equal Start Time";

  if (!v.process) e.process = "Please select a process";
  if (!v.machine) e.machine = "Please select a machine";
  if (!v.operator) e.operator = "Please select an operator";
  if (!v.sizeWidthMm) e.sizeWidthMm = "Width is required";
  if (!v.sizeHeightMm) e.sizeHeightMm = "Height is required";
  if (!v.thicknessMm) e.thicknessMm = "Thickness is required";
  if (!v.standardTimePerPieceMin) e.standardTimePerPieceMin = "Standard Time is required";
  else if (isNaN(Number(v.standardTimePerPieceMin)) || Number(v.standardTimePerPieceMin) <= 0) e.standardTimePerPieceMin = "Must be a number > 0";

  const pq = Number(v.processQty);
  if (v.processQty === "") e.processQty = "Production Qty is required";
  else if (!Number.isInteger(pq) || pq < 1) e.processQty = "Must be a whole number ≥ 1";
  else if (String(v.processQty).length > 30) e.processQty = "Cannot exceed 30 digits";

  const oq = Number(v.okQty);
  if (v.okQty === "") e.okQty = "OK Qty is required";
  else if (!Number.isInteger(oq) || oq < 0) e.okQty = "Must be a whole number ≥ 0";
  else if (String(v.okQty).length > 30) e.okQty = "Cannot exceed 30 digits";

  if (!e.processQty && !e.okQty && oq > pq)
    e.okQty = "OK Qty cannot exceed Production Qty";

  for (const f of STOPPAGE_FIELDS) {
    const val = v[f.key];
    if (val === "" || val === null || val === undefined) continue;
    const n = Number(val);
    if (isNaN(n) || n < 0 || n > 1440) e[f.key] = "0–1440 min";
  }

  const othersRemark = (v.othersRemark || "").trim();
  if (Number(v.othersMin) > 0 && !othersRemark) e.othersRemark = "Remark is required when Others is greater than 0";
  else if (othersRemark.length > 300) e.othersRemark = "Cannot exceed 300 characters";

  // Capacity check: can't process more pieces than the Available Working
  // Time actually allows at this Standard Time. Only run once every input
  // that feeds it is itself already valid, so this doesn't pile on top of
  // more basic errors above.
  const stoppageFieldsClean = STOPPAGE_FIELDS.every((f) => !e[f.key]);
  if (!e.mcStartTime && !e.mcOffTime && !e.standardTimePerPieceMin && !e.processQty && stoppageFieldsClean) {
    const idealProductionQty = computeIdealProductionQty(v);
    if (idealProductionQty === null) {
      e.processQty =
        `Not achievable: Available Working Time is NA — Planned Downtime + total Stoppage consumes the entire ` +
        `Working Schedule Time, so there is no time left to grind any glass. Reduce downtime/stoppage minutes.`;
    } else if (idealProductionQty < pq) {
      e.processQty =
        `Not achievable: Available Working Time ÷ Standard Time = ${idealProductionQty.toFixed(2)} pcs, ` +
        `which is less than Production Qty (${pq}). Reduce Production Qty or free up more Available Working Time.`;
    }
  }

  return e;
};

// ── Shared input class helper ─────────────────────────────────────────────
const cls = (hasErr) =>
  `w-full bg-white dark:bg-[#1a1a1a] border rounded-xl px-3.5 py-2.5 text-sm outline-none transition-shadow ${
    hasErr
      ? "border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-500/15"
      : "border-slate-300 dark:border-slate-700 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
  }`;

// ── Header cell for a calculated column: label + "eye" button that reveals
// the exact formula used (rendered in a portal so it's never clipped by the
// table's scroll container), so calculated values are never a black box ──
const CalcHeader = ({ label, formula, colKey, openKey, onToggle, sticky = "", z = "z-20", bg = "bg-violet-100 dark:bg-violet-900\/50 text-violet-900", extraClass = "" }) => {
  const btnRef = React.useRef(null);
  const isOpen = openKey === colKey;
  return (
    <th
      className={`px-3 py-2 font-semibold whitespace-nowrap border-r border-slate-300 dark:border-slate-700 ${bg} ${z} ${sticky} ${extraClass}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const rect = btnRef.current.getBoundingClientRect();
            onToggle(colKey, label, formula, rect);
          }}
          title="Show formula"
          className={`p-0.5 rounded hover:bg-violet-200/80 transition-colors ${isOpen ? "bg-violet-300 text-violet-900" : "text-violet-500 hover:text-violet-700"}`}
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
      </span>
    </th>
  );
};

// ── Portal-rendered formula popover, positioned via a fixed anchor rect so
// it always floats above the table (never clipped by overflow-auto) ──────
const FormulaPopover = ({ info, onClose }) => {
  if (!info) return null;
  const { rect, label, formula } = info;
  const width = 260;
  const left = Math.min(Math.max(rect.left - 80, 8), window.innerWidth - width - 8);
  const top = rect.bottom + 6;
  return ReactDOM.createPortal(
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ position: "fixed", top, left, width }}
      className="z-[200] rounded-lg border border-violet-200 bg-white dark:bg-[#1a1a1a] shadow-xl p-3 text-xs font-normal normal-case text-slate-700 dark:text-slate-200"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="font-semibold text-violet-700">{label}</p>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-slate-300 shrink-0"><X className="w-3.5 h-3.5" /></button>
      </div>
      <p className="leading-snug">{formula}</p>
    </div>,
    document.body
  );
};

// ── Efficiency popup: Operator Efficiency + Machine Efficiency tables,
// date-range filtered. Ratios come back NA (null) from the server whenever
// their denominator is zero (no entries in range, or every entry in the
// group had an NA Available Working Time) — rendered as "NA", matching the
// spreadsheet report this mirrors instead of a misleading 0.00%. ─────────
const fmtPct = (n) => (n == null || isNaN(n) ? "NA" : `${Number(n).toFixed(2)}%`);
const fmtQty = (n) => (n == null || isNaN(n) ? "NA" : Number(n).toLocaleString());

// Machine tab gets 4 extra ratio columns (Availability, Performance, Quality, OEE%);
// Operator tab only has Performance + Quality — efficiencyAggregate.js always returns
// all fields, so this list just controls what each tab renders.
const OPERATOR_COLUMNS = [
  { key: "processQty", label: "Actual Total Qty Produced", fmt: fmtQty, align: "" },
  { key: "okQty", label: "Total OK Qty", fmt: fmtQty, align: "" },
  { key: "performanceRatio", label: "Performance Ratio", fmt: fmtPct, align: "font-medium text-brand-700 dark:text-brand-300" },
  { key: "qualityRatio", label: "Quality Ratio", fmt: fmtPct, align: "font-medium text-brand-700 dark:text-brand-300" },
];
const MACHINE_COLUMNS = [
  { key: "processQty", label: "Production Qty", fmt: fmtQty, align: "" },
  { key: "okQty", label: "OK Qty", fmt: fmtQty, align: "" },
  { key: "oeePercent", label: "OEE %", fmt: fmtPct, align: "font-bold text-brand-800 dark:text-brand-200" },
  { key: "availabilityRatio", label: "Availability", fmt: fmtPct, align: "font-medium text-brand-700 dark:text-brand-300" },
  { key: "performanceRatio", label: "Performance", fmt: fmtPct, align: "font-medium text-brand-700 dark:text-brand-300" },
  { key: "qualityRatio", label: "Quality", fmt: fmtPct, align: "font-medium text-brand-700 dark:text-brand-300" },
];

const EfficiencyTable = ({ nameLabel, columns, rows, loading }) => (
  <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-300 dark:border-slate-700 shadow-sm overflow-hidden flex-1 flex flex-col min-h-0">
    <div className="overflow-auto flex-1 min-h-0">
      <table className="w-full text-xs sm:text-sm border-separate border-spacing-0">
        <thead>
          <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-left">
            <th className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">{nameLabel}</th>
            {columns.map((c, ci) => (
              <th key={c.key} className={`sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-b border-slate-300 dark:border-slate-700 ${ci < columns.length - 1 ? "border-r" : ""}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={columns.length + 1} className="px-4 py-8 text-center text-slate-500 font-medium">Loading…</td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={columns.length + 1} className="px-4 py-8 text-center text-slate-500 font-medium">No entries match this filter.</td></tr>
          )}
          {!loading && rows.map((r, i) => (
            <tr key={r.name} className={`border-b border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors ${i % 2 === 1 ? "bg-slate-50/70 dark:bg-slate-800/20" : "bg-white dark:bg-transparent"}`}>
              <td className="px-3 py-2 whitespace-nowrap border-r border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-medium">{r.name}</td>
              {columns.map((c, ci) => (
                <td key={c.key} className={`px-3 py-2 whitespace-nowrap text-slate-700 dark:text-slate-200 ${ci < columns.length - 1 ? "border-r border-slate-300 dark:border-slate-700" : ""} ${c.align}`}>{c.fmt(r[c.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
};
const today = () => new Date().toISOString().split("T")[0];

// Triggers a browser download from an already-fetched blob response
// (server-generated PDFs, e.g. downloadGrindingEfficiencyPdf).
const triggerBlobDownload = (blobData, filename, mime = "application/pdf") => {
  const blob = new Blob([blobData], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// Checkbox-style option row for the Operator multi-select below.
const CheckboxOption = (props) => (
  <selectComponents.Option {...props}>
    <div className="d-flex align-items-center" style={{ gap: 8 }}>
      <input type="checkbox" checked={props.isSelected} onChange={() => null} />
      <label className="m-0">{props.label}</label>
    </div>
  </selectComponents.Option>
);

const EfficiencyModal = ({ onClose }) => {
  const toast = useAlert() || toastify;
  const { data: operators = [] } = useOperators();
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [data, setData] = useState({ operators: [], machines: [] });
  const [tab, setTab] = useState("machines"); // "machines" | "operators"
  const [search, setSearch] = useState("");
  const [selectedOperators, setSelectedOperators] = useState([]); // array of operator names
  const debouncedSearch = useDebounce(search, 300);

  const load = () => {
    setLoading(true);
    getProductionEfficiency({ from, to })
      .then((res) => setData(res.data?.data || { operators: [], machines: [] }))
      .catch(() => toast.error?.("Failed to load efficiency report"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const activeRows = tab === "machines" ? data.machines : data.operators;
  const activeColumns = tab === "machines" ? MACHINE_COLUMNS : OPERATOR_COLUMNS;
  const nameLabel = tab === "machines" ? "Machine" : "Operator";

  const switchTab = (t) => {
    setTab(t);
    setSearch("");
    setSelectedOperators([]);
  };

  const filteredRows = useMemo(() => {
    if (tab === "operators") {
      if (selectedOperators.length === 0) return activeRows;
      const wanted = new Set(selectedOperators);
      return activeRows.filter((r) => wanted.has(r.name));
    }
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return activeRows;
    return activeRows.filter((r) => r.name.toLowerCase().includes(q));
  }, [activeRows, debouncedSearch, tab, selectedOperators]);

  const handleDownload = () => {
    const params = { from, to, tab };
    if (tab === "operators" && selectedOperators.length > 0) params.operator = selectedOperators.join(",");
    else if (tab !== "operators" && search.trim()) params.match = search.trim();

    setDownloading(true);
    downloadGrindingEfficiencyPdf(params)
      .then((res) => {
        triggerBlobDownload(res.data, `${tab === "machines" ? "machine" : "operator"}-efficiency_${from}_to_${to}.pdf`);
      })
      .catch(() => toast.error?.("Failed to download PDF"))
      .finally(() => setDownloading(false));
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex flex-col w-full max-w-5xl h-[88vh] max-h-[88vh] bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-xl border border-slate-300 dark:border-slate-700">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-brand-600" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Grinding Efficiency Report</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
          {[
            { key: "machines", label: "Machine Efficiency" },
            { key: "operators", label: "Operator Efficiency" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
                tab === t.key
                  ? "border-brand-600 text-brand-700 dark:text-brand-300"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1 flex flex-col min-h-0">
          <div className="flex flex-wrap items-end gap-3 shrink-0">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Start Date</label>
              <DatePicker name="from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Start date" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">End Date</label>
              <DatePicker name="to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="End date" />
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 shadow-sm transition-colors disabled:opacity-60"
            >
              {loading ? "Loading…" : "Apply Filter"}
            </button>
            {tab === "operators" ? (
              <div className="flex-1 min-w-[220px]">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Operator</label>
                <Select
                  isMulti
                  closeMenuOnSelect={false}
                  hideSelectedOptions={false}
                  components={{ Option: CheckboxOption }}
                  options={operators.map((op) => ({ value: op.name, label: op.name }))}
                  value={selectedOperators.map((name) => ({ value: name, label: name }))}
                  onChange={(selected) => setSelectedOperators((selected || []).map((o) => o.value))}
                  placeholder="All Operators"
                  classNamePrefix="rs"
                  styles={{
                    control: (base) => ({ ...base, minHeight: 38, borderRadius: 12, fontSize: 14 }),
                    menu: (base) => ({ ...base, zIndex: 50 }),
                  }}
                />
              </div>
            ) : (
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Search {nameLabel}</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search by ${nameLabel.toLowerCase()} name…`}
                  className="w-full border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 bg-white dark:bg-[#1a1a1a]"
                />
              </div>
            )}
            <button
              onClick={handleDownload}
              disabled={loading || downloading || filteredRows.length === 0}
              title="Download this table as a PDF file"
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 shadow-sm transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> {downloading ? "Downloading…" : "Download PDF"}
            </button>
          </div>

          <EfficiencyTable nameLabel={nameLabel} columns={activeColumns} rows={filteredRows} loading={loading} />
        </div>
      </div>
    </div>,
    document.body
  );
};

// ── Shift Time Report — Machine, Shift Start/End, M/C On/Off, Overtime,
// Start Delay / Early Closed for every entry in a date range. ─────────────
const fmtMin = (n) => (n == null || Number(n) === 0 ? "—" : `${Number(n).toFixed(0)} min`);
// Start Delay and Early Closed are computed independently (late start vs.
// early finish) and CAN both be non-zero on the same entry (e.g. machine
// starts late AND finishes early) — show every non-zero part, don't drop one.
const fmtDelayOrEarly = (startDelayMin, earlyClosedMin) => {
  const parts = [];
  if (Number(startDelayMin) > 0) parts.push(`Delay ${Number(startDelayMin).toFixed(0)} min`);
  if (Number(earlyClosedMin) > 0) parts.push(`Early ${Number(earlyClosedMin).toFixed(0)} min`);
  return parts.length > 0 ? parts.join(" / ") : "—";
};

const ShiftTimeReportModal = ({ onClose }) => {
  const toast = useAlert() || toastify;
  const { data: machines = [] } = useMachines();
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(today());
  const [machine, setMachine] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);

  const load = () => {
    setLoading(true);
    const params = { from, to };
    if (machine) params.machine = machine;
    getShiftTimeReport(params)
      .then((res) => setRows(res.data?.data || []))
      .catch(() => toast.error?.("Failed to load shift time report"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex flex-col w-full max-w-5xl h-[88vh] max-h-[88vh] bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-xl border border-slate-300 dark:border-slate-700">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-brand-600" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Shift Time Report</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1 flex flex-col min-h-0">
          <div className="flex flex-wrap items-end gap-3 shrink-0">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Start Date</label>
              <DatePicker name="stFrom" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Start date" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">End Date</label>
              <DatePicker name="stTo" value={to} onChange={(e) => setTo(e.target.value)} placeholder="End date" />
            </div>
            <div className="w-full sm:w-56">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Machine</label>
              <select
                value={machine}
                onChange={(e) => setMachine(e.target.value)}
                className="w-full border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 bg-white dark:bg-[#1a1a1a]"
              >
                <option value="">All Machines</option>
                {machines.map((m) => <option key={m._id} value={m._id}>{m.machineName}</option>)}
              </select>
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 shadow-sm transition-colors disabled:opacity-60"
            >
              {loading ? "Loading…" : "Apply Filter"}
            </button>
          </div>

          <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-300 dark:border-slate-700 shadow-sm overflow-hidden flex-1 flex flex-col min-h-0">
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full text-xs sm:text-sm border-separate border-spacing-0">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-left">
                    {["Machine", "Shift", "Shift Start", "Shift End", "Shift Start Time", "Shift End Time", "Total Shift Time", "Overtime", "Start Delay / Early Closed"].map((h, i, arr) => (
                      <th key={h} className={`sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-b border-slate-300 dark:border-slate-700 ${i < arr.length - 1 ? "border-r" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 font-medium">Loading…</td></tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 font-medium">No entries match this filter.</td></tr>
                  )}
                  {!loading && rows.map((r, i) => (
                    <tr key={r._id} className={`border-b border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors ${i % 2 === 1 ? "bg-slate-50/70 dark:bg-slate-800/20" : "bg-white dark:bg-transparent"}`}>
                      <td className="px-3 py-2 whitespace-nowrap border-r border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-medium">{r.machineName}</td>
                      <td className="px-3 py-2 whitespace-nowrap border-r border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200">{r.shiftName}</td>
                      <td className="px-3 py-2 whitespace-nowrap border-r border-slate-300 dark:border-slate-700 font-mono text-xs">{r.shiftOnTime || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap border-r border-slate-300 dark:border-slate-700 font-mono text-xs">{r.shiftOffTime || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap border-r border-slate-300 dark:border-slate-700 font-mono text-xs bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{r.effectiveStartTime || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap border-r border-slate-300 dark:border-slate-700 font-mono text-xs bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{r.effectiveEndTime || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap border-r border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{fmtMin(r.totalShiftTimeMin)}</td>
                      <td className="px-3 py-2 whitespace-nowrap border-r border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200">{fmtMin(r.overtimeMin)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700 dark:text-slate-200">{fmtDelayOrEarly(r.startDelayMin, r.earlyClosedMin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────
const GrindingEntry = () => {
  const toast = useAlert() || toastify;
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = React.useContext(MenuContext) || {};
  const { data: machines = [] } = useMachines();
  const { data: processes = [] } = useProcesses();
  const { data: operators = [] } = useOperators();

  const [activeMachine, setActiveMachine] = useState("");
  const [sheetSearch, setSheetSearch] = useState("");
  const debouncedSheetSearch = useDebounce(sheetSearch, 300);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [entries, setEntries] = useState([]);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [values, setValues] = useState(buildInit());
  const [formErrors, setFormErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openFormula, setOpenFormula] = useState(null); // { key, label, formula, rect } | null
  const [openRemark, setOpenRemark] = useState(null); // { id, text, rect } | null
  const [showEfficiency, setShowEfficiency] = useState(false);
  const [showShiftTimeReport, setShowShiftTimeReport] = useState(false);

  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);

  // Scroll sync refs
  const topScrollRef = React.useRef(null);
  const tableContainerRef = React.useRef(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  const handleTopScroll = (e) => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  const handleTableScroll = (e) => {
    if (topScrollRef.current) {
      topScrollRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  useEffect(() => {
    if (!tableContainerRef.current) return;
    const updateWidth = () => {
      if (tableContainerRef.current) setScrollWidth(tableContainerRef.current.scrollWidth);
    };
    // Measure after a short delay to ensure table has rendered
    const timer = setTimeout(updateWidth, 100);
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    if (tableContainerRef.current?.firstElementChild) {
      ro.observe(tableContainerRef.current.firstElementChild);
    }
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, [entries, openFormula, loadingSheet]);

  // Close formula popover on outside click / scroll / resize
  useEffect(() => {
    if (!openFormula) return;
    const close = () => setOpenFormula(null);
    document.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [openFormula]);

  // Close remark popover on outside click / scroll / resize
  useEffect(() => {
    if (!openRemark) return;
    const close = () => setOpenRemark(null);
    document.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [openRemark]);

  const toggleRemark = (id, text, rect) => {
    setOpenRemark((prev) => (prev && prev.id === id ? null : { id, text, rect }));
  };

  const toggleFormula = (key, label, formula, rect) => {
    setOpenFormula((prev) => (prev && prev.key === key ? null : { key, label, formula, rect }));
  };

  // Standard times for the selected machine (for dropdown derivation)
  const [stdTimes, setStdTimes] = useState([]);
  const [loadingStd, setLoadingStd] = useState(false);

  // Process filter for the M/C Name dropdown in the Add/Edit modal — purely
  // a UI narrowing aid (the entry itself only stores `machine`; the process
  // is implied by the machine's own `processes` list on the Machine master).
  const [formProcess, setFormProcess] = useState("");
  const formMachines = useMemo(() => {
    if (!formProcess) return machines;
    return machines.filter((m) =>
      (m.processes || []).some((p) => (typeof p === "object" ? p._id : p) === formProcess)
    );
  }, [machines, formProcess]);

  // Process is just a narrowing filter for the M/C Name dropdown below — it
  // no longer supplies any Shift/time default itself (that's the selected
  // Machine's job now, see handleChange's "machine" branch).
  const handleProcessSelect = (e) => {
    const val = e.target.value;
    setFormProcess(val);
    setValues((prev) => ({
      ...prev,
      machine: "",
      sizeWidthMm: "",
      sizeHeightMm: "",
      thicknessMm: "",
      standardTimePerPieceMin: "",
      shiftOnTime: "",
      shiftOffTime: "",
    }));
    setStdTimes([]);
  };

  // (Auto-select removed to default to "All Machines")

  // Fetch production sheet — 20 rows per page by default so the whole
  // history doesn't load at once. While actively searching, pulls a wider
  // batch instead (search is a client-side filter over whatever's loaded,
  // so a plain 20-row page would make search look like it's missing
  // matches that are just on a different page).
  const isSearching = !!debouncedSheetSearch.trim();
  const fetchSheet = () => {
    setLoadingSheet(true);
    const params = isSearching
      ? { per_page: 1000, skip: 0 }
      : { per_page: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE };
    if (activeMachine) params.machine = activeMachine;
    if (dateFrom) params.from = dateFrom;
    if (dateTo) params.to = dateTo;
    listProductionEntries(params)
      .then((res) => {
        setEntries(res.data?.data || []);
        setTotalCount(res.data?.count || 0);
      })
      .catch(() => toast.error?.("Failed to load sheet"))
      .finally(() => setLoadingSheet(false));
  };
  useEffect(() => { fetchSheet(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeMachine, dateFrom, dateTo, page, debouncedSheetSearch]);

  // Any filter change (machine/date/search) should reset back to page 1 —
  // otherwise a narrower filter could land on a now out-of-range page.
  useEffect(() => { setPage(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeMachine, dateFrom, dateTo, debouncedSheetSearch]);

  // Free-text search across the sheet — matches against every column shown
  // in the table (entered fields AND calculated ones, formatted the same
  // way they're rendered, e.g. "NA" or "55.66"), not just Machine/Operator.
  const filteredEntries = useMemo(() => {
    const q = debouncedSheetSearch.trim().toLowerCase();
    if (!q) return entries;
    const fmtNum = (n) => (n == null || isNaN(n) ? "NA" : Number(n).toFixed(2));
    return entries.filter((e) => {
      const mName = typeof e.machine === "object" ? e.machine?.machineName : machines.find((m) => m._id === e.machine)?.machineName;
      const c = e.calculated || {};
      const haystack = [
        e.date ? new Date(e.date).toLocaleDateString() : "",
        mName,
        e.operator?.name,
        e.mcStartTime,
        e.mcOffTime,
        e.sizeWidthMm != null && e.sizeHeightMm != null ? `${e.sizeWidthMm}x${e.sizeHeightMm}` : "",
        e.thicknessMm,
        e.standardTimePerPieceMin,
        e.processQty,
        e.okQty,
        Number(e.processQty) - Number(e.okQty), // Rejected Qty
        c.workingScheduleMin,
        ...STOPPAGE_FIELDS.map((f) => e[f.key]),
        e.othersRemark, // Remark
        c.totalStoppageMin,
        fmtNum(c.availableWorkingMin),
        fmtNum(c.idealProductionQty),
        c.effectiveMcRunTimeMin,
        fmtNum(c.unreportedTimeMin),
        fmtNum(c.availabilityRatio),
        fmtNum(c.performanceRatio),
        c.qualityRatio,
        fmtNum(c.oeePercent),
      ]
        .filter((v) => v !== null && v !== undefined)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, debouncedSheetSearch, machines]);

  // Fetch standard times when machine changes in modal
  const fetchStdTimes = (machineId) => {
    if (!machineId) { setStdTimes([]); return; }
    setLoadingStd(true);
    listStandardTimes({ machine: machineId })
      .then((res) => setStdTimes(res.data?.data || []))
      .catch(() => { setStdTimes([]); })
      .finally(() => setLoadingStd(false));
  };

  // Derived dropdown options from stdTimes
  const uniqueSizes = useMemo(() => {
    const sizes = stdTimes.map((s) => `${s.sizeWidthMm}x${s.sizeHeightMm}`);
    return [...new Set(sizes)].sort((a, b) => {
      const [wA, hA] = a.split("x").map(Number);
      const [wB, hB] = b.split("x").map(Number);
      if (wA === wB) return hA - hB;
      return wA - wB;
    });
  }, [stdTimes]);

  const handleSizeChange = (e) => {
    const val = e.target.value;
    if (!val) {
      setValues((prev) => ({ ...prev, sizeWidthMm: "", sizeHeightMm: "", thicknessMm: "", standardTimePerPieceMin: "" }));
      return;
    }
    const [w, h] = val.split("x");
    setValues((prev) => ({ ...prev, sizeWidthMm: w, sizeHeightMm: h, thicknessMm: "", standardTimePerPieceMin: "" }));
  };

  const handleThicknessChange = (e) => {
    setValues((prev) => ({ ...prev, thicknessMm: e.target.value }));
  };

  const uniqueThicknesses = useMemo(() => {
    if (!values.sizeWidthMm || !values.sizeHeightMm) return [];
    const opts = new Set(
      stdTimes.filter(
        (s) => String(s.sizeWidthMm) === String(values.sizeWidthMm) &&
               String(s.sizeHeightMm) === String(values.sizeHeightMm)
      ).map((s) => s.thicknessMm)
    );
    // Editing an older entry saved before manual thickness entry was removed
    // may reference a thickness no longer in the master list — keep it
    // selectable instead of silently dropping it from the dropdown.
    if (editId && values.thicknessMm) opts.add(values.thicknessMm);
    return [...opts].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  }, [stdTimes, values.sizeWidthMm, values.sizeHeightMm, editId, values.thicknessMm]);

  // Auto-fetch standard time whenever all three dimensions are selected —
  // Standard Time always comes from the Standard Time Master, never typed.
  useEffect(() => {
    if (!values.sizeWidthMm || !values.sizeHeightMm || !values.thicknessMm) {
      setValues((prev) => ({ ...prev, standardTimePerPieceMin: "" }));
      return;
    }
    const match = stdTimes.find(
      (s) =>
        String(s.sizeWidthMm) === String(values.sizeWidthMm) &&
        String(s.sizeHeightMm) === String(values.sizeHeightMm) &&
        String(s.thicknessMm) === String(values.thicknessMm),
    );
    setValues((prev) => ({ ...prev, standardTimePerPieceMin: match ? String(match.standardTimeMin) : "" }));
  }, [values.sizeWidthMm, values.sizeHeightMm, values.thicknessMm, stdTimes]);

  const openModal = () => {
    const initMachine = activeMachine || "";
    setValues(buildInit(initMachine));
    setEditId(null);
    setFormErrors({});
    setSubmitted(false);
    setFormProcess("");
    fetchStdTimes(initMachine);
    setShowModal(true);
  };

  const openEdit = (e) => {
    setEditId(e._id);
    setFormProcess("");
    const machineId = typeof e.machine === "object" ? e.machine._id : e.machine;
    const machineObj = machines.find((m) => m._id === machineId);
    setValues({
      date: new Date(e.date).toISOString().split("T")[0],
      mcStartTime: e.mcStartTime || "",
      mcOffTime: e.mcOffTime || "",
      machine: machineId,
      operator: e.operator?._id || "",
      // The entry's own snapshot, not the machine's current config — if
      // the machine's Shift Time was changed since this entry was saved,
      // editing an unrelated field here must not silently pull in the new
      // schedule. Only falls back to the machine's live config for legacy
      // entries saved before snapshotting existed.
      shiftOnTime: e.shiftOnTime || machineObj?.machineOnTime || "",
      shiftOffTime: e.shiftOffTime || machineObj?.machineOffTime || "",
      sizeWidthMm: e.sizeWidthMm || "",
      sizeHeightMm: e.sizeHeightMm || "",
      thicknessMm: e.thicknessMm || "",
      standardTimePerPieceMin: e.standardTimePerPieceMin || "",
      processQty: e.processQty || "0",
      okQty: e.okQty || "0",
      rejectedQty: e.rejectedQty || "0",
      othersRemark: e.othersRemark || "",
      ...Object.fromEntries(STOPPAGE_FIELDS.map((f) => [f.key, String(e[f.key] || "0")])),
    });
    setFormErrors({});
    setSubmitted(false);
    const firstProcess = machineObj?.processes?.[0];
    setFormProcess(firstProcess ? (typeof firstProcess === "object" ? firstProcess._id : firstProcess) : "");
    fetchStdTimes(machineId);
    setShowModal(true);
  };

  const handleDelete = (e) => {
    if (e) e.preventDefault();
    setIsDeleteLoading(true);
    deleteProductionEntry(deleteId)
      .then(() => {
        setDeleteId(null);
        toast.success?.("Entry deleted successfully!");
        fetchSheet();
      })
      .catch((err) => {
        setDeleteId(null);
        toast.error?.(err.response?.data?.message || "Failed to delete entry.");
      })
      .finally(() => setIsDeleteLoading(false));
  };

  const closeModal = () => setShowModal(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "machine") {
      // Selecting a Machine applies its own Shift Time Start/End
      // (configured in Machine Master) to the read-only Shift On/Off Time
      // display only — that's just "what this machine is scheduled for".
      // M/C Start/Off Time is deliberately left for the operator to type in
      // by hand every time (the actual times worked, which is what feeds
      // Overtime/Start Delay/Early Closed) — never auto-filled from it.
      const machineObj = machines.find((m) => m._id === value);
      setValues((prev) => ({
        ...prev,
        machine: value,
        sizeWidthMm: "",
        sizeHeightMm: "",
        thicknessMm: "",
        standardTimePerPieceMin: "",
        shiftOnTime: machineObj?.machineOnTime || "",
        shiftOffTime: machineObj?.machineOffTime || "",
      }));
      fetchStdTimes(value);
    } else {
      setValues((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const errors = validate({ ...values, process: formProcess });
    setFormErrors(errors);
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    const apiCall = editId 
      ? updateProductionEntry(editId, values) 
      : createProductionEntry(values);

    apiCall
      .then((res) => {
        if (res.data.isOk) {
          toast.success?.(`Entry ${editId ? 'updated' : 'saved'}!`);
          setShowModal(false);
          fetchSheet();
        }
      })
      .catch((err) => {
        const apiErrors = err.response?.data?.errors;
        if (apiErrors) setFormErrors((prev) => ({ ...prev, ...apiErrors }));
        toast.error?.(err.response?.data?.message || `Failed to ${editId ? 'update' : 'save'} entry`);
      })
      .finally(() => setSaving(false));
  };

  const fmt = (n, unit = "") => (n == null || isNaN(n) ? "NA" : `${Number(n).toFixed(2)}${unit ? ` ${unit}` : ""}`);
  const fmtRatioPct = (n) => (n == null || isNaN(n) ? "NA" : `${(Number(n) * 100).toFixed(2)}%`);
  const UNIT_BY_CALC_KEY = useMemo(() => Object.fromEntries(CALC_COLUMNS.map((c) => [c.key, c.unit])), []);
  const err = (name) => submitted && formErrors[name] ? formErrors[name] : null;

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4">
        <div className="flex items-center gap-2">
          <Factory className="w-5 h-5 text-brand-600" />
          <h1 className="text-lg font-semibold text-slate-900">Grinding Data Entry</h1>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button onClick={() => setShowShiftTimeReport(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1a1a1a] hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-semibold px-4 py-2 shadow-sm transition-colors shrink-0">
            <Clock className="w-4 h-4" /> Shift Time Report
          </button>
          <button onClick={() => setShowEfficiency(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1a1a1a] hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-semibold px-4 py-2 shadow-sm transition-colors shrink-0">
            <Gauge className="w-4 h-4" /> Efficiency
          </button>
          {currentPagePermissions.create && (
            <button onClick={openModal} title="Add a new grinding data entry"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2 shadow-sm transition-colors shrink-0">
              <Plus className="w-4 h-4" /> Add Entry
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="relative w-full sm:w-56">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Search</label>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-[34px] -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={sheetSearch}
            onChange={(e) => setSheetSearch(e.target.value)}
            placeholder="Search this table…"
            className="w-full bg-white dark:bg-[#1a1a1a] border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-3.5 py-2 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 transition-shadow"
          />
        </div>
        <div className="w-full sm:w-56">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Machine</label>
          <select
            value={activeMachine}
            onChange={(e) => setActiveMachine(e.target.value)}
            className="w-full bg-white dark:bg-[#1a1a1a] border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 transition-shadow"
          >
            <option value="">All Machines</option>
            {machines.map((m) => (
              <option key={m._id} value={m._id}>{m.machineName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">From Date</label>
          <DatePicker name="dateFrom" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="Start date" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">To Date</label>
          <DatePicker name="dateTo" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="End date" />
        </div>
        {(dateFrom || dateTo || sheetSearch || activeMachine) && (
          <button
            onClick={() => { setSheetSearch(""); setActiveMachine(""); setDateFrom(""); setDateTo(""); }}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1a1a1a] hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-medium px-4 py-2 transition-colors"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Sheet table — header row & OEE column stay locked in place while scrolling, like an Excel freeze-pane */}
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-4 px-3 pt-2 pb-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-white dark:bg-[#1a1a1a] border border-slate-300 dark:border-slate-700 inline-block" /> Entered data
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-violet-100 dark:bg-violet-900\/50 border border-violet-300 dark:border-violet-700 inline-block" /> Calculated (click <Eye className="w-3 h-3 inline" /> for formula)
          </span>
        </div>
        
        {/* Top Scrollbar — synced with table below */}
        <div
          ref={topScrollRef}
          onScroll={handleTopScroll}
          style={{ overflowX: 'scroll', overflowY: 'hidden', height: 14 }}
          className="custom-top-scrollbar"
        >
          <div style={{ width: scrollWidth || '100%', height: 1 }} />
        </div>

        <div 
          ref={tableContainerRef}
          onScroll={handleTableScroll}
          className="overflow-auto max-h-[75vh] rounded-b-2xl"
        >
        <table className="w-full text-xs sm:text-sm border-separate border-spacing-0">
          <thead>
            <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-left">
              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Date</th>
              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Machine</th>
              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Operator</th>
              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">M/C Start</th>
              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">M/C Off</th>
              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Shift On</th>
              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Shift Off</th>

              {/* Overtime / Start Delay / Early Closed (calculated, derived from Shift On/Off vs. M/C Start/Off) */}
              <CalcHeader label="Overtime" formula={OVERTIME_FORMULA} colKey="overtimeMin" openKey={openFormula?.key} onToggle={toggleFormula} sticky="sticky top-0" extraClass="border-b" />
              <CalcHeader label="Start Delay / Early Closed" formula={DELAY_EARLY_FORMULA} colKey="startDelayEarlyClosed" openKey={openFormula?.key} onToggle={toggleFormula} sticky="sticky top-0" extraClass="border-b" />

              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Size (mm)</th>
              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Thickness</th>
              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Std. Time (min)</th>
              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Production Qty (Total Qty)</th>
              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">OK Qty</th>
              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Rejected Qty</th>

              {/* Working Schedule Time (calculated) */}
              <CalcHeader label="Working Schedule Time" formula={CALC_COLUMNS[0].formula} colKey={CALC_COLUMNS[0].key} openKey={openFormula?.key} onToggle={toggleFormula} sticky="sticky top-0" extraClass="border-b" />

              {/* Individual Downtime & Stoppage Reason fields (entered data) */}
              {STOPPAGE_FIELDS.map((f) => (
                <th key={f.key} className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">
                  {f.label.replace(" (Minutes)", "")}
                </th>
              ))}
              <th className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Remark</th>

              {/* Total Stoppage, Available Working Time, Ideal Production, Effective Run, Unreported (calculated) */}
              {CALC_COLUMNS.slice(1, 6).map((c) => (
                <CalcHeader key={c.key} label={c.label} formula={c.formula} colKey={c.key} openKey={openFormula?.key} onToggle={toggleFormula} sticky="sticky top-0" extraClass="border-b" />
              ))}

              {/* Availability / Performance / Quality Ratios (calculated) */}
              {CALC_COLUMNS.slice(6).map((c) => (
                <CalcHeader key={c.key} label={c.label} formula={c.formula} colKey={c.key} openKey={openFormula?.key} onToggle={toggleFormula} sticky="sticky top-0" extraClass="border-b" />
              ))}

              {/* OEE % (calculated) */}
              <CalcHeader
                label="OEE %"
                formula={OEE_FORMULA}
                colKey="oeePercent"
                openKey={openFormula?.key}
                onToggle={toggleFormula}
                sticky="sticky top-0 right-[90px]"
                z="z-30"
                bg="bg-blue-100 dark:bg-slate-800 text-brand-800 dark:text-brand-300"
                extraClass="border-l border-b shadow-[-4px_0_10px_rgba(0,0,0,0.05)] w-[100px] min-w-[100px] max-w-[100px]"
              />
              
              {/* Actions */}
              <th className="sticky top-0 right-0 z-30 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-b border-l border-slate-300 dark:border-slate-700 text-right shadow-[-4px_0_10px_rgba(0,0,0,0.05)] w-[90px] min-w-[90px] max-w-[90px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 && (
              <tr><td colSpan={14 + STOPPAGE_FIELDS.length + 1 + 5 + 4} className="px-4 py-10 text-center text-slate-500 font-medium">
                {loadingSheet ? "Loading…" : sheetSearch ? "No entries match your search." : "No entries for this machine yet."}
              </td></tr>
            )}
            {filteredEntries.map((e) => {
              const mName = typeof e.machine === "object" ? e.machine?.machineName : machines.find(m => m._id === e.machine)?.machineName;
              const c = e.calculated || {};
              const editable = isEntryEditable(parseLocalDate(e.date));
              return (
              <tr key={e._id} className="border-b border-slate-300 dark:border-slate-700 hover:bg-slate-50/60 transition-colors">
                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200">{new Date(e.date).toLocaleDateString()}</td>
                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-medium">{mName || "—"}</td>
                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200">{e.operator?.name || "—"}</td>
                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 font-mono text-xs">{e.mcStartTime || "—"}</td>
                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 font-mono text-xs">{e.mcOffTime || "—"}</td>
                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 font-mono text-xs text-slate-500 dark:text-slate-400">{e.shiftOnTime || (typeof e.machine === "object" ? e.machine?.machineOnTime : null) || "—"}</td>
                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 font-mono text-xs text-slate-500 dark:text-slate-400">{e.shiftOffTime || (typeof e.machine === "object" ? e.machine?.machineOffTime : null) || "—"}</td>

                {/* Overtime / Start Delay / Early Closed */}
                <td className="px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{fmtMin(c.overtimeMin)}</td>
                <td className="px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{fmtDelayOrEarly(c.startDelayMin, c.earlyClosedMin)}</td>

                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200">{e.sizeWidthMm}×{e.sizeHeightMm}</td>
                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200">{e.thicknessMm} mm</td>
                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200">{fmt(e.standardTimePerPieceMin, "min")}</td>
                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200">{e.processQty} qty</td>
                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200">{e.okQty} qty</td>
                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-red-500 font-bold">{Number(e.processQty) - Number(e.okQty)} qty</td>

                {/* Working Schedule Time */}
                <td className="px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{fmt(c.workingScheduleMin, UNIT_BY_CALC_KEY.workingScheduleMin)}</td>

                {/* Individual stoppage reason values */}
                {STOPPAGE_FIELDS.map((f) => (
                  <td key={f.key} className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200">{fmt(e[f.key], "min")}</td>
                ))}

                {/* Remark — hidden by default, "eye" opens a popover with the Others-downtime note */}
                <td className="bg-white dark:bg-[#1a1a1a] px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-center">
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      const rect = ev.currentTarget.getBoundingClientRect();
                      toggleRemark(e._id, e.othersRemark, rect);
                    }}
                    title="Show remark"
                    className={`p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${openRemark?.id === e._id ? "text-brand-600" : "text-slate-400"}`}
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </td>

                {/* Total Stoppage */}
                <td className="px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{fmt(c.totalStoppageMin, UNIT_BY_CALC_KEY.totalStoppageMin)}</td>
                {/* Available Working Time */}
                <td className="px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{fmt(c.availableWorkingMin, UNIT_BY_CALC_KEY.availableWorkingMin)}</td>
                {/* Ideal Production */}
                <td className="px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{fmt(c.idealProductionQty, UNIT_BY_CALC_KEY.idealProductionQty)}</td>
                {/* Effective M/C Run Time */}
                <td className="px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{fmt(c.effectiveMcRunTimeMin, UNIT_BY_CALC_KEY.effectiveMcRunTimeMin)}</td>
                {/* Unreported Time */}
                <td className="px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{fmt(c.unreportedTimeMin, UNIT_BY_CALC_KEY.unreportedTimeMin)}</td>

                {/* Availability / Performance / Quality Ratios */}
                <td className="px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{fmtRatioPct(c.availabilityRatio)}</td>
                <td className="px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{fmtRatioPct(c.performanceRatio)}</td>
                <td className="px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium">{fmtRatioPct(c.qualityRatio)}</td>

                {/* OEE % */}
                <td className="sticky right-[90px] z-10 px-3 py-2 whitespace-nowrap border-l border-b border-slate-300 dark:border-slate-700 bg-blue-50 dark:bg-slate-900 font-bold text-brand-700 dark:text-brand-300 shadow-[-4px_0_10px_rgba(0,0,0,0.05)] w-[100px] min-w-[100px] max-w-[100px]">
                  {fmt(c.oeePercent)}{c.oeePercent == null || isNaN(c.oeePercent) ? "" : "%"}
                </td>

                <td className="sticky right-0 z-10 w-[90px] px-3 py-2 whitespace-nowrap border-l border-b border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1a1a1a] shadow-[-4px_0_10px_rgba(0,0,0,0.05)]">
                  <div className="flex justify-end gap-2">
                    {currentPagePermissions.edit && (
                      editable ? (
                        <button onClick={() => openEdit(e)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:bg-slate-800 text-slate-500 transition-colors" title="Edit">
                          <Pencil className="w-4 h-4" />
                        </button>
                      ) : (
                        <span
                          className="p-1.5 rounded-lg text-slate-300 dark:text-slate-700 cursor-not-allowed"
                          title="Edit window closed (entries lock after 2 working days)"
                        >
                          <Pencil className="w-4 h-4" />
                        </span>
                      )
                    )}
                    {currentPagePermissions.delete && (
                      editable ? (
                        <button onClick={() => setDeleteId(e._id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ) : (
                        <span
                          className="p-1.5 rounded-lg text-slate-300 dark:text-slate-700 cursor-not-allowed"
                          title="Edit window closed (entries lock after 2 working days)"
                        >
                          <Trash2 className="w-4 h-4" />
                        </span>
                      )
                    )}
                  </div>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
        </div>
      </div>

      {/* Pagination — 20 rows per page by default. Hidden while actively
          searching, since search pulls a wider batch to filter over instead
          of just the current page. */}
      {!isSearching && totalCount > 0 && (
        <div className="flex items-center justify-between mt-3 px-1 text-sm text-slate-600 dark:text-slate-300">
          <span>
            Showing {Math.min((page - 1) * PAGE_SIZE + 1, totalCount)}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loadingSheet}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1a1a1a] px-3 py-1.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500">
              Page {page} of {Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => (p * PAGE_SIZE < totalCount ? p + 1 : p))}
              disabled={page * PAGE_SIZE >= totalCount || loadingSheet}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1a1a1a] px-3 py-1.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <FormulaPopover info={openFormula} onClose={() => setOpenFormula(null)} />
      <FormulaPopover
        info={openRemark ? { rect: openRemark.rect, label: "Remark", formula: openRemark.text?.trim() || "No remark entered." } : null}
        onClose={() => setOpenRemark(null)}
      />

      {/* ── Add Entry Modal ─────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" />
          <div className="relative flex flex-col w-full max-w-2xl max-h-[92vh] bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-xl border border-slate-200">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white dark:bg-[#1a1a1a] shrink-0 rounded-t-2xl z-10">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Grinding Data Entry</h2>
                <p className="text-xs text-slate-400 mt-0.5">Fields marked <span className="text-red-500">*</span> are required</p>
              </div>
              <button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-slate-100 dark:bg-slate-800 text-slate-500"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="px-5 py-4 space-y-3 overflow-y-auto">

              {/* ── Section 1: Date & Time ── */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Date &amp; Shift Timing</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1">

                  {/* Date */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Date <span className="text-red-500">*</span></label>
                    <DatePicker
                      name="date"
                      value={values.date}
                      onChange={handleChange}
                      hasError={!!err("date")}
                      placeholder="Select date"
                    />
                    {err("date") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{err("date")}</p>}
                  </div>

                  {/* M/C Start Time */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">M/C Start Time <span className="text-red-500">*</span></label>
                    <TimePicker
                      name="mcStartTime"
                      value={values.mcStartTime}
                      onChange={handleChange}
                      hasError={!!err("mcStartTime")}
                      placeholder="--:--"
                    />
                    {err("mcStartTime") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{err("mcStartTime")}</p>}
                  </div>

                  {/* M/C Off Time */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">M/C Off Time <span className="text-red-500">*</span></label>
                    <TimePicker
                      name="mcOffTime"
                      value={values.mcOffTime}
                      onChange={handleChange}
                      hasError={!!err("mcOffTime")}
                      placeholder="--:--"
                    />
                    {err("mcOffTime") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{err("mcOffTime")}</p>}
                  </div>

                  {/* Shift On/Off Time — read-only, from the selected Machine's
                      own Shift Time Start/End (Machine Master). Overtime/Start
                      Delay/Early Closed are derived from these vs. M/C
                      Start/Off Time, not entered manually. */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Shift On Time</label>
                    <input type="text" readOnly value={values.shiftOnTime || "—"}
                      className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 outline-none cursor-default font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Shift Off Time</label>
                    <input type="text" readOnly value={values.shiftOffTime || "—"}
                      className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 outline-none cursor-default font-mono" />
                  </div>

                </div>
              </div>

              {/* ── Section 2: Machine & Glass Spec ── */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Machine &amp; Glass Specification</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">

                  {/* Process — required, and gates the M/C Name dropdown below */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Process <span className="text-red-500">*</span></label>
                    <select value={formProcess} onChange={handleProcessSelect} className={cls(err("process"))}>
                      <option value="">Select Process</option>
                      {processes.map((p) => <option key={p._id} value={p._id}>{p.processName}</option>)}
                    </select>
                    {err("process") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{err("process")}</p>}
                  </div>

                  {/* M/C Name & Operator */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">M/C Name <span className="text-red-500">*</span></label>
                    <select name="machine" value={values.machine} onChange={handleChange} disabled={!formProcess} className={cls(err("machine"))}>
                      <option value="">{formProcess ? "Select Machine" : "Select process first"}</option>
                      {formMachines.map((m) => <option key={m._id} value={m._id}>{m.machineName}</option>)}
                    </select>
                    {err("machine") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{err("machine")}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Operator <span className="text-red-500">*</span></label>
                    <select name="operator" value={values.operator} onChange={handleChange} className={cls(err("operator"))}>
                      <option value="">Select Operator</option>
                      {operators.map((op) => <option key={op._id} value={op._id}>{op.name}</option>)}
                    </select>
                    {err("operator") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{err("operator")}</p>}
                  </div>

                  {/* Size (Width x Height) */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Size (mm) <span className="text-red-500">*</span></label>
                    <select
                      value={(values.sizeWidthMm && values.sizeHeightMm) ? `${values.sizeWidthMm}x${values.sizeHeightMm}` : ""}
                      onChange={handleSizeChange}
                      disabled={!values.machine || uniqueSizes.length === 0}
                      className={cls(err("sizeWidthMm") || err("sizeHeightMm"))}
                    >
                      <option value="">{uniqueSizes.length === 0 ? "— No sizes for this machine —" : "Select Size"}</option>
                      {uniqueSizes.map((size) => <option key={size} value={size}>{size.replace('x', ' × ')} mm</option>)}
                    </select>
                    {(err("sizeWidthMm") || err("sizeHeightMm")) && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">Size is required</p>}
                  </div>

                  {/* Thickness */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Thickness (mm) <span className="text-red-500">*</span></label>
                    <select name="thicknessMm" value={values.thicknessMm} onChange={handleThicknessChange}
                      disabled={!values.sizeWidthMm || !values.sizeHeightMm} className={cls(err("thicknessMm"))}>
                      <option value="">{(!values.sizeWidthMm || !values.sizeHeightMm) ? "Select size first" : "Select Thickness"}</option>
                      {uniqueThicknesses.map((t) => <option key={t} value={t}>{t} mm</option>)}
                    </select>
                    {err("thicknessMm") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{err("thicknessMm")}</p>}
                  </div>

                  {/* Standard Time — always auto-filled from Standard Time Master */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">
                      Standard Time of Grinding One Glass (min)
                      <span className="ml-1 text-[10px] text-slate-400 font-normal">(auto-filled)</span>
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={values.standardTimePerPieceMin ? `${values.standardTimePerPieceMin} min` : "—"}
                      className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 outline-none cursor-default"
                    />
                    {err("standardTimePerPieceMin") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{err("standardTimePerPieceMin")}</p>}
                    {(values.machine && values.sizeWidthMm && values.sizeHeightMm && values.thicknessMm && !values.standardTimePerPieceMin) && <p className="text-[10px] text-amber-600 mt-0.5 leading-tight">No standard time found for this combination.</p>}
                  </div>

                </div>
              </div>

              {/* ── Section 3: Output Quantities ── */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Output Quantities</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">
                      Production Qty (Total Qty) <span className="text-red-500">*</span>
                    </label>
                    <input type="number" name="processQty" value={values.processQty} onChange={handleChange} onWheel={(e) => e.target.blur()} ref={noWheelChange}
                      onInput={(e) => e.target.value = e.target.value.slice(0, 30)}
                      min={1} step={1} className={cls(err("processQty"))} placeholder="Enter quantity" />
                    {err("processQty") && !err("processQty").startsWith("Not achievable") && (
                      <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{err("processQty")}</p>
                    )}
                  </div>

                  {/* Capacity ("Not achievable") error — rendered as a prominent full-width
                      alert instead of the tiny inline field message, since missing this one
                      is the difference between a save that silently fails and one that doesn't. */}
                  {err("processQty") && err("processQty").startsWith("Not achievable") && (
                    <div className="sm:col-span-2 flex items-start gap-2 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5">
                      <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                      <p className="text-xs sm:text-sm font-semibold text-red-700 dark:text-red-300 leading-snug">{err("processQty")}</p>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">
                      OK Grinding Glass Qty <span className="text-red-500">*</span>
                    </label>
                    <input type="number" name="okQty" value={values.okQty} onChange={handleChange} onWheel={(e) => e.target.blur()} ref={noWheelChange}
                      onInput={(e) => e.target.value = e.target.value.slice(0, 30)}
                      min={0} step={1} className={cls(err("okQty"))} placeholder="Enter quantity" />
                    {err("okQty") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{err("okQty")}</p>}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">
                      Rejected Qty
                      <span className="ml-1 text-[10px] text-slate-400 font-normal">(auto-calculated: Production Qty − OK Qty)</span>
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={
                        values.processQty !== "" && values.okQty !== ""
                          ? Math.max(0, Number(values.processQty) - Number(values.okQty))
                          : "—"
                      }
                      className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 outline-none cursor-default"
                    />
                  </div>

                </div>
              </div>

              {/* ── Section 4: Stoppage Reasons ── */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Downtime &amp; Stoppage Reasons</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                  {STOPPAGE_FIELDS.map((f) => (
                    <React.Fragment key={f.key}>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">{f.label}</label>
                        <input type="number" name={f.key} value={values[f.key]} onChange={handleChange} onWheel={(e) => e.target.blur()} ref={noWheelChange}
                          min={0} max={1440} step={1} className={cls(err(f.key))} />
                        {err(f.key) && <p className="text-[10px] text-red-500 mt-0.5">{err(f.key)}</p>}
                      </div>
                      {f.key === "othersMin" && (
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">
                            Remarks {Number(values.othersMin) > 0 && <span className="text-red-500">*</span>}
                          </label>
                          <textarea
                            name="othersRemark"
                            value={values.othersRemark}
                            onChange={handleChange}
                            maxLength={300}
                            rows={2}
                            placeholder="Describe the reason for Others downtime"
                            className={cls(err("othersRemark")) + " resize-none"}
                          />
                          {err("othersRemark") && <p className="text-[10px] text-red-500 mt-0.5">{err("othersRemark")}</p>}
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              </div>
              {/* Footer */}
              <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-slate-200 bg-white dark:bg-[#1a1a1a] shrink-0 rounded-b-2xl">
                <button type="button" onClick={closeModal} disabled={saving}
                  className="rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-sm font-medium px-4 py-2 disabled:opacity-60">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-5 py-2 shadow-sm disabled:opacity-70">
                  {saving ? (
                    <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>Saving…</>
                  ) : "Save Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <DeleteModal show={!!deleteId} toggle={() => setDeleteId(null)}
        handleDelete={handleDelete} disabled={isDeleteLoading} />

      {showEfficiency && <EfficiencyModal onClose={() => setShowEfficiency(false)} />}
      {showShiftTimeReport && <ShiftTimeReportModal onClose={() => setShowShiftTimeReport(false)} />}
    </div>
  );
};

export default GrindingEntry;
