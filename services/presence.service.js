const { BaseUser, DatingUser, UserQuery } = require('@models/User');
const logger = require('@utils/logger');

class PresenceService {
  constructor(io, redisService) {
    this.io = io;
    this.redisService = redisService;
    this.onlineUsers = new Map(); // userId -> Set of socketIds
    this.heartbeatIntervals = new Map(); // socketId -> interval
    this.offlineTimeouts = new Map(); // userId -> timeout (for delayed offline marking)
    
    // Batch database updates
    this.pendingDbUpdates = new Map(); // userId -> lastSeen
    this.presenceCache = new Map(); // userId -> { data, timestamp }
    
    // Cache TTLs
    this.cacheTTL = 10000; // 10 seconds
    this.dbUpdateInterval = 30000; // 30 seconds
    
    // Setup Redis subscription with retry logic
    this.setupRedisSubscriptionWithRetry();
    
    // Start periodic tasks
    this.startPeriodicTasks();
    
    logger.info('✅ PresenceService initialized with optimizations');
  }
  
  // Setup Redis subscription with retry logic
  async setupRedisSubscriptionWithRetry() {
    if (!this.isRedisAvailable()) {
      logger.warn('Redis not available, skipping subscription setup');
      return;
    }
    
    let retries = 0;
    const maxRetries = 3;
    
    while (retries < maxRetries) {
      try {
        await this.setupRedisSubscription();
        logger.info('✅ Redis subscription setup successful');
        return;
      } catch (error) {
        retries++;
        logger.warn(`Redis subscription setup failed (attempt ${retries}/${maxRetries}):`, error.message);
        if (retries < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000 * retries));
        }
      }
    }
    
    logger.error('Failed to setup Redis subscription after multiple attempts');
  }
  
  // Setup Redis subscription
  async setupRedisSubscription() {
    if (!this.isRedisAvailable()) return;
    
    // Check if subscribe method exists
    if (!this.redisService.subscribe || typeof this.redisService.subscribe !== 'function') {
      throw new Error('RedisService.subscribe method not available');
    }
    
    await this.redisService.subscribe('presence:updates', (message) => {
      try {
        const parsed = typeof message === 'string' ? JSON.parse(message) : message;
        if (parsed.type === 'user_online' && parsed.userId) {
          this.handleRemoteUserOnline(parsed.userId, parsed.data);
        } else if (parsed.type === 'user_offline' && parsed.userId) {
          this.handleRemoteUserOffline(parsed.userId);
        }
      } catch (error) {
        logger.error('Error handling Redis presence message:', error);
      }
    });
  }
  
  // Start periodic tasks
  startPeriodicTasks() {
    // Cleanup stale presence every minute
    setInterval(() => this.cleanupStalePresence(), 60000);
    
    // Flush database updates every 30 seconds
    setInterval(() => this.flushDbUpdates(), this.dbUpdateInterval);
    
    // Clear expired cache entries every minute
    setInterval(() => this.clearExpiredCache(), 60000);
  }
  
  // Check if Redis is available
  isRedisAvailable() {
    return this.redisService && 
           typeof this.redisService.isReady === "function" && 
           this.redisService.isReady();
  }
  
  // User connects via WebSocket
  async userConnected(userId, socketId, userData = {}) {
    try {
      // Clear any pending offline timeout
      if (this.offlineTimeouts.has(userId)) {
        clearTimeout(this.offlineTimeouts.get(userId));
        this.offlineTimeouts.delete(userId);
      }
      
      // Check user exists and is active
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
      if (this.isRedisAvailable() && this.redisService.canUserConnect) {
        const canConnect = await this.redisService.canUserConnect(userId, 5); // Max 5 connections
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
        await this.markUserOnline(userId, user, userData);
        logger.info(`User ${userId} (${user.userType}) came online (socket: ${socketId})`);
      } else {
        logger.debug(`User ${userId} added socket ${socketId}, total sockets: ${userSockets.size}`);
      }
      
      // Setup heartbeat for this socket
      this.setupHeartbeat(userId, socketId);
      
      // Clear cache for this user
      this.presenceCache.delete(userId);
      
      return true;
    } catch (error) {
      logger.error('User connected error:', error);
      return false;
    }
  }
  
  // Add socket to existing user (for multi-device)
  async addSocketToUser(userId, socketId) {
    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, new Set());
    }
    this.onlineUsers.get(userId).add(socketId);
    
    // Setup heartbeat for new socket
    this.setupHeartbeat(userId, socketId);
    
    // Update Redis if available
    if (this.isRedisAvailable() && this.redisService.addSocketToUser) {
      await this.redisService.addSocketToUser(userId, socketId);
    }
    
    logger.debug(`Added socket ${socketId} to user ${userId}`);
    return true;
  }
  
  // Mark user online in database and Redis
  async markUserOnline(userId, user, userData = {}) {
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
    
    // Update database immediately for status change
    await this.updateUserStatusInDatabase(userId, 'online');
    
    // Update Redis if available
    if (this.isRedisAvailable()) {
      await this.updateUserInRedis(userId, user, userData);
    }
    
    // Broadcast online status
    this.broadcastUserStatus(userId, 'online', user);
  }
  
  // Update user in Redis
  async updateUserInRedis(userId, user, userData = {}) {
    if (!this.isRedisAvailable()) return;
    
    try {
      // Set user online in Redis
      if (this.redisService.setUserOnline) {
        await this.redisService.setUserOnline(userId, Array.from(this.onlineUsers.get(userId) || []), {
          userName: user.userName || `${user.firstName} ${user.lastName}`,
          avatar: user.avatar || '',
          userType: user.userType || 'unknown',
          role: user.role || 'user',
          lastSeen: new Date().toISOString(),
          ...userData
        });
      }
      
      // Broadcast to other instances
      if (this.redisService.publish) {
        await this.redisService.publish('presence:updates', JSON.stringify({
          type: 'user_online',
          userId,
          data: {
            userName: user.userName,
            userType: user.userType,
            timestamp: new Date().toISOString()
          }
        }));
      }
    } catch (error) {
      logger.error('Redis update error:', error);
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
      
      // If no more sockets, schedule offline check
      if (userSockets.size === 0) {
        this.onlineUsers.delete(userId);
        
        // Schedule offline marking with delay to prevent flickering
        const timeoutId = setTimeout(async () => {
          // Check again if user reconnected during delay
          if (!this.onlineUsers.has(userId) || this.onlineUsers.get(userId).size === 0) {
            await this.markUserOffline(userId);
          }
        }, 5000); // 5 second delay
        
        this.offlineTimeouts.set(userId, timeoutId);
      } else {
        // User still has other sockets, just remove this one from Redis
        if (this.isRedisAvailable() && this.redisService.removeSocketFromUser) {
          await this.redisService.removeSocketFromUser(userId, socketId);
        }
      }
      
      // Clear cache for this user
      this.presenceCache.delete(userId);
      
      return true;
    } catch (error) {
      logger.error('User disconnected error:', error);
      return false;
    }
  }
  
  // Remove socket from user (for multi-device)
  async removeSocketFromUser(userId, socketId) {
    if (!this.onlineUsers.has(userId)) return true;
    
    const userSockets = this.onlineUsers.get(userId);
    userSockets.delete(socketId);
    
    // Clear heartbeat
    this.clearHeartbeat(socketId);
    
    // Update Redis
    if (this.isRedisAvailable() && this.redisService.removeSocketFromUser) {
      await this.redisService.removeSocketFromUser(userId, socketId);
    }
    
    logger.debug(`Removed socket ${socketId} from user ${userId}`);
    return true;
  }
  
  // Mark user offline
  async markUserOffline(userId) {
    try {
      const user = await UserQuery.getUserById(userId);
      if (!user) return false;
      
      // Update database
      await this.updateUserStatusInDatabase(userId, 'offline');
      
      // Update Redis if available
      if (this.isRedisAvailable() && this.redisService.setUserOffline) {
        await this.redisService.setUserOffline(userId);
        
        // Broadcast to other instances
        if (this.redisService.publish) {
          await this.redisService.publish('presence:updates', JSON.stringify({
            type: 'user_offline',
            userId,
            timestamp: new Date().toISOString()
          }));
        }
      }
      
      logger.info(`User ${userId} (${user.userType}) went offline`);
      
      // Broadcast offline status
      this.broadcastUserStatus(userId, 'offline', user);
      
      return true;
    } catch (error) {
      logger.error('Mark user offline error:', error);
      return false;
    }
  }
  
  // Update user status in database
  async updateUserStatusInDatabase(userId, status) {
    try {
      const updateData = {
        'presence.status': status,
        'presence.lastSeen': new Date()
      };
      
      if (status === 'offline') {
        updateData['presence.lastActive'] = new Date();
      }
      
      await BaseUser.findByIdAndUpdate(
        userId,
        { $set: updateData },
        { new: true, runValidators: false }
      );
      
      return true;
    } catch (error) {
      logger.error('Database status update error:', error);
      return false;
    }
  }
  
  // Setup heartbeat for a socket (Redis only, no database writes)
  setupHeartbeat(userId, socketId) {
    const intervalId = setInterval(async () => {
      try {
        // Update Redis only (fast)
        if (this.isRedisAvailable() && this.redisService.refreshUserHeartbeat) {
          await this.redisService.refreshUserHeartbeat(userId);
        }
        
        // Update local tracking
        this.pendingDbUpdates.set(userId, new Date());
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
  
  // Flush batched database updates
  async flushDbUpdates() {
    if (this.pendingDbUpdates.size === 0) return;
    
    const updates = Array.from(this.pendingDbUpdates.entries());
    this.pendingDbUpdates.clear();
    
    // Batch update lastSeen timestamps
    for (const [userId, lastSeen] of updates) {
      try {
        await BaseUser.findByIdAndUpdate(
          userId,
          { $set: { 'presence.lastSeen': lastSeen } },
          { runValidators: false }
        );
      } catch (error) {
        logger.error('Batch update error for user', userId, error.message);
      }
    }
    
    logger.debug(`Flushed ${updates.length} batched presence updates`);
  }
  
  // Handle user online from another instance
  async handleRemoteUserOnline(userId, data) {
    // Just broadcast, don't update local tracking
    this.broadcastUserStatus(userId, 'online');
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
  
  // Get cached presence (reduces database/Redis calls)
  async getCachedPresence(userId) {
    const cached = this.presenceCache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    
    const presence = await this.getUserPresence(userId);
    this.presenceCache.set(userId, {
      data: presence,
      timestamp: Date.now()
    });
    
    return presence;
  }
  
  // Get user presence with caching
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
  
  // Check if users are online (optimized for dating app)
  async areUsersOnline(userIds) {
    try {
      const result = {};
      
      for (const userId of userIds) {
        // Check local connections first (fastest)
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
            const lastSeen = new Date(presence.lastSeen);
            const fiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000));
            result[userId] = lastSeen > fiveMinutesAgo && presence.status === 'online';
            continue;
          }
        }
        
        // Check cache
        const cached = this.presenceCache.get(userId);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
          result[userId] = cached.data.isOnline;
          continue;
        }
        
        // Fallback to database (slowest)
        const presence = await this.getUserPresence(userId);
        result[userId] = presence.isOnline;
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
  
  // Get online users (optimized for dating app)
  async getOnlineUsers(limit = 100, offset = 0, userType = 'all') {
    try {
      // Try Redis first (fastest)
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
        .select('_id firstName lastName avatar userName userType role presence location')
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
        customStatus: user.presence?.customStatus,
        location: user.location
      }));
      
    } catch (error) {
      logger.error('Get online users error:', error);
      return [];
    }
  }
  
  // Get nearby online users (for dating app matching)
  async getNearbyOnlineUsers(userId, radiusKm = 10, limit = 50) {
    try {
      // Get user's location
      const user = await UserQuery.getUserById(userId);
      if (!user?.location?.coordinates) return [];
      
      // Get online users first
      const onlineUsers = await this.getOnlineUsers(200, 0, 'dating');
      const onlineUserIds = onlineUsers.map(u => u.userId);
      
      if (onlineUserIds.length === 0) return [];
      
      // Query database for nearby online users
      const nearbyUsers = await DatingUser.find({
        _id: { $in: onlineUserIds },
        'location.coordinates': {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: user.location.coordinates
            },
            $maxDistance: radiusKm * 1000
          }
        },
        accountStatus: 'active'
      })
      .select('_id firstName lastName avatar userName age bio interests location presence')
      .limit(limit);
      
      return nearbyUsers.map(user => ({
        userId: user._id.toString(),
        name: `${user.firstName} ${user.lastName}`,
        age: user.age,
        avatar: user.avatar,
        userName: user.userName,
        bio: user.bio,
        interests: user.interests,
        location: user.location,
        lastSeen: user.presence?.lastSeen,
        isOnline: true
      }));
    } catch (error) {
      logger.error('Get nearby online users error:', error);
      return [];
    }
  }
  
  // Refresh user heartbeat
  async refreshUserHeartbeat(userId) {
    try {
      // Update Redis if available
      if (this.isRedisAvailable() && this.redisService.refreshUserHeartbeat) {
        await this.redisService.refreshUserHeartbeat(userId);
      }
      
      // Batch database update
      this.pendingDbUpdates.set(userId, new Date());
      
      return true;
    } catch (error) {
      logger.error('Refresh user heartbeat error:', error);
      return false;
    }
  }
  
  // Update user status manually
  async updateUserStatus(userId, status, customStatus = '') {
    try {
      await this.updateUserStatusInDatabase(userId, status);
      
      // Update Redis if available
      if (this.isRedisAvailable() && this.redisService.updateUserStatus) {
        await this.redisService.updateUserStatus(userId, status, customStatus);
      }
      
      // Get user for broadcasting
      const user = await UserQuery.getUserById(userId);
      if (user) {
        this.broadcastUserStatus(userId, status, user);
      }
      
      // Clear cache
      this.presenceCache.delete(userId);
      
      logger.info(`User ${userId} status updated to ${status}`);
      return true;
    } catch (error) {
      logger.error('Update user status error:', error);
      return false;
    }
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
    
    // Broadcast to everyone
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
        
        // Check if they're actually connected locally
        if (!this.onlineUsers.has(userId) || this.onlineUsers.get(userId).size === 0) {
          await this.markUserOffline(userId);
          logger.info(`Cleaned up stale presence for user ${userId} (${user.userType})`);
        }
      }
    } catch (error) {
      logger.error('Cleanup stale presence error:', error);
    }
  }
  
  // Clear expired cache entries
  clearExpiredCache() {
    const now = Date.now();
    for (const [userId, cache] of this.presenceCache.entries()) {
      if (now - cache.timestamp > this.cacheTTL) {
        this.presenceCache.delete(userId);
      }
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
  
  // Get metrics
  getMetrics() {
    let totalConnections = 0;
    for (const sockets of this.onlineUsers.values()) {
      totalConnections += sockets.size;
    }
    
    return {
      onlineUsers: this.onlineUsers.size,
      totalConnections,
      heartbeatIntervals: this.heartbeatIntervals.size,
      offlineTimeouts: this.offlineTimeouts.size,
      pendingDbUpdates: this.pendingDbUpdates.size,
      cacheSize: this.presenceCache.size,
      redisAvailable: this.isRedisAvailable()
    };
  }
  
  // Cleanup
  async cleanup() {
    // Clear all intervals and timeouts
    for (const intervalId of this.heartbeatIntervals.values()) {
      clearInterval(intervalId);
    }
    
    for (const timeoutId of this.offlineTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    
    this.heartbeatIntervals.clear();
    this.offlineTimeouts.clear();
    this.pendingDbUpdates.clear();
    this.presenceCache.clear();
    
    // Flush any remaining database updates
    await this.flushDbUpdates();
    
    logger.info('PresenceService cleaned up');
  }
}

module.exports = PresenceService;