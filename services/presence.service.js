const { BaseUser, DatingUser, UserQuery } = require('@models/User');
const logger = require('@utils/logger');

class PresenceService {
  constructor(io, redisService) {
    this.io = io;
    this.redisService = redisService;
    this.onlineUsers = new Map(); // userId -> socketId[]
    this.heartbeatIntervals = new Map();
    
    // Setup Redis subscription for presence updates - WITH DEFENSIVE CHECK
    if (this.redisService && typeof this.redisService.isReady === "function" && this.redisService.isReady()) {
      this.setupRedisSubscription();
    } else {
      logger.warn('RedisService not ready or missing isReady method, Redis subscription skipped');
    }
    
    // Cleanup stale entries every minute
    setInterval(() => this.cleanupStalePresence(), 60000);
    
    logger.info('✅ PresenceService initialized with discriminator support');
  }
  
  // Helper method to check if Redis is available
  isRedisAvailable() {
    return this.redisService && 
           typeof this.redisService.isReady === "function" && 
           this.redisService.isReady();
  }
  
  // Setup Redis subscription for cross-instance presence updates
  setupRedisSubscription() {
    // Check if subscribe method exists
    if (!this.redisService.subscribe || typeof this.redisService.subscribe !== 'function') {
      logger.warn('RedisService.subscribe method not available');
      return;
    }
    
    this.redisService.subscribe('presence:updates', (message) => {
      try {
        if (message.type === 'user_online' && message.userId) {
          // Another instance marked user online
          this.handleRemoteUserOnline(message.userId, message.data);
        } else if (message.type === 'user_offline' && message.userId) {
          // Another instance marked user offline
          this.handleRemoteUserOffline(message.userId);
        }
      } catch (error) {
        logger.error('Error handling Redis presence message:', error);
      }
    });
  }
  
  // User connects via WebSocket
  async userConnected(userId, socketId, userData = {}) {
    try {
      // Use UserQuery to get user with discriminator data
      const user = await UserQuery.getUserById(userId);
      if (!user) {
        logger.warn(`User ${userId} not found for connection`);
        return false;
      }
      
      if (user.accountStatus !== 'active') {
        logger.warn(`User ${userId} is not active, account status: ${user.accountStatus}`);
        return false;
      }
      
      // Check connection limit if Redis available
      let canConnect = true;
      if (this.isRedisAvailable() && this.redisService.canUserConnect) {
        canConnect = await this.redisService.canUserConnect(userId, 3);
        if (!canConnect) {
          logger.warn(`User ${userId} exceeded connection limit`);
          return false;
        }
      }
      
      // Track socket connection
      if (!this.onlineUsers.has(userId)) {
        this.onlineUsers.set(userId, new Set());
      }
      const userSockets = this.onlineUsers.get(userId);
      userSockets.add(socketId);
      
      // Update presence if first connection
      if (userSockets.size === 1) {
        // Initialize presence if not exists
        if (!user.presence) {
          user.presence = {
            status: 'offline',
            lastSeen: new Date(),
            lastActive: new Date(),
            customStatus: null
          };
        }
        
        // Update presence data
        user.presence.status = 'online';
        user.presence.lastSeen = new Date();
        user.presence.lastActive = new Date();
        user.presence.socketId = socketId;
        
        // Save using the appropriate model
        await this.saveUserPresence(userId, user);
        
        // Update Redis if available
        if (this.isRedisAvailable() && this.redisService.setUserOnline) {
          await this.redisService.setUserOnline(userId, socketId, {
            userName: user.userName || `${user.firstName} ${user.lastName}`,
            avatar: user.avatar || '',
            userType: user.userType || 'unknown',
            role: user.role || 'user',
            ...userData
          });
          
          // Broadcast to other instances via Redis
          if (this.redisService.publish) {
            await this.redisService.publish('presence:updates', {
              type: 'user_online',
              userId,
              data: {
                userName: user.userName,
                userType: user.userType,
                socketId,
                timestamp: new Date().toISOString()
              }
            });
          }
        }
        
        logger.info(`User ${userId} (${user.userType}) came online (socket: ${socketId})`);
        
        // Broadcast online status to all connected clients
        this.broadcastUserStatus(userId, 'online', user);
      }
      
      // Setup heartbeat for this socket
      this.setupHeartbeat(userId, socketId);
      
      return true;
    } catch (error) {
      logger.error('User connected error:', error);
      return false;
    }
  }
  
  // Helper method to save user presence based on user type
  async saveUserPresence(userId, user) {
    try {
      const presenceData = {
        'presence.status': user.presence.status,
        'presence.lastSeen': user.presence.lastSeen,
        'presence.lastActive': user.presence.lastActive,
        'presence.socketId': user.presence.socketId
      };
      
      if (user.presence.customStatus !== undefined) {
        presenceData['presence.customStatus'] = user.presence.customStatus;
      }
      
      // Save using BaseUser for all user types
      await BaseUser.findByIdAndUpdate(
        userId,
        { $set: presenceData },
        { new: true, runValidators: false }
      );
      
    } catch (error) {
      logger.error('Failed to save user presence:', error);
      throw error;
    }
  }
  
  // User disconnects from WebSocket
  async userDisconnected(userId, socketId) {
    try {
      if (!this.onlineUsers.has(userId)) return true;
      
      const userSockets = this.onlineUsers.get(userId);
      userSockets.delete(socketId);
      
      // Clear heartbeat
      this.clearHeartbeat(socketId);
      
      // If no more sockets, mark user as offline
      if (userSockets.size === 0) {
        this.onlineUsers.delete(userId);
        
        const user = await UserQuery.getUserById(userId);
        if (user) {
          // Add delay to prevent flickering on reconnection
          setTimeout(async () => {
            // Check if user reconnected during delay
            if (!this.onlineUsers.has(userId)) {
              // Update presence data
              if (!user.presence) {
                user.presence = {
                  status: 'offline',
                  lastSeen: new Date(),
                  lastActive: new Date()
                };
              }
              
              user.presence.status = 'offline';
              user.presence.lastSeen = new Date();
              
              // Save presence
              await this.saveUserPresence(userId, user);
              
              // Update Redis if available
              if (this.isRedisAvailable() && this.redisService.setUserOffline) {
                await this.redisService.setUserOffline(userId);
                
                // Broadcast to other instances
                if (this.redisService.publish) {
                  await this.redisService.publish('presence:updates', {
                    type: 'user_offline',
                    userId,
                    timestamp: new Date().toISOString()
                  });
                }
              }
              
              logger.info(`User ${userId} (${user.userType}) went offline`);
              
              // Broadcast offline status
              this.broadcastUserStatus(userId, 'offline');
            }
          }, 5000); // 5 second delay
        }
      }
      
      return true;
    } catch (error) {
      logger.error('User disconnected error:', error);
      return false;
    }
  }
  
  // Handle user online from another instance
  async handleRemoteUserOnline(userId, data) {
    // Update local tracking if needed
    if (!this.onlineUsers.has(userId)) {
      // User is online on another instance
      // We can update local state but don't have socket info
      this.broadcastUserStatus(userId, 'online');
    }
  }
  
  // Handle user offline from another instance
  async handleRemoteUserOffline(userId) {
    // Remove from local tracking if we don't have active sockets
    if (this.onlineUsers.has(userId)) {
      const userSockets = this.onlineUsers.get(userId);
      if (userSockets.size === 0) {
        this.onlineUsers.delete(userId);
      }
    }
    
    this.broadcastUserStatus(userId, 'offline');
  }
  
  // Setup heartbeat for a socket
  setupHeartbeat(userId, socketId) {
    const intervalId = setInterval(async () => {
      try {
        const user = await UserQuery.getUserById(userId);
        if (user && this.onlineUsers.has(userId)) {
          // Initialize presence if not exists
          if (!user.presence) {
            user.presence = {
              status: 'online',
              lastSeen: new Date(),
              lastActive: new Date()
            };
          }
          
          // Update last seen
          user.presence.lastSeen = new Date();
          user.presence.lastActive = new Date();
          
          // Save presence
          await this.saveUserPresence(userId, user);
          
          // Update heartbeat in Redis if available
          if (this.isRedisAvailable() && this.redisService.refreshUserHeartbeat) {
            await this.redisService.refreshUserHeartbeat(userId);
          }
        }
      } catch (error) {
        logger.error('Heartbeat error:', error);
      }
    }, 30000); // Every 30 seconds
    
    this.heartbeatIntervals.set(socketId, intervalId);
  }
  
  // Clear heartbeat
  clearHeartbeat(socketId) {
    if (this.heartbeatIntervals.has(socketId)) {
      clearInterval(this.heartbeatIntervals.get(socketId));
      this.heartbeatIntervals.delete(socketId);
    }
  }
  
  // Get online users
  async getOnlineUsers(limit = 100, offset = 0, userType = 'all') {
    try {
      // Try RedisService first (fastest)
      if (this.isRedisAvailable() && this.redisService.getOnlineUsers) {
        const redisUsers = await this.redisService.getOnlineUsers(limit, offset, userType);
        if (redisUsers && redisUsers.length > 0) {
          return redisUsers;
        }
      }
      
      // Build query for database fallback
      const fiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000));
      const query = {
        'presence.lastSeen': { $gt: fiveMinutesAgo },
        'presence.status': 'online',
        accountStatus: 'active'
      };
      
      // Add user type filter
      if (userType !== 'all') {
        if (userType === 'dating') {
          query.userType = 'DatingUser';
        } else if (userType === 'staff') {
          query.userType = { $in: ['Moderator', 'Admin', 'SuperAdmin'] };
        } else {
          query.userType = userType;
        }
      }
      
      // Fallback to database
      const users = await BaseUser.find(query)
        .select('_id firstName lastName avatar userName userType role presence')
        .limit(limit)
        .skip(offset)
        .sort({ 'presence.lastSeen': -1 });
      
      return users.map(user => ({
        userId: user._id.toString(),
        name: `${user.firstName} ${user.lastName}`,
        avatar: user.avatar,
        userName: user.userName,
        userType: user.userType,
        role: user.role,
        lastSeen: user.presence?.lastSeen,
        status: user.presence?.status || 'offline',
        customStatus: user.presence?.customStatus
      }));
      
    } catch (error) {
      logger.error('Get online users error:', error);
      return [];
    }
  }
  
  // Get online users by user type
  async getOnlineUsersByType(userType, limit = 100, offset = 0) {
    return this.getOnlineUsers(limit, offset, userType);
  }
  
  // Check if users are online
  async areUsersOnline(userIds) {
    try {
      const result = {};
      
      for (const userId of userIds) {
        // Check WebSocket connections first (most accurate)
        const isConnected = this.onlineUsers.has(userId) && 
                          this.onlineUsers.get(userId).size > 0;
        
        if (isConnected) {
          result[userId] = true;
          continue;
        }
        
        // Check Redis
        if (this.isRedisAvailable() && this.redisService.getUserPresence) {
          const presence = await this.redisService.getUserPresence(userId);
          if (presence) {
            // Consider online if seen within last 5 minutes
            const lastSeen = new Date(presence.lastSeen);
            const fiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000));
            result[userId] = lastSeen > fiveMinutesAgo && presence.status === 'online';
            continue;
          }
        }
        
        // Fallback to database with UserQuery
        const user = await UserQuery.getUserById(userId);
        if (user && user.presence) {
          const fiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000));
          result[userId] = new Date(user.presence.lastSeen) > fiveMinutesAgo && 
                          user.presence.status === 'online';
        } else {
          result[userId] = false;
        }
      }
      
      return result;
    } catch (error) {
      logger.error('Are users online error:', error);
      return userIds.reduce((acc, userId) => {
        acc[userId] = false;
        return acc;
      }, {});
    }
  }
  
  // Get user presence with user type information
  async getUserPresence(userId) {
    try {
      // Check local WebSocket connections first
      const isConnected = this.onlineUsers.has(userId) && 
                        this.onlineUsers.get(userId).size > 0;
      
      if (isConnected) {
        const user = await UserQuery.getUserById(userId);
        if (user) {
          return {
            userId,
            isOnline: true,
            status: user.presence?.status || 'online',
            customStatus: user.presence?.customStatus,
            lastSeen: user.presence?.lastSeen || new Date(),
            userType: user.userType,
            role: user.role
          };
        }
      }
      
      // Check Redis
      if (this.isRedisAvailable() && this.redisService.getUserPresence) {
        const presence = await this.redisService.getUserPresence(userId);
        if (presence) {
          const fiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000));
          const lastSeen = new Date(presence.lastSeen);
          const isOnline = lastSeen > fiveMinutesAgo && presence.status === 'online';
          
          return {
            userId,
            isOnline,
            status: presence.status,
            customStatus: presence.customStatus,
            lastSeen: presence.lastSeen,
            userType: presence.userType || 'unknown',
            role: presence.role || 'user'
          };
        }
      }
      
      // Fallback to database
      const user = await UserQuery.getUserById(userId);
      if (!user) {
        return {
          userId,
          isOnline: false,
          status: 'offline',
          userType: 'unknown',
          lastSeen: null
        };
      }
      
      const fiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000));
      const lastSeen = user.presence?.lastSeen || new Date(0);
      const isOnline = new Date(lastSeen) > fiveMinutesAgo && 
                      user.presence?.status === 'online';
      
      return {
        userId,
        isOnline,
        status: user.presence?.status || 'offline',
        customStatus: user.presence?.customStatus,
        lastSeen: lastSeen,
        userType: user.userType,
        role: user.role
      };
      
    } catch (error) {
      logger.error('Get user presence error:', error);
      return {
        userId,
        isOnline: false,
        status: 'offline',
        userType: 'unknown',
        lastSeen: null
      };
    }
  }
  
  // Update user status manually
  async updateUserStatus(userId, status, customStatus = '') {
    try {
      const user = await UserQuery.getUserById(userId);
      if (!user) return false;
      
      // Initialize presence if not exists
      if (!user.presence) {
        user.presence = {
          status: 'offline',
          lastSeen: new Date(),
          lastActive: new Date(),
          customStatus: null
        };
      }
      
      // Update presence data
      user.presence.status = status;
      user.presence.lastSeen = new Date();
      user.presence.lastActive = new Date();
      
      if (customStatus) {
        user.presence.customStatus = customStatus;
      }
      
      // Save using BaseUser
      await this.saveUserPresence(userId, user);
      
      // Update Redis if available
      if (this.isRedisAvailable() && this.redisService.updateUserStatus) {
        await this.redisService.updateUserStatus(userId, status, customStatus, user.userType);
      }
      
      // Broadcast status change
      this.broadcastUserStatus(userId, status, user);
      
      logger.info(`User ${userId} (${user.userType}) status updated to ${status}`);
      return true;
    } catch (error) {
      logger.error('Update user status error:', error);
      return false;
    }
  }
  
  // Refresh user heartbeat
  async refreshUserHeartbeat(userId) {
    try {
      const user = await UserQuery.getUserById(userId);
      if (!user) return false;
      
      // Initialize presence if not exists
      if (!user.presence) {
        user.presence = {
          status: 'online',
          lastSeen: new Date(),
          lastActive: new Date()
        };
      }
      
      // Update last seen
      user.presence.lastSeen = new Date();
      user.presence.lastActive = new Date();
      
      // Save presence
      await this.saveUserPresence(userId, user);
      
      // Update Redis if available
      if (this.isRedisAvailable() && this.redisService.refreshUserHeartbeat) {
        await this.redisService.refreshUserHeartbeat(userId);
      }
      
      return true;
    } catch (error) {
      logger.error('Refresh user heartbeat error:', error);
      return false;
    }
  }
  
  // Set user offline
  async setUserOffline(userId) {
    return await this.updateUserStatus(userId, 'offline');
  }
  
  // Broadcast user status change
  broadcastUserStatus(userId, status, user = null) {
    if (!this.io) return;
    
    const data = {
      userId,
      status,
      timestamp: new Date().toISOString()
    };
    
    if (user) {
      data.userName = user.userName || `${user.firstName} ${user.lastName}`;
      data.avatar = user.avatar;
      data.userType = user.userType;
      data.role = user.role;
      data.customStatus = user.presence?.customStatus;
    }
    
    this.io.emit('presence:update', data);
    
    // Also emit to user's room
    this.io.to(`user:${userId}`).emit('presence:user_update', data);
  }
  
  // Cleanup stale presence entries
  async cleanupStalePresence() {
    try {
      const fifteenMinutesAgo = new Date(Date.now() - (15 * 60 * 1000));
      
      // Find users who should be marked offline in database
      const staleUsers = await BaseUser.find({
        'presence.status': 'online',
        'presence.lastSeen': { $lt: fifteenMinutesAgo },
        accountStatus: 'active'
      }).select('_id presence userType');
      
      for (const user of staleUsers) {
        const userId = user._id.toString();
        
        // Check if they're actually connected via WebSocket
        if (!this.onlineUsers.has(userId) || this.onlineUsers.get(userId).size === 0) {
          // Update presence data
          const updateData = {
            'presence.status': 'offline',
            'presence.lastSeen': new Date()
          };
          
          // Update database
          await BaseUser.findByIdAndUpdate(userId, { $set: updateData });
          
          // Update Redis if available
          if (this.isRedisAvailable() && this.redisService.setUserOffline) {
            await this.redisService.setUserOffline(userId);
          }
          
          logger.info(`Cleaned up stale presence for user ${userId} (${user.userType})`);
          
          // Broadcast offline status
          this.broadcastUserStatus(userId, 'offline', user);
        }
      }
      
    } catch (error) {
      logger.error('Cleanup stale presence error:', error);
    }
  }
  
  // Get user's current socket connections
  getUserConnections(userId) {
    if (!this.onlineUsers.has(userId)) return [];
    return Array.from(this.onlineUsers.get(userId));
  }
  
  // Check if user is connected to this instance
  isUserConnected(userId) {
    return this.onlineUsers.has(userId) && this.onlineUsers.get(userId).size > 0;
  }
  
  // Emit event to user
  emitToUser(userId, event, data) {
    if (!this.io) return;
    
    this.io.to(`user:${userId}`).emit(event, data);
  }
  
  // Emit to specific socket
  emitToSocket(socketId, event, data) {
    if (!this.io) return;
    
    this.io.to(socketId).emit(event, data);
  }
  
  // Broadcast to all online users
  broadcast(event, data, excludeUserId = null) {
    if (!this.io) return;
    
    if (excludeUserId) {
      this.io.except(`user:${excludeUserId}`).emit(event, data);
    } else {
      this.io.emit(event, data);
    }
  }
  
  // Get metrics with user type breakdown
  getMetrics() {
    const metrics = {
      onlineUsers: this.onlineUsers.size,
      totalConnections: Array.from(this.onlineUsers.values())
        .reduce((total, sockets) => total + sockets.size, 0),
      heartbeatIntervals: this.heartbeatIntervals.size,
      redisReady: this.isRedisAvailable(),
      userTypes: {}
    };
    
    // Count online users by type (this would be more accurate with Redis)
    // For now, we just track the counts
    return metrics;
  }
  
  // Get presence metrics with user type breakdown
  async getPresenceMetrics() {
    try {
      const fifteenMinutesAgo = new Date(Date.now() - (15 * 60 * 1000));
      
      // Get online users by type from database
      const onlineUsersByType = await BaseUser.aggregate([
        {
          $match: {
            'presence.status': 'online',
            'presence.lastSeen': { $gt: fifteenMinutesAgo },
            accountStatus: 'active'
          }
        },
        {
          $group: {
            _id: '$userType',
            count: { $sum: 1 }
          }
        }
      ]);
      
      // Format the results
      const byType = {};
      onlineUsersByType.forEach(result => {
        byType[result._id || 'unknown'] = result.count;
      });
      
      return {
        totalOnline: onlineUsersByType.reduce((sum, result) => sum + result.count, 0),
        byType,
        updatedAt: new Date().toISOString()
      };
      
    } catch (error) {
      logger.error('Get presence metrics error:', error);
      return {
        totalOnline: 0,
        byType: {},
        updatedAt: new Date().toISOString(),
        error: error.message
      };
    }
  }
  
  // Cleanup
  async cleanup() {
    // Clear all intervals
    for (const [socketId, intervalId] of this.heartbeatIntervals.entries()) {
      clearInterval(intervalId);
    }
    this.heartbeatIntervals.clear();
    
    logger.info('PresenceService cleaned up');
  }
}

module.exports = PresenceService;