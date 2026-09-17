import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { RefreshCw, LogOut, LogIn, Gamepad2 } from "lucide-react";
import GameArcade from "../Components/Common/GameArcade";
import defaultFavicon from "../assets/Fevicon_hqepl.png";

dayjs.extend(relativeTime);

/**
 * pages/UnderMaintenance.jsx
 * ────────────────────────────
 * Rendered directly by App.jsx (not a route — see App.jsx's own comment)
 * in place of the ENTIRE app whenever maintenance mode is active and the
 * signed-in visitor isn't SuperAdmin. Nothing else on the site is
 * reachable while this is up — see middlewares/maintenance.middleware.js
 * for the server-side half of that guarantee.
 *
 * Styled as a real status page (header + left-aligned content + the
 * tenant's own favicon as a large watermark) on a neutral near-black
 * background — not the app's own blue brand tint, which read as "too
 * blue" for a full-screen state. The mini-arcade opens as a right-hand
 * panel on wide screens (stacks below on narrow ones).
 */
export default function UnderMaintenance({
  message,
  scheduledAt,
  companyName,
  companyLogo,
  companyFavicon,
  isLoggedIn,
  onSignOut,
  onRefresh,
  checking,
}) {
  const [showArcade, setShowArcade] = useState(false);
  const watermark = companyFavicon || defaultFavicon;

  const scheduled = useMemo(() => {
    if (!scheduledAt) return null;
    const d = dayjs(scheduledAt);
    if (!d.isValid()) return null;
    return {
      verb: d.isAfter(dayjs()) ? "We'll be back on" : "We were due back on",
      date: d.format("D MMMM"),
      time: d.format("h:mm A"),
      relative: d.fromNow(),
    };
  }, [scheduledAt]);

  document.title = `Under Maintenance | ${companyName || import.meta.env.VITE_APP_NAME}`;

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-zinc-950 font-body">
      {/* Brand watermark — the tenant's own favicon, huge and faint,
          bleeding off the corner. Signature branded element instead of
          generic decoration. */}
      <img
        src={watermark}
        alt=""
        aria-hidden="true"
        className="pointer-events-none select-none absolute -right-20 -bottom-20 w-[420px] h-[420px] sm:w-[560px] sm:h-[560px] object-contain opacity-[0.06] grayscale"
      />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Slim header */}
        <header className="flex items-center justify-between px-6 sm:px-12 py-6 sm:py-8">
          <div className="flex items-center gap-2 min-w-0">
            {companyLogo ? (
              <img src={companyLogo} alt={companyName} className="h-8 w-auto" />
            ) : (
              <span className="font-display font-bold text-sm text-white truncate">{companyName || import.meta.env.VITE_APP_NAME || "Indo"}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Under maintenance</span>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 px-6 sm:px-12 py-8">
          <div className="w-full max-w-6xl grid gap-10 lg:grid-cols-[minmax(0,1fr)_460px] items-start">
            <div className="max-w-xl">
              <p className="text-xs font-semibold tracking-[0.2em] text-brand-400 uppercase mb-4">Maintenance</p>
              <h1 className="font-display text-3xl sm:text-[2.75rem] leading-[1.1] font-bold text-white mb-5">
                We're making things better.
              </h1>
              <p className="text-zinc-400 text-[15px] leading-relaxed max-w-md mb-6">
                {message || "This system is temporarily undergoing scheduled maintenance. Thanks for your patience."}
              </p>

              {scheduled && (
                <p className="text-[15px] text-zinc-300 mb-9 pb-8 border-b border-white/10">
                  {scheduled.verb} <span className="font-semibold text-white">{scheduled.date}</span> at{" "}
                  <span className="font-semibold text-white">{scheduled.time}</span>{" "}
                  <span className="text-zinc-500">({scheduled.relative})</span>
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={checking}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 transition-colors"
                >
                  <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
                  Check again
                </button>
                <button
                  type="button"
                  onClick={() => setShowArcade((v) => !v)}
                  className="hidden sm:inline-flex items-center gap-2 rounded-lg border border-white/15 hover:bg-white/5 text-zinc-200 text-sm font-medium px-4 py-2.5 transition-colors"
                >
                  <Gamepad2 className="h-4 w-4" />
                  {showArcade ? "Hide games" : "Play some games"}
                </button>
              </div>
            </div>

            {showArcade && (
              <div className="hidden sm:block rounded-2xl border border-white/10 bg-black/20 p-5 sm:p-6 animate-fadeIn lg:sticky lg:top-8">
                <div className="flex items-center gap-1.5 mb-5 text-zinc-400">
                  <Gamepad2 className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">Mini arcade</span>
                </div>
                <GameArcade />
              </div>
            )}
          </div>
        </main>

        {/* Footer */}
        <footer className="px-6 sm:px-12 py-6 text-xs text-zinc-500">
          {isLoggedIn ? (
            <button type="button" onClick={onSignOut} className="inline-flex items-center gap-1.5 hover:text-zinc-300 transition-colors">
              <LogOut className="h-3.5 w-3.5" />
              Not you? Sign out
            </button>
          ) : (
            <Link to="/login" className="inline-flex items-center gap-1.5 hover:text-zinc-300 transition-colors">
              <LogIn className="h-3.5 w-3.5" />
              Administrator? Sign in
            </Link>
          )}
        </footer>
      </div>
    </div>
  );
}
