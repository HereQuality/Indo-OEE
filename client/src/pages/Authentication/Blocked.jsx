import React, { useEffect } from "react";
import { Link } from "react-router-dom";

export default function Blocked() {
  document.title = `Access Denied | ${window.localStorage.getItem('companyName') || import.meta.env.VITE_APP_NAME}`;

  useEffect(() => {
    // Bulletproof session clearing when landing on this page
    document.cookie = 'token=; path=/; max-age=0; SameSite=Strict';
    document.cookie = 'role=; path=/; max-age=0; SameSite=Strict';
    localStorage.clear();
    sessionStorage.clear();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full text-center space-y-8">
        <div>
          <div className="mx-auto flex items-center justify-center h-24 w-24 rounded-full bg-red-100">
            <svg
              className="h-12 w-12 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-slate-900">Account Blocked</h2>
          <p className="mt-2 text-sm text-slate-600">
            Your account has been blocked by an administrator. You can no longer access this portal.
          </p>
        </div>
        
        <div className="bg-white py-6 px-4 shadow rounded-lg sm:px-10 border border-slate-200">
          <p className="text-sm text-slate-700 mb-4">
            If you believe this is a mistake, please contact your system administrator to restore access to your account.
          </p>
          <div className="mt-6">
            <Link
              to="/login"
              className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 transition-colors"
            >
              Return to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
