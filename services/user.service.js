const { 
  BaseUser, 
  DatingUser, 
  Moderator, 
  Admin, 
  SuperAdmin,
  UserQuery,
  UserFactory,
  UserService: CoreUserService, // Rename to avoid conflict
  ROLES 
} = require("@models/User");
const UserSettings = require("@models/UserSettings.model");
const UserProfile = require("@models/UserProfile.model");
const UserContact = require("@models/UserContact.model");
const UserBlock = require("@models/Block.model");
const redisClient = require("@config/redis");
const logger = require("@utils/logger");

class UserService {
  constructor() {
    this.ONLINE_STATUS_KEY = "user:status";
    this.USER_PRESENCE_KEY = "user:presence";
    this.USER_PRESENCE_TYPE_KEY = "user:presence:type";
    this.ONLINE_THRESHOLD = 5 * 60 * 1000; 
  }

  async createUser(userData) {
    try {
      const user = await UserFactory.createUser(userData);
      
      const settings = await UserSettings.create({ userId: user._id });
      
      let profile = null;
      if (user.role === ROLES.USER) {
        profile = await UserProfile.create({ userId: user._id });
      }
      
      logger.info('User created', {
        userId: user._id,
        userType: user.userType,
        role: user.role,
        email: user.email
      });
      
      return user;
    } catch (error) {
      logger.error('Failed to create user:', error);
      throw error;
    }
  }
  
  async getUserWithDetails(userId) {
    try {
      const user = await UserQuery.getUserById(userId);
      if (!user) return null;
      
      const [settings, contacts] = await Promise.all([
        UserSettings.findOne({ userId }),
        UserContact.find({ userId }).populate("contactId", "firstName lastName avatar"),
      ]);
      
      const onlineStatus = await this.getOnlineStatus(userId);
      
      const result = {
        user: this.formatUserForResponse(user),
        settings,
        contacts,
        onlineStatus
      };
      
      if (user.userType === 'DatingUser') {
        const profile = await UserProfile.findOne({ userId });
        result.profile = profile;
      }
      
      return result;
      
    } catch (error) {
      logger.error('Failed to get user with details:', error);
      throw error;
    }
  }
  
  async updateOnlineStatus(userId, status = 'online', customStatus = null) {
    try {
      const user = await UserQuery.getUserById(userId);
      if (!user) {
        logger.warn(`User not found for status update: ${userId}`);
        return null;
      }
      
      const now = new Date();
      
      if (!user.presence) {
        user.presence = {
          status: 'offline',
          lastSeen: now,
          lastActive: now,
          customStatus: null
        };
      }
      
      user.presence.status = status;
      user.presence.lastSeen = now;
      user.presence.lastActive = now;
      
      if (customStatus !== null) {
        user.presence.customStatus = customStatus;
      }
      
      if (status === 'online') {
        user.lastLogin = now;
      }
      
      await user.save();
      
      await this._updateRedisStatus(userId, status, user.userType, customStatus);
      
      logger.debug(`Updated status for user ${userId} (${user.userType}): ${status}`, {
        userId,
        userType: user.userType,
        status,
        customStatus
      });
      
      return user;
      
    } catch (error) {
      logger.error('Failed to update online status:', error);
      try {
        return await BaseUser.findByIdAndUpdate(
          userId,
          { 
            $set: {
              'presence.lastSeen': new Date(),
              'presence.status': status
            }
          },
          { new: true }
        );
      } catch (fallbackError) {
        logger.error('Fallback update also failed:', fallbackError);
        return null;
      }
    }
  }
  
  async _updateRedisStatus(userId, status, userType = null, customStatus = null) {
    try {
      const redis = await redisClient.getClient();
      if (!redis) {
        logger.warn('Redis not available for status update');
        return;
      }
      
      const timestamp = Date.now();
      const statusData = {
        status,
        userType: userType || 'unknown',
        updatedAt: timestamp,
        lastSeen: timestamp
      };
      
      if (customStatus) {
        statusData.customStatus = customStatus;
      }
      
      const multi = redis.multi();
      
      multi.hset(this.ONLINE_STATUS_KEY, userId.toString(), JSON.stringify(statusData));
      
      if (status === 'online') {
        multi.zadd(this.USER_PRESENCE_KEY, timestamp, userId.toString());
        
        if (userType) {
          const typeKey = `${this.USER_PRESENCE_TYPE_KEY}:${userType}`;
          multi.zadd(typeKey, timestamp, userId.toString());
          multi.expire(typeKey, 24 * 60 * 60);
        }
      } else {
        multi.zrem(this.USER_PRESENCE_KEY, userId.toString());
        
        if (userType) {
          const typeKey = `${this.USER_PRESENCE_TYPE_KEY}:${userType}`;
          multi.zrem(typeKey, userId.toString());
        }
      }
      
      multi.expire(this.ONLINE_STATUS_KEY, 24 * 60 * 60);
      multi.expire(this.USER_PRESENCE_KEY, 24 * 60 * 60);
      
      await multi.exec();
      
    } catch (error) {
      logger.error('Redis status update failed:', error.message);
    }
  }
  
  async getOnlineStatus(userId) {
    try {
      const redis = await redisClient.getClient();
      if (redis) {
        const statusJson = await redis.hget(this.ONLINE_STATUS_KEY, userId.toString());
        
        if (statusJson) {
          const parsed = JSON.parse(statusJson);
          const timeSinceUpdate = Date.now() - parsed.updatedAt;
          
          if (timeSinceUpdate < this.ONLINE_THRESHOLD) {
            return {
              status: parsed.status,
              userType: parsed.userType,
              customStatus: parsed.customStatus,
              lastSeen: parsed.lastSeen
            };
          }
        }
      }
      
      const user = await UserQuery.getUserById(userId);
      if (!user) {
        return {
          status: 'offline',
          userType: 'unknown',
          customStatus: null,
          lastSeen: null
        };
      }
      
      const lastSeen = user.presence?.lastSeen || user.lastSeen;
      let status = 'offline';
      let customStatus = user.presence?.customStatus || null;
      
      if (lastSeen) {
        const timeSinceLastSeen = Date.now() - new Date(lastSeen).getTime();
        status = timeSinceLastSeen < this.ONLINE_THRESHOLD ? 'online' : 'offline';
      }
      
      return {
        status,
        userType: user.userType || 'unknown',
        customStatus,
        lastSeen: lastSeen
      };
      
    } catch (error) {
      logger.error('Failed to get online status:', error);
      return {
        status: 'offline',
        userType: 'unknown',
        customStatus: null,
        lastSeen: null
      };
    }
  }
  
  async getOnlineStatuses(userIds) {
    try {
      const redis = await redisClient.getClient();
      
      if (redis) {
        const statuses = await redis.hmget(
          this.ONLINE_STATUS_KEY, 
          ...userIds.map(id => id.toString())
        );
        
        const result = {};
        const now = Date.now();
        
        userIds.forEach((userId, index) => {
          const statusJson = statuses[index];
          
          if (statusJson) {
            try {
              const parsed = JSON.parse(statusJson);
              const timeSinceUpdate = now - parsed.updatedAt;
              
              result[userId] = {
                status: timeSinceUpdate < this.ONLINE_THRESHOLD ? parsed.status : 'offline',
                userType: parsed.userType,
                customStatus: parsed.customStatus,
                lastSeen: parsed.lastSeen
              };
            } catch {
              result[userId] = {
                status: 'offline',
                userType: 'unknown',
                customStatus: null,
                lastSeen: null
              };
            }
          } else {
            result[userId] = {
              status: 'offline',
              userType: 'unknown',
              customStatus: null,
              lastSeen: null
            };
          }
        });
        
        return result;
      }
      
      logger.warn('Redis not available, falling back to database for statuses');
      const users = await BaseUser.find({ 
        _id: { $in: userIds }
      }).select('presence userType lastSeen');
      
      return userIds.reduce((acc, userId) => {
        const user = users.find(u => u._id.toString() === userId.toString());
        
        if (user) {
          const lastSeen = user.presence?.lastSeen || user.lastSeen;
          let status = 'offline';
          let customStatus = user.presence?.customStatus || null;
          
          if (lastSeen) {
            const timeSinceLastSeen = Date.now() - new Date(lastSeen).getTime();
            status = timeSinceLastSeen < this.ONLINE_THRESHOLD ? 'online' : 'offline';
          }
          
          acc[userId] = {
            status,
            userType: user.userType || 'unknown',
            customStatus,
            lastSeen
          };
        } else {
          acc[userId] = {
            status: 'offline',
            userType: 'unknown',
            customStatus: null,
            lastSeen: null
          };
        }
        
        return acc;
      }, {});
      
    } catch (error) {
      logger.error('Failed to get online statuses:', error);
      return userIds.reduce((acc, userId) => {
        acc[userId] = {
          status: 'offline',
          userType: 'unknown',
          customStatus: null,
          lastSeen: null
        };
        return acc;
      }, {});
    }
  }
  
  async getActiveUsersWithStatus(options = {}) {
    try {
      const { 
        limit = 50, 
        offset = 0, 
        userType = 'all',
        status = 'online'
      } = options;
      
      logger.info(`Getting active users: type=${userType}, status=${status}, limit=${limit}, offset=${offset}`);
      
      let users = [];
      const now = Date.now();
      const cutoff = new Date(now - this.ONLINE_THRESHOLD);
      
      const query = {
        accountStatus: 'active',
        'presence.status': status
      };
      
      if (userType !== 'all') {
        if (userType === 'dating') {
          query.userType = 'DatingUser';
        } else if (userType === 'staff') {
          query.userType = { $in: ['Moderator', 'Admin', 'SuperAdmin'] };
        } else {
          query.userType = userType;
        }
      }
      
      if (status === 'online') {
        query['presence.lastSeen'] = { $gt: cutoff };
      } else if (status === 'offline') {
        query['presence.lastSeen'] = { $lte: cutoff };
      }
      
      users = await BaseUser.find(query)
        .select('firstName lastName avatar userName userType role presence email')
        .sort({ 'presence.lastSeen': -1 })
        .skip(offset)
        .limit(limit);
      
      logger.info(`Found ${users.length} users from database`);
      
      if (users.length === 0) {
        return [];
      }
      
      const userIds = users.map(u => u._id);
      const statuses = await this.getOnlineStatuses(userIds);
      
      const enhancedUsers = users.map(user => {
        const userStatus = statuses[user._id] || {
          status: 'offline',
          userType: user.userType,
          customStatus: user.presence?.customStatus,
          lastSeen: user.presence?.lastSeen
        };
        
        return {
          userId: user._id,
          name: `${user.firstName} ${user.lastName}`,
          userName: user.userName,
          avatar: user.avatar,
          email: user.email,
          userType: user.userType,
          role: user.role,
          isOnline: userStatus.status === 'online',
          status: userStatus.status,
          customStatus: userStatus.customStatus,
          lastSeen: userStatus.lastSeen,
          presence: user.presence
        };
      });
      
      logger.info(`Got online status for ${users.length} users`);
      return enhancedUsers;
      
    } catch (error) {
      logger.error('Failed to get active users with status:', error);
      throw error;
    }
  }
  
  async isBlocked(blockerId, blockedId) {
    try {
      const [blocker, blocked] = await Promise.all([
        UserQuery.getUserById(blockerId),
        UserQuery.getUserById(blockedId)
      ]);
      
      if (!blocker || !blocked) {
        return false;
      }
      
      if (blocker.userType !== 'DatingUser' || blocked.userType !== 'DatingUser') {
        return false;
      }
      
      const block = await UserBlock.findOne({
        blockerId,
        blockedId,
        expiresAt: { $gt: new Date() },
      });
      
      return !!block;
    } catch (error) {
      logger.error('Failed to check block status:', error);
      return false;
    }
  }
  
  async addContact(userId, contactId, options = {}) {
    try {
      const [user, contact] = await Promise.all([
        UserQuery.getUserById(userId),
        UserQuery.getUserById(contactId)
      ]);
      
      if (!user || !contact) {
        throw new Error('User or contact not found');
      }
      
      const existingContact = await UserContact.findOne({
        userId,
        contactId
      });
      
      if (existingContact) {
        return existingContact;
      }
      
      const newContact = await UserContact.create({
        userId,
        contactId,
        nickname: options.nickname,
        isFavorite: options.isFavorite || false,
        userType: contact.userType,
      });
      
      logger.info('Contact added', {
        userId,
        contactId,
        contactUserType: contact.userType
      });
      
      return newContact;
    } catch (error) {
      logger.error('Failed to add contact:', error);
      throw error;
    }
  }
  
  async getOnlineUsers(options = {}) {
    return await this.getActiveUsersWithStatus({ ...options, status: 'online' });
  }
  
  async getOnlineUsersByType(userType, limit = 50) {
    try {
      const redis = await redisClient.getClient();
      
      if (redis) {
        const typeKey = `${this.USER_PRESENCE_TYPE_KEY}:${userType}`;
        const userIds = await redis.zrevrange(typeKey, 0, limit - 1);
        
        if (userIds.length > 0) {
          const users = await BaseUser.find({
            _id: { $in: userIds }
          }).select('firstName lastName avatar userName userType');
          
          const statuses = await this.getOnlineStatuses(userIds.map(id => id.toString()));
          
          return users.map(user => ({
            userId: user._id,
            name: `${user.firstName} ${user.lastName}`,
            userName: user.userName,
            avatar: user.avatar,
            userType: user.userType,
            isOnline: true,
            status: statuses[user._id]?.status || 'online'
          }));
        }
      }
      
      return await this.getActiveUsersWithStatus({
        userType,
        status: 'online',
        limit
      });
    } catch (error) {
      logger.error('Failed to get online users by type:', error);
      return [];
    }
  }
  
  async cleanupStaleRedisStatuses() {
    try {
      const redis = await redisClient.getClient();
      if (!redis) return;
      
      const cutoff = Date.now() - this.ONLINE_THRESHOLD;
      
      const staleUserIds = await redis.zrangebyscore(
        this.USER_PRESENCE_KEY,
        '-inf',
        cutoff
      );
      
      if (staleUserIds.length > 0) {
        const multi = redis.multi();
        
        staleUserIds.forEach(userId => {
          multi.hset(this.ONLINE_STATUS_KEY, userId, JSON.stringify({
            status: 'offline',
            updatedAt: Date.now(),
            lastSeen: cutoff,
            userType: 'unknown'
          }));
        });
        
        multi.zremrangebyscore(this.USER_PRESENCE_KEY, '-inf', cutoff);
        
        const userTypes = ['DatingUser', 'Moderator', 'Admin', 'SuperAdmin'];
        userTypes.forEach(type => {
          const typeKey = `${this.USER_PRESENCE_TYPE_KEY}:${type}`;
          staleUserIds.forEach(userId => {
            multi.zrem(typeKey, userId);
          });
        });
        
        await multi.exec();
        logger.debug(`Cleaned up ${staleUserIds.length} stale Redis statuses`);
      }
    } catch (error) {
      logger.error('Failed to cleanup stale Redis statuses:', error);
    }
  }
  
  async getPresenceMetrics() {
    try {
      const redis = await redisClient.getClient();
      
      const metrics = {
        totalOnline: 0,
        byType: {},
        updatedAt: new Date().toISOString()
      };
      
      if (redis) {
        const cutoff = Date.now() - this.ONLINE_THRESHOLD;
        const onlineUserIds = await redis.zrangebyscore(
          this.USER_PRESENCE_KEY,
          cutoff,
          '+inf'
        );
        
        metrics.totalOnline = onlineUserIds.length;
        
        if (onlineUserIds.length > 0) {
          const statuses = await redis.hmget(
            this.ONLINE_STATUS_KEY,
            ...onlineUserIds
          );
          
          const typeCounts = {};
          statuses.forEach(statusJson => {
            if (statusJson) {
              try {
                const parsed = JSON.parse(statusJson);
                const userType = parsed.userType || 'unknown';
                typeCounts[userType] = (typeCounts[userType] || 0) + 1;
              } catch {
              }
            }
          });
          
          metrics.byType = typeCounts;
        }
      } else {
        const cutoff = new Date(Date.now() - this.ONLINE_THRESHOLD);
        const onlineUsers = await BaseUser.find({
          'presence.lastSeen': { $gt: cutoff },
          'presence.status': 'online',
          accountStatus: 'active'
        }).select('userType');
        
        metrics.totalOnline = onlineUsers.length;
        
        const typeCounts = {};
        onlineUsers.forEach(user => {
          const userType = user.userType || 'unknown';
          typeCounts[userType] = (typeCounts[userType] || 0) + 1;
        });
        
        metrics.byType = typeCounts;
      }
      
      return metrics;
    } catch (error) {
      logger.error('Failed to get presence metrics:', error);
      return {
        totalOnline: 0,
        byType: {},
        updatedAt: new Date().toISOString(),
        error: error.message
      };
    }
  }
  
  formatUserForResponse(user) {
    if (!user) return null;
    
    const baseUser = {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      avatar: user.avatar,
      accountStatus: user.accountStatus,
      role: user.role,
      userType: user.userType,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      lastLogin: user.lastLogin,
      presence: user.presence,
      notificationSettings: user.notificationSettings || {},
      privacySettings: user.privacySettings || {},
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
    
    if (user.userType === 'DatingUser') {
      baseUser.age = user.age;
      baseUser.userName = user.userName;
      baseUser.dateOfBirth = user.dateOfBirth;
      baseUser.preferences = user.preferences;
      baseUser.location = user.location;
      baseUser.sharePhone = user.sharePhone;
      baseUser.messagingPreferences = user.messagingPreferences;
    } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
      baseUser.employeeId = user.employeeId;
      baseUser.department = user.department;
      baseUser.permissions = user.permissions || [];
      baseUser.staffNotificationSettings = user.staffNotificationSettings || {};
    }
    
    return baseUser;
  }
}

module.exports = new UserService();