import React from "react";

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

const AlertContainer = ({ toasts, onDismiss, confirmState, onConfirmResult }) => {
    return (
        <>
            {/* Toast stack */}
            <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
                {toasts.map((t) => {
                    const style = toastStyles[t.type] || toastStyles.info;
                    return (
                        <div
                            key={t.id}
                            className="pointer-events-auto relative flex items-start gap-3 bg-slate-800 border border-slate-700 shadow-lg rounded-xl px-4 py-3 overflow-hidden animate-[fadeIn_0.15s_ease-out]"
                        >
                            <span className={`absolute left-0 top-0 h-full w-1 ${style.bar}`} />
                            <div className="shrink-0 mt-0.5">{style.icon}</div>
                            <p className="text-sm flex-1 leading-snug text-slate-200">{t.message}</p>
                            <button
                                type="button"
                                onClick={() => onDismiss(t.id)}
                                className="transition-colors shrink-0 text-slate-400 hover:text-slate-200"
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

            {/* Confirm dialog (replaces window.confirm) */}
            {confirmState && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
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