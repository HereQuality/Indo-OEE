'use strict';
// Shared hard guard: refuse anything that is not a throwaway local MongoDB.
// Required by every e2e node script that touches a database.
function assertSafeMongoUri(uri) {
  const u = String(uri || '');
  if (!u) throw new Error('E2E SAFETY: MONGO_URI is empty');
  if (/mongodb\+srv/i.test(u) || /mongodb\.net/i.test(u) || /atlas/i.test(u)) {
    throw new Error('E2E SAFETY: refusing to use an Atlas / SRV connection string');
  }
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(u)) {
    throw new Error('E2E SAFETY: MONGO_URI must be mongodb://127.0.0.1:<port>/... (got a non-local host)');
  }
  return u;
}
module.exports = { assertSafeMongoUri };
