// handlers/WebSocketHandler.js
const jwt = require("jsonwebtoken");

class WebSocketHandler {
  constructor(io, presenceService, logger) {
    this.io = io;
    this.presenceService = presenceService;
    this.logger = logger;
  }

  setupAuthentication() {
    try {
      const SocketAuthMiddleware = require("@/middleware/socketAuth");
      const socketAuth = new SocketAuthMiddleware(this.presenceService.redisService);

      this.io.use((socket, next) => {
        socketAuth.authenticateSocket(socket, next);
      });

      this.logger.info("✅ WebSocket authentication middleware enabled");
    } catch (error) {
      this.logger.warn("⚠️ SocketAuthMiddleware not available, using basic auth");
      this.setupBasicAuth();
    }
  }

  setupBasicAuth() {
    this.io.use((socket, next) => {
      const token = socket.handshake.auth?.token || 
                    socket.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.userId;
        socket.user = { id: decoded.userId };
        next();
      } catch (error) {
        return next(new Error('Invalid token'));
      }
    });
  }

  setupPresenceHandlers() {
    this.io.on("connection", async (socket) => {
      const userId = socket.userId || socket.handshake.auth?.userId;
      const socketId = socket.id;

      if (!userId) {
        this.logger.warn("WebSocket connection without userId");
        socket.disconnect();
        return;
      }

      this.logger.info(`WebSocket connected: userId=${userId}, socketId=${socketId}`);

      try {
        // Register with PresenceService
        const connected = await this.presenceService.userConnected(userId, socketId, {
          userName: socket.handshake.auth?.userName,
          avatar: socket.handshake.auth?.avatar,
          userAgent: socket.handshake.headers["user-agent"],
        });

        if (!connected) {
          socket.emit("error", { message: "Failed to connect to presence service" });
          socket.disconnect();
          return;
        }

        // Join user's personal room
        socket.join(`user:${userId}`);

        // Send current online users
        const onlineUsers = await this.presenceService.getOnlineUsers();
        socket.emit("presence:online_users", onlineUsers);

        // Setup event handlers
        this.setupPresenceEvents(socket, userId, socketId);

        // Success
        socket.emit("presence:connected", {
          userId,
          socketId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        this.logger.error("Error setting up presence for user:", error);
        socket.emit("error", { message: "Failed to setup presence" });
        socket.disconnect();
      }
    });

    this.logger.info("✅ WebSocket presence handlers registered");
  }

  setupPresenceEvents(socket, userId, socketId) {
    // Status updates
    socket.on("presence:away", async () => {
      await this.presenceService.updateUserStatus(userId, "away");
    });

    socket.on("presence:back", async () => {
      await this.presenceService.updateUserStatus(userId, "online");
    });

    socket.on("presence:busy", async () => {
      await this.presenceService.updateUserStatus(userId, "busy");
    });

    // Heartbeat
    socket.on("presence:heartbeat", async () => {
      socket.emit("presence:heartbeat_ack", {
        timestamp: new Date().toISOString(),
      });
    });

    // Get presence info
    socket.on("presence:get", async (targetUserId) => {
      const isOnline = await this.presenceService.areUsersOnline([targetUserId || userId]);
      socket.emit("presence:info", {
        userId: targetUserId || userId,
        online: isOnline[targetUserId || userId],
      });
    });

    // Disconnect handlers
    socket.on("disconnect", async (reason) => {
      this.logger.info(`User ${userId} disconnected: ${reason}, socket: ${socketId}`);
      await this.presenceService.userDisconnected(userId, socketId);
    });

    socket.on("presence:disconnect", async () => {
      this.logger.info(`User ${userId} requested graceful disconnect`);
      await this.presenceService.userDisconnected(userId, socketId);
      socket.disconnect();
    });
  }

  setupRateLimiting(socketRateLimit) {
    this.io.use(socketRateLimit);
    this.logger.info("✅ Socket.IO rate limiting enabled");
  }
}

module.exports = WebSocketHandler;