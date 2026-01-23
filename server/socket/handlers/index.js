const { setupMessageHandlers } = require("./messageHandlers");
const { setupPresenceHandlers } = require("./presenceHandlers");
const { setupTypingHandlers } = require("./typingHandlers");
const logger = require("../../utils/logger");

const setupSocketHandlers = (io, socket, redisService, rateLimiter) => {
  const userId = socket.userId;
  const userName = socket.user?.name || socket.user?.username || `User-${userId?.substring(0, 8) || "unknown"}`;
  
  logger.info(`✅ WebSocket connected: ${userName} (${userId}) - Socket: ${socket.id}`, {
    requestId: socket.requestId
  });

  redisService.setUserOnline(userId, socket.id, {
    userName,
    avatar: socket.user?.avatar
  });

  const userRoom = `user_${userId}`;
  socket.join(userRoom);
  logger.debug(`${userName} auto-joined room: ${userRoom}`);

  setupMessageHandlers(io, socket, redisService, rateLimiter);
  setupPresenceHandlers(io, socket, redisService);
  setupTypingHandlers(io, socket, rateLimiter);

  socket.on("join_conversation", (conversationId) => {
    if (!conversationId) return;
    
    const conversationRoom = `conversation_${conversationId}`;
    socket.join(conversationRoom);
    logger.info(`✅ ${userName} joined conversation: ${conversationRoom}`);

    socket.emit("joined_conversation", {
      conversationId,
      room: conversationRoom,
      timestamp: new Date().toISOString()
    });
  });

  socket.on("leave_conversation", (conversationId) => {
    if (!conversationId) return;

    const conversationRoom = `conversation_${conversationId}`;
    socket.leave(conversationRoom);
    logger.debug(`${userName} left conversation: ${conversationRoom}`);
  });

  socket.on("messages:viewed", async (data) => {
    const { conversationId, messageIds, receiverId } = data;

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return;
    }

    const validMessageIds = messageIds.filter(id => 
      require("mongoose").Types.ObjectId.isValid(id)
    );
    
    if (validMessageIds.length === 0) return;

    const readData = {
      messageIds: validMessageIds,
      readerId: userId,
      readerName: userName,
      timestamp: new Date().toISOString()
    };

    if (conversationId) {
      socket.to(`conversation_${conversationId}`).emit("messages:read", readData);
    }

    if (receiverId) {
      socket.to(`user_${receiverId}`).emit("messages:read", readData);
    }

    try {
      const MessageService = require("../../services/MessageService");
      await MessageService.markMessagesAsRead(validMessageIds, userId);
    } catch (error) {
      logger.error("Failed to update read status in DB:", error);
    }
  });

  socket.on("disconnect", async (reason) => {
    logger.info(`❌ WebSocket disconnected: ${userName} (${userId}) - Reason: ${reason}`);

    await redisService.setUserOffline(userId);

    socket.broadcast.emit("user:offline", {
      userId,
      name: userName,
      timestamp: new Date().toISOString()
    });
  });
};

module.exports = { setupSocketHandlers };