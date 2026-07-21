const webpush = require('web-push');
const PushSubscription = require('@models/PushSubscription');
const logger = require('@utils/logger');

// FIXED: guard against missing env vars at load time rather than letting
// setVapidDetails throw and silently break the whole module.
const { VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;

if (!VAPID_EMAIL || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  logger.error(
    '❌ Push notifications are disabled: VAPID_EMAIL, VAPID_PUBLIC_KEY, ' +
    'and VAPID_PRIVATE_KEY must all be set in your .env file. ' +
    'Generate them with: npx web-push generate-vapid-keys'
  );
} else {
  webpush.setVapidDetails(
    `mailto:${VAPID_EMAIL}`,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

const pushService = {
  sendToUser: async (userId, payload) => {
    if (!VAPID_EMAIL || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      logger.warn('Push skipped — VAPID keys not configured');
      return;
    }

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
          // FIXED: explicitly destructure to the shape web-push expects,
          // rather than passing the raw Mongoose lean object. If your schema
          // stores keys as a Mongoose Map, lean() returns a Map object which
          // web-push can't read — this makes it explicit either way.
          const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys?.p256dh || sub.keys?.get?.('p256dh'),
              auth: sub.keys?.auth || sub.keys?.get?.('auth'),
            },
          };

          if (!pushSubscription.keys.p256dh || !pushSubscription.keys.auth) {
            logger.error(`❌ Subscription ${sub._id} has malformed keys — skipping`, {
              keys: sub.keys,
            });
            return;
          }

          try {
            await webpush.sendNotification(pushSubscription, notificationPayload);
            logger.info(`✅ Push sent to ${sub.endpoint.substring(0, 50)}...`);
          } catch (error) {
            logger.error(`❌ Push failed`, {
              endpoint: sub.endpoint.substring(0, 50),
              statusCode: error.statusCode,
              body: error.body,
              message: error.message,
            });

            if (error.statusCode === 404 || error.statusCode === 410) {
              await PushSubscription.deleteOne({ _id: sub._id });
              logger.info(`🗑️ Removed expired subscription`);
            }
          }
        })
      );

      logger.info(
        `Push processed for user ${userId}: ${results.length} subscription(s)`
      );
    } catch (error) {
      logger.error('sendToUser failed:', error);
    }
  },

  // Convenience wrappers so callers don't have to build the payload shape
  sendNewMessage: (recipientId, { senderName, preview, conversationId }) =>
    pushService.sendToUser(recipientId, {
      title: `💬 ${senderName}`,
      body: preview.length > 80 ? preview.substring(0, 77) + '...' : preview,
      data: {
        url: `/messages?user=${conversationId}`,
        tag: `message-${conversationId}`,
        type: 'new_message',
      },
    }),

  sendNewMatch: (recipientId, { matchName, matchId }) =>
    pushService.sendToUser(recipientId, {
      title: "🎉 It's a Match!",
      body: `You and ${matchName} liked each other`,
      data: {
        url: `/profile/${matchId}`,
        tag: `match-${matchId}`,
        type: 'new_match',
      },
    }),

  sendNewLike: (recipientId, { likerName }) =>
    pushService.sendToUser(recipientId, {
      title: '❤️ Someone liked you',
      body: `${likerName} liked your profile`,
      data: {
        url: '/discover',
        tag: 'new-like',
        type: 'new_like',
      },
    }),
};

module.exports = pushService;