import React, { useEffect } from 'react';

const DeleteModal = ({ show, handleDelete, toggle, disabled }) => {
  // Keyboard shortcuts while the confirm dialog is open: Enter confirms
  // delete, Escape cancels — same pattern used everywhere this modal is
  // rendered (Machine/Operator/Process/Standard Time Master, etc.), so this
  // one component covers the whole app.
  useEffect(() => {
    if (!show) return;
    const onKeyDown = (e) => {
      if (disabled) return;
      if (e.key === 'Enter') { e.preventDefault(); handleDelete(e); }
      else if (e.key === 'Escape') { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [show, disabled, handleDelete, toggle]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50" onClick={disabled ? undefined : toggle} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01M10.29 3.86l-8.18 14.14A1 1 0 003 19.5h18a1 1 0 00.86-1.5L13.71 3.86a1 1 0 00-1.72 0z"
            />
          </svg>
        </div>
        <h4 className="text-base font-semibold text-slate-900 mb-1">Are you sure?</h4>
        <p className="text-sm text-slate-500 mb-6">
          Are you sure you want to remove this record? This action cannot be undone.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={toggle}
            disabled={disabled}
            className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2.5 transition-colors disabled:opacity-60"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={disabled}
            className="rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors disabled:opacity-70"
          >
            {disabled ? 'Deleting...' : 'Yes, Delete It!'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteModal;