const socketIo = require("socket.io");
const logger = require("@utils/logger");
const MessageService = require("@controllers/chat/MessageService");
const messageFormatter = require("@formatters/MessageFormatter"); // ← ADDED FOR DECRYPTION

class WebSocketService {
  constructor(config, services, socketSchemas, logger, redisService) {
    this.config = config;
    this.services = services;
    this.socketSchemas = socketSchemas;
    this.logger = logger || console;
    this.redisService = redisService;
    this.io = null;
    this.presenceService = null;
    this.socketAuth = null;
    this.encryptionService = null; // ← ADDED FOR DECRYPTION

    this.typingDebounce = new Map();
    this.heartbeatTimeouts = new Map();
    this.socketUserMap = new Map();

    this.rateLimitConfig = {
      "message:send": { max: 30, windowMs: 60000 },
      "typing:start": { max: 60, windowMs: 60000 },
      heartbeat: { max: 120, windowMs: 60000 },
      join_conversation: { max: 30, windowMs: 60000 },
    };

    this.logger.info("WebSocket service initialized");
  }

  async setup(server, corsOrigins) {
    try {
      const corsOptions = {
        origin: corsOrigins || process.env.FRONTEND_URL || "*",
        methods: ["GET", "POST"],
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      };

      this.io = socketIo(server, {
        cors: corsOptions,
        pingTimeout: 300000,
        pingInterval: 25000,
        connectionStateRecovery: {
          maxDisconnectionDuration: 2 * 60 * 1000,
          skipMiddlewares: true,
        },
        transports: ["websocket", "polling"],
        maxHttpBufferSize: 1e7,
      });

      this.logger.info("✅ WebSocket server setup completed");
      return this.io;
    } catch (error) {
      this.logger.error("❌ Failed to setup WebSocket:", error);
      throw error;
    }
  }

  setupMiddleware() {
    if (!this.io) return;

    try {
      const SocketAuthMiddleware = require("@middleware/socket.auth");
      this.socketAuth = new SocketAuthMiddleware(this.redisService);

      this.io.use((socket, next) => {
        this.socketAuth.authenticateSocket(socket, next);
      });

      this.logger.info("✅ WebSocket middleware setup");
    } catch (error) {
      this.logger.error("Failed to setup WebSocket middleware:", error);
    }
  }

  checkRateLimit(socket, event) {
    if (!this.rateLimitConfig[event]) return true;

    const now = Date.now();
    const limitConfig = this.rateLimitConfig[event];
    const key = `${socket.id}:${event}`;

    if (!socket.rateLimits) {
      socket.rateLimits = new Map();
    }

    const rateLimit = socket.rateLimits.get(key) || {
      count: 0,
      resetTime: now + limitConfig.windowMs,
    };

    if (now > rateLimit.resetTime) {
      rateLimit.count = 0;
      rateLimit.resetTime = now + limitConfig.windowMs;
    }

    if (rateLimit.count >= limitConfig.max) {
      this.logger.warn(`Rate limit exceeded for event ${event}`, {
        socketId: socket.id,
        userId: socket.userId,
      });

      socket.emit("error:rate-limit", {
        event,
        message: "Rate limit exceeded",
        resetIn: Math.ceil((rateLimit.resetTime - now) / 1000),
      });

      return false;
    }

    rateLimit.count++;
    socket.rateLimits.set(key, rateLimit);
    return true;
  }

  getUserDisplayInfo(user) {
    if (!user) return null;

    return {
      userId: user.id || user._id?.toString(),
      userName:
        user.profile?.userName ||
        user.userName ||
        `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
        "Unknown User",
      avatar: user.profile?.profilePicture?.url || null,
      userType: user.userType || "User",
      role: user.role || "user",
    };
  }

  setupEventHandlers() {
    if (!this.io) return;

    this.io.on("connection", (socket) => {
      const userId = socket.userId;
      const socketId = socket.id;
      const user = socket.user;

      if (!userId || !user) {
        this.logger.warn("Socket connected without user data, disconnecting");
        socket.disconnect();
        return;
      }

      const userInfo = this.getUserDisplayInfo(user);

      this.logger.info(
        `Socket connected: ${socketId} for user: ${userId} (${userInfo.userType})`,
      );

      this.socketUserMap.set(socketId, userId);
      socket.join(`user:${userId}`);

      if (this.presenceService) {
        this.presenceService
          .userConnected(userId, socketId, {
            userName: userInfo.userName,
            avatar: userInfo.avatar,
            userType: userInfo.userType,
            role: userInfo.role,
          })
          .catch((err) => this.logger.error("Error in userConnected:", err));
      }

      this.io.emit("user:online", {
        userId,
        userName: userInfo.userName,
        avatar: userInfo.avatar,
        userType: userInfo.userType,
        timestamp: new Date().toISOString(),
      });

      this.io.to(`presence:${userId}`).emit("user:status-changed", {
        userId,
        status: "online",
        timestamp: new Date().toISOString(),
      });

      this.logger.info(
        `[WS] 📡 user:online emitted for userId=${userId} userName="${userInfo.userName}"`,
      );

      this.setupHeartbeat(socketId, userId);

      socket.on("heartbeat", (data, callback) => {
        if (!this.checkRateLimit(socket, "heartbeat")) return;

        this.resetHeartbeat(socketId, userId);
        if (this.presenceService?.refreshUserHeartbeat) {
          this.presenceService.refreshUserHeartbeat(userId).catch(() => {});
        }

        const latency = data?.timestamp ? Date.now() - data.timestamp : 0;

        if (typeof callback === "function") {
          callback({ success: true, latency });
        }

        socket.emit("heartbeat:ack", {
          timestamp: data?.timestamp ?? Date.now(),
          latency,
          success: true,
        });
      });

      socket.on("presence:heartbeat", () => {
        this.resetHeartbeat(socketId, userId);
        if (this.presenceService?.refreshUserHeartbeat) {
          this.presenceService.refreshUserHeartbeat(userId).catch(() => {});
        }
        socket.emit("heartbeat:ack", {
          timestamp: Date.now(),
          latency: 0,
          success: true,
        });
      });

      socket.on("join_conversation", (conversationId, callback) => {
        if (!this.checkRateLimit(socket, "join_conversation")) return;

        if (!conversationId) {
          if (typeof callback === "function")
            callback({ success: false, error: "Conversation ID required" });
          return;
        }

        const room = `conversation:${conversationId}`;
        socket.join(room);

        this.logger.debug(
          `User ${userId} joined conversation ${conversationId}`,
        );

        if (typeof callback === "function") {
          callback({ success: true });
        }

        socket.emit("joined_conversation", {
          conversationId,
          room,
          timestamp: new Date().toISOString(),
        });

        socket.to(room).emit("user:joined", {
          userId,
          userName: userInfo.userName,
          avatar: userInfo.avatar,
          timestamp: new Date().toISOString(),
        });
      });

      socket.on("join:chat", (data) => {
        if (!this.checkRateLimit(socket, "join_conversation")) return;
        const { chatId } = data || {};
        if (!chatId) return;
        socket.join(`conversation:${chatId}`);
        socket.to(`conversation:${chatId}`).emit("user:joined", {
          userId,
          userName: userInfo.userName,
          avatar: userInfo.avatar,
          timestamp: new Date().toISOString(),
        });
      });

      socket.on("leave_conversation", (conversationId, callback) => {
        if (!conversationId) {
          if (typeof callback === "function") callback({ success: false });
          return;
        }

        const room = `conversation:${conversationId}`;
        socket.leave(room);

        if (typeof callback === "function") callback({ success: true });

        socket.to(room).emit("user:left", {
          userId,
          userName: userInfo.userName,
          timestamp: new Date().toISOString(),
        });
      });

      socket.on("leave:chat", (data) => {
        const { chatId } = data || {};
        if (chatId) {
          socket.leave(`conversation:${chatId}`);
          socket.to(`conversation:${chatId}`).emit("user:left", {
            userId,
            userName: userInfo.userName,
            timestamp: new Date().toISOString(),
          });
        }
      });

      socket.on("typing:start", (data) => {
        if (!this.checkRateLimit(socket, "typing:start")) return;

        const { conversationId, receiverId } = data || {};
        if (!conversationId) return;

        const typingKey = `typing:${userId}:${conversationId}`;
        if (this.typingDebounce.has(typingKey)) return;

        this.typingDebounce.set(typingKey, true);
        setTimeout(() => this.typingDebounce.delete(typingKey), 1000);

        const payload = {
          userId,
          userName: userInfo.userName,
          conversationId,
          isTyping: true,
          timestamp: new Date().toISOString(),
        };

        socket
          .to(`conversation:${conversationId}`)
          .emit("user:typing", payload);

        if (receiverId) {
          socket.to(`user:${receiverId}`).emit("user:typing", payload);
        }
      });

      socket.on("typing:stop", (data) => {
        const { conversationId, receiverId } = data || {};
        if (!conversationId) return;

        this.typingDebounce.delete(`typing:${userId}:${conversationId}`);

        const payload = {
          userId,
          userName: userInfo.userName,
          conversationId,
          isTyping: false,
          timestamp: new Date().toISOString(),
        };

        socket
          .to(`conversation:${conversationId}`)
          .emit("user:typing", payload);

        if (receiverId) {
          socket.to(`user:${receiverId}`).emit("user:typing", payload);
        }
      });

      // ── 🔥 FIXED: Send message with DECRYPTION ────────────────────────────
      socket.on("message:send", async (data, callback) => {
        if (!this.checkRateLimit(socket, "message:send")) return;

        try {
          const {
            conversationId,
            receiverId,
            content,
            type = "text",
            clientMessageId,
          } = data || {};

          if (!content || content.trim().length === 0) {
            if (typeof callback === "function") {
              callback({
                success: false,
                error: "Content is required",
                code: "VALIDATION_ERROR",
              });
            }
            return;
          }

          if (content.length > 5000) {
            if (typeof callback === "function") {
              callback({
                success: false,
                error: "Message too long (max 5000 characters)",
                code: "MESSAGE_TOO_LONG",
              });
            }
            return;
          }

          let message = null;

          if (this.services.chatService) {
            // Call chatService (returns ENCRYPTED message from DB)
            message = await this.services.chatService.sendMessage({
              senderId: userId,
              receiverId,
              chatId: conversationId,
              content: content.trim(),
              type,
              clientMessageId,
              metadata: data.metadata || {},
            });
          } else {
            // Fallback if no chat service
            message = {
              _id: clientMessageId || `${Date.now()}`,
              senderId: userId,
              receiverId,
              conversationId,
              content: content.trim(),
              type,
              status: "sent",
              timestamp: new Date().toISOString(),
              clientMessageId,
            };
          }

          // 🔥 CRITICAL FIX: DECRYPT the message before emitting
          let decryptedMessage = message;

          // Create a mock req object for messageFormatter
          const mockReq = {
            app: {
              get: (key) => {
                if (key === "EncryptionService") {
                  return this.encryptionService || null;
                }
                return null;
              },
            },
          };

          try {
            // Decrypt the message content
            if (messageFormatter && messageFormatter.formatSocketMessage) {
              decryptedMessage = messageFormatter.formatSocketMessage(
                mockReq,
                message,
                userId,
              );
              this.logger.debug("✅ Message decrypted for socket emission", {
                messageId: message._id,
                originalLength: message.content?.length || 0,
                decryptedLength: decryptedMessage.content?.length || 0,
              });
            }
          } catch (decryptError) {
            this.logger.error(
              "❌ Failed to decrypt message for socket:",
              decryptError,
            );
            // If decryption fails, show error indicator
            decryptedMessage.content =
              "🔒 [Encrypted message - decryption failed]";
          }

          const fullMessage = {
            ...decryptedMessage, // ← NOW CONTAINS PLAINTEXT!
            senderName: userInfo.userName,
            senderAvatar: userInfo.avatar,
          };

          // 🔴 Broadcast DECRYPTED message to conversation room
          if (conversationId) {
            this.logger.info(
              `📡 Broadcasting decrypted message to conversation:${conversationId}`,
              {
                messageId: fullMessage._id,
                contentPreview: fullMessage.content?.substring(0, 20),
              },
            );
            this.io
              .to(`conversation:${conversationId}`)
              .emit("new_message", fullMessage);
          }

          // Also broadcast to receiver's personal room
          if (receiverId) {
            this.io.to(`user:${receiverId}`).emit("new_message", fullMessage);
          }

          // Send ack to the sender
          if (typeof callback === "function") {
            callback({
              success: true,
              messageId: message._id || message.id,
              data: fullMessage,
            });
          }
        } catch (error) {
          this.logger.error("❌ Message send error:", error);
          if (typeof callback === "function") {
            callback({
              success: false,
              error: error.message || "Failed to send message",
              code: error.code || "SEND_FAILED",
            });
          }
        }
      });

      socket.on("messages:viewed", async (data, callback) => {
        const { conversationId, messageIds, receiverId } = data || {};

        if (!messageIds?.length) {
          if (typeof callback === "function") callback({ success: true });
          return;
        }

        try {
          if (this.services.chatService?.markAsRead) {
            for (const msgId of messageIds) {
              await this.services.chatService
                .markAsRead(msgId, userId)
                .catch(() => {});
            }
          }

          const readPayload = {
            messageIds,
            readerId: userId,
            readerName: userInfo.userName,
            timestamp: new Date().toISOString(),
          };

          if (conversationId) {
            socket
              .to(`conversation:${conversationId}`)
              .emit("messages:read", readPayload);
          }
          if (receiverId) {
            socket.to(`user:${receiverId}`).emit("messages:read", readPayload);
          }

          if (typeof callback === "function") callback({ success: true });
        } catch (error) {
          this.logger.error("Messages viewed error:", error);
          if (typeof callback === "function") callback({ success: true });
        }
      });

      socket.on("message:read", async (data) => {
        const { messageId, chatId } = data || {};
        if (!messageId || !chatId) return;

        try {
          if (this.services.chatService?.markAsRead) {
            await this.services.chatService.markAsRead(messageId, userId);
            this.io.to(`conversation:${chatId}`).emit("messages:read", {
              messageIds: [messageId],
              readerId: userId,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (error) {
          this.logger.error("Message read error:", error);
        }
      });

      socket.on("presence:subscribe", (data) => {
        const { userIds } = data || {};
        if (!Array.isArray(userIds)) return;
        userIds
          .slice(0, 50)
          .forEach((targetId) => socket.join(`presence:${targetId}`));
      });

      socket.on("presence:unsubscribe", (data) => {
        const { userIds } = data || {};
        if (!Array.isArray(userIds)) return;
        userIds.forEach((targetId) => socket.leave(`presence:${targetId}`));
      });

      socket.on("debug:get_rooms", () => {
        const rooms = Array.from(socket.rooms);
        socket.emit("debug:rooms_list", {
          userId,
          userName: userInfo.userName,
          rooms,
          timestamp: new Date().toISOString(),
        });
      });

      socket.on("presence:get", async (targetUserId) => {
        if (!targetUserId || !this.presenceService?.areUsersOnline) return;
        const isOnline = await this.presenceService.areUsersOnline([
          targetUserId,
        ]);
        socket.emit("presence:info", {
          userId: targetUserId,
          isOnline: isOnline[targetUserId],
          timestamp: new Date().toISOString(),
        });
      });

      socket.on("online:status", async (data) => {
        const { userIds } = data || {};
        if (!Array.isArray(userIds) || !userIds.length || userIds.length > 100)
          return;
        if (!this.presenceService?.areUsersOnline) return;
        const onlineStatus = await this.presenceService.areUsersOnline(userIds);
        socket.emit("online:status:response", {
          statuses: onlineStatus,
          timestamp: new Date().toISOString(),
        });
      });

      socket.on("error", (error) => {
        this.logger.error(`Socket error for user ${userId}:`, error);
      });

      socket.on("disconnect:manual", (reason) => {
        this.logger.info(`Manual disconnect for user ${userId}: ${reason}`);
        socket.disconnect(true);
      });

      socket.on("disconnect", async (reason) => {
        this.logger.info(
          `Socket disconnected: ${socketId} for user: ${userId}, reason: ${reason}`,
        );

        this.clearHeartbeat(socketId);
        this.socketUserMap.delete(socketId);

        for (const [key] of this.typingDebounce.entries()) {
          if (key.startsWith(`typing:${userId}:`)) {
            this.typingDebounce.delete(key);
          }
        }

        if (this.presenceService) {
          await this.presenceService
            .userDisconnected(userId, socketId)
            .catch((err) =>
              this.logger.error("Error in userDisconnected:", err),
            );
        }

        try {
          const remainingSockets = await this.io
            .in(`user:${userId}`)
            .fetchSockets();

          if (remainingSockets.length === 0) {
            this.io.emit("user:offline", {
              userId,
              userName: userInfo.userName,
              timestamp: new Date().toISOString(),
            });

            this.io.to(`presence:${userId}`).emit("user:status-changed", {
              userId,
              status: "offline",
              timestamp: new Date().toISOString(),
            });

            this.logger.info(
              `[WS] 📡 user:offline emitted for userId=${userId} (no remaining sockets)`,
            );
          } else {
            this.logger.debug(
              `[WS] user:offline suppressed for ${userId} — ${remainingSockets.length} socket(s) still open`,
            );
          }
        } catch (emitErr) {
          this.logger.error("Error emitting user:offline:", emitErr);
        }
      });
    });

    this.logger.info("✅ WebSocket event handlers setup");
  }

  setupHeartbeat(socketId, userId) {
    this.resetHeartbeat(socketId, userId);
  }

  resetHeartbeat(socketId, userId) {
    this.clearHeartbeat(socketId);

    const timeout = setTimeout(() => {
      this.logger.warn(
        `Heartbeat timeout for socket ${socketId}, user ${userId}`,
      );
      const socket = this.io?.sockets?.sockets?.get(socketId);
      if (socket) {
        socket.emit("heartbeat:timeout", {
          message: "Connection timeout due to inactivity",
          reconnect: true,
        });
        socket.disconnect(true);
      }
    }, 330000);

    this.heartbeatTimeouts.set(socketId, timeout);
  }

  clearHeartbeat(socketId) {
    if (this.heartbeatTimeouts.has(socketId)) {
      clearTimeout(this.heartbeatTimeouts.get(socketId));
      this.heartbeatTimeouts.delete(socketId);
    }
  }

  setPresenceService(presenceService) {
    this.presenceService = presenceService;
    this.logger.info("✅ PresenceService injected into WebSocketService");
  }

  // ── 🔥 NEW: Inject encryption service for decryption ──────────────────────
  setEncryptionService(encryptionService) {
    this.encryptionService = encryptionService;
    this.logger.info("✅ EncryptionService injected into WebSocketService");
  }

  getUserIdFromSocket(socketId) {
    return this.socketUserMap.get(socketId);
  }

  async isUserOnline(userId) {
    if (this.presenceService?.areUsersOnline) {
      const results = await this.presenceService.areUsersOnline([userId]);
      return results[userId] || false;
    }
    return false;
  }

  sendToUser(userId, event, data) {
    if (!this.io) return false;
    this.io.to(`user:${userId}`).emit(event, data);
    return true;
  }

  broadcast(event, data, excludeUserId = null) {
    if (!this.io) return false;
    if (excludeUserId) {
      this.io.except(`user:${excludeUserId}`).emit(event, data);
    } else {
      this.io.emit(event, data);
    }
    return true;
  }

  async disconnectUser(userId, reason = "admin_disconnect") {
    if (!this.io) return 0;

    let disconnectedCount = 0;
    const socketsInUserRoom = await this.io.in(`user:${userId}`).fetchSockets();

    for (const socket of socketsInUserRoom) {
      socket.emit("force:disconnect", {
        reason,
        message: "You have been disconnected by an administrator",
      });
      socket.disconnect(true);
      disconnectedCount++;
    }

    return disconnectedCount;
  }

  getIo() {
    return this.io;
  }

  getStats() {
    if (!this.io) return {};

    return {
      connectedSockets: Object.keys(this.io.sockets.sockets || {}).length,
      uniqueSocketUsers: this.socketUserMap.size,
      heartbeatTimeouts: this.heartbeatTimeouts.size,
      typingDebounce: this.typingDebounce.size,
      timestamp: new Date().toISOString(),
      presenceServiceStats: this.presenceService?.getMetrics?.() || {},
      authMetrics: this.socketAuth?.getMetrics?.() || {},
    };
  }

  async cleanup() {
    for (const timeout of this.heartbeatTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.heartbeatTimeouts.clear();
    this.socketUserMap.clear();
    this.typingDebounce.clear();

    if (this.io) {
      this.io.close();
      this.logger.info("WebSocket server closed");
    }
  }
}

module.exports = WebSocketService;
