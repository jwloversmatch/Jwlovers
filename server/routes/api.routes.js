const express = require('express');
const router = express.Router();
const { getIO } = require('../services/websocket');
const presenceService = require('../services/presence');

// API info endpoint
router.get('/', (req, res) => {
  const onlineUsers = presenceService.getOnlineUsers();
  
  res.json({
    success: true,
    message: 'JW Lovers API',
    version: '2.1.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      auth: '/api/auth',
      health: '/health',
      websocket: '/socket.io',
      apiInfo: '/api'
    },
    websocket: {
      onlineUsers: onlineUsers.length,
      enabled: true
    }
  });
});

// Presence endpoints
router.get('/presence/online', (req, res) => {
  const onlineUsers = presenceService.getOnlineUsers();
  
  res.json({
    success: true,
    onlineUsers: onlineUsers,
    count: onlineUsers.length,
    timestamp: new Date().toISOString()
  });
});

router.get('/presence/status/:userId', (req, res) => {
  const { userId } = req.params;
  const isOnline = presenceService.isUserOnline(userId);
  
  res.json({
    success: true,
    userId,
    isOnline,
    timestamp: new Date().toISOString()
  });
});

// User routes (simplified for example)
router.get('/users/me', (req, res) => {
  res.json({
    success: true,
    user: {
      id: 'fallback-user',
      username: 'fallback_user',
      email: 'fallback@example.com'
    },
    timestamp: new Date().toISOString()
  });
});

// Match routes (simplified for example)
router.get('/match/suggestions', (req, res) => {
  res.json({
    success: true,
    suggestions: [
      { id: 'user1', name: 'Suggested User 1' },
      { id: 'user2', name: 'Suggested User 2' }
    ],
    timestamp: new Date().toISOString()
  });
});

module.exports = router;