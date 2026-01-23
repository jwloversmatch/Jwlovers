// emitters/WebSocketEmitter.js
const logger = require("@utils/logger") || console;

class WebSocketEmitter {
  async emitMessageToConversation(socketHelpers, messageData, conversationId, redisHelper = null) {
    if (!socketHelpers?.io || !conversationId) {
      logger.warn("⚠️ Cannot emit message: Socket.IO or conversationId missing");
      return false;
    }

    try {
      const conversationRoom = `conversation_${conversationId}`;
      const receiverOnline = await socketHelpers.isUserOnline(messageData.receiverId);

      if (receiverOnline) {
        socketHelpers.io.to(conversationRoom).emit("new_message", messageData);
        logger.debug(`📡 Message emitted to room: ${conversationRoom}`);
      } else if (redisHelper) {
        await redisHelper.queueOfflineMessage(messageData.receiverId, messageData);
        logger.debug(`📦 Message queued for offline user: ${messageData.receiverId}`);
      }

      return true;
    } catch (error) {
      logger.error("❌ Failed to emit message:", error);
      return false;
    }
  }

  async emitReadReceipt(socketHelpers, messageIds, readerId, conversationId) {
    if (!socketHelpers?.io || !conversationId) return false;

    try {
      const conversationRoom = `conversation_${conversationId}`;
      const receiptData = {
        messageIds,
        readerId,
        timestamp: new Date().toISOString(),
      };

      socketHelpers.io.to(conversationRoom).emit("messages:read", receiptData);
      logger.debug(`👁️ Read receipt emitted for ${messageIds.length} message(s)`);
      return true;
    } catch (error) {
      logger.error("❌ Failed to emit read receipt:", error);
      return false;
    }
  }

  async emitMessageDeleted(socketHelpers, messageId, deletedBy, conversationId) {
    if (!socketHelpers?.io || !conversationId) return false;

    try {
      const conversationRoom = `conversation_${conversationId}`;
      socketHelpers.io.to(conversationRoom).emit("message:deleted", {
        messageId,
        deletedBy,
        timestamp: new Date().toISOString(),
      });
      logger.debug("🗑️ Message deleted event emitted");
      return true;
    } catch (error) {
      logger.error("❌ Failed to emit delete event:", error);
      return false;
    }
  }

  async emitMessageEdited(socketHelpers, messageId, content, editedBy, editedAt, conversationId) {
    if (!socketHelpers?.io || !conversationId) return false;

    try {
      const conversationRoom = `conversation_${conversationId}`;
      socketHelpers.io.to(conversationRoom).emit("message:edited", {
        messageId,
        content,
        editedAt,
        editedBy,
        timestamp: new Date().toISOString(),
      });
      logger.debug("✏️ Edit event emitted");
      return true;
    } catch (error) {
      logger.error("❌ Failed to emit edit event:", error);
      return false;
    }
  }

  async emitReaction(socketHelpers, messageId, userId, reaction, action, conversationId) {
    if (!socketHelpers?.io || !conversationId) return false;

    try {
      const conversationRoom = `conversation_${conversationId}`;
      socketHelpers.io.to(conversationRoom).emit("message:reaction", {
        messageId,
        userId,
        reaction,
        action,
        timestamp: new Date().toISOString(),
      });
      logger.debug(`😊 Reaction ${action} event emitted`);
      return true;
    } catch (error) {
      logger.error("❌ Failed to emit reaction:", error);
      return false;
    }
  }
}

module.exports = new WebSocketEmitter();