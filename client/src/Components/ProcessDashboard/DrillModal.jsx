import React, { useMemo, useState } from "react";
import { Modal, ModalBody, ModalHeader } from "reactstrap";
import { displayDay } from "../../utils/productionSheet";
import { DIMENSIONS, FORMATS, calcOf, formatExact, summarize, summarizeBy } from "../../utils/processDashboard";

/**
 * Components/ProcessDashboard/DrillModal.jsx
 * ────────────────────────────────────────────
 * The "full bifurcation" of one figure: opened from a KPI tile, a visual's
 * Break down button, or a cause/reason bar. Shows the measure for the current
 * selection, then the same measure split by machine, operator, item and
 * month/date — plus the entries behind it. Clicking a row in a split filters
 * the whole dashboard to it.
 */
const RECORD_LIMIT = 300;

const Split = ({ rows, dim, ctx, measure, c, onPick }) => {
  const data = useMemo(() => {
    const list = summarizeBy(rows, dim, ctx)
      .map((g) => ({ key: g.key, label: g.label, value: measure.get(g.summary) }))
      .filter((d) => Number.isFinite(d.value));
    return dim === "date" || dim === "month"
      ? list.sort((a, b) => a.key.localeCompare(b.key))
      : list.sort((a, b) => b.value - a.value);
  }, [rows, dim, ctx, measure]);

  const max = Math.max(...data.map((d) => Math.abs(d.value)), 0);
  if (!data.length) return <div className="text-muted small py-4 text-center">Nothing to show for this selection.</div>;

  return (
    <div className="pd-split">
      {data.map((d) => (
        <button type="button" key={d.key} className="pd-split-row" onClick={() => onPick(dim, d.key)} title="Filter the dashboard to this">
          <span className="pd-split-label">{d.label}</span>
          <span className="pd-split-track">
            <span className="pd-split-bar" style={{ width: max ? `${(Math.abs(d.value) / max) * 100}%` : 0, background: c.ok }} />
          </span>
          <span className="pd-split-value">{formatExact(measure.format, d.value)}</span>
        </button>
      ))}
    </div>
  );
};

const Records = ({ rows, ctx }) => {
  const shown = useMemo(() => [...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECORD_LIMIT), [rows]);
  return (
    <>
      <div className="table-responsive" style={{ maxHeight: "55vh" }}>
        <table className="table table-sm align-middle mb-0 pd-table">
          <thead>
            <tr>
              {["Date", "Machine", "Operator", "Item", "Actual", "OK", "Rejected", "Shift (hr)", "Effective (hr)", "Stoppage (min)", "Remarks"].map((h, i) => (
                <th key={h} className={i > 3 && i < 10 ? "text-end" : ""}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const k = calcOf(r);
              return (
                <tr key={r._id}>
                  <td>{displayDay(r.date)}</td>
                  <td className="fw-semibold">{ctx.machineName[r.machine] || "—"}</td>
                  <td>{r.operator || r.workingStatus || "—"}</td>
                  <td>{r.itemName || "—"}</td>
                  <td className="text-end">{formatExact("qty", k.actualQty)}</td>
                  <td className="text-end">{formatExact("qty", Number(r.okQty))}</td>
                  <td className="text-end">{formatExact("qty", k.rejectedQty)}</td>
                  <td className="text-end">{formatExact("qty", k.shiftHours)}</td>
                  <td className="text-end">{formatExact("qty", k.effectiveHours)}</td>
                  <td className="text-end">{formatExact("qty", k.totalStoppageMin)}</td>
                  <td className="text-muted">{r.remarks || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && (
        <div className="text-muted small pt-2">Showing the latest {RECORD_LIMIT} of {rows.length} entries — narrow the filters to see the rest.</div>
      )}
    </>
  );
};

const DrillModal = ({ measure, rows, ctx, c, onClose, onPick }) => {
  const tabs = ["machine", "operator", "item", ctx.bucket, "records"];
  // This component stays mounted between openings, and the time tab flips
  // between "date" and "month" with the loaded period — so a remembered tab
  // may no longer exist.
  const [pickedTab, setTab] = useState("machine");
  const tab = tabs.includes(pickedTab) ? pickedTab : "machine";
  const total = useMemo(() => (measure ? measure.get(summarize(rows)) : null), [measure, rows]);
  if (!measure) return null;

  return (
    <Modal isOpen toggle={onClose} size="xl" centered scrollable>
      <ModalHeader toggle={onClose} className="p-3 border-bottom">
        <span className="d-block text-muted text-uppercase" style={{ fontSize: "0.68rem", letterSpacing: "0.05em" }}>Breakdown</span>
        {measure.label}
      </ModalHeader>
      <ModalBody>
        <div className="d-flex flex-wrap align-items-end gap-3 mb-3">
          <div className="fw-bold" style={{ fontSize: "2rem", lineHeight: 1 }}>{FORMATS[measure.format](total)}</div>
          <div className="text-muted small">for the current filters · {rows.length} entr{rows.length === 1 ? "y" : "ies"} · click a row to filter the dashboard to it</div>
        </div>
        <div className="pd-tabs mb-3" role="tablist">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`pd-chip ${tab === t ? "is-on" : ""}`} onClick={() => setTab(t)}>
              {t === "records" ? "Entries" : `By ${DIMENSIONS[t].label}`}
            </button>
          ))}
        </div>
        {tab === "records" ? (
          <Records rows={rows} ctx={ctx} />
        ) : (
          <Split rows={rows} dim={tab} ctx={ctx} measure={measure} c={c} onPick={(dim, key) => { onPick(dim, key); onClose(); }} />
        )}
      </ModalBody>
    </Modal>
  );
};

export default DrillModal;
