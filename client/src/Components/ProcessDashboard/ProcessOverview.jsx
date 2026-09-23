import React from "react";
import { ChevronRight, Layers } from "lucide-react";
import "./processDashboard.css";

/**
 * Components/ProcessDashboard/ProcessOverview.jsx
 * ─────────────────────────────────────────────────
 * The dashboard's landing page: every process as a box. It is deliberately a
 * plain menu — it loads NO production data. The entries request only happens
 * after a process is picked (ProcessDashboard), so opening the dashboard is
 * instant however many years of entries exist.
 */
const Tile = ({ title, subtitle, onOpen }) => (
  <button type="button" className="pd-tile" onClick={onOpen}>
    <span style={{ minWidth: 0 }}>
      <span className="pd-tile-name">{title}</span>
      {subtitle && <span className="pd-tile-sub">{subtitle}</span>}
    </span>
    <ChevronRight size={18} className="pd-tile-arrow flex-shrink-0" />
  </button>
);

const machineCount = (count) => `${count} machine${count === 1 ? "" : "s"}`;

const ProcessOverview = ({ processes, machines, loading, onOpen }) => {
  const unassigned = machines.filter((m) => !m.process).length;

  if (loading) return <div className="text-center text-muted py-5">Loading processes…</div>;

  return (
    <div className="pd-root">
      <div className="d-flex flex-wrap align-items-baseline gap-2 mb-4">
        <h5 className="mb-0 fw-bold">Dashboard</h5>
        <span className="text-muted small">Select a process to open its dashboard</span>
      </div>

      {!processes.length && (
        <div className="pd-card text-center text-muted py-5 mb-3">
          <Layers size={28} className="mb-2" />
          <div>No processes yet. Add them in <b>Production › Processes</b> — name each one, assign its machines and choose its graphs.</div>
        </div>
      )}

      {processes.length > 0 && (
        <section className="pd-group">
          <div className="pd-tiles">
            {processes.map((p) => (
              <Tile key={p._id} title={p.processName} subtitle={machineCount(p.machines.length)} onOpen={() => onOpen(p._id)} />
            ))}
          </div>
        </section>
      )}

      {machines.length > 0 && (
        <section className="pd-group">
          <h6 className="pd-group-name">Plant</h6>
          <div className="pd-tiles">
            <Tile title="All machines" onOpen={() => onOpen("all")}
              subtitle={`${machineCount(machines.length)}${unassigned ? ` · ${unassigned} not in any process` : ""}`} />
          </div>
        </section>
      )}
    </div>
  );
};

export default ProcessOverview;
