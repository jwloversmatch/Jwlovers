// controllers/chat/ConversationService.js
const Conversation = require('@models/Conversation'); 
const { BaseUser } = require('@models/User');
const Message = require('@models/Message'); 
const notificationService = require('@services/notification.service');
const { buildConversationQuery, formatConversation } = require('./helpers/formatters');
const { applyPagination } = require('./helpers/pagination');
const logger = require('@utils/logger');
const MessageFormatter = require('@formatters/MessageFormatter'); 

class ConversationService {
  // ADD MISSING METHOD - Used by ChatController
  async getConversationById(conversationId, req = null) {
    try {
      if (!conversationId) throw new Error('Conversation ID is required');
      
      const conversation = await Conversation.findById(conversationId)
        .populate('participants', 'firstName lastName userName fullName email avatar')
        .populate({
          path: 'lastMessage',
          populate: [
            { path: 'senderId', select: 'firstName lastName userName fullName email avatar' },
            { path: 'receiverId', select: 'firstName lastName userName fullName email avatar' }
          ]
        })
        .lean();
      
      // Decrypt lastMessage if it exists
      if (conversation && conversation.lastMessage && req) {
        const decryptedConversations = MessageFormatter.decryptConversationMessages(
          req, 
          [conversation], 
          null // currentUserId not needed for single conversation decryption
        );
        return decryptedConversations[0];
      }
      
      return conversation;
    } catch (error) {
      logger.error('Error in getConversationById:', error);
      throw error;
    }
  }

  async getUserConversations(userId, filters = {}, req = null) {
    try {
      console.log('🔍 Getting conversations for user:', userId);
      console.log('📋 Filters:', filters);
      
      const query = buildConversationQuery(userId, filters);
      console.log('📊 Query:', query);
      
      const paginationResult = await applyPagination(
        Conversation,
        query,
        filters,
        {
          populate: [
            {
              path: 'lastMessage',
              populate: [
                { 
                  path: 'senderId', 
                  select: 'firstName lastName userName fullName email avatar'
                },
                { 
                  path: 'receiverId', 
                  select: 'firstName lastName userName fullName email avatar'
                }
              ]
            },
            {
              path: 'participants',
              match: { _id: { $ne: userId } },
              select: 'firstName lastName userName fullName email avatar lastSeen online'
            }
          ],
          sortField: filters.sort || 'lastMessageAt',
          sortOrder: filters.order || 'desc'
        }
      );
      
      console.log('📦 Pagination result:', {
        total: paginationResult.total,
        itemsCount: paginationResult.items?.length || 0
      });
      
      if (!paginationResult.items || !Array.isArray(paginationResult.items)) {
        console.warn('⚠️  No conversations found or items is not an array');
        return {
          conversations: [],
          pagination: {
            total: 0,
            limit: parseInt(filters.limit) || 20,
            offset: parseInt(filters.offset) || 0,
            hasMore: false
          }
        };
      }
      
      // Decrypt lastMessages in conversations if req is provided
      let conversationsToFormat = paginationResult.items;
      if (req) {
        conversationsToFormat = MessageFormatter.decryptConversationMessages(
          req, 
          paginationResult.items, 
          userId
        );
      }
      
      const formattedConversations = conversationsToFormat.map(conv => {
        try {
          return formatConversation(conv, userId);
        } catch (error) {
          console.error('❌ Error formatting conversation:', error.message);
          console.error('Problematic conversation ID:', conv?._id);
          return null;
        }
      }).filter(conv => conv !== null);
      
      console.log('✅ Formatted conversations:', formattedConversations.length);
      
      return {
        conversations: formattedConversations,
        pagination: {
          total: paginationResult.total || 0,
          limit: parseInt(filters.limit) || 20,
          offset: parseInt(filters.offset) || 0,
          hasMore: (paginationResult.total || 0) > (parseInt(filters.offset) || 0) + formattedConversations.length
        }
      };
    } catch (error) {
      console.error('❌ Error in getUserConversations:', error);
      throw error;
    }
  }

  async createConversation(userId, data, req = null) {
    try {
      console.log('🔍 Creating conversation for user:', userId);
      console.log('📋 Data:', data);
      
      const { participantId } = data;
      
      const participant = await BaseUser.findById(participantId);
      if (!participant) {
        throw new Error('Participant not found');
      }
      
      let conversation = await Conversation.findOne({
        participants: { $all: [userId, participantId] }
      }).populate('participants', 'firstName lastName userName fullName email avatar');
      
      if (!conversation) {
        console.log('📝 Creating new conversation');
        conversation = await Conversation.create({
          participants: [userId, participantId],
          lastMessageAt: new Date()
        });
        
        conversation = await Conversation.findById(conversation._id)
          .populate('participants', 'firstName lastName userName fullName email avatar');
      }
      
      // Decrypt lastMessage if it exists and req is provided
      if (conversation.lastMessage && req) {
        const decryptedConversations = MessageFormatter.decryptConversationMessages(
          req,
          [conversation.toObject()],
          userId
        );
        conversation = decryptedConversations[0];
      }
      
      const otherUser = conversation.participants.find(p => p._id.toString() !== userId);
      
      const getDisplayName = (user) => {
        if (!user) return 'Unknown';
        
        if (user.userName && user.userName.trim()) {
          return user.userName.trim();
        }
        
        if (user.fullName && user.fullName.trim()) {
          return user.fullName.trim();
        }
        
        if (user.firstName || user.lastName) {
          return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
        }
        
        if (user.email) {
          return user.email.split('@')[0];
        }
        
        return 'User';
      };
      
      const otheruserName = getDisplayName(otherUser);
      
      return {
        _id: conversation._id,
        id: conversation._id,
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
        },
        lastMessage: conversation.lastMessage ? {
          ...conversation.lastMessage,
          content: conversation.lastMessage.content
        } : null,
        unreadCount: 0,
        lastMessageAt: conversation.lastMessageAt,
        muted: false,
        archived: false,
        createdAt: conversation.createdAt
      };
    } catch (error) {
      console.error('❌ Error in createConversation:', error);
      throw error;
    }
  }

  async getConversationWithUser(currentUserId, otherUserId, filters = {}, req = null) {
    try {
      console.log('🔍 Getting conversation between:', currentUserId, 'and', otherUserId);
      
      const otherUser = await BaseUser.findById(otherUserId)
        .select('firstName lastName userName fullName email avatar online lastSeen');
      
      if (!otherUser) {
        throw new Error('User not found');
      }
      
      const query = {
        $or: [
          { senderId: currentUserId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: currentUserId }
        ],
        deletedFor: { $ne: currentUserId }
      };
      
      if (filters.before) query.createdAt = { ...query.createdAt, $lt: new Date(filters.before) };
      if (filters.after) query.createdAt = { ...query.createdAt, $gt: new Date(filters.after) };
      
      const paginationResult = await applyPagination(
        Message,
        query,
        filters,
        {
          populate: [
            { 
              path: 'senderId', 
              select: 'firstName lastName userName fullName email avatar'
            },
            { 
              path: 'receiverId', 
              select: 'firstName lastName userName fullName email avatar'
            }
          ],
          sortField: 'createdAt',
          sortOrder: 'desc'
        }
      );
      
      if (!paginationResult.items || !Array.isArray(paginationResult.items)) {
        console.warn('⚠️  No messages found or items is not an array');
        
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
          messages: [],
          user: {
            _id: otherUser._id,
            id: otherUser._id,
            userName: otheruserName,
            name: otheruserName,
            firstName: otherUser.firstName || '',
            lastName: otherUser.lastName || '',
            userName: otherUser.userName || '',
            email: otherUser.email || '',
            avatar: otherUser.avatar || null,
            online: otherUser.online || false,
            lastSeen: otherUser.lastSeen
          },
          pagination: {
            total: 0,
            limit: parseInt(filters.limit) || 50,
            offset: parseInt(filters.offset) || 0,
            hasMore: false
          }
        };
      }
      
      const undeliveredMessages = paginationResult.items.filter(
        msg => msg.receiverId?._id?.toString() === currentUserId && msg.status === 'sent'
      );
      
      if (undeliveredMessages.length > 0) {
        await Message.updateMany(
          { _id: { $in: undeliveredMessages.map(msg => msg._id) } },
          { status: 'delivered', deliveredAt: new Date() }
        );
      }
      
      await Conversation.findOneAndUpdate(
        { participants: { $all: [currentUserId, otherUserId] } },
        { $set: { [`unreadCount.${currentUserId}`]: 0 } }
      );
      
      // Decrypt messages if req is provided
      let messagesToFormat = paginationResult.items;
      if (req) {
        messagesToFormat = MessageFormatter.decryptMessageList(
          req,
          paginationResult.items,
          currentUserId
        );
      }
      
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
      
      const formattedMessages = messagesToFormat.reverse().map(msg => {
        const senderName = getDisplayName(msg.senderId);
        
        return {
          _id: msg._id,
          id: msg._id,
          content: msg.content || '',
          type: msg.type || 'text',
          senderId: msg.senderId?._id || msg.senderId,
          senderuserName: senderName,
          senderName: senderName,
          senderFirstName: msg.senderId?.firstName || '',
          senderLastName: msg.senderId?.lastName || '',
          senderuserName: msg.senderId?.userName || '',
          receiverId: msg.receiverId?._id || msg.receiverId,
          createdAt: msg.createdAt || new Date(),
          status: msg.status || 'sent',
          conversationId: msg.conversationId
        };
      });
      
      const otheruserName = getDisplayName(otherUser);
      
      return {
        messages: formattedMessages,
        user: {
          _id: otherUser._id,
          id: otherUser._id,
          userName: otheruserName,
          name: otheruserName,
          firstName: otherUser.firstName || '',
          lastName: otherUser.lastName || '',
          userName: otherUser.userName || '',
          email: otherUser.email || '',
          avatar: otherUser.avatar || null,
          online: otherUser.online || false,
          lastSeen: otherUser.lastSeen
        },
        pagination: {
          total: paginationResult.total || 0,
          limit: parseInt(filters.limit) || 50,
          offset: parseInt(filters.offset) || 0,
          hasMore: (paginationResult.total || 0) > (parseInt(filters.offset) || 0) + paginationResult.items.length
        }
      };
    } catch (error) {
      console.error('❌ Error in getConversationWithUser:', error);
      throw error;
    }
  }

  async archiveConversation(userId, otherUserId, archive = true) {
    try {
      console.log('📁 Archive conversation:', { userId, otherUserId, archive });
      
      const update = archive 
        ? { $addToSet: { archivedBy: userId } }
        : { $pull: { archivedBy: userId } };
      
      await Conversation.findOneAndUpdate(
        { participants: { $all: [userId, otherUserId] } },
        update
      );
    } catch (error) {
      console.error('❌ Error in archiveConversation:', error);
      throw error;
    }
  }

  async muteConversation(userId, otherUserId, mute = true) {
    try {
      console.log('🔇 Mute conversation:', { userId, otherUserId, mute });
      
      const update = mute 
        ? { $addToSet: { mutedBy: userId } }
        : { $pull: { mutedBy: userId } };
      
      await Conversation.findOneAndUpdate(
        { participants: { $all: [userId, otherUserId] } },
        update
      );
    } catch (error) {
      console.error('❌ Error in muteConversation:', error);
      throw error;
    }
  }

  async clearConversation(currentUserId, otherUserId) {
    try {
      console.log('🗑️  Clear conversation:', { currentUserId, otherUserId });
      
      await Message.updateMany(
        {
          $or: [
            { senderId: currentUserId, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: currentUserId }
          ]
        },
        {
          $addToSet: { deletedFor: currentUserId }
        }
      );
      
      await Conversation.findOneAndUpdate(
        { participants: { $all: [currentUserId, otherUserId] } },
        { 
          $set: { [`unreadCount.${currentUserId}`]: 0 },
          $pull: { archivedBy: currentUserId, mutedBy: currentUserId }
        }
      );
    } catch (error) {
      console.error('❌ Error in clearConversation:', error);
      throw error;
    }
  }
}

module.exports = new ConversationService();