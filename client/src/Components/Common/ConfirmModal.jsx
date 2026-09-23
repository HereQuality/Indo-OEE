import React, { useEffect } from "react";
import { AlertTriangle, Info } from "lucide-react";

/**
 * components/Common/ConfirmModal.jsx
 * ─────────────────────────────────────
 * A proper confirm dialog for non-destructive-but-worth-a-pause actions
 * (e.g. Company Holidays' Weekly Off toggle) — same shape and keyboard
 * shortcuts as DeleteModal, just not red/delete-themed. Use DeleteModal
 * itself for an actual delete; use this for "are you sure" on anything
 * else.
 */
const ConfirmModal = ({
  show,
  onConfirm,
  onCancel,
  disabled,
  title = "Are you sure?",
  message = "",
  confirmLabel = "Yes, continue",
  confirmingLabel = "Saving...",
  variant = "warning", // "warning" | "info"
}) => {
  useEffect(() => {
    if (!show) return;
    const onKeyDown = (e) => {
      if (disabled) return;
      if (e.key === "Enter") { e.preventDefault(); onConfirm(e); }
      else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [show, disabled, onConfirm, onCancel]);

  if (!show) return null;

  const tone = variant === "info"
    ? { bg: "bg-blue-50", text: "text-blue-500", btn: "bg-blue-600 hover:bg-blue-700" }
    : { bg: "bg-amber-50", text: "text-amber-500", btn: "bg-amber-600 hover:bg-amber-700" };
  const Icon = variant === "info" ? Info : AlertTriangle;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50" onClick={disabled ? undefined : onCancel} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 p-6 text-center">
        <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ${tone.bg}`}>
          <Icon className={`w-6 h-6 ${tone.text}`} strokeWidth={2} />
        </div>
        <h4 className="text-base font-semibold text-slate-900 mb-1">{title}</h4>
        {message && <p className="text-sm text-slate-500 mb-6">{message}</p>}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2.5 transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={disabled}
            className={`rounded-xl ${tone.btn} text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors disabled:opacity-70`}
          >
            {disabled ? confirmingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
