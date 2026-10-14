import React, { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Components/Production/FormLine.jsx
 * ─────────────────────────────────────
 * One titled section of an entry form. Required sections are always open.
 * An `optional` section starts folded to a single slim row ("Optional — tap to
 * add") so the form looks short, and opens by itself when it already holds
 * something (editing an entry), when it has an error after Save, or when
 * `openByDefault` says it needs typing. Its fields stay mounted while folded,
 * so nothing is lost and Save can still point at one of them.
 */
const filled = (v) => {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.values(v).some((n) => n !== "" && n !== undefined && n !== null);
  return v !== "" && v !== undefined && v !== null;
};

const FormLine = ({ title, fields = [], errors = {}, isSubmit, values = {}, optional = false, openByDefault = false, summary = "", countFields, children }) => {
  const hasError = isSubmit && fields.some((f) => errors[f]);
  // `countFields`: which fields count as "something typed" (a pre-filled, locked
  // field must not open the section by itself).
  const hasValue = (countFields || fields.filter((f) => f !== "stoppageTotal")).some((f) => filled(values[f]));
  const [open, setOpen] = useState(!optional || hasValue || openByDefault);
  useEffect(() => {
    if (hasValue || openByDefault || hasError) setOpen(true);
  }, [hasValue, openByDefault, hasError]);
  const shown = !optional || open || hasError;

  const head = (
    <>
      <span className="fw-semibold small">{title}</span>
      {hasError && <span className="badge bg-danger-subtle text-danger ms-auto">Check this line</span>}
      {optional && !hasError && (
        <span className="ms-auto d-inline-flex align-items-center gap-1 small text-muted">
          {shown ? (hasValue ? "Filled in" : "") : summary || (hasValue ? "Filled in" : "Optional — tap to add")}
          <ChevronDown size={15} style={{ transition: "transform 0.15s", transform: shown ? "rotate(180deg)" : "none" }} />
        </span>
      )}
    </>
  );

  return (
    <div className={`border rounded mb-1 ${hasError ? "border-danger" : ""}`}>
      {optional ? (
        <button
          type="button"
          className={`d-flex align-items-center gap-2 px-2 py-1 bg-light w-100 border-0 text-start rounded-top ${shown ? "border-bottom" : "rounded-bottom"}`}
          aria-expanded={shown}
          onClick={() => setOpen(!shown)}
        >
          {head}
        </button>
      ) : (
        <div className="d-flex align-items-center gap-2 px-2 py-1 bg-light border-bottom rounded-top">{head}</div>
      )}
      <div className="px-2 pt-1" style={shown ? undefined : { display: "none" }}>{children}</div>
    </div>
  );
};

export default FormLine;
