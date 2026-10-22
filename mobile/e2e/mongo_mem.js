'use strict';
// Starts a throwaway in-memory mongod (mongodb-memory-server) and keeps running.
// Writes its URI to .run/mongo_uri. Stop with SIGTERM.
const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('./.tools/node_modules/mongodb-memory-server');
const { assertSafeMongoUri } = require('./safety');

(async () => {
  const run = path.join(__dirname, '.run');
  fs.mkdirSync(run, { recursive: true });
  const mongod = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1', dbName: 'indo_e2e' } });
  const uri = assertSafeMongoUri(mongod.getUri('indo_e2e'));
  fs.writeFileSync(path.join(run, 'mongo_uri'), uri);
  console.log('[e2e] throwaway mongod ready:', uri);
  const stop = async () => { try { await mongod.stop(); } catch (_) {} process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  setInterval(() => {}, 1 << 30);
})().catch((e) => { console.error('[e2e] mongod failed:', e.message); process.exit(1); });
