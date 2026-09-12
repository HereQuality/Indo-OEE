import React from "react";
import { Input } from "reactstrap";

/**
 * components/Production/NumberInput.jsx
 * ──────────────────────────────────────
 * A plain numeric box: no spinner arrows to click and no mouse-wheel
 * stepping, both of which change production figures by accident.
 *
 * It is a text input (that is what removes the browser's stepper entirely
 * rather than just hiding it) with a numeric keypad on mobile, and it only
 * accepts digits and a single decimal point as you type. The value stays a
 * string, exactly like the other form fields; the page converts it on save.
 */
const NumberInput = ({ name, value, onChange, decimals = true, ...rest }) => {
  const pattern = decimals ? /^\d*\.?\d*$/ : /^\d*$/;

  const handleChange = (e) => {
    const next = e.target.value;
    if (next === "" || pattern.test(next)) onChange(e);
  };

  return (
    <Input
      type="text"
      inputMode={decimals ? "decimal" : "numeric"}
      autoComplete="off"
      name={name}
      value={value ?? ""}
      onChange={handleChange}
      {...rest}
    />
  );
};

export default NumberInput;
