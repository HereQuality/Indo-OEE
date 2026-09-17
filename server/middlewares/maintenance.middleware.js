"use strict";

/**
 * middlewares/maintenance.middleware.js
 *
 * Global kill-switch enforced server-side (mounted in app.js ahead of the
 * whole /api/v1 router) so the block is real even against a direct API
 * call (Postman, curl) — the frontend route
 * guard (client/src/App.jsx) is only the friendly UI half of this.
 *
 * While MaintenanceMode.isActive is true, every request is rejected with
 * 503 EXCEPT:
 *   - a short allowlist (health check, the status endpoint itself, the
 *     announcement status endpoint — App.jsx polls it unconditionally on
 *     every page load, maintenance or not, so it must stay reachable the
 *     same way /maintenance/status does — auth routes — login/me/logout
 *     must keep working so a SuperAdmin can actually sign in, and so an
 *     already-logged-in client can find out its own role via /auth/me —
 *     and reading company branding, which is ALREADY a public,
 *     unauthenticated GET (see company.routes.js) and is what the Under
 *     Maintenance page itself needs to show the tenant's own logo/name
 *     instead of a blank header).
 *   - a request whose JWT decodes to roleType "SuperAdmin".
 *
 * Deliberately does NOT hit the Operator/User collection — reads
 * `roleType` straight off the token, same fallback auth.middleware.js
 * itself uses, so this stays a cheap, dependency-free check on every
 * single request instead of an extra DB round trip.
 */

const jwt = require("jsonwebtoken");
const { getOrCreateMaintenance } = require("../models/MaintenanceMode");

// Matched against req.path, which — because this is mounted as
// `app.use("/api/v1", blockDuringMaintenance, apiRouter)` — is already
// relative to /api/v1 (e.g. "/maintenance/status", "/auth/login").
// `method: null` means any method; scoping the company entries to GET
// keeps the actual SuperAdmin-only mutations (POST/PUT) out of the
// allowlist — they'd still 403 via their own authorize("SuperAdmin")
// even if let through here, but there's no reason to widen this past
// what's actually needed.
const ALWAYS_ALLOWED = [
  { method: "GET", path: /^\/maintenance\/status$/ },
  { method: "GET", path: /^\/announcement\/status$/ },
  { method: null, path: /^\/auth(\/|$)/ },
  { method: "GET", path: /^\/companies\/?(getCompanyDetails)?$/ },
];

const isAlwaysAllowed = (req) =>
  ALWAYS_ALLOWED.some(({ method, path }) => (!method || method === req.method) && path.test(req.path));

const getRoleTypeFromRequest = (req) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.roleType || null;
  } catch {
    return null; // invalid/expired -> treat as unauthenticated, not SuperAdmin
  }
};

const blockDuringMaintenance = async (req, res, next) => {
  try {
    if (isAlwaysAllowed(req)) return next();

    const maintenance = await getOrCreateMaintenance();
    if (!maintenance.isActive) return next();

    if (getRoleTypeFromRequest(req) === "SuperAdmin") return next();

    return res.status(503).json({
      isOk: false,
      success: false,
      maintenance: true,
      message: maintenance.message || "This system is currently under scheduled maintenance. Please check back soon.",
      scheduledAt: maintenance.scheduledAt,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { blockDuringMaintenance };
