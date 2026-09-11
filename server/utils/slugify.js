// Turns a role code/name into a safe, lowercase, URL-friendly segment.
// "Admin" -> "admin", "Store Manager" -> "store-manager", "QA_Lead!" -> "qa-lead"
function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Slugs that must never be assigned to a role because they collide with
// fixed top-level routes in the client app (see client/src/Routes/allRoutes.jsx).
const RESERVED_SLUGS = new Set([
  "",
  "hqepl",     // fixed SuperAdmin portal
  "login",     // public login page
  "api",
]);

module.exports = { slugify, RESERVED_SLUGS };