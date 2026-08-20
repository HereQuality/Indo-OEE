import React from "react";

// Active/Inactive filter toggle used on every Master list page — checked
// shows Active records, unchecked shows Inactive records. Replaces the old
// "All Status / Active Only / Inactive Only" dropdown (no "All" option
// anymore, by design).
const StatusCheckbox = ({ checked, onChange, className = "" }) => (
  <label className={`inline-flex items-center gap-2 cursor-pointer select-none px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white ${className}`}>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
    />
    <span className={`text-sm font-medium ${checked ? "text-green-700" : "text-slate-500"}`}>
      {checked ? "Active" : "Inactive"}
    </span>
  </label>
);

export default StatusCheckbox;
