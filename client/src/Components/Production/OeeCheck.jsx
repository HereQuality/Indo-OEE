import React from "react";
import { AlertTriangle } from "lucide-react";
import { OEE_METRIC_LABELS } from "../../utils/productionSheet";

/**
 * components/Production/OeeCheck.jsx
 * ─────────────────────────────────────
 * The live warning on every sheet's entry form when this entry's
 * Availability / Performance / Quality (rowCalc's own figures, still worked out
 * and saved — just not shown as boxes) or any OEE figure of its day (the
 * Productivity figures on a worker sheet — see withDayFigures) goes above 100%:
 * the entry still saves, but goes to Admin review — the figure is never
 * capped. `calc` is the sheet's row calc of the form values (planned shift
 * already in decimal hours) with the day's figures; `over` is the metric keys
 * above 100%.
 */
const OeeCheck = ({ over = [] }) => (
  <div className="mb-2">
    {over.length > 0 && (
      <p className="d-flex align-items-start gap-2 small bg-warning-subtle text-warning-emphasis rounded px-2 py-1 mt-1 mb-0" role="status">
        <AlertTriangle size={15} className="flex-shrink-0 mt-1" />
        <span>
          {over.map((k) => OEE_METRIC_LABELS[k]).join(", ")} above 100% — this entry will still save, but goes to Admin
          review. Check the cycle time, quantities and stoppage.
        </span>
      </p>
    )}
  </div>
);

export default OeeCheck;
