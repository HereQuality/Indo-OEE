import React, { useEffect, useRef, useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { CalendarRange } from "lucide-react";
import { QUICK_RANGES, isoDate, parseIsoDate, quickRangeKey } from "../../utils/processDashboard";
import { displayDay } from "../../utils/productionSheet";

/**
 * Components/ProcessDashboard/DateRangeField.jsx
 * ────────────────────────────────────────────────
 * The From–To date picker in the dashboard's Filters panel — the same
 * one-calendar, click-start-then-end picker (month + year dropdowns in the
 * header, quick-range chips in the footer) the Internal Audit app uses for
 * its list filters, on the app's existing react-datepicker.
 *
 * Controlled by `value` = ["YYYY-MM-DD", "YYYY-MM-DD"]. Unlike a list filter,
 * every change here reloads the dashboard's data, so a half-picked range is
 * held locally as a draft and `onChange` only fires with a COMPLETE range:
 * both ends clicked, a quick range chosen, or the calendar closed after one
 * click (which means "just that day").
 */
// react-datepicker clones its custom input with more than onClick: a
// className that (while the calendar is open) marks the trigger as "inside",
// plus onKeyDown / onFocus / onBlur. Dropping those made a click on the field
// mid-pick count as an outside click — committing a one-day range and
// reopening the calendar — so everything it injects is passed through. The
// text-input-only props it also sends (value, onChange, …) are left behind.
const Trigger = React.forwardRef(({ label, open, className = "", onClick, onKeyDown, onFocus, onBlur, id, disabled }, ref) => (
  <button type="button" ref={ref} id={id} disabled={disabled} onClick={onClick} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={onBlur}
    className={`pd-field-btn w-100 ${className}`} title={label} aria-haspopup="true" aria-expanded={open}>
    <CalendarRange size={15} className="flex-shrink-0" />
    <span className="text-truncate">{label}</span>
  </button>
));
Trigger.displayName = "DateRangeTrigger";

const DateRangeField = ({ value, onChange, minDate, maxDate }) => {
  const [open, setOpen] = useState(false);
  // [start, end] as Date objects while the calendar is being clicked.
  const [draft, setDraft] = useState(null);

  const pickerRef = useRef(null);

  // A new applied range (quick range, Month/Year tab, Clear all) replaces any draft.
  useEffect(() => setDraft(null), [value[0], value[1]]);

  // react-datepicker only hears Escape while focus is inside it, and the
  // calendar can be open without that (opened by mouse, then a click on the
  // panel). Close it from here so Escape always dismisses the calendar first;
  // FilterPanel leaves the panel open for as long as a calendar is showing.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && pickerRef.current?.setOpen(false);
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  const [start, end] = draft || [parseIsoDate(value[0]), parseIsoDate(value[1])];
  const picking = !!draft && !draft[1];
  const label = picking ? `${displayDay(isoDate(start))} → pick end date` : `${displayDay(isoDate(start))} to ${displayDay(isoDate(end))}`;
  const activeQuick = draft ? null : quickRangeKey(value);

  const commit = (from, to) => {
    setDraft(null);
    if (from !== value[0] || to !== value[1]) onChange([from, to]);
  };

  return (
    <DatePicker
      ref={pickerRef}
      selectsRange
      startDate={start}
      endDate={end}
      onChange={([s, e]) => (s && e ? commit(isoDate(s), isoDate(e)) : setDraft([s, e]))}
      onCalendarOpen={() => setOpen(true)}
      // One click then closing the calendar means "that one day".
      onCalendarClose={() => {
        setOpen(false);
        if (draft?.[0] && !draft[1]) commit(isoDate(draft[0]), isoDate(draft[0]));
      }}
      minDate={minDate}
      maxDate={maxDate}
      dateFormat="dd/MM/yyyy"
      customInput={<Trigger label={label} open={open} />}
      popperPlacement="bottom-start"
      showMonthDropdown
      showYearDropdown
      dropdownMode="select"
      openToDate={start}
      autoComplete="off"
    >
      {/* react-datepicker renders children inside the calendar, so clicks here don't count as "outside". */}
      <div className="pd-quick">
        <div className="pd-quick-hint">{picking ? "Now pick an end date — or close this to filter by just that day" : "Pick a start date, or choose a quick range"}</div>
        <div className="d-flex flex-wrap gap-1">
          {QUICK_RANGES.map((q) => (
            <button key={q.key} type="button" className={`pd-quick-btn ${activeQuick === q.key ? "is-on" : ""}`} onClick={() => commit(...q.range())}>
              {q.label}
            </button>
          ))}
        </div>
      </div>
    </DatePicker>
  );
};

export default DateRangeField;
