import React from "react";

/**
 * Components/ProcessDashboard/WidgetPreview.jsx
 * ───────────────────────────────────────────────
 * The little example picture on each graph card in the Process Master picker,
 * so whoever sets a process up can see what "B.D. Backup" or "Unreported Time
 * by MC No." will look like before ticking it. These are sketches of the
 * chart's shape in the dashboard's own colours — not real data.
 *
 * Colours come from the --pd-s1…s4 tokens in processDashboard.css (the same
 * series colours chartTheme.js uses), so the sketches follow the theme.
 */
const S = ["var(--pd-s1)", "var(--pd-s2)", "var(--pd-s3)", "var(--pd-s4)"];
const TONE = { ok: S[0], reject: S[1], downtime: S[2] };
const GRID = "var(--pd-track)";
const W = 200;
const H = 84;

const Frame = ({ children }) => (
  <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

const Baseline = ({ y = 74 }) => <line x1="14" x2={W - 8} y1={y} y2={y} stroke={GRID} strokeWidth="1.5" />;

const Lines = () => (
  <Frame>
    {[20, 38, 56].map((y) => <line key={y} x1="14" x2={W - 8} y1={y} y2={y} stroke={GRID} strokeWidth="1" />)}
    <Baseline />
    <polyline fill="none" stroke={S[0]} strokeWidth="2.5" strokeLinejoin="round" points="14,24 40,20 66,26 92,18 118,22 144,17 170,21 192,16" />
    <polyline fill="none" stroke={S[2]} strokeWidth="2.5" strokeLinejoin="round" points="14,36 40,31 66,38 92,30 118,35 144,29 170,34 192,28" />
    <polyline fill="none" stroke={S[1]} strokeWidth="2.5" strokeLinejoin="round" points="14,50 40,44 66,55 92,42 118,52 144,40 170,49 192,41" />
  </Frame>
);

const HBars = ({ color }) => (
  <Frame>
    <line x1="52" x2="52" y1="8" y2="78" stroke={GRID} strokeWidth="1.5" />
    {[132, 104, 86, 60, 34].map((w, i) => (
      <g key={w}>
        <rect x="14" y={12 + i * 14} width="30" height="5" rx="2.5" fill={GRID} />
        <rect x="54" y={10 + i * 14} width={w} height="9" rx="3" fill={color} />
      </g>
    ))}
  </Frame>
);

const VBars = ({ color }) => (
  <Frame>
    <Baseline />
    {[52, 58, 46, 55, 40, 50].map((h, i) => <rect key={i} x={24 + i * 28} y={74 - h} width="16" height={h} rx="3" fill={color} />)}
  </Frame>
);

// Four stacked series per bar — breakdown, setup, lunch/tea, other.
const Stacked = () => (
  <Frame>
    <Baseline />
    {[[8, 18, 22, 8], [12, 24, 28, 12], [9, 20, 18, 6], [6, 12, 10, 5], [10, 22, 20, 12]].map((parts, i) => {
      let y = 74;
      return parts.map((h, j) => {
        y -= h;
        return <rect key={`${i}-${j}`} x={26 + i * 32} y={y} width="20" height={h - 1} fill={S[j]} rx={j === parts.length - 1 ? 3 : 0} />;
      });
    })}
  </Frame>
);

// OK with a thin Rejected cap, marching along a date axis.
const StackedTime = () => (
  <Frame>
    <Baseline />
    {[44, 52, 38, 56, 48, 42, 58, 50, 46].map((h, i) => (
      <g key={i}>
        <rect x={18 + i * 20} y={74 - h} width="12" height={h} fill={S[0]} />
        <rect x={18 + i * 20} y={74 - h - 5} width="12" height="4" rx="2" fill={S[1]} />
      </g>
    ))}
  </Frame>
);

const Treemap = () => (
  <Frame>
    {[[14, 8, 96, 44], [14, 54, 96, 24], [112, 8, 44, 70], [158, 8, 34, 46], [158, 56, 34, 22]].map(([x, y, w, h]) => (
      <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx="3" fill={S[0]} />
    ))}
  </Frame>
);

const Multiples = () => (
  <Frame>
    {[[14, 6], [108, 6], [14, 46], [108, 46]].map(([x, y], p) => (
      <g key={p}>
        <line x1={x} x2={x + 80} y1={y + 32} y2={y + 32} stroke={GRID} strokeWidth="1.5" />
        {[10, 22, 8, 26, 14, 6, 18, 12].map((h, i) => (
          <rect key={i} x={x + 4 + i * 9.5} y={y + 32 - ((h + p * 5) % 28)} width="5" height={(h + p * 5) % 28} rx="1.5" fill={S[0]} />
        ))}
      </g>
    ))}
  </Frame>
);

const Table = () => (
  <Frame>
    <rect x="14" y="8" width={W - 28} height="10" rx="3" fill={GRID} />
    {[0, 1, 2, 3].map((r) => (
      <g key={r}>
        <rect x="14" y={27 + r * 14} width="26" height="5" rx="2.5" fill={S[0]} />
        {[0, 1, 2, 3].map((col) => <rect key={col} x={66 + col * 32} y={27 + r * 14} width={18 + ((r + col) % 3) * 4} height="5" rx="2.5" fill={GRID} />)}
      </g>
    ))}
  </Frame>
);

export const ChartPreview = ({ chart }) => {
  const color = TONE[chart.tone] || S[0];
  switch (chart.preview) {
    case "lines": return <Lines />;
    case "hbars": return <HBars color={color} />;
    case "vbars": return <VBars color={color} />;
    case "stacked": return <Stacked />;
    case "stackedTime": return <StackedTime />;
    case "treemap": return <Treemap />;
    case "multiples": return <Multiples />;
    case "table": return <Table />;
    default: return <VBars color={color} />;
  }
};

// A KPI tile's example: the label and a sample figure, as the dashboard shows it.
export const StatPreview = ({ stat }) => (
  <span className="pd-preview-stat" aria-hidden="true">
    {stat.tone && <span className="pd-stat-dot" style={{ background: TONE[stat.tone] }} />}
    {stat.example}
  </span>
);
