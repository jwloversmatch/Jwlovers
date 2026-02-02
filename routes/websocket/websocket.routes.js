// routes/websocket.routes.js
const express = require("express");
const router = express.Router();

// Import rate limiting and auth middleware
const { apiLimiter } = require("@middleware/rateLimit");
const { protect, authorize } = require("@middleware/authmiddleware");

module.exports = ({ webSocketService, presenceService }) => {
  // Middleware to check if WebSocketService is available
  const checkWebSocketService = (req, res, next) => {
    if (!webSocketService || !webSocketService.getIo) {
      return res.status(503).json({
        success: false,
        error: "WebSocket service not available",
        code: "SERVICE_UNAVAILABLE"
      });
    }
    next();
  };

  // Optional: Check if services are available (less strict)
  const checkServicesOptional = (req, res, next) => {
    if (!webSocketService && !presenceService) {
      return res.status(503).json({
        success: false,
        error: "WebSocket services not available",
        code: "SERVICES_UNAVAILABLE"
      });
    }
    next();
  };

  // Validate numeric query parameters
  const validateNumericParams = (req, res, next) => {
    const { limit, page } = req.query;
    
    if (limit) {
      const limitNum = parseInt(limit);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
        return res.status(400).json({
          success: false,
          error: "Limit must be between 1 and 1000",
          code: "INVALID_LIMIT"
        });
      }
    }
    
    if (page) {
      const pageNum = parseInt(page);
      if (isNaN(pageNum) || pageNum < 1) {
        return res.status(400).json({
          success: false,
          error: "Page must be a positive number",
          code: "INVALID_PAGE"
        });
      }
    }
    
    next();
  };

  // Get WebSocket statistics (admin only)
  router.get(
    "/stats",
    apiLimiter,
    protect,
    authorize("Admin", "SuperAdmin"),
    checkServicesOptional,
    (req, res) => {
      try {
        let stats = {};
        let presenceStats = {};
        let authStats = {};

        // Get stats from WebSocketService if available
        if (webSocketService && webSocketService.getStats) {
          stats = webSocketService.getStats();
        }

        // Get stats from PresenceService if available
        if (presenceService && presenceService.getMetrics) {
          presenceStats = presenceService.getMetrics();
        }

        // Get auth stats if available
        const socketAuth = webSocketService?.getSocketAuth?.();
        if (socketAuth && socketAuth.getMetrics) {
          authStats = socketAuth.getMetrics();
        }

        const io = webSocketService?.getIo ? webSocketService.getIo() : null;

        res.json({
          success: true,
          data: {
            webSocket: {
              connectedClients: io?.engine?.clientsCount || 0,
              ...stats,
            },
            presence: presenceStats,
            auth: authStats,
            redis: webSocketService?.redisService?.getMetrics?.() || {},
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: "Failed to get WebSocket statistics",
          code: "STATS_ERROR",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  );

  // Health check endpoint (public)
  router.get("/health", checkServicesOptional, (req, res) => {
    try {
      const io = webSocketService?.getIo ? webSocketService.getIo() : null;

      // Check Redis connection if available
      let redisStatus = "unknown";
      let redisMetrics = {};
      if (webSocketService?.redisService) {
        redisStatus = webSocketService.redisService.isReady()
          ? "connected"
          : "disconnected";
        redisMetrics = webSocketService.redisService.getMetrics?.() || {};
      }

      // Check PresenceService
      let presenceStatus = "unknown";
      let presenceMetrics = {};
      if (presenceService) {
        presenceStatus = "available";
        presenceMetrics = presenceService.getMetrics?.() || {};
      }

      // Check authentication service
      let authStatus = "unknown";
      const socketAuth = webSocketService?.getSocketAuth?.();
      if (socketAuth) {
        authStatus = "available";
      }

      const status = io ? "healthy" : "degraded";
      
      res.json({
        success: true,
        status,
        timestamp: new Date().toISOString(),
        services: {
          webSocket: !!io,
          redis: redisStatus,
          presence: presenceStatus,
          auth: authStatus
        },
        metrics: {
          connectedClients: io?.engine?.clientsCount || 0,
          ...redisMetrics,
          ...presenceMetrics
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        status: "unhealthy",
        error: "Health check failed",
        code: "HEALTH_CHECK_FAILED",
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Get online users via HTTP (with pagination) - admin only
  router.get(
    "/online-users",
    apiLimiter,
    protect,
    authorize("Admin", "SuperAdmin", "Moderator"),
    checkServicesOptional,
    validateNumericParams,
    async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const page = parseInt(req.query.page) || 1;
        const offset = (page - 1) * limit;
        const userType = req.query.userType || 'all';

        let onlineUsers = [];
        let totalCount = 0;

        // Try to get from PresenceService first
        if (presenceService && presenceService.getOnlineUsers) {
          onlineUsers = await presenceService.getOnlineUsers(limit, offset, userType);
          
          // Get total count separately for pagination
          if (presenceService.getOnlineUsersCount) {
            totalCount = await presenceService.getOnlineUsersCount(userType);
          } else {
            // Estimate from current page
            totalCount = onlineUsers.length === limit ? (page * limit) + 1 : (page - 1) * limit + onlineUsers.length;
          }
        }
        // Fallback to WebSocketService
        else if (webSocketService && webSocketService.getOnlineUsers) {
          onlineUsers = await webSocketService.getOnlineUsers(limit, userType);
          totalCount = onlineUsers.length;
        }

        const totalPages = Math.ceil(totalCount / limit);

        res.json({
          success: true,
          count: onlineUsers.length,
          totalCount,
          page,
          limit,
          totalPages,
          hasMore: page < totalPages,
          users: onlineUsers,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: "Failed to get online users",
          code: "ONLINE_USERS_ERROR",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  );

  // Get online dating users nearby (for dating app features)
  router.get(
    "/online-users/nearby",
    apiLimiter,
    protect,
    checkServicesOptional,
    validateNumericParams,
    async (req, res) => {
      try {
        const userId = req.user?._id || req.user?.id;
        if (!userId) {
          return res.status(401).json({
            success: false,
            error: "Authentication required",
            code: "UNAUTHORIZED"
          });
        }

        const radiusKm = Math.min(parseFloat(req.query.radius) || 10, 100); // Max 100km
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);

        let nearbyUsers = [];

        // Use PresenceService if available
        if (presenceService && presenceService.getNearbyOnlineUsers) {
          nearbyUsers = await presenceService.getNearbyOnlineUsers(userId, radiusKm, limit);
        }

        res.json({
          success: true,
          count: nearbyUsers.length,
          radiusKm,
          limit,
          users: nearbyUsers,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: "Failed to get nearby online users",
          code: "NEARBY_USERS_ERROR",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  );

  // Send presence update via HTTP (user can update own status)
  router.post(
    "/presence/update",
    apiLimiter,
    protect,
    checkServicesOptional,
    async (req, res) => {
      try {
        const { status, customStatus } = req.body;
        const userId = req.user?._id || req.user?.id;

        if (!userId) {
          return res.status(401).json({
            success: false,
            error: "Authentication required",
            code: "UNAUTHORIZED"
          });
        }

        // Validate status if provided
        const validStatuses = ["online", "away", "busy", "offline", "invisible"];
        if (status && !validStatuses.includes(status)) {
          return res.status(400).json({
            success: false,
            error: `Invalid status. Use: ${validStatuses.join(", ")}`,
            code: "INVALID_STATUS"
          });
        }

        // Validate custom status length
        if (customStatus && customStatus.length > 100) {
          return res.status(400).json({
            success: false,
            error: "Custom status too long (max 100 characters)",
            code: "CUSTOM_STATUS_TOO_LONG"
          });
        }

        let updateResult = false;

        // Use PresenceService if available
        if (presenceService && presenceService.updateUserStatus) {
          updateResult = await presenceService.updateUserStatus(userId, status, customStatus);
        }
        // Fallback to WebSocketService
        else if (webSocketService && webSocketService.updateUserStatus) {
          updateResult = await webSocketService.updateUserStatus(userId, status, customStatus);
        }

        if (!updateResult) {
          return res.status(500).json({
            success: false,
            error: "Failed to update presence status",
            code: "UPDATE_FAILED"
          });
        }

        res.json({
          success: true,
          message: "Presence updated successfully",
          userId,
          status: status || "online",
          customStatus: customStatus || null,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: "Failed to update presence",
          code: "PRESENCE_UPDATE_ERROR",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  );

  // Check if specific users are online
  router.post(
    "/presence/check",
    apiLimiter,
    protect,
    checkServicesOptional,
    async (req, res) => {
      try {
        const { userIds } = req.body;

        if (!Array.isArray(userIds) || userIds.length === 0) {
          return res.status(400).json({
            success: false,
            error: "userIds array is required",
            code: "MISSING_USER_IDS"
          });
        }

        if (userIds.length > 100) {
          return res.status(400).json({
            success: false,
            error: "Maximum 100 userIds allowed",
            code: "TOO_MANY_USER_IDS"
          });
        }

        // Validate each userId is a valid MongoDB ObjectId
        const mongoose = require('mongoose');
        const invalidIds = userIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
        if (invalidIds.length > 0) {
          return res.status(400).json({
            success: false,
            error: "Invalid user IDs",
            code: "INVALID_USER_IDS",
            invalidIds
          });
        }

        let onlineStatus = {};

        // Use PresenceService if available
        if (presenceService && presenceService.areUsersOnline) {
          onlineStatus = await presenceService.areUsersOnline(userIds);
        }
        // Fallback: check WebSocket connections
        else if (webSocketService?.getIo && webSocketService?.isUserOnline) {
          const statusPromises = userIds.map(async (userId) => {
            const isOnline = await webSocketService.isUserOnline(userId);
            return { userId, isOnline };
          });
          
          const results = await Promise.all(statusPromises);
          onlineStatus = results.reduce((acc, { userId, isOnline }) => {
            acc[userId] = isOnline;
            return acc;
          }, {});
        }

        res.json({
          success: true,
          data: onlineStatus,
          checkedCount: userIds.length,
          onlineCount: Object.values(onlineStatus).filter(Boolean).length,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: "Failed to check presence status",
          code: "PRESENCE_CHECK_ERROR",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  );

  // Kick user from WebSocket (admin function)
  router.post(
    "/disconnect-user",
    apiLimiter,
    protect,
    authorize("Admin", "SuperAdmin"),
    checkWebSocketService,
    async (req, res) => {
      try {
        const { userId, reason = "admin_disconnect" } = req.body;

        if (!userId) {
          return res.status(400).json({
            success: false,
            error: "userId is required",
            code: "MISSING_USER_ID"
          });
        }

        // Validate userId
        const mongoose = require('mongoose');
        if (!mongoose.Types.ObjectId.isValid(userId)) {
          return res.status(400).json({
            success: false,
            error: "Invalid user ID",
            code: "INVALID_USER_ID"
          });
        }

        const io = webSocketService.getIo();
        
        // Use WebSocketService disconnect method if available
        let disconnected = 0;
        if (webSocketService.disconnectUser) {
          disconnected = webSocketService.disconnectUser(userId, reason);
        } else {
          // Fallback: manual disconnection
          const userRoom = `user:${userId}`;
          const sockets = await io.in(userRoom).fetchSockets();

          if (sockets.length === 0) {
            return res.json({
              success: true,
              message: "User not connected",
              disconnected: 0,
              timestamp: new Date().toISOString(),
            });
          }

          // Disconnect all sockets for this user
          sockets.forEach((socket) => {
            socket.emit("admin:disconnect", {
              reason,
              timestamp: new Date().toISOString(),
              reconnectAfter: 300 // 5 minutes
            });
            setTimeout(() => {
              socket.disconnect(true);
            }, 100);
          });

          disconnected = sockets.length;
        }

        // Update presence if service available
        if (presenceService && presenceService.userDisconnected) {
          // This will be handled by the socket disconnect event
        }

        res.json({
          success: true,
          message: `Disconnected ${disconnected} socket(s) for user ${userId}`,
          disconnected,
          reason,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: "Failed to disconnect user",
          code: "DISCONNECT_ERROR",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  );

  // Broadcast message to all connected users (admin function)
  router.post(
    "/broadcast",
    apiLimiter,
    protect,
    authorize("Admin", "SuperAdmin"),
    checkWebSocketService,
    (req, res) => {
      try {
        const { event, data, excludeUserId } = req.body;

        if (!event) {
          return res.status(400).json({
            success: false,
            error: "event is required",
            code: "MISSING_EVENT"
          });
        }

        // Validate event name (prevent malicious events)
        const eventRegex = /^[a-zA-Z0-9:_\-\.]+$/;
        if (!eventRegex.test(event)) {
          return res.status(400).json({
            success: false,
            error: "Invalid event name",
            code: "INVALID_EVENT_NAME"
          });
        }

        const io = webSocketService.getIo();

        // Use WebSocketService broadcast method if available
        if (webSocketService.broadcast) {
          webSocketService.broadcast(event, data, excludeUserId);
        } else {
          // Fallback
          if (excludeUserId) {
            io.except(`user:${excludeUserId}`).emit(event, data);
          } else {
            io.emit(event, data);
          }
        }

        // Log the broadcast
        logger.info(`Admin broadcast: ${event}`, {
          adminId: req.user?._id,
          event,
          excludeUserId,
          timestamp: new Date().toISOString()
        });

        res.json({
          success: true,
          message: `Broadcasted ${event} to all connected users`,
          event,
          excludeUserId: excludeUserId || "none",
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: "Failed to broadcast message",
          code: "BROADCAST_ERROR",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  );

  // Send message to specific user (admin function)
  router.post(
    "/send-message",
    apiLimiter,
    protect,
    authorize("Admin", "SuperAdmin", "Moderator"),
    checkWebSocketService,
    async (req, res) => {
      try {
        const { userId, event, data } = req.body;

        if (!userId || !event) {
          return res.status(400).json({
            success: false,
            error: "userId and event are required",
            code: "MISSING_PARAMS"
          });
        }

        // Validate event name
        const eventRegex = /^[a-zA-Z0-9:_\-\.]+$/;
        if (!eventRegex.test(event)) {
          return res.status(400).json({
            success: false,
            error: "Invalid event name",
            code: "INVALID_EVENT_NAME"
          });
        }

        // Use WebSocketService send method
        if (webSocketService.sendToUser) {
          webSocketService.sendToUser(userId, event, data);
        } else {
          const io = webSocketService.getIo();
          io.to(`user:${userId}`).emit(event, data);
        }

        // Log the message
        logger.info(`Admin sent message to user: ${userId}`, {
          adminId: req.user?._id,
          userId,
          event,
          timestamp: new Date().toISOString()
        });

        res.json({
          success: true,
          message: `Sent ${event} to user ${userId}`,
          userId,
          event,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: "Failed to send message",
          code: "SEND_MESSAGE_ERROR",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  );

  return router;
};