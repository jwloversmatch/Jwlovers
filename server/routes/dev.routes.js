const express = require('express');
const router = express.Router();
const { getIO } = require('../services/websocket');
const presenceService = require('../services/presence');

// WebSocket info endpoint
router.get('/websocket-info', (req, res) => {
  const onlineUsers = presenceService.getOnlineUsers();
  
  res.json({
    success: true,
    websocket: {
      connected: !!getIO(),
      onlineUsersCount: onlineUsers.length,
      onlineUsers: onlineUsers
    }
  });
});

// Test message endpoint
router.post('/test-message', (req, res) => {
  const { userId, message } = req.body;
  const io = getIO();
  
  if (!io) {
    return res.status(500).json({
      success: false,
      error: 'WebSocket not initialized'
    });
  }
  
  const socketId = presenceService.getUserSocket(userId);
  
  if (socketId) {
    io.to(socketId).emit('test:message', {
      message: message || 'Test message from dev endpoint',
      timestamp: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: `Test message sent to user ${userId}`,
      socketId
    });
  } else {
    res.status(404).json({
      success: false,
      error: `User ${userId} is not online`
    });
  }
});

module.exports = router;