import React from 'react';

const FormUpdateFooter = ({ handleUpdate, handleUpdateCancel, isLoading, isSaveDisabled, isSaveBlocked }) => {
  // isSaveBlocked looks like isSaveDisabled but stays clickable, so a form can
  // answer the click by pointing at whatever is still missing instead of
  // leaving the user to hunt for it.
  const looksInactive = (isSaveDisabled || isSaveBlocked) && !isLoading;
  return (
    <div className="flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={handleUpdateCancel}
        disabled={isLoading}
        className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2.5 transition-colors disabled:opacity-60"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleUpdate}
        disabled={isLoading || isSaveDisabled}
        aria-disabled={looksInactive || undefined}
        title={looksInactive ? "Fill in the required fields (marked *) first" : undefined}
        className={`inline-flex items-center gap-2 rounded-xl text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors ${
          looksInactive
            ? `bg-slate-200 text-slate-400 shadow-none ${isSaveBlocked && !isSaveDisabled ? "cursor-pointer" : "cursor-not-allowed"}`
            : "bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-70"
        }`}
      >
        {isLoading ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Updating...
          </>
        ) : (
          'Update'
        )}
      </button>
    </div>
  );
};

export default FormUpdateFooter;