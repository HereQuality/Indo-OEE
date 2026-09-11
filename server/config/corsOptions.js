"use strict";
/**
 * config/corsOptions.js — CORS Configuration
 *
 * Uses `origin: true` which reflects the request's Origin back,
 * allowing any origin while still supporting credentials (cookies).
 *
 * For production with a specific domain, set ALLOWED_ORIGIN in .env.
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │  .env variable used:                                     │
 * │  ALLOWED_ORIGIN → restrict to a specific domain (optional) │
 * │  Leave unset    → allow all origins (dev/staging)        │
 * └──────────────────────────────────────────────────────────┘
 */

const corsOptions = {
  origin: process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN   // Restrict to exact domain in prod
    : true,                        // Allow all origins (reflects request origin)
  credentials: true,               // Allow cookies / Authorization headers
  optionsSuccessStatus: 200,       // Legacy browser support
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  exposedHeaders: ["X-Total-Count", "Content-Range"],
};

module.exports = corsOptions;
