const { BaseUser, ROLES} = require("@models/User"); 
const logger = require("@utils/logger");
const { v4: uuidv4 } = require("uuid");

// ========== CONSTANTS & CONFIG ==========
const CONFIG = {
  ONLINE_THRESHOLD_MS: parseInt(process.env.ONLINE_THRESHOLD_MS) || 5 * 60 * 1000,
  MAX_USER_IDS_BATCH: 100,
  MAX_BATCH_UPDATE_SIZE: 50,
  CACHE_TTL: {
    STATS: 30000,
    USER_PRESENCE: 15000,
  },
  USER_TYPES: {
    DATING: "DatingUser",
    MODERATOR: "ModeratorUser",
    ADMIN: "AdminUser",
    SUPER_ADMIN: "SuperAdminUser",
  },
  STAFF_ROLES: [ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN],
};

class PresenceController {
  constructor(presenceService = null) {
    this.presenceService = presenceService;
    this.io = null;
    this.statsCache = {
      data: null,
      lastUpdated: 0,
      TTL: 30000,
    };
    
    this.healthCheck = this.healthCheck.bind(this);
    this.getOnlineStatus = this.getOnlineStatus.bind(this);
    this.getActiveUsers = this.getActiveUsers.bind(this);
    this.getUserPresence = this.getUserPresence.bind(this);
    this.getCurrentUserPresence = this.getCurrentUserPresence.bind(this);
    this.updateStatus = this.updateStatus.bind(this);
    this.updateLastSeen = this.updateLastSeen.bind(this);
    this.markOffline = this.markOffline.bind(this);
    this.batchUpdatePresence = this.batchUpdatePresence.bind(this);
    this.getPresenceStats = this.getPresenceStats.bind(this);
    this.getPresenceMetrics = this.getPresenceMetrics.bind(this);
    this.getConnectionStats = this.getConnectionStats.bind(this);
    this.clearPresenceCache = this.clearPresenceCache.bind(this);
    this.cleanupStalePresence = this.cleanupStalePresence.bind(this);
  }

  // ========== SOCKET.IO INJECTION ==========
  setIo(io) {
    this.io = io;
    logger.info('✅ Socket.io instance injected into PresenceController');
  }

  // ── CHANGED ──────────────────────────────────────────────────────────────
  // 1. Guard logs a warning instead of silently returning
  // 2. user:online now includes userName + avatar (frontend needs these)
  // 3. All three paths log so you can see exactly what fires
  // ─────────────────────────────────────────────────────────────────────────
  emitPresenceChange(userId, status, additionalData = {}) {
    if (!this.io) {
      logger.warn(`[Presence] ⚠️  emitPresenceChange called but io not injected — userId=${userId} status=${status}`);
      return;
    }

    const payload = {
      userId,
      status,
      timestamp: new Date().toISOString(),
      ...additionalData,
    };

    // Subscriber room (presence:subscribe) — always fires for any status
    this.io.to(`presence:${userId}`).emit('user:status-changed', payload);

    if (status === 'online') {
      // FIXED: include userName + avatar so frontend handleUserOnline can build
      // the ActiveUser object without needing a follow-up HTTP request
      const onlinePayload = {
        userId,
        userName:  additionalData.userName ?? '',
        avatar:    additionalData.avatar   ?? null,
        userType:  additionalData.userType ?? 'dating',
        timestamp: payload.timestamp,
      };
      this.io.emit('user:online', onlinePayload);
      logger.info(`[Presence] 📡 user:online  → userId=${userId} userName="${onlinePayload.userName}"`);

    } else if (status === 'offline') {
      const offlinePayload = {
        userId,
        userName:  additionalData.userName ?? '',
        timestamp: payload.timestamp,
      };
      this.io.emit('user:offline', offlinePayload);
      logger.info(`[Presence] 📡 user:offline → userId=${userId} userName="${offlinePayload.userName}"`);

    } else {
      // away / busy / invisible — subscriber room only (already sent above)
      logger.debug(`[Presence] 📡 user:status-changed → userId=${userId} status=${status}`);
    }
  }

  // ========== HELPER METHODS ==========
  async getUserById(userId) {
    return BaseUser.findById(userId);
  }

  async updateUserPresence(userId, updateData) {
    return BaseUser.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: false }
    );
  }

  getUserType(user) {
    if (!user) return 'unknown';
    if (user.userType === CONFIG.USER_TYPES.DATING) return 'dating';
    if (user.role && CONFIG.STAFF_ROLES.includes(user.role)) return 'staff';
    return 'dating';
  }

  isStaffUser(user) {
    if (!user) return false;
    return user.role && CONFIG.STAFF_ROLES.includes(user.role);
  }

  // ========== HEALTH CHECK ==========
  async healthCheck(req, res) {
    try {
      const health = {
        service: "presence-api",
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        dependencies: {
          database: "connected",
          redis: this.presenceService?.redisService?.isReady()
            ? "connected"
            : "disconnected",
          websocket: this.presenceService ? "available" : "unavailable",
        },
      };

      try {
        await BaseUser.findOne({}).limit(1);
      } catch (dbError) {
        health.status = "degraded";
        health.dependencies.database = "disconnected";
      }

      const statusCode = health.status === "healthy" ? 200 : 503;
      res.status(statusCode).json({
        success: health.status === "healthy",
        ...health,
      });
    } catch (error) {
      logger.error("Health check error:", error);
      res.status(503).json({
        success: false,
        status: "unhealthy",
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ========== PRESENCE QUERIES ==========
  async getOnlineStatus(req, res) {
    try {
      const { userIds } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: "User IDs array is required",
          code: "VALIDATION_ERROR"
        });
      }

      const limitedIds = userIds.slice(0, CONFIG.MAX_USER_IDS_BATCH);
      const onlineStatus = {};

      if (this.presenceService && this.presenceService.areUsersOnline) {
        const serviceStatus = await this.presenceService.areUsersOnline(limitedIds);
        Object.assign(onlineStatus, serviceStatus);
      } else {
        const users = await BaseUser.find({
          _id: { $in: limitedIds },
        }).select("_id presence userType role");

        for (const userId of limitedIds) {
          const user = users.find(u => u._id.toString() === userId);
          if (user && user.presence) {
            const showOnline = this.shouldShowOnlineStatus(user, req.user);
            onlineStatus[userId] = showOnline && user.presence.status === "online";
          } else {
            onlineStatus[userId] = false;
          }
        }
      }

      res.json({
        success: true,
        data: onlineStatus,
        count: Object.keys(onlineStatus).length,
        timestamp: new Date().toISOString(),
        requestId: req.requestId || uuidv4(),
      });
    } catch (error) {
      logger.error("Get online status error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get online status",
        code: "INTERNAL_ERROR",
        requestId: req.requestId || uuidv4(),
      });
    }
  }

  shouldShowOnlineStatus(user, requestingUser) {
    if (requestingUser && requestingUser.id === user._id.toString()) return true;
    if (user.privacySettings?.showOnlineStatus === false) return false;
    if (user.userType === CONFIG.USER_TYPES.DATING) {
      const showLastActive = user.datingPrivacySettings?.showLastActive || 'matches';
      if (showLastActive === 'nobody') return false;
      if (showLastActive === 'matches') {
        return requestingUser && requestingUser.id === user._id.toString();
      }
    }
    return true;
  }

  async getActiveUsers(req, res) {
    try {
      const { limit = 50, offset = 0, status = "online", userType = "dating" } = req.query;
      const requestingUserId = req.user?.id;
      
      let users = [];

      const baseFilter = {
        accountStatus: "active",
        "privacySettings.profileVisibility": { $ne: "private" },
      };

      if (userType === "dating") {
        baseFilter.$or = [
          { userType: CONFIG.USER_TYPES.DATING },
          { role: ROLES.USER }
        ];
      } else if (userType === "staff") {
        baseFilter.role = { $in: CONFIG.STAFF_ROLES };
      } else if (userType === "moderator") {
        baseFilter.role = ROLES.MODERATOR;
      } else if (userType === "admin") {
        baseFilter.role = { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] };
      }

      if (status === "online") {
        const onlineFilter = {
          ...baseFilter,
          "presence.status": "online",
        };

        if (this.presenceService && this.presenceService.getOnlineUsers) {
          users = await this.presenceService.getOnlineUsers(parseInt(limit), parseInt(offset));
          if (userType !== "all") {
            const userIds = users.map(u => u.userId);
            const dbUsers = await BaseUser.find({
              _id: { $in: userIds },
              ...baseFilter
            }).select("_id userType role");
            const validUserIds = dbUsers.map(u => u._id.toString());
            users = users.filter(u => validUserIds.includes(u.userId));
          }
        } else {
          const dbUsers = await BaseUser.find(onlineFilter)
            .select("_id firstName lastName avatar userName age preferences.lookingFor location.city presence userType role datingPrivacySettings")
            .sort({ "presence.lastSeen": -1 })
            .skip(parseInt(offset))
            .limit(parseInt(limit));

          users = dbUsers.map(user => {
            const showOnline = this.shouldShowOnlineStatus(user, { id: requestingUserId });
            return {
              userId: user._id.toString(),
              name: `${user.firstName} ${user.lastName}`,
              userName: user.userName,
              avatar: user.avatar,
              age: user.age,
              lookingFor: user.preferences?.lookingFor || [],
              location: user.location?.city,
              lastSeen: user.presence?.lastSeen,
              status: user.presence?.status || 'offline',
              userType: this.getUserType(user),
              role: user.role,
              showOnlineStatus: showOnline,
            };
          });
        }
      } else {
        const filter = baseFilter;
        if (status === "offline") {
          filter["presence.status"] = { $in: ["offline", "away", "busy", "invisible"] };
        }

        const dbUsers = await BaseUser.find(filter)
          .select("_id firstName lastName avatar userName presence userType role datingPrivacySettings")
          .sort({ "presence.lastSeen": -1 })
          .skip(parseInt(offset))
          .limit(parseInt(limit));

        users = dbUsers.map(user => {
          const showOnline = this.shouldShowOnlineStatus(user, { id: requestingUserId });
          return {
            userId: user._id.toString(),
            name: `${user.firstName} ${user.lastName}`,
            userName: user.userName,
            avatar: user.avatar,
            lastSeen: user.presence?.lastSeen,
            status: user.presence?.status || 'offline',
            userType: this.getUserType(user),
            role: user.role,
            showOnlineStatus: showOnline,
          };
        });
      }

      res.json({
        success: true,
        data: users,
        count: users.length,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: users.length,
        },
        timestamp: new Date().toISOString(),
        status,
        userType,
      });
    } catch (error) {
      logger.error("Get active users error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get active users",
        code: "INTERNAL_ERROR",
      });
    }
  }

  // ========== USER PRESENCE ==========
  async getUserPresence(req, res) {
    try {
      const { userId } = req.params;
      const requestingUserId = req.user?.id;

      let presence = null;

      if (this.presenceService && this.presenceService.getUserPresence) {
        presence = await this.presenceService.getUserPresence(userId);
      }

      if (!presence) {
        const user = await this.getUserById(userId);
        
        if (!user) {
          return res.status(404).json({
            success: false,
            error: "User not found",
            code: "USER_NOT_FOUND",
          });
        }

        const showOnline = this.shouldShowOnlineStatus(user, { id: requestingUserId });

        presence = {
          userId: user._id.toString(),
          name: `${user.firstName} ${user.lastName}`,
          userName: user.userName,
          avatar: user.avatar,
          lastSeen: user.presence?.lastSeen,
          status: user.presence?.status || 'offline',
          userType: this.getUserType(user),
          role: user.role,
          showOnlineStatus: showOnline,
        };

        if (user.userType === CONFIG.USER_TYPES.DATING && requestingUserId === userId) {
          presence.datingPrivacySettings = user.datingPrivacySettings;
          presence.datingStats = user.datingStats;
        }
        
        if (this.isStaffUser(user) && requestingUserId === userId) {
          presence.workStats = user.workStats;
          presence.isOnShift = user.isOnShift;
        }
      }

      res.json({
        success: true,
        data: presence,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Get user presence error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get user presence",
        code: "INTERNAL_ERROR",
      });
    }
  }

  async getCurrentUserPresence(req, res) {
    try {
      const userId = req.user.id;

      const user = await this.getUserById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
          code: "USER_NOT_FOUND",
        });
      }

      const presenceData = {
        userId: user._id.toString(),
        lastSeen: user.presence?.lastSeen,
        lastActive: user.presence?.lastActive,
        status: user.presence?.status || 'offline',
        connections: this.presenceService?.getUserConnections?.(userId) || [],
        userType: this.getUserType(user),
        role: user.role,
        privacySettings: user.privacySettings,
      };

      if (user.userType === CONFIG.USER_TYPES.DATING) {
        presenceData.datingPrivacySettings = user.datingPrivacySettings;
        presenceData.datingStats = user.datingStats;
        presenceData.datingNotificationSettings = user.datingNotificationSettings;
      }
      
      if (this.isStaffUser(user)) {
        presenceData.workStats = user.workStats;
        presenceData.isOnShift = user.isOnShift;
        presenceData.staffNotificationSettings = user.staffNotificationSettings;
      }

      res.json({
        success: true,
        data: presenceData,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Get current user presence error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get presence",
        code: "INTERNAL_ERROR",
      });
    }
  }

  // ========== STATUS UPDATES ==========

  // ── CHANGED ──────────────────────────────────────────────────────────────
  // Passes userName + avatar + userType into emitPresenceChange so the
  // user:online socket event includes them. Frontend needs these to render
  // the user card without a follow-up HTTP call.
  // Added logger.info so you can see this fire in the server terminal.
  // ─────────────────────────────────────────────────────────────────────────
  async updateStatus(req, res) {
    try {
      const userId = req.user.id;
      const { status, online } = req.body;

      let finalStatus = status;
      if (online !== undefined) {
        finalStatus = online ? 'online' : 'offline';
      }

      if (finalStatus) {
        const validStatuses = ["online", "away", "busy", "offline", "invisible"];
        if (!validStatuses.includes(finalStatus)) {
          return res.status(400).json({
            success: false,
            error: `Status must be one of: ${validStatuses.join(", ")}`,
            code: "VALIDATION_ERROR",
          });
        }
      }

      const user = await this.getUserById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
          code: "USER_NOT_FOUND",
        });
      }

      if (!user.presence) {
        user.presence = {
          status: finalStatus || "online",
          lastSeen: new Date(),
          lastActive: new Date(),
        };
      } else {
        if (finalStatus) {
          user.presence.status = finalStatus;
        }
        user.presence.lastSeen = new Date();
        user.presence.lastActive = new Date();
      }
      
      await user.save({ validateBeforeSave: false });

      if (this.presenceService && this.presenceService.updateUserStatus) {
        await this.presenceService.updateUserStatus(userId, finalStatus);
      }

      // ── REAL-TIME EMIT ─────────────────────────────────────────────────────
      // FIXED: include userName + avatar + userType so frontend user:online
      // handler can build the card immediately without extra HTTP calls
      logger.info(`[Presence] updateStatus called — userId=${userId} status=${user.presence.status}`);
      this.emitPresenceChange(userId, user.presence.status, {
        lastSeen:  user.presence.lastSeen,
        lastActive: user.presence.lastActive,
        userName:  `${user.firstName} ${user.lastName}`.trim(),
        avatar:    user.avatar ?? null,
        userType:  this.getUserType(user),
      });
      // ──────────────────────────────────────────────────────────────────────

      this.statsCache.data = null;

      res.json({
        success: true,
        data: {
          userId: user._id.toString(),
          status: user.presence.status,
          lastSeen: user.presence.lastSeen,
          lastActive: user.presence.lastActive,
          userType: this.getUserType(user),
          role: user.role,
        },
        message: "Status updated successfully",
      });
    } catch (error) {
      logger.error("Update status error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update status",
        code: "INTERNAL_ERROR",
      });
    }
  }

  async updateLastSeen(req, res) {
    try {
      const userId = req.user.id;

      const user = await this.getUserById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
          code: "USER_NOT_FOUND",
        });
      }

      if (!user.presence) {
        user.presence = {
          status: "online",
          lastSeen: new Date(),
          lastActive: new Date(),
        };
      } else {
        user.presence.lastSeen = new Date();
        user.presence.lastActive = new Date();
      }
      
      await user.save({ validateBeforeSave: false });

      if (this.presenceService && this.presenceService.refreshUserHeartbeat) {
        await this.presenceService.refreshUserHeartbeat(userId);
      }

      res.json({
        success: true,
        lastSeen: user.presence.lastSeen,
        lastActive: user.presence.lastActive,
        message: "Heartbeat received",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Heartbeat error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to process heartbeat",
        code: "INTERNAL_ERROR",
      });
    }
  }

  // ── CHANGED ──────────────────────────────────────────────────────────────
  // Fetches user BEFORE the updateOne so we can include userName in the
  // user:offline payload. Added logger.info for visibility.
  // ─────────────────────────────────────────────────────────────────────────
  async markOffline(req, res) {
    try {
      const userId = req.user.id;

      // Fetch first so we have userName for the offline event
      const user = await this.getUserById(userId);

      if (this.presenceService && this.presenceService.updateUserStatus) {
        await this.presenceService.updateUserStatus(userId, "offline");
      }

      await BaseUser.updateOne(
        { _id: userId },
        {
          $set: {
            "presence.status": "offline",
            "presence.lastSeen": new Date(),
            "presence.lastActive": new Date(),
          },
        }
      );

      // ── REAL-TIME EMIT ─────────────────────────────────────────────────────
      logger.info(`[Presence] markOffline called — userId=${userId}`);
      this.emitPresenceChange(userId, 'offline', {
        lastSeen: new Date(),
        userName: user ? `${user.firstName} ${user.lastName}`.trim() : '',
        avatar:   user?.avatar ?? null,
      });
      // ──────────────────────────────────────────────────────────────────────

      this.statsCache.data = null;

      res.json({
        success: true,
        message: "Marked as offline",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Mark offline error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to mark offline",
        code: "INTERNAL_ERROR",
      });
    }
  }

  async batchUpdatePresence(req, res) {
    try {
      const { userIds } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: "User IDs array is required",
          code: "VALIDATION_ERROR",
        });
      }

      const results = {};
      const limitedIds = userIds.slice(0, CONFIG.MAX_BATCH_UPDATE_SIZE);

      const batchSize = 10;
      for (let i = 0; i < limitedIds.length; i += batchSize) {
        const batch = limitedIds.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (userId) => {
            try {
              if (this.presenceService && this.presenceService.setUserOffline) {
                await this.presenceService.setUserOffline(userId);
              }

              await BaseUser.updateOne(
                { _id: userId },
                {
                  $set: {
                    "presence.status": "offline",
                    "presence.lastSeen": new Date(),
                    "presence.lastActive": new Date(),
                  },
                }
              );

              results[userId] = "success";
            } catch (error) {
              results[userId] = "failed";
              logger.error(`Failed to update presence for user ${userId}:`, error.message);
            }
          })
        );
      }

      this.statsCache.data = null;

      res.json({
        success: true,
        results,
        count: limitedIds.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Batch update presence error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to batch update presence",
        code: "INTERNAL_ERROR",
      });
    }
  }

  // ========== STATS & METRICS ==========
  async getPresenceStats(req, res) {
    try {
      const { userType = "all" } = req.query;
      const now = Date.now();

      if (
        this.statsCache.data &&
        now - this.statsCache.lastUpdated < this.statsCache.TTL &&
        (!userType || userType === "all")
      ) {
        return res.json({
          success: true,
          data: this.statsCache.data,
          cached: true,
          timestamp: new Date().toISOString(),
        });
      }

      const buildFilter = (baseFilter) => {
        if (userType === "dating") {
          return {
            ...baseFilter,
            $or: [
              { userType: CONFIG.USER_TYPES.DATING },
              { role: ROLES.USER }
            ]
          };
        } else if (userType === "staff") {
          return { ...baseFilter, role: { $in: CONFIG.STAFF_ROLES } };
        } else if (userType === "moderator") {
          return { ...baseFilter, role: ROLES.MODERATOR };
        } else if (userType === "admin") {
          return { ...baseFilter, role: { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] } };
        }
        return baseFilter;
      };

      const [onlineCount, totalUsers] = await Promise.all([
        BaseUser.countDocuments(buildFilter({
          "presence.status": "online",
          accountStatus: "active",
        })),
        BaseUser.countDocuments(buildFilter({ 
          accountStatus: { $in: ["active", "pending_verification"] }
        })),
      ]);

      const stats = {
        onlineUsers: onlineCount,
        totalUsers,
        userType: userType || "all",
        updatedAt: new Date().toISOString(),
      };

      if (!userType || userType === "all") {
        this.statsCache.data = stats;
        this.statsCache.lastUpdated = now;
      }

      res.json({
        success: true,
        data: stats,
        cached: false,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Get stats error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get stats",
        code: "INTERNAL_ERROR",
      });
    }
  }

  // ========== ADMIN METHODS ==========
  async getPresenceMetrics(req, res) {
    try {
      const metrics = {};

      if (this.presenceService && this.presenceService.getMetrics) {
        metrics.presenceService = this.presenceService.getMetrics();
      }

      if (this.presenceService?.redisService?.getMetrics) {
        metrics.redis = this.presenceService.redisService.getMetrics();
      }

      const userTypes = ["all", "dating", "staff", "moderator", "admin"];
      const statsPromises = userTypes.map(async (type) => {
        const reqCopy = { ...req, query: { userType: type } };
        const stats = await this.getPresenceStats(reqCopy, { json: () => {} });
        return { [type]: stats?.data };
      });

      const statsResults = await Promise.all(statsPromises);
      metrics.database = Object.assign({}, ...statsResults);

      try {
        const discriminatorStats = await BaseUser.aggregate([
          {
            $group: {
              _id: "$userType",
              count: { $sum: 1 },
              online: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$accountStatus", "active"] },
                        { $eq: ["$presence.status", "online"] }
                      ]
                    },
                    1,
                    0
                  ]
                }
              }
            }
          },
          { $sort: { count: -1 } }
        ]);
        
        metrics.discriminators = discriminatorStats;
      } catch (aggError) {
        logger.warn("Could not get discriminator stats:", aggError.message);
      }

      res.json({
        success: true,
        data: metrics,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Get presence metrics error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get presence metrics",
        code: "INTERNAL_ERROR",
      });
    }
  }

  async getConnectionStats(req, res) {
    try {
      let connectionStats = {};

      if (this.presenceService) {
        const metrics = this.presenceService.getMetrics
          ? this.presenceService.getMetrics()
          : {};

        connectionStats = {
          onlineUsers: metrics.onlineUsers || 0,
          totalConnections: metrics.totalConnections || 0,
          heartbeatIntervals: metrics.heartbeatIntervals || 0,
          userTypes: metrics.userTypes || {},
        };
      }

      res.json({
        success: true,
        data: connectionStats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Get connection stats error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get connection stats",
        code: "INTERNAL_ERROR",
      });
    }
  }

  async clearPresenceCache(req, res) {
    try {
      const { userId } = req.query;

      if (userId) {
        if (this.presenceService && this.presenceService.userDisconnected) {
          const connections = this.presenceService.getUserConnections
            ? this.presenceService.getUserConnections(userId)
            : [];

          for (const socketId of connections) {
            try {
              await this.presenceService.userDisconnected(userId, socketId);
            } catch (error) {
              // Continue with other connections
            }
          }
        }
      }

      this.statsCache.data = null;
      this.statsCache.lastUpdated = 0;

      res.json({
        success: true,
        message: userId ? `Cache cleared for user ${userId}` : "Cache cleared",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Clear presence cache error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to clear presence cache",
        code: "INTERNAL_ERROR",
      });
    }
  }

  async cleanupStalePresence(req, res) {
    try {
      const { thresholdMinutes = 15, dryRun = true, userType = "all" } = req.query;

      const thresholdTime = new Date(Date.now() - thresholdMinutes * 60 * 1000);

      const filter = {
        "presence.status": "online",
        "presence.lastSeen": { $lt: thresholdTime },
        accountStatus: "active",
      };

      if (userType === "dating") {
        filter.$or = [
          { userType: CONFIG.USER_TYPES.DATING },
          { role: ROLES.USER }
        ];
      } else if (userType === "staff") {
        filter.role = { $in: CONFIG.STAFF_ROLES };
      } else if (userType === "moderator") {
        filter.role = ROLES.MODERATOR;
      } else if (userType === "admin") {
        filter.role = { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] };
      }

      const staleUsers = await BaseUser.find(filter).select("_id presence userType role");

      const results = {
        total: staleUsers.length,
        updated: 0,
        dryRun: dryRun,
        userType: userType,
        users: [],
      };

      if (!dryRun) {
        const updatePromises = staleUsers.map(async (user) => {
          try {
            if (!user.presence) {
              user.presence = {
                status: "offline",
                lastSeen: new Date(),
                lastActive: new Date(),
              };
            } else {
              user.presence.status = "offline";
              user.presence.lastSeen = new Date();
              user.presence.lastActive = new Date();
            }
            
            await user.save({ validateBeforeSave: false });
            
            if (this.presenceService && this.presenceService.updateUserStatus) {
              await this.presenceService.updateUserStatus(user._id.toString(), "offline");
            }
            
            results.updated++;
            results.users.push({
              userId: user._id.toString(),
              userType: user.userType || this.getUserType(user),
              role: user.role,
              lastSeen: user.presence.lastSeen,
            });
          } catch (error) {
            logger.error(`Failed to cleanup user ${user._id}:`, error);
          }
        });

        await Promise.all(updatePromises);
        this.statsCache.data = null;
      } else {
        results.users = staleUsers.map((user) => ({
          userId: user._id.toString(),
          userType: user.userType || this.getUserType(user),
          role: user.role,
          lastSeen: user.presence?.lastSeen || new Date(),
        }));
      }

      res.json({
        success: true,
        data: results,
        message: dryRun ? "Dry run completed" : "Cleanup completed",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Cleanup stale presence error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to cleanup stale presence",
        code: "INTERNAL_ERROR",
      });
    }
  }
}

// Create and export singleton instance
const presenceController = new PresenceController();

module.exports = presenceController;