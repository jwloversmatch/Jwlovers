const express = require('express');
const router = express.Router();

// Import auth middleware - note the destructuring
const { protect } = require('@middleware/authmiddleware');
const presenceController = require('@controllers/presence.controller');

// Apply auth to all routes using the 'protect' function
router.use(protect);

// Get online status for multiple users
router.post('/status', presenceController.getOnlineStatus);

// Get active users
router.get('/active-users', presenceController.getActiveUsers);

// Update user's presence status
router.put('/status', presenceController.updateStatus);

// Get user's last seen
router.get('/last-seen/:userId', presenceController.getLastSeen);

module.exports = router;