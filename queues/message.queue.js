// queues/message.queue.js
const Queue = require('bull');
const redisConfig = require('@config/redis');
const logger = require('@utils/logger');

const messageQueue = new Queue('message-processing', {
  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
  },
  defaultJobOptions: {
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 1000, // Keep last 1000 failed jobs
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  },
  limiter: {
    max: 1000, // Max jobs per second
    duration: 1000
  }
});

// Process jobs
messageQueue.process('process-message', async (job) => {
  const { messageId, senderId, receiverId } = job.data;
  
  logger.info(`Processing message ${messageId}`);
  
  // Here you can:
  // 1. Run spam detection
  // 2. Update analytics
  // 3. Index for search
  // 4. Generate previews for media
  // 5. Check for abusive content
  
  // Simulate processing
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return { processed: true, messageId };
});

messageQueue.on('completed', (job, result) => {
  logger.info(`Job ${job.id} completed:`, result);
});

messageQueue.on('failed', (job, err) => {
  logger.error(`Job ${job.id} failed:`, err);
});

messageQueue.on('stalled', (job) => {
  logger.warn(`Job ${job.id} stalled`);
});

module.exports = messageQueue;