import React, { useState, useEffect, useLayoutEffect, useMemo } from "react";
import ReactDOM from "react-dom";
import Select, { components as selectComponents } from "react-select";
import { Plus, Minus, X, Eye, Pencil, Trash2, Gauge, AlertTriangle, Search, Download, Clock, ChevronRight, ChevronDown, ChevronLeft } from "lucide-react";
import { toast as toastify } from "react-toastify";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useMachines } from "../hooks/useMachines";
import { useProcesses } from "../hooks/useProcesses";
import { useMachineOperators } from "../hooks/useMachineOperators";
import { useDebounce } from "../hooks/useDebounce";
import { useCompanyHolidays } from "../hooks/useCompanyHolidays";
import { useCompanySettings } from "../hooks/useCompanySettings";
import { listStandardTimes } from "../api/standardTime.api";
import {
  createProductionEntry, listProductionEntries, updateProductionEntry, deleteProductionEntry,
  getProductionEfficiency, downloadGrindingEfficiencyPdf, getShiftTimeReport,
} from "../api/productionEntries.api";
import DatePicker from "../Components/Common/DatePicker";
import TimePicker from "../Components/Common/TimePicker";
import DeleteModal from "../Components/Common/DeleteModal";
import { isEntryEditable, parseLocalDate, buildHolidaySet } from "../utils/workingDays";
import { computeBatchCalculations } from "../utils/productionCalculation";
import { useFormSchema } from "../hooks/useFormSchema";

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

// ── Rejection reason fields ───────────────────────────────────────────────
// Mirrors STOPPAGE_FIELDS' pattern exactly — Rejected Qty is never typed
// directly, it's the sum of these (see server/models/ProductionEntry.js and
// buildData() in the controller, which derive rejectedQty from these keys).
const REJECTION_FIELDS = [
  { key: "rejScratchesQty",        label: "Scratches" },
  { key: "rejChippingQty",         label: "Chipping" },
  { key: "rejCornerBreakageQty",   label: "Corner Breakage" },
  { key: "rejSizeMismatchQty",     label: "Size Mis-match" },
  { key: "rejHandlingBreakageQty", label: "Handling Breakage and Others" },
];

/**
 * Applies the Form Builder schema (Phase 4) to one of the built-in field
 * lists above: takes the admin's label, order and visibility, drops hidden
 * fields, and leaves the list untouched when no schema is available.
 *
 * Only PRESENTATION is schema-driven. The constant lists above stay the
 * source of truth for validation and for summing Total Stoppage / Rejected
 * Qty, because a hidden field still defaults to 0 and must still be summed
 * — dropping it from those calculations would silently change the numbers.
 */
const applySchemaTo = (defaults, schema) => {
  if (!schema?.fields?.length) return defaults;
  const byKey = new Map(schema.fields.map((f) => [f.key, f]));
  return defaults
    .map((f) => {
      const s = byKey.get(f.key);
      if (!s) return f;
      return s.isVisible === false ? null : { ...f, label: s.label || f.label, order: s.order };
    })
    .filter(Boolean)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
};


// ── Calculated (derived) columns shown in the sheet, in order ────────────
// Each entry: key inside e.calculated, label, and the exact formula text
// shown when the "eye" icon on that column header is clicked.
const CALC_COLUMNS = [
  {
    key: "workingScheduleMin",
    label: "Working Schedule Time (min)",
    unit: "min",
    formula: "Working Schedule Time = span from this row's own effective start to its own effective end (its earliest ON/OFF period's start, and its latest period's end, if it has Additional Periods). Only the FIRST entry in a batch can start earlier than Shift On (or pull back to Shift On if it started later) — only the LAST entry can extend past Shift Off (or forward to Shift Off if it finished earlier). Every other entry's end stops at its own latest period's end — a gap between this entry and the next one belongs to neither, so it's simply not scheduled time for anyone (a batch's total can be less than the full shift when such gaps exist). A pause BETWEEN TWO PERIODS OF THE SAME ENTRY still shows up as that entry's own Unreported Time.",
  },
  {
    key: "totalStoppageMin",
    label: "Total Stoppage (min)",
    unit: "min",
    formula:
      "Total Stoppage = Planned Downtime + No Manpower + Mechanical Breakdown + Electrical Breakdown + Raw Material Not Available + Stoppage (Human Error) + Changeover + Raw Material Problem + No Power + Others + Lunch (see the Lunch column), for this row only",
  },
  {
    key: "availableWorkingMin",
    label: "Available Working Time (min)",
    unit: "min",
    formula: "Available Working Time = Working Schedule Time − Total Stoppage, floored at 0 (never negative) — per row",
  },
  {
    key: "idealProductionQty",
    label: "Ideal Production (qty)",
    unit: "qty",
    formula: "Ideal Production = this row's own actual M/C run time (summed across all of its ON/OFF periods, if it has more than one) ÷ its own Standard Time per Glass — per row",
  },
  {
    key: "effectiveMcRunTimeMin",
    label: "Effective M/C Run Time (min)",
    unit: "min",
    formula: "Effective M/C Run Time = the SUM of this row's own M/C ON/OFF periods (usually just M/C Off − M/C Start; if this row has Additional Periods, each one's own duration is added) — a pause between two periods of this same row is excluded, and flows into Unreported Time instead — per row",
  },
  {
    key: "unreportedTimeMin",
    label: "Unreported Time (min)",
    unit: "min",
    formula: "Unreported Time = MAX(0, Available Working Time − Effective M/C Run Time) — per row. Includes a pause between two periods of this SAME entry, since that's never explained by run time or a stoppage reason — but not a gap to a different entry (see Working Schedule Time).",
  },
  {
    key: "availabilityRatio",
    label: "Availability Ratio",
    unit: "",
    formula: "Availability Ratio = Effective M/C Run Time ÷ Available Working Time, capped at 100% (NA if Available Working Time is 0) — per row",
  },
  {
    key: "performanceRatio",
    label: "Performance Ratio",
    unit: "",
    formula: "Performance Ratio = (this row's own Production Qty × Standard Time) ÷ this row's own Effective M/C Run Time (NA if Effective M/C Run Time is 0) — per row",
  },
  {
    key: "qualityRatio",
    label: "Quality Ratio",
    unit: "",
    formula: "Quality Ratio = this row's own OK Qty ÷ Production Qty — per row",
  },
];

const OEE_FORMULA = "OEE % = Availability Ratio × Performance Ratio × Quality Ratio × 100 (NA if Availability or Performance is NA) — computed per row, from that row's own data";
const LUNCH_FORMULA = "Lunch = the Machine's configured 1-hour Lunch Break, ADDED INTO Total Stoppage — all-or-nothing: only counted when this row's own M/C time (earliest period's start through latest period's end) FULLY COVERS the lunch window. A row ending even 1 minute before the window closes gets 0, not a partial amount. Blank/0 when this machine has no Lunch Break configured.";
const OVERTIME_FORMULA = "Overtime = max(0, Shift On − M/C Start) + max(0, M/C Off − Shift Off) — but only the FIRST entry in a batch can contribute the early-start part, and only the LAST entry can contribute the late-finish part. A middle entry always shows 0 — it isn't touching either shift boundary.";
const DELAY_EARLY_FORMULA = "Start Delay = max(0, M/C Start − Shift On), only on the FIRST entry in a batch  ·  Early Closed = max(0, Shift Off − M/C Off), only on the LAST entry. A middle entry always shows 0 for both.";

// Remembers the last Process picked in the Add Entry modal (across entries
// and page reloads) so operators entering a run of rows for the same
// Process don't have to reselect it every time.
const LAST_PROCESS_KEY = "grindingEntry:lastProcess";
const getLastProcess = () => {
  try { return localStorage.getItem(LAST_PROCESS_KEY) || ""; } catch { return ""; }
};
const setLastProcess = (id) => {
  try { if (id) localStorage.setItem(LAST_PROCESS_KEY, id); } catch { /* ignore */ }
};

// Links every entry saved from one multi-row submission so the sheet can
// group them back into a single display row — see ProductionEntry model.
const newBatchId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Shared across every repeated entry row below (Process/M-C Name/Date/Operator
// are picked once per modal, not per row).
const buildSharedInit = (machineId = "") => ({
  date: new Date().toISOString().split("T")[0],
  machine: machineId,
  operator: "",
  shiftOnTime: "",
  shiftOffTime: "",
  lunchStartTime: "",
});

// One repeatable "Machine Timing, Size & Quantities" + its own paired
// "Downtime & Stoppage Reasons" — the unit the "+ Add Another Entry" button
// duplicates, each becoming its own saved production entry.
const buildRow = () => ({
  mcStartTime: "",
  mcOffTime: "",
  additionalPeriods: [],
  sizeWidthMm: "",
  sizeHeightMm: "",
  thicknessMm: "",
  standardTimePerPieceMin: "",
  processQty: "",
  okQty: "",
  othersRemark: "",
  ...Object.fromEntries(STOPPAGE_FIELDS.map((f) => [f.key, "0"])),
  ...Object.fromEntries(REJECTION_FIELDS.map((f) => [f.key, "0"])),
});

// ── Capacity check helper — mirrors server/services/productionCalculation
// .service.js's computeRowIdealProductionQty exactly (this row's own raw
// M/C run time ÷ Standard Time = Ideal Production, deliberately independent
// of Shift On/Off or Available Working Time — a physical "how many pieces
// could the machine possibly make in the time it actually ran" check), so
// the pre-save warning here never disagrees with what the server would have
// stored. ───────────────────────────────────────────────
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

// True if two [start, off) M/C time windows for the same Machine/Date
// overlap — each window is normalized to extend past midnight when off <=
// start (a shift crossing into the next day), so the same machine can't be
// claimed as running two different jobs at once within one submission.
const timeWindowsOverlap = (aStart, aOff, bStart, bOff) => {
  const norm = (start, off) => {
    let s = timeToMinutes(start), e = timeToMinutes(off);
    if (e <= s) e += 1440;
    return [s, e];
  };
  const [aS, aE] = norm(aStart, aOff);
  const [bS, bE] = norm(bStart, bOff);
  return aS < bE && bS < aE;
};

// This row's own M/C ON/OFF periods — primary mcStartTime/mcOffTime plus
// any `additionalPeriods` (a pause/resume within the same entry, sharing
// one production/downtime record) — sorted chronologically. Mirrors server
// rowPeriods exactly.
const rowPeriods = (row) => {
  const periods = [{ start: row.mcStartTime, end: row.mcOffTime }];
  if (Array.isArray(row.additionalPeriods)) {
    for (const p of row.additionalPeriods) {
      if (p && p.startTime && p.endTime) periods.push({ start: p.startTime, end: p.endTime });
    }
  }
  return periods.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
};

// Sum of actual running time across every ON/OFF period for this row — NOT
// the span from the first period's start to the last period's end, so a
// pause between two periods of the SAME row is excluded. Mirrors server
// rowEffectiveRunMin exactly.
const rowEffectiveRunMin = (row) => {
  return rowPeriods(row).reduce((sum, p) => {
    let diff = timeToMinutes(p.end) - timeToMinutes(p.start);
    if (diff <= 0) diff += 24 * 60;
    return sum + diff;
  }, 0);
};

// Ideal Production Qty is a PER-ROW capacity check, independent of Shift
// On/Off Time and stoppage minutes — mirrors server/services/
// productionCalculation.service.js's computeRowIdealProductionQty exactly:
// this row's own actual M/C run time (summed across all of its ON/OFF
// periods) ÷ its own Standard Time per Glass. "Given how long this size
// actually ran, how many pieces should it have made at standard speed."
const computeIdealProductionQty = (v) => {
  const std = Number(v.standardTimePerPieceMin) || 0;
  if (std <= 0) return 0;
  return rowEffectiveRunMin(v) / std;
};

// ── Client-side validation ────────────────────────────────────────────────
// Shared fields — Process/M-C Name/Date/Operator, picked once per modal.
const validateShared = (v) => {
  const e = {};
  if (!v.date) e.date = "Date is required";
  if (!v.process) e.process = "Please select a process";
  if (!v.machine) e.machine = "Please select a machine";
  if (!v.operator) e.operator = "Please select an operator";

  // Shift On/Off Time is editable (overriding the Machine's auto-filled
  // default) — required so it can't be cleared and submitted blank, which
  // would defeat the snapshot design by making the server silently re-fetch
  // the Machine's CURRENT shift time instead.
  const timeRx = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!v.shiftOnTime) e.shiftOnTime = "Shift On Time is required";
  else if (!timeRx.test(v.shiftOnTime)) e.shiftOnTime = "Use HH:mm format";
  if (!v.shiftOffTime) e.shiftOffTime = "Shift Off Time is required";
  else if (!timeRx.test(v.shiftOffTime)) e.shiftOffTime = "Use HH:mm format";

  return e;
};

// One repeatable row — `shared` supplies shiftOnTime/shiftOffTime (from the
// selected Machine) for the capacity check, since those live outside the row.
const validateRow = (row, shared) => {
  const e = {};

  const timeRx = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!row.mcStartTime) e.mcStartTime = "M/C Start Time is required";
  else if (!timeRx.test(row.mcStartTime)) e.mcStartTime = "Use HH:mm format";
  if (!row.mcOffTime) e.mcOffTime = "M/C Off Time is required";
  else if (!timeRx.test(row.mcOffTime)) e.mcOffTime = "Use HH:mm format";
  else if (!e.mcStartTime && row.mcOffTime <= row.mcStartTime) e.mcOffTime = "M/C Off Time cannot be earlier than or equal to M/C Start Time";

  // Extra M/C ON/OFF periods for this SAME row (a pause/resume within one
  // entry) — mirrors server validateAdditionalPeriods exactly: each valid
  // HH:mm, Off after Start, and none of this row's own periods (primary +
  // additional) may overlap each other.
  if (Array.isArray(row.additionalPeriods) && row.additionalPeriods.length) {
    const periods = [];
    if (!e.mcStartTime && !e.mcOffTime) periods.push([row.mcStartTime, row.mcOffTime]);
    for (let i = 0; i < row.additionalPeriods.length && !e.additionalPeriods; i++) {
      const p = row.additionalPeriods[i] || {};
      const label = `Additional period ${i + 1}`;
      if (!p.startTime || !timeRx.test(p.startTime)) { e.additionalPeriods = `${label} Start Time must be HH:mm`; break; }
      if (!p.endTime || !timeRx.test(p.endTime)) { e.additionalPeriods = `${label} Off Time must be HH:mm`; break; }
      if (p.endTime <= p.startTime) { e.additionalPeriods = `${label} Off Time must be after its Start Time`; break; }
      for (const [pStart, pEnd] of periods) {
        if (timeWindowsOverlap(p.startTime, p.endTime, pStart, pEnd)) {
          e.additionalPeriods = `${label} (${p.startTime}–${p.endTime}) overlaps with another period on this same row`;
          break;
        }
      }
      if (!e.additionalPeriods) periods.push([p.startTime, p.endTime]);
    }
  }

  if (!row.sizeWidthMm) e.sizeWidthMm = "Width is required";
  if (!row.sizeHeightMm) e.sizeHeightMm = "Height is required";
  if (!row.thicknessMm) e.thicknessMm = "Thickness is required";
  if (!row.standardTimePerPieceMin) e.standardTimePerPieceMin = "Standard Time is required";
  else if (isNaN(Number(row.standardTimePerPieceMin)) || Number(row.standardTimePerPieceMin) <= 0) e.standardTimePerPieceMin = "Must be a number > 0";

  const pq = Number(row.processQty);
  if (row.processQty === "") e.processQty = "Production Qty is required";
  else if (!Number.isInteger(pq) || pq < 1) e.processQty = "Must be a whole number ≥ 1";
  else if (String(row.processQty).length > 30) e.processQty = "Cannot exceed 30 digits";

  const oq = Number(row.okQty);
  if (row.okQty === "") e.okQty = "OK Qty is required";
  else if (!Number.isInteger(oq) || oq < 0) e.okQty = "Must be a whole number ≥ 0";
  else if (String(row.okQty).length > 30) e.okQty = "Cannot exceed 30 digits";

  if (!e.processQty && !e.okQty && oq > pq)
    e.okQty = "OK Qty cannot exceed Production Qty";

  // Rejected Qty is never typed directly — it's the sum of the individual
  // Rejection Reasons below (mirrors how Total Stoppage sums STOPPAGE_FIELDS).
  for (const f of REJECTION_FIELDS) {
    const val = row[f.key];
    if (val === "" || val === null || val === undefined) continue;
    const n = Number(val);
    if (isNaN(n) || !Number.isInteger(n) || n < 0) e[f.key] = "Must be a whole number ≥ 0";
    else if (String(val).length > 30) e[f.key] = "Cannot exceed 30 digits";
  }
  const rejectionFieldsClean = REJECTION_FIELDS.every((f) => !e[f.key]);
  const rejectedQtyTotal = REJECTION_FIELDS.reduce((s, f) => s + (Number(row[f.key]) || 0), 0);

  if (!e.processQty && !e.okQty && rejectionFieldsClean && oq + rejectedQtyTotal > pq)
    e.rejectionTotal = `OK Qty + Rejected Qty (${rejectedQtyTotal}, from Rejection Reasons below) cannot exceed Production Qty`;

  for (const f of STOPPAGE_FIELDS) {
    const val = row[f.key];
    if (val === "" || val === null || val === undefined) continue;
    const n = Number(val);
    if (isNaN(n) || n < 0 || n > 1440) e[f.key] = "0–1440 min";
  }

  const othersRemark = (row.othersRemark || "").trim();
  if (Number(row.othersMin) > 0 && !othersRemark) e.othersRemark = "Remark is required when Others is greater than 0";
  else if (othersRemark.length > 300) e.othersRemark = "Cannot exceed 300 characters";

  // Capacity check: can't process more pieces than this row's own actual
  // M/C run time (M/C Off − M/C Start) allows at this Standard Time. Only
  // run once every input that feeds it is itself already valid, so this
  // doesn't pile on top of more basic errors above.
  if (!e.mcStartTime && !e.mcOffTime && !e.additionalPeriods && !e.standardTimePerPieceMin && !e.processQty) {
    const idealProductionQty = computeIdealProductionQty(row);
    if (idealProductionQty < pq) {
      e.processQty =
        `Not achievable: M/C run time ÷ Standard Time = ${idealProductionQty.toFixed(2)} pcs, ` +
        `which is less than Production Qty (${pq}). Reduce Production Qty or check the M/C Start/Off Time.`;
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
const CalcHeader = ({ label, formula, colKey, openKey, onToggle, sticky = "", z = "z-20", bg = "bg-violet-100 dark:bg-violet-900\/50 text-violet-900", extraClass = "", expandable = false, expanded = false, onToggleExpand }) => {
  const btnRef = React.useRef(null);
  const isOpen = openKey === colKey;
  return (
    <th
      className={`px-3 py-2 font-semibold whitespace-nowrap border-r border-slate-300 dark:border-slate-700 ${bg} ${z} ${sticky} ${extraClass}`}
    >
      <span className="inline-flex items-center gap-1">
        {expandable && (
          <button
            type="button"
            onClick={onToggleExpand}
            title={expanded ? "Collapse Downtime & Stoppage Reasons" : "Expand Downtime & Stoppage Reasons"}
            className="flex items-center justify-center rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 shrink-0"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        )}
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
  const { data: operators = [] } = useMachineOperators();
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

// Fixed DD/MM/YY display — independent of the viewer's browser locale
// (unlike toLocaleDateString(), which renders M/D/YYYY, DD/MM/YYYY, etc.
// depending on the browser's locale settings). parseLocalDate avoids the
// timezone-shift bug of `new Date(isoString)` before reading date parts.
const fmtDate = (date) => {
  const d = parseLocalDate(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
};

// ── Shift Time Report — Machine, Shift Start/End, M/C On/Off, Overtime,
// Start Delay / Early Closed for every entry in a date range. ─────────────
// `showUnit` (default true) lets a grouped/stacked cell show "min" only on
// its first line and bare numbers below it — the Shift Time Report modal
// (one row per entry, never stacked) always calls this with the default.
const fmtMin = (n, showUnit = true) => (n == null || Number(n) === 0 ? "—" : `${Number(n).toFixed(0)}${showUnit ? " min" : ""}`);
// Start Delay and Early Closed are computed independently (late start vs.
// early finish) and CAN both be non-zero on the same entry (e.g. machine
// starts late AND finishes early) — show every non-zero part, don't drop one.
const fmtDelayOrEarly = (startDelayMin, earlyClosedMin, showUnit = true) => {
  const parts = [];
  if (Number(startDelayMin) > 0) parts.push(`Delay ${Number(startDelayMin).toFixed(0)}${showUnit ? " min" : ""}`);
  if (Number(earlyClosedMin) > 0) parts.push(`Early ${Number(earlyClosedMin).toFixed(0)}${showUnit ? " min" : ""}`);
  return parts.length > 0 ? parts.join(" / ") : "—";
};

const sumBy = (arr, getter) => arr.reduce((s, e) => s + (Number(getter(e)) || 0), 0);

// Every StackedCell in a grouped row renders as its own independent div
// stack (see StackedCell) — there's no real shared-height grid tying a
// row's cells together the way native <tr> rows do, but since no stacked
// column shows a "Total" line anymore (the 4 Total columns moved out to
// their own dedicated columns after OEE%), every column always gets exactly
// one line per entry — no filler padding needed to keep heights in sync.

// A sheet cell for a per-entry column, stacking one line per entry in a
// batch (see `batchId` on the model) — a single-entry "batch" renders
// identically to the old plain cell (one line, no divider). `className`
// should be the exact className the plain `<td>` used before, minus its
// `py-2` (moved onto each stacked line instead, so a lone item still gets
// the same padding it always had).
const StackedCell = ({ className, items }) => (
  <td className={className}>
    {/* -mx-3 cancels the td's own px-3 padding so the divider border below
        can bleed all the way out to the cell's actual left/right edges;
        px-3 is then re-applied per item so the text still lines up under
        the header exactly as before. No explicit width here — the box must
        stay "auto" so the negative margins actually stretch it (a fixed
        w-full would pin the width and just shift the box instead). */}
    <div className="flex flex-col -mx-3">
      {items.map((node, i) => (
        <div key={i} className={`px-3 py-2 w-full ${i > 0 ? "border-t border-slate-200 dark:border-slate-700" : ""}`}>{node}</div>
      ))}
    </div>
  </td>
);

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
                    {["Machine", "Shift Start", "Shift End", "Shift Start Time", "Shift End Time", "Total Shift Time", "Overtime", "Start Delay / Early Closed"].map((h, i, arr) => (
                      <th key={h} className={`sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-b border-slate-300 dark:border-slate-700 ${i < arr.length - 1 ? "border-r" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 font-medium">Loading…</td></tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 font-medium">No entries match this filter.</td></tr>
                  )}
                  {!loading && rows.map((r, i) => (
                    <tr key={r._id} className={`border-b border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors ${i % 2 === 1 ? "bg-slate-50/70 dark:bg-slate-800/20" : "bg-white dark:bg-transparent"}`}>
                      <td className="px-3 py-2 whitespace-nowrap border-r border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-medium">{r.machineName}</td>
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
  const { data: operators = [] } = useMachineOperators();
  const { data: companyHolidays = [] } = useCompanyHolidays();
  const { data: companySettings } = useCompanySettings();
  const weeklyOffDays = companySettings?.weeklyOffDays;

  // Form Builder (Phase 4). Falls back to the built-in lists above when the
  // form hasn't been seeded, so the page works regardless.
  const { data: formSchema } = useFormSchema();
  const stoppageFields = useMemo(() => applySchemaTo(STOPPAGE_FIELDS, formSchema), [formSchema]);
  const rejectionFields = useMemo(() => applySchemaTo(REJECTION_FIELDS, formSchema), [formSchema]);
  const customFields = useMemo(
    () => (formSchema?.fields || []).filter((f) => !f.isCore && f.isVisible !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [formSchema],
  );
  // Built once per holiday-list change, not per row — isEntryEditable's
  // caller below runs inside a .map() over every visible entry.
  const holidaySet = useMemo(() => buildHolidaySet(companyHolidays), [companyHolidays]);

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
  const [values, setValues] = useState(buildSharedInit()); // shared: date/machine/operator/shift times
  const [formErrors, setFormErrors] = useState({}); // shared-field errors
  const [rows, setRows] = useState([buildRow()]); // repeatable Machine Timing + Downtime entries
  const [rowErrors, setRowErrors] = useState([{}]); // one error object per row
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  // Which row is expanded in the Add/Edit modal — collapsed (-1) by default
  // for a new entry (keeps the fast path short), auto-opened on edit and
  // whenever a submit fails validation on a field hidden inside a row.
  const [openRowIndex, setOpenRowIndex] = useState(-1);
  // Sticky for the life of one modal session (not regenerated per submit
  // attempt) so a retry after a partial failure keeps every row in the same
  // batch instead of splintering into a second one. `originalBatchId` is the
  // edited entry's own batch link (if any), read once in openEdit, so that
  // adding rows during an edit rejoins its real siblings instead of
  // fragmenting them into a brand-new batch.
  const [batchId, setBatchId] = useState(null);
  const [originalBatchId, setOriginalBatchId] = useState(null);
  const [openFormula, setOpenFormula] = useState(null); // { key, label, formula, rect } | null
  // Collapsed by default — the 10 individual Downtime & Stoppage Reason
  // columns make the sheet very wide; collapsing them to one toggle column
  // is purely a display choice, the underlying data is unaffected.
  const [showStoppageDetails, setShowStoppageDetails] = useState(false);
  const [showRejectionDetails, setShowRejectionDetails] = useState(false);
  const [openRemark, setOpenRemark] = useState(null); // { id, text, rect } | null
  const [showEfficiency, setShowEfficiency] = useState(false);
  const [showShiftTimeReport, setShowShiftTimeReport] = useState(false);

  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);
  // Index of the in-form entry (row) pending removal confirmation — separate
  // from deleteId above, which confirms deleting an already-saved sheet row.
  const [deleteRowIndex, setDeleteRowIndex] = useState(null);

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

  // Expanding Downtime/Rejection detail columns shifts the sheet's
  // scrollable width; collapsing them back should return the horizontal
  // scroll to exactly where it was before expanding, not wherever it
  // happens to land once those columns disappear. Each toggle function
  // below stashes the scroll position at the moment it opens; the effects
  // restore it the moment the corresponding flag flips back to closed.
  const stoppageScrollLeftRef = React.useRef(0);
  const rejectionScrollLeftRef = React.useRef(0);

  const toggleStoppageDetails = () => {
    setShowStoppageDetails((prev) => {
      if (!prev) stoppageScrollLeftRef.current = tableContainerRef.current?.scrollLeft ?? 0;
      return !prev;
    });
  };
  const toggleRejectionDetails = () => {
    setShowRejectionDetails((prev) => {
      if (!prev) rejectionScrollLeftRef.current = tableContainerRef.current?.scrollLeft ?? 0;
      return !prev;
    });
  };

  useLayoutEffect(() => {
    if (showStoppageDetails) return;
    if (tableContainerRef.current) tableContainerRef.current.scrollLeft = stoppageScrollLeftRef.current;
    if (topScrollRef.current) topScrollRef.current.scrollLeft = stoppageScrollLeftRef.current;
  }, [showStoppageDetails]);

  useLayoutEffect(() => {
    if (showRejectionDetails) return;
    if (tableContainerRef.current) tableContainerRef.current.scrollLeft = rejectionScrollLeftRef.current;
    if (topScrollRef.current) topScrollRef.current.scrollLeft = rejectionScrollLeftRef.current;
  }, [showRejectionDetails]);

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
    setLastProcess(val);
    setValues((prev) => ({ ...prev, machine: "", shiftOnTime: "", shiftOffTime: "", lunchStartTime: "" }));
    // A different Process implies a different Machine list, which
    // invalidates whatever Size/Thickness rows were already filled in —
    // start over with a single blank row rather than leave stale data.
    setRows([buildRow()]);
    setRowErrors([{}]);
    setOpenRowIndex(-1);
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
        e.date ? fmtDate(e.date) : "",
        mName,
        e.operator?.name,
        e.mcStartTime,
        e.mcOffTime,
        e.sizeWidthMm != null && e.sizeHeightMm != null ? `${e.sizeWidthMm}x${e.sizeHeightMm}` : "",
        e.thicknessMm,
        e.standardTimePerPieceMin,
        e.processQty,
        e.okQty,
        e.rejectedQty,
        ...REJECTION_FIELDS.map((f) => e[f.key]),
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

  // Entries saved together from one multi-row "Add Entry" submission share a
  // batchId — group them back into one array so the sheet renders them as a
  // single row (with per-entry columns stacked) instead of separate rows.
  // Entries without a batchId (the common case) become their own group of 1.
  const groupedEntries = useMemo(() => {
    const groups = [];
    const byBatch = new Map();
    for (const e of filteredEntries) {
      if (e.batchId) {
        let group = byBatch.get(e.batchId);
        if (!group) { group = []; byBatch.set(e.batchId, group); groups.push(group); }
        group.push(e);
      } else {
        groups.push([e]);
      }
    }
    // The sheet fetches newest-first (createdAt desc), so a batch's entries
    // arrive in the reverse of the order they were typed — re-sort each
    // group oldest-first so Entry 1 stacks above Entry 2, matching the form.
    for (const group of groups) {
      if (group.length > 1) group.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }
    return groups;
  }, [filteredEntries]);

  // Alternating "day band" per row-group — every group sharing the same
  // Date gets the same band, and the band flips each time the Date changes,
  // so the sheet reads like a banded Google Sheets grid (zebra by day, not
  // by individual row) instead of a heavy divider line between days.
  const dayBandByGroupIdx = useMemo(() => {
    const dk = (e) => (typeof e.date === "string" ? e.date.split("T")[0] : new Date(e.date).toISOString().split("T")[0]);
    let band = 0;
    let prevDate = null;
    return groupedEntries.map((group) => {
      const d = dk(group[0]);
      if (prevDate !== null && d !== prevDate) band++;
      prevDate = d;
      return band;
    });
  }, [groupedEntries]);

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

  // Applies a partial patch (or updater function) to one row by index.
  const updateRow = (index, patch) => {
    setRows((prev) => prev.map((row, i) => (i !== index ? row : (typeof patch === "function" ? patch(row) : { ...row, ...patch }))));
  };

  const handleRowChange = (index, e) => {
    const { name, value } = e.target;
    updateRow(index, { [name]: value });
  };


  // Rejection Reasons share one budget: Production Qty − OK Qty. Each field
  // is clamped to whatever's left of that budget after every OTHER reason
  // field, so the running total can never exceed the difference — the user
  // simply can't type past it instead of finding out only after Save.
  const handleRejectionChange = (index, e) => {
    const { name, value } = e.target;
    updateRow(index, (row) => {
      const clearWarn = { ...row, [name]: value, __rejCapWarn: { ...row.__rejCapWarn, [name]: false } };
      if (value === "") return clearWarn;
      const diff = Number(row.processQty) - Number(row.okQty);
      if (!Number.isFinite(diff) || row.processQty === "" || row.okQty === "") return clearWarn;
      const othersSum = REJECTION_FIELDS.reduce((s, f) => (f.key === name ? s : s + (Number(row[f.key]) || 0)), 0);
      const maxAllowed = Math.max(0, diff - othersSum);
      const typed = Math.max(0, Math.trunc(Number(value) || 0));
      const clamped = Math.min(typed, maxAllowed);
      const isOverCap = typed > maxAllowed;
      // Only pop the toast on the rising edge (not already capped) — typing
      // further digits while still over the limit would otherwise fire it
      // again on every keystroke.
      if (isOverCap && !row.__rejCapWarn?.[name]) {
        const fieldLabel = REJECTION_FIELDS.find((f) => f.key === name)?.label || "This field";
        toast.error?.(`${fieldLabel} can't exceed ${maxAllowed} — that's all that's left of Production Qty − OK Qty after the other rejection reasons already entered.`);
      }
      return {
        ...row,
        [name]: String(clamped),
        __rejCapWarn: { ...row.__rejCapWarn, [name]: isOverCap },
      };
    });
  };

  const handleSizeChange = (index, e) => {
    const val = e.target.value;
    if (!val) {
      updateRow(index, { sizeWidthMm: "", sizeHeightMm: "", thicknessMm: "", standardTimePerPieceMin: "" });
      return;
    }
    const [w, h] = val.split("x");
    updateRow(index, { sizeWidthMm: w, sizeHeightMm: h, thicknessMm: "", standardTimePerPieceMin: "" });
  };

  // Standard Time always comes from the Standard Time Master, never typed —
  // resolved directly here (instead of a reactive effect) since it depends
  // on which row's Thickness changed.
  const handleThicknessChange = (index, e) => {
    const thicknessMm = e.target.value;
    updateRow(index, (row) => {
      const match = stdTimes.find(
        (s) =>
          String(s.sizeWidthMm) === String(row.sizeWidthMm) &&
          String(s.sizeHeightMm) === String(row.sizeHeightMm) &&
          String(s.thicknessMm) === String(thicknessMm),
      );
      return { ...row, thicknessMm, standardTimePerPieceMin: match ? String(match.standardTimeMin) : "" };
    });
  };

  // Thickness options for one row's already-selected Size.
  const getUniqueThicknesses = (row) => {
    if (!row.sizeWidthMm || !row.sizeHeightMm) return [];
    const opts = new Set(
      stdTimes.filter(
        (s) => String(s.sizeWidthMm) === String(row.sizeWidthMm) &&
               String(s.sizeHeightMm) === String(row.sizeHeightMm)
      ).map((s) => s.thicknessMm)
    );
    // Editing an older entry saved before manual thickness entry was removed
    // may reference a thickness no longer in the master list — keep it
    // selectable instead of silently dropping it from the dropdown.
    if (editId && row.thicknessMm) opts.add(row.thicknessMm);
    return [...opts].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  };

  // Re-syncs every row's Standard Time against the master list whenever it
  // (re)loads — covers the edit-open path, where a row's Size/Thickness/
  // Standard Time are all set immediately from the saved entry before
  // fetchStdTimes's async request has resolved, so nothing else would ever
  // correct a value that's since changed in the Standard Time Master.
  useEffect(() => {
    if (!stdTimes.length) return;
    setRows((prev) => prev.map((row) => {
      if (!row.sizeWidthMm || !row.sizeHeightMm || !row.thicknessMm) return row;
      const match = stdTimes.find((s) =>
        String(s.sizeWidthMm) === String(row.sizeWidthMm) &&
        String(s.sizeHeightMm) === String(row.sizeHeightMm) &&
        String(s.thicknessMm) === String(row.thicknessMm)
      );
      // No match means this Size/Thickness combo no longer has a Standard
      // Time in the master (e.g. removed since this entry was saved) — clear
      // it rather than keep showing a stale value as if it were still valid.
      const nextStd = match ? String(match.standardTimeMin) : "";
      return nextStd === row.standardTimePerPieceMin ? row : { ...row, standardTimePerPieceMin: nextStd };
    }));
  }, [stdTimes]);

  const addRow = () => {
    setRows((prev) => [...prev, buildRow()]);
    setRowErrors((prev) => [...prev, {}]);
    setOpenRowIndex(0); // keep Entry 1 open instead of jumping to the new row
  };

  const removeRow = (index) => {
    // This row may already be a real saved record — either the entry being
    // edited, or one created during an earlier partial-batch-save retry
    // (tracked via __entryId). Removing it from the form must also delete
    // it for real, or it silently survives in the database, invisible to
    // this session but still showing up in the sheet.
    const removedEntryId = rows[index]?.__entryId;
    if (removedEntryId) {
      deleteProductionEntry(removedEntryId)
        .then(() => fetchSheet())
        .catch(() => toast.error?.("Failed to remove the already-saved entry — it may still exist in the sheet."));
    }
    setRows((prev) => prev.filter((_, i) => i !== index));
    setRowErrors((prev) => prev.filter((_, i) => i !== index));
    setOpenRowIndex((prev) => (prev === index ? -1 : prev > index ? prev - 1 : prev));
  };

  const openModal = () => {
    // Pre-select whichever Process was last used, only if it still exists.
    const remembered = getLastProcess();
    const resolvedProcess = remembered && processes.some((p) => p._id === remembered) ? remembered : "";
    // Only pre-seed the Machine filter from the sheet's active-machine filter
    // if it actually belongs to the resolved Process — otherwise the Machine
    // <select> would show no matching option while `values.machine` still
    // silently held a value the user never visibly confirmed.
    const candidateMachine = activeMachine || "";
    const machineFitsProcess = !resolvedProcess || !candidateMachine || machines.some((m) =>
      m._id === candidateMachine && (m.processes || []).some((p) => (typeof p === "object" ? p._id : p) === resolvedProcess)
    );
    const initMachine = machineFitsProcess ? candidateMachine : "";
    setValues(buildSharedInit(initMachine));
    setRows([buildRow()]);
    setRowErrors([{}]);
    setOpenRowIndex(-1);
    setEditId(null);
    setBatchId(null);
    setOriginalBatchId(null);
    setFormErrors({});
    setSubmitted(false);
    setFormProcess(resolvedProcess);
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
      machine: machineId,
      operator: e.operator?._id || "",
      // The entry's own snapshot, not the machine's current config — if
      // the machine's Shift Time was changed since this entry was saved,
      // editing an unrelated field here must not silently pull in the new
      // schedule. Only falls back to the machine's live config for legacy
      // entries saved before snapshotting existed.
      shiftOnTime: e.shiftOnTime || machineObj?.machineOnTime || "",
      shiftOffTime: e.shiftOffTime || machineObj?.machineOffTime || "",
      lunchStartTime: e.lunchStartTime || machineObj?.lunchStartTime || "",
    });
    // Editing always starts from the single existing record as row 0 — any
    // further rows added from here are saved as brand-new entries, joining
    // this entry's existing batch (if any) rather than fragmenting it.
    setBatchId(e.batchId || null);
    setOriginalBatchId(e.batchId || null);
    setRows([{
      __entryId: e._id,
      mcStartTime: e.mcStartTime || "",
      mcOffTime: e.mcOffTime || "",
      additionalPeriods: Array.isArray(e.additionalPeriods)
        ? e.additionalPeriods.map((p) => ({ startTime: p.startTime || "", endTime: p.endTime || "" }))
        : [],
      sizeWidthMm: e.sizeWidthMm || "",
      sizeHeightMm: e.sizeHeightMm || "",
      thicknessMm: e.thicknessMm || "",
      standardTimePerPieceMin: e.standardTimePerPieceMin || "",
      processQty: e.processQty || "0",
      okQty: e.okQty || "0",
      othersRemark: e.othersRemark || "",
      ...Object.fromEntries(STOPPAGE_FIELDS.map((f) => [f.key, String(e[f.key] || "0")])),
      ...Object.fromEntries(REJECTION_FIELDS.map((f) => [f.key, String(e[f.key] || "0")])),
    }]);
    setRowErrors([{}]);
    setFormErrors({});
    setSubmitted(false);
    const firstProcess = machineObj?.processes?.[0];
    setFormProcess(firstProcess ? (typeof firstProcess === "object" ? firstProcess._id : firstProcess) : "");
    // Editing an existing entry already has these fields filled in, so show
    // them right away instead of hiding known-good data behind a "+".
    setOpenRowIndex(0);
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
        shiftOnTime: machineObj?.machineOnTime || "",
        shiftOffTime: machineObj?.machineOffTime || "",
        lunchStartTime: machineObj?.lunchStartTime || "",
      }));
      // A different Machine may not offer the same sizes — every row's
      // Size/Thickness/Standard Time (all machine-dependent) resets.
      setRows((prev) => prev.map((row) => ({ ...row, sizeWidthMm: "", sizeHeightMm: "", thicknessMm: "", standardTimePerPieceMin: "" })));
      fetchStdTimes(value);
    } else {
      setValues((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const shared = { ...values, process: formProcess };
    const sharedErrors = validateShared(shared);
    const perRowErrors = rows.map((row) => validateRow(row, values));

    // Cross-row check: two entries in the same submission can't claim
    // overlapping M/C time on the same Machine/Date — each row's own
    // validateRow only checks itself in isolation, so this can only run once
    // every row's own time fields are already individually valid.
    if (rows.length > 1) {
      for (let i = 0; i < rows.length; i++) {
        if (perRowErrors[i].mcStartTime || perRowErrors[i].mcOffTime || perRowErrors[i].additionalPeriods) continue;
        const periodsI = rowPeriods(rows[i]);
        for (let j = i + 1; j < rows.length; j++) {
          if (perRowErrors[j].mcStartTime || perRowErrors[j].mcOffTime || perRowErrors[j].additionalPeriods) continue;
          const periodsJ = rowPeriods(rows[j]);
          const overlaps = periodsI.some((pI) => periodsJ.some((pJ) => timeWindowsOverlap(pI.start, pI.end, pJ.start, pJ.end)));
          if (overlaps) {
            perRowErrors[i].mcOffTime = perRowErrors[i].mcOffTime || `Overlaps with Entry ${j + 1}'s M/C time — the same machine can't run two jobs at once.`;
            perRowErrors[j].mcOffTime = perRowErrors[j].mcOffTime || `Overlaps with Entry ${i + 1}'s M/C time — the same machine can't run two jobs at once.`;
          }
        }
      }
    }

    setFormErrors(sharedErrors);
    setRowErrors(perRowErrors);
    setSubmitted(true);

    const firstBadRow = perRowErrors.findIndex((e) => Object.keys(e).length > 0);
    if (firstBadRow !== -1) setOpenRowIndex(firstBadRow);

    const hasErrors = Object.keys(sharedErrors).length > 0 || firstBadRow !== -1;
    if (hasErrors) return;

    setSaving(true);
    // Sticky for this modal session — reused across a retry after a partial
    // failure so already-saved rows and newly-saved ones end up in the same
    // batch instead of splintering, and prefers the edited entry's own
    // existing batch (if any) so adding rows during an edit rejoins its real
    // siblings rather than fragmenting them into a new one. Only assigned at
    // all once there's actually more than one row.
    let effectiveBatchId = batchId;
    if (rows.length > 1 && !effectiveBatchId) {
      effectiveBatchId = originalBatchId || newBatchId();
      setBatchId(effectiveBatchId);
    }
    const buildPayload = (row) => {
      const { __entryId, __rejCapWarn, ...rowFields } = row;
      return {
        date: values.date,
        machine: values.machine,
        operator: values.operator,
        shiftOnTime: values.shiftOnTime,
        shiftOffTime: values.shiftOffTime,
        lunchStartTime: values.lunchStartTime,
        ...(effectiveBatchId ? { batchId: effectiveBatchId } : {}),
        ...rowFields,
      };
    };

    // Sequential, not Promise.all — each row becomes its own saved record via
    // the single-entry endpoint (there's no bulk-create API). A row that
    // already saved in a prior attempt carries __entryId (set the instant
    // its own request succeeds) and is UPDATED rather than re-created on a
    // retry, so fixing one failed row and resubmitting can never duplicate
    // the rows that already went through.
    (async () => {
      let savedCount = 0;
      let updatedExisting = false;
      let createdNew = 0;
      try {
        for (let i = 0; i < rows.length; i++) {
          const payload = buildPayload(rows[i]);
          const existingId = rows[i].__entryId;
          try {
            const res = existingId
              ? await updateProductionEntry(existingId, payload)
              : await createProductionEntry(payload);
            if (!existingId) {
              const newId = res.data?.data?._id;
              const idx = i;
              if (newId) setRows((prev) => prev.map((r, ri) => (ri === idx ? { ...r, __entryId: newId } : r)));
              createdNew++;
            } else {
              updatedExisting = true;
            }
            savedCount++;
          } catch (rowErr) {
            rowErr.rowIndex = i;
            throw rowErr;
          }
        }
        const message = updatedExisting
          ? (createdNew > 0 ? `Entry updated, ${createdNew} new ${createdNew === 1 ? "entry" : "entries"} saved!` : "Entry updated!")
          : `${savedCount} ${savedCount === 1 ? "entry" : "entries"} saved!`;
        toast.success?.(message);
        setShowModal(false);
        fetchSheet();
      } catch (err) {
        const failedIndex = err.rowIndex ?? rows.length - 1;
        const apiErrors = err.response?.data?.errors;
        if (apiErrors) setRowErrors((prev) => prev.map((re, ri) => (ri === failedIndex ? { ...re, ...apiErrors } : re)));
        setOpenRowIndex(failedIndex);
        toast.error?.(
          savedCount > 0
            ? `Saved ${savedCount} of ${rows.length} — stopped at Entry ${failedIndex + 1}: ${err.response?.data?.message || err.message}. Fix it and Save again — already-saved entries won't be duplicated.`
            : (err.response?.data?.message || `Failed to ${editId ? "update" : "save"} entry`)
        );
        if (savedCount > 0) fetchSheet();
      } finally {
        setSaving(false);
      }
    })();
  };

  // `showUnit` (default true) lets a grouped/stacked cell show its unit
  // ("min"/"qty") only on the first stacked line — every line below it (and
  // the Total line) shows the bare number, since the unit's already
  // established for that cell. Percentages (fmtRatioPct) are unaffected —
  // "%" stays on every line.
  const fmt = (n, unit = "", showUnit = true) => (n == null || isNaN(n) ? "NA" : `${Number(n).toFixed(2)}${unit && showUnit ? ` ${unit}` : ""}`);
  const fmtQty = (n, showUnit = true) => `${n}${showUnit ? " qty" : ""}`;
  const fmtRatioPct = (n) => (n == null || isNaN(n) ? "NA" : `${(Number(n) * 100).toFixed(2)}%`);
  const UNIT_BY_CALC_KEY = useMemo(() => Object.fromEntries(CALC_COLUMNS.map((c) => [c.key, c.unit])), []);
  const err = (name) => submitted && formErrors[name] ? formErrors[name] : null;
  const rowErr = (rowIndex, name) => submitted && rowErrors[rowIndex]?.[name] ? rowErrors[rowIndex][name] : null;

  return (
    <div className="w-full">
      {/* Header + Filters — one line on wide screens, wraps on narrow ones */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-3">
        <div className="flex flex-wrap items-end gap-3">
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

        <div className="flex items-center gap-3 shrink-0">
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
            <tr className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-left">
              <th className="sticky top-0 z-20 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Date</th>
              <th className="sticky top-0 z-20 bg-teal-50 dark:bg-teal-900/30 text-teal-800 dark:text-teal-300 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Machine</th>
              <th className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Size (mm)</th>
              <th className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Thickness (mm)</th>
              <th className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Std. Time (min)</th>
              <th className="sticky top-0 z-20 bg-fuchsia-50 dark:bg-fuchsia-900/30 text-fuchsia-800 dark:text-fuchsia-300 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Operator</th>
              <th className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">M/C Start</th>
              <th className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">M/C Off</th>
              <th className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Shift On</th>
              <th className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Shift Off</th>

              {/* Overtime / Start Delay / Early Closed (calculated, derived from Shift On/Off vs. M/C Start/Off) */}
              <CalcHeader label="Overtime (min)" formula={OVERTIME_FORMULA} colKey="overtimeMin" openKey={openFormula?.key} onToggle={toggleFormula} sticky="sticky top-0" extraClass="border-b" />
              <CalcHeader label="Start Delay / Early Closed (min)" formula={DELAY_EARLY_FORMULA} colKey="startDelayEarlyClosed" openKey={openFormula?.key} onToggle={toggleFormula} sticky="sticky top-0" extraClass="border-b" />

              <th className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Production Qty (Total Qty)</th>
              <th className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">OK Qty (qty)</th>
              <th className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">
                <button
                  type="button"
                  onClick={toggleRejectionDetails}
                  className="flex items-center gap-1 hover:text-brand-600 dark:hover:text-brand-400"
                  title={showRejectionDetails ? "Collapse Rejection Reasons" : "Expand Rejection Reasons"}
                >
                  <span className="flex items-center justify-center rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 shrink-0">
                    {showRejectionDetails ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </span>
                  Rejected Qty (qty)
                </button>
              </th>

              {/* Individual Rejection Reason fields (entered data) — collapsed
                  by default, same pattern as Total Stoppage's Downtime &
                  Stoppage Reasons breakdown. */}
              {showRejectionDetails && REJECTION_FIELDS.map((f, i) => (
                <th key={f.key} className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">
                  <span className="inline-flex items-center gap-1">
                    {f.label} (qty)
                    {i === REJECTION_FIELDS.length - 1 && (
                      <button
                        type="button"
                        onClick={() => setShowRejectionDetails(false)}
                        title="Collapse Rejection Reasons"
                        className="flex items-center justify-center rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 shrink-0"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                </th>
              ))}

              {/* Working Schedule Time (calculated) */}
              <CalcHeader label="Working Schedule Time (min)" formula={CALC_COLUMNS[0].formula} colKey={CALC_COLUMNS[0].key} openKey={openFormula?.key} onToggle={toggleFormula} sticky="sticky top-0" extraClass="border-b" />

              {/* Total Stoppage (expandable — its chevron reveals the
                  remaining 9 individual Downtime & Stoppage Reason fields
                  right after it; collapsed by default since 9 extra columns
                  make the sheet very wide), then Available Working Time,
                  Ideal Production, Effective Run, Unreported (calculated) */}
              {CALC_COLUMNS.slice(1, 6).map((c, i) => (
                <React.Fragment key={c.key}>
                  {/* Planned Downtime — always visible, pulled out of the
                      collapsed group. Lunch sits between it and Total
                      Stoppage (both feed into Total Stoppage's sum). */}
                  {i === 0 && (
                    <th className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">
                      {STOPPAGE_FIELDS[0].label}
                    </th>
                  )}
                  {i === 0 && (
                    <CalcHeader
                      label="Lunch (min)" formula={LUNCH_FORMULA} colKey="lunchMin" openKey={openFormula?.key} onToggle={toggleFormula}
                      sticky="sticky top-0" bg="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200" extraClass="border-b"
                    />
                  )}
                  <CalcHeader
                    label={c.label} formula={c.formula} colKey={c.key} openKey={openFormula?.key} onToggle={toggleFormula}
                    sticky="sticky top-0" extraClass="border-b"
                    expandable={i === 0} expanded={showStoppageDetails} onToggleExpand={toggleStoppageDetails}
                  />
                  {i === 0 && showStoppageDetails && STOPPAGE_FIELDS.slice(1).map((f) => (
                    <th key={f.key} className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">
                      {f.label}
                    </th>
                  ))}
                  {/* Remark — moved inside the collapsed Downtime & Stoppage
                      group, right after Others (Minutes). Now the true last
                      column of the group, so the collapse chevron lives here. */}
                  {i === 0 && showStoppageDetails && (
                    <th className="sticky top-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">
                      <span className="inline-flex items-center gap-1">
                        Remark
                        <button
                          type="button"
                          onClick={() => setShowStoppageDetails(false)}
                          title="Collapse Downtime & Stoppage Reasons"
                          className="flex items-center justify-center rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 shrink-0"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    </th>
                  )}
                </React.Fragment>
              ))}

              {/* Availability / Performance / Quality Ratios (calculated) */}
              {CALC_COLUMNS.slice(6).map((c) => (
                <CalcHeader key={c.key} label={c.label} formula={c.formula} colKey={c.key} openKey={openFormula?.key} onToggle={toggleFormula} sticky="sticky top-0" extraClass="border-b" />
              ))}

              {/* OEE % (calculated) — no longer sticky: the batch Total
                  columns below need to sit between it and Actions, which
                  its old "dock right next to Actions" sticky offset assumed
                  there was nothing else after it. */}
              <CalcHeader
                label="OEE %"
                formula={OEE_FORMULA}
                colKey="oeePercent"
                openKey={openFormula?.key}
                onToggle={toggleFormula}
                sticky="sticky top-0"
                bg="bg-blue-100 dark:bg-slate-800 text-brand-800 dark:text-brand-300"
                extraClass="border-l border-b w-[100px] min-w-[100px] max-w-[100px]"
              />

              {/* Batch Totals for Availability/Performance/Quality/OEE% —
                  one value per batch (blank for a standalone entry, since
                  there's nothing to total), shown as their own columns
                  rather than an extra stacked line inside the 4 columns
                  above. */}
              <th className="sticky top-0 z-20 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Daily Availability</th>
              <th className="sticky top-0 z-20 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Daily Performance</th>
              <th className="sticky top-0 z-20 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 px-3 py-2 font-semibold whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700">Daily Quality</th>
              {/* Daily OEE % — locked (sticky) against the right edge, right
                  next to Actions, so it stays visible no matter how far
                  right you scroll through the stoppage/rejection detail
                  columns. Needs a fully opaque background (no /alpha), same
                  reason as Actions — it overlaps scrolled-away cells. */}
              <th className="sticky top-0 right-[90px] z-30 bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-200 px-3 py-2 font-bold whitespace-nowrap border-l border-r border-b border-slate-300 dark:border-slate-700 shadow-[-4px_0_10px_rgba(0,0,0,0.05)]">Daily OEE %</th>

              {/* Actions */}
              <th className="sticky top-0 right-0 z-30 bg-slate-200 dark:bg-slate-800 px-3 py-2 font-semibold whitespace-nowrap border-b border-l border-slate-300 dark:border-slate-700 text-right shadow-[-4px_0_10px_rgba(0,0,0,0.05)] w-[90px] min-w-[90px] max-w-[90px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 && (
              <tr><td colSpan={14 + 1 + 1 + (showStoppageDetails ? STOPPAGE_FIELDS.length : 0) + (showRejectionDetails ? REJECTION_FIELDS.length : 0) + 1 + 5 + 4 + 4} className="px-4 py-10 text-center text-slate-500 font-medium">
                {loadingSheet ? "Loading…" : sheetSearch ? "No entries match your search." : "No entries for this machine yet."}
              </td></tr>
            )}
            {groupedEntries.map((group, groupIdx) => {
              const first = group[0];
              const mName = typeof first.machine === "object" ? first.machine?.machineName : machines.find(m => m._id === first.machine)?.machineName;
              // Zebra-by-day: every row-group belonging to the same Date
              // shares one background tint, flipping as the Date changes —
              // a faint indigo wash (echoing the Date column's own accent)
              // instead of flat gray, so the banding reads as a deliberate
              // design choice rather than a plain zebra stripe.
              const isEvenDay = (dayBandByGroupIdx[groupIdx] ?? 0) % 2 === 0;
              const plainBg = isEvenDay ? "bg-white dark:bg-[#1a1a1a]" : "bg-indigo-100/60 dark:bg-indigo-950/35";
              // Fully opaque version of plainBg (no /60, /35 alpha) — only
              // for the sticky Actions column. That column stays pinned
              // while the row scrolls horizontally underneath it, so a
              // translucent background let the scrolled-away cells' text
              // show through; this doesn't have that problem since nothing
              // needs to blend with what's behind it.
              const plainBgSolid = isEvenDay ? "bg-white dark:bg-[#1a1a1a]" : "bg-indigo-100 dark:bg-indigo-950";
              // Only the last 4 columns (Availability/Performance/Quality
              // Ratio, OEE %) show a Total, and it's a WHOLE-DAY total, not
              // just this one batch — every entry for this same Machine on
              // this same Date, regardless of which "Add Entry" submission
              // (batchId) it came from. Every row-group sharing that
              // Machine+Date shows the identical day total, not its own
              // batch's total. computeBatchCalculations recomputes the TRUE combined
              // total fresh from the raw rows (summing per-row values
              // directly would double-count the shared shift envelope for
              // Working Schedule/Available Working/Effective Run Time, and
              // sum ratios/percentages into meaningless totals) — the same
              // function the Efficiency Report/Dashboard use, so these 4
              // totals always agree with those.
              const batchShiftOnTime = first.shiftOnTime || (typeof first.machine === "object" ? first.machine?.machineOnTime : null);
              const batchShiftOffTime = first.shiftOffTime || (typeof first.machine === "object" ? first.machine?.machineOffTime : null);
              const dateKey = (e) => (typeof e.date === "string" ? e.date.split("T")[0] : new Date(e.date).toISOString().split("T")[0]);
              const machineIdOf = (e) => String(typeof e.machine === "object" ? e.machine?._id : e.machine);
              const dayRows = entries.filter((e) => dateKey(e) === dateKey(first) && machineIdOf(e) === machineIdOf(first));
              const hasDayTotal = dayRows.length > 1;
              const dayCalc = hasDayTotal ? computeBatchCalculations(dayRows, batchShiftOnTime, batchShiftOffTime) : null;
              const availabilityRatioTotal = dayCalc?.availabilityRatio;
              const performanceRatioTotal = dayCalc?.performanceRatio;
              const qualityRatioTotal = dayCalc?.qualityRatio;
              const oeeTotal = dayCalc?.oeePercent;
              return (
              <tr key={group.map((e) => e._id).join("-")} className="border-b border-slate-300 dark:border-slate-700">
                {/* Shared across the whole batch — Date/Machine/Operator/Shift are picked once per submission */}
                <td className="bg-indigo-50/60 dark:bg-indigo-900/15 px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-indigo-800 dark:text-indigo-300 font-medium">{fmtDate(first.date)}</td>
                <td className="bg-teal-50/60 dark:bg-teal-900/15 px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-teal-800 dark:text-teal-300 font-medium">{mName || "—"}</td>
                <StackedCell className={`${plainBg} px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200`} items={group.map((e) => `${e.sizeWidthMm}×${e.sizeHeightMm}`)} />
                <StackedCell className={`${plainBg} px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200`} items={group.map((e) => `${e.thicknessMm}`)} />
                <StackedCell className={`${plainBg} px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200`} items={group.map((e) =>fmt(e.standardTimePerPieceMin, "min", false))} />
                <td className="bg-fuchsia-50/60 dark:bg-fuchsia-900/15 px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-fuchsia-800 dark:text-fuchsia-300 font-medium">{first.operator?.name || "—"}</td>
                {/* M/C Start / M/C Off — one per entry in the batch */}
                <StackedCell className={`${plainBg} px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 font-mono text-xs`} items={group.map((e) => e.mcStartTime || "—")} />
                <StackedCell className={`${plainBg} px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 font-mono text-xs`} items={group.map((e) => e.mcOffTime || "—")} />

                <td className={`${plainBg} px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 font-mono text-xs text-slate-500 dark:text-slate-400`}>{first.shiftOnTime || (typeof first.machine === "object" ? first.machine?.machineOnTime : null) || "—"}</td>
                <td className={`${plainBg} px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 font-mono text-xs text-slate-500 dark:text-slate-400`}>{first.shiftOffTime || (typeof first.machine === "object" ? first.machine?.machineOffTime : null) || "—"}</td>

                {/* Overtime / Start Delay / Early Closed */}
                <StackedCell className="px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium" items={group.map((e) => fmtMin((e.calculated || {}).overtimeMin, false))} />
                <StackedCell className="px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium" items={group.map((e) => fmtDelayOrEarly((e.calculated || {}).startDelayMin, (e.calculated || {}).earlyClosedMin, false))} />

                <StackedCell className={`${plainBg} px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200`} items={group.map((e) => fmtQty(e.processQty, false))} />
                <StackedCell className={`${plainBg} px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200`} items={group.map((e) => fmtQty(e.okQty, false))} />
                <StackedCell className={`${plainBg} px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-red-500 font-bold`} items={group.map((e) => fmtQty(e.rejectedQty, false))} />

                {/* Individual Rejection Reason values — collapsed by default */}
                {showRejectionDetails && REJECTION_FIELDS.map((f) => (
                  <StackedCell key={f.key} className={`${plainBg} px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200`} items={
                    group.map((e) => fmtQty(e[f.key] || 0, false))
                  } />
                ))}

                {/* Working Schedule Time */}
                <StackedCell className="px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium" items={group.map((e) => fmt((e.calculated || {}).workingScheduleMin, UNIT_BY_CALC_KEY.workingScheduleMin, false))} />

                {/* Planned Downtime — always visible, pulled out of the
                    collapsed group. Lunch sits between it and Total
                    Stoppage (both feed into Total Stoppage's sum). */}
                <StackedCell className={`${plainBg} px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200`} items={
                  group.map((e) => fmt(e[STOPPAGE_FIELDS[0].key], "min", false))
                } />
                {/* Lunch — 60 or 0, see LUNCH_FORMULA. Already folded into
                    Total Stoppage; shown separately just for visibility. */}
                <StackedCell className={`${plainBg} px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200`} items={
                  group.map((e) => fmt((e.calculated || {}).lunchMin, "min", false))
                } />
                {/* Total Stoppage — collapsed shows the calculated total
                    (includes Planned Downtime, since 2026-09-05); the
                    chevron on its header expands the remaining 9 individual
                    entered reason fields right after it. */}
                <StackedCell className="px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium" items={group.map((e) => fmt((e.calculated || {}).totalStoppageMin, UNIT_BY_CALC_KEY.totalStoppageMin, false))} />
                {showStoppageDetails && STOPPAGE_FIELDS.slice(1).map((f) => (
                  <StackedCell key={f.key} className={`${plainBg} px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200`} items={
                    group.map((e) => fmt(e[f.key], "min", false))
                  } />
                ))}
                {/* Remark — moved inside the collapsed Downtime & Stoppage
                    group, right after Others (Minutes). "eye" opens a
                    popover with the Others-downtime note. */}
                {showStoppageDetails && (
                  <StackedCell className={`${plainBg} px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 text-center`} items={group.map((e) => (
                    <button
                      key={e._id}
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
                  ))} />
                )}

                {/* Available Working Time */}
                <StackedCell className="px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium" items={group.map((e) => fmt((e.calculated || {}).availableWorkingMin, UNIT_BY_CALC_KEY.availableWorkingMin, false))} />
                {/* Ideal Production */}
                <StackedCell className="px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium" items={group.map((e) => fmt((e.calculated || {}).idealProductionQty, UNIT_BY_CALC_KEY.idealProductionQty, false))} />
                {/* Effective M/C Run Time */}
                <StackedCell className="px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium" items={group.map((e) => fmt((e.calculated || {}).effectiveMcRunTimeMin, UNIT_BY_CALC_KEY.effectiveMcRunTimeMin, false))} />
                {/* Unreported Time */}
                <StackedCell className="px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium" items={group.map((e) => fmt((e.calculated || {}).unreportedTimeMin, UNIT_BY_CALC_KEY.unreportedTimeMin, false))} />

                {/* Availability / Performance / Quality Ratios */}
                <StackedCell className="px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium" items={group.map((e) => fmtRatioPct((e.calculated || {}).availabilityRatio))} />
                <StackedCell className="px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium" items={group.map((e) => fmtRatioPct((e.calculated || {}).performanceRatio))} />
                <StackedCell className="px-3 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 font-medium" items={group.map((e) => fmtRatioPct((e.calculated || {}).qualityRatio))} />

                {/* OEE % */}
                <StackedCell
                  className="px-3 whitespace-nowrap border-l border-b border-slate-300 dark:border-slate-700 bg-blue-50 dark:bg-slate-900 font-bold text-brand-700 dark:text-brand-300 w-[110px] min-w-[110px] max-w-[110px]"
                  items={group.map((e) => {
                    const c = e.calculated || {};
                    return <React.Fragment key={e._id}>{fmt(c.oeePercent)}{c.oeePercent == null || isNaN(c.oeePercent) ? "" : "%"}</React.Fragment>;
                  })}
                />

                {/* Whole-Day Totals — every entry for this Machine on this
                    Date, not just this one batch (blank when this is the
                    only entry that Machine has that Date). */}
                <td className="align-middle text-center px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-blue-50/70 dark:bg-blue-900/15 text-blue-800 dark:text-blue-300 font-medium">{hasDayTotal ? fmtRatioPct(availabilityRatioTotal) : "—"}</td>
                <td className="align-middle text-center px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-blue-50/70 dark:bg-blue-900/15 text-blue-800 dark:text-blue-300 font-medium">{hasDayTotal ? fmtRatioPct(performanceRatioTotal) : "—"}</td>
                <td className="align-middle text-center px-3 py-2 whitespace-nowrap border-r border-b border-slate-300 dark:border-slate-700 bg-blue-50/70 dark:bg-blue-900/15 text-blue-800 dark:text-blue-300 font-medium">{hasDayTotal ? fmtRatioPct(qualityRatioTotal) : "—"}</td>
                <td className="sticky right-[90px] z-10 align-middle text-center px-3 py-2 whitespace-nowrap border-l border-r border-b border-slate-300 dark:border-slate-700 bg-blue-100 dark:bg-blue-900 font-bold text-blue-900 dark:text-blue-200 shadow-[-4px_0_10px_rgba(0,0,0,0.05)]">{hasDayTotal ? `${fmt(oeeTotal)}%` : "—"}</td>

                <StackedCell
                  className={`sticky right-0 z-10 w-[90px] px-3 whitespace-nowrap border-l border-b border-slate-300 dark:border-slate-700 ${plainBgSolid} shadow-[-4px_0_10px_rgba(0,0,0,0.05)]`}
                  items={group.map((e) => {
                    const editable = isEntryEditable(parseLocalDate(e.date), new Date(), 2, holidaySet, weeklyOffDays);
                    return (
                      <div key={e._id} className="flex justify-end gap-2">
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
                    );
                  })}
                />
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
            {/* Grouped multi-entry submissions render as one row, so the
                visible row count can be lower than the document range above
                — call that out instead of leaving it looking like a mismatch. */}
            {groupedEntries.length < entries.length && (
              <span className="text-slate-400"> ({groupedEntries.length} rows shown — some are grouped multi-entry submissions)</span>
            )}
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

              {/* ── Line 1: Process (auto-selected) + M/C Name ── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Process <span className="text-red-500">*</span></label>
                  <select value={formProcess} onChange={handleProcessSelect} className={cls(err("process"))}>
                    <option value="">Select Process</option>
                    {processes.map((p) => <option key={p._id} value={p._id}>{p.processName}</option>)}
                  </select>
                  {err("process") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{err("process")}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">M/C Name <span className="text-red-500">*</span></label>
                  <select name="machine" value={values.machine} onChange={handleChange} disabled={!formProcess} className={cls(err("machine"))}>
                    <option value="">{formProcess ? "Select Machine" : "Select process first"}</option>
                    {formMachines.map((m) => <option key={m._id} value={m._id}>{m.machineName}</option>)}
                  </select>
                  {err("machine") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{err("machine")}</p>}
                </div>
              </div>

              {/* ── Line 2: Date + Operator ── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
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
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Operator <span className="text-red-500">*</span></label>
                  <select name="operator" value={values.operator} onChange={handleChange} className={cls(err("operator"))}>
                    <option value="">Select Operator</option>
                    {operators.map((op) => <option key={op._id} value={op._id}>{op.name}</option>)}
                  </select>
                  {err("operator") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{err("operator")}</p>}
                </div>
              </div>

              {/* Shift On/Off Time is intentionally not shown here — it's
                  auto-filled from the selected Machine's own Shift Time
                  Start/End (see handleChange's "machine" branch) and still
                  saved with every entry for the OEE snapshot; it's just not
                  a visible/editable field in this form. ── */}

              {/* ── Repeatable entries: each pairs Machine Timing/Size/Qty with
                  its own Downtime & Stoppage Reasons — one saved record per
                  entry. Only one entry is expanded at a time. ── */}
              {rows.map((row, idx) => {
                const isOpen = openRowIndex === idx;
                const thicknesses = getUniqueThicknesses(row);
                const rowHasErrors = submitted && Object.keys(rowErrors[idx] || {}).length > 0;
                const rErr = (name) => rowErr(idx, name);
                const rejectionDiff = Number(row.processQty) - Number(row.okQty);
                const rejectionHasBudget = row.processQty !== "" && row.okQty !== "" && Number.isFinite(rejectionDiff);
                const rejectionUsed = REJECTION_FIELDS.reduce((s, f) => s + (Number(row[f.key]) || 0), 0);
                return (
                  <div key={idx} className={`${idx > 0 ? "border-t-2 border-slate-300 dark:border-slate-600 pt-2.5" : "pt-2.5"}`}>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setOpenRowIndex(isOpen ? -1 : idx)}
                        className="flex-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white uppercase tracking-wider text-left"
                      >
                        {isOpen ? <Minus className="w-3.5 h-3.5 shrink-0" /> : <Plus className="w-3.5 h-3.5 shrink-0" />}
                        {rows.length > 1 ? `Entry ${idx + 1}` : "Machine Timing, Size & Quantities"}
                        {rowHasErrors ? (
                          <span className="text-red-500 normal-case tracking-normal font-medium">— please review</span>
                        ) : (
                          !isOpen && row.sizeWidthMm && row.sizeHeightMm && (
                            <span className="text-brand-600 dark:text-brand-400 normal-case tracking-normal font-semibold text-xs">
                              — {row.sizeWidthMm}×{row.sizeHeightMm} mm{row.thicknessMm ? `, ${row.thicknessMm} mm` : ""}
                            </span>
                          )
                        )}
                      </button>
                      {rows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setDeleteRowIndex(idx)}
                          title="Remove this entry"
                          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-600 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {isOpen && (
                      <div className="space-y-2 mt-2">

                        {/* M/C Start/Off Time */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">M/C Start Time <span className="text-red-500">*</span></label>
                            <TimePicker
                              name="mcStartTime"
                              value={row.mcStartTime}
                              onChange={(e) => handleRowChange(idx, e)}
                              hasError={!!rErr("mcStartTime")}
                              placeholder="--:--"
                            />
                            {rErr("mcStartTime") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{rErr("mcStartTime")}</p>}
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">M/C Off Time <span className="text-red-500">*</span></label>
                            <TimePicker
                              name="mcOffTime"
                              value={row.mcOffTime}
                              onChange={(e) => handleRowChange(idx, e)}
                              hasError={!!rErr("mcOffTime")}
                              placeholder="--:--"
                              minTime={row.mcStartTime || undefined}
                            />
                            {rErr("mcOffTime") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{rErr("mcOffTime")}</p>}
                          </div>
                        </div>

                        {/* Size & Thickness */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Size (mm) <span className="text-red-500">*</span></label>
                            <select
                              value={(row.sizeWidthMm && row.sizeHeightMm) ? `${row.sizeWidthMm}x${row.sizeHeightMm}` : ""}
                              onChange={(e) => handleSizeChange(idx, e)}
                              disabled={!values.machine || uniqueSizes.length === 0}
                              className={cls(rErr("sizeWidthMm") || rErr("sizeHeightMm"))}
                            >
                              <option value="">{uniqueSizes.length === 0 ? "— No sizes for this machine —" : "Select Size"}</option>
                              {uniqueSizes.map((size) => <option key={size} value={size}>{size.replace('x', ' × ')} mm</option>)}
                            </select>
                            {(rErr("sizeWidthMm") || rErr("sizeHeightMm")) && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">Size is required</p>}
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Thickness (mm) <span className="text-red-500">*</span></label>
                            <select name="thicknessMm" value={row.thicknessMm} onChange={(e) => handleThicknessChange(idx, e)}
                              disabled={!row.sizeWidthMm || !row.sizeHeightMm} className={cls(rErr("thicknessMm"))}>
                              <option value="">{(!row.sizeWidthMm || !row.sizeHeightMm) ? "Select size first" : "Select Thickness"}</option>
                              {thicknesses.map((t) => <option key={t} value={t}>{t} mm</option>)}
                            </select>
                            {rErr("thicknessMm") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{rErr("thicknessMm")}</p>}
                          </div>
                        </div>

                        {/* Production / OK / Rejected Qty — compact 3-across row */}
                        <div className="grid grid-cols-3 gap-x-2">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">
                              Production Qty <span className="text-red-500">*</span>
                            </label>
                            <input type="number" name="processQty" value={row.processQty} onChange={(e) => handleRowChange(idx, e)} onWheel={(e) => e.target.blur()} ref={noWheelChange}
                              onInput={(e) => e.target.value = e.target.value.slice(0, 30)}
                              min={1} step={1} className={cls(rErr("processQty")) + " !px-2 !py-1.5 text-xs"} placeholder="Qty" />
                            {rErr("processQty") && !rErr("processQty").startsWith("Not achievable") && (
                              <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{rErr("processQty")}</p>
                            )}
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">
                              OK Qty <span className="text-red-500">*</span>
                            </label>
                            <input type="number" name="okQty" value={row.okQty} onChange={(e) => handleRowChange(idx, e)} onWheel={(e) => e.target.blur()} ref={noWheelChange}
                              onInput={(e) => e.target.value = e.target.value.slice(0, 30)}
                              min={0} step={1} className={cls(rErr("okQty")) + " !px-2 !py-1.5 text-xs"} placeholder="Qty" />
                            {rErr("okQty") && <p className="text-[10px] text-red-500 mt-0.5 leading-tight">{rErr("okQty")}</p>}
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Rejected Qty</label>
                            <input
                              type="text"
                              readOnly
                              value={REJECTION_FIELDS.reduce((s, f) => s + (Number(row[f.key]) || 0), 0)}
                              className="w-full border border-slate-200 bg-slate-50 rounded-lg px-2 py-1.5 text-xs text-slate-600 dark:text-slate-300 outline-none cursor-default"
                            />
                          </div>
                        </div>

                        {/* Capacity ("Not achievable") error — rendered as a prominent full-width
                            alert instead of the tiny inline field message, since missing this one
                            is the difference between a save that silently fails and one that doesn't. */}
                        {rErr("processQty") && rErr("processQty").startsWith("Not achievable") && (
                          <div className="flex items-start gap-2 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5">
                            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                            <p className="text-xs sm:text-sm font-semibold text-red-700 dark:text-red-300 leading-snug">{rErr("processQty")}</p>
                          </div>
                        )}

                        {/* Rejection Reasons — paired 1:1 with this entry, sums into the
                            read-only Rejected Qty above (mirrors Downtime & Stoppage Reasons) */}
                        <div className="pt-1">
                          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                            Rejection Reasons
                            {rejectionHasBudget && (
                              <span className="ml-1.5 normal-case tracking-normal font-normal text-slate-400">
                                — {rejectionUsed} of {Math.max(0, rejectionDiff)} used
                              </span>
                            )}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                            {rejectionFields.map((f) => {
                              const otherUsed = rejectionUsed - (Number(row[f.key]) || 0);
                              const fieldMax = rejectionHasBudget ? Math.max(0, rejectionDiff - otherUsed) : undefined;
                              const capHit = !!row.__rejCapWarn?.[f.key];
                              return (
                                <div key={f.key}>
                                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">{f.label}</label>
                                  <input type="number" name={f.key} value={row[f.key]} onChange={(e) => handleRejectionChange(idx, e)} onWheel={(e) => e.target.blur()} ref={noWheelChange}
                                    onInput={(e) => e.target.value = e.target.value.slice(0, 30)}
                                    min={0} max={fieldMax} step={1} className={cls(rErr(f.key) || capHit)} />
                                  {rErr(f.key) && <p className="text-[10px] text-red-500 mt-0.5">{rErr(f.key)}</p>}
                                  {!rErr(f.key) && capHit && (
                                    <p className="text-[10px] text-red-500 mt-0.5">Limit reached — only {fieldMax} left of the Production − OK Qty difference</p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {rErr("rejectionTotal") && (
                            <div className="flex items-start gap-2 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 mt-2">
                              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                              <p className="text-xs sm:text-sm font-semibold text-red-700 dark:text-red-300 leading-snug">{rErr("rejectionTotal")}</p>
                            </div>
                          )}
                        </div>

                        {/* Downtime & Stoppage Reasons — paired 1:1 with this entry */}
                        <div className="pt-1">
                          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Downtime &amp; Stoppage Reasons</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                            {stoppageFields.map((f) => (
                              <React.Fragment key={f.key}>
                                <div>
                                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">{f.label}</label>
                                  <input type="number" name={f.key} value={row[f.key]} onChange={(e) => handleRowChange(idx, e)} onWheel={(e) => e.target.blur()} ref={noWheelChange}
                                    min={0} max={1440} step={1} className={cls(rErr(f.key))} />
                                  {rErr(f.key) && <p className="text-[10px] text-red-500 mt-0.5">{rErr(f.key)}</p>}
                                </div>
                                {f.key === "othersMin" && (
                                  <div className="sm:col-span-2">
                                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">
                                      Remarks {Number(row.othersMin) > 0 && <span className="text-red-500">*</span>}
                                    </label>
                                    <textarea
                                      name="othersRemark"
                                      value={row.othersRemark}
                                      onChange={(e) => handleRowChange(idx, e)}
                                      maxLength={300}
                                      rows={2}
                                      placeholder="Describe the reason for Others downtime"
                                      className={cls(rErr("othersRemark")) + " resize-none"}
                                    />
                                    {rErr("othersRemark") && <p className="text-[10px] text-red-500 mt-0.5">{rErr("othersRemark")}</p>}
                                  </div>
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>

                        {/* Admin-added fields (Form Builder). Grouped by the
                            section the admin put them in; values ride along
                            in buildPayload's ...rowFields spread. */}
                        {customFields.length > 0 && (
                          <div className="pt-1">
                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                              Additional Fields
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                              {customFields.map((f) => (
                                <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
                                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">
                                    {f.label} {f.isRequired && <span className="text-red-500">*</span>}
                                    {f.isStoppageReason && (
                                      <span className="ml-1 text-[10px] font-normal text-orange-500">(counts as stoppage)</span>
                                    )}
                                  </label>
                                  {f.type === "textarea" ? (
                                    <textarea
                                      name={f.key}
                                      value={row[f.key] ?? ""}
                                      onChange={(e) => handleRowChange(idx, e)}
                                      rows={2}
                                      maxLength={500}
                                      className={cls(rErr(f.key)) + " resize-none"}
                                    />
                                  ) : (
                                    <input
                                      type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "time" ? "time" : "text"}
                                      name={f.key}
                                      value={row[f.key] ?? ""}
                                      onChange={(e) => handleRowChange(idx, e)}
                                      onWheel={f.type === "number" ? (e) => e.target.blur() : undefined}
                                      {...(f.type === "number" ? { min: 0, ...(f.isStoppageReason ? { max: 1440 } : {}), step: 1 } : {})}
                                      className={cls(rErr(f.key))}
                                    />
                                  )}
                                  {rErr(f.key) && <p className="text-[10px] text-red-500 mt-0.5">{rErr(f.key)}</p>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                );
              })}

              {/* ── Add another Machine Timing + Downtime entry ── */}
              <button
                type="button"
                onClick={addRow}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-brand-600 hover:border-brand-400 text-xs font-semibold py-2 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Another Entry
              </button>

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
                  ) : (rows.length > 1 ? `Save ${rows.length} Entries` : "Save Entry")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <DeleteModal show={!!deleteId} toggle={() => setDeleteId(null)}
        handleDelete={handleDelete} disabled={isDeleteLoading} />

      <DeleteModal show={deleteRowIndex !== null} toggle={() => setDeleteRowIndex(null)}
        handleDelete={() => { removeRow(deleteRowIndex); setDeleteRowIndex(null); }} disabled={false} />

      {showEfficiency && <EfficiencyModal onClose={() => setShowEfficiency(false)} />}
      {showShiftTimeReport && <ShiftTimeReportModal onClose={() => setShowShiftTimeReport(false)} />}
    </div>
  );
};

export default GrindingEntry;
