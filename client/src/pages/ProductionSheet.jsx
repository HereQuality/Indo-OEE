import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { MenuContext } from "../context/MenuContext";
import { useAlert } from "../context/AlertContext";
import { useMachines } from "../hooks/useMachines";
import { useItems } from "../hooks/useItems";
import { getOperatorNames, getProductionSheet, saveProductionRow } from "../api/productionSheet.api";
import {
  CYCLE_OPS,
  SLOTS_PER_DAY,
  STOPPAGE_FIELDS,
  WORKING_STATUSES,
  dayCalc,
  daysOfMonth,
  displayDay,
  fmtNum,
  fmtPct,
  isSunday,
  isoDay,
  normalizeTime,
  rowCalc,
  rowKey,
} from "../utils/productionSheet";

/**
 * Production Data Entry — the Indo "Section Wise Eff. (CNC)" Excel sheet as
 * an editable grid. Every date gets three rows per active machine; Date and
 * M.C. No. are locked (and frozen on the left), everything else is typed in
 * place and autosaved per row. Formulas live in utils/productionSheet.js.
 */

const SAVE_DELAY_MS = 700;

const HEAD = {
  locked: "bg-slate-300 text-slate-800",
  details: "bg-slate-200 text-slate-800",
  cycle: "bg-emerald-100 text-emerald-900",
  time: "bg-sky-200 text-sky-900",
  calc: "bg-blue-50 text-blue-900",
  qty: "bg-amber-300 text-amber-950",
  operatorShift: "bg-pink-100 text-pink-900",
  stoppage: "bg-yellow-200 text-yellow-900",
  effective: "bg-slate-300 text-slate-800",
  remarks: "bg-rose-100 text-rose-900",
};

// Column order = Excel order. kind: input | calc | day (merged across the
// machine's three rows for that date).
const COLUMNS = [
  { key: "operator", label: "Operator", group: "details", kind: "input", type: "operator", width: 110, head: HEAD.details },
  { key: "workingStatus", label: "Working Status", group: "details", kind: "input", type: "status", width: 140, head: HEAD.details },
  { key: "itemName", label: "Item Name", group: "details", kind: "input", type: "item", width: 230, head: HEAD.details },
  { key: "drawingNo", label: "Drawing No.", group: "details", kind: "input", type: "text", width: 100, head: HEAD.details },
  { key: "setupNo", label: "Setup No.", group: "details", kind: "input", type: "text", width: 80, head: HEAD.details },
  ...Array.from({ length: CYCLE_OPS }, (_, i) => ({
    key: `op${i}`, label: `Op ${i + 1}`, group: "cycle", kind: "input", type: "number", width: 54, head: HEAD.cycle, opIndex: i,
  })),
  { key: "totalCycleSec", label: "Total cycle time (sec)", group: "cycle", kind: "calc", width: 78, head: HEAD.cycle,
    value: (c) => fmtNum(c.totalCycleSec), formula: "Op 1 + Op 2 + Op 3 + Op 4 + Op 5" },
  { key: "machineOnTime", label: "Machine ON Time", group: "time", kind: "input", type: "time", width: 96, head: HEAD.time },
  { key: "machineOffTime", label: "Machine OFF Time", group: "time", kind: "input", type: "time", width: 96, head: HEAD.time },
  { key: "settingOnTime", label: "Setting ON Time", group: "time", kind: "input", type: "time", width: 96, head: HEAD.time },
  { key: "settingOffTime", label: "Setting OFF Time", group: "time", kind: "input", type: "time", width: 96, head: HEAD.time },
  { key: "shiftHours", label: "Machine Shift Time (Hours)", group: "time", kind: "calc", width: 84, head: HEAD.calc,
    value: (c) => fmtNum(c.shiftHours), formula: "Machine OFF Time − Machine ON Time" },
  { key: "idealQty", label: "Ideal Quantity", group: "time", kind: "calc", width: 84, head: HEAD.calc,
    value: (c) => fmtNum(c.idealQty), formula: "Machine Shift Time (h) × 3600 ÷ Total cycle time (sec)" },
  { key: "idealQtyPerHour", label: "Ideal Quantity/Hours", group: "time", kind: "calc", width: 84, head: HEAD.calc,
    value: (c) => fmtNum(c.idealQtyPerHour), formula: "3600 ÷ Total cycle time (sec)" },
  { key: "okQty", label: "Actual OK Quantity", group: "time", kind: "input", type: "number", width: 76, head: HEAD.qty },
  { key: "rejectedQty", label: "Rejected Quantity", group: "time", kind: "input", type: "number", width: 76, head: HEAD.qty },
  { key: "pctOk", label: "% OK Quantity", group: "time", kind: "calc", width: 80, head: HEAD.calc,
    value: (c) => fmtPct(c.pctOk), formula: "Actual OK ÷ (Actual OK + Rejected)" },
  { key: "plannedOperatorShiftHours", label: "Planned Operator Shift Time", group: "time", kind: "input", type: "number", width: 84, head: HEAD.operatorShift },
  { key: "unutilized", label: "Unutilized Machine Time", group: "time", kind: "calc", width: 84, head: HEAD.calc,
    value: () => "", formula: "Formula to be confirmed — not calculated yet" },
  ...STOPPAGE_FIELDS.map((f) => ({ key: f.key, label: f.label, group: "stoppage", kind: "input", type: "number", width: 78, head: HEAD.stoppage })),
  { key: "totalStoppageMin", label: "Total Stoppage (min)", group: "stoppage", kind: "calc", width: 80, head: HEAD.calc,
    value: (c) => fmtNum(c.totalStoppageMin), formula: "Sum of all ten stoppage columns" },
  { key: "effectiveHours", label: "Effective Machine Run Time (hours)", group: "results", kind: "calc", width: 96, head: HEAD.effective,
    value: (c) => fmtNum(c.effectiveHours), formula: "Actual OK Quantity × Total cycle time (sec) ÷ 3600" },
  { key: "unreportedMin", label: "Unreported Time (min)", group: "results", kind: "day", width: 84, head: HEAD.calc,
    value: (d) => fmtNum(d.unreportedMin), formula: "Per machine per day: Shift − Total Stoppage − Effective Run Time (minutes)" },
  { key: "setupEfficiency", label: "Setup Efficiency (%)", group: "results", kind: "calc", width: 84, head: HEAD.calc,
    value: (c) => fmtPct(c.setupEfficiency), formula: "Effective Machine Run Time ÷ Machine Shift Time" },
  { key: "oeeLosses", label: "OEE considering losses (%)", group: "results", kind: "day", width: 96, head: HEAD.calc,
    value: (d) => fmtPct(d.oeeLosses), formula: "Per machine per day: Effective ÷ (Shift − Total Stoppage)" },
  { key: "oeeLunch", label: "OEE not considering losses but lunch (%)", group: "results", kind: "day", width: 110, head: HEAD.calc,
    value: (d) => fmtPct(d.oeeLunch), formula: "Per machine per day: Effective ÷ (Shift − Lunch/Tea/Wash room)" },
  { key: "oeeLunchCot", label: "OEE not considering losses but lunch and COT (%)", group: "results", kind: "day", width: 118, head: HEAD.calc,
    value: (d) => fmtPct(d.oeeLunchCot), formula: "Per machine per day: Effective ÷ (Shift − Lunch − Setup Time)" },
  { key: "remarks", label: "REMARKS", group: "remarks", kind: "input", type: "text", width: 300, head: HEAD.remarks },
];

const GROUPS = [
  { key: "details", label: "Details", head: HEAD.details },
  { key: "cycle", label: "Cycle Time (sec)", head: HEAD.cycle },
  { key: "time", label: "Time & Quantity", head: HEAD.time },
  { key: "stoppage", label: "Stoppages (min)", head: HEAD.stoppage },
  { key: "results", label: "Results", head: HEAD.effective },
  { key: "remarks", label: "", head: HEAD.remarks },
].map((g) => ({ ...g, span: COLUMNS.filter((c) => c.group === g.key).length }));

const DATE_W = 92;
const MC_W = 58;
const GROUP_ROW_H = 30;

const TEXT_FIELDS = ["operator", "workingStatus", "itemName", "drawingNo", "setupNo", "remarks"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime", "settingOnTime", "settingOffTime"];
const NUMBER_FIELDS = ["okQty", "rejectedQty", "plannedOperatorShiftHours", ...STOPPAGE_FIELDS.map((f) => f.key)];

const blankToNull = (v) => (v === "" || v === undefined || v === null ? null : Number(v));

const toPayload = (row) => ({
  date: row.date,
  machine: row.machine,
  slot: row.slot,
  item: row.item || null,
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, row[k] ?? ""])),
  // Blank clears the time; a half-typed/invalid one is left out so the saved value stays put.
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, row[k] ? normalizeTime(row[k]) ?? undefined : null])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, blankToNull(row[k])])),
  cycleOpsSec: Array.from({ length: CYCLE_OPS }, (_, i) => blankToNull(row.cycleOpsSec?.[i])),
});

const itemLabel = (it) => [it.itemName, it.drawingNo, it.setupNo].filter(Boolean).join(" · ");

const cellValue = (row, col) => {
  if (!row) return "";
  if (col.opIndex !== undefined) return row.cycleOpsSec?.[col.opIndex] ?? "";
  return row[col.key] ?? "";
};

const inputBase =
  "w-full h-full bg-transparent px-1.5 py-1 text-xs text-slate-900 dark:text-slate-100 outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-brand-500 dark:focus:bg-slate-900 read-only:cursor-default";

// One editable cell. Kept dumb and memo-friendly: everything it needs comes in as props.
const InputCell = React.memo(function InputCell({ col, value, rowIndex, readOnly, onChange, onBlur, onKeyDown }) {
  const common = {
    "data-r": rowIndex,
    "data-c": col.key,
    readOnly,
    onBlur,
    onKeyDown,
    className: `${inputBase} ${col.type === "number" ? "text-right tabular-nums" : ""}`,
  };

  if (col.type === "time") {
    const invalid = value !== "" && !normalizeTime(value);
    return (
      <input
        type="text"
        inputMode="numeric"
        value={value}
        placeholder={readOnly ? "" : "hh:mm"}
        title={invalid ? "Enter a time like 09:30 or 930" : undefined}
        onChange={(e) => {
          if (/^[\d:.]{0,5}$/.test(e.target.value)) onChange(col, e.target.value);
        }}
        {...common}
        onBlur={() => {
          const t = normalizeTime(value);
          if (t && t !== value) onChange(col, t);
          onBlur();
        }}
        className={`${common.className} tabular-nums placeholder:text-transparent focus:placeholder:text-slate-400 ${invalid ? "text-red-600 font-semibold" : ""}`}
      />
    );
  }
  if (col.type === "number") {
    return (
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          if (/^\d*\.?\d*$/.test(e.target.value)) onChange(col, e.target.value);
        }}
        {...common}
      />
    );
  }
  const list = { operator: "ps-operators", status: "ps-statuses", item: "ps-items" }[col.type];
  return (
    <input
      type="text"
      value={value}
      list={readOnly ? undefined : list}
      onChange={(e) => onChange(col, e.target.value)}
      {...common}
      className={`${common.className} ${col.type === "status" && value ? "font-semibold text-rose-700 dark:text-rose-300" : ""}`}
    />
  );
});

const StatusDot = ({ status }) => {
  if (status === "saving") return <Loader2 className="w-3 h-3 animate-spin text-slate-500" />;
  if (status === "error") return <CircleAlert className="w-3 h-3 text-red-600" />;
  if (status === "saved") return <CheckCircle2 className="w-3 h-3 text-emerald-600" />;
  return null;
};

// The three rows of one machine on one date.
const MachineDayRows = React.memo(function MachineDayRows({
  date, machine, groupIndex, r1, r2, r3, s1, s2, s3, canEdit, lastOfDate, onChange, onBlurRow, onKeyDown,
}) {
  const rows = [r1, r2, r3];
  const statuses = [s1, s2, s3];
  const day = useMemo(() => dayCalc(rows), [r1, r2, r3]);
  const sunday = isSunday(date);

  return rows.map((row, i) => {
    const slot = i + 1;
    const key = rowKey(date, machine._id, slot);
    const calc = rowCalc(row);
    const rowIndex = groupIndex * SLOTS_PER_DAY + i;
    const isLastRow = i === SLOTS_PER_DAY - 1;
    const bottom = isLastRow ? (lastOfDate ? "border-b-2 border-b-slate-500" : "border-b border-b-slate-400") : "border-b border-b-slate-200 dark:border-b-slate-700";
    const rowBg = statuses[i] === "error" ? "bg-red-50 dark:bg-red-950/40" : "bg-white dark:bg-[#161616]";

    return (
      <tr key={key} className={rowBg}>
        <td
          className={`sticky left-0 z-10 px-1.5 text-xs tabular-nums border-r border-slate-300 dark:border-slate-600 ${bottom} ${sunday ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}
          style={{ width: DATE_W, minWidth: DATE_W }}
        >
          {displayDay(date)}
        </td>
        <td
          className={`sticky z-10 px-1.5 text-xs font-semibold text-slate-900 border-r-2 border-slate-400 ${bottom}`}
          style={{ left: DATE_W, width: MC_W, minWidth: MC_W, background: machine.color || "#e2e8f0" }}
        >
          <span className="flex items-center justify-between gap-1">
            {machine.machineName}
            <StatusDot status={statuses[i]} />
          </span>
        </td>
        {COLUMNS.map((col) => {
          if (col.kind === "day") {
            if (i !== 0) return null;
            return (
              <td
                key={col.key}
                rowSpan={SLOTS_PER_DAY}
                className={`px-1.5 text-xs text-right tabular-nums font-semibold bg-blue-50 text-blue-950 dark:bg-blue-950/40 dark:text-blue-100 border-r border-slate-300 dark:border-slate-700 ${lastOfDate ? "border-b-2 border-b-slate-500" : "border-b border-b-slate-400"}`}
              >
                {col.value(day)}
              </td>
            );
          }
          if (col.kind === "calc") {
            return (
              <td
                key={col.key}
                className={`px-1.5 text-xs text-right tabular-nums text-slate-800 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700 ${bottom} ${col.group === "results" ? "bg-slate-100 dark:bg-slate-800/60" : "bg-blue-50/60 dark:bg-blue-950/20"}`}
              >
                {col.value(calc)}
              </td>
            );
          }
          return (
            <td key={col.key} className={`p-0 h-7 border-r border-slate-200 dark:border-slate-700 ${bottom}`}>
              <InputCell
                col={col}
                value={cellValue(row, col)}
                rowIndex={rowIndex}
                readOnly={!canEdit}
                onChange={(c, v) => onChange(date, machine._id, slot, c, v)}
                onBlur={() => onBlurRow(key)}
                onKeyDown={onKeyDown}
              />
            </td>
          );
        })}
      </tr>
    );
  });
});

const ProductionSheet = () => {
  const toast = useAlert();
  const { currentPagePermissions } = useContext(MenuContext) || {};
  const canEdit = !!(currentPagePermissions?.create || currentPagePermissions?.edit);

  const [month, setMonth] = useState(() => isoDay(new Date()).slice(0, 7));
  const [machineFilter, setMachineFilter] = useState("");
  const [rows, setRows] = useState({});
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(false);
  const [operatorNames, setOperatorNames] = useState([]);

  const { data: machines = [], isLoading: machinesLoading } = useMachines();
  const { data: items = [] } = useItems();

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const timersRef = useRef({});
  const chainRef = useRef({});
  const itemsByLabelRef = useRef({});
  const tableRef = useRef(null);

  itemsByLabelRef.current = useMemo(() => Object.fromEntries(items.map((it) => [itemLabel(it), it])), [items]);

  const days = useMemo(() => daysOfMonth(month), [month]);
  const visibleMachines = useMemo(
    () => (machineFilter ? machines.filter((m) => m._id === machineFilter) : machines),
    [machines, machineFilter],
  );

  // ── Load ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProductionSheet({ from: days[0], to: days[days.length - 1] })
      .then((res) => {
        if (cancelled) return;
        const next = {};
        for (const e of res.data.data || []) next[rowKey(e.date, e.machine, e.slot)] = e;
        rowsRef.current = next;
        setRows(next);
        setStatuses({});
      })
      .catch((err) => !cancelled && toast.error(err?.response?.data?.message || "Failed to load the sheet"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [days]);

  useEffect(() => {
    getOperatorNames()
      .then((res) => setOperatorNames(res.data.data || []))
      .catch(() => {});
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────
  const saveNow = useCallback((key) => {
    clearTimeout(timersRef.current[key]);
    delete timersRef.current[key];
    const row = rowsRef.current[key];
    if (!row) return;
    const payload = toPayload(row);

    setStatuses((s) => ({ ...s, [key]: "saving" }));
    // Saves for the same row run one after another so an older request can't land last.
    chainRef.current[key] = (chainRef.current[key] || Promise.resolve()).then(() =>
      saveProductionRow(payload)
        .then(() => setStatuses((s) => (timersRef.current[key] ? s : { ...s, [key]: "saved" })))
        .catch((err) => {
          setStatuses((s) => ({ ...s, [key]: "error" }));
          toast.error(`${displayDay(row.date)}: ${err?.response?.data?.message || "Row could not be saved"}`);
        }),
    );
  }, []);

  const flushAll = useCallback(() => {
    Object.keys(timersRef.current).forEach(saveNow);
  }, [saveNow]);

  useEffect(() => {
    const warn = (e) => {
      if (Object.keys(timersRef.current).length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      flushAll();
    };
  }, [flushAll]);

  const handleChange = useCallback((date, machineId, slot, col, value) => {
    const key = rowKey(date, machineId, slot);
    // Built from rowsRef (not a setState updater) so rowsRef is current
    // immediately — a blur right after typing must save the latest value.
    {
      const prev = rowsRef.current;
      const current = prev[key] || { date, machine: machineId, slot, cycleOpsSec: [] };
      let patch;
      if (col.opIndex !== undefined) {
        const ops = Array.from({ length: CYCLE_OPS }, (_, i) => current.cycleOpsSec?.[i] ?? "");
        ops[col.opIndex] = value;
        patch = { cycleOpsSec: ops };
      } else if (col.key === "itemName") {
        const it = itemsByLabelRef.current[value];
        patch = it
          ? {
              item: it._id,
              itemName: it.itemName,
              drawingNo: it.drawingNo || "",
              setupNo: it.setupNo || "",
              cycleOpsSec: Array.from({ length: CYCLE_OPS }, (_, i) => it.cycleOpsSec?.[i] ?? ""),
            }
          : { itemName: value, item: null };
      } else {
        patch = { [col.key]: value };
      }
      const next = { ...prev, [key]: { ...current, ...patch } };
      rowsRef.current = next;
      setRows(next);
    }
    setStatuses((s) => (s[key] ? { ...s, [key]: undefined } : s));
    clearTimeout(timersRef.current[key]);
    timersRef.current[key] = setTimeout(() => saveNow(key), SAVE_DELAY_MS);
  }, [saveNow]);

  const handleBlurRow = useCallback((key) => {
    if (timersRef.current[key]) saveNow(key);
  }, [saveNow]);

  // Enter / ↑ / ↓ move to the same column in the next/previous row, like Excel.
  const handleKeyDown = useCallback((e) => {
    const isTime = e.target.type === "time";
    let delta = 0;
    if (e.key === "Enter") delta = e.shiftKey ? -1 : 1;
    else if (!isTime && e.key === "ArrowDown") delta = 1;
    else if (!isTime && e.key === "ArrowUp") delta = -1;
    if (!delta) return;
    const r = Number(e.target.dataset.r) + delta;
    const next = tableRef.current?.querySelector(`[data-r="${r}"][data-c="${e.target.dataset.c}"]`);
    if (next) {
      e.preventDefault();
      next.focus();
      if (next.select && next.type !== "time") next.select();
    }
  }, []);

  const changeMonth = (value) => {
    if (!value) return;
    flushAll();
    setMonth(value);
  };

  const goToToday = () => {
    const today = isoDay(new Date());
    if (today.slice(0, 7) !== month) {
      changeMonth(today.slice(0, 7));
      setTimeout(() => scrollToDate(today), 400);
    } else {
      scrollToDate(today);
    }
  };

  const scrollToDate = (iso) => {
    const el = tableRef.current?.querySelector(`[data-date="${iso}"]`);
    el?.scrollIntoView({ block: "start" });
  };

  const savingCount = Object.values(statuses).filter((s) => s === "saving").length;
  const errorCount = Object.values(statuses).filter((s) => s === "error").length;
  const operatorOptions = useMemo(() => {
    const set = new Set(operatorNames);
    Object.values(rows).forEach((r) => r?.operator && set.add(r.operator));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [operatorNames, rows]);

  document.title = `Production Data Entry | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  const totalCols = 2 + COLUMNS.length;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Month</label>
            <input
              type="month"
              value={month}
              onChange={(e) => changeMonth(e.target.value)}
              className="bg-white dark:bg-[#1a1a1a] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
            />
          </div>
          <div className="w-44">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-0.5">Machine</label>
            <select
              value={machineFilter}
              onChange={(e) => setMachineFilter(e.target.value)}
              className="w-full bg-white dark:bg-[#1a1a1a] border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
            >
              <option value="">All machines</option>
              {machines.map((m) => (
                <option key={m._id} value={m._id}>{m.machineName}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={goToToday}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1a1a1a] px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <CalendarDays className="w-4 h-4" /> Today
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-slate-300 border border-slate-400" /> Locked</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-white border border-slate-400" /> Entry</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-100 border border-blue-300" /> Auto-calculated</span>
          <span className="font-medium min-w-[120px] text-right">
            {!canEdit ? (
              <span className="text-slate-500">View only</span>
            ) : errorCount ? (
              <span className="text-red-600">{errorCount} row{errorCount > 1 ? "s" : ""} not saved</span>
            ) : savingCount ? (
              <span className="text-slate-500">Saving…</span>
            ) : (
              <span className="text-emerald-600">All changes saved</span>
            )}
          </span>
        </div>
      </div>

      <datalist id="ps-operators">{operatorOptions.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="ps-statuses">{WORKING_STATUSES.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="ps-items">{items.map((it) => <option key={it._id} value={itemLabel(it)} />)}</datalist>

      <div
        ref={tableRef}
        className="overflow-auto max-h-[calc(100vh-190px)] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#161616]"
      >
        <table className="border-separate border-spacing-0 text-xs" style={{ minWidth: "100%" }}>
          <thead>
            <tr style={{ height: GROUP_ROW_H }}>
              <th
                rowSpan={2}
                className={`sticky top-0 left-0 z-40 px-1.5 font-bold border-r border-b border-slate-400 ${HEAD.locked}`}
                style={{ width: DATE_W, minWidth: DATE_W }}
              >
                Date
              </th>
              <th
                rowSpan={2}
                className={`sticky top-0 z-40 px-1.5 font-bold border-r-2 border-b border-slate-400 ${HEAD.locked}`}
                style={{ left: DATE_W, width: MC_W, minWidth: MC_W }}
              >
                M.C. No.
              </th>
              {GROUPS.map((g) => (
                <th
                  key={g.key}
                  colSpan={g.span}
                  className={`sticky top-0 z-20 px-2 py-0 text-[11px] font-bold uppercase tracking-wide border-r border-b border-slate-400 ${g.head}`}
                  style={{ height: GROUP_ROW_H }}
                >
                  {g.label}
                </th>
              ))}
            </tr>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  title={col.formula}
                  className={`sticky z-20 px-1.5 py-1.5 font-semibold leading-tight text-center align-middle border-r border-b border-slate-400 ${col.head} ${col.formula ? "cursor-help" : ""}`}
                  style={{ top: GROUP_ROW_H, width: col.width, minWidth: col.width }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {machinesLoading || loading ? (
              <tr>
                <td colSpan={totalCols} className="px-4 py-10 text-slate-500 font-medium">
                  <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</span>
                </td>
              </tr>
            ) : !visibleMachines.length ? (
              <tr>
                <td colSpan={totalCols} className="px-4 py-10 text-slate-500 font-medium">
                  No active machines yet. Add them under Production → Machines.
                </td>
              </tr>
            ) : (
              days.map((date, di) => (
                <React.Fragment key={date}>
                  <tr data-date={date} aria-hidden="true" style={{ height: 0, scrollMarginTop: GROUP_ROW_H * 2 + 24 }}>
                    <td colSpan={totalCols} style={{ padding: 0, border: 0 }} />
                  </tr>
                  {visibleMachines.map((m, mi) => {
                    const k = (slot) => rowKey(date, m._id, slot);
                    return (
                      <MachineDayRows
                        key={`${date}|${m._id}`}
                        date={date}
                        machine={m}
                        groupIndex={di * visibleMachines.length + mi}
                        r1={rows[k(1)]}
                        r2={rows[k(2)]}
                        r3={rows[k(3)]}
                        s1={statuses[k(1)]}
                        s2={statuses[k(2)]}
                        s3={statuses[k(3)]}
                        canEdit={canEdit}
                        lastOfDate={mi === visibleMachines.length - 1}
                        onChange={handleChange}
                        onBlurRow={handleBlurRow}
                        onKeyDown={handleKeyDown}
                      />
                    );
                  })}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ProductionSheet;
