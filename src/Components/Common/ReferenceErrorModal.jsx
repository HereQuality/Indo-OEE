import React from 'react';

// Shown when a delete is blocked because the record is still referenced
// elsewhere (e.g. a Department that still has Employees assigned to it,
// or a Role that's still assigned to Employees). `referenceData` is
// whatever the backend's error response body contains for a 409 Conflict —
// this renders defensively since the exact shape can vary by endpoint.
const ReferenceErrorModal = ({ isOpen, toggle, title, referenceData }) => {
  if (!isOpen) return null;

  const message =
    referenceData?.message ||
    "This record can't be deleted because it's still being used elsewhere.";

  // Optional list of what's referencing it, if the backend provides one
  // (e.g. referenceData.references = [{ name: 'John Doe', type: 'Employee' }]).
  const references = Array.isArray(referenceData?.references)
    ? referenceData.references
    : [];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50" onClick={toggle} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
          <svg className="w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01M10.29 3.86l-8.18 14.14A1 1 0 003 19.5h18a1 1 0 00.86-1.5L13.71 3.86a1 1 0 00-1.72 0z"
            />
          </svg>
        </div>
        <h4 className="text-base font-semibold text-slate-900 mb-1">
          {title || "Can't Delete Record"}
        </h4>
        <p className="text-sm text-slate-500 mb-4">{message}</p>

        {references.length > 0 && (
          <ul className="text-left text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 max-h-40 overflow-y-auto space-y-1">
            {references.map((ref, idx) => (
              <li key={idx} className="flex items-center justify-between">
                <span>{ref.name || ref.employeeName || ref}</span>
                {ref.type && <span className="text-xs text-slate-400">{ref.type}</span>}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={toggle}
            className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2.5 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReferenceErrorModal;