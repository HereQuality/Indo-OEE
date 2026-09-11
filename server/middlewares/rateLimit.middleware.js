"use strict";
/**
 * middlewares/rateLimit.middleware.js
 *
 * Per-IP request throttling for the auth endpoints. The account-level
 * lockout in auth.controller.js (loginAttempts / MAX_LOGIN_ATTEMPTS) only
 * protects one known username at a time — it does nothing to stop someone
 * hammering /login or /send-otp with a different username/phone on every
 * request. This adds a second, IP-based layer in front of that.
 */
const rateLimit = require("express-rate-limit");

// Login: a handful of genuine typo retries is normal; 20/15min per IP is
// well above that but far below what a brute-force attempt needs.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { isOk: false, message: "Too many login attempts. Please try again in a few minutes." },
});

// OTP send/verify: tighter, since each send costs an SMS/email and verify
// is the actual brute-force target (guessing a 4-6 digit code).
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { isOk: false, message: "Too many OTP requests. Please try again in a few minutes." },
});

module.exports = { loginLimiter, otpLimiter };
