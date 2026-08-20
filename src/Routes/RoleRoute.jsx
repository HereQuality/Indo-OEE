import React, { useContext } from "react";
import { useParams, useLocation, Navigate, Outlet } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { MenuContext } from "../context/MenuContext";
import { getRoleSlug } from "../utils/roleUrl";
import FullPageLoader from "../Components/Common/FullPageLoader";

// Pages every logged-in user may open regardless of menu permissions —
// they aren't "content" pages governed by Manage Role, they're the
// account chrome every role needs (their own dashboard, their own
// profile, etc). Matched against the last segment(s) of the path.
const PERMISSION_EXEMPT_SUFFIXES = [
  "/home",
  "/hqepl-dashboard",
  "/profile",
  "/settings",
  "/shortcuts",
  "/notifications",
];

function isPermissionExempt(pathname) {
  return PERMISSION_EXEMPT_SUFFIXES.some((suffix) => pathname.endsWith(suffix));
}

// ── RoleRoute (outer) ───────────────────────────────────────────────────
// Identity/session gate for the whole "/:roleSlug/..." tree — used ONCE,
// as the parent layout route wrapping <Layout><Outlet/></Layout> (see
// Routes/index.jsx). Deliberately does NOT check per-page `allowedRoles`
// or menu permissions — that's PageGuard's job, applied per child route
// — because those must be re-evaluated on every navigation while THIS
// check (is there a valid, correctly-slugged session at all) shouldn't
// force Layout itself to unmount/remount on every page change. Layout
// mounting once per session (instead of once per navigation) is what
// stops its own effects — and every page's own data hooks — from
// re-firing their API calls on every single route change.
//
// - Not logged in -> send to /login.
// - Logged in but the URL's role slug doesn't match this user's actual
//   role (e.g. an Employee tries to browse to /hqepl/dashboard, or their
//   role slug changed) -> bounce them to their own dashboard.
//
// NOTE: don't pass state={{ from: location }} to <Navigate> here —
// useLocation() returns a new object every render, and <Navigate>'s
// internal effect depends on `state`, so a changing reference re-fires it
// forever (infinite redirect loop). Nothing reads location.state.from, so
// it's dropped entirely.
export default function RoleRoute() {
  const { roleSlug } = useParams();
  const { adminData, isSessionVerified } = useContext(AuthContext);

  if (!isSessionVerified) {
    return <FullPageLoader label="Verifying your session..." />;
  }

  if (!adminData) {
    // No token, or the token didn't resolve to a valid user (expired/invalid).
    return <Navigate to="/login" replace />;
  }

  const expectedSlug = getRoleSlug(adminData);

  if (expectedSlug && roleSlug !== expectedSlug) {
    const fallback = adminData?.roleType === "SuperAdmin"
      ? `/hqepl/hqepl-dashboard`
      : `/${expectedSlug}/home`;
    return <Navigate to={fallback} replace />;
  }

  // Admin routing to an employee URL should bounce to the admin's redirectUrl
  if (expectedSlug !== 'hqepl' && adminData.roleType === 'SuperAdmin') {
    return <Navigate to={adminData?.redirectUrl || '/hqepl/hqepl-dashboard'} replace />;
  }

  return <Outlet />;
}

// ── PageGuard (inner) ────────────────────────────────────────────────────
// Per-route gate: `allowedRoles` lock-down + Manage Role menu-permission
// check. Applied to each individual child route's element (inside the
// persistent Layout's <Outlet/>), so it re-evaluates on every navigation
// (as it must — permissions are per-page) without requiring Layout itself
// to remount.
export function PageGuard({ children, allowedRoles }) {
  const location = useLocation();
  const { adminData } = useContext(AuthContext);
  const { isAdmin, loading: menusLoading, findMenuIdByUrl, getPermissionsForMenu } =
    useContext(MenuContext);

  const expectedSlug = getRoleSlug(adminData);

  if (allowedRoles && !allowedRoles.includes(adminData.roleType)) {
    const fallback = adminData?.roleType === "SuperAdmin"
      ? `/hqepl/hqepl-dashboard`
      : `/${expectedSlug}/home`;
    return <Navigate to={fallback} replace />;
  }

  // ── Menu-level permission gate ──────────────────────────────────────
  // Everything above only checks "is this the right role's URL space".
  // It does NOT check whether the role was actually granted access to
  // THIS page in Manage Role. Without this block, an Employee whose
  // role has zero (or read:false) permissions on a menu could still
  // open it by typing/pasting the URL directly, even though the
  // sidebar correctly hides the link. SuperAdmin bypasses this (full
  // access by definition); everyone else must have an explicit `read`
  // permission on the menu that owns this URL.
  if (!isAdmin) {
    // Base account pages (own dashboard, profile, settings, shortcuts)
    // are always reachable — they aren't governed by Manage Role.
    if (!isPermissionExempt(location.pathname)) {
      if (menusLoading) {
        return <FullPageLoader label="Loading your workspace..." />;
      }

      const menuId = findMenuIdByUrl(location.pathname);

      // No matching menu at all (page not assigned to this role's menu
      // set, or role has no menus configured) -> not visible, not
      // reachable by URL either.
      if (!menuId) {
        return <Navigate to="/no-access" replace />;
      }

      const permissions = getPermissionsForMenu(menuId);
      if (!permissions.view) {
        return <Navigate to="/no-access" replace />;
      }
    }
  }

  return children;
}
