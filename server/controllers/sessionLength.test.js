const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const { signToken } = require("./auth.controller");

const days = (token) => {
  const d = jwt.decode(token);
  return Math.round((d.exp - d.iat) / 86400);
};

test("web sessions last 10 days, or 30 with Remember me", () => {
  assert.equal(days(signToken("u1", "Operator", false)), 10);
  assert.equal(days(signToken("u1", "Operator", true)), 30);
});

test("the phone / tablet app session lasts 60 days whatever Remember me says", () => {
  assert.equal(days(signToken("u1", "Operator", false, "app")), 60);
  assert.equal(days(signToken("u1", "SuperAdmin", true, "app")), 60);
});
