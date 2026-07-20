const webpush = require('web-push');
const PushSubscription = require('@models/PushSubscription');
const logger = require('@utils/logger');

// Set VAPID details once
webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const pushService = {
  /**
   * Send a push notification to all devices of a user
   * @param {string} userId
   * @param {Object} payload - { title, body, icon, data? }
   */
  sendToUser: async (userId, payload) => {
  try {
    const subscriptions = await PushSubscription.find({ userId }).lean();
    if (!subscriptions.length) {
      logger.debug(`No push subscriptions for user ${userId}`);
      return;
    }

    const notificationPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/logo192.png',
      data: payload.data || {},
    });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(sub, notificationPayload);
          logger.info(`✅ Push sent to ${sub.endpoint.substring(0, 50)}...`);
        } catch (error) {
          // 🔥 Log EVERYTHING about the error
          logger.error(`❌ Push failed for endpoint: ${sub.endpoint}`, {
            statusCode: error.statusCode,
            body: error.body,
            headers: error.headers,
            message: error.message,
            stack: error.stack?.split('\n')[0],
          });
          // Remove invalid subscriptions
          if (error.statusCode === 404 || error.statusCode === 410) {
            await PushSubscription.deleteOne({ _id: sub._id });
            logger.info(`🗑️ Removed expired subscription: ${sub.endpoint}`);
          }
        }
      })
    );

    logger.info(`Push notifications processed for user ${userId}: ${results.length} subscriptions`);
  } catch (error) {
    logger.error(`sendToUser failed:`, error);
  }
},
};

module.exports = pushService;