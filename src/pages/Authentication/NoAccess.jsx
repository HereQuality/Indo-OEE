import React from "react";
import { Link } from "react-router-dom";

// Shown when a logged-in user's role has no `read` permission on the
// page they tried to open (either typed the URL directly, or an old
// bookmark points at a page Manage Role no longer grants them).
// Distinct from Blocked.jsx, which is for a fully blocked account.
export default function NoAccess() {
  document.title = `Access Denied | ${window.localStorage.getItem('companyName') || import.meta.env.VITE_APP_NAME}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full text-center space-y-8">
        <div>
          <div className="mx-auto flex items-center justify-center h-24 w-24 rounded-full bg-amber-100">
            <svg
              className="h-12 w-12 text-amber-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-slate-900">No Access</h2>
          <p className="mt-2 text-sm text-slate-600">
            Your role doesn't have permission to view this page.
          </p>
        </div>

        <div className="bg-white py-6 px-4 shadow rounded-lg sm:px-10 border border-slate-200">
          <p className="text-sm text-slate-700 mb-4">
            If you need access, ask your administrator to grant "Read" (or
            "Write") permission for this page under Employee Management &gt;
            Manage Role.
          </p>
          <div className="mt-6">
            <Link
              to="/"
              className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 transition-colors"
            >
              Back to my dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
