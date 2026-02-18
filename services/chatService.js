// server/services/ChatService.js
const MessageService = require('@controllers/chat/MessageService');
const logger = require('@utils/logger');

class ChatService {
  /**
   * Send a message via WebSocket
   * This bridges the WebSocket event to your MessageService
   */
  async sendMessage(data) {
    try {
      logger.debug('ChatService.sendMessage called', {
        senderId: data.senderId?.substring(0, 8),
        receiverId: data.receiverId?.substring(0, 8),
        hasContent: !!data.content
      });

      // Map WebSocket event data to MessageService format
      const messageData = {
        senderId: data.senderId,
        receiverId: data.receiverId,
        content: data.content,
        type: data.type || 'text',
        mediaUrl: data.mediaUrl,
        // Handle both field names (chatId or conversationId)
        conversationId: data.chatId || data.conversationId,
        clientMessageId: data.clientMessageId,
        source: 'socket', // ✅ THIS SETS source TO "socket" IN DATABASE
        // Optional fields
        isEncrypted: data.isEncrypted,
        encryptionType: data.encryptionType,
      };

      // Call your existing MessageService
      const result = await MessageService.sendMessage(messageData);
      
      logger.info('ChatService.sendMessage success', {
        messageId: result._id,
        conversationId: result.conversationId,
        source: 'socket'
      });
      
      return result;
    } catch (error) {
      logger.error('ChatService.sendMessage error:', {
        error: error.message,
        senderId: data.senderId?.substring(0, 8),
        receiverId: data.receiverId?.substring(0, 8)
      });
      throw error;
    }
  }

  /**
   * Mark a single message as read
   */
  async markAsRead(messageId, userId) {
    try {
      return await MessageService.markMessageAsRead(userId, messageId);
    } catch (error) {
      logger.error('ChatService.markAsRead error:', error);
      throw error;
    }
  }

  /**
   * Mark multiple messages as read
   */
  async markMessagesAsRead(messageIds, userId) {
    try {
      return await MessageService.markMessagesAsRead(messageIds, userId);
    } catch (error) {
      logger.error('ChatService.markMessagesAsRead error:', error);
      throw error;
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(userId, messageId) {
    try {
      return await MessageService.deleteMessage(userId, messageId);
    } catch (error) {
      logger.error('ChatService.deleteMessage error:', error);
      throw error;
    }
  }

  /**
   * Edit a message
   */
  async editMessage(userId, messageId, content) {
    try {
      return await MessageService.editMessage(userId, messageId, content);
    } catch (error) {
      logger.error('ChatService.editMessage error:', error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new ChatService();