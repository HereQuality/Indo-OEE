import React, { useEffect, useState } from "react";
import { ListTree, Maximize2, BarChart3, Table2, X, LineChart, LayoutGrid, Layers, Rows3, Activity, Gauge, Radar, AreaChart, PieChart } from "lucide-react";
import { Modal, ModalBody } from "reactstrap";

/**
 * Components/ProcessDashboard/WidgetCard.jsx
 * ────────────────────────────────────────────
 * The frame around every visual: title, a chart ⇄ table switch (the table is
 * the accessible twin of the chart), a Break down button that opens the
 * drill-down for the visual's measure, and Maximize.
 *
 * Maximize opens the same visual in a centered pop-up — re-rendered at the
 * larger size, not a scaled picture — rather than taking over the whole page:
 * the dashboard stays visible behind it and one click outside closes it. The
 * pop-up has its own chart ⇄ table switch and always opens on the chart,
 * whatever the card underneath is showing. Its table is kept to the width of
 * its content instead of being stretched across the pop-up.
 *
 * `children` is a render prop: ({ view, expanded, showChart }) => visual (showChart flips the card back to its chart).
 * `unit` is what the dashboard is broken down by — "machine", or "worker" on a
 * worker-based process.
 */
const IconButton = ({ title, onClick, active, children }) => (
  <button type="button" className={`pd-icon-btn ${active ? "is-on" : ""}`} title={title} aria-label={title} onClick={onClick}>
    {children}
  </button>
);

// Chart | Table — both choices always visible, the current one highlighted,
// so there is never a doubt how to get the graph back.
const ViewToggle = ({ view, onChange }) => (
  <div className="pd-vt" role="group" aria-label="View">
    <button type="button" className={`pd-vt-btn ${view === "chart" ? "is-on" : ""}`} aria-pressed={view === "chart"} title="Show as chart" onClick={() => onChange("chart")}>
      <BarChart3 size={14} /> Chart
    </button>
    <button type="button" className={`pd-vt-btn ${view === "table" ? "is-on" : ""}`} aria-pressed={view === "table"} title="Show as table" onClick={() => onChange("table")}>
      <Table2 size={14} /> Table
    </button>
  </div>
);

const DrillButton = ({ onDrill, unit }) => (
  <IconButton title={`Break down by ${unit}, operator, item, date`} onClick={onDrill}>
    <ListTree size={15} />
  </IconButton>
);

// A small icon per kind of graph, so each card reads at a glance.
const KIND_ICON = { lines: LineChart, hbars: Rows3, vbars: BarChart3, stacked: Layers, stackedTime: Layers, treemap: LayoutGrid, multiples: Activity, table: Table2, radial: Gauge, radar: Radar, area: AreaChart, donut: PieChart, nestedTreemap: LayoutGrid };

const WidgetCard = ({ title, hint, size = "md", height = 320, tableOnly = false, onDrill, resetKey, preview, tone, unit = "machine", children }) => {
  const KindIcon = KIND_ICON[preview] || BarChart3;
  const [view, setView] = useState("chart");
  // Any change to the dashboard's filters (a bar, a table row, Clear, the
  // date range) puts the card back on its chart so the new result shows.
  useEffect(() => { setView("chart"); }, [resetKey]);
  const [expanded, setExpanded] = useState(false);
  const [popView, setPopView] = useState("chart");

  const openPopup = () => {
    setPopView("chart");
    setExpanded(true);
  };
  const closePopup = () => setExpanded(false);
  const popIsTable = tableOnly || popView === "table";

  return (
    <div className={`pd-card pd-span-${size}${tableOnly ? " pd-card-table" : ""}`}>
      <div className="pd-card-head d-flex flex-wrap align-items-start justify-content-between gap-2 mb-2">
        <div className="d-flex align-items-start gap-2" style={{ minWidth: 0, flex: "1 1 200px" }}>
          <span className={`pd-kind pd-kind-${tone || "ok"}`} aria-hidden="true"><KindIcon size={16} /></span>
          <div style={{ minWidth: 0 }}>
            {/* Title only — the longer explanation shows on hover, not as a second line of text. */}
            <h6 className="pd-card-title fw-semibold mb-0" title={hint || undefined}>{title}</h6>
          </div>
        </div>
        <div className="d-flex align-items-center gap-1 flex-shrink-0">
          {!tableOnly && <ViewToggle view={view} onChange={setView} />}
          {onDrill && <DrillButton onDrill={onDrill} unit={unit} />}
          <IconButton title="Maximize" onClick={openPopup}>
            <Maximize2 size={15} />
          </IconButton>
        </div>
      </div>
      {/* A chart needs a fixed stage for ResponsiveContainer; a table-only
          card (machineSummary) is only as tall as its rows — one machine
          shouldn't leave a few hundred pixels of blank card below it. */}
      <div style={tableOnly ? { maxHeight: height, overflow: "auto" } : { height }}>
        {children({ view, expanded: false, showChart: () => setView("chart") })}
      </div>

      <Modal isOpen={expanded} toggle={closePopup} size="xl" centered className="pd-pop">
        <div className="pd-pop-head">
          <div style={{ minWidth: 0, flex: "1 1 180px" }}>
            <h5 className="fw-semibold mb-0" title={hint || undefined}>{title}</h5>
          </div>
          <div className="d-flex align-items-center gap-1 flex-shrink-0">
            {!tableOnly && <ViewToggle view={popView} onChange={setPopView} />}
            {onDrill && <DrillButton onDrill={onDrill} unit={unit} />}
            <IconButton title="Close" onClick={closePopup}>
              <X size={17} />
            </IconButton>
          </div>
        </div>
        <ModalBody className="pd-pop-body">
          {/* A chart gets a fixed stage to fill; a table is only as big as its rows. */}
          <div className={popIsTable ? "pd-pop-table" : "pd-pop-chart"}>
            {expanded && children({ view: popView, expanded: true })}
          </div>
        </ModalBody>
      </Modal>
    </div>
  );
};

export default WidgetCard;
