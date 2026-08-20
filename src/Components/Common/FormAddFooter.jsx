import React from 'react';

const FormsFooter = ({ handleSubmit, handleSubmitCancel, isLoading, isSaveDisabled }) => {
  return (
    <div className="flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={handleSubmitCancel}
        disabled={isLoading}
        className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2.5 transition-colors disabled:opacity-60"
      >
        Cancel
      </button>
      <button
        type="submit"
        onClick={handleSubmit}
        disabled={isLoading || isSaveDisabled}
        className="inline-flex items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors disabled:opacity-70"
      >
        {isLoading ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Saving...
          </>
        ) : (
          'Save'
        )}
      </button>
    </div>
  );
};

export default FormsFooter;   