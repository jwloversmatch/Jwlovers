const Message = require('@models/Message');
const Conversation = require('@models/Conversation');
const User = require('@models/User');
const { applyPagination } = require('./helpers/pagination');

class SearchService {
  async searchConversations(userId, filters = {}) {
    const { query, limit = 20, offset = 0 } = filters;
    
    if (!query || query.trim().length < 2) {
      throw new Error('Search query must be at least 2 characters');
    }
    
    const users = await User.find({
      _id: { $ne: userId },
      $or: [
        { firstName: { $regex: query, $options: 'i' } },
        { lastName: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
        { 
          $expr: { 
            $regexMatch: {
              input: { $concat: ["$firstName", " ", "$lastName"] },
              regex: query,
              options: "i"
            }
          }
        }
      ]
    })
      .select('name avatar email lastSeen online')
      .limit(Math.min(parseInt(limit), 50))
      .skip(parseInt(offset));
    
    const results = await Promise.all(
      users.map(async (user) => {
        const conversation = await Conversation.findOne({
          participants: { $all: [userId, user._id] }
        })
          .populate('lastMessage')
          .populate('participants', 'name avatar email');
        
        if (!conversation) {
          return {
            id: null,
            user: {
              id: user._id,
              name: user.name,
              email: user.email,
              avatar: user.avatar,
              lastSeen: user.lastSeen,
              online: user.online || false
            },
            lastMessage: null,
            unreadCount: 0,
            lastMessageAt: null,
            muted: false,
            archived: false,
            isNew: true
          };
        }
        
        const unreadCount = conversation.unreadCount.get(userId.toString()) || 0;
        
        return {
          id: conversation._id,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            lastSeen: user.lastSeen,
            online: user.online || false
          },
          lastMessage: conversation.lastMessage ? {
            id: conversation.lastMessage._id,
            content: conversation.lastMessage.content,
            type: conversation.lastMessage.type,
            senderId: conversation.lastMessage.senderId._id,
            senderName: conversation.lastMessage.senderId.name,
            timestamp: conversation.lastMessage.createdAt,
            status: conversation.lastMessage.status
          } : null,
          unreadCount,
          lastMessageAt: conversation.lastMessageAt,
          muted: conversation.mutedBy?.includes(userId) || false,
          archived: conversation.archivedBy?.includes(userId) || false,
          isNew: false
        };
      })
    );
    
    return {
      results,
      query: query.trim(),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: users.length
      }
    };
  }

  async searchMessages(userId, filters = {}) {
    const { 
      query, 
      targetUserId,
      limit = 20, 
      offset = 0,
      sort = 'createdAt',
      order = 'desc'
    } = filters;
    
    if (!query) {
      throw new Error('Search query is required');
    }
    
    const searchQuery = {
      $and: [
        {
          $or: [
            { senderId: userId, receiverId: targetUserId },
            { senderId: targetUserId, receiverId: userId }
          ]
        },
        {
          content: { $regex: query, $options: 'i' }
        },
        {
          deletedFor: { $ne: userId }
        }
      ]
    };
    
    if (!targetUserId) {
      searchQuery.$and[0] = {
        $or: [
          { senderId: userId },
          { receiverId: userId }
        ]
      };
    }
    
    const { total, items: messages } = await applyPagination(
      Message,
      searchQuery,
      filters,
      {
        populate: [
          { path: 'senderId', select: 'name avatar' },
          { path: 'receiverId', select: 'name avatar' }
        ],
        sortField: sort,
        sortOrder: order
      }
    );
    
    return {
      messages,
      query: query.trim(),
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: total > parseInt(offset) + messages.length
      }
    };
  }
}

module.exports = SearchService;