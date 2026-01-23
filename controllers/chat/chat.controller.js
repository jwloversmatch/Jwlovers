// controllers/chat/ChatController.js - REFACTORED
const BaseController = require("../BaseController");
const ConversationService = require("./ConversationService");
const MessageService = require("./MessageService");
const SearchService = require("./SearchService");
const StatsService = require("./StatsService");
const ReactionService = require("./ReactionService");
const WsTokenService = require("./WsTokenService");

// Import our modular components
const chatHelpers = require("@utils/ChatHelpers");
const messageFormatter = require("@formatters/MessageFormatter");
const messageEncryptionHandler = require("@handlers/MessageEncryptionHandler");
const messageValidator = require("@validators/MessageValidator");
const webSocketEmitter = require("@emitters/WebSocketEmitter");

const logger = require("@utils/logger") || console;

class ChatController extends BaseController {
  constructor() {
    super();
    this.conversationService = ConversationService;
    this.messageService = MessageService;
    this.searchService = SearchService;
    this.statsService = StatsService;
    this.reactionService = ReactionService;
    this.wsTokenService = WsTokenService;

    this.bindMethods();
  }

  bindMethods() {
    // Conversation methods
    this.getConversations = this.getConversations.bind(this);
    this.createConversation = this.createConversation.bind(this);
    this.getConversation = this.getConversation.bind(this);
    this.getMessages = this.getMessages.bind(this);
    this.archiveConversation = this.archiveConversation.bind(this);
    this.muteConversation = this.muteConversation.bind(this);
    this.clearConversation = this.clearConversation.bind(this);

    // Message methods
    this.sendMessage = this.sendMessage.bind(this);
    this.markAsRead = this.markAsRead.bind(this);
    this.markMessagesAsRead = this.markMessagesAsRead.bind(this);
    this.deleteMessage = this.deleteMessage.bind(this);
    this.deleteMessagesBulk = this.deleteMessagesBulk.bind(this);
    this.editMessage = this.editMessage.bind(this);

    // Search & Stats
    this.searchConversations = this.searchConversations.bind(this);
    this.searchMessages = this.searchMessages.bind(this);
    this.getUnreadCount = this.getUnreadCount.bind(this);
    this.getTotalUnreadCount = this.getTotalUnreadCount.bind(this);
    this.getStats = this.getStats.bind(this);

    // Reactions
    this.addReaction = this.addReaction.bind(this);
    this.removeReaction = this.removeReaction.bind(this);

    // WebSocket
    this.getWsToken = this.getWsToken.bind(this);
  }

  // ========== CONVERSATION METHODS ==========

  async getConversations(req, res) {
    try {
      const userId = req.userId || req.user?.id;

      if (!userId) {
        return this.errorResponse(res, 401, "User not authenticated");
      }

      const result = await this.conversationService.getUserConversations(userId, req.query);

      if (result.conversations) {
        result.conversations = messageFormatter.decryptConversationMessages(req, result.conversations, userId);
      }

      return this.successResponse(res, 200, result);
    } catch (error) {
      logger.error("getConversations error:", error);
      return this.handleError(error, req, res);
    }
  }

  async createConversation(req, res) {
    try {
      const result = await this.conversationService.createConversation(req.user.id, req.body);
      return this.successResponse(res, 200, result, "Conversation created");
    } catch (error) {
      logger.error("createConversation error:", error);
      return this.handleError(error, req, res);
    }
  }

  async getConversation(req, res) {
    try {
      const result = await this.conversationService.getConversationWithUser(
        req.user.id,
        req.params.userId,
        req.query
      );
      return this.successResponse(res, 200, result);
    } catch (error) {
      logger.error("getConversation error:", error);
      return this.handleError(error, req, res);
    }
  }

  async getMessages(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user.id;
      const { limit = 50, before } = req.query;

      const conversation = await this.conversationService.getConversationById(conversationId);
      if (!conversation || 
          (conversation.participant1.toString() !== userId && conversation.participant2.toString() !== userId)) {
        return this.errorResponse(res, 403, "Access denied");
      }

      const messages = await this.messageService.getConversationMessages(conversationId, userId, { limit, before });
      const decryptedMessages = messageFormatter.decryptMessageList(req, messages, userId);

      return this.successResponse(res, 200, {
        messages: decryptedMessages,
        hasMore: messages.length >= limit,
        conversationId,
      });
    } catch (error) {
      logger.error("getMessages error:", error);
      return this.handleError(error, req, res);
    }
  }

  async archiveConversation(req, res) {
    try {
      const { userId } = req.params;
      const currentUserId = req.user.id;

      const result = await this.conversationService.archiveConversation(
        currentUserId,
        userId,
        req.body.archived !== false
      );

      return this.successResponse(
        res,
        200,
        result,
        req.body.archived !== false ? "Conversation archived" : "Conversation unarchived"
      );
    } catch (error) {
      logger.error("archiveConversation error:", error);
      return this.handleError(error, req, res);
    }
  }

  async muteConversation(req, res) {
    try {
      const { userId } = req.params;
      const currentUserId = req.user.id;

      if (req.body.muted === undefined) {
        return this.errorResponse(res, 400, "muted field is required");
      }

      const result = await this.conversationService.muteConversation(currentUserId, userId, req.body.muted);

      return this.successResponse(
        res,
        200,
        result,
        req.body.muted ? "Conversation muted" : "Conversation unmuted"
      );
    } catch (error) {
      logger.error("muteConversation error:", error);
      return this.handleError(error, req, res);
    }
  }

  async clearConversation(req, res) {
    try {
      const { userId } = req.params;
      const currentUserId = req.user.id;

      const conversation = await this.conversationService.getConversationWithUser(currentUserId, userId);

      if (!conversation?.conversationId) {
        return this.errorResponse(res, 404, "Conversation not found");
      }

      const result = await this.messageService.clearConversationMessages(conversation.conversationId, currentUserId);

      return this.successResponse(res, 200, {
        clearedCount: result,
        conversationId: conversation.conversationId,
      }, "Conversation cleared");
    } catch (error) {
      logger.error("clearConversation error:", error);
      return this.handleError(error, req, res);
    }
  }

  // ========== MESSAGE METHODS ==========

  async sendMessage(req, res) {
    let cacheKey = null;

    try {
      const senderId = chatHelpers.extractSenderId(req.user);
      
      if (!senderId) {
        throw new Error("Sender ID not found in user object");
      }

      messageValidator.validateMessageRequest(req.body);

      const { receiverId, type, content, mediaUrl, conversationId, messageId } = req.body;

      // Duplicate check
      cacheKey = chatHelpers.createCacheKey(senderId, receiverId, messageId, content);

      if (chatHelpers.checkDuplicate(cacheKey)) {
        logger.info("⏭️ [HTTP] Duplicate request prevented by cache");
        return this.successResponse(res, 200, { duplicate: true }, "Message already being processed");
      }

      // Check for existing message
      if (messageId) {
        const Message = require("@models/Message");
        const existingMessage = await Message.findOne({
          clientMessageId: messageId,
          senderId: senderId,
        }).populate("senderId", "firstName lastName avatar email userName").lean();

        if (existingMessage) {
          const formattedMessage = messageFormatter.formatSocketMessage(req, existingMessage, senderId);
          chatHelpers.clearCache(cacheKey);
          return this.successResponse(res, 200, formattedMessage, "Message already sent");
        }
      }

      // Encrypt content
      const socketHelpers = chatHelpers.getSocketHelpers(req);
      const { content: finalContent, encryptionType, isEncrypted, needsMigration } = 
        await messageEncryptionHandler.encryptMessageForStorage(content);

      // Prepare message data
      const messageData = {
        senderId,
        receiverId,
        content: finalContent || "",
        originalContent: content,
        type,
        mediaUrl: mediaUrl || null,
        conversationId: conversationId || req.params.conversationId || null,
        clientMessageId: messageId || `http_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        source: "http",
        isEncrypted,
        encryptionType,
        needsMigration: needsMigration || false,
      };

      // Send message
      const result = await this.messageService.sendMessage(messageData);

      chatHelpers.logMessageEvent("MESSAGE_SAVED", {
        messageId: result._id,
        conversationId: result.conversationId,
        senderId,
      });

      // Format for socket
      const socketMessage = messageFormatter.formatSocketMessage(req, result, senderId);

      // Emit via WebSocket
      if (result.conversationId && socketHelpers) {
        const redisHelper = chatHelpers.getRedisHelper(req);
        await webSocketEmitter.emitMessageToConversation(
          socketHelpers,
          socketMessage,
          result.conversationId.toString(),
          redisHelper
        );
      }

      chatHelpers.clearCache(cacheKey);

      return this.successResponse(res, 200, socketMessage, "Message sent successfully");
    } catch (error) {
      chatHelpers.clearCache(cacheKey);
      logger.error("❌ [HTTP] Send message error:", error);

      if (error.code === 11000 || error.message?.includes("duplicate") || error.message?.includes("Duplicate message")) {
        return this.successResponse(res, 200, { duplicate: true }, "Message already processed");
      }

      if (error.message?.includes("required") || error.message?.includes("Invalid") || 
          error.message?.includes("not found")) {
        return this.errorResponse(res, 400, error.message);
      }

      return this.handleError(error, req, res);
    }
  }

  async markAsRead(req, res) {
    try {
      const result = await this.messageService.markMessageAsRead(req.user.id, req.params.messageId);

      const socketHelpers = chatHelpers.getSocketHelpers(req);
      if (result && socketHelpers) {
        const message = await this.messageService.getMessageById(req.params.messageId);

        if (message?.conversationId && chatHelpers.isUserAuthorized(message, req.user.id)) {
          await webSocketEmitter.emitReadReceipt(
            socketHelpers,
            [req.params.messageId],
            req.user.id,
            message.conversationId.toString()
          );
        }
      }

      return this.successResponse(res, 200, result, "Message marked as read");
    } catch (error) {
      logger.error("markAsRead error:", error);
      return this.handleError(error, req, res);
    }
  }

  async markMessagesAsRead(req, res) {
    try {
      if (!messageValidator.validateBulkRequest(req.body.messageIds)) {
        return this.successResponse(res, 200, { modifiedCount: 0 }, "No messages to mark");
      }

      const result = await this.messageService.markMessagesAsRead(req.body.messageIds, req.user.id);

      const socketHelpers = chatHelpers.getSocketHelpers(req);
      if (socketHelpers && req.body.messageIds.length > 0) {
        const firstMessage = await this.messageService.getMessageById(req.body.messageIds[0]);

        if (firstMessage?.conversationId && chatHelpers.isUserAuthorized(firstMessage, req.user.id)) {
          await webSocketEmitter.emitReadReceipt(
            socketHelpers,
            req.body.messageIds,
            req.user.id,
            firstMessage.conversationId.toString()
          );
        }
      }

      return this.successResponse(res, 200, result, "Messages marked as read");
    } catch (error) {
      logger.error("markMessagesAsRead error:", error);
      return this.handleError(error, req, res);
    }
  }

  async deleteMessage(req, res) {
    try {
      const message = await this.messageService.getMessageById(req.params.messageId);

      if (!message) {
        return this.errorResponse(res, 404, "Message not found");
      }

      if (!chatHelpers.isUserAuthorized(message, req.user.id)) {
        return this.errorResponse(res, 403, "Not authorized to delete this message");
      }

      await this.messageService.deleteMessage(req.user.id, req.params.messageId);

      const socketHelpers = chatHelpers.getSocketHelpers(req);
      if (message.conversationId) {
        await webSocketEmitter.emitMessageDeleted(
          socketHelpers,
          req.params.messageId,
          req.user.id,
          message.conversationId.toString()
        );
      }

      return this.successResponse(res, 200, null, "Message deleted");
    } catch (error) {
      logger.error("deleteMessage error:", error);
      return this.handleError(error, req, res);
    }
  }

  async deleteMessagesBulk(req, res) {
    try {
      if (!messageValidator.validateBulkRequest(req.body.messageIds)) {
        return this.successResponse(res, 200, { deletedCount: 0 }, "No messages to delete");
      }

      const result = await this.messageService.deleteMessagesBulk(req.user.id, req.body.messageIds);
      return this.successResponse(res, 200, result, "Messages deleted");
    } catch (error) {
      logger.error("deleteMessagesBulk error:", error);
      return this.handleError(error, req, res);
    }
  }

  async editMessage(req, res) {
    try {
      messageValidator.validateEditRequest(req.body.content);

      const result = await this.messageService.editMessage(req.user.id, req.params.messageId, req.body.content);

      const socketHelpers = chatHelpers.getSocketHelpers(req);

      let responseContent = result.content;
      if (result.isEncrypted && socketHelpers?.decryptForFrontend) {
        try {
          responseContent = socketHelpers.decryptForFrontend(result.content, result.encryptionType);
        } catch (error) {
          logger.error("Failed to decrypt edited message:", error);
          responseContent = "🔒 [Encrypted message]";
        }
      }

      if (result?.conversationId) {
        await webSocketEmitter.emitMessageEdited(
          socketHelpers,
          result._id.toString(),
          responseContent,
          req.user.id,
          result.editedAt,
          result.conversationId.toString()
        );
      }

      const response = {
        ...(result.toObject ? result.toObject() : result),
        content: responseContent,
        isEncrypted: false,
      };

      return this.successResponse(res, 200, response, "Message updated");
    } catch (error) {
      logger.error("editMessage error:", error);

      if (error.message?.includes("15 minutes") || error.message?.includes("edit window")) {
        return this.errorResponse(res, 400, error.message);
      }

      return this.handleError(error, req, res);
    }
  }

  // ========== SEARCH & STATS ==========

  async searchConversations(req, res) {
    try {
      const result = await this.searchService.searchConversations(req.user.id, req.query);
      return this.successResponse(res, 200, result);
    } catch (error) {
      logger.error("searchConversations error:", error);
      return this.handleError(error, req, res);
    }
  }

  async searchMessages(req, res) {
    try {
      messageValidator.validateSearchQuery(req.query.query);

      const result = await this.searchService.searchMessages(req.user.id, req.query);
      return this.successResponse(res, 200, result);
    } catch (error) {
      logger.error("searchMessages error:", error);
      return this.handleError(error, req, res);
    }
  }

  async getUnreadCount(req, res) {
    try {
      const result = await this.statsService.getUnreadCount(req.user.id, req.params.userId);
      return this.successResponse(res, 200, result);
    } catch (error) {
      logger.error("getUnreadCount error:", error);
      return this.handleError(error, req, res);
    }
  }

  async getTotalUnreadCount(req, res) {
    try {
      const result = await this.statsService.getTotalUnreadCount(req.user.id);
      return this.successResponse(res, 200, result);
    } catch (error) {
      logger.error("getTotalUnreadCount error:", error);
      return this.handleError(error, req, res);
    }
  }

  async getStats(req, res) {
    try {
      const result = await this.statsService.getUserStats(req.user.id);
      return this.successResponse(res, 200, result);
    } catch (error) {
      logger.error("getStats error:", error);
      return this.handleError(error, req, res);
    }
  }

  // ========== REACTION METHODS ==========

  async addReaction(req, res) {
    try {
      messageValidator.validateReactionRequest(req.body.reaction);

      const result = await this.reactionService.addReaction(req.user.id, req.params.messageId, req.body.reaction);

      const socketHelpers = chatHelpers.getSocketHelpers(req);
      if (result?.conversationId) {
        await webSocketEmitter.emitReaction(
          socketHelpers,
          req.params.messageId,
          req.user.id,
          req.body.reaction,
          "add",
          result.conversationId.toString()
        );
      }

      return this.successResponse(res, 200, result, "Reaction added");
    } catch (error) {
      logger.error("addReaction error:", error);
      return this.handleError(error, req, res);
    }
  }

  async removeReaction(req, res) {
    try {
      const result = await this.reactionService.removeReaction(req.user.id, req.params.messageId, req.params.reaction);

      const socketHelpers = chatHelpers.getSocketHelpers(req);
      if (result?.conversationId) {
        await webSocketEmitter.emitReaction(
          socketHelpers,
          req.params.messageId,
          req.user.id,
          req.params.reaction,
          "remove",
          result.conversationId.toString()
        );
      }

      return this.successResponse(res, 200, result, "Reaction removed");
    } catch (error) {
      logger.error("removeReaction error:", error);
      return this.handleError(error, req, res);
    }
  }

  // ========== WEBSOCKET ==========

  async getWsToken(req, res) {
    try {
      const result = await this.wsTokenService.generateToken(req.user.id);
      return this.successResponse(res, 200, result, "WebSocket token generated");
    } catch (error) {
      logger.error("getWsToken error:", error);
      return this.handleError(error, req, res);
    }
  }
}

module.exports = new ChatController();