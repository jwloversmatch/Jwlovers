// routes/push.routes.js
const express = require('express');
const router = express.Router();
const { protect } = require('@middleware/authmiddleware');
const PushSubscription = require('@models/PushSubscription');
const logger = require('@utils/logger');

router.use(protect);

// POST /api/push/subscribe — save a subscription from the browser
router.post('/subscribe', async (req, res) => {
  try {
    const { endpoint, keys, userAgent, device } = req.body;
    const userId = req.user.id || req.user._id;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'endpoint and keys (p256dh, auth) are required' });
    }

    // Upsert — if this endpoint already exists for this user, update it;
    // otherwise create a new record. Prevents duplicate subscriptions when
    // the browser hands back the same endpoint on repeated page loads.
    await PushSubscription.findOneAndUpdate(
      { userId, endpoint },
      { userId, endpoint, keys, userAgent, device, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    logger.info(`✅ Push subscription saved for user ${userId}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to save push subscription:', error);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// DELETE /api/push/unsubscribe — remove a subscription (user turned off notifications)
router.delete('/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    const userId = req.user.id || req.user._id;

    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint is required' });
    }

    await PushSubscription.deleteOne({ userId, endpoint });
    logger.info(`🗑️ Push subscription removed for user ${userId}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to remove push subscription:', error);
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

// GET /api/push/vapid-public-key — let the frontend fetch the key dynamically
// instead of baking it into the bundle (optional but cleaner than env vars)
router.get('/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ publicKey: key });
});

module.exports = router;