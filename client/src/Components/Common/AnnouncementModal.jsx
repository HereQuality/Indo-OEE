import { Megaphone, X } from "lucide-react";

/**
 * Components/Common/AnnouncementModal.jsx
 * ──────────────────────────────────────────
 * Purely presentational popup for whatever the SuperAdmin has set in
 * Announcement Mode (Components/Common/AnnouncementModeCard.jsx). The
 * "show once a day" decision and dismiss-state live in App.jsx (via
 * useOncePerDayPopup), which also sequences this against
 * MaintenanceAnnouncementModal so the two never show stacked on top of
 * each other.
 */
export default function AnnouncementModal({ open, onDismiss, message }) {
  if (!open || !message) return null;

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
            <Megaphone className="h-[18px] w-[18px] text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-brand-600 dark:text-brand-400 uppercase mb-0.5">Announcement</p>
            <h4 className="text-base font-bold text-slate-900 dark:text-white leading-tight">Heads up!</h4>
          </div>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
          {message}
        </p>

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
