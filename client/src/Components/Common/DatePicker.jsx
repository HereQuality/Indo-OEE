import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
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
 *
 * The trigger carries aria-expanded while the calendar shows, and Escape closes
 * just the calendar — so a form's modal knows that Escape wasn't meant for it
 * (see utils/modalEscape.js).
 */
const DatePicker = ({
  value,
  onChange,
  name,
  id,
  placeholder = "Select date",
  hasError = false,
}) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(null); // { year, month }
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  // Where the calendar sits (fixed to the screen, so a modal's scrolling body
  // can't clip it): below the field when it fits, above it when there is more
  // room there, and never wider or taller than the visible screen.
  const [pos, setPos] = useState(null);

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

  const place = () => {
    const t = triggerRef.current;
    if (!t) return;
    const vv = window.visualViewport;
    const vw = vv?.width || window.innerWidth;
    const vh = vv?.height || window.innerHeight;
    const r = t.getBoundingClientRect();
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    const width = Math.min(coarse ? 308 : 256, vw - 16); // wider on touch: 40px day cells
    const popH = popRef.current ? popRef.current.scrollHeight : 330;
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    const useAbove = popH > below && above > below;
    const room = Math.max(120, useAbove ? above : below);
    const height = Math.min(popH, room);
    setPos({
      left: Math.max(8, Math.min(r.left, vw - width - 8)),
      top: useAbove ? Math.max(8, r.top - 4 - height) : r.bottom + 4,
      width,
      maxHeight: room,
    });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Escape closes the calendar (only), wherever the focus is.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const prevMonth = (e) => {
    e.stopPropagation();
    setView((v) => { const d = new Date(v.year, v.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; });
  };
  const nextMonth = (e) => {
    e.stopPropagation();
    setView((v) => { const d = new Date(v.year, v.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; });
  };

  const pick = (d) => {
    const iso = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-");
    onChange({ target: { name, value: iso } });
    setOpen(false);
  };
  const handleSelect = (day) => pick(new Date(view.year, view.month, day));

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
        ref={triggerRef}
        type="button"
        id={id}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`w-full flex items-center gap-2 cursor-pointer border rounded-xl px-2.5 py-1.5 text-xs touch-hit transition-all bg-white text-left ${
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
        <div
          ref={popRef}
          style={pos ? { position: "fixed", left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight, overflowY: "auto" } : { position: "fixed", visibility: "hidden" }}
          className="z-[2000] bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 select-none"
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevMonth}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors touch-hit inline-flex items-center justify-center">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-semibold text-slate-800 text-sm">
              {MONTHS_FULL[view.month]} {view.year}
            </span>
            <button type="button" onClick={nextMonth}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors touch-hit inline-flex items-center justify-center">
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
                  className={`h-6 w-6 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 [@media(pointer:coarse)]:text-sm mx-auto flex items-center justify-center rounded-full text-[11px] font-medium transition-colors ${
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

          {/* Today shortcut — today's own date, whichever month is on screen */}
          <div className="mt-2 pt-2 border-t border-slate-100">
            <button type="button"
              onClick={() => pick(new Date())}
              className="w-full text-[11px] text-center text-brand-600 hover:text-brand-700 font-medium py-1 rounded-lg hover:bg-brand-50 transition-colors touch-hit">
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DatePicker;
