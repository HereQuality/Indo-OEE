import React, { useState, useRef, useEffect } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

const DAYS_SHORT  = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

/**
 * Custom DatePicker
 *
 * Props:
 *   value       – ISO date string  "YYYY-MM-DD"
 *   onChange    – (e) => void  where e = { target: { name, value: "YYYY-MM-DD" } }
 *   name        – field name (forwarded in synthetic event)
 *   placeholder – string shown when no date selected
 *   hasError    – boolean → red border
 */
const DatePicker = ({
  value,
  onChange,
  name,
  placeholder = "Select date",
  hasError = false,
}) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(null); // { year, month }
  const containerRef = useRef(null);

  // Parse "YYYY-MM-DD" safely (avoids timezone shifts)
  const toLocalDate = (iso) => {
    if (!iso) return null;
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const selected = toLocalDate(value);
  const today = new Date();

  // Init view when popover opens
  useEffect(() => {
    if (open) {
      const base = selected || today;
      setView({ year: base.getFullYear(), month: base.getMonth() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const prevMonth = (e) => {
    e.stopPropagation();
    setView((v) => { const d = new Date(v.year, v.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; });
  };
  const nextMonth = (e) => {
    e.stopPropagation();
    setView((v) => { const d = new Date(v.year, v.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; });
  };

  const handleSelect = (day) => {
    const d = new Date(view.year, view.month, day);
    const iso = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-");
    onChange({ target: { name, value: iso } });
    setOpen(false);
  };

  // Display label
  const displayValue = selected
    ? selected.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "";

  const isToday    = (d) => view && today.getFullYear() === view.year && today.getMonth() === view.month && today.getDate() === d;
  const isSelected = (d) => selected && selected.getFullYear() === view?.year && selected.getMonth() === view?.month && selected.getDate() === d;
  const daysInMonth    = view ? new Date(view.year, view.month + 1, 0).getDate() : 30;
  const firstDayOfWeek = view ? new Date(view.year, view.month, 1).getDay() : 0;

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 cursor-pointer border rounded-xl px-2.5 py-1.5 text-xs transition-all bg-white text-left ${
          hasError
            ? "border-red-400 ring-4 ring-red-500/10"
            : open
            ? "border-brand-500 ring-4 ring-brand-500/15"
            : "border-slate-300 hover:border-slate-400"
        }`}
      >
        <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className={displayValue ? "text-slate-800" : "text-slate-400 font-normal"}>
          {displayValue || placeholder}
        </span>
      </button>

      {/* Calendar popup */}
      {open && view && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 w-64 select-none">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevMonth}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-semibold text-slate-800 text-sm">
              {MONTHS_FULL[view.month]} {view.year}
            </span>
            <button type="button" onClick={nextMonth}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS_SHORT.map((d) => (
              <div key={d} className="text-center text-xs font-semibold text-slate-400 py-1">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {Array(firstDayOfWeek).fill(null).map((_, i) => <div key={`p${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
              const sel = isSelected(day);
              const tod = isToday(day);
              return (
                <button type="button" key={day} onClick={() => handleSelect(day)}
                  className={`h-6 w-6 mx-auto flex items-center justify-center rounded-full text-[11px] font-medium transition-colors ${
                    sel
                      ? "bg-brand-600 text-white shadow-sm"
                      : tod
                      ? "border border-brand-400 text-brand-600 hover:bg-brand-50"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}>
                  {day}
                </button>
              );
            })}
          </div>

          {/* Today shortcut */}
          <div className="mt-2 pt-2 border-t border-slate-100">
            <button type="button"
              onClick={() => handleSelect(today.getDate()) || setView({ year: today.getFullYear(), month: today.getMonth() })}
              className="w-full text-[11px] text-center text-brand-600 hover:text-brand-700 font-medium py-1 rounded-lg hover:bg-brand-50 transition-colors">
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DatePicker;
