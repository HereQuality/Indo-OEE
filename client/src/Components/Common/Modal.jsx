import React from 'react';

const SIZE_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

const Modal = ({ isOpen, onClose, title, children, footer, size = 'md' }) => {
  if (!isOpen) return null;
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50" onClick={onClose} />
      <div
        className={`relative w-full ${sizeClass} bg-white rounded-2xl shadow-xl border border-slate-200 max-h-[90vh] flex flex-col animate-fade-in`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-slate-200 shrink-0">{footer}</div>}
      </div>
    </div>
  );
};

export default Modal;