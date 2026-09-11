const { Worker } = require('bullmq');
const { redisConnection } = require('../config/redis');
const { deleteLocalFile } = require('../utils/fileUrl');

const profileWorker = new Worker(
  'profile-tasks',
  async (job) => {
    console.log(`[Worker] Processing job ${job.name} (ID: ${job.id})`);

    switch (job.name) {
      case 'delete-old-profile-pic': {
        const { url } = job.data;
        if (!url) {
          throw new Error('No url provided to delete-old-profile-pic job');
        }

        try {
          deleteLocalFile(url);
          console.log(`[Worker] Successfully deleted old profile pic: ${url}`);
        } catch (error) {
          console.error(`[Worker Error] Failed to delete local profile pic ${url}:`, error);
          throw error;
        }
        break;
      }

      default:
        console.log(`[Worker] Unhandled job type: ${job.name}`);
    }
  },
  {
    connection: redisConnection
  }
);

profileWorker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} has completed!`);
});

profileWorker.on('failed', (job, err) => {
  console.log(`[Worker] Job ${job.id} has failed with ${err.message}`);
});

module.exports = profileWorker;
