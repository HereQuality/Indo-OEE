"use strict";
/**
 * utils/asyncHandler.js — Async Route Handler Wrapper
 *
 * Wraps async controller functions to catch rejected promises and
 * pass them to Express's next() error handler automatically.
 *
 * Usage:
 *   router.get("/", asyncHandler(async (req, res) => {
 *     const data = await someAsyncOperation();
 *     res.json({ success: true, data });
 *   }));
 *
 * Without this, you'd need try/catch in every controller.
 */

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
