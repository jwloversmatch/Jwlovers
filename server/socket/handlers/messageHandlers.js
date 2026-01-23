const mongoose = require("mongoose");
const EncryptionService = require("../../services/EncryptionService");
const MessageService = require("../../services/MessageService");
const CONFIG = require("../../config/constants");
const logger = require("../../utils/logger");
const validationSchemas = require("../../utils/validators");

const setupMessageHandlers = (io, socket, redisService, rateLimiter) => {
  
  socket.on("message:send", async (data, callback) => {
    try {
      const userId = socket.userId;
      const userName = socket.user?.name || socket.user?.username || `User-${userId?.substring(0, 8)}`;
      
      const roomLimitKey = data.conversationId || data.receiverId;
      if (!rateLimiter.check(
        userId, 
        "message:send", 
        CONFIG.RATE_LIMITS.MESSAGES_PER_MINUTE, 
        CONFIG.RATE_LIMITS.WINDOW_MS,
        roomLimitKey
      )) {
        return callback?.({
          success: false,
          error: "Rate limit exceeded. Please wait a moment."
        });
      }

      const { error } = validationSchemas.message.validate(data);
      if (error) {
        return callback?.({
          success: false,
          error: error.details[0].message
        });
      }

      const {
        receiverId,
        content,
        messageId,
        conversationId,
        mediaUrl,
        type = "text"
      } = data;

      const isDuplicate = await redisService.isDuplicateMessage(userId, receiverId, content);
      if (isDuplicate) {
        return callback?.({ 
          success: false, 
          error: "Duplicate message detected" 
        });
      }

      const {
        content: finalContent,
        encryptionType,
        isEncrypted,
        needsMigration
      } = EncryptionService.encryptMessageForStorage(content);

      const messageData = {
        receiverId,
        content: finalContent,
        originalContent: content,
        type,
        mediaUrl,
        conversationId,
        senderId: userId,
        status: "sent",
        timestamp: new Date(),
        clientMessageId: messageId,
        isEncrypted,
        encryptionType,
        needsMigration,
        source: "websocket"
      };

      let savedMessage;
      try {
        savedMessage = await MessageService.sendMessage(messageData);
        logger.debug("✅ Message saved to database:", savedMessage._id);
      } catch (saveError) {
        logger.error("❌ Failed to save message:", saveError);
        return callback?.({
          success: false,
          error: "Failed to save message to database"
        });
      }

      let decryptedContent;
      if (isEncrypted && encryptionType === "server-side") {
        decryptedContent = EncryptionService.decryptForFrontend(finalContent, encryptionType);
      } else {
        decryptedContent = content;
      }

      if (decryptedContent === null || decryptedContent.startsWith("🔒")) {
        logger.warn("⚠️ Cannot decrypt legacy content, using placeholder");
        decryptedContent = "🔒 [Encrypted message - legacy format]";
      }

      const socketMessage = {
        _id: savedMessage._id.toString(),
        id: savedMessage._id.toString(),
        senderId: userId,
        senderName: userName,
        receiverId: savedMessage.receiverId.toString(),
        conversationId: savedMessage.conversationId?.toString() || conversationId,
        content: decryptedContent,
        type: savedMessage.type,
        mediaUrl: savedMessage.mediaUrl,
        status: "sent",
        timestamp: savedMessage.createdAt || new Date().toISOString(),
        createdAt: savedMessage.createdAt || new Date().toISOString(),
        isEncrypted: false,
        encryptionType: encryptionType,
        needsMigration: needsMigration || false,
        clientMessageId: messageId
      };

      callback?.({
        success: true,
        messageId: savedMessage._id.toString(),
        data: socketMessage
      });

      const receiverPresence = await redisService.getUserPresence(receiverId);
      const receiverOnline = !!receiverPresence;

      if (conversationId) {
        const conversationRoom = `conversation_${conversationId}`;

        if (receiverOnline) {
          io.to(conversationRoom).emit("new_message", socketMessage);
          logger.debug(`📡 Message sent to conversation room: ${conversationRoom}`);
        } else {
          await redisService.queueOfflineMessage(receiverId, socketMessage);
          logger.debug(`📦 Message queued for offline user: ${receiverId}`);
        }
      } else {
        const receiverRoom = `user_${receiverId}`;

        if (receiverOnline) {
          io.to(receiverRoom).emit("new_message", socketMessage);
          logger.debug(`📡 Message sent to user room: ${receiverRoom}`);
        } else {
          await redisService.queueOfflineMessage(receiverId, socketMessage);
        }
      }
    } catch (error) {
      logger.error("❌ Error in message handler:", error);
      callback?.({
        success: false,
        error: error.message || "Internal server error"
      });
    }
  });
};

module.exports = { setupMessageHandlers };