import React, { useContext } from "react";
import { AuthContext } from "../context/AuthContext";
import { useEmployees } from "../hooks/useEmployees";
import { useDepartments } from "../hooks/useDepartments";
import { useRoles } from "../hooks/useRoles";

const StatCard = ({ label, value, icon, tone = "brand" }) => {
  const toneMap = {
    brand: "bg-brand-50 text-brand-600 border-brand-100",
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
    amber: "bg-amber-50 text-amber-600 border-amber-100",
    red: "bg-red-50 text-red-600 border-red-100",
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 flex items-center gap-3.5 min-w-0 transition-all hover:shadow-md">
      <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 border ${toneMap[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight truncate">{value}</p>
        <p className="text-xs sm:text-sm font-medium text-slate-500 leading-tight truncate" title={label}>{label}</p>
      </div>
    </div>
  );
};

// ── Single dashboard for everyone ────────────────────────────────────────
// One deployment, one workspace — there's no separate "SuperAdmin sees
// all companies" view anymore. SuperAdmin (the owner, watching over
// everything) and every Employee role see the same operational overview;
// only the greeting/heading framing differs a little.
export default function Home() {
  const { adminData } = useContext(AuthContext);
  const isSuperAdmin = adminData?.roleType === "SuperAdmin";
  const displayName = adminData?.name || adminData?.employeeName || "there";

  const { data: employees = [], isLoading: employeesLoading } = useEmployees();
  const { data: departments = [], isLoading: departmentsLoading } = useDepartments();
  const { data: roles = [], isLoading: rolesLoading } = useRoles();

  const loading = employeesLoading || departmentsLoading || rolesLoading;
  const activeEmployees = employees.filter((e) => e.isActive !== false).length;
  const activeRoles = roles.filter((r) => r.isActive !== false).length;

  return (
    <React.Fragment>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <h2 className="text-xl font-semibold text-slate-900">
          {isSuperAdmin ? "Overview" : `Welcome back, ${displayName.replace(/^Admin - /, "")} 👋`}
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {isSuperAdmin
            ? "Everything currently set up in this workspace."
            : "Here's what's happening with your workspace today."}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Employees"
          value={loading ? "—" : employees.length}
          tone="brand"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-2a4 4 0 100-8 4 4 0 000 8zm6 4a4 4 0 10-8 0" />
            </svg>
          }
        />
        <StatCard
          label="Departments"
          value={loading ? "—" : departments.length}
          tone="emerald"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2M5 21H3m6-14h.01M9 11h.01M9 15h.01M13 7h.01M13 11h.01M13 15h.01" />
            </svg>
          }
        />
        <StatCard
          label="Active Roles"
          value={loading ? "—" : activeRoles}
          tone="amber"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Active Employees"
          value={loading ? "—" : activeEmployees}
          tone="red"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
        <p className="text-sm text-slate-400">
          More home page widgets (charts, recent activity, quick links, etc.) will go here — just let me know what you'd like to see.
        </p>
      </div>
    </React.Fragment>
  );
}
