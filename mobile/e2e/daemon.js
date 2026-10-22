'use strict';
// node daemon.js <pidfile> <logfile> <cwd> -- cmd args...
// Starts cmd detached (own session) so it outlives the calling shell; env is inherited as given.
const fs = require('fs');
const { spawn } = require('child_process');
const [pidfile, logfile, cwd, sep, cmd, ...args] = process.argv.slice(2);
if (sep !== '--' || !cmd) { console.error('usage: daemon.js pidfile logfile cwd -- cmd args'); process.exit(2); }
const out = fs.openSync(logfile, 'a');
const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', out, out], env: process.env });
fs.writeFileSync(pidfile, String(child.pid));
child.unref();
