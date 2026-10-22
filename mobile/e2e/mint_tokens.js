'use strict';
// Prints {"<username>": {"token": "...", "roleType": "..."}} for every seeded e2e user, signed with the
// THROWAWAY e2e JWT secret (start_backend.sh) so integration tests can start already signed in and not
// burn the server's login rate limit (20 per 15 min per IP). Local harness only.
const fs = require('fs');
const path = require('path');
const env = JSON.parse(fs.readFileSync(path.join(__dirname, 'e2e_env.json'), 'utf8'));
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.baseUrl)) throw new Error('E2E SAFETY: baseUrl must be local');
const jwt = require(path.join(__dirname, '..', '..', 'server', 'node_modules', 'jsonwebtoken'));
const out = {};
for (const u of Object.values(env.users)) {
  out[u.username] = { token: jwt.sign({ id: u.id, roleType: u.roleType }, 'e2e-dummy-jwt-secret', { expiresIn: '1d' }), roleType: u.roleType };
}
process.stdout.write(JSON.stringify(out));
