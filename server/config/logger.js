"use strict";
/**
 * config/logger.js — Winston Logger Configuration
 *
 * Levels: error, warn, info, http, verbose, debug, silly
 *
 * In development  → logs to console (colorized)
 * In production   → logs to daily rotating files + console (errors only)
 */

const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const path = require("path");

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const LOG_DIR = process.env.LOG_DIR || "logs";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const NODE_ENV = process.env.NODE_ENV || "development";

// ── Custom console format ────────────────────────────────────────────────────
const devFormat = combine(
  colorize({ all: true }),
  errors({ stack: true }),
  printf(({ level, message, stack, ...meta }) => {
    const cleanMeta = { ...meta };
    const metaStr = Object.keys(cleanMeta).length > 0 ? JSON.stringify(cleanMeta, null, 2) : "";
    return `${message}${stack ? `\n${stack}` : ""}${metaStr ? `\n${metaStr}` : ""}`;
  })
);

// ── JSON format for production files ─────────────────────────────────────────
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

// ── Transports ───────────────────────────────────────────────────────────────
const transports = [];

if (NODE_ENV === "development") {
  transports.push(new winston.transports.Console({ format: devFormat }));
} else {
  // Console: only errors in production
  transports.push(
    new winston.transports.Console({
      level: "error",
      format: devFormat,
    })
  );

  // File: all logs rotating daily
  transports.push(
    new DailyRotateFile({
      dirname: path.join(process.cwd(), LOG_DIR),
      filename: "app-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "30d",
      format: prodFormat,
    })
  );

  // File: error-only rotating log
  transports.push(
    new DailyRotateFile({
      level: "error",
      dirname: path.join(process.cwd(), LOG_DIR),
      filename: "error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "30d",
      format: prodFormat,
    })
  );
}

const logger = winston.createLogger({
  level: LOG_LEVEL,
  transports,
  exitOnError: false, // Do not exit on handled exceptions
});

module.exports = logger;
