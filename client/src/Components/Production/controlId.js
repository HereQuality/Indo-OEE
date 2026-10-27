import { Children, Fragment, cloneElement, isValidElement } from "react";

/**
 * components/Production/controlId.js
 * ───────────────────────────────────
 * Ties a visible <Label htmlFor> to the control inside it. The form's `Field`
 * gives the label an id (React's useId, unique per field and stable between
 * renders, so several entries in one form never clash) and passes that same id
 * to its first control here. Plain DOM tags and fragments are skipped; a
 * control that already has its own id keeps it. The control components
 * (NumberInput, TimePicker, DatePicker, SearchablePartSelect, VendorSelect,
 * MachineStatusSelect, reactstrap Input) take `id` and put it on the element
 * the label should point at.
 */
export const withControlId = (children, id) => {
  let done = false;
  return Children.map(children, (child) => {
    if (done || !isValidElement(child) || typeof child.type === "string" || child.type === Fragment) return child;
    done = true;
    return child.props.id !== undefined ? child : cloneElement(child, { id });
  });
};
