import React, { useEffect } from 'react';

const variantMap = {
  danger: {
    iconBg: 'bg-red-50',
    iconColor: 'text-red-500',
    confirmBtn: 'bg-red-600 hover:bg-red-700',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86l-8.18 14.14A1 1 0 003 19.5h18a1 1 0 00.86-1.5L13.71 3.86a1 1 0 00-1.72 0z" />
      </svg>
    ),
  },
  warning: {
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-500',
    confirmBtn: 'bg-amber-500 hover:bg-amber-600',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86l-8.18 14.14A1 1 0 003 19.5h18a1 1 0 00.86-1.5L13.71 3.86a1 1 0 00-1.72 0z" />
      </svg>
    ),
  },
  info: {
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-500',
    confirmBtn: 'bg-brand-600 hover:bg-brand-700',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  success: {
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-500',
    confirmBtn: 'bg-emerald-600 hover:bg-emerald-700',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
};

const ConfirmAlert = ({
  isOpen,
  variant = 'danger',
  title = 'Are you sure?',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onCancel?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const v = variantMap[variant] ?? variantMap.danger;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-slate-900/50"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 p-6 text-center">
        <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ${v.iconBg}`}>
          <span className={v.iconColor}>{v.icon}</span>
        </div>
        <h4 className="text-base font-semibold text-slate-900 mb-1">{title}</h4>
        <p className="text-sm text-slate-500 mb-6">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2.5 transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-xl text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors ${v.confirmBtn}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmAlert;
