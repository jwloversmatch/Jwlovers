const jwt = require("jsonwebtoken");
const logger = require("@utils/logger");

class WebSocketHandler {
  constructor(io, presenceService, redisService, socketAuthMiddleware = null) {
    this.io = io;
    this.presenceService = presenceService;
    this.redisService = redisService;
    this.socketAuthMiddleware = socketAuthMiddleware;
    this.connectedUsers = new Map(); // userId -> Set of socketIds
    this.heartbeatTimeouts = new Map(); // socketId -> timeout
    this.rateLimiters = new Map(); // socketId -> {event: count}
    
    // Rate limiting config
    this.rateLimitConfig = {
      'presence:heartbeat': { max: 60, windowMs: 60000 }, // 60 per minute
      'presence:get': { max: 30, windowMs: 10000 }, // 30 per 10 seconds
      'presence:status': { max: 20, windowMs: 60000 }, // 20 status changes per minute
      'typing:start': { max: 120, windowMs: 60000 }, // 120 typing events per minute
    };
    
    this.logger = logger || console;
  }

  setupAuthentication() {
    try {
      if (this.socketAuthMiddleware) {
        // Use provided middleware
        this.io.use((socket, next) => {
          this.socketAuthMiddleware.authenticateSocket(socket, next);
        });
      } else if (this.redisService) {
        // Try to create SocketAuthMiddleware dynamically
        const SocketAuthMiddleware = require("@middleware/socket.auth");
        const socketAuth = new SocketAuthMiddleware(this.redisService);
        
        this.io.use((socket, next) => {
          socketAuth.authenticateSocket(socket, next);
        });
        
        this.socketAuthMiddleware = socketAuth;
      } else {
        // Fallback to basic auth
        this.setupBasicAuth();
      }
      
      this.logger.info("✅ WebSocket authentication middleware enabled");
    } catch (error) {
      this.logger.warn("⚠️ SocketAuthMiddleware not available, using basic auth", error.message);
      this.setupBasicAuth();
    }
  }

  setupBasicAuth() {
    this.io.use((socket, next) => {
      const token = socket.handshake.auth?.token || 
                    socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
                    socket.handshake.query?.token;

      if (!token) {
        this.logger.warn("WebSocket connection without token", {
          socketId: socket.id,
          ip: socket.handshake.address
        });
        return next(new Error('Authentication token required'));
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Validate required fields
        if (!decoded.userId && !decoded.id && !decoded.sub) {
          return next(new Error('Invalid token payload'));
        }
        
        socket.userId = decoded.userId || decoded.id || decoded.sub;
        socket.user = {
          id: socket.userId,
          email: decoded.email,
          name: decoded.name,
          avatar: decoded.avatar,
          userType: decoded.userType,
          role: decoded.role
        };
        
        next();
      } catch (error) {
        this.logger.warn("WebSocket authentication failed", {
          socketId: socket.id,
          error: error.message
        });
        return next(new Error('Invalid or expired token'));
      }
    });
  }

  setupPresenceHandlers() {
    this.io.on("connection", async (socket) => {
      const userId = socket.userId;
      const socketId = socket.id;
      const user = socket.user;

      if (!userId || !user) {
        this.logger.warn("WebSocket connection without user data", {
          socketId,
          hasUserId: !!userId,
          hasUser: !!user
        });
        socket.disconnect();
        return;
      }

      this.logger.info(`WebSocket connected: userId=${userId}, socketId=${socketId}, userType=${user.userType}`);

      try {
        // Track connected sockets for this user
        if (!this.connectedUsers.has(userId)) {
          this.connectedUsers.set(userId, new Set());
        }
        const userSockets = this.connectedUsers.get(userId);
        userSockets.add(socketId);

        // Join user's personal room
        socket.join(`user:${userId}`);

        // Register with PresenceService
        let connected = false;
        if (userSockets.size === 1) {
          // First socket for this user
          connected = await this.presenceService.userConnected(userId, socketId, {
            userName: user.name || `User ${userId}`,
            avatar: user.avatar,
            userType: user.userType,
            userAgent: socket.handshake.headers["user-agent"],
            ip: socket.handshake.address
          });
        } else {
          // Additional socket for this user (multi-device)
          if (this.presenceService.addSocketToUser) {
            connected = await this.presenceService.addSocketToUser(userId, socketId);
          } else {
            connected = true; // Assume success if method not available
          }
        }

        if (!connected) {
          this.logger.warn("Failed to connect to presence service", { userId, socketId });
          socket.emit("error", { 
            message: "Failed to connect to presence service",
            code: "PRESENCE_SERVICE_ERROR"
          });
          socket.disconnect();
          return;
        }

        // Setup heartbeat enforcement
        this.setupHeartbeat(socketId, userId);

        // Send current online users (limited)
        if (this.presenceService.getOnlineUsers) {
          const onlineUsers = await this.presenceService.getOnlineUsers(50);
          socket.emit("presence:online_users", {
            users: onlineUsers,
            total: onlineUsers.length,
            timestamp: new Date().toISOString()
          });
        }

        // Send current user's presence info
        if (this.presenceService.getUserPresence) {
          const presence = await this.presenceService.getUserPresence(userId);
          socket.emit("presence:self", presence);
        }

        // Broadcast user online status to others
        socket.broadcast.emit("presence:user_online", {
          userId,
          userName: user.name,
          avatar: user.avatar,
          userType: user.userType,
          timestamp: new Date().toISOString()
        });

        // Setup event handlers
        this.setupPresenceEvents(socket, userId, user);
        this.setupChatEvents(socket, userId, user);
        this.setupTypingEvents(socket, userId, user);

        // Setup rate limiting for this socket
        this.setupSocketRateLimiting(socket);

        // Success response
        socket.emit("presence:connected", {
          userId,
          socketId,
          userInfo: {
            name: user.name,
            avatar: user.avatar,
            userType: user.userType
          },
          serverTime: new Date().toISOString(),
          heartbeatInterval: 30000, // 30 seconds
          message: "Connected successfully"
        });

        this.logger.debug(`User ${userId} fully connected with socket ${socketId}`);
      } catch (error) {
        this.logger.error("Error setting up presence for user:", {
          error: error.message,
          userId,
          socketId,
          stack: error.stack
        });
        
        socket.emit("error", { 
          message: "Failed to setup presence",
          code: "SETUP_ERROR",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
        
        socket.disconnect();
      }
    });

    this.logger.info("✅ WebSocket presence handlers registered");
  }

  setupPresenceEvents(socket, userId, user) {
    // Status updates with rate limiting
    socket.on("presence:status", async (data) => {
      if (!this.checkRateLimit(socket, 'presence:status')) return;
      
      try {
        const { status, customStatus, expiresAt } = data || {};
        
        // Validate status
        const validStatuses = ['online', 'away', 'busy', 'offline', 'dnd', 'invisible'];
        if (status && !validStatuses.includes(status)) {
          socket.emit("presence:error", {
            message: "Invalid status",
            code: "INVALID_STATUS",
            validStatuses
          });
          return;
        }
        
        // Update status
        if (this.presenceService.updateUserStatus) {
          const success = await this.presenceService.updateUserStatus(userId, status, customStatus);
          
          if (success) {
            socket.emit("presence:status_updated", {
              status,
              customStatus,
              timestamp: new Date().toISOString()
            });
            
            // Broadcast to others
            socket.broadcast.emit("presence:user_status", {
              userId,
              status,
              customStatus,
              userName: user.name,
              timestamp: new Date().toISOString()
            });
          }
        }
      } catch (error) {
        this.logger.error("Error updating user status:", {
          error: error.message,
          userId,
          socketId: socket.id
        });
        
        socket.emit("presence:error", {
          message: "Failed to update status",
          code: "STATUS_UPDATE_ERROR"
        });
      }
    });

    // Heartbeat with enforcement
    socket.on("presence:heartbeat", async () => {
      if (!this.checkRateLimit(socket, 'presence:heartbeat')) return;
      
      try {
        // Reset heartbeat timeout
        this.resetHeartbeat(socket.id, userId);
        
        // Update last seen in presence service
        if (this.presenceService.refreshUserHeartbeat) {
          await this.presenceService.refreshUserHeartbeat(userId);
        }
        
        // Send acknowledgment
        socket.emit("presence:heartbeat_ack", {
          timestamp: new Date().toISOString(),
          serverTime: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error("Error processing heartbeat:", {
          error: error.message,
          userId,
          socketId: socket.id
        });
      }
    });

    // Get presence info for specific users
    socket.on("presence:get", async (data) => {
      if (!this.checkRateLimit(socket, 'presence:get')) return;
      
      try {
        const { userIds } = data || {};
        const targetUserIds = Array.isArray(userIds) ? userIds : [userIds || userId];
        
        // Limit to 50 users per request
        const limitedIds = targetUserIds.slice(0, 50);
        
        if (limitedIds.length === 0) {
          socket.emit("presence:error", {
            message: "No user IDs provided",
            code: "NO_USER_IDS"
          });
          return;
        }
        
        if (this.presenceService.areUsersOnline) {
          const onlineStatus = await this.presenceService.areUsersOnline(limitedIds);
          socket.emit("presence:info", {
            statuses: onlineStatus,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        this.logger.error("Error getting presence info:", {
          error: error.message,
          userId,
          socketId: socket.id
        });
        
        socket.emit("presence:error", {
          message: "Failed to get presence info",
          code: "PRESENCE_INFO_ERROR"
        });
      }
    });

    // Subscribe to presence updates for specific users
    socket.on("presence:subscribe", (data) => {
      const { userIds } = data || {};
      if (!Array.isArray(userIds)) return;
      
      // Limit to 20 subscriptions
      const limitedIds = userIds.slice(0, 20);
      
      limitedIds.forEach(targetUserId => {
        socket.join(`presence:${targetUserId}`);
      });
      
      socket.emit("presence:subscribed", {
        userIds: limitedIds,
        count: limitedIds.length,
        timestamp: new Date().toISOString()
      });
    });

    // Unsubscribe from presence updates
    socket.on("presence:unsubscribe", (data) => {
      const { userIds } = data || {};
      if (!Array.isArray(userIds)) return;
      
      userIds.forEach(targetUserId => {
        socket.leave(`presence:${targetUserId}`);
      });
    });

    // Disconnect handlers
    socket.on("disconnect", async (reason) => {
      this.logger.info(`User ${userId} disconnected: ${reason}, socket: ${socket.id}`);
      
      // Clear heartbeat timeout
      this.clearHeartbeat(socket.id);
      
      // Remove socket from tracking
      const userSockets = this.connectedUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          this.connectedUsers.delete(userId);
          // User has no more sockets, mark offline
          if (this.presenceService) {
            await this.presenceService.userDisconnected(userId, socket.id)
              .catch(err => {
                this.logger.error("Error in userDisconnected:", err);
              });
          }
        } else {
          // User still has other sockets
          if (this.presenceService?.removeSocketFromUser) {
            await this.presenceService.removeSocketFromUser(userId, socket.id)
              .catch(err => {
                this.logger.error("Error removing socket:", err);
              });
          }
        }
      }
      
      // Broadcast user offline if no more sockets
      if (!this.connectedUsers.has(userId)) {
        socket.broadcast.emit("presence:user_offline", {
          userId,
          userName: user.name,
          timestamp: new Date().toISOString(),
          reason
        });
      }
    });

    socket.on("presence:disconnect", async (data) => {
      const { reason = "user_requested" } = data || {};
      this.logger.info(`User ${userId} requested graceful disconnect: ${reason}`);
      
      socket.emit("presence:disconnecting", {
        reason,
        timestamp: new Date().toISOString()
      });
      
      // Small delay to allow client to receive disconnecting message
      setTimeout(() => {
        socket.disconnect();
      }, 100);
    });
  }

  setupChatEvents(socket, userId, user) {
    // Join chat room
    socket.on("chat:join", (data) => {
      const { chatId } = data || {};
      if (!chatId) return;
      
      socket.join(`chat:${chatId}`);
      socket.emit("chat:joined", { chatId });
      
      // Notify others
      socket.to(`chat:${chatId}`).emit("chat:user_joined", {
        chatId,
        userId,
        userName: user.name,
        timestamp: new Date().toISOString()
      });
    });

    // Leave chat room
    socket.on("chat:leave", (data) => {
      const { chatId } = data || {};
      if (!chatId) return;
      
      socket.leave(`chat:${chatId}`);
      socket.emit("chat:left", { chatId });
    });

    // Send message
    socket.on("chat:message", async (data) => {
      if (!this.checkRateLimit(socket, 'chat:message')) return;
      
      const { chatId, content, type = 'text' } = data || {};
      
      if (!chatId || !content || content.trim().length === 0) {
        socket.emit("chat:error", {
          message: "Chat ID and content are required",
          code: "INVALID_MESSAGE"
        });
        return;
      }
      
      if (content.length > 5000) {
        socket.emit("chat:error", {
          message: "Message too long (max 5000 characters)",
          code: "MESSAGE_TOO_LONG"
        });
        return;
      }
      
      try {
        // Create message object
        const message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          chatId,
          senderId: userId,
          senderName: user.name,
          senderAvatar: user.avatar,
          content: content.trim(),
          type,
          timestamp: new Date().toISOString(),
          status: 'sent'
        };
        
        // Save to database (you would implement this)
        // await this.saveMessage(message);
        
        // Broadcast to chat room
        socket.to(`chat:${chatId}`).emit("chat:message", message);
        
        // Confirm to sender
        socket.emit("chat:message_sent", {
          ...message,
          status: 'delivered'
        });
        
        this.logger.debug(`Message sent in chat ${chatId} by ${userId}`);
      } catch (error) {
        this.logger.error("Error sending chat message:", {
          error: error.message,
          userId,
          chatId
        });
        
        socket.emit("chat:error", {
          message: "Failed to send message",
          code: "SEND_FAILED"
        });
      }
    });
  }

  setupTypingEvents(socket, userId, user) {
    const typingDebounce = new Map(); // chatId -> timeout
    
    socket.on("typing:start", (data) => {
      if (!this.checkRateLimit(socket, 'typing:start')) return;
      
      const { chatId } = data || {};
      if (!chatId) return;
      
      // Debounce typing events
      if (typingDebounce.has(chatId)) {
        clearTimeout(typingDebounce.get(chatId));
      }
      
      // Notify others in chat
      socket.to(`chat:${chatId}`).emit("typing:start", {
        chatId,
        userId,
        userName: user.name,
        timestamp: new Date().toISOString()
      });
      
      // Set debounce timeout
      const timeout = setTimeout(() => {
        typingDebounce.delete(chatId);
      }, 1000);
      
      typingDebounce.set(chatId, timeout);
    });

    socket.on("typing:stop", (data) => {
      const { chatId } = data || {};
      if (!chatId) return;
      
      // Clear debounce
      if (typingDebounce.has(chatId)) {
        clearTimeout(typingDebounce.get(chatId));
        typingDebounce.delete(chatId);
      }
      
      // Notify others
      socket.to(`chat:${chatId}`).emit("typing:stop", {
        chatId,
        userId,
        timestamp: new Date().toISOString()
      });
    });
    
    // Clean up on disconnect
    socket.on("disconnect", () => {
      typingDebounce.forEach(timeout => clearTimeout(timeout));
      typingDebounce.clear();
    });
  }

  setupSocketRateLimiting(socket) {
    socket.rateLimits = new Map();
    
    // Clear rate limits on disconnect
    socket.on("disconnect", () => {
      if (socket.rateLimits) {
        socket.rateLimits.clear();
      }
    });
  }

  checkRateLimit(socket, event) {
    if (!this.rateLimitConfig[event]) return true;
    
    const now = Date.now();
    const limitConfig = this.rateLimitConfig[event];
    
    if (!socket.rateLimits) {
      socket.rateLimits = new Map();
    }
    
    const rateLimit = socket.rateLimits.get(event) || {
      count: 0,
      resetTime: now + limitConfig.windowMs
    };
    
    // Reset if window has passed
    if (now > rateLimit.resetTime) {
      rateLimit.count = 0;
      rateLimit.resetTime = now + limitConfig.windowMs;
    }
    
    // Check if limit exceeded
    if (rateLimit.count >= limitConfig.max) {
      this.logger.warn(`Rate limit exceeded for event ${event}`, {
        socketId: socket.id,
        userId: socket.userId,
        count: rateLimit.count,
        max: limitConfig.max
      });
      
      socket.emit("error:rate_limit", {
        event,
        message: `Rate limit exceeded for ${event}`,
        resetIn: Math.ceil((rateLimit.resetTime - now) / 1000),
        code: "RATE_LIMIT_EXCEEDED"
      });
      
      return false;
    }
    
    // Increment count
    rateLimit.count++;
    socket.rateLimits.set(event, rateLimit);
    
    return true;
  }

  setupHeartbeat(socketId, userId) {
    this.resetHeartbeat(socketId, userId);
  }

  resetHeartbeat(socketId, userId) {
    // Clear existing timeout
    this.clearHeartbeat(socketId);
    
    // Set new timeout (disconnect after 70 seconds of inactivity)
    const timeout = setTimeout(() => {
      this.logger.warn(`Heartbeat timeout for socket ${socketId}, user ${userId}`);
      const socket = this.io?.sockets?.sockets?.get(socketId);
      if (socket) {
        socket.emit("heartbeat:timeout", {
          message: "Connection timeout due to inactivity",
          reconnect: true
        });
        socket.disconnect();
      }
    }, 70000); // 70 seconds
    
    this.heartbeatTimeouts.set(socketId, timeout);
  }

  clearHeartbeat(socketId) {
    if (this.heartbeatTimeouts.has(socketId)) {
      clearTimeout(this.heartbeatTimeouts.get(socketId));
      this.heartbeatTimeouts.delete(socketId);
    }
  }

  setupRateLimiting(socketRateLimit) {
    if (socketRateLimit) {
      this.io.use(socketRateLimit);
      this.logger.info("✅ Socket.IO rate limiting enabled");
    }
  }

  // Utility methods
  sendToUser(userId, event, data) {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  sendToChat(chatId, event, data) {
    this.io.to(`chat:${chatId}`).emit(event, data);
  }

  sendToUserType(userType, event, data) {
    this.io.to(`userType:${userType}`).emit(event, data);
  }

  // Get connected users
  getConnectedUsers() {
    const result = {};
    for (const [userId, sockets] of this.connectedUsers.entries()) {
      result[userId] = Array.from(sockets);
    }
    return result;
  }

  // Disconnect user from all sockets
  disconnectUser(userId, reason = "admin_action") {
    const sockets = this.connectedUsers.get(userId);
    if (!sockets) return 0;
    
    let disconnected = 0;
    sockets.forEach(socketId => {
      const socket = this.io?.sockets?.sockets?.get(socketId);
      if (socket) {
        socket.emit("admin:disconnect", { reason });
        socket.disconnect(true);
        disconnected++;
      }
    });
    
    this.connectedUsers.delete(userId);
    return disconnected;
  }

  // Cleanup
  cleanup() {
    // Clear all heartbeats
    for (const timeout of this.heartbeatTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.heartbeatTimeouts.clear();
    
    // Clear connected users
    this.connectedUsers.clear();
    
    this.logger.info("WebSocketHandler cleaned up");
  }
}

module.exports = WebSocketHandler;