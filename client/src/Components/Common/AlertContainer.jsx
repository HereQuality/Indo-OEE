import React, { useCallback, useEffect } from "react";

const toastStyles = {
    success: {
        bar: "bg-emerald-500",
        icon: (
            <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
        ),
    },
    error: {
        bar: "bg-red-500",
        icon: (
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
        ),
    },
    warning: {
        // Light amber card, dark brown text — readable, unlike amber on slate.
        card: "bg-amber-50 border-amber-300 shadow-lg",
        text: "text-amber-900 font-medium",
        close: "text-amber-700 hover:text-amber-900",
        bar: "bg-amber-500",
        icon: (
            <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86l-8.18 14.14A1 1 0 003 19.5h18a1 1 0 00.86-1.5L13.71 3.86a1 1 0 00-1.72 0z" />
            </svg>
        ),
    },
    info: {
        bar: "bg-blue-500",
        icon: (
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
    },
};

// The one-button notice (AlertContext's `notice`): the reason, the figures
// behind it, and OK — which has focus, so Enter or Esc closes it straight away.
const NoticeDialog = ({ state, onClose }) => {
    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-[10010] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="notice-title">
            <div className="fixed inset-0 bg-slate-900/50" onClick={onClose} />
            <div className="relative w-full max-w-sm max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-slate-200 p-5 sm:p-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
                    {toastStyles.warning.icon}
                </div>
                <h4 id="notice-title" className="text-base font-semibold text-slate-900 mb-1">
                    {state.title}
                </h4>
                <p className="text-sm text-slate-600 mb-4">{state.message}</p>
                {state.details.length > 0 && (
                    <dl className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-left">
                        {state.details.map(({ label, value, highlight }) => (
                            <div key={label} className="flex items-baseline justify-between gap-3 py-1">
                                <dt className="text-slate-500">{label}</dt>
                                <dd className={`mb-0 text-right font-semibold tabular-nums ${highlight ? "text-red-500" : "text-slate-900"}`}>{value}</dd>
                            </div>
                        ))}
                    </dl>
                )}
                {state.hint && <p className="text-xs text-slate-500 mb-4">{state.hint}</p>}
                <button
                    type="button"
                    autoFocus
                    onClick={onClose}
                    className="w-full sm:w-auto rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold px-6 py-2.5 shadow-sm transition-colors"
                >
                    {state.confirmText}
                </button>
            </div>
        </div>
    );
};

const AlertContainer = ({ toasts, onDismiss, confirmState, onConfirmResult }) => {
    const closeNotice = useCallback(() => onConfirmResult(true), [onConfirmResult]);
    return (
        <>
            {/* Toast stack. Above everything else on the page — Bootstrap modals sit
                at 1055 and the date/select pop-ups at 9999 — or a toast raised from
                inside a modal (the whole entry form is one) renders underneath it. */}
            <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
                {toasts.map((t) => {
                    const style = toastStyles[t.type] || toastStyles.info;
                    return (
                        <div
                            key={t.id}
                            className={`pointer-events-auto relative flex items-start gap-3 border rounded-xl px-4 py-3 overflow-hidden animate-[fadeIn_0.15s_ease-out] ${style.card || "bg-slate-800 border-slate-700 shadow-lg"}`}
                        >
                            <span className={`absolute left-0 top-0 h-full w-1 ${style.bar}`} />
                            <div className="shrink-0 mt-0.5">{style.icon}</div>
                            <p className={`text-sm flex-1 leading-snug ${style.text || "text-slate-200"}`}>{t.message}</p>
                            <button
                                type="button"
                                onClick={() => onDismiss(t.id)}
                                className={`transition-colors shrink-0 ${style.close || "text-slate-400 hover:text-slate-200"}`}
                                aria-label="Dismiss"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    );
                })}
            </div>

            {confirmState?.kind === "notice" && <NoticeDialog state={confirmState} onClose={closeNotice} />}

            {/* Confirm dialog (replaces window.confirm) — above the toasts, and above
                any modal it is asked from */}
            {confirmState && confirmState.kind !== "notice" && (
                <div className="fixed inset-0 z-[10010] flex items-center justify-center p-4">
                    <div
                        className="fixed inset-0 bg-slate-900/50"
                        onClick={() => onConfirmResult(false)}
                    />
                    <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 p-6 text-center">
                        <div
                            className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ${
                                confirmState.tone === "danger" ? "bg-red-50" : "bg-blue-50"
                            }`}
                        >
                            <svg
                                className={`w-6 h-6 ${confirmState.tone === "danger" ? "text-red-500" : "text-blue-500"}`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M12 9v2m0 4h.01M10.29 3.86l-8.18 14.14A1 1 0 003 19.5h18a1 1 0 00.86-1.5L13.71 3.86a1 1 0 00-1.72 0z"
                                />
                            </svg>
                        </div>
                        <h4 className="text-base font-semibold text-slate-900 mb-1">{confirmState.title}</h4>
                        <p className="text-sm text-slate-500 mb-6">{confirmState.message}</p>
                        <div className="flex items-center justify-center gap-3">
                            <button
                                type="button"
                                onClick={() => onConfirmResult(false)}
                                className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2.5 transition-colors"
                            >
                                {confirmState.cancelText}
                            </button>
                            <button
                                type="button"
                                onClick={() => onConfirmResult(true)}
                                className={`rounded-xl text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors ${
                                    confirmState.tone === "danger"
                                        ? "bg-red-600 hover:bg-red-700"
                                        : "bg-brand-600 hover:bg-brand-700"
                                }`}
                            >
                                {confirmState.confirmText}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default AlertContainer;