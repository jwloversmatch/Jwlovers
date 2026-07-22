// controllers/chat/ChatController.js - COMPLETE FIXED VERSION
const BaseController = require("../BaseController");
const ConversationService = require("./ConversationService");
const MessageService = require("./MessageService");
const SearchService = require("./SearchService");
const StatsService = require("./StatsService");
const ReactionService = require("./ReactionService");
const WsTokenService = require("./WsTokenService");

const chatHelpers = require("@utils/ChatHelpers");
const messageFormatter = require("@formatters/MessageFormatter");
const messageValidator = require("@validators/MessageValidator");

const logger = require("@utils/logger") || console;

class ChatController extends BaseController {
  constructor(webSocketService = null) {
    super();
    this.conversationService = ConversationService;
    this.messageService = MessageService;
    this.searchService = SearchService;
    this.statsService = StatsService;
    this.reactionService = ReactionService;
    this.wsTokenService = WsTokenService;

    this.webSocketService = webSocketService;
    this.bindMethods();
  }

  setWebSocketService(webSocketService) {
    this.webSocketService = webSocketService;
    logger.info("✅ WebSocketService injected into ChatController");
  }

  bindMethods() {
    this.getConversations = this.getConversations.bind(this);
    this.createConversation = this.createConversation.bind(this);
    this.getConversation = this.getConversation.bind(this);
    this.getMessages = this.getMessages.bind(this);
    this.archiveConversation = this.archiveConversation.bind(this);
    this.muteConversation = this.muteConversation.bind(this);
    this.clearConversation = this.clearConversation.bind(this);
    this.sendMessage = this.sendMessage.bind(this);
    this.markAsRead = this.markAsRead.bind(this);
    this.markMessagesAsRead = this.markMessagesAsRead.bind(this);
    this.deleteMessage = this.deleteMessage.bind(this);
    this.deleteMessagesBulk = this.deleteMessagesBulk.bind(this);
    this.editMessage = this.editMessage.bind(this);
    this.searchConversations = this.searchConversations.bind(this);
    this.searchMessages = this.searchMessages.bind(this);
    this.getUnreadCount = this.getUnreadCount.bind(this);
    this.getTotalUnreadCount = this.getTotalUnreadCount.bind(this);
    this.getStats = this.getStats.bind(this);
    this.addReaction = this.addReaction.bind(this);
    this.removeReaction = this.removeReaction.bind(this);
    this.getWsToken = this.getWsToken.bind(this);
    this.reportMessage = this.reportMessage.bind(this);
  }

  emitToConversation(conversationId, event, data) {
    if (!this.webSocketService) {
      logger.warn(
        `[ChatController] ⚠️  WebSocketService not injected — cannot emit '${event}' to conversation:${conversationId}`,
      );
      return false;
    }
    try {
      const io = this.webSocketService.getIo();
      if (!io) {
        logger.warn(
          `[ChatController] ⚠️  Socket.io instance not available for event '${event}'`,
        );
        return false;
      }

      // 🔥 ADD THIS DEBUG CODE 🔥
      const roomName = `conversation:${conversationId}`;
      const room = io.sockets.adapter.rooms.get(roomName);
      const socketCount = room ? room.size : 0;

      console.log(`🔍 ROOM CHECK: ${roomName} has ${socketCount} sockets`);
      console.log(`📤 Emitting '${event}' to ${socketCount} sockets`);

      io.to(roomName).emit(event, data);
      logger.debug(
        `[ChatController] 📡 Emitted '${event}' to conversation:${conversationId}`,
      );
      return true;
    } catch (error) {
      logger.error(
        `[ChatController] Failed to emit '${event}' to conversation:`,
        error,
      );
      return false;
    }
  }

  emitToUser(userId, event, data) {
    if (!userId) {
      logger.warn(
        `[ChatController] ⚠️  emitToUser called with no userId for event '${event}' — skipping`,
      );
      return false;
    }
    if (!this.webSocketService) {
      logger.warn(
        `[ChatController] ⚠️  WebSocketService not injected — cannot emit '${event}' to user:${userId}`,
      );
      return false;
    }
    try {
      const io = this.webSocketService.getIo();
      if (!io) {
        logger.warn(
          `[ChatController] ⚠️  Socket.io instance not available for event '${event}'`,
        );
        return false;
      }
      io.to(`user:${userId}`).emit(event, data);
      logger.debug(`[ChatController] 📡 Emitted '${event}' to user:${userId}`);
      return true;
    } catch (error) {
      logger.error(
        `[ChatController] Failed to emit '${event}' to user:`,
        error,
      );
      return false;
    }
  }

  // ========== CONVERSATION METHODS ==========

  async getConversations(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return this.errorResponse(res, 401, "User not authenticated");
      }
      const result = await this.conversationService.getUserConversations(
        userId,
        req.query,
      );
      if (result.conversations) {
        result.conversations = messageFormatter.decryptConversationMessages(
          req,
          result.conversations,
          userId,
        );
      }
      return this.successResponse(res, 200, result);
    } catch (error) {
      logger.error("getConversations error:", error);
      return this.handleError(error, req, res);
    }
  }

  async createConversation(req, res) {
    try {
      const result = await this.conversationService.createConversation(
        req.user.id,
        req.body,
      );
      this.emitToUser(req.user.id, "conversation:created", {
        conversation: result,
        timestamp: new Date().toISOString(),
      });
      return this.successResponse(res, 200, result, "Conversation created");
    } catch (error) {
      logger.error("createConversation error:", error);
      return this.handleError(error, req, res);
    }
  }

  async getConversation(req, res) {
    try {
      const userId = req.user.id;
      const result = await this.conversationService.getConversationWithUser(
        userId,
        req.params.userId,
        req.query,
      );
      if (result.messages && Array.isArray(result.messages)) {
        result.messages = messageFormatter.decryptMessageList(
          req,
          result.messages,
          userId,
        );
      }
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

      const conversation =
        await this.conversationService.getConversationById(conversationId);
      if (
        !conversation ||
        (conversation.participant1.toString() !== userId &&
          conversation.participant2.toString() !== userId)
      ) {
        return this.errorResponse(res, 403, "Access denied");
      }

      const messages = await this.messageService.getConversationMessages(
        conversationId,
        { limit, before },
      );
      const decryptedMessages = messageFormatter.decryptMessageList(
        req,
        messages,
        userId,
      );

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
      const archived =
        req.body.archive !== undefined
          ? req.body.archive !== false
          : req.body.archived !== false;

      const result = await this.conversationService.archiveConversation(
        currentUserId,
        userId,
        archived,
      );

      this.emitToUser(currentUserId, "conversation:archived", {
        userId,
        archived,
        timestamp: new Date().toISOString(),
      });

      return this.successResponse(
        res,
        200,
        result,
        archived ? "Conversation archived" : "Conversation unarchived",
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

      const muteValue =
        req.body.mute !== undefined ? req.body.mute : req.body.muted;
      if (muteValue === undefined) {
        return this.errorResponse(res, 400, "mute field is required");
      }

      const result = await this.conversationService.muteConversation(
        currentUserId,
        userId,
        muteValue,
      );

      this.emitToUser(currentUserId, "conversation:muted", {
        userId,
        muted: muteValue,
        timestamp: new Date().toISOString(),
      });

      return this.successResponse(
        res,
        200,
        result,
        muteValue ? "Conversation muted" : "Conversation unmuted",
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

      const conversation =
        await this.conversationService.getConversationWithUser(
          currentUserId,
          userId,
        );
      if (!conversation?.conversationId) {
        return this.errorResponse(res, 404, "Conversation not found");
      }

      const result = await this.messageService.clearConversationMessages(
        conversation.conversationId,
        currentUserId,
      );

      const otherUserId =
        conversation.participant1?.toString() === currentUserId
          ? conversation.participant2?.toString()
          : conversation.participant1?.toString();

      this.emitToConversation(
        conversation.conversationId,
        "conversation:cleared",
        {
          conversationId: conversation.conversationId,
          clearedBy: currentUserId,
          clearedCount: result.clearedCount,
          timestamp: new Date().toISOString(),
        },
      );
      if (otherUserId) {
        this.emitToUser(otherUserId, "conversation:cleared", {
          conversationId: conversation.conversationId,
          clearedBy: currentUserId,
          timestamp: new Date().toISOString(),
        });
      }

      return this.successResponse(
        res,
        200,
        {
          clearedCount: result.clearedCount,
          conversationId: conversation.conversationId,
        },
        "Conversation cleared",
      );
    } catch (error) {
      logger.error("clearConversation error:", error);
      return this.handleError(error, req, res);
    }
  }

  // ========== MESSAGE METHODS ==========

  async sendMessage(req, res) {
    let cacheKey = null;

    try {
      const senderId = req.user?.id;
      if (!senderId) {
        throw new Error("Sender ID not found in user object");
      }

      messageValidator.validateMessageRequest(req.body);

      const { receiverId, type, content, mediaUrl, conversationId, messageId } =
        req.body;

      cacheKey = chatHelpers.createCacheKey
        ? chatHelpers.createCacheKey(senderId, receiverId, messageId, content)
        : null;

      if (
        chatHelpers.checkDuplicate &&
        cacheKey &&
        chatHelpers.checkDuplicate(cacheKey)
      ) {
        logger.info("⏭️ [HTTP] Duplicate request prevented by cache");
        return this.successResponse(
          res,
          200,
          { duplicate: true },
          "Message already being processed",
        );
      }

      if (messageId) {
        const Message = require("@models/Message");
        const existingMessage = await Message.findOne({
          clientMessageId: messageId,
          senderId: senderId,
        })
          .populate("senderId", "firstName lastName avatar email userName")
          .lean();

        if (existingMessage) {
          const formattedMessage = messageFormatter.formatSocketMessage
            ? messageFormatter.formatSocketMessage(
                req,
                existingMessage,
                senderId,
              )
            : existingMessage;
          if (chatHelpers.clearCache && cacheKey)
            chatHelpers.clearCache(cacheKey);
          return this.successResponse(
            res,
            200,
            formattedMessage,
            "Message already sent",
          );
        }
      }

      // 🔥 FIX: REMOVED DOUBLE ENCRYPTION
      // Don't encrypt here - MessageService handles encryption internally
      // Send plaintext directly to MessageService

      const messageData = {
        senderId,
        receiverId,
        content, // ← PLAINTEXT (MessageService will encrypt)
        type,
        mediaUrl: mediaUrl || null,
        conversationId: conversationId || req.params.conversationId || null,
        clientMessageId:
          messageId ||
          `http_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        source: "http",
        // NO isEncrypted, encryptionType - MessageService adds these
      };

      const result = await this.messageService.sendMessage(messageData);

      logger.info("MESSAGE_SAVED", {
        messageId: result._id,
        conversationId: result.conversationId,
        senderId,
      });

      // 🔥 FIX: REMOVED REDUNDANT DECRYPTION
      // formatSocketMessage ALREADY decrypts - don't decrypt twice
      let formattedMessage = result;
      if (messageFormatter.formatSocketMessage) {
        formattedMessage = messageFormatter.formatSocketMessage(
          req,
          result,
          senderId,
        );
      }
      // Done! formattedMessage now contains plaintext

      if (result.conversationId) {
        // Broadcast to conversation room
        this.emitToConversation(
          result.conversationId.toString(),
          "new_message",
          {
            ...formattedMessage,
            conversationId: result.conversationId.toString(),
          },
        );

        // Emit to receiver's user room
        const actualReceiverId = receiverId || result.receiverId?.toString();
        if (actualReceiverId && actualReceiverId !== senderId) {
          this.emitToUser(actualReceiverId, "new_message", formattedMessage);
        }

        // Clear typing indicator for the sender
        this.emitToConversation(
          result.conversationId.toString(),
          "user:typing",
          {
            userId: senderId,
            conversationId: result.conversationId.toString(),
            isTyping: false,
            timestamp: new Date().toISOString(),
          },
        );
      }

      if (chatHelpers.clearCache && cacheKey) chatHelpers.clearCache(cacheKey);

      return this.successResponse(
        res,
        200,
        formattedMessage,
        "Message sent successfully",
      );
    } catch (error) {
      if (chatHelpers.clearCache && cacheKey) chatHelpers.clearCache(cacheKey);
      logger.error("❌ [HTTP] Send message error:", error);

      if (
        error.code === 11000 ||
        error.message?.includes("duplicate") ||
        error.message?.includes("Duplicate message")
      ) {
        return this.successResponse(
          res,
          200,
          { duplicate: true },
          "Message already processed",
        );
      }
      if (
        error.message?.includes("required") ||
        error.message?.includes("Invalid") ||
        error.message?.includes("not found")
      ) {
        return this.errorResponse(res, 400, error.message);
      }
      return this.handleError(error, req, res);
    }
  }

  async markAsRead(req, res) {
    try {
      const result = await this.messageService.markMessageAsRead(
        req.user.id,
        req.params.messageId,
      );

      if (result && result.conversationId) {
        this.emitToConversation(
          result.conversationId.toString(),
          "messages:read",
          {
            messageIds: [req.params.messageId],
            readerId: req.user.id,
            timestamp: new Date().toISOString(),
          },
        );

        const senderId = result.senderId?.toString?.() ?? result.senderId;
        if (senderId && senderId !== req.user.id) {
          this.emitToUser(senderId, "messages:read", {
            messageIds: [req.params.messageId],
            readerId: req.user.id,
            timestamp: new Date().toISOString(),
          });
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
      if (
        !req.body.messageIds ||
        !Array.isArray(req.body.messageIds) ||
        req.body.messageIds.length === 0
      ) {
        return this.successResponse(
          res,
          200,
          { modifiedCount: 0 },
          "No messages to mark",
        );
      }

      const result = await this.messageService.markMessagesAsRead(
        req.body.messageIds,
        req.user.id,
      );

      const conversationId =
        result?.conversationId ?? req.body.conversationId ?? null;

      if (conversationId) {
        this.emitToConversation(conversationId.toString(), "messages:read", {
          messageIds: req.body.messageIds,
          readerId: req.user.id,
          timestamp: new Date().toISOString(),
        });

        const senderId = result?.senderId?.toString?.() ?? result?.senderId;
        if (senderId && senderId !== req.user.id) {
          this.emitToUser(senderId, "messages:read", {
            messageIds: req.body.messageIds,
            readerId: req.user.id,
            timestamp: new Date().toISOString(),
          });
        }
      } else {
        try {
          const Message = require("@models/Message");
          const firstMessage = await Message.findById(req.body.messageIds[0])
            .select("conversationId senderId")
            .lean();

          if (firstMessage?.conversationId) {
            this.emitToConversation(
              firstMessage.conversationId.toString(),
              "messages:read",
              {
                messageIds: req.body.messageIds,
                readerId: req.user.id,
                timestamp: new Date().toISOString(),
              },
            );

            const sId = firstMessage.senderId?.toString();
            if (sId && sId !== req.user.id) {
              this.emitToUser(sId, "messages:read", {
                messageIds: req.body.messageIds,
                readerId: req.user.id,
                timestamp: new Date().toISOString(),
              });
            }
          }
        } catch (lookupErr) {
          logger.warn(
            "[ChatController] markMessagesAsRead: could not look up conversationId",
            lookupErr.message,
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
      const message = await this.messageService.getMessageById(
        req.params.messageId,
      );
      if (!message) {
        return this.errorResponse(res, 404, "Message not found");
      }

      const conversation = await this.conversationService.getConversationById(
        message.conversationId,
      );
      if (
        !conversation ||
        (conversation.participant1.toString() !== req.user.id &&
          conversation.participant2.toString() !== req.user.id)
      ) {
        return this.errorResponse(
          res,
          403,
          "Not authorized to delete this message",
        );
      }

      await this.messageService.deleteMessage(
        req.user.id,
        req.params.messageId,
      );

      if (message.conversationId) {
        this.emitToConversation(
          message.conversationId.toString(),
          "message:deleted",
          {
            messageId: req.params.messageId,
            deletedBy: req.user.id,
            timestamp: new Date().toISOString(),
          },
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
      if (
        !req.body.messageIds ||
        !Array.isArray(req.body.messageIds) ||
        req.body.messageIds.length === 0
      ) {
        return this.successResponse(
          res,
          200,
          { deletedCount: 0 },
          "No messages to delete",
        );
      }

      const result = await this.messageService.deleteMessagesBulk(
        req.user.id,
        req.body.messageIds,
      );

      const conversationId =
        result?.conversationId ?? req.body.conversationId ?? null;
      if (conversationId) {
        this.emitToConversation(conversationId.toString(), "messages:deleted", {
          messageIds: req.body.messageIds,
          deletedBy: req.user.id,
          timestamp: new Date().toISOString(),
        });
      }

      return this.successResponse(res, 200, result, "Messages deleted");
    } catch (error) {
      logger.error("deleteMessagesBulk error:", error);
      return this.handleError(error, req, res);
    }
  }

  async editMessage(req, res) {
    try {
      if (!req.body.content || req.body.content.trim().length === 0) {
        return this.errorResponse(res, 400, "Content is required");
      }

      const result = await this.messageService.editMessage(
        req.user.id,
        req.params.messageId,
        req.body.content,
      );

      if (result?.conversationId) {
        this.emitToConversation(
          result.conversationId.toString(),
          "message:edited",
          {
            messageId: req.params.messageId,
            content: req.body.content,
            editedBy: req.user.id,
            editedAt: result.editedAt || new Date(),
            timestamp: new Date().toISOString(),
          },
        );
      }

      return this.successResponse(res, 200, result, "Message updated");
    } catch (error) {
      logger.error("editMessage error:", error);
      if (
        error.message?.includes("15 minutes") ||
        error.message?.includes("edit window")
      ) {
        return this.errorResponse(res, 400, error.message);
      }
      return this.handleError(error, req, res);
    }
  }

  async reportMessage(req, res) {
    try {
      const { messageId } = req.params;
      const userId = req.user.id;

      // Placeholder: just log and acknowledge
      logger.info(`Message ${messageId} reported by user ${userId}`);

      // Optionally save to a Report model here

      return this.successResponse(
        res,
        200,
        { reported: true },
        "Message reported",
      );
    } catch (error) {
      logger.error("reportMessage error:", error);
      return this.handleError(error, req, res);
    }
  }

  // ========== SEARCH & STATS ==========

  async searchConversations(req, res) {
    try {
      const result = await this.searchService.searchConversations(
        req.user.id,
        req.query,
      );
      return this.successResponse(res, 200, result);
    } catch (error) {
      logger.error("searchConversations error:", error);
      return this.handleError(error, req, res);
    }
  }

  async searchMessages(req, res) {
    try {
      if (!req.query.query || req.query.query.trim().length === 0) {
        return this.errorResponse(res, 400, "Search query is required");
      }
      const result = await this.searchService.searchMessages(
        req.user.id,
        req.query,
      );
      return this.successResponse(res, 200, result);
    } catch (error) {
      logger.error("searchMessages error:", error);
      return this.handleError(error, req, res);
    }
  }

  async getUnreadCount(req, res) {
    try {
      const result = await this.statsService.getUnreadCount(
        req.user.id,
        req.params.userId,
      );
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
      if (!req.body.reaction || req.body.reaction.trim().length === 0) {
        return this.errorResponse(res, 400, "Reaction is required");
      }
      const result = await this.reactionService.addReaction(
        req.user.id,
        req.params.messageId,
        req.body.reaction,
      );
      if (result?.conversationId) {
        this.emitToConversation(
          result.conversationId.toString(),
          "message:reaction",
          {
            messageId: req.params.messageId,
            userId: req.user.id,
            reaction: req.body.reaction,
            action: "add",
            timestamp: new Date().toISOString(),
          },
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
      const result = await this.reactionService.removeReaction(
        req.user.id,
        req.params.messageId,
        req.params.reaction,
      );
      if (result?.conversationId) {
        this.emitToConversation(
          result.conversationId.toString(),
          "message:reaction",
          {
            messageId: req.params.messageId,
            userId: req.user.id,
            reaction: req.params.reaction,
            action: "remove",
            timestamp: new Date().toISOString(),
          },
        );
      }
      return this.successResponse(res, 200, result, "Reaction removed");
    } catch (error) {
      logger.error("removeReaction error:", error);
      return this.handleError(error, req, res);
    }
  }

  // ========== WEBSOCKET TOKEN ==========

  async getWsToken(req, res) {
    try {
      const result = await this.wsTokenService.generateToken(req.user.id);
      return this.successResponse(
        res,
        200,
        result,
        "WebSocket token generated",
      );
    } catch (error) {
      logger.error("getWsToken error:", error);
      return this.handleError(error, req, res);
    }
  }
}

// Export singleton instance
const chatController = new ChatController();
module.exports = chatController;
module.exports.ChatController = ChatController;
