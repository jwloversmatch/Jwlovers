const logger = require("../utils/logger");

class MessageService {
  static async sendMessage(messageData) {
    try {
      const Message = require("@models/Message");
      const Conversation = require("@models/Conversation");
      
      const message = new Message(messageData);
      await message.save();
      
      // Update conversation last message
      if (messageData.conversationId) {
        await Conversation.findByIdAndUpdate(
          messageData.conversationId,
          {
            lastMessage: message._id,
            lastMessageAt: message.createdAt
          }
        );
      }
      
      return message;
    } catch (error) {
      logger.error("Error in sendMessage:", error);
      throw error;
    }
  }

  static async getConversationMessages(conversationId, options = {}) {
    try {
      const Message = require("@models/Message");
      
      const query = { conversationId };
      
      if (options.before) {
        query.createdAt = { $lt: new Date(options.before) };
      }
      
      if (options.after) {
        query.createdAt = { $gt: new Date(options.after) };
      }
      
      return await Message.find(query)
        .sort({ createdAt: -1 })
        .skip(options.offset || 0)
        .limit(options.limit || 50)
        .populate('senderId', 'firstName lastName userName avatar')
        .populate('receiverId', 'firstName lastName userName avatar');
    } catch (error) {
      logger.error("Error in getConversationMessages:", error);
      throw error;
    }
  }

  static async markMessagesAsRead(messageIds, userId) {
    try {
      const Message = require("@models/Message");
      
      const result = await Message.updateMany(
        { _id: { $in: messageIds }, readBy: { $ne: userId } },
        { $addToSet: { readBy: userId } }
      );
      
      return result.modifiedCount;
    } catch (error) {
      logger.error("Error in markMessagesAsRead:", error);
      throw error;
    }
  }

  static async getTotalUnreadCount(userId) {
    try {
      const Message = require("@models/Message");
      
      return await Message.countDocuments({
        receiverId: userId,
        readBy: { $ne: userId }
      });
    } catch (error) {
      logger.error("Error in getTotalUnreadCount:", error);
      throw error;
    }
  }

  static async clearConversationMessages(conversationId) {
    try {
      const Message = require("@models/Message");
      
      const result = await Message.deleteMany({ conversationId });
      return result.deletedCount;
    } catch (error) {
      logger.error("Error in clearConversationMessages:", error);
      throw error;
    }
  }

  static async getMessageById(messageId) {
    try {
      const Message = require("@models/Message");
      return await Message.findById(messageId);
    } catch (error) {
      logger.error("Error in getMessageById:", error);
      throw error;
    }
  }

  static async updateMessage(messageId, updateData) {
    try {
      const Message = require("@models/Message");
      return await Message.findByIdAndUpdate(messageId, updateData, { new: true });
    } catch (error) {
      logger.error("Error in updateMessage:", error);
      throw error;
    }
  }
}

module.exports = MessageService;