// services/conversation-wrapper.service.js
class ConversationServiceWrapper {
  constructor(logger) {
    this.logger = logger;
  }

  async getUserConversations(userId, options = {}) {
    try {
      this.logger.debug(`Getting conversations for user ${userId}`, { options });
      
      // Try to use the actual ConversationService if available
      const ConversationService = require("@controllers/chat/ConversationService");
      
      // Call the actual service - handle the return format properly
      const result = await ConversationService.getUserConversations(userId, {
        limit: options.limit || 20,
        offset: options.offset || 0,
        unread: options.unread || false,
        archived: options.archived || false,
        muted: options.muted || false,
        sort: options.sort || 'lastMessageAt',
        order: options.order || 'desc'
      });
      
      // Handle both possible return formats
      if (result && Array.isArray(result)) {
        return result;
      } else if (result && result.conversations && Array.isArray(result.conversations)) {
        return result.conversations;
      } else if (result && result.data && Array.isArray(result.data)) {
        return result.data;
      }
      
      return [];
    } catch (error) {
      this.logger.error("Error in getUserConversations:", error);
      throw error;
    }
  }

  async getOrCreateConversation(userId1, userId2) {
    try {
      this.logger.debug(`Get or create conversation between ${userId1} and ${userId2}`);
      
      // Import models
      const Conversation = require("@models/Conversation");
      const {BaseUser} = require("@models/User");
      
      // Try to find existing conversation
      const conversation = await Conversation.findOne({
        participants: { $all: [userId1, userId2] }
      })
      .populate('participants', 'firstName lastName userName fullName email avatar')
      .populate('lastMessage');
      
      if (conversation) {
        this.logger.debug(`Found existing conversation: ${conversation._id}`);
        
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
        
        const otheruserName = getDisplayName(otherUser);
        
        return {
          _id: conversation._id,
          id: conversation._id,
          participants: conversation.participants,
          lastMessage: conversation.lastMessage,
          lastMessageAt: conversation.lastMessageAt,
          createdAt: conversation.createdAt,
          unreadCount: conversation.unreadCount?.[userId1] || 0,
          user: otherUser ? {
            _id: otherUser._id,
            id: otherUser._id,
            userName: otheruserName,
            name: otheruserName,
            firstName: otherUser.firstName || '',
            lastName: otherUser.lastName || '',
            userName: otherUser.userName || '',
            email: otherUser.email || '',
            avatar: otherUser.avatar || null
          } : null
        };
      }
      
      // If no conversation exists, create one
      this.logger.debug(`Creating new conversation between ${userId1} and ${userId2}`);
      
      // Get other user details
      const otherUser = await BaseUser.findById(userId2).select('firstName lastName userName fullName email avatar');
      if (!otherUser) {
        throw new Error(`User ${userId2} not found`);
      }
      
      // Create new conversation
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
      
      const otheruserName = getDisplayName(otherUser);
      
      return {
        _id: newConversation._id,
        id: newConversation._id,
        participants: [{ _id: userId1 }, { _id: userId2 }],
        lastMessage: null,
        lastMessageAt: newConversation.lastMessageAt,
        createdAt: newConversation.createdAt,
        unreadCount: 0,
        user: {
          _id: otherUser._id,
          id: otherUser._id,
          userName: otheruserName,
          name: otheruserName,
          firstName: otherUser.firstName || '',
          lastName: otherUser.lastName || '',
          userName: otherUser.userName || '',
          email: otherUser.email || '',
          avatar: otherUser.avatar || null
        }
      };
    } catch (error) {
      this.logger.error("Error in getOrCreateConversation:", error);
      throw error;
    }
  }

  async searchConversations(userId, query) {
    try {
      this.logger.debug(`Searching conversations for ${userId}, query: "${query}"`);
      
      // Try to use ConversationService if available
      const ConversationService = require("@controllers/chat/ConversationService");
      if (typeof ConversationService.searchConversations === 'function') {
        return await ConversationService.searchConversations(userId, query);
      }
      
      // Fallback implementation
      const Conversation = require("@models/Conversation");
      const {BaseUser} = require("@models/User");
      
      const matchingUsers = await BaseUser.find({
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
          
          const otheruserName = getDisplayName(user);
          
          return {
            _id: conv._id,
            id: conv._id,
            user: {
              _id: user._id,
              id: user._id,
              userName: otheruserName,
              name: otheruserName,
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
      this.logger.error("Error in searchConversations:", error);
      return [];
    }
  }

  async updateConversation(conversationId, updateData) {
    try {
      const Conversation = require("@models/Conversation");
      return await Conversation.findByIdAndUpdate(
        conversationId,
        updateData,
        { new: true }
      );
    } catch (error) {
      this.logger.error("Error in updateConversation:", error);
      throw error;
    }
  }
}

module.exports = ConversationServiceWrapper;