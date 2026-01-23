const buildConversationQuery = (userId, filters) => {
  const query = { participants: userId };
  
  if (filters.unread !== undefined) {
    if (filters.unread === 'true') {
      query[`unreadCount.${userId}`] = { $gt: 0 };
    } else {
      query[`unreadCount.${userId}`] = 0;
    }
  }
  
  if (filters.archived !== undefined) {
    if (filters.archived === 'true') {
      query.archivedBy = userId;
    } else {
      query.archivedBy = { $ne: userId };
    }
  }
  
  if (filters.muted !== undefined) {
    if (filters.muted === 'true') {
      query.mutedBy = userId;
    } else {
      query.mutedBy = { $ne: userId };
    }
  }
  
  return query;
};

// Helper function to get display name from user object
// Helper function to get display name from user object
const getDisplayName = (user) => {
  if (!user) {
    console.log('❌ getDisplayName: user is null/undefined');
    return 'Unknown';
  }
  
  console.log('🔍 getDisplayName called for user:', {
    id: user._id,
    // Check if it's a Mongoose document
    isMongooseDoc: user.constructor.name,
    // Check all properties
    allProperties: Object.keys(user),
    // Check specific fields
    userName: user.userName,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: user.fullName,
    email: user.email,
    // Check if userName exists as a property
    hasuserNameProp: 'userName' in user,
    userNameType: typeof user.userName,
    userNameValue: user.userName
  });
  
  // 1. First try userName (camelCase - note capital N)
  if (user.userName && typeof user.userName === 'string' && user.userName.trim()) {
    console.log('✅ Using userName:', user.userName);
    return user.userName.trim();
  }
  
  // 2. Try fullName (virtual field - might need to be populated)
  if (user.fullName && typeof user.fullName === 'string' && user.fullName.trim()) {
    console.log('✅ Using fullName:', user.fullName);
    return user.fullName.trim();
  }
  
  // 3. Try firstName + lastName combination
  if (user.firstName || user.lastName) {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    if (name) {
      console.log('✅ Using firstName + lastName:', name);
      return name;
    }
  }
  
  // 4. Use email userName as fallback
  if (user.email) {
    const emailName = user.email.split('@')[0];
    console.log('📧 Using email userName:', emailName);
    return emailName;
  }
  
  console.log('⚠️  No name fields found, checking _doc:', user._doc ? Object.keys(user._doc) : 'No _doc');
  return 'User';
};

const formatConversation = (conversation, userId) => {
  try {
    // Convert userId to string for comparison
    const userIdStr = userId.toString ? userId.toString() : String(userId);
    
    // Find the other participant (not the current user)
    const otherUser = conversation.participants?.find(p => {
      if (!p || !p._id) return false;
      const participantIdStr = p._id.toString ? p._id.toString() : String(p._id);
      return participantIdStr !== userIdStr;
    });
    
    if (!otherUser) {
      console.warn('⚠️  No other user found in conversation');
      return null;
    }
    
    // Get display name for other user
    const otheruserName = getDisplayName(otherUser);
    
    // FIXED: Handle unreadCount properly (it can be an object or Map)
    let unreadCount = 0;
    if (conversation.unreadCount) {
      // Check if it's a Map
      if (conversation.unreadCount.get && typeof conversation.unreadCount.get === 'function') {
        unreadCount = conversation.unreadCount.get(userIdStr) || 0;
      } 
      // It's a plain object
      else if (typeof conversation.unreadCount === 'object') {
        unreadCount = conversation.unreadCount[userIdStr] || 0;
      }
    }
    
    // Safely access lastMessage properties
    let lastMessage = null;
    if (conversation.lastMessage && conversation.lastMessage._id) {
      const lm = conversation.lastMessage;
      
      // Get sender's display name
      const senderName = getDisplayName(lm.senderId);
      
      lastMessage = {
        _id: lm._id,
        id: lm._id,
        content: lm.content || '',
        type: lm.type || 'text',
        senderId: lm.senderId?._id || lm.senderId,
        senderuserName: senderName,
        senderName: senderName,
        timestamp: lm.createdAt || new Date(),
        status: lm.status || 'sent'
      };
    }
    
    // Check if user is muted/archived
    const muted = Array.isArray(conversation.mutedBy) 
      ? conversation.mutedBy.some(id => {
          const idStr = id.toString ? id.toString() : String(id);
          return idStr === userIdStr;
        })
      : false;
    
    const archived = Array.isArray(conversation.archivedBy)
      ? conversation.archivedBy.some(id => {
          const idStr = id.toString ? id.toString() : String(id);
          return idStr === userIdStr;
        })
      : false;
    
    return {
      _id: conversation._id,
      id: conversation._id,
      user: {
        _id: otherUser._id,
        id: otherUser._id,
        userName: otheruserName,
        name: otheruserName,
        firstName: otherUser.firstName || '', // Add firstName field
        lastName: otherUser.lastName || '', // Add lastName field
        userName: otherUser.userName || '', // Add userName field (camelCase)
        email: otherUser.email || '',
        avatar: otherUser.avatar || null,
        lastSeen: otherUser.lastSeen || null,
        online: otherUser.online || false
      },
      lastMessage,
      unreadCount,
      lastMessageAt: conversation.lastMessageAt || conversation.createdAt,
      muted,
      archived,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    };
  } catch (error) {
    console.error('❌ Error in formatConversation:', error.message);
    console.error('Problematic conversation data:', {
      conversationId: conversation?._id,
      participants: conversation?.participants?.map(p => ({
        id: p?._id,
        firstName: p?.firstName,
        lastName: p?.lastName,
        userName: p?.userName,
        email: p?.email
      })),
      unreadCount: conversation?.unreadCount,
      lastMessage: !!conversation?.lastMessage
    });
    return null;
  }
};

module.exports = {
  buildConversationQuery,
  formatConversation
};