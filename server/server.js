"use strict";
/**
 * server.js — Application Entry Point
 *
 * Responsibilities:
 *  - Load environment variables (FIRST thing, before any other imports)
 *  - Connect to MongoDB
 *  - Start the HTTP server
 *
 * NOTE: Express app configuration lives in app.js (routes, middleware, etc.)
 */

const dotenv = require("dotenv");

// ── 1. Load env vars before anything else ───────────────────────────────────
dotenv.config();

const app = require("./app");
const http = require("http");
const connectDB = require("./config/db");
const logger = require("./config/logger");
const { initSocket } = require("./socket");
require("./workers/profileWorker"); // Initialize BullMQ worker for profile tasks

const PORT = process.env.PORT;
const NODE_ENV = process.env.NODE_ENV;

// ── 2. Handle uncaught exceptions (sync errors not caught by express) ────────
process.on("uncaughtException", (err) => {
  logger.error("UNCAUGHT EXCEPTION! Shutting down...", {
    name: err.name,
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

// ── 3. Connect to MongoDB, then start server ─────────────────────────────────
const startServer = async () => {
  try {
    await connectDB();

    const httpServer = http.createServer(app);
    initSocket(httpServer);

    const server = httpServer.listen(PORT, () => {
      const host = process.env.APP_HOST;
      logger.info(`🚀 Server running in ${NODE_ENV} mode on PORT ${PORT}`);
      if (host) {
        logger.info(`📡 API Base: ${host}/api/v1`);
        logger.info(`❤️  Health:   ${host}/health`);
      } else {
      }
    });

    // ── 4. Handle unhandled promise rejections ──────────────────────────────
    process.on("unhandledRejection", (err) => {
      logger.error("UNHANDLED REJECTION! Shutting down...", {
        name: err.name,
        message: err.message,
      });
      server.close(() => {
        process.exit(1);
      });
    });

    // ── 5. Graceful shutdown on SIGTERM (e.g. Docker / PM2 stop) ───────────
    process.on("SIGTERM", () => {
      logger.info("SIGTERM received. Shutting down gracefully...");
      server.close(() => {
        logger.info("Process terminated.");
        process.exit(0);
      });
    });

    // ── 6. Graceful shutdown on SIGINT (Ctrl+C) ─────────────────────────────
    process.on("SIGINT", () => {
      logger.info("SIGINT received. Shutting down gracefully...");
      server.close(() => {
        logger.info("Process terminated.");
        process.exit(0);
      });
    });

    // ── 7. Nodemon restart handler (SIGUSR2) ───────────────────────────────
    process.once("SIGUSR2", () => {
      server.close(() => {
        process.kill(process.pid, "SIGUSR2");
      });
    });
  } catch (err) {
    logger.error("Failed to start server:", { message: err.message });
    process.exit(1);
  }
};

startServer();