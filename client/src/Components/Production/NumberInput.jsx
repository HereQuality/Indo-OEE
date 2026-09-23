import React from "react";
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
 * after the fact) — e.g. OK Quantity can't be typed bigger than Ideal
 * Quantity. Left out, or not yet a real number (still being calculated),
 * there's no ceiling. `onExceedMax` (if given) fires once per blocked
 * keystroke, so the caller can pop a toast explaining why nothing happened.
 */
const NumberInput = ({ name, value, onChange, decimals = true, maxLength = 7, max, onExceedMax, ...rest }) => {
  const pattern = decimals ? /^\d*\.?\d*$/ : /^\d*$/;

  const handleChange = (e) => {
    const next = e.target.value;
    if (next === "" || pattern.test(next)) {
      if (Number.isFinite(max) && next !== "" && Number(next) > max) {
        onExceedMax?.(max);
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
      maxLength={maxLength}
      {...rest}
    />
  );
};

export default NumberInput;
