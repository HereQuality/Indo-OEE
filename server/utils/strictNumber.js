"use strict";
/**
 * utils/strictNumber.js — strict reading of a number field from a request body.
 *
 *  - isBlankNumber(v): null, "" or a whitespace-only string = "no value" (the field is cleared).
 *  - strictNumber(v): a finite JSON number, or a text that is a plain decimal
 *    (optional sign, digits, optional decimal point, optional exponent), gives that number;
 *    anything else (true, [5], {}, "0x10", "0b1", "Infinity", "NaN", "abc") gives NaN.
 *    Plain Number() also accepted those booleans/arrays/hex strings. No min/max/integer rule here.
 */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const isBlankNumber = (v) => v === null || (typeof v === "string" && v.trim() === "");

const strictNumber = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string") {
    const t = v.trim();
    return DECIMAL.test(t) ? Number(t) : NaN;
  }
  return NaN;
};

module.exports = { strictNumber, isBlankNumber };
