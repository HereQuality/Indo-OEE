/**
 * Components/ProcessDashboard/chartTheme.js
 * ────────────────────────────────────────────
 * Chart colours, from the validated categorical palette (same one
 * Components/Production used). Colour follows the entity, never its rank:
 * OK / run time / OEE = blue, rejected = orange, downtime = aqua. The four
 * `series` slots are used in this fixed order wherever a chart needs several
 * series (the three OEE lines, the four stoppage groups). Aqua and yellow sit
 * under 3:1 contrast on the light surface, which is why every visual has a
 * table view.
 */
export const THEME = {
  light: {
    series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"],
    ok: "#2a78d6", reject: "#eb6834", downtime: "#1baf7a",
    surface: "#ffffff", grid: "#e1e0d9", axis: "#52514e", muted: "#898781", ink: "#0b0b0b",
  },
  dark: {
    series: ["#3987e5", "#d95926", "#199e70", "#c98500"],
    ok: "#3987e5", reject: "#d95926", downtime: "#199e70",
    surface: "#212121", grid: "#2c2c2a", axis: "#c3c2b7", muted: "#898781", ink: "#ffffff",
  },
};

export const tooltipProps = (c) => ({
  contentStyle: { background: c.surface, border: `1px solid ${c.grid}`, borderRadius: 8, fontSize: 12, color: c.ink },
  labelStyle: { color: c.ink, fontWeight: 600, marginBottom: 2 },
  itemStyle: { color: c.ink, padding: 0 },
  cursor: { fill: c.grid, fillOpacity: 0.35 },
});

export const axisProps = (c) => ({ stroke: c.grid, tick: { fill: c.axis, fontSize: 11 }, tickLine: false });

// Unselected marks fade back when their chart's dimension has a selection.
export const markOpacity = (selected, key) => (!selected.length || selected.includes(key) ? 1 : 0.28);
