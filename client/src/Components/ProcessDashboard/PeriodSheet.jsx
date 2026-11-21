import React, { useEffect, useMemo, useState } from "react";
import { Modal, ModalBody } from "reactstrap";
import { ChevronLeft, ChevronRight, MousePointerClick, X } from "lucide-react";
import RangeCalendar from "./RangeCalendar";
import { MAX_RANGE_DAYS, MONTH_LABELS, QUICK_RANGES, describeRange, isoDate, monthRange, parseIsoDate, quickRangeKey, rangeDays, yearRange, yearsOfExtent } from "../../utils/processDashboard";
import { displayDay } from "../../utils/productionSheet";

/**
 * Components/ProcessDashboard/PeriodSheet.jsx
 * ────────────────────────────────────────────
 * The dashboard's period picker — the same "Select period" sheet the app has
 * (mobile/lib/features/production/dashboard/sheets/date_range_sheet.dart),
 * with its three tabs:
 *
 *   Date range   quick ranges, then a calendar: click a start day, then an end day
 *   Month        a year stepper over a 12-month grid
 *   Year         the years the data has
 *
 * `range` is ["YYYY-MM-DD", "YYYY-MM-DD"]; `extent` the data's {from, to}. A
 * choice applies straight away (onChange with the complete range) and the
 * sheet closes. A period longer than 5 years is refused with a banner and
 * the sheet stays open.
 */
export const RANGE_TOO_LONG = "That period is longer than 5 years — pick a shorter one.";

const TABS = [
  { key: "range", label: "Date range" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
];

const tabOf = (range) => {
  const label = describeRange(range);
  if (/^\d{4}$/.test(label)) return "year";
  if (/^[A-Z][a-z]+ \d{4}$/.test(label)) return "month";
  return "range";
};

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const tryDay = (s) => {
  try {
    return s ? parseIsoDate(s) : null;
  } catch {
    return null;
  }
};

const PeriodSheet = ({ isOpen, onClose, range, extent, onChange }) => {
  const [tab, setTab] = useState(() => tabOf(range));
  const [pickStart, setPickStart] = useState(null);
  const [shown, setShown] = useState(null);
  const [error, setError] = useState(null);
  const [monthYear, setMonthYear] = useState(() => Number(range[0].slice(0, 4)));

  // Reopening shows the tab that matches what is applied, with nothing half-picked.
  useEffect(() => {
    if (!isOpen) return;
    setTab(tabOf(range));
    setPickStart(null);
    setShown(null);
    setError(null);
    setMonthYear(Number(range[0].slice(0, 4)));
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  const apply = (next, pause = false) => {
    if (rangeDays(next) > MAX_RANGE_DAYS) {
      setError(RANGE_TOO_LONG);
      setPickStart(null);
      setShown(null);
      return;
    }
    const finish = () => {
      onClose();
      if (next[0] !== range[0] || next[1] !== range[1]) onChange(next);
    };
    // Let the chosen range show on the calendar for a beat before closing.
    if (pause) setTimeout(finish, 180);
    else finish();
  };

  const clickDay = (d) => {
    if (pickStart && d >= pickStart) {
      setError(null);
      setPickStart(null);
      setShown([pickStart, d]);
      apply([isoDate(pickStart), isoDate(d)], true);
    } else {
      setError(null);
      setPickStart(d);
      setShown(null);
    }
  };

  const switchTab = (key) => {
    setTab(key);
    setPickStart(null);
    setError(null);
  };

  const picking = !!pickStart;
  const days = rangeDays(range);
  const subtitle = picking ? `${displayDay(isoDate(pickStart))} → pick the end date` : `Showing ${describeRange(range)} · ${plural(days, "day")}`;
  const years = yearsOfExtent(extent);
  const applied = describeRange(range);
  const thisMonth = isoDate(today).slice(0, 7);

  // ── Date range tab ──
  const active = !pickStart && !shown ? quickRangeKey(range) : null;
  const appliedStart = tryDay(range[0]);
  const firstYear = Math.min(extent ? Number(extent.from.slice(0, 4)) : today.getFullYear() - 5, appliedStart ? appliedStart.getFullYear() : Infinity);
  const firstDate = new Date(firstYear, 0, 1);
  const initial = !appliedStart || appliedStart > today ? today : appliedStart;
  const start = pickStart || shown?.[0] || appliedStart;
  const end = pickStart ? null : shown?.[1] || tryDay(range[1]);

  // ── Month tab ──
  const monthYears = years.includes(monthYear) ? years : [monthYear, ...years].sort((a, b) => b - a);
  const idx = monthYears.indexOf(monthYear);

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered scrollable className="pd-period-modal" contentClassName="pd-period-content">
      <div className="pd-period-head">
        <div>
          <div className="pd-filter-label mb-0">Period</div>
          <div className="pd-period-title">Select period</div>
          <div className="pd-period-sub">{subtitle}</div>
        </div>
        <button type="button" className="pd-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>
      <div className="px-3 pb-2">
        <div className="pd-seg mb-0" role="tablist" aria-label="Period type">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`pd-seg-btn ${tab === t.key ? "is-on" : ""}`} onClick={() => switchTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <ModalBody className="pd-period-body">
        {error && <div className="pd-banner" role="alert">{error}</div>}

        {tab === "range" && (
          <>
            <div className="pd-filter-label">Quick ranges</div>
            <div className="d-flex flex-wrap gap-2 mb-3">
              {QUICK_RANGES.map((q) => (
                <button key={q.key} type="button" className={`pd-chip ${active === q.key ? "is-on" : ""}`} onClick={() => apply(q.range())}>
                  {q.label}
                </button>
              ))}
            </div>
            <div className="pd-filter-label">Custom range</div>
            <div className="pd-card">
              <RangeCalendar start={start} end={end} firstDate={firstDate} lastDate={today} today={today} initialMonth={initial} onDayClick={clickDay} />
            </div>
            <div className="pd-period-hint">
              <MousePointerClick size={15} />
              <span>{picking ? "Now click an end date — or use just this day." : "Click a start date, then an end date. Use the arrows to change month, click the month to jump."}</span>
            </div>
          </>
        )}

        {tab === "month" && (
          <>
            <div className="pd-filter-label">Year</div>
            <div className="pd-card pd-year-step">
              <button type="button" className="pd-icon-btn" disabled={idx >= monthYears.length - 1} onClick={() => setMonthYear(monthYears[idx + 1])} aria-label="Earlier year"><ChevronLeft size={18} /></button>
              <span>{monthYear}</span>
              <button type="button" className="pd-icon-btn" disabled={idx <= 0} onClick={() => setMonthYear(monthYears[idx - 1])} aria-label="Later year"><ChevronRight size={18} /></button>
            </div>
            <div className="pd-filter-label mt-3">Month</div>
            <div className="pd-month-grid">
              {MONTH_LABELS.map((name, i) => {
                const yyyymm = `${monthYear}-${String(i + 1).padStart(2, "0")}`;
                return (
                  <button key={name} type="button" disabled={yyyymm > thisMonth} className={`pd-chip ${applied === `${name} ${monthYear}` ? "is-on" : ""}`} onClick={() => apply(monthRange(yyyymm))} aria-label={`${name} ${monthYear}`}>
                    {name.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {tab === "year" && (
          <>
            <div className="pd-filter-label">Years with data</div>
            <div className="pd-month-grid">
              {years.map((y) => (
                <button key={y} type="button" className={`pd-chip ${applied === String(y) ? "is-on" : ""}`} onClick={() => apply(yearRange(y))}>
                  {y}
                </button>
              ))}
            </div>
          </>
        )}
      </ModalBody>
      {picking && (
        <div className="pd-period-foot">
          <button type="button" className="btn btn-outline-secondary flex-fill" onClick={() => setPickStart(null)}>Cancel</button>
          <button type="button" className="btn btn-primary flex-fill" style={{ flexGrow: 2 }} onClick={() => apply([isoDate(pickStart), isoDate(pickStart)])}>Just this day</button>
        </div>
      )}
    </Modal>
  );
};

export default PeriodSheet;
