import React from "react";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { CHART_CATALOG, STAT_CATALOG } from "../../utils/processDashboard";
import { ChartPreview, StatPreview } from "./WidgetPreview";

/**
 * Components/ProcessDashboard/WidgetPicker.jsx
 * ──────────────────────────────────────────────
 * Picks which KPI tiles and graphs a process's dashboard shows, and in what
 * order. Used by the Process Master form and by the dashboard's own Customize
 * button.
 *
 * Every option is a card carrying its name, what it means and an example of
 * how it looks (a sample figure for a tile, a sketch for a graph), so it can
 * be chosen without already knowing the dashboard. `stats` / `charts` are
 * ordered arrays of catalog keys: ticked cards come first, numbered in their
 * dashboard order, and the arrows move a card earlier or later.
 */
const Gallery = ({ title, note, catalog, selected, onChange, kind }) => {
  const ordered = [
    ...selected.map((k) => catalog.find((w) => w.key === k)).filter(Boolean),
    ...catalog.filter((w) => !selected.includes(w.key)),
  ];
  const toggle = (key) => onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  const move = (key, by) => {
    const i = selected.indexOf(key);
    const j = i + by;
    if (j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <section className="pd-picker mb-4">
      <div className="d-flex flex-wrap align-items-baseline justify-content-between gap-2 mb-2">
        <div>
          <span className="fw-semibold">{title}</span>
          <span className="text-muted small"> · {selected.length} of {catalog.length} selected</span>
          <div className="text-muted small">{note}</div>
        </div>
        <span className="d-flex gap-3 small">
          <button type="button" className="btn btn-link btn-sm p-0" onClick={() => onChange(catalog.map((w) => w.key))}>Select all</button>
          <button type="button" className="btn btn-link btn-sm p-0" onClick={() => onChange([])}>Clear</button>
        </span>
      </div>

      <div className={`pd-gallery pd-gallery-${kind}`}>
        {ordered.map((w) => {
          const i = selected.indexOf(w.key);
          const on = i !== -1;
          return (
            <div key={w.key} className={`pd-option ${on ? "is-on" : ""}`}>
              {/* The whole card is the checkbox's label, so clicking anywhere on it ticks it. */}
              <label className="pd-option-body">
                <input type="checkbox" className="pd-option-input" checked={on} onChange={() => toggle(w.key)} />
                <span className="pd-option-check" aria-hidden="true">{on ? <Check size={13} strokeWidth={3} /> : null}</span>
                <span className="pd-option-preview">{kind === "chart" ? <ChartPreview chart={w} /> : <StatPreview stat={w} />}</span>
                <span className="pd-option-name">{w.label}</span>
                {w.hint && <span className="pd-option-hint">{w.hint}</span>}
              </label>
              {on && (
                <div className="pd-option-order">
                  <button type="button" className="pd-icon-btn" disabled={i === 0} onClick={() => move(w.key, -1)} aria-label={`Show ${w.label} earlier`} title="Show earlier">
                    <ChevronLeft size={15} />
                  </button>
                  <span className="pd-option-pos" title="Position on the dashboard">{i + 1}</span>
                  <button type="button" className="pd-icon-btn" disabled={i === selected.length - 1} onClick={() => move(w.key, 1)} aria-label={`Show ${w.label} later`} title="Show later">
                    <ChevronRight size={15} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

const WidgetPicker = ({ stats, charts, onChange }) => (
  <div>
    <Gallery kind="stat" title="KPI tiles" note="The headline figures across the top of the dashboard. The number on each card is only an example."
      catalog={STAT_CATALOG} selected={stats} onChange={(next) => onChange({ stats: next, charts })} />
    <Gallery kind="chart" title="Graphs" note="Each picture is a sketch of how the graph looks. On the dashboard every graph can be clicked to filter, maximized, shown as a table and broken down."
      catalog={CHART_CATALOG} selected={charts} onChange={(next) => onChange({ stats, charts: next })} />
  </div>
);

export default WidgetPicker;
