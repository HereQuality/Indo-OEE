import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { CalendarClock, X } from "lucide-react";

dayjs.extend(relativeTime);

/**
 * Components/Common/MaintenanceAnnouncementModal.jsx
 * ────────────────────────────────────────────────────
 * Purely presentational heads-up popup for an upcoming scheduled
 * maintenance window (separate from the hard block in
 * App.jsx/UnderMaintenance.jsx — this fires BEFORE the switch is
 * flipped, while the app is still fully usable). The "show once a day"
 * decision and dismiss-state live in App.jsx (via useOncePerDayPopup),
 * which also sequences this against AnnouncementModal so the two never
 * show stacked on top of each other. Same card style as
 * AnnouncementModal.jsx for consistency between the two popups.
 */
export default function MaintenanceAnnouncementModal({ open, onDismiss, scheduledAt, message }) {
  if (!open || !scheduledAt) return null;

  const d = dayjs(scheduledAt);
  if (!d.isValid()) return null;

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onDismiss} />
      <div className="relative w-full max-w-sm bg-white dark:bg-navy-900 rounded-2xl shadow-xl border border-slate-200 dark:border-white/10 p-6 animate-slideUp">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute top-4 right-4 rounded-full p-1 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-500/15">
            <CalendarClock className="h-[18px] w-[18px] text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-brand-600 dark:text-brand-400 uppercase mb-0.5">Heads up</p>
            <h4 className="text-base font-bold text-slate-900 dark:text-white leading-tight">Scheduled maintenance</h4>
          </div>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-5">
          {message || "This system will undergo brief scheduled maintenance."}
        </p>

        <div className="flex items-center gap-2.5 text-sm mb-6 pb-5 border-b border-slate-100 dark:border-white/10">
          <CalendarClock className="h-4 w-4 text-brand-500 dark:text-brand-400 shrink-0" />
          <span className="text-slate-500 dark:text-slate-400">Starts:</span>
          <span className="font-semibold text-slate-800 dark:text-slate-100">{d.format("D MMM, h:mm A")}</span>
          <span className="text-slate-400 dark:text-slate-500">({d.fromNow()})</span>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 transition-colors"
        >
          Got it, thanks
        </button>
      </div>
    </div>
  );
}
