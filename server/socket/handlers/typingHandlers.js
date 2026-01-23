const CONFIG = require("../../config/constants");
const logger = require("../../utils/logger");

const setupTypingHandlers = (io, socket, rateLimiter) => {
  const userId = socket.userId;
  const userName = socket.user?.name || socket.user?.username || `User-${userId?.substring(0, 8)}`;

  socket.on("typing:start", (data) => {
    if (!rateLimiter.check(
      userId, 
      "typing", 
      CONFIG.RATE_LIMITS.TYPING_EVENTS_PER_MINUTE, 
      CONFIG.RATE_LIMITS.WINDOW_MS
    )) {
      return;
    }

    const { conversationId, receiverId } = data;

    const typingData = {
      userId,
      userName,
      isTyping: true,
      timestamp: new Date().toISOString()
    };

    if (conversationId) {
      socket.to(`conversation_${conversationId}`).emit("user:typing", {
        ...typingData,
        conversationId
      });
    } else if (receiverId) {
      socket.to(`user_${receiverId}`).emit("user:typing", typingData);
    }
  });

  socket.on("typing:stop", (data) => {
    const { conversationId, receiverId } = data;

    const typingData = {
      userId,
      userName,
      isTyping: false,
      timestamp: new Date().toISOString()
    };

    if (conversationId) {
      socket.to(`conversation_${conversationId}`).emit("user:typing", {
        ...typingData,
        conversationId
      });
    } else if (receiverId) {
      socket.to(`user_${receiverId}`).emit("user:typing", typingData);
    }
  });
};

module.exports = { setupTypingHandlers };