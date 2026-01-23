const logger = require("../utils/logger");

class ConversationServiceWrapper {
  static async getUserConversations(userId, options = {}) {
    try {
      logger.debug(`Getting conversations for user ${userId}`, { options });
      
      const Conversation = require("@models/Conversation");
      const User = require("@models/User/User.model");
      
      const query = { participants: userId };
      
      if (options.archived) {
        query.archivedBy = userId;
      }
      
      if (options.muted) {
        query.mutedBy = userId;
      }
      
      const sort = {};
      sort[options.sort || 'lastMessageAt'] = options.order === 'asc' ? 1 : -1;
      
      const conversations = await Conversation.find(query)
        .sort(sort)
        .skip(options.offset || 0)
        .limit(options.limit || 20)
        .populate('participants', 'firstName lastName userName fullName email avatar')
        .populate('lastMessage')
        .lean();
      
      const processedConversations = await Promise.all(
        conversations.map(async (conv) => {
          const otherUser = conv.participants.find(p => 
            p._id.toString() !== userId.toString()
          );
          
          const getDisplayName = (user) => {
            if (!user) return 'Unknown';
            if (user.userName && user.userName.trim()) return user.userName.trim();
            if (user.fullName && user.fullName.trim()) return user.fullName.trim();
            if (user.firstName || user.lastName) {
              return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
            }
            if (user.email) return user.email.split('@')[0];
            return 'User';
          };
          
          const otherUserName = getDisplayName(otherUser);
          
          return {
            _id: conv._id,
            id: conv._id.toString(),
            participants: conv.participants,
            lastMessage: conv.lastMessage,
            lastMessageAt: conv.lastMessageAt,
            createdAt: conv.createdAt,
            unreadCount: conv.unreadCount?.[userId] || 0,
            user: otherUser ? {
              _id: otherUser._id,
              id: otherUser._id.toString(),
              username: otherUserName,
              name: otherUserName,
              firstName: otherUser.firstName || '',
              lastName: otherUser.lastName || '',
              userName: otherUser.userName || '',
              email: otherUser.email || '',
              avatar: otherUser.avatar || null
            } : null
          };
        })
      );
      
      return processedConversations;
    } catch (error) {
      logger.error("Error in getUserConversations:", error);
      throw error;
    }
  }

  static async getOrCreateConversation(userId1, userId2) {
    try {
      logger.debug(`Get or create conversation between ${userId1} and ${userId2}`);
      
      const Conversation = require("@models/Conversation");
      const User = require("@models/User/User.model");
      
      const conversation = await Conversation.findOne({
        participants: { $all: [userId1, userId2] }
      })
      .populate('participants', 'firstName lastName userName fullName email avatar')
      .populate('lastMessage');
      
      if (conversation) {
        logger.debug(`Found existing conversation: ${conversation._id}`);
        
        const otherUser = conversation.participants.find(p => 
          p._id.toString() !== userId1.toString()
        );
        
        const getDisplayName = (user) => {
          if (!user) return 'Unknown';
          if (user.userName && user.userName.trim()) return user.userName.trim();
          if (user.fullName && user.fullName.trim()) return user.fullName.trim();
          if (user.firstName || user.lastName) {
            return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
          }
          if (user.email) return user.email.split('@')[0];
          return 'User';
        };
        
        const otherUserName = getDisplayName(otherUser);
        
        return {
          _id: conversation._id,
          id: conversation._id.toString(),
          participants: conversation.participants,
          lastMessage: conversation.lastMessage,
          lastMessageAt: conversation.lastMessageAt,
          createdAt: conversation.createdAt,
          unreadCount: conversation.unreadCount?.[userId1] || 0,
          user: otherUser ? {
            _id: otherUser._id,
            id: otherUser._id.toString(),
            username: otherUserName,
            name: otherUserName,
            firstName: otherUser.firstName || '',
            lastName: otherUser.lastName || '',
            userName: otherUser.userName || '',
            email: otherUser.email || '',
            avatar: otherUser.avatar || null
          } : null
        };
      }
      
      logger.debug(`Creating new conversation between ${userId1} and ${userId2}`);
      
      const otherUser = await User.findById(userId2).select('firstName lastName userName fullName email avatar');
      if (!otherUser) {
        throw new Error(`User ${userId2} not found`);
      }
      
      const newConversation = new Conversation({
        participants: [userId1, userId2],
        lastMessageAt: new Date(),
        createdAt: new Date(),
        unreadCount: { [userId1]: 0, [userId2]: 0 }
      });
      
      await newConversation.save();
      
      const getDisplayName = (user) => {
        if (!user) return 'Unknown';
        if (user.userName && user.userName.trim()) return user.userName.trim();
        if (user.fullName && user.fullName.trim()) return user.fullName.trim();
        if (user.firstName || user.lastName) {
          return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
        }
        if (user.email) return user.email.split('@')[0];
        return 'User';
      };
      
      const otherUserName = getDisplayName(otherUser);
      
      return {
        _id: newConversation._id,
        id: newConversation._id.toString(),
        participants: [{ _id: userId1 }, { _id: userId2 }],
        lastMessage: null,
        lastMessageAt: newConversation.lastMessageAt,
        createdAt: newConversation.createdAt,
        unreadCount: 0,
        user: {
          _id: otherUser._id,
          id: otherUser._id.toString(),
          username: otherUserName,
          name: otherUserName,
          firstName: otherUser.firstName || '',
          lastName: otherUser.lastName || '',
          userName: otherUser.userName || '',
          email: otherUser.email || '',
          avatar: otherUser.avatar || null
        }
      };
    } catch (error) {
      logger.error("Error in getOrCreateConversation:", error);
      throw error;
    }
  }

  static async searchConversations(userId, query) {
    try {
      logger.debug(`Searching conversations for ${userId}, query: "${query}"`);
      
      const Conversation = require("@models/Conversation");
      const User = require("@models/User/User.model");
      
      const matchingUsers = await User.find({
        $or: [
          { firstName: { $regex: query, $options: 'i' } },
          { lastName: { $regex: query, $options: 'i' } },
          { userName: { $regex: query, $options: 'i' } },
          { fullName: { $regex: query, $options: 'i' } }
        ],
        _id: { $ne: userId }
      }).limit(10);
      
      const conversations = await Promise.all(
        matchingUsers.map(async (user) => {
          const conv = await Conversation.findOne({
            participants: { $all: [userId, user._id] }
          })
          .populate('lastMessage');
          
          if (!conv) return null;
          
          const getDisplayName = (user) => {
            if (!user) return 'Unknown';
            if (user.userName && user.userName.trim()) return user.userName.trim();
            if (user.fullName && user.fullName.trim()) return user.fullName.trim();
            if (user.firstName || user.lastName) {
              return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
            }
            return 'User';
          };
          
          const otherUserName = getDisplayName(user);
          
          return {
            _id: conv._id,
            id: conv._id.toString(),
            user: {
              _id: user._id,
              id: user._id.toString(),
              username: otherUserName,
              name: otherUserName,
              firstName: user.firstName || '',
              lastName: user.lastName || '',
              userName: user.userName || '',
              email: user.email || '',
              avatar: user.avatar || null
            },
            lastMessage: conv.lastMessage ? {
              _id: conv.lastMessage._id,
              content: conv.lastMessage.content || '',
              createdAt: conv.lastMessage.createdAt
            } : null,
            unreadCount: conv.unreadCount?.[userId] || 0,
            lastMessageAt: conv.lastMessageAt,
            muted: conv.mutedBy?.includes(userId) || false,
            archived: conv.archivedBy?.includes(userId) || false,
            createdAt: conv.createdAt
          };
        })
      );
      
      return conversations.filter(c => c !== null);
    } catch (error) {
      logger.error("Error in searchConversations:", error);
      return [];
    }
  }

  static async updateConversation(conversationId, updateData) {
    try {
      const Conversation = require("@models/Conversation");
      return await Conversation.findByIdAndUpdate(
        conversationId,
        updateData,
        { new: true }
      );
    } catch (error) {
      logger.error("Error in updateConversation:", error);
      throw error;
    }
  }
}

module.exports = { ConversationServiceWrapper };