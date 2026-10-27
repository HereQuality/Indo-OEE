"use strict";
/**
 * utils/httpErrors.js — shared answers for the master controllers' catch blocks
 * and their paged-search handlers.
 *
 *  - sendError(res, error): a bad id (CastError) or bad input (Mongoose
 *    ValidationError) is the caller's mistake, so 400, not 500; an error that
 *    carries its own 4xx status keeps it; anything else stays 500 with its
 *    message, as before.
 *  - pageParams(skip, perPage): skip >= 0 and a page size of 1..max, so a
 *    negative or absurd value can't reach .skip()/.limit().
 */

const sendError = (res, error) => {
  let status = 500;
  let message = error?.message;
  if (error?.name === "CastError") {
    status = 400;
    message = "Invalid id";
  } else if (error?.name === "ValidationError") {
    status = 400;
  } else {
    const own = Number(error?.status ?? error?.statusCode);
    if (own >= 400 && own < 500) status = own;
  }
  return res.status(status).json({ isOk: false, message });
};

const pageParams = (skip, perPage, { max = 200, fallback = 10 } = {}) => {
  const s = parseInt(skip, 10);
  const p = parseInt(perPage, 10);
  return {
    skip: Number.isFinite(s) && s > 0 ? s : 0,
    limit: Number.isFinite(p) ? Math.min(max, Math.max(1, p)) : fallback,
  };
};

module.exports = { sendError, pageParams };
