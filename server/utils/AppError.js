"use strict";
/**
 * utils/AppError.js — Custom Operational Error Class
 *
 * Extends native Error with:
 *  - statusCode  (HTTP status)
 *  - status      ("fail" for 4xx, "error" for 5xx)
 *  - isOperational (true = known error, safe to expose to client)
 *
 * Usage:
 *   throw new AppError("Resource not found", 404);
 *   next(new AppError("Unauthorized", 401));
 */

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;

    // Exclude AppError constructor from the stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
