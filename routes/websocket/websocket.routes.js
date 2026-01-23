// routes/websocket.routes.js
const express = require('express');
const router = express.Router();

// Import rate limiting and auth middleware
const { apiLimiter } = require('@middleware/rateLimit');
const { authorize } = require('@middleware/authmiddleware');

module.exports = ({ webSocketService, presenceService }) => {
  // Middleware to check if WebSocketService is available
  const checkWebSocketService = (req, res, next) => {
    if (!webSocketService || !webSocketService.getIo) {
      return res.status(503).json({ 
        success: false,
        error: 'WebSocket service not available' 
      });
    }
    next();
  };

  // Optional: Check if services are available (less strict)
  const checkServicesOptional = (req, res, next) => {
    if (!webSocketService && !presenceService) {
      return res.status(503).json({ 
        success: false,
        error: 'WebSocket services not available' 
      });
    }
    next();
  };

  // Get WebSocket statistics
  router.get('/stats', apiLimiter, checkServicesOptional, (req, res) => {
    try {
      let stats = {};
      let presenceStats = {};
      
      // Get stats from WebSocketService if available
      if (webSocketService && webSocketService.getStats) {
        stats = webSocketService.getStats();
      }
      
      // Get stats from PresenceService if available
      if (presenceService && presenceService.getMetrics) {
        presenceStats = presenceService.getMetrics();
      }
      
      const io = webSocketService?.getIo ? webSocketService.getIo() : null;
      
      res.json({
        success: true,
        data: {
          webSocket: {
            connectedClients: io?.engine?.clientsCount || 0,
            ...stats
          },
          presence: presenceStats,
          redis: webSocketService?.services?.redisService?.getMetrics?.() || {}
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Health check endpoint
  router.get('/health', checkServicesOptional, (req, res) => {
    try {
      const io = webSocketService?.getIo ? webSocketService.getIo() : null;
      
      // Check Redis connection if available
      let redisStatus = 'unknown';
      if (webSocketService?.services?.redisService) {
        redisStatus = webSocketService.services.redisService.isReady() ? 'connected' : 'disconnected';
      }
      
      // Check PresenceService
      let presenceStatus = 'unknown';
      if (presenceService) {
        presenceStatus = 'available';
      }
      
      res.json({
        success: true,
        status: io ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        services: {
          webSocket: !!io,
          redis: redisStatus,
          presence: presenceStatus
        },
        stats: {
          connectedClients: io?.engine?.clientsCount || 0
        }
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        status: 'unhealthy',
        error: error.message 
      });
    }
  });

  // Get online users via HTTP (with pagination)
  router.get('/online-users', apiLimiter, checkServicesOptional, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const page = parseInt(req.query.page) || 1;
      const offset = (page - 1) * limit;
      
      let onlineUsers = [];
      let userDetails = [];
      
      // Try to get from PresenceService first
      if (presenceService && presenceService.getOnlineUsers) {
        onlineUsers = await presenceService.getOnlineUsers();
        userDetails = onlineUsers; // Already has details
      }
      // Fallback to WebSocketService
      else if (webSocketService && webSocketService.getOnlineUsersList) {
        onlineUsers = await webSocketService.getOnlineUsersList();
        userDetails = onlineUsers.map(userId => ({ userId }));
      }
      
      // Apply pagination
      const paginatedUsers = userDetails.slice(offset, offset + limit);
      const totalPages = Math.ceil(userDetails.length / limit);
      
      res.json({
        success: true,
        count: onlineUsers.length,
        page,
        limit,
        totalPages,
        users: paginatedUsers,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Send presence update via HTTP
  router.post('/presence/update', apiLimiter, checkServicesOptional, async (req, res) => {
    try {
      const { userId, status, customStatus } = req.body;
      
      if (!userId) {
        return res.status(400).json({ 
          success: false, 
          error: 'userId is required' 
        });
      }
      
      // Validate status if provided
      if (status && !['online', 'away', 'busy', 'offline'].includes(status)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid status. Use: online, away, busy, offline' 
        });
      }
      
      // Use PresenceService if available
      if (presenceService && presenceService.updateUserStatus) {
        await presenceService.updateUserStatus(userId, status, customStatus);
      }
      // Fallback to WebSocketService
      else if (webSocketService && webSocketService.emitPresenceUpdate) {
        webSocketService.emitPresenceUpdate(userId, status, customStatus);
      } else {
        const io = webSocketService?.getIo ? webSocketService.getIo() : null;
        if (io) {
          io.emit('presence:update', { userId, status, timestamp: new Date().toISOString() });
        }
      }
      
      res.json({
        success: true,
        message: 'Presence update sent',
        userId,
        status: status || 'online',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Check if specific users are online
  router.post('/presence/check', apiLimiter, checkServicesOptional, async (req, res) => {
    try {
      const { userIds } = req.body;
      
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'userIds array is required' 
        });
      }
      
      if (userIds.length > 100) {
        return res.status(400).json({ 
          success: false, 
          error: 'Maximum 100 userIds allowed' 
        });
      }
      
      let onlineStatus = {};
      
      // Use PresenceService if available
      if (presenceService && presenceService.areUsersOnline) {
        onlineStatus = await presenceService.areUsersOnline(userIds);
      }
      // Fallback: check WebSocket connections
      else if (webSocketService?.getIo) {
        const io = webSocketService.getIo();
        const sockets = await io.fetchSockets();
        
        userIds.forEach(userId => {
          const userSockets = sockets.filter(s => s.userId === userId);
          onlineStatus[userId] = userSockets.length > 0;
        });
      }
      
      res.json({
        success: true,
        data: onlineStatus,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Kick user from WebSocket (admin function)
  router.post('/disconnect-user', apiLimiter, authorize('Admin'), checkWebSocketService, async (req, res) => {
    try {
      const { userId, reason = 'admin_disconnect' } = req.body;
      
      if (!userId) {
        return res.status(400).json({ 
          success: false, 
          error: 'userId is required' 
        });
      }
      
      const io = webSocketService.getIo();
      
      // Find sockets for this user
      const userRoom = `user:${userId}`;
      const sockets = await io.in(userRoom).fetchSockets();
      
      if (sockets.length === 0) {
        return res.json({ 
          success: true, 
          message: 'User not connected',
          disconnected: 0 
        });
      }
      
      // Disconnect all sockets for this user
      sockets.forEach(socket => {
        socket.emit('admin:disconnect', { reason, timestamp: new Date().toISOString() });
        setTimeout(() => {
          socket.disconnect(true);
        }, 100);
      });
      
      // Update presence if service available
      if (presenceService && presenceService.userDisconnected) {
        sockets.forEach(socket => {
          presenceService.userDisconnected(userId, socket.id).catch(() => {});
        });
      }
      
      res.json({
        success: true,
        message: `Disconnected ${sockets.length} socket(s) for user ${userId}`,
        disconnected: sockets.length,
        reason,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Broadcast message to all connected users
  router.post('/broadcast', apiLimiter, authorize('Admin'), checkWebSocketService, (req, res) => {
    try {
      const { event, data, excludeUserId } = req.body;
      
      if (!event) {
        return res.status(400).json({ 
          success: false, 
          error: 'event is required' 
        });
      }
      
      const io = webSocketService.getIo();
      
      if (excludeUserId) {
        io.except(`user:${excludeUserId}`).emit(event, data);
      } else {
        io.emit(event, data);
      }
      
      res.json({
        success: true,
        message: `Broadcasted ${event} to all connected users`,
        event,
        excludeUserId: excludeUserId || 'none',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  return router;
};