import React, { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { MACHINE_STATUSES } from "../../utils/productionSheet";

/**
 * components/Production/MachineStatusSelect.jsx
 * ────────────────────────────────────────────────
 * Machine Working Status on every sheet's entry form: a dropdown holding a
 * tick box per status (Machine Breakdown, No Manpower, No Planning) — any
 * number of them, or none. The closed box lists what's ticked.
 * `value` is the ticked list; onChange gets the new list, in MACHINE_STATUSES order.
 */
const MachineStatusSelect = ({ value = [], onChange, invalid = false }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listId = useId();
  const ticked = Array.isArray(value) ? value : [];

  // Closes on a tap/click anywhere else, or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const toggle = (status) =>
    onChange(MACHINE_STATUSES.filter((s) => (s === status ? !ticked.includes(s) : ticked.includes(s))));

  return (
    <div ref={rootRef} className="position-relative">
      <button
        type="button"
        className={`form-select form-select-sm text-start text-truncate ${invalid ? "is-invalid" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        title={ticked.join(", ")}
      >
        {ticked.length ? ticked.join(", ") : <span className="text-muted">None</span>}
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="position-absolute start-0 end-0 mt-1 bg-body border rounded shadow-sm p-2"
          style={{ zIndex: 1060 }}
        >
          {MACHINE_STATUSES.map((status) => {
            const id = `${listId}-${status.replace(/\W+/g, "-")}`;
            return (
              <div key={status} className="form-check py-1 mb-0">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id={id}
                  checked={ticked.includes(status)}
                  onChange={() => toggle(status)}
                />
                <label className="form-check-label small w-100" htmlFor={id} style={{ cursor: "pointer" }}>
                  {status}
                </label>
              </div>
            );
          })}
          <div className="d-flex justify-content-end border-top pt-2 mt-1">
            <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={() => setOpen(false)}>
              <ChevronDown size={14} /> Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MachineStatusSelect;
