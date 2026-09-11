"use strict";
/**
 * config/db.js — MongoDB Connection
 *
 * Uses Mongoose with best-practice connection options.
 * Supports both local MongoDB and MongoDB Atlas via MONGO_URI in .env
 */

const mongoose = require("mongoose");
const logger = require("./logger");

const connectDB = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error(
      "MONGO_URI is not defined in environment variables. Check your .env file."
    );
  }

  try {
    const conn = await mongoose.connect(uri, {
      // Connection pool
      maxPoolSize: 10,
      minPoolSize: 2,
      // Timeouts
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      // Heartbeat
      heartbeatFrequencyMS: 10000,
      // Compression
      compressors: "zlib",
    });

    logger.info(`✅ MongoDB connected: ${conn.connection.host}`);
    logger.info(`📂 Database: ${conn.connection.name}`);
    // ── Mongoose connection event listeners ──────────────────────────────────
    mongoose.connection.on("disconnected", () => {
      logger.warn("⚠️  MongoDB disconnected. Attempting to reconnect...");
    });

    mongoose.connection.on("reconnected", () => {
      logger.info("🔄 MongoDB reconnected successfully.");
    });

    mongoose.connection.on("error", (err) => {
      logger.error("MongoDB connection error:", { message: err.message });
    });

    return conn;
  } catch (err) {
    logger.error("❌ MongoDB connection failed:", {
      message: err.message,
      uri: uri.replace(/\/\/(.+):(.+)@/, "//***:***@"), // Mask credentials in logs
    });
    throw err; // Let server.js handle exit
  }
};

module.exports = connectDB;
