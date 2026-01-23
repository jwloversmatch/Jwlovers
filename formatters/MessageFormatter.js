// formatters/MessageFormatter.js
const logger = require("@utils/logger") || console;
const chatHelpers = require("@utils/ChatHelpers");

class MessageFormatter {
  decryptMessageForUser(req, content, message, currentUserId) {
    try {
      if (!req || !content || !message) {
        logger.debug("Missing parameters for decryption");
        return content;
      }

      if (!chatHelpers.isUserAuthorized(message, currentUserId)) {
        logger.warn("User not authorized to decrypt this message");
        return content;
      }

      const socketHelpers = chatHelpers.getSocketHelpers(req);
      if (!socketHelpers?.decryptForFrontend) {
        logger.warn("Decryption function not available");
        return content;
      }

      if (message.encryptionType === "server-side") {
        const decrypted = socketHelpers.decryptForFrontend(content, "server-side");

        if (decrypted === null || decrypted.startsWith("🔒")) {
          logger.warn("Failed to decrypt message, returning placeholder");
          return "🔒 [Encrypted message]";
        }

        return decrypted;
      }

      return content;
    } catch (error) {
      logger.error("Failed to decrypt message:", error);
      return "🔒 [Encrypted message - error]";
    }
  }

  formatSocketMessage(req, message, currentUserId = null) {
    if (!message) return null;

    try {
      let content = message.content;
      let isEncrypted = message.isEncrypted || false;

      if (currentUserId && message.isEncrypted && message.encryptionType === "server-side") {
        content = this.decryptMessageForUser(req, content, message, currentUserId);
        isEncrypted = false;
      }

      const senderName = chatHelpers.getSenderName(message.senderId);

      return {
        _id: message._id?.toString() || message.id,
        id: message._id?.toString() || message.id,
        senderId: chatHelpers.safeToString(message.senderId),
        senderName,
        receiverId: chatHelpers.safeToString(message.receiverId),
        conversationId: message.conversationId?.toString() || null,
        content: content,
        type: message.type || "text",
        mediaUrl: message.mediaUrl || null,
        status: message.status || "sent",
        timestamp: message.createdAt || new Date().toISOString(),
        createdAt: message.createdAt || new Date().toISOString(),
        updatedAt: message.updatedAt || message.createdAt,
        isEncrypted,
        encryptionType: message.encryptionType || "none",
        clientMessageId: message.clientMessageId || null,
        editedAt: message.editedAt || null,
        reactions: message.reactions || [],
        needsMigration: message.needsMigration || false,
      };
    } catch (error) {
      logger.error("Failed to format socket message:", error);
      return null;
    }
  }

  decryptConversationMessages(req, conversations, userId) {
    if (!conversations) return conversations;

    const socketHelpers = chatHelpers.getSocketHelpers(req);

    return conversations.map((conv) => {
      if (conv.lastMessage && conv.lastMessage.isEncrypted) {
        try {
          const decryptedContent = this.decryptMessageForUser(
            req,
            conv.lastMessage.content,
            conv.lastMessage,
            userId
          );
          conv.lastMessage.content = decryptedContent;
          conv.lastMessage.isEncrypted = false;
        } catch (error) {
          logger.error("Failed to decrypt conversation last message:", error);
        }
      }
      return conv;
    });
  }

  decryptMessageList(req, messages, userId) {
    return messages.map((message) => {
      const messageObj = message.toObject ? message.toObject() : message;

      if (messageObj.isEncrypted) {
        try {
          const decryptedContent = this.decryptMessageForUser(
            req,
            messageObj.content,
            messageObj,
            userId
          );
          messageObj.content = decryptedContent;
          messageObj.isEncrypted = false;
        } catch (error) {
          logger.error("Failed to decrypt message:", error);
        }
      }

      return messageObj;
    });
  }
}

module.exports = new MessageFormatter();