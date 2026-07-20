const express = require('express');
const router = express.Router();
const PushSubscription = require('@models/PushSubscription');
const { protect } = require('@middleware/authmiddleware');

// POST /api/push/subscribe
router.post('/subscribe', protect, async (req, res) => {
  try {
    const { endpoint, keys, userAgent, device } = req.body;
    const userId = req.user.id;

    // Upsert subscription (one per endpoint)
    const subscription = await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        userId,
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        userAgent: userAgent || req.headers['user-agent'],
        device: device || 'web',
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    res.status(200).json({ success: true, subscription });
  } catch (error) {
    console.error('Push subscribe error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/push/unsubscribe
router.delete('/unsubscribe', protect, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await PushSubscription.deleteOne({ endpoint, userId: req.user.id });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;