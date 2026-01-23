const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const logger = require("../utils/logger");
const { ConversationServiceWrapper } = require("../services/ConversationService");
const EncryptionService = require("../services/EncryptionService");
const MessageService = require("../services/MessageService");

const chatController = {
  async getConversations(req, res) {
    try {
      const userId = req.user.id;
      const { limit, offset, unread, archived, muted, sort, order } = req.query;

      logger.debug(`Getting conversations for user: ${userId}`, { query: req.query });
      
      const conversations = await ConversationServiceWrapper.getUserConversations(userId, {
        limit: parseInt(limit) || 20,
        offset: parseInt(offset) || 0,
        unread: unread === 'true',
        archived: archived === 'true',
        muted: muted === 'true',
        sort: sort || 'lastMessageAt',
        order: order || 'desc'
      });

      logger.debug(`Returned ${conversations.length} conversations`);

      res.json({
        success: true,
        data: conversations,
        pagination: {
          total: conversations.length,
          limit: parseInt(limit) || 20,
          offset: parseInt(offset) || 0,
          hasMore: conversations.length >= (parseInt(limit) || 20)
        }
      });
    } catch (error) {
      logger.error("Get conversations error:", error);
      res.status(500).json({ 
        success: false, 
        error: "Failed to fetch conversations",
        details: process.env.NODE_ENV === "development" ? error.message : undefined
      });
    }
  },

  async getConversationWithUser(req, res) {
    try {
      const currentUserId = req.user.id;
      const otherUserId = req.params.userId;
      const { limit = 50, before, after, offset = 0 } = req.query;

      logger.debug(`Getting conversation between ${currentUserId} and ${otherUserId}`);
      
      const conversation = await ConversationServiceWrapper.getOrCreateConversation(
        currentUserId,
        otherUserId
      );

      logger.debug(`Found conversation: ${conversation._id}`);
      
      const messages = await MessageService.getConversationMessages(conversation._id, {
        limit: parseInt(limit),
        before,
        after,
        offset: parseInt(offset)
      });

      logger.debug(`Found ${messages.length} messages`);
      
      const decryptedMessages = messages.map(msg => {
        if (msg.isEncrypted && msg.encryptionType === "server-side") {
          try {
            const decrypted = EncryptionService.decryptForFrontend(msg.content, msg.encryptionType);
            return {
              ...msg.toObject(),
              content: decrypted
            };
          } catch (error) {
            logger.warn("Failed to decrypt message:", error);
            return msg;
          }
        }
        return msg;
      });

      res.json({
        success: true,
        data: {
          conversation,
          messages: decryptedMessages,
          user: conversation.user
        }
      });
    } catch (error) {
      logger.error("Get conversation error:", error);
      res.status(500).json({ success: false, error: "Failed to fetch conversation" });
    }
  },

  async getUnreadCount(req, res) {
    try {
      const currentUserId = req.user.id;
      const otherUserId = req.params.userId;

      logger.debug(`Getting unread count for ${currentUserId} with ${otherUserId}`);
      
      const Message = require("@models/Message");
      const unreadCount = await Message.countDocuments({
        $or: [
          { senderId: otherUserId, receiverId: currentUserId, readBy: { $ne: currentUserId } },
          { senderId: currentUserId, receiverId: otherUserId, readBy: { $ne: currentUserId } }
        ]
      });

      logger.debug(`Unread count: ${unreadCount}`);

      res.json({
        success: true,
        data: { count: unreadCount }
      });
    } catch (error) {
      logger.error("Get unread count error:", error);
      res.status(500).json({ success: false, error: "Failed to get unread count" });
    }
  },

  async getTotalUnreadCount(req, res) {
    try {
      const userId = req.user.id;
      const totalUnread = await MessageService.getTotalUnreadCount(userId);

      logger.debug(`Total unread for user ${userId}: ${totalUnread}`);

      res.json({
        success: true,
        data: { total: totalUnread }
      });
    } catch (error) {
      logger.error("Get total unread error:", error);
      res.status(500).json({ success: false, error: "Failed to get total unread count" });
    }
  },

  async sendMessage(req, res) {
    try {
      const senderId = req.user.id;
      const { receiverId, content, conversationId, type = "text", mediaUrl } = req.body;

      logger.debug(`Sending message from ${senderId} to ${receiverId}`);

      const { content: encryptedContent, encryptionType, isEncrypted } = 
        EncryptionService.encryptMessageForStorage(content);

      const messageData = {
        senderId,
        receiverId,
        content: encryptedContent,
        originalContent: content,
        conversationId,
        type,
        mediaUrl,
        isEncrypted,
        encryptionType
      };

      const savedMessage = await MessageService.sendMessage(messageData);

      const responseMessage = {
        ...savedMessage.toObject(),
        content: isEncrypted && encryptionType === "server-side" 
          ? EncryptionService.decryptForFrontend(encryptedContent, encryptionType) 
          : content
      };

      logger.debug(`Message sent: ${savedMessage._id}`);

      res.json({
        success: true,
        data: responseMessage
      });
    } catch (error) {
      logger.error("Send message error:", error);
      res.status(500).json({ success: false, error: "Failed to send message" });
    }
  },

  async markMessagesAsRead(req, res) {
    try {
      const userId = req.user.id;
      const { messageIds } = req.body;

      logger.debug(`Marking ${messageIds?.length || 0} messages as read for ${userId}`);

      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: "messageIds must be a non-empty array" 
        });
      }

      const validMessageIds = messageIds.filter(id => mongoose.Types.ObjectId.isValid(id));
      if (validMessageIds.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: "No valid message IDs provided" 
        });
      }

      const updatedCount = await MessageService.markMessagesAsRead(validMessageIds, userId);

      logger.debug(`Marked ${updatedCount} messages as read`);

      res.json({
        success: true,
        data: { 
          updatedCount,
          messageIds: validMessageIds 
        }
      });
    } catch (error) {
      logger.error("Mark messages read error:", error);
      res.status(500).json({ success: false, error: "Failed to mark messages as read" });
    }
  },

  async createConversation(req, res) {
    try {
      const userId = req.user.id;
      const { participantId } = req.body;

      logger.debug(`Creating conversation for ${userId} with ${participantId}`);

      if (!participantId) {
        return res.status(400).json({ 
          success: false, 
          error: "participantId is required" 
        });
      }

      if (!mongoose.Types.ObjectId.isValid(participantId)) {
        return res.status(400).json({ success: false, error: "Invalid participant ID" });
      }

      if (userId === participantId) {
        return res.status(400).json({ 
          success: false, 
          error: "Cannot create conversation with yourself" 
        });
      }

      const conversation = await ConversationServiceWrapper.getOrCreateConversation(userId, participantId);

      logger.debug(`Conversation created/retrieved: ${conversation._id}`);

      res.json({
        success: true,
        data: conversation
      });
    } catch (error) {
      logger.error("Create conversation error:", error);
      res.status(500).json({ success: false, error: "Failed to create conversation" });
    }
  },

  async searchConversations(req, res) {
    try {
      const userId = req.user.id;
      const { query } = req.query;

      logger.debug(`Searching conversations for ${userId}, query: "${query}"`);

      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: "Search query cannot be empty" 
        });
      }

      const conversations = await ConversationServiceWrapper.searchConversations(
        userId, 
        query.trim()
      );

      logger.debug(`Found ${conversations.length} conversations`);

      res.json({
        success: true,
        data: conversations || []
      });
    } catch (error) {
      logger.error("Search conversations error:", error);
      res.status(500).json({ success: false, error: "Failed to search conversations" });
    }
  },

  async archiveConversation(req, res) {
    try {
      const currentUserId = req.user.id;
      const otherUserId = req.params.userId;
      const { archive = true } = req.body;

      logger.debug(`Archive conversation: ${currentUserId} with ${otherUserId}, archive: ${archive}`);

      const conversation = await ConversationServiceWrapper.getOrCreateConversation(
        currentUserId,
        otherUserId
      );

      await ConversationServiceWrapper.updateConversation(conversation._id, {
        archived: archive,
        archivedAt: archive ? new Date() : null
      });

      logger.debug(`Conversation ${archive ? 'archived' : 'unarchived'}`);

      res.json({
        success: true,
        data: { 
          success: true, 
          message: `Conversation ${archive ? 'archived' : 'unarchived'} successfully` 
        }
      });
    } catch (error) {
      logger.error("Archive conversation error:", error);
      res.status(500).json({ success: false, error: "Failed to update conversation" });
    }
  },

  async muteConversation(req, res) {
    try {
      const currentUserId = req.user.id;
      const otherUserId = req.params.userId;
      const { mute = true } = req.body;

      logger.debug(`Mute conversation: ${currentUserId} with ${otherUserId}, mute: ${mute}`);

      const conversation = await ConversationServiceWrapper.getOrCreateConversation(
        currentUserId,
        otherUserId
      );

      await ConversationServiceWrapper.updateConversation(conversation._id, {
        muted: mute,
        mutedAt: mute ? new Date() : null
      });

      logger.debug(`Conversation ${mute ? 'muted' : 'unmuted'}`);

      res.json({
        success: true,
        data: { 
          success: true, 
          message: `Conversation ${mute ? 'muted' : 'unmuted'} successfully` 
        }
      });
    } catch (error) {
      logger.error("Mute conversation error:", error);
      res.status(500).json({ success: false, error: "Failed to update conversation" });
    }
  },

  async clearConversation(req, res) {
    try {
      const currentUserId = req.user.id;
      const otherUserId = req.params.userId;

      logger.debug(`Clear conversation: ${currentUserId} with ${otherUserId}`);

      const conversation = await ConversationServiceWrapper.getOrCreateConversation(
        currentUserId,
        otherUserId
      );

      const deletedCount = await MessageService.clearConversationMessages(conversation._id);

      logger.debug(`Cleared ${deletedCount} messages`);

      res.json({
        success: true,
        data: { 
          success: true, 
          message: `Cleared ${deletedCount} messages from conversation` 
        }
      });
    } catch (error) {
      logger.error("Clear conversation error:", error);
      res.status(500).json({ success: false, error: "Failed to clear conversation" });
    }
  },

  async getWsToken(req, res) {
    try {
      const token = jwt.sign(
        { 
          userId: req.user.id, 
          type: "ws",
          name: req.user.name,
          username: req.user.username
        },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
      );

      logger.debug(`Generated WS token for user ${req.user.id}`);

      res.json({
        success: true,
        data: { token }
      });
    } catch (error) {
      logger.error("Generate WS token error:", error);
      res.status(500).json({ success: false, error: "Failed to generate token" });
    }
  },

  async migrateLegacyMessages(req, res) {
    try {
      const { messageIds } = req.body;

      logger.debug(`Migrating ${messageIds?.length || 0} legacy messages`);

      if (!messageIds || !Array.isArray(messageIds)) {
        return res.status(400).json({ 
          success: false,
          error: "messageIds array required" 
        });
      }

      const migrated = [];
      const failed = [];

      for (const messageId of messageIds) {
        try {
          if (!mongoose.Types.ObjectId.isValid(messageId)) {
            failed.push({ id: messageId, error: "Invalid message ID format" });
            continue;
          }

          const message = await MessageService.getMessageById(messageId);

          if (!message) {
            failed.push({ id: messageId, error: "Message not found" });
            continue;
          }

          if (message.isEncrypted && message.encryptionType === "server-side") {
            try {
              const decrypted = EncryptionService.decryptForFrontend(message.content, "server-side");
              
              if (decrypted && !decrypted.includes("[Encrypted message")) {
                const encrypted = EncryptionService.encryptMessage(decrypted);
                
                await MessageService.updateMessage(messageId, {
                  content: encrypted,
                  migratedAt: new Date(),
                  needsMigration: false
                });
                
                migrated.push(messageId);
              } else {
                failed.push({ id: messageId, error: "Cannot decrypt legacy format" });
              }
            } catch (decryptError) {
              failed.push({ id: messageId, error: "Decryption failed: " + decryptError.message });
            }
          } else {
            failed.push({ id: messageId, error: "Not a server-side encrypted message" });
          }
        } catch (error) {
          failed.push({ id: messageId, error: error.message });
        }
      }

      logger.debug(`Migration complete: ${migrated.length} migrated, ${failed.length} failed`);

      res.json({
        success: true,
        data: {
          migrated,
          failed,
          total: messageIds.length
        }
      });
    } catch (error) {
      logger.error("Migration error:", error);
      res.status(500).json({ 
        success: false,
        error: "Migration failed" 
      });
    }
  }
};

module.exports = chatController;