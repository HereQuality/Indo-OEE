"use strict";
/**
 * app.js — Express Application Factory
 *
 * Configures and exports the Express app instance.
 * Separated from server.js to make it easy to test without starting HTTP server.
 */

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const mongoSanitize = require("express-mongo-sanitize");

const corsOptions = require("./config/corsOptions");
const { globalErrorHandler } = require("./middlewares/errorHandler");
const { notFoundHandler } = require("./middlewares/notFoundHandler");
const apiRouter = require("./routes");
const logger = require("./config/logger");
 
const app = express();

// ─────────────────────────────────────────────────────────────────────────────
// 1. SECURITY HEADERS (Helmet — should be first)
// ─────────────────────────────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. CORS
// ─────────────────────────────────────────────────────────────────────────────
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Pre-flight for all routes

// ─────────────────────────────────────────────────────────────────────────────
// 3. BODY PARSERS
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// ─────────────────────────────────────────────────────────────────────────────
// 4. DATA SANITIZATION — NoSQL injection prevention
// ─────────────────────────────────────────────────────────────────────────────
app.use(mongoSanitize()); // Strips $ and . from req body/query/params

// ─────────────────────────────────────────────────────────────────────────────
// 5. COMPRESSION
// ─────────────────────────────────────────────────────────────────────────────
app.use(compression());

// ─────────────────────────────────────────────────────────────────────────────
// 6. HTTP REQUEST LOGGING (Morgan → Winston)
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev", {
    skip: function (req, res) { return res.statusCode < 400 } // Only log errors in dev to reduce spam
  }));
} else {
  app.use(
    morgan("combined", {
      stream: { write: (message) => logger.http(message.trim()) },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. HEALTH CHECK (no auth required)
// ─────────────────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. STATIC FILES & API ROUTES
// ─────────────────────────────────────────────────────────────────────────────
const path = require("path");
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api/v1", apiRouter);

// ─────────────────────────────────────────────────────────────────────────────
// 9. 404 HANDLER (must come after all valid routes)
// ─────────────────────────────────────────────────────────────────────────────
app.use(notFoundHandler);

// ─────────────────────────────────────────────────────────────────────────────
// 10. GLOBAL ERROR HANDLER (must be last middleware)
// ─────────────────────────────────────────────────────────────────────────────
app.use(globalErrorHandler);

module.exports = app;