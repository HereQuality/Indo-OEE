import React, { lazy } from "react";
import { Navigate } from "react-router-dom";
import NotFoundFallback from "./NotFoundFallback";

// Every page is a separate lazy chunk — none of these download until the
// user actually navigates to that route, instead of one multi-MB bundle
// upfront. Routes/index.jsx wraps the whole tree in a single <Suspense>.
//
// A lazy chunk's import() 404s if the browser has an old tab open (or a
// stale cached index.html) from BEFORE a new deploy — the old page still
// references the previous build's chunk filenames/hashes, which no longer
// exist once a new build has been shipped. Left unhandled, that rejected
// promise crashes the whole app to a blank screen (no ErrorBoundary can
// make that graceful, since the real fix is just "get the current
// index.html"). lazyWithRetry does that automatically: on an import
// failure it does ONE full page reload (which re-fetches index.html and
// therefore the current chunk manifest) instead of leaving the user
// stuck looking at nothing. The sessionStorage flag caps it at one retry
// per session so a genuinely broken chunk doesn't reload-loop forever.
function lazyWithRetry(importer) {
  return lazy(async () => {
    try {
      const mod = await importer();
      sessionStorage.removeItem("chunk-reload-attempted");
      return mod;
    } catch (err) {
      if (!sessionStorage.getItem("chunk-reload-attempted")) {
        sessionStorage.setItem("chunk-reload-attempted", "1");
        window.location.reload();
        // Never resolve — the reload is about to replace this page anyway.
        return new Promise(() => {});
      }
      throw err;
    }
  });
}

const Landing = lazyWithRetry(() => import("../pages/Landing"));
const Login = lazyWithRetry(() => import("../pages/Login"));
const Blocked = lazyWithRetry(() => import("../pages/Authentication/Blocked"));
const NoAccess = lazyWithRetry(() => import("../pages/Authentication/NoAccess"));

const HqeplAdmin = lazyWithRetry(() => import("../pages/HqeplAdmin"));
const Home = lazyWithRetry(() => import("../pages/Home"));
const Profile = lazyWithRetry(() => import("../pages/Profile"));
const MenuGroup = lazyWithRetry(() => import("../pages/MenuGroup"));
const MenuMaster = lazyWithRetry(() => import("../pages/MenuMaster"));
const Department = lazyWithRetry(() => import("../pages/Department"));
const RoleMaster = lazyWithRetry(() => import("../pages/RoleMaster"));
const Employee = lazyWithRetry(() => import("../pages/Employee"));
const ManageRole = lazyWithRetry(() => import("../pages/ManageRole"));
const CompanyManagement = lazyWithRetry(() => import("../pages/CompanyManagement"));
const Settings = lazyWithRetry(() => import("../pages/Settings"));
const Shortcuts = lazyWithRetry(() => import("../pages/Shortcuts"));
const TeamMembers = lazyWithRetry(() => import("../pages/TeamMembers"));
const Skills = lazyWithRetry(() => import("../pages/Skills"));
const TeamsBoard = lazyWithRetry(() => import("../pages/TeamsBoard"));
const Support = lazyWithRetry(() => import("../pages/Support"));
const Notifications = lazyWithRetry(() => import("../pages/Notifications"));
const MachineMaster = lazyWithRetry(() => import("../pages/MachineMaster"));
const ProcessMaster = lazyWithRetry(() => import("../pages/ProcessMaster"));
const OperatorMaster = lazyWithRetry(() => import("../pages/OperatorMaster"));
const StandardTimeMaster = lazyWithRetry(() => import("../pages/StandardTimeMaster"));
const ShiftMaster = lazyWithRetry(() => import("../pages/ShiftMaster"));
const GrindingEntry = lazyWithRetry(() => import("../pages/GrindingEntry"));
const Dashboard = lazyWithRetry(() => import("../pages/Dashboard"));

// ── Every logged-in page, defined ONCE ──────────────────────────────────
// Every route renders under "/:roleSlug/<path>" — the role slug is
// resolved per-user by utils/roleUrl.js (SuperAdmin -> "hqepl",
// Employee -> their role's own custom slug).
// RoleRoute (see RoleRoute.jsx) is what actually enforces the two things
// below, using this same list — nothing is duplicated into a second
// "admin" route tree just to change the URL prefix.
//
//   roles: which roleTypes may open this URL at all. Omit it (or leave it
//   undefined) to mean "any authenticated role". Use it to lock a page to
//   specific roles, e.g. Menu Master / Menu Group are SuperAdmin-only
//   screens for defining what pages/menu items exist at all — a client's
//   Admin role only ever assigns access to what's already there, via
//   Manage Role.
//
//   Fine-grained per-page permissions (read/write/edit/delete/print/mail)
//   for Employees are a separate, already-dynamic layer handled by
//   MenuContext (currentPagePermissions) — that's what actually hides
//   buttons/menu links a role's role wasn't granted "read"/"write" on.
//   `roles` here is only the coarse "which portal" gate.
const protectedRoutes = [
  { path: "/profile", component: <Profile /> },
  { path: "/settings", component: <Settings /> },
  { path: "/shortcuts", component: <Shortcuts /> },

  // Company/Employee home — all non-SuperAdmin users land here
  { path: "/home", component: <Home /> },

  // SuperAdmin only — defines the app's page/menu structure itself
  { path: "/hqepl-dashboard", component: <HqeplAdmin />, roles: ["SuperAdmin"] },
  { path: "/menu-groups", component: <MenuGroup />, roles: ["SuperAdmin"] },
  { path: "/menus", component: <MenuMaster />, roles: ["SuperAdmin"] },
  { path: "/company", component: <CompanyManagement />, roles: ["SuperAdmin"] },

  // Shared by SuperAdmin and every Employee role alike — what each one
  // actually sees/can edit inside these pages is still narrowed by their
  // menu permissions (MenuContext), not by a second copy of the page.
  { path: "/employee-management/department", component: <Department /> },
  { path: "/employee-management/role", component: <RoleMaster /> },
  { path: "/employee-management/employee", component: <Employee /> },
  { path: "/employee-management/manage-role", component: <ManageRole /> },
  { path: "/employee-management/team-members", component: <TeamMembers /> },
  // Other Routes
  { path: "/skills", component: <Skills /> },
  { path: "/teams", component: <TeamsBoard /> },
  { path: "/support", component: <Support /> },
  { path: "/notifications", component: <Notifications /> },

  // Production module
  { path: "/production/machines", component: <MachineMaster /> },
  { path: "/production/processes", component: <ProcessMaster /> },
  { path: "/production/operators", component: <OperatorMaster /> },
  { path: "/production/standard-time", component: <StandardTimeMaster /> },
  { path: "/production/shift-master", component: <ShiftMaster /> },
  { path: "/production/data-entry", component: <GrindingEntry /> },
  { path: "/dashboard", component: <Dashboard /> },

  // Dev-only tool — not registered in Menu Master, reached by direct URL.
];

const publicRoutes = [
  { path: "/", component: <Login /> },
  { path: "/landing", component: <Landing /> },
  { path: "/login", component: <Login /> },
  { path: "/blocked", component: <Blocked /> },
  { path: "/no-access", component: <NoAccess /> },

  // Fallback
  { path: "*", component: <NotFoundFallback /> },
];

export { protectedRoutes, publicRoutes };
