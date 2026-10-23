import React, { useRef } from "react";
import { Input } from "reactstrap";

/**
 * components/Production/NumberInput.jsx
 * ──────────────────────────────────────
 * A plain numeric box: no spinner arrows to click and no mouse-wheel
 * stepping, both of which change production figures by accident.
 *
 * It is a text input (that is what removes the browser's stepper entirely
 * rather than just hiding it, and what stops the mouse wheel changing the
 * value while it's focused — only a number input does that) with a numeric
 * keypad on mobile, and it only accepts digits and a single decimal point as
 * you type. The value stays a string, exactly like the other form fields;
 * the page converts it on save. Capped at 7 digits by default — long enough
 * for any figure on this sheet — so one stray keystroke can't turn a cell
 * into a 20-digit number; pass a different `maxLength` to override it.
 *
 * An optional `max` blocks typing past a value entirely (not just an error
 * after the fact) — e.g. OK Quantity can't be typed bigger than Actual
 * Quantity, and the Rejection Master boxes can't add up to more than Rejected.
 * Left out, or not yet a real number (still being calculated), there's no
 * ceiling. It only stops a value rising past it: shortening one that is
 * already over is always allowed. `onExceedMax(max, typed)` (if given) fires
 * once per blocked keystroke with the value that was refused, so the caller
 * can pop up why nothing happened.
 *
 * A whole-number box (`decimals={false}`) treats a "." or "-" as the end of
 * the number: it and whatever is typed after it are dropped, so "2.5" stays 2
 * and "-5" stays blank. Just dropping the stray character would join the
 * digits either side of it into a different number (25, or 5). The box takes
 * typing again after a Backspace / Delete, or once the cursor leaves it.
 */
const STOP = /[.,-]/;

// The value a whole-number box should take for `next`, or null to ignore the
// keystroke. `stopped` is a ref: true while typing after a "." or "-".
const wholeNumber = (prev, next, caret, stopped) => {
  const added = next.length - prev.length;
  const start = caret - added;
  const inserted = added > 0 && start >= 0 && next.slice(0, start) + next.slice(caret) === prev;
  if (!inserted) {
    // Something was deleted or typed over, so typing starts afresh.
    stopped.current = false;
    return /^\d*$/.test(next) ? next : null;
  }
  if (stopped.current && start === prev.length) return null;
  const typed = next.slice(start, caret);
  const stop = typed.search(STOP);
  if (stop === -1) return /^\d*$/.test(next) ? next : null;
  stopped.current = true;
  const kept = next.slice(0, start) + typed.slice(0, stop) + next.slice(caret);
  return /^\d*$/.test(kept) && kept !== prev ? kept : null;
};

const NumberInput = ({ name, value, onChange, decimals = true, maxLength = 7, max, onExceedMax, onBlur, ...rest }) => {
  const pattern = decimals ? /^\d*\.?\d*$/ : /^\d*$/;
  const stopped = useRef(false);

  const handleChange = (e) => {
    let next = e.target.value;
    if (!decimals) {
      const prev = value === undefined || value === null ? "" : String(value);
      const kept = wholeNumber(prev, next, e.target.selectionStart ?? next.length, stopped);
      if (kept === null) return;
      // The page reads the value off the event, so it gets the trimmed one.
      if (kept !== next) e.target.value = kept;
      next = kept;
    }
    if (next === "" || pattern.test(next)) {
      // The ceiling only stops a value from going UP past it. It can also drop
      // below what is already typed (e.g. OK Quantity lowered after the reject
      // boxes were filled in), and backspacing such a value must stay possible —
      // every step on the way down is still over the ceiling until the last one.
      const falling = value !== "" && value !== undefined && value !== null && Number(next) < Number(value);
      if (Number.isFinite(max) && next !== "" && Number(next) > max && !falling) {
        onExceedMax?.(max, Number(next));
        return;
      }
      onChange(e);
    }
  };

  return (
    <Input
      type="text"
      bsSize="sm"
      inputMode={decimals ? "decimal" : "numeric"}
      autoComplete="off"
      name={name}
      value={value ?? ""}
      onChange={handleChange}
      onBlur={(e) => {
        stopped.current = false;
        onBlur?.(e);
      }}
      maxLength={maxLength}
      {...rest}
    />
  );
};

export default NumberInput;
