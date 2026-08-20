import React, { useContext, useMemo, useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { MenuContext } from "../context/MenuContext";
import { ThemeContext } from "../context/ThemeContext";
import { useCompany } from "../hooks/useCompany";
import { toRolePath } from "../utils/roleUrl";
const API_URL = import.meta.env.VITE_API_BASE_URL;

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
function getGreetingEmoji() {
  const h = new Date().getHours();
  if (h < 12) return "☀️";
  if (h < 17) return "👋";
  return "🌙";
}

function getInitials(name = "") {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map(w => w[0]).join("").slice(0, 3).toUpperCase();
}

const COLOR_PALETTE = [
  { bg: "#fef3c7", text: "#92400e", darkBg: "rgba(251,191,36,0.15)", darkText: "#fbbf24" },
  { bg: "#dcfce7", text: "#166534", darkBg: "rgba(34,197,94,0.15)", darkText: "#4ade80" },
  { bg: "#fce7f3", text: "#9d174d", darkBg: "rgba(236,72,153,0.15)", darkText: "#f472b6" },
  { bg: "#e0e7ff", text: "#3730a3", darkBg: "rgba(99,102,241,0.15)", darkText: "#818cf8" },
  { bg: "#fef9c3", text: "#713f12", darkBg: "rgba(234,179,8,0.15)", darkText: "#facc15" },
  { bg: "#ffe4e6", text: "#9f1239", darkBg: "rgba(244,63,94,0.15)", darkText: "#fb7185" },
  { bg: "#d1fae5", text: "#065f46", darkBg: "rgba(16,185,129,0.15)", darkText: "#34d399" },
  { bg: "#e0f2fe", text: "#0c4a6e", darkBg: "rgba(14,165,233,0.15)", darkText: "#38bdf8" },
  { bg: "#f3e8ff", text: "#6b21a8", darkBg: "rgba(168,85,247,0.15)", darkText: "#c084fc" },
  { bg: "#ffedd5", text: "#9a3412", darkBg: "rgba(249,115,22,0.15)", darkText: "#fb923c" },
];

function colorFor(name = "") {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

function getStorageKey(userId) {
  return `shortcuts_saved_${userId || "default"}`;
}

const IconArrow = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const ShortcutTile = ({ menu, roleSlug, isDarkMode }) => {
  const navigate = useNavigate();
  const label = menu.menuName || menu.name || "";
  const group = menu.groupName || "";
  const href = toRolePath(menu.url, roleSlug);
  const initials = getInitials(label);
  const color = colorFor(label);

  return (
    <button
      onClick={() => navigate(href)}
      style={{
        background: isDarkMode ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.8)",
        border: isDarkMode ? "1px solid rgba(255,255,255,0.07)" : "1px solid rgba(203,213,225,0.6)",
        backdropFilter: "blur(10px)",
      }}
      className="group rounded-2xl p-3 flex flex-col items-center gap-2 transition-all hover:-translate-y-1 text-center w-full shadow-sm hover:shadow-md"
    >
      <div
        className="h-11 w-11 rounded-xl flex items-center justify-center text-xs font-extrabold shadow-sm transition-transform group-hover:scale-110 select-none"
        style={{
          background: isDarkMode ? color.darkBg : color.bg,
          color: isDarkMode ? color.darkText : color.text,
        }}
      >
        {initials}
      </div>
      <div className="min-w-0 w-full">
        {group && <p style={{ color: isDarkMode ? "rgba(148,163,184,0.7)" : "#94a3b8" }} className="text-[9px] uppercase tracking-wider font-bold truncate">{group}</p>}
        <p style={{ color: isDarkMode ? "#f1f5f9" : "#1e293b" }} className="text-[11px] font-semibold truncate leading-tight">{label}</p>
      </div>
    </button>
  );
};

// Compact live clock + weather widget
const ClockWeather = ({ isDarkMode }) => {
  const [time, setTime] = useState(new Date());
  const [weather, setWeather] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        // Hardcoding to Halol, Gujarat (22.5029° N, 73.4735° E)
        const weatherRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=22.5029&longitude=73.4735&current_weather=true`
        );
        const weatherData = await weatherRes.json();
        if (weatherData?.current_weather) {
          setWeather({ temp: Math.round(weatherData.current_weather.temperature), city: "Halol" });
        }
      } catch { /* silent */ }
    };
    fetchWeather();
  }, []);

  const timeStr = time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const dateStr = time.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Date + time pill */}
      <div
        className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl"
        style={{
          background: isDarkMode ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.85)",
          border: isDarkMode ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(203,213,225,0.6)",
          backdropFilter: "blur(12px)",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={isDarkMode ? "#94a3b8" : "#64748b"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span style={{ color: isDarkMode ? "#e2e8f0" : "#334155" }} className="text-sm font-semibold">{dateStr}</span>
        <span style={{ color: isDarkMode ? "#475569" : "#cbd5e1" }} className="text-sm">·</span>
        <span style={{ color: isDarkMode ? "#f1f5f9" : "#0f172a" }} className="text-sm font-mono font-extrabold tabular-nums tracking-tight">{timeStr}</span>
      </div>

      {/* Weather pill */}
      {weather && (
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
          style={{
            background: isDarkMode ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.85)",
            border: isDarkMode ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(203,213,225,0.6)",
            backdropFilter: "blur(12px)",
          }}
        >
          <span className="text-lg">🌤️</span>
          <span style={{ color: isDarkMode ? "#f1f5f9" : "#0f172a" }} className="text-sm font-extrabold tabular-nums">{weather.temp}°C</span>
          <span style={{ color: isDarkMode ? "#64748b" : "#94a3b8" }} className="text-xs font-medium">{weather.city}</span>
        </div>
      )}
    </div>
  );
};

export default function Home() {
  const { adminData } = useContext(AuthContext);
  const { menuData } = useContext(MenuContext);
  const { isDarkMode } = useContext(ThemeContext);
  const { roleSlug } = useParams();
  const { data: companyDetails } = useCompany();

  const displayName = adminData?.employeeName || adminData?.name || "there";
  const userId = adminData?._id || adminData?.id || null;
  const showDashboardClock = adminData?.preferences?.showDashboardClock !== false;

  const allMenusById = useMemo(() => {
    const map = new Map();
    (menuData || []).forEach(group => {
      if (group.isLink && group.url) {
        const id = `g_${group.groupId}`;
        map.set(id, { id, menuName: group.groupName, url: group.url, icon: group.groupIcon, groupName: "" });
      }
      (group.menus || []).forEach(menu => {
        if (menu.url) {
          const id = `m_${menu.id}`;
          map.set(id, { id, menuName: menu.name || menu.menuName || "", url: menu.url, icon: menu.icon || menu.menuIcon, groupName: group.groupName || "" });
        }
      });
    });
    return map;
  }, [menuData]);

  const savedShortcuts = useMemo(() => {
    try {
      const ids = adminData?.preferences?.shortcuts;
      if (!Array.isArray(ids) || ids.length === 0) {
        const raw = localStorage.getItem(getStorageKey(userId));
        if (!raw) return [];
        return JSON.parse(raw).map(id => allMenusById.get(id)).filter(Boolean);
      }
      return ids.map(id => allMenusById.get(id)).filter(Boolean);
    } catch { return []; }
  }, [allMenusById, adminData?.preferences?.shortcuts, userId]);

  if (companyDetails?.name) document.title = `Home | ${companyDetails.name}`;

  const glass = {
    background: isDarkMode ? "rgba(15,23,42,0.62)" : "rgba(255,255,255,0.76)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: isDarkMode ? "1px solid rgba(255,255,255,0.07)" : "1px solid rgba(203,213,225,0.55)",
  };

  return (
    <div className="w-full">
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        .hu { animation: fadeUp 0.4s ease both; }
        .hu:nth-child(1){animation-delay:.04s} .hu:nth-child(2){animation-delay:.1s} .hu:nth-child(3){animation-delay:.16s}
      `}</style>

      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">

        {/* ── Greeting Bar ── */}
        <div
          className="hu rounded-2xl overflow-hidden shadow-lg relative"
          style={{
            background: isDarkMode
              ? "linear-gradient(135deg,rgba(37,99,235,0.18) 0%,rgba(124,58,237,0.14) 60%,rgba(15,23,42,0.55) 100%)"
              : "linear-gradient(135deg,rgba(37,99,235,0.07) 0%,rgba(124,58,237,0.05) 60%,rgba(255,255,255,0.88) 100%)",
            backdropFilter: "blur(16px)",
            border: isDarkMode ? "1px solid rgba(255,255,255,0.07)" : "1px solid rgba(203,213,225,0.5)",
          }}
        >
          {/* Decorative blobs */}
          <div className="absolute -top-8 -left-8 w-40 h-40 rounded-full blur-3xl pointer-events-none"
            style={{ background: isDarkMode ? "rgba(37,99,235,0.14)" : "rgba(37,99,235,0.06)" }} />
          <div className="absolute -bottom-4 right-16 w-28 h-28 rounded-full blur-2xl pointer-events-none"
            style={{ background: isDarkMode ? "rgba(124,58,237,0.1)" : "rgba(124,58,237,0.05)" }} />

          <div className="relative px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {/* Left: greeting */}
            <div>
              <h1
                className="text-2xl sm:text-3xl font-extrabold flex items-center gap-2 flex-wrap"
                style={{ color: isDarkMode ? "#f1f5f9" : "#0f172a" }}
              >
                {getGreeting()}, {displayName}
                <span className="text-2xl">{getGreetingEmoji()}</span>
              </h1>
              {adminData?.roleName && (
                <p className="text-xs mt-1 font-medium uppercase tracking-wider" style={{ color: isDarkMode ? "#64748b" : "#94a3b8" }}>
                  {adminData.roleName}
                </p>
              )}
            </div>

            {/* Right: date + weather + company logo */}
            <div className="flex items-center gap-3 shrink-0 flex-wrap">
              {showDashboardClock && <ClockWeather isDarkMode={isDarkMode} />}

              {companyDetails?.logo && (
                <img src={companyDetails.logo} alt={companyDetails.name || "Company"} className="h-8 w-auto object-contain" />
              )}
            </div>
          </div>
        </div>

        {/* ── Shortcuts Section ── */}
        <div className="hu rounded-2xl overflow-hidden shadow-lg" style={glass}>
          {/* Header */}
          <div
            className="flex items-center justify-between px-6 py-4"
            style={{
              borderBottom: isDarkMode ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(203,213,225,0.5)",
              background: isDarkMode ? "rgba(255,255,255,0.025)" : "rgba(248,250,252,0.7)",
            }}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="p-1.5 rounded-lg"
                style={{ background: isDarkMode ? "rgba(37,99,235,0.18)" : "rgba(239,246,255,1)" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                </svg>
              </div>
              <p
                className="text-sm font-bold uppercase tracking-wider"
                style={{ color: isDarkMode ? "#f1f5f9" : "#0f172a" }}
              >
                My Shortcuts
              </p>
            </div>
            <Link
              to={`/${roleSlug}/shortcuts`}
              style={{
                textDecoration: "none",
                color: "#2563eb",
                background: isDarkMode ? "rgba(37,99,235,0.14)" : "rgba(239,246,255,1)",
                border: isDarkMode ? "1px solid rgba(37,99,235,0.22)" : "1px solid rgba(147,197,253,0.4)",
              }}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
            >
              Manage <IconArrow />
            </Link>
          </div>

          {/* Grid */}
          <div className="p-5">
            {savedShortcuts.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-3">
                {savedShortcuts.map((m, i) => (
                  <ShortcutTile key={i} menu={m} roleSlug={roleSlug} isDarkMode={isDarkMode} />
                ))}
              </div>
            ) : (
              <div className="py-12 text-center">
                <div
                  className="h-14 w-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                  style={{ background: isDarkMode ? "rgba(255,255,255,0.06)" : "rgba(241,245,249,1)" }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={isDarkMode ? "#475569" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                  </svg>
                </div>
                <p className="text-sm font-semibold mb-1" style={{ color: isDarkMode ? "#f1f5f9" : "#334155" }}>No shortcuts pinned yet</p>
                <p className="text-xs mb-5" style={{ color: isDarkMode ? "#64748b" : "#94a3b8" }}>
                  Pin your frequently used pages for quick one-click access
                </p>
                <Link
                  to={`/${roleSlug}/shortcuts`}
                  style={{ textDecoration: "none", background: "linear-gradient(135deg,#2563eb,#1d4ed8)" }}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-white px-5 py-2.5 rounded-xl hover:opacity-90 shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5"
                >
                  Set Up Shortcuts <IconArrow />
                </Link>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
