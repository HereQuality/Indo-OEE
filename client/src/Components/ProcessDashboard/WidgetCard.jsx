import React, { useState } from "react";
import { ListTree, Maximize2, BarChart3, Table2, X } from "lucide-react";
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
 * `children` is a render prop: ({ view, expanded }) => visual.
 */
const IconButton = ({ title, onClick, active, children }) => (
  <button type="button" className={`pd-icon-btn ${active ? "is-on" : ""}`} title={title} aria-label={title} onClick={onClick}>
    {children}
  </button>
);

const ViewToggle = ({ view, onChange }) => (
  <IconButton title={view === "chart" ? "Show as table" : "Show as chart"} onClick={() => onChange(view === "chart" ? "table" : "chart")} active={view === "table"}>
    {view === "chart" ? <Table2 size={15} /> : <BarChart3 size={15} />}
  </IconButton>
);

const DrillButton = ({ onDrill }) => (
  <IconButton title="Break down by machine, operator, item, date" onClick={onDrill}>
    <ListTree size={15} />
  </IconButton>
);

const WidgetCard = ({ title, hint, size = "md", height = 300, tableOnly = false, onDrill, children }) => {
  const [view, setView] = useState("chart");
  const [expanded, setExpanded] = useState(false);
  const [popView, setPopView] = useState("chart");

  const openPopup = () => {
    setPopView("chart");
    setExpanded(true);
  };
  const closePopup = () => setExpanded(false);
  const popIsTable = tableOnly || popView === "table";

  return (
    <div className={`pd-card pd-span-${size}`}>
      <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
        <div style={{ minWidth: 0 }}>
          <h6 className="fw-semibold mb-0">{title}</h6>
          {hint && <div className="text-muted small">{hint}</div>}
        </div>
        <div className="d-flex align-items-center gap-1 flex-shrink-0">
          {!tableOnly && <ViewToggle view={view} onChange={setView} />}
          {onDrill && <DrillButton onDrill={onDrill} />}
          <IconButton title="Maximize" onClick={openPopup}>
            <Maximize2 size={15} />
          </IconButton>
        </div>
      </div>
      {/* A chart needs a fixed stage for ResponsiveContainer; a table-only
          card (machineSummary) is only as tall as its rows — one machine
          shouldn't leave a few hundred pixels of blank card below it. */}
      <div style={tableOnly ? { maxHeight: height, overflow: "auto" } : { height }}>
        {children({ view, expanded: false })}
      </div>

      <Modal isOpen={expanded} toggle={closePopup} size="xl" centered className="pd-pop">
        <div className="pd-pop-head">
          <div style={{ minWidth: 0 }}>
            <h5 className="fw-semibold mb-0">{title}</h5>
            {hint && <div className="text-muted small">{hint}</div>}
          </div>
          <div className="d-flex align-items-center gap-1 flex-shrink-0">
            {!tableOnly && <ViewToggle view={popView} onChange={setPopView} />}
            {onDrill && <DrillButton onDrill={onDrill} />}
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
