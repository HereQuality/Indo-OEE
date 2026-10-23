import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { MACHINE_STATUSES } from "../../utils/productionSheet";

/**
 * components/Production/MachineStatusSelect.jsx
 * ────────────────────────────────────────────────
 * The Status dropdown on every sheet's entry form: a tick box per status
 * (Machine Breakdown, No Manpower, No Planning) plus a fourth, "Remarks". That one
 * isn't stored on its own: on Apply it opens the form's existing Remarks box and
 * puts the cursor in it (an "entry:open-remarks" event the Remarks section hears).
 * `value` is the ticked status list; onChange gets the new list, in
 * MACHINE_STATUSES order. `remark` is the form's Remarks text, so the box shows
 * ticked while something is written there.
 *
 * `statuses` narrows what's offered (a worker sheet has no machine to break
 * down); a status a saved entry already carries is still listed, ticked, so
 * editing it neither hides nor silently drops it.
 *
 * The list is drawn in a portal at the box's screen position, so a card or the
 * modal's edge can never clip it; it opens upward when there's no room below.
 */
const REMARKS = "Remarks";

const MachineStatusSelect = ({ value = [], onChange, remark = "", invalid = false, statuses = MACHINE_STATUSES }) => {
  const [open, setOpen] = useState(false);
  const [remarksOn, setRemarksOn] = useState(!!remark); // Remarks ticked
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const listId = useId();
  const ticked = Array.isArray(value) ? value : [];
  const offered = MACHINE_STATUSES.filter((s) => statuses.includes(s) || ticked.includes(s));
  // An entry opened for editing, or another row loaded into this form, brings its own text.
  useEffect(() => {
    if (remark) setRemarksOn(true);
  }, [remark]);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const panelH = panelRef.current?.offsetHeight || 230;
    const below = window.innerHeight - r.bottom;
    const up = below < panelH + 12 && r.top > below;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 240) - 8)),
      width: Math.max(r.width, 240),
      top: up ? Math.max(8, r.top - panelH - 4) : r.bottom + 4,
    });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Closes on a tap/click anywhere else, or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => {
      if (!btnRef.current?.contains(e.target) && !panelRef.current?.contains(e.target)) setOpen(false);
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
    onChange(offered.filter((s) => (s === status ? !ticked.includes(s) : ticked.includes(s))));
  const toggleRemarks = () => setRemarksOn((on) => (remark ? true : !on)); // text written there keeps it ticked

  // Apply closes the list and, when Remarks is ticked, opens the Remarks box and puts the cursor in it.
  const apply = () => {
    setOpen(false);
    if (remarksOn || remark) window.dispatchEvent(new Event("entry:open-remarks"));
  };

  const summary = [...ticked, ...(remarksOn || remark ? [REMARKS] : [])].join(", ");

  const row = (id, label, checked, onTick) => (
    <label key={id} htmlFor={id} className="d-flex align-items-center gap-2 px-2 rounded mb-0" style={{ minHeight: 44, cursor: "pointer" }}>
      <input type="checkbox" className="form-check-input m-0" style={{ width: 20, height: 20 }} id={id} checked={checked} onChange={onTick} />
      <span className="flex-fill">{label}</span>
    </label>
  );

  return (
    <div>
      <button
        ref={btnRef}
        type="button"
        className={`form-select form-select-sm text-start text-truncate ${invalid ? "is-invalid" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        title={summary}
      >
        {summary || <span className="text-muted">Select status</span>}
      </button>


      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            className="bg-body border rounded shadow p-2"
            style={{ position: "fixed", zIndex: 2000, left: pos?.left ?? 0, top: pos?.top ?? 0, width: pos?.width ?? 240, visibility: pos ? "visible" : "hidden", maxHeight: "70vh", overflowY: "auto" }}
          >
            {offered.map((status) => row(`${listId}-${status.replace(/\W+/g, "-")}`, status, ticked.includes(status), () => toggle(status)))}
            {row(`${listId}-remarks`, REMARKS, remarksOn || !!remark, toggleRemarks)}
            <button type="button" className="btn btn-primary w-100 mt-2 d-inline-flex justify-content-center align-items-center gap-1" style={{ minHeight: 42 }} onClick={apply}>
              <Check size={16} /> Apply
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default MachineStatusSelect;
