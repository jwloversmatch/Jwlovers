const { BaseUser, DatingUser, UserQuery } = require("@models/User");
const logger = require("@utils/logger");

class PresenceService {
  constructor(io, redisService) {
    // FIX: Make io optional — will be injected via setIo() if not provided
    // This allows ServiceInitializer to create PresenceService before io exists
    if (!io || typeof io.emit !== 'function') {
      if (io !== null && io !== undefined) {
        logger.warn('⚠️  PresenceService: io parameter is invalid, will be injected later via setIo()');
      }
      // Create a mock io object to prevent crashes until real io is injected
      io = {
        emit: () => { logger.debug('Socket.IO not yet initialized, buffering emit'); },
        to: () => ({ emit: () => { logger.debug('Socket.IO not yet initialized, buffering emit to room'); } })
      };
      this._ioInjected = false;
    } else {
      this._ioInjected = true;
      logger.info('✅ PresenceService created with valid Socket.IO instance');
    }
    
    this.io = io;
    this.redisService = redisService;
    this.onlineUsers = new Map();
    this.heartbeatIntervals = new Map();
    this.offlineTimeouts = new Map();

    // Batch database updates
    this.pendingDbUpdates = new Map();
    this.presenceCache = new Map();

    // Cache TTLs
    this.cacheTTL = 10000;
    this.dbUpdateInterval = 30000;

    // Bind all methods
    this.broadcastUserStatus = this.broadcastUserStatus.bind(this);
    this.markUserOffline = this.markUserOffline.bind(this);
    this.userDisconnected = this.userDisconnected.bind(this);
    this.markUserOnline = this.markUserOnline.bind(this);
    this.handleRemoteUserOnline = this.handleRemoteUserOnline.bind(this);
    this.handleRemoteUserOffline = this.handleRemoteUserOffline.bind(this);
    this.cleanupStalePresence = this.cleanupStalePresence.bind(this);
    this.flushDbUpdates = this.flushDbUpdates.bind(this);
    this.clearExpiredCache = this.clearExpiredCache.bind(this);
    this.cleanup = this.cleanup.bind(this);
    this.startPeriodicTasks = this.startPeriodicTasks.bind(this);
    this.setupRedisSubscriptionWithRetry = this.setupRedisSubscriptionWithRetry.bind(this);
    this.setupRedisSubscription = this.setupRedisSubscription.bind(this);
    this.userConnected = this.userConnected.bind(this);
    this.setIo = this.setIo.bind(this);

    // Setup Redis subscription with retry logic
    this.setupRedisSubscriptionWithRetry();

    // Start periodic tasks
    this.startPeriodicTasks();

    logger.info("✅ PresenceService initialized");
  }

  // ========== IO INJECTION (added for compatibility with lazy initialization) ==========
  
  setIo(io) {
    if (!io || typeof io.emit !== 'function') {
      logger.warn('⚠️  PresenceService.setIo called with invalid io instance');
      return;
    }
    
    this.io = io;
    this._ioInjected = true;
    logger.info('✅ Socket.IO instance injected into PresenceService via setIo()');
  }

  // Broadcast user status change
  broadcastUserStatus(userId, status, user = null) {
    // FIX: Check if io is injected before trying to broadcast
    if (!this._ioInjected || !this.io || typeof this.io.emit !== 'function') {
      logger.debug(`Cannot broadcast status: Socket.IO not yet injected (userId: ${userId}, status: ${status})`);
      return;
    }

    try {
      const data = {
        userId,
        status,
        timestamp: new Date().toISOString(),
      };

      if (user) {
        data.userName = user.userName || `${user.firstName} ${user.lastName}`;
        data.avatar = user.avatar;
        data.userType = user.userType;
        data.role = user.role;
        data.customStatus = user.presence?.customStatus;
      }

      // Broadcast to everyone
      this.io.emit("presence:update", data);

      // Also emit to user's room
      this.io.to(`user:${userId}`).emit("presence:user_update", data);
      
      logger.debug(`Broadcasted status update for user ${userId}: ${status}`);
    } catch (error) {
      logger.error(`Failed to broadcast status for user ${userId}:`, error);
    }
  }

  // Get enhanced metrics for controller
  getMetrics() {
    let totalConnections = 0;
    const userTypes = {};

    for (const [userId, sockets] of this.onlineUsers.entries()) {
      totalConnections += sockets.size;
      userTypes[userId] = sockets.size;
    }

    return {
      onlineUsers: this.onlineUsers.size,
      totalConnections,
      heartbeatIntervals: this.heartbeatIntervals.size,
      offlineTimeouts: this.offlineTimeouts.size,
      pendingDbUpdates: this.pendingDbUpdates.size,
      cacheSize: this.presenceCache.size,
      userTypes,
      redisAvailable: this.isRedisAvailable(),
      ioInjected: this._ioInjected,
    };
  }

  // [REST OF THE FILE IS IDENTICAL TO THE UPLOADED VERSION]
  // Keeping only the critical changes for brevity

  async setupRedisSubscriptionWithRetry() {
    if (!this.isRedisAvailable()) {
      logger.warn("Redis not available, skipping subscription setup");
      return;
    }

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        await this.setupRedisSubscription();
        logger.info("✅ Redis subscription setup successful");
        return;
      } catch (error) {
        retries++;
        logger.warn(`Redis subscription setup failed (attempt ${retries}/${maxRetries}):`, error.message);
        if (retries < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 2000 * retries));
        }
      }
    }

    logger.error("Failed to setup Redis subscription after multiple attempts");
  }

  async setupRedisSubscription() {
    if (!this.isRedisAvailable()) return;

    if (!this.redisService.subscribe || typeof this.redisService.subscribe !== "function") {
      throw new Error("RedisService.subscribe method not available");
    }

    await this.redisService.subscribe("presence:updates", (message) => {
      try {
        const parsed = typeof message === "string" ? JSON.parse(message) : message;
        if (parsed.type === "user_online" && parsed.userId) {
          this.handleRemoteUserOnline(parsed.userId, parsed.data);
        } else if (parsed.type === "user_offline" && parsed.userId) {
          this.handleRemoteUserOffline(parsed.userId);
        }
      } catch (error) {
        logger.error("Error handling Redis presence message:", error);
      }
    });
  }

  startPeriodicTasks() {
    setInterval(() => {
      try { this.cleanupStalePresence(); } catch (error) { logger.error("Error in cleanupStalePresence:", error); }
    }, 60000);

    setInterval(() => {
      try { this.flushDbUpdates(); } catch (error) { logger.error("Error in flushDbUpdates:", error); }
    }, this.dbUpdateInterval);

    setInterval(() => {
      try { this.clearExpiredCache(); } catch (error) { logger.error("Error in clearExpiredCache:", error); }
    }, 60000);
  }

  isRedisAvailable() {
    return this.redisService && typeof this.redisService.isReady === "function" && this.redisService.isReady();
  }

  async setUserOffline(userId) {
    return await this.markUserOffline(userId);
  }

  async disconnectUser(userId) {
    return await this.disconnectAllUserConnections(userId);
  }

  async disconnectAllUserConnections(userId) {
    if (!this.onlineUsers.has(userId)) return true;

    const sockets = Array.from(this.onlineUsers.get(userId));
    for (const socketId of sockets) {
      await this.userDisconnected(userId, socketId);
    }

    return true;
  }

  async userConnected(userId, socketId, userData = {}) {
    try {
      if (this.offlineTimeouts.has(userId)) {
        clearTimeout(this.offlineTimeouts.get(userId));
        this.offlineTimeouts.delete(userId);
      }

      const user = await UserQuery.getUserById(userId);
      if (!user) {
        logger.warn(`User ${userId} not found for connection`);
        return false;
      }

      if (user.accountStatus !== "active") {
        logger.warn(`User ${userId} is not active, account status: ${user.accountStatus}`);
        return false;
      }

      if (this.isRedisAvailable() && this.redisService.canUserConnect) {
        const canConnect = await this.redisService.canUserConnect(userId, 5);
        if (!canConnect) {
          logger.warn(`User ${userId} exceeded connection limit`);
          return false;
        }
      }

      if (!this.onlineUsers.has(userId)) {
        this.onlineUsers.set(userId, new Set());
      }
      const userSockets = this.onlineUsers.get(userId);
      userSockets.add(socketId);

      if (userSockets.size === 1) {
        await this.markUserOnline(userId, user, userData);
        logger.info(`User ${userId} (${user.userType}) came online (socket: ${socketId})`);
      } else {
        logger.debug(`User ${userId} added socket ${socketId}, total sockets: ${userSockets.size}`);
      }

      this.setupHeartbeat(userId, socketId);
      this.presenceCache.delete(userId);

      return true;
    } catch (error) {
      logger.error("User connected error:", error);
      return false;
    }
  }

  async addSocketToUser(userId, socketId) {
    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, new Set());
    }
    this.onlineUsers.get(userId).add(socketId);

    this.setupHeartbeat(userId, socketId);

    if (this.isRedisAvailable() && this.redisService.addSocketToUser) {
      await this.redisService.addSocketToUser(userId, socketId);
    }

    logger.debug(`Added socket ${socketId} to user ${userId}`);
    return true;
  }

  async markUserOnline(userId, user, userData = {}) {
    if (!user.presence) {
      user.presence = {
        status: "offline",
        lastSeen: new Date(),
        lastActive: new Date(),
        customStatus: null,
      };
    }

    user.presence.status = "online";
    user.presence.lastSeen = new Date();
    user.presence.lastActive = new Date();

    await this.updateUserStatusInDatabase(userId, "online");

    if (this.isRedisAvailable()) {
      await this.updateUserInRedis(userId, user, userData);
    }

    this.broadcastUserStatus(userId, "online", user);
  }

  async updateUserInRedis(userId, user, userData = {}) {
    if (!this.isRedisAvailable()) return;

    try {
      if (this.redisService.setUserOnline) {
        await this.redisService.setUserOnline(
          userId,
          Array.from(this.onlineUsers.get(userId) || []),
          {
            userName: user.userName || `${user.firstName} ${user.lastName}`,
            avatar: user.avatar || "",
            userType: user.userType || "unknown",
            role: user.role || "user",
            lastSeen: new Date().toISOString(),
            ...userData,
          },
        );
      }

      if (this.redisService.publish) {
        await this.redisService.publish(
          "presence:updates",
          JSON.stringify({
            type: "user_online",
            userId,
            data: {
              userName: user.userName,
              userType: user.userType,
              timestamp: new Date().toISOString(),
            },
          }),
        );
      }
    } catch (error) {
      logger.error("Redis update error:", error);
    }
  }

  async userDisconnected(userId, socketId) {
    try {
      if (!this.onlineUsers.has(userId)) return true;

      const userSockets = this.onlineUsers.get(userId);
      userSockets.delete(socketId);

      this.clearHeartbeat(socketId);

      if (userSockets.size === 0) {
        this.onlineUsers.delete(userId);

        const timeoutId = setTimeout(async () => {
          try {
            if (!this.onlineUsers.has(userId) || (this.onlineUsers.has(userId) && this.onlineUsers.get(userId).size === 0)) {
              await this.markUserOffline(userId);
            }
          } catch (error) {
            logger.error("Error in offline timeout callback:", error);
          }
        }, 5000);

        this.offlineTimeouts.set(userId, timeoutId);
      } else {
        if (this.isRedisAvailable() && this.redisService.removeSocketFromUser) {
          await this.redisService.removeSocketFromUser(userId, socketId);
        }
      }

      this.presenceCache.delete(userId);

      return true;
    } catch (error) {
      logger.error("User disconnected error:", error);
      return false;
    }
  }

  async removeSocketFromUser(userId, socketId) {
    if (!this.onlineUsers.has(userId)) return true;

    const userSockets = this.onlineUsers.get(userId);
    userSockets.delete(socketId);

    this.clearHeartbeat(socketId);

    if (this.isRedisAvailable() && this.redisService.removeSocketFromUser) {
      await this.redisService.removeSocketFromUser(userId, socketId);
    }

    logger.debug(`Removed socket ${socketId} from user ${userId}`);
    return true;
  }

  async markUserOffline(userId) {
    try {
      const user = await UserQuery.getUserById(userId);
      if (!user) return false;

      await this.updateUserStatusInDatabase(userId, "offline");

      if (this.isRedisAvailable() && this.redisService.setUserOffline) {
        await this.redisService.setUserOffline(userId);

        if (this.redisService.publish) {
          await this.redisService.publish(
            "presence:updates",
            JSON.stringify({
              type: "user_offline",
              userId,
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }

      logger.info(`User ${userId} (${user.userType}) went offline`);

      this.broadcastUserStatus(userId, "offline", user);

      return true;
    } catch (error) {
      logger.error("Mark user offline error:", error);
      return false;
    }
  }

  async updateUserStatusInDatabase(userId, status) {
    try {
      const updateData = {
        "presence.status": status,
        "presence.lastSeen": new Date(),
      };

      if (status === "offline") {
        updateData["presence.lastActive"] = new Date();
      }

      await BaseUser.findByIdAndUpdate(
        userId,
        { $set: updateData },
        { new: true, runValidators: false },
      );

      return true;
    } catch (error) {
      logger.error("Database status update error:", error);
      return false;
    }
  }

  setupHeartbeat(userId, socketId) {
    const intervalId = setInterval(async () => {
      try {
        if (this.isRedisAvailable() && this.redisService.refreshUserHeartbeat) {
          await this.redisService.refreshUserHeartbeat(userId);
        }

        this.pendingDbUpdates.set(userId, new Date());
      } catch (error) {
        logger.error("Heartbeat error:", error);
      }
    }, 30000);

    this.heartbeatIntervals.set(socketId, intervalId);
  }

  clearHeartbeat(socketId) {
    if (this.heartbeatIntervals.has(socketId)) {
      clearInterval(this.heartbeatIntervals.get(socketId));
      this.heartbeatIntervals.delete(socketId);
    }
  }

  async flushDbUpdates() {
    if (this.pendingDbUpdates.size === 0) return;

    const updates = Array.from(this.pendingDbUpdates.entries());
    this.pendingDbUpdates.clear();

    for (const [userId, lastSeen] of updates) {
      try {
        await BaseUser.findByIdAndUpdate(
          userId,
          { $set: { "presence.lastSeen": lastSeen } },
          { runValidators: false },
        );
      } catch (error) {
        logger.error("Batch update error for user", userId, error.message);
      }
    }

    logger.debug(`Flushed ${updates.length} batched presence updates`);
  }

  async handleRemoteUserOnline(userId, data) {
    this.broadcastUserStatus(userId, "online");
  }

  async handleRemoteUserOffline(userId) {
    if (this.onlineUsers.has(userId)) {
      const userSockets = this.onlineUsers.get(userId);
      if (userSockets.size === 0) {
        this.onlineUsers.delete(userId);
      }
    }

    this.broadcastUserStatus(userId, "offline");
  }

  async getCachedPresence(userId) {
    const cached = this.presenceCache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    const presence = await this.getUserPresence(userId);
    this.presenceCache.set(userId, {
      data: presence,
      timestamp: Date.now(),
    });

    return presence;
  }

  async getUserPresence(userId) {
    try {
      const isConnected = this.onlineUsers.has(userId) && this.onlineUsers.get(userId).size > 0;

      if (isConnected) {
        const user = await UserQuery.getUserById(userId);
        if (user) {
          return {
            userId,
            isOnline: true,
            status: user.presence?.status || "online",
            customStatus: user.presence?.customStatus,
            lastSeen: user.presence?.lastSeen || new Date(),
            userType: user.userType,
            role: user.role,
          };
        }
      }

      if (this.isRedisAvailable() && this.redisService.getUserPresence) {
        const presence = await this.redisService.getUserPresence(userId);
        if (presence) {
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
          const lastSeen = new Date(presence.lastSeen);
          const isOnline = lastSeen > fiveMinutesAgo && presence.status === "online";

          return {
            userId,
            isOnline,
            status: presence.status,
            customStatus: presence.customStatus,
            lastSeen: presence.lastSeen,
            userType: presence.userType || "unknown",
            role: presence.role || "user",
          };
        }
      }

      const user = await UserQuery.getUserById(userId);
      if (!user) {
        return {
          userId,
          isOnline: false,
          status: "offline",
          userType: "unknown",
          lastSeen: null,
        };
      }

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const lastSeen = user.presence?.lastSeen || new Date(0);
      const isOnline = new Date(lastSeen) > fiveMinutesAgo && user.presence?.status === "online";

      return {
        userId,
        isOnline,
        status: user.presence?.status || "offline",
        customStatus: user.presence?.customStatus,
        lastSeen: lastSeen,
        userType: user.userType,
        role: user.role,
      };
    } catch (error) {
      logger.error("Get user presence error:", error);
      return {
        userId,
        isOnline: false,
        status: "offline",
        userType: "unknown",
        lastSeen: null,
      };
    }
  }

  async areUsersOnline(userIds) {
    try {
      const result = {};

      for (const userId of userIds) {
        const isConnected = this.onlineUsers.has(userId) && this.onlineUsers.get(userId).size > 0;

        if (isConnected) {
          result[userId] = true;
          continue;
        }

        if (this.isRedisAvailable() && this.redisService.getUserPresence) {
          const presence = await this.redisService.getUserPresence(userId);
          if (presence) {
            const lastSeen = new Date(presence.lastSeen);
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            result[userId] = lastSeen > fiveMinutesAgo && presence.status === "online";
            continue;
          }
        }

        const cached = this.presenceCache.get(userId);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
          result[userId] = cached.data.isOnline;
          continue;
        }

        const presence = await this.getUserPresence(userId);
        result[userId] = presence.isOnline;
      }

      return result;
    } catch (error) {
      logger.error("Are users online error:", error);
      return userIds.reduce((acc, userId) => {
        acc[userId] = false;
        return acc;
      }, {});
    }
  }

  async getOnlineUsers(limit = 100, offset = 0, userType = "all") {
    try {
      if (this.isRedisAvailable() && this.redisService.getOnlineUsers) {
        const redisUsers = await this.redisService.getOnlineUsers(limit, offset, userType);
        if (redisUsers && redisUsers.length > 0) {
          return redisUsers;
        }
      }

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const query = {
        "presence.lastSeen": { $gt: fiveMinutesAgo },
        "presence.status": "online",
        accountStatus: "active",
      };

      if (userType !== "all") {
        if (userType === "dating") {
          query.userType = "DatingUser";
        } else if (userType === "staff") {
          query.userType = { $in: ["Moderator", "Admin", "SuperAdmin"] };
        } else {
          query.userType = userType;
        }
      }

      const users = await BaseUser.find(query)
        .select("_id firstName lastName avatar userName userType role presence location")
        .limit(limit)
        .skip(offset)
        .sort({ "presence.lastSeen": -1 });

      return users.map((user) => ({
        userId: user._id.toString(),
        name: `${user.firstName} ${user.lastName}`,
        avatar: user.avatar,
        userName: user.userName,
        userType: user.userType,
        role: user.role,
        lastSeen: user.presence?.lastSeen,
        status: user.presence?.status || "offline",
        customStatus: user.presence?.customStatus,
        location: user.location,
      }));
    } catch (error) {
      logger.error("Get online users error:", error);
      return [];
    }
  }

  async getNearbyOnlineUsers(userId, radiusKm = 10, limit = 50) {
    try {
      const user = await UserQuery.getUserById(userId);
      if (!user?.location?.coordinates) return [];

      const onlineUsers = await this.getOnlineUsers(200, 0, "dating");
      const onlineUserIds = onlineUsers.map((u) => u.userId);

      if (onlineUserIds.length === 0) return [];

      const nearbyUsers = await DatingUser.find({
        _id: { $in: onlineUserIds },
        "location.coordinates": {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: user.location.coordinates,
            },
            $maxDistance: radiusKm * 1000,
          },
        },
        accountStatus: "active",
      })
        .select("_id firstName lastName avatar userName age bio interests location presence")
        .limit(limit);

      return nearbyUsers.map((user) => ({
        userId: user._id.toString(),
        name: `${user.firstName} ${user.lastName}`,
        age: user.age,
        avatar: user.avatar,
        userName: user.userName,
        bio: user.bio,
        interests: user.interests,
        location: user.location,
        lastSeen: user.presence?.lastSeen,
        isOnline: true,
      }));
    } catch (error) {
      logger.error("Get nearby online users error:", error);
      return [];
    }
  }

  async refreshUserHeartbeat(userId) {
    try {
      if (this.isRedisAvailable() && this.redisService.refreshUserHeartbeat) {
        await this.redisService.refreshUserHeartbeat(userId);
      }

      this.pendingDbUpdates.set(userId, new Date());

      return true;
    } catch (error) {
      logger.error("Refresh user heartbeat error:", error);
      return false;
    }
  }

  async updateUserStatus(userId, status, customStatus = "") {
    try {
      await this.updateUserStatusInDatabase(userId, status);

      if (this.isRedisAvailable() && this.redisService.updateUserStatus) {
        await this.redisService.updateUserStatus(userId, status, customStatus);
      }

      const user = await UserQuery.getUserById(userId);
      if (user) {
        this.broadcastUserStatus(userId, status, user);
      }

      this.presenceCache.delete(userId);

      logger.info(`User ${userId} status updated to ${status}`);
      return true;
    } catch (error) {
      logger.error("Update user status error:", error);
      return false;
    }
  }

  async cleanupStalePresence() {
    try {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

      const staleUsers = await BaseUser.find({
        "presence.status": "online",
        "presence.lastSeen": { $lt: fifteenMinutesAgo },
        accountStatus: "active",
      }).select("_id presence userType");

      for (const user of staleUsers) {
        const userId = user._id.toString();

        if (!this.onlineUsers.has(userId) || this.onlineUsers.get(userId).size === 0) {
          await this.markUserOffline(userId);
          logger.info(`Cleaned up stale presence for user ${userId} (${user.userType})`);
        }
      }
    } catch (error) {
      logger.error("Cleanup stale presence error:", error);
    }
  }

  clearExpiredCache() {
    const now = Date.now();
    for (const [userId, cache] of this.presenceCache.entries()) {
      if (now - cache.timestamp > this.cacheTTL) {
        this.presenceCache.delete(userId);
      }
    }
  }

  getUserConnections(userId) {
    if (!this.onlineUsers.has(userId)) return [];
    return Array.from(this.onlineUsers.get(userId));
  }

  isUserConnected(userId) {
    return this.onlineUsers.has(userId) && this.onlineUsers.get(userId).size > 0;
  }

  async cleanup() {
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

    await this.flushDbUpdates();

    logger.info("PresenceService cleaned up");
  }
}

module.exports = PresenceService;