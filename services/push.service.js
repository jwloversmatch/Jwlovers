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
        subscriptions.map(sub =>
          webpush.sendNotification(sub, notificationPayload).catch(async (error) => {
            // If subscription is expired/unsubscribed, remove it
            if (error.statusCode === 404 || error.statusCode === 410) {
              await PushSubscription.deleteOne({ _id: sub._id });
              logger.info(`Removed expired subscription for ${sub.endpoint}`);
            } else {
              logger.error(`Push error for ${sub.endpoint}:`, error.message);
            }
          })
        )
      );

      logger.info(`Push notifications sent to user ${userId}: ${results.length} attempts`);
    } catch (error) {
      logger.error(`sendToUser failed:`, error);
    }
  },
};

module.exports = pushService;