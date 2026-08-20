// Mirrors server/utils/slugify.js — used only for a live preview in the
// role form; the server is still the source of truth for validation.
export function slugifyPreview(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The URL slug a logged-in user should be routed under.
// Every role — SuperAdmin included — goes through the exact same
// "/:roleSlug/..." route tree (see Routes/allRoutes.jsx). There is no
// separate hardcoded panel per role anymore; only the slug differs:
// - SuperAdmin -> "hqepl"   (fixed, the one seeded platform-owner account)
// - Employee   -> whatever custom slug was set on their role in
//                 Employee Management > Manage Role (e.g. "manager",
//                 or "admin" if that's what the client named their
//                 top role — "admin" isn't reserved, so that's fine)
// To rename any of these, change it here only — nothing else references
// the literal string.
const FIXED_SLUGS = {
  SuperAdmin: "hqepl",
};

export function getRoleSlug(adminData) {
  if (!adminData) return null;
  if (FIXED_SLUGS[adminData.roleType]) return FIXED_SLUGS[adminData.roleType];
  if (adminData.roleType === "Employee") return adminData.roleSlug || "employee";
  return null;
}

// Menu URLs are stored in the DB as absolute paths like
// "/hqepl/employee-management/department". Rewrite the leading segment
// to whatever role slug the current user is browsing under, e.g.
// "/manager/employee-management/department".
export function toRolePath(url, roleSlug) {
  if (!url || !roleSlug) return url;
  // Strip whatever the first path segment is ("/hqepl/..." or
  // "/whatever-old-slug/...") and replace it with the current role slug.
  const suffix = url.replace(/^\/[^/]+/, "");
  return `/${roleSlug}${suffix}`;
}