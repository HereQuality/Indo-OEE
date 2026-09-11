"use strict";
/**
 * utils/apiResponse.js — Standardized API Response Helpers
 *
 * Ensures all API responses follow a consistent structure.
 *
 * Success:  { success: true,  data: ..., message: ..., meta: ... }
 * Error:    { success: false, status: ..., message: ... }
 */

/**
 * Send a success response
 * @param {Response} res
 * @param {number}   statusCode  - HTTP status (default: 200)
 * @param {string}   message     - Human-readable message
 * @param {*}        data        - Response payload
 * @param {object}   [meta]      - Optional metadata (pagination, counts, etc.)
 */
const sendSuccess = (res, statusCode = 200, message = "Success", data = null, meta = null) => {
  const response = { success: true, message };
  if (data !== null) response.data = data;
  if (meta !== null) response.meta = meta;
  return res.status(statusCode).json(response);
};

/**
 * Send a created (201) response
 */
const sendCreated = (res, message = "Created successfully", data = null) => {
  return sendSuccess(res, 201, message, data);
};

/**
 * Send a no-content (204) response
 */
const sendNoContent = (res) => {
  return res.status(204).send();
};

/**
 * Build pagination meta
 * @param {number} total    - Total number of documents
 * @param {number} page     - Current page (1-indexed)
 * @param {number} limit    - Items per page
 */
const paginationMeta = (total, page, limit) => ({
  total,
  page: Number(page),
  limit: Number(limit),
  totalPages: Math.ceil(total / limit),
  hasNextPage: page * limit < total,
  hasPrevPage: page > 1,
});

module.exports = { sendSuccess, sendCreated, sendNoContent, paginationMeta };
