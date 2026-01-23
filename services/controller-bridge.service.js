// services/controller-bridge.service.js
class ControllerBridgeService {
  constructor(io, encryptionService, redisService, validationSchemas, logger) {
    this.io = io;
    this.encryptionService = encryptionService;
    this.redisService = redisService;
    this.validationSchemas = validationSchemas;
    this.logger = logger;
  }

  setIo(io) {
    this.io = io;
  }

  encryptMessage(content) {
    return this.encryptionService.encryptMessage(content);
  }

  decryptMessage(encryptedData) {
    return this.encryptionService.decryptMessage(encryptedData);
  }

  decryptForFrontend(encryptedContent, encryptionType = "server-side") {
    return this.encryptionService.decryptForFrontend(encryptedContent, encryptionType);
  }

  isEncrypted(content) {
    return this.encryptionService.isEncrypted(content);
  }

  isLegacyCiphertext(content) {
    return this.encryptionService.isLegacyCiphertext(content);
  }

  encryptMessageForStorage(content) {
    return this.encryptionService.encryptMessageForStorage(content);
  }

  emitToConversation(conversationId, event, data) {
    if (this.io && conversationId) {
      this.io.to(`conversation_${conversationId}`).emit(event, data);
      return true;
    }
    return false;
  }

  async isUserOnline(userId) {
    try {
      const presence = await this.redisService.getUserPresence(userId);
      return !!presence;
    } catch (error) {
      this.logger.error("Error checking user online status:", error);
      return false;
    }
  }

  async getUserSocket(userId) {
    try {
      const presence = await this.redisService.getUserPresence(userId);
      return presence?.socketId || null;
    } catch (error) {
      this.logger.error("Error getting user socket:", error);
      return null;
    }
  }

  async getBatchOnlineStatus(userIds) {
    const results = {};
    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const presence = await this.redisService.getUserPresence(userId);
          results[userId] = {
            isOnline: !!presence,
            status: presence?.status || "offline",
            lastSeen: presence?.lastSeen || null,
            name: presence?.userName
          };
        } catch (error) {
          this.logger.error(`Error getting online status for user ${userId}:`, error);
          results[userId] = {
            isOnline: false,
            status: "offline",
            lastSeen: null,
            name: null
          };
        }
      })
    );
    return results;
  }

  async emitMessage(messageData) {
    try {
      if (!this.io) {
        this.logger.error("Socket.IO not initialized");
        return false;
      }

      // Validate message content
      const { error } = this.validationSchemas.message.validate(messageData);
      if (error) {
        throw new Error(error.details[0].message);
      }

      // Encrypt for storage
      const { content, encryptionType, isEncrypted, needsMigration } =
        this.encryptionService.encryptMessageForStorage(messageData.content);
      messageData.content = content;
      messageData.encryptionType = encryptionType;
      messageData.isEncrypted = isEncrypted;
      if (needsMigration) {
        messageData.needsMigration = true;
      }

      // Save message - need to import MessageService here
      const MessageService = require("@controllers/chat/MessageService");
      const savedMessage = await MessageService.sendMessage(messageData);

      // Decrypt for frontend delivery
      let decryptedContent;
      if (isEncrypted && encryptionType === "server-side") {
        decryptedContent = this.encryptionService.decryptForFrontend(content, encryptionType);
      } else {
        decryptedContent = messageData.content;
      }

      if (decryptedContent === null || decryptedContent.startsWith("🔒")) {
        this.logger.warn("⚠️ Cannot decrypt legacy content");
        decryptedContent = "🔒 [Encrypted message - legacy format]";
      }

      // Prepare socket message
      const socketMessage = {
        _id: savedMessage._id.toString(),
        id: savedMessage._id.toString(),
        senderId: savedMessage.senderId.toString(),
        senderName: savedMessage.senderId?.firstName
          ? `${savedMessage.senderId.firstName} ${savedMessage.senderId.lastName || ""}`.trim()
          : savedMessage.senderId?.userName || "Unknown",
        receiverId: savedMessage.receiverId.toString(),
        conversationId: savedMessage.conversationId?.toString(),
        content: decryptedContent,
        type: savedMessage.type,
        mediaUrl: savedMessage.mediaUrl,
        status: "sent",
        timestamp: savedMessage.createdAt || new Date().toISOString(),
        createdAt: savedMessage.createdAt || new Date().toISOString(),
        isEncrypted: false,
        encryptionType: savedMessage.encryptionType,
        needsMigration: savedMessage.needsMigration || false
      };

      const conversationId = socketMessage.conversationId;
      if (conversationId) {
        this.io.to(`conversation_${conversationId}`).emit("new_message", socketMessage);
        this.logger.debug(`📡 Message emitted to conversation: ${conversationId}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error("Error emitting message:", error);
      return false;
    }
  }
}

module.exports = ControllerBridgeService;