const { Queue } = require('bullmq');
const { redisConnection } = require('../config/redis');

// Create a generic queue for profile related background tasks
const profileQueue = new Queue('profile-tasks', {
  connection: redisConnection
});

/**
 * Add a task to the profile queue
 * @param {string} jobName - The name of the job (e.g. 'delete-old-profile-pic')
 * @param {object} data - The data payload for the job
 */
const addProfileTask = async (jobName, data) => {
  try {
    await profileQueue.add(jobName, data, {
      removeOnComplete: true, // cleans up redis space
      removeOnFail: false,
    });
    console.log(`[Queue] Added ${jobName} job to profile-tasks`);
  } catch (error) {
    console.error(`[Queue Error] Failed to add ${jobName}:`, error);
  }
};

module.exports = {
  profileQueue,
  addProfileTask
};
