module.exports = {
  ACCOUNT_STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended'
  },
  
  PRESENCE_STATUS: {
    ONLINE: 'online',
    AWAY: 'away',
    BUSY: 'busy',
    OFFLINE: 'offline'
  },
  
  ROLES: {
    USER: 'user',
    MODERATOR: 'moderator',
    ADMIN: 'admin'
  },
  
  PRIVACY: {
    VISIBILITY: {
      PUBLIC: 'public',
      FRIENDS: 'friends',
      PRIVATE: 'private'
    },
    MESSAGES_FROM: {
      EVERYONE: 'everyone',
      FRIENDS: 'friends',
      NOBODY: 'nobody'
    }
  },
  
  ONLINE_THRESHOLD_MS: (parseInt(process.env.ONLINE_THRESHOLD_MINUTES) || 3) * 60 * 1000,
  
  USER_PROJECTIONS: {
    AUTH: '+password +refreshToken',
    PUBLIC: 'firstName lastName avatar userName',
    PRESENCE: 'isOnline presenceStatus lastSeen lastLogin firstName lastName userName avatar accountStatus',
    PROFILE: 'firstName lastName email userName avatar phoneNumber accountStatus role emailVerified phoneVerified presenceStatus isOnline lastSeen lastLogin notificationSettings privacySettings socketId createdAt updatedAt',
    SEARCH: 'firstName lastName avatar email userName isOnline presenceStatus lastSeen'
  }
};