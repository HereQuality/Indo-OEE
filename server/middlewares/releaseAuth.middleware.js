"use strict";

const crypto = require("crypto");
const AppError = require("../utils/AppError");

// Constant-time compare so the secret can't be guessed byte-by-byte from
// response timing. Hashing first gives both sides the same length, which
// timingSafeEqual requires.
const sameSecret = (a, b) => {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

/**
 * middlewares/releaseAuth.middleware.js
 * ────────────────────────────────────────
 * Guards machine-to-machine endpoints hit by a build/release SCRIPT, not a
 * logged-in person — there's no user session to check here (this runs
 * right after `flutter build`, before anyone has "logged in" to anything),
 * so `protect`/`authorize` (auth.middleware.js) don't apply. A single
 * shared secret in a header is enough: the only thing this gates is
 * "record what version we just published" — see
 * controllers/appUpdate.controller.js#reportAppVersion — not anything a
 * real attacker gains much from forging (worst case, someone lies about
 * the current build number in a purely informational field).
 *
 * Set APP_UPDATE_REPORT_SECRET in .env and pass the same value as the
 * `x-release-secret` header — see mobile/scripts/report_version.sh, the
 * one caller of this.
 */
const releaseAuth = (req, res, next) => {
  const expected = process.env.APP_UPDATE_REPORT_SECRET;
  if (!expected) {
    return next(new AppError("APP_UPDATE_REPORT_SECRET is not configured on the server.", 500));
  }

  const provided = req.headers["x-release-secret"];
  if (!provided || !sameSecret(provided, expected)) {
    return next(new AppError("Invalid or missing release secret.", 401));
  }

  next();
};

module.exports = { releaseAuth };
