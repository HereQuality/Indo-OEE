"use strict";
/**
 * middlewares/notFoundHandler.js — 404 Route Handler
 *
 * Catches all requests to undefined routes and returns a proper 404.
 */

const AppError = require("../utils/AppError");

const notFoundHandler = (req, res, next) => {
  next(
    new AppError(
      `Route '${req.method} ${req.originalUrl}' not found on this server.`,
      404
    )
  );
};

module.exports = { notFoundHandler };
