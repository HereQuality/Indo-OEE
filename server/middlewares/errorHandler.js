"use strict";
/**
 * middlewares/errorHandler.js — Global Error Handler
 *
 * Catches all errors thrown/passed via next(err) throughout the app.
 * Returns a consistent JSON error response.
 *
 * Error types handled:
 *  - Mongoose CastError      (invalid ObjectId)
 *  - Mongoose ValidationError
 *  - Mongoose duplicate key  (code 11000)
 *  - JWT errors
 *  - Multer errors
 *  - Generic AppError
 */

const logger = require("../config/logger");
const AppError = require("../utils/AppError");

// ── Specific error transformers ───────────────────────────────────────────────
const handleCastErrorDB = (err) =>
  new AppError(`Invalid ${err.path}: ${err.value}`, 400);

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((e) => e.message);
  return new AppError(`Validation failed: ${errors.join(". ")}`, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue)[0];
  return new AppError(
    `Duplicate value for field '${field}'. Please use another value.`,
    409
  );
};

const handleJWTError = () =>
  new AppError("Invalid token. Please log in again.", 401);

const handleJWTExpiredError = () =>
  new AppError("Your token has expired. Please log in again.", 401);

const handleMulterError = (err) => {
  if (err.code === "LIMIT_FILE_SIZE")
    return new AppError(`File too large. Max size: ${process.env.MAX_FILE_SIZE_MB || 5}MB`, 400);
  return new AppError(`File upload error: ${err.message}`, 400);
};

// ── Dev error response (full stack trace) ────────────────────────────────────
const sendErrorDev = (err, res) => {
  logger.error("DEV ERROR:", { message: err.message, stack: err.stack });
  res.status(err.statusCode).json({
    success: false,
    status: err.status,
    message: err.message,
    stack: err.stack,
    error: err,
  });
};

// ── Prod error response (no internals exposed) ────────────────────────────────
const sendErrorProd = (err, res) => {
  if (err.isOperational) {
    // Known, trusted error — safe to send details
    res.status(err.statusCode).json({
      success: false,
      status: err.status,
      message: err.message,
    });
  } else {
    // Unknown/programming error — hide details
    logger.error("UNEXPECTED ERROR:", { message: err.message, stack: err.stack });
    res.status(500).json({
      success: false,
      status: "error",
      message: "Something went wrong. Please try again later.",
    });
  }
};

// ── Global Error Handler Middleware ───────────────────────────────────────────
const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  // Always format Multer errors so the frontend gets the max file size message, even in dev
  let formattedErr = err;
  if (err.name === "MulterError" && err.code === "LIMIT_FILE_SIZE") {
    formattedErr = new AppError("File too large. Max size: 5MB", 400);
    formattedErr.stack = err.stack; // Preserve stack trace for dev
  }

  if (process.env.NODE_ENV === "development") {
    sendErrorDev(formattedErr, res);
  } else {
    let error = { ...err, message: err.message, name: err.name };

    if (error.name === "CastError") error = handleCastErrorDB(error);
    if (error.name === "ValidationError") error = handleValidationErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === "JsonWebTokenError") error = handleJWTError();
    if (error.name === "TokenExpiredError") error = handleJWTExpiredError();
    if (error.name === "MulterError") error = handleMulterError(error);

    sendErrorProd(error, res);
  }
};

module.exports = { globalErrorHandler };
