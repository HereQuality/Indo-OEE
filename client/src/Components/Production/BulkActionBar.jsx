import React from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";

/**
 * Components/Production/BulkActionBar.jsx
 * ─────────────────────────────────────────
 * The floating bar the entries table shows once rows are ticked: how many are
 * selected, one button per bulk action (each with how many of the selection it
 * applies to — the rest are skipped, not failed), and a progress strip while
 * the batch runs. Rendered into <body> so no scroll container or sticky column
 * can clip or sit over it.
 */

const TONE = {
  amber: "text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:hover:bg-amber-950/70 dark:border-amber-900",
  blue: "text-blue-700 bg-blue-50 hover:bg-blue-100 border-blue-200 dark:text-blue-300 dark:bg-blue-950/40 dark:hover:bg-blue-950/70 dark:border-blue-900",
  rose: "text-rose-700 bg-rose-50 hover:bg-rose-100 border-rose-200 dark:text-rose-300 dark:bg-rose-950/40 dark:hover:bg-rose-950/70 dark:border-rose-900",
};

/**
 * @param count       rows ticked
 * @param actions     [{ key, label, icon: Icon, count, tone, title, onClick }]
 * @param progress    null, or { label, done, total } while a batch runs
 */
const BulkActionBar = ({ count, actions, progress, onClear }) => {
  if (!count) return null;
  const busy = !!progress;
  return createPortal(
    <div className="fixed inset-x-0 bottom-4 z-[250] flex justify-center px-3 pointer-events-none">
      <div
        role="toolbar"
        aria-label="Actions for the selected entries"
        className="pointer-events-auto w-full max-w-4xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center h-7 min-w-[1.75rem] px-2 rounded-full bg-blue-600 text-white text-sm font-semibold">
              {count}
            </span>
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap">
              {count === 1 ? "entry" : "entries"} selected
            </span>
            {!busy && count < 3 && (
              <span className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                Shift + click ticks a range
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {actions.map(({ key, label, icon: Icon, count: n, tone, title, onClick }) => (
              <button
                key={key}
                type="button"
                disabled={busy || !n}
                onClick={onClick}
                title={n ? title : `None of the selected entries qualify — ${title}`}
                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${TONE[tone]}`}
              >
                <Icon size={15} />
                {label}
                <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-white/80 dark:bg-slate-950/50 text-xs font-semibold">
                  {n}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={onClear}
              disabled={busy}
              aria-label="Clear selection"
              title="Clear selection"
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {busy && (
          <div className="px-4 pb-3" aria-live="polite">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 mb-1.5">
              <Loader2 size={13} className="animate-spin" />
              {progress.label} {progress.done} / {progress.total}
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-200"
                style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default BulkActionBar;
