import React, { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

/**
 * Components/Common/TimePicker.jsx
 * ──────────────────────────────────
 * A 24-hour time box. Type it as HH:mm (930 → 09:30), or tap the clock to open
 * two scrolling columns — hours 00–23 and minutes in 5-minute steps (00, 05 … 55) — right under the box,
 * inside the form (not a floating pop-up), at one fixed, touch-friendly size on
 * a phone, an iPad or a desktop. No AM/PM anywhere, so there is no half of the
 * day to mix up. Value in and out is always "HH:mm" (or "" when empty).
 *
 * `minTime` ("HH:mm", inclusive) greys out anything earlier — the OFF box uses
 * it so it can't be set before the ON time.
 */
const pad = (n) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 00, 05 … 55
const ROW = 38; // px — a comfortable tap target

const toMin = (t) => (/^\d{2}:\d{2}$/.test(t || "") ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);

// What a person types → "HH:mm" or null: "9", "930", "0930", "9:30", "9.30", "21:05".
const parseTyped = (raw) => {
  const s = String(raw || "").trim();
  if (!s) return "";
  let h;
  let m;
  const colon = s.match(/^(\d{1,2})[:.](\d{1,2})$/);
  if (colon) [h, m] = [Number(colon[1]), Number(colon[2])];
  else if (/^\d{3,4}$/.test(s)) [h, m] = [Number(s.slice(0, -2)), Number(s.slice(-2))];
  else if (/^\d{1,2}$/.test(s)) [h, m] = [Number(s), 0];
  else return null;
  return h > 23 || m > 59 ? null : `${pad(h)}:${pad(m)}`;
};

const Column = ({ label, items, selected, disabled, onPick, open }) => {
  const ref = useRef(null);
  // Bring the chosen value to the middle of the column whenever the panel opens.
  useEffect(() => {
    if (!open || !ref.current) return;
    const at = selected === null || selected === undefined ? 0 : selected;
    ref.current.scrollTop = Math.max(0, at * ROW - ROW * 1.5);
  }, [open, selected]);
  return (
    <div className="flex-fill" style={{ minWidth: 0 }}>
      <div className="text-center text-muted small fw-semibold pb-1">{label}</div>
      <div
        ref={ref}
        role="listbox"
        aria-label={label}
        className="border rounded"
        style={{ height: ROW * 4, overflowY: "auto", scrollSnapType: "y proximity", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
      >
        {items.map((n) => {
          const on = selected === n;
          const off = disabled(n);
          return (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={on}
              disabled={off}
              onClick={() => onPick(n)}
              className={`d-block w-100 border-0 ${on ? "bg-primary text-white fw-semibold" : "bg-transparent"} ${off ? "text-muted" : ""}`}
              style={{ height: ROW, scrollSnapAlign: "center", opacity: off ? 0.35 : 1, fontVariantNumeric: "tabular-nums" }}
            >
              {pad(n)}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const TimePicker = ({ value, onChange, name, placeholder = "hh:mm", hasError = false, minTime = null }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null); // what is being typed, until the box is left
  const wrap = useRef(null);
  const min = toMin(minTime);
  const shown = draft !== null ? draft : value || "";
  const hour = /^\d{2}:\d{2}$/.test(value || "") ? Number(value.slice(0, 2)) : null;
  const minute = /^\d{2}:\d{2}$/.test(value || "") ? Number(value.slice(3)) : null;

  const emit = (v) => onChange({ target: { name, value: v } });

  // A tap or click outside the box and its panel closes the panel.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => wrap.current && !wrap.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
    };
  }, [open]);

  const commitTyped = () => {
    if (draft === null) return;
    const parsed = parseTyped(draft);
    setDraft(null);
    if (parsed === null) return; // not a time — keep what was there
    if (parsed !== "" && min !== null && toMin(parsed) < min) return;
    emit(parsed);
  };

  const pickHour = (h) => {
    const m = minute === null ? (min !== null && h * 60 < min ? min - h * 60 : 0) : minute;
    emit(`${pad(h)}:${pad(m)}`);
  };
  const pickMinute = (m) => emit(`${pad(hour === null ? 0 : hour)}:${pad(m)}`);

  return (
    <div ref={wrap} className="position-relative">
      <div className="input-group input-group-sm">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          name={name}
          maxLength={5}
          className={`form-control form-control-sm ${hasError ? "is-invalid" : ""}`}
          placeholder={placeholder}
          value={shown}
          onFocus={() => setOpen(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTyped}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTyped();
              setOpen(false);
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />
        <button type="button" className="btn btn-outline-secondary" aria-label="Choose time" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Clock size={15} />
        </button>
      </div>

      {open && (
        <div className="border rounded bg-body shadow-sm p-2 mt-1" style={{ position: "relative", zIndex: 5, minWidth: 220, maxWidth: 300 }}>
          <div className="d-flex gap-2">
            <Column
              label="Hour"
              items={HOURS}
              selected={hour}
              open={open}
              disabled={(h) => min !== null && h * 60 + 59 < min}
              onPick={pickHour}
            />
            <Column
              label="Minute"
              items={MINUTES}
              selected={minute}
              open={open}
              disabled={(m) => min !== null && hour !== null && hour * 60 + m < min}
              onPick={pickMinute}
            />
          </div>
          <div className="d-flex justify-content-between align-items-center pt-2">
            <button type="button" className="btn btn-sm btn-link text-muted p-0" onClick={() => { emit(""); setOpen(false); }}>
              Clear
            </button>
            <button type="button" className="btn btn-sm btn-primary px-3" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimePicker;
