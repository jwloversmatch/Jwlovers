const Conversation = require('@models/Conversation');
const Message = require('@models/Message');
const logger = require('@utils/logger') || console;

class StatsService {
  async getUnreadCount(userId, otherUserId) {
    try {
      const conversation = await Conversation.findOne({
        participants: { $all: [userId, otherUserId] }
      });
      
      const unreadCount = conversation 
        ? conversation.unreadCount.get(userId.toString()) || 0 
        : 0;
      
      return { unreadCount };
    } catch (error) {
      logger.error('Error in getUnreadCount:', error);
      return { unreadCount: 0 };
    }
  }

  async getTotalUnreadCount(userId) {
    try {
      const conversations = await Conversation.find({
        participants: userId
      });
      
      const totalUnread = conversations.reduce((sum, conv) => {
        return sum + (conv.unreadCount.get(userId.toString()) || 0);
      }, 0);
      
      return { totalUnreadCount: totalUnread };  // FIXED: Return property name matches controller expectation
    } catch (error) {
      logger.error('Error in getTotalUnreadCount:', error);
      return { totalUnreadCount: 0 };
    }
  }

  async getUserStats(userId) {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      const [
        totalConversations,
        unreadConversations,
        archivedConversations,
        mutedConversations,
        totalMessages,
        last7DaysMessages,
        last30DaysMessages,
        sentMessages,
        receivedMessages
      ] = await Promise.all([
        // Conversation stats
        Conversation.countDocuments({ participants: userId }),
        Conversation.countDocuments({ 
          participants: userId,
          [`unreadCount.${userId}`]: { $gt: 0 }
        }),
        Conversation.countDocuments({ 
          participants: userId,
          archivedBy: userId
        }),
        Conversation.countDocuments({ 
          participants: userId,
          mutedBy: userId
        }),
        
        // Message stats
        Message.countDocuments({
          $or: [
            { senderId: userId },
            { receiverId: userId }
          ],
          deletedFor: { $ne: userId }
        }),
        Message.countDocuments({
          $or: [
            { senderId: userId },
            { receiverId: userId }
          ],
          createdAt: { $gte: sevenDaysAgo },
          deletedFor: { $ne: userId }
        }),
        Message.countDocuments({
          $or: [
            { senderId: userId },
            { receiverId: userId }
          ],
          createdAt: { $gte: thirtyDaysAgo },
          deletedFor: { $ne: userId }
        }),
        Message.countDocuments({
          senderId: userId,
          deletedFor: { $ne: userId }
        }),
        Message.countDocuments({
          receiverId: userId,
          deletedFor: { $ne: userId }
        })
      ]);
      
      return {
        stats: {
          conversations: {
            total: totalConversations,
            unread: unreadConversations,
            archived: archivedConversations,
            muted: mutedConversations
          },
          messages: {
            total: totalMessages,
            last7Days: last7DaysMessages,
            last30Days: last30DaysMessages,
            sent: sentMessages,
            received: receivedMessages,
            sentVsReceivedRatio: receivedMessages > 0 ? 
              (sentMessages / receivedMessages).toFixed(2) : 'N/A'
          }
        },
        period: {
          sevenDaysAgo: sevenDaysAgo.toISOString(),
          thirtyDaysAgo: thirtyDaysAgo.toISOString()
        }
      };
    } catch (error) {
      logger.error('Error in getUserStats:', error);
      return {
        stats: {
          conversations: {
            total: 0,
            unread: 0,
            archived: 0,
            muted: 0
          },
          messages: {
            total: 0,
            last7Days: 0,
            last30Days: 0,
            sent: 0,
            received: 0,
            sentVsReceivedRatio: 'N/A'
          }
        },
        period: {
          sevenDaysAgo: new Date().toISOString(),
          thirtyDaysAgo: new Date().toISOString()
        }
      };
    }
  }
}

// FIXED: Export as singleton instance
module.exports = new StatsService();