// routes/websocket.routes.js
const express = require("express");
const router = express.Router();
const logger = require("@utils/logger");

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

  // Check if presence service is available
  const checkPresenceService = (req, res, next) => {
    if (!presenceService) {
      return res.status(503).json({
        success: false,
        error: "Presence service not available",
        code: "PRESENCE_SERVICE_UNAVAILABLE"
      });
    }
    next();
  };

  // Validate numeric query parameters
  const validateNumericParams = (req, res, next) => {
    const { limit, page, radius } = req.query;
    
    if (limit) {
      const limitNum = parseInt(limit);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 200) {
        return res.status(400).json({
          success: false,
          error: "Limit must be between 1 and 200",
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
    
    if (radius) {
      const radiusNum = parseFloat(radius);
      if (isNaN(radiusNum) || radiusNum < 1 || radiusNum > 100) {
        return res.status(400).json({
          success: false,
          error: "Radius must be between 1 and 100 km",
          code: "INVALID_RADIUS"
        });
      }
    }
    
    next();
  };

  // ========== WEB SOCKET STATISTICS (Admin only) ==========
  router.get(
    "/stats",
    apiLimiter,
    protect,
    authorize("admin", "super_admin"),
    checkWebSocketService,
    (req, res) => {
      try {
        let webSocketStats = {};
        let presenceStats = {};

        // Get stats from WebSocketService
        if (webSocketService && webSocketService.getStats) {
          webSocketStats = webSocketService.getStats();
        }

        // Get stats from PresenceService
        if (presenceService && presenceService.getMetrics) {
          presenceStats = presenceService.getMetrics();
        }

        const io = webSocketService.getIo();

        res.json({
          success: true,
          data: {
            webSocket: {
              connectedSockets: webSocketStats.connectedSockets || 0,
              uniqueSocketUsers: webSocketStats.uniqueSocketUsers || 0,
              heartbeatTimeouts: webSocketStats.heartbeatTimeouts || 0
            },
            presence: presenceStats,
            combined: {
              totalConnections: presenceStats.totalConnections || 0,
              onlineUsers: presenceStats.onlineUsers || 0,
              redisAvailable: presenceStats.redisAvailable || false
            }
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("WebSocket stats error:", error);
        res.status(500).json({
          success: false,
          error: "Failed to get WebSocket statistics",
          code: "STATS_ERROR"
        });
      }
    }
  );

  // ========== HEALTH CHECK (Public) ==========
  router.get("/health", (req, res) => {
    try {
      const io = webSocketService?.getIo ? webSocketService.getIo() : null;

      const health = {
        webSocket: !!io,
        presenceService: !!presenceService,
        timestamp: new Date().toISOString()
      };

      // Get more detailed info if services are available
      if (io) {
        health.connectedSockets = Object.keys(io.sockets.sockets || {}).length;
        health.engineClients = io.engine?.clientsCount || 0;
      }

      if (presenceService?.getMetrics) {
        try {
          const metrics = presenceService.getMetrics();
          health.presenceMetrics = {
            onlineUsers: metrics.onlineUsers,
            redisAvailable: metrics.redisAvailable
          };
        } catch (err) {
          health.presenceMetrics = "error";
        }
      }

      const status = health.webSocket && health.presenceService ? "healthy" : "degraded";
      
      res.json({
        success: true,
        status,
        ...health
      });
    } catch (error) {
      logger.error("WebSocket health check error:", error);
      res.status(500).json({
        success: false,
        status: "unhealthy",
        error: "Health check failed"
      });
    }
  });

  // ========== GET ONLINE USERS (Admin/Moderator) ==========
  router.get(
    "/online-users",
    apiLimiter,
    protect,
    authorize("admin", "super_admin", "moderator"),
    validateNumericParams,
    async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 200);
        const page = parseInt(req.query.page) || 1;
        const offset = (page - 1) * limit;
        const userType = req.query.userType || 'all';

        let onlineUsers = [];
        let totalCount = 0;

        // Get from PresenceService
        if (presenceService && presenceService.getOnlineUsers) {
          onlineUsers = await presenceService.getOnlineUsers(limit, offset, userType);
          
          // For simplicity, use count from returned results
          // In production, you might want a separate count method
          totalCount = onlineUsers.length;
        }

        const totalPages = Math.ceil(totalCount / limit) || 1;

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
        logger.error("Online users error:", error);
        res.status(500).json({
          success: false,
          error: "Failed to get online users",
          code: "ONLINE_USERS_ERROR"
        });
      }
    }
  );

  // ========== GET NEARBY ONLINE USERS (Dating feature) ==========
  router.get(
    "/online-users/nearby",
    apiLimiter,
    protect,
    validateNumericParams,
    async (req, res) => {
      try {
        const userId = req.userId;
        if (!userId) {
          return res.status(401).json({
            success: false,
            error: "Authentication required",
            code: "UNAUTHORIZED"
          });
        }

        const radiusKm = Math.min(parseFloat(req.query.radius) || 10, 100);
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
        logger.error("Nearby online users error:", error);
        res.status(500).json({
          success: false,
          error: "Failed to get nearby online users",
          code: "NEARBY_USERS_ERROR"
        });
      }
    }
  );

  // ========== CHECK USER PRESENCE ==========
  router.post(
    "/presence/check",
    apiLimiter,
    protect,
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

        let onlineStatus = {};

        // Use PresenceService
        if (presenceService && presenceService.areUsersOnline) {
          onlineStatus = await presenceService.areUsersOnline(userIds);
        }

        res.json({
          success: true,
          data: onlineStatus,
          checkedCount: userIds.length,
          onlineCount: Object.values(onlineStatus).filter(Boolean).length,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Presence check error:", error);
        res.status(500).json({
          success: false,
          error: "Failed to check presence status",
          code: "PRESENCE_CHECK_ERROR"
        });
      }
    }
  );

  // ========== UPDATE USER PRESENCE ==========
  // NOTE: This should use the /api/presence routes instead
  // Keeping for backward compatibility
  router.post(
    "/presence/update",
    apiLimiter,
    protect,
    checkPresenceService,
    async (req, res) => {
      try {
        const { status, customStatus } = req.body;
        const userId = req.userId;

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

        // Use PresenceService
        let updateResult = false;
        if (presenceService && presenceService.updateUserStatus) {
          updateResult = await presenceService.updateUserStatus(userId, status, customStatus);
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
        logger.error("Presence update error:", error);
        res.status(500).json({
          success: false,
          error: "Failed to update presence",
          code: "PRESENCE_UPDATE_ERROR"
        });
      }
    }
  );

  // ========== DISCONNECT USER (Admin only) ==========
  router.post(
    "/disconnect-user",
    apiLimiter,
    protect,
    authorize("admin", "super_admin"),
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

        let disconnected = 0;

        // Use WebSocketService disconnect method
        if (webSocketService.disconnectUser) {
          disconnected = await webSocketService.disconnectUser(userId, reason);
        }

        // Update presence through PresenceService
        if (presenceService?.disconnectUser) {
          await presenceService.disconnectUser(userId);
        }

        res.json({
          success: true,
          message: `Disconnected ${disconnected} socket(s) for user ${userId}`,
          disconnected,
          reason,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Disconnect user error:", error);
        res.status(500).json({
          success: false,
          error: "Failed to disconnect user",
          code: "DISCONNECT_ERROR"
        });
      }
    }
  );

  // ========== BROADCAST MESSAGE (Admin only) ==========
  router.post(
    "/broadcast",
    apiLimiter,
    protect,
    authorize("admin", "super_admin"),
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

        // Validate event name
        const eventRegex = /^[a-zA-Z0-9:_\-\.]+$/;
        if (!eventRegex.test(event)) {
          return res.status(400).json({
            success: false,
            error: "Invalid event name",
            code: "INVALID_EVENT_NAME"
          });
        }

        // Use WebSocketService broadcast method
        if (webSocketService.broadcast) {
          webSocketService.broadcast(event, data, excludeUserId);
        }

        logger.info(`Admin broadcast: ${event}`, {
          adminId: req.userId,
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
        logger.error("Broadcast error:", error);
        res.status(500).json({
          success: false,
          error: "Failed to broadcast message",
          code: "BROADCAST_ERROR"
        });
      }
    }
  );

  // ========== SEND MESSAGE TO USER (Admin/Moderator) ==========
  router.post(
    "/send-message",
    apiLimiter,
    protect,
    authorize("admin", "super_admin", "moderator"),
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
        }

        logger.info(`Admin sent message to user: ${userId}`, {
          adminId: req.userId,
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
        logger.error("Send message error:", error);
        res.status(500).json({
          success: false,
          error: "Failed to send message",
          code: "SEND_MESSAGE_ERROR"
        });
      }
    }
  );

  // ========== GET USER CONNECTIONS (Admin only) ==========
  router.get(
    "/user/:userId/connections",
    apiLimiter,
    protect,
    authorize("admin", "super_admin"),
    checkWebSocketService,
    async (req, res) => {
      try {
        const { userId } = req.params;

        let connections = [];
        
        // Get connections from PresenceService
        if (presenceService && presenceService.getUserConnections) {
          connections = presenceService.getUserConnections(userId);
        }

        // Get user info if available
        const { BaseUser } = require("@models/User");
        const user = await BaseUser.findById(userId)
          .select("firstName lastName email userType role")
          .lean();

        res.json({
          success: true,
          userId,
          user: user || null,
          connections,
          connectionCount: connections.length,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error("Get user connections error:", error);
        res.status(500).json({
          success: false,
          error: "Failed to get user connections",
          code: "GET_CONNECTIONS_ERROR"
        });
      }
    }
  );

  // ========== ERROR HANDLER ==========
  router.use((err, req, res, next) => {
    logger.error("WebSocket routes error:", {
      path: req.path,
      method: req.method,
      userId: req.userId,
      error: err.message
    });

    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR'
      });
    }

    if (err.message && err.message.includes('Authentication') || err.code === 'AUTH_REQUIRED') {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (err.message && err.message.includes('permission') || err.code === 'FORBIDDEN') {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: 'FORBIDDEN'
      });
    }

    res.status(err.status || 500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : err.message,
      code: err.code || 'INTERNAL_SERVER_ERROR',
      service: 'websocket-api'
    });
  });

  // ========== 404 HANDLER ==========
  router.use((req, res) => {
    res.status(404).json({
      success: false,
      error: `WebSocket route ${req.method} ${req.originalUrl} not found`,
      code: 'WEBSOCKET_ENDPOINT_NOT_FOUND',
      availableEndpoints: [
        'GET    /stats (admin)',
        'GET    /health',
        'GET    /online-users (admin/moderator)',
        'GET    /online-users/nearby',
        'POST   /presence/check',
        'POST   /presence/update',
        'POST   /disconnect-user (admin)',
        'POST   /broadcast (admin)',
        'POST   /send-message (admin/moderator)',
        'GET    /user/:userId/connections (admin)'
      ],
      note: 'For presence management, use /api/presence routes instead'
    });
  });

  return router;
};