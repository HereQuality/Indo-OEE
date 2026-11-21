import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Minus, Plus } from "lucide-react";
import { MONTH_LABELS } from "../../utils/processDashboard";

/**
 * Components/ProcessDashboard/RangeCalendar.jsx
 * ──────────────────────────────────────────────
 * A month-per-page calendar that highlights a date range — the web copy of
 * the app's range_calendar.dart: arrows between months, click the title to
 * jump to any month or year. It only reports clicks on a day; the owner
 * (PeriodSheet) decides what one or two clicks mean.
 *
 * Dates are plain Date objects at local midnight.
 */
const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const same = (a, b) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const monthIndex = (d) => d.getFullYear() * 12 + d.getMonth();
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const RangeCalendar = ({ start, end, firstDate, lastDate, today, initialMonth, onDayClick }) => {
  const first = monthIndex(firstDate);
  const last = monthIndex(lastDate);
  const clamp = (i) => Math.min(last, Math.max(first, i));
  const [page, setPage] = useState(() => clamp(monthIndex(initialMonth)));
  const [jump, setJump] = useState(false);
  const [jumpYear, setJumpYear] = useState(() => initialMonth.getFullYear());

  // A new applied range opens the calendar on the month it starts in.
  useEffect(() => {
    setPage(clamp(monthIndex(initialMonth)));
    setJumpYear(initialMonth.getFullYear());
  }, [initialMonth.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const month = new Date(Math.floor(page / 12), page % 12, 1);
  const title = `${MONTH_LABELS[month.getMonth()]} ${month.getFullYear()}`;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const lead = month.getDay();
  const ranged = !!start && !!end && !same(start, end);
  const hasMonth = (y, m) => y * 12 + m >= first && y * 12 + m <= last;

  return (
    <div className="pd-cal">
      <div className="pd-cal-head">
        <button type="button" className="pd-icon-btn" onClick={() => setPage((p) => clamp(p - 1))} disabled={jump || page <= first} aria-label="Previous month"><ChevronLeft size={18} /></button>
        <button type="button" className="pd-cal-title" onClick={() => setJump((j) => !j)} aria-expanded={jump} aria-label={`Choose month and year, showing ${title}`}>
          {title} {jump ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <button type="button" className="pd-icon-btn" onClick={() => setPage((p) => clamp(p + 1))} disabled={jump || page >= last} aria-label="Next month"><ChevronRight size={18} /></button>
      </div>

      {jump ? (
        <div className="pd-cal-jump">
          <div className="pd-cal-jump-year">
            <button type="button" className="pd-icon-btn" onClick={() => setJumpYear((y) => y - 1)} disabled={jumpYear <= firstDate.getFullYear()} aria-label="Previous year"><Minus size={16} /></button>
            <span>{jumpYear}</span>
            <button type="button" className="pd-icon-btn" onClick={() => setJumpYear((y) => y + 1)} disabled={jumpYear >= lastDate.getFullYear()} aria-label="Next year"><Plus size={16} /></button>
          </div>
          <div className="pd-month-grid">
            {MONTH_LABELS.map((name, m) => (
              <button
                key={name}
                type="button"
                disabled={!hasMonth(jumpYear, m)}
                className={`pd-chip ${jumpYear === month.getFullYear() && m === month.getMonth() ? "is-on" : ""}`}
                onClick={() => {
                  setPage(clamp(jumpYear * 12 + m));
                  setJump(false);
                }}
                aria-label={`${name} ${jumpYear}`}
              >
                {name.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="pd-cal-weekdays" aria-hidden="true">
            {WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}
          </div>
          <div className="pd-cal-grid" role="grid">
            {Array.from({ length: 42 }, (_, i) => {
              const n = i - lead + 1;
              if (n < 1 || n > daysInMonth) return <span key={i} className="pd-cal-cell is-blank" />;
              const d = new Date(month.getFullYear(), month.getMonth(), n);
              const enabled = d >= day(firstDate) && d <= day(lastDate);
              const isStart = same(d, start);
              const isEnd = same(d, end);
              const inside = ranged && d > start && d < end;
              const picked = isStart || isEnd;
              const cls = [
                "pd-cal-cell",
                ranged && (inside || isEnd) ? "band-left" : "",
                ranged && (inside || isStart) ? "band-right" : "",
                i % 7 === 0 || n === 1 ? "round-left" : "",
                i % 7 === 6 || n === daysInMonth ? "round-right" : "",
              ].join(" ");
              const label = `${n} ${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`;
              return (
                <span key={i} className={cls}>
                  <button
                    type="button"
                    role="gridcell"
                    disabled={!enabled}
                    aria-selected={picked}
                    aria-label={same(d, today) ? `${label}, today` : label}
                    className={`pd-cal-day ${picked ? "is-picked" : ""} ${same(d, today) ? "is-today" : ""}`}
                    onClick={() => onDayClick(d)}
                  >
                    {n}
                  </button>
                </span>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default RangeCalendar;
