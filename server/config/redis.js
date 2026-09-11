const Redis = require('ioredis');

// Default local Redis config, but customizable through env
const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null,
};

const redisConnection = new Redis(redisConfig);

redisConnection.on('error', (err) => {
  if (err.code === 'ECONNREFUSED') {
    // Only log the refused connection once every minute or so, or just ignore to prevent spam
    if (!redisConnection._hasLoggedError) {
      console.error(`[Redis] Connection refused at ${err.address}:${err.port}. Is Redis running? Background tasks won't work.`);
      redisConnection._hasLoggedError = true;
      setTimeout(() => { redisConnection._hasLoggedError = false; }, 60000); // Allow logging again after 1m
    }
  } else {
    console.error('[Redis Error]', err.message);
  }
});

redisConnection.on('connect', () => {
  console.log('[Redis] Connected successfully');
});

module.exports = {
  redisConnection,
  redisConfig
};
