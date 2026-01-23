const { BaseUser, DatingUser, UserQuery } = require("@models/User");
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
};

class PresenceController {
  constructor(presenceService = null) {
    this.presenceService = presenceService;
    this.statsCache = {
      data: null,
      lastUpdated: 0,
      TTL: 30000,
    };
    
    // Bind all methods to maintain 'this' context
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

  // ========== HELPER METHODS ==========
  async getUserById(userId) {
    return UserQuery.getUserById(userId);
  }

  async updateUserPresence(userId, updateData) {
    return BaseUser.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: false }
    );
  }

  async getDatingUsers(filter = {}, select = "", options = {}) {
    const query = {
      userType: 'DatingUser',
      ...filter
    };
    
    return DatingUser.find(query)
      .select(select)
      .skip(options.skip || 0)
      .limit(options.limit || 50)
      .sort(options.sort || { "presence.lastSeen": -1 });
  }

  async countDatingUsers(filter = {}) {
    const query = {
      userType: 'DatingUser',
      ...filter
    };
    
    return DatingUser.countDocuments(query);
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

      // Quick database check
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

      // Try PresenceService first
      if (this.presenceService && this.presenceService.areUsersOnline) {
        const serviceStatus = await this.presenceService.areUsersOnline(limitedIds);
        Object.assign(onlineStatus, serviceStatus);
      } else {
        // Fallback to database - query all users regardless of type
        const users = await BaseUser.find({
          _id: { $in: limitedIds },
        }).select("_id presence userType");

        const fiveMinutesAgo = new Date(Date.now() - CONFIG.ONLINE_THRESHOLD_MS);

        for (const userId of limitedIds) {
          const user = users.find(u => u._id.toString() === userId);
          if (user) {
            onlineStatus[userId] = (
              new Date(user.presence.lastSeen) > fiveMinutesAgo &&
              user.presence.status === "online"
            );
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

  async getActiveUsers(req, res) {
    try {
      const { limit = 50, offset = 0, status = "online", userType = "dating" } = req.query;
      
      let users = [];
      const fiveMinutesAgo = new Date(Date.now() - CONFIG.ONLINE_THRESHOLD_MS);

      // Build base filter based on user type
      const baseFilter = {
        accountStatus: "active",
        "privacySettings.profileVisibility": { $ne: "private" },
      };

      // Add user type filter
      if (userType === "dating") {
        baseFilter.userType = "DatingUser";
      } else if (userType === "staff") {
        baseFilter.userType = { $in: ["Moderator", "Admin", "SuperAdmin"] };
      }

      if (status === "online") {
        // Add online filter
        const onlineFilter = {
          ...baseFilter,
          "presence.lastSeen": { $gt: fiveMinutesAgo },
          "presence.status": "online",
        };

        // Try PresenceService first
        if (this.presenceService && this.presenceService.getOnlineUsers) {
          users = await this.presenceService.getOnlineUsers(parseInt(limit), parseInt(offset));
          // Filter by user type if needed
          if (userType !== "all") {
            const userIds = users.map(u => u.userId);
            const dbUsers = await BaseUser.find({
              _id: { $in: userIds },
              ...baseFilter
            }).select("_id userType");
            
            const validUserIds = dbUsers.map(u => u._id.toString());
            users = users.filter(u => validUserIds.includes(u.userId));
          }
        } else {
          // Database fallback
          const dbUsers = await BaseUser.find(onlineFilter)
            .select("_id firstName lastName avatar userName age preferences.lookingFor location.city presence userType")
            .sort({ "presence.lastSeen": -1 })
            .skip(parseInt(offset))
            .limit(parseInt(limit));

          users = dbUsers.map(user => ({
            userId: user._id.toString(),
            name: `${user.firstName} ${user.lastName}`,
            userName: user.userName,
            avatar: user.avatar,
            age: user.age,
            lookingFor: user.preferences?.lookingFor || [],
            location: user.location?.city,
            isOnline: true,
            lastActive: user.presence.lastSeen,
            status: user.presence.status,
            userType: user.userType,
          }));
        }
      } else {
        const filter = baseFilter;
        
        if (status === "offline") {
          filter["presence.lastSeen"] = { $lte: fiveMinutesAgo };
        }

        const dbUsers = await BaseUser.find(filter)
          .select("_id firstName lastName avatar userName presence userType")
          .sort({ "presence.lastSeen": -1 })
          .skip(parseInt(offset))
          .limit(parseInt(limit));

        users = dbUsers.map(user => {
          const isOnline = (
            new Date(user.presence.lastSeen) > fiveMinutesAgo &&
            user.presence.status === "online"
          );
          
          return {
            userId: user._id.toString(),
            name: `${user.firstName} ${user.lastName}`,
            userName: user.userName,
            avatar: user.avatar,
            isOnline,
            lastSeen: user.presence.lastSeen,
            status: user.presence.status,
            userType: user.userType,
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

      let presence = null;

      // Try PresenceService
      if (this.presenceService && this.presenceService.getUserPresence) {
        presence = await this.presenceService.getUserPresence(userId);
      }

      // Fallback to database
      if (!presence) {
        const user = await this.getUserById(userId);
        
        if (!user) {
          return res.status(404).json({
            success: false,
            error: "User not found",
            code: "USER_NOT_FOUND",
          });
        }

        const fiveMinutesAgo = new Date(Date.now() - CONFIG.ONLINE_THRESHOLD_MS);
        const isOnline = (
          new Date(user.presence.lastSeen) > fiveMinutesAgo &&
          user.presence.status === "online"
        );

        presence = {
          userId: user._id.toString(),
          name: `${user.firstName} ${user.lastName}`,
          userName: user.userName,
          avatar: user.avatar,
          isOnline,
          lastSeen: user.presence.lastSeen,
          status: user.presence.status,
          customStatus: user.presence.customStatus || null,
          userType: user.userType,
        };
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

      const fiveMinutesAgo = new Date(Date.now() - CONFIG.ONLINE_THRESHOLD_MS);
      const isOnline = (
        new Date(user.presence.lastSeen) > fiveMinutesAgo &&
        user.presence.status === "online"
      );

      const presenceData = {
        userId: user._id.toString(),
        isOnline,
        lastSeen: user.presence.lastSeen,
        status: user.presence.status,
        customStatus: user.presence.customStatus || null,
        connections: this.presenceService?.getUserConnections?.(userId) || [],
        userType: user.userType,
      };

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
  async updateStatus(req, res) {
    try {
      const userId = req.user.id;
      const { status, customStatus, online } = req.body;

      // Handle both 'status' and 'online' fields
      let finalStatus = status;
      if (online !== undefined) {
        finalStatus = online ? 'online' : 'offline';
      }

      if (finalStatus) {
        const validStatuses = ["online", "away", "busy", "offline", "dnd"];
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

      // Update user
      if (finalStatus) {
        user.presence.status = finalStatus;
      }
      
      if (customStatus !== undefined) {
        user.presence.customStatus = customStatus;
      }
      
      user.presence.lastSeen = new Date();
      user.presence.lastActive = new Date();
      
      await user.save({ validateBeforeSave: false });

      // Update PresenceService
      if (this.presenceService && this.presenceService.updateUserStatus) {
        await this.presenceService.updateUserStatus(userId, finalStatus, customStatus);
      }

      // Clear cache
      this.statsCache.data = null;

      res.json({
        success: true,
        data: {
          userId: user._id.toString(),
          status: user.presence.status,
          customStatus: user.presence.customStatus,
          lastSeen: user.presence.lastSeen,
          userType: user.userType,
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

      // Update last seen
      user.presence.lastSeen = new Date();
      user.presence.lastActive = new Date();
      await user.save({ validateBeforeSave: false });

      // Update PresenceService
      if (this.presenceService && this.presenceService.refreshUserHeartbeat) {
        await this.presenceService.refreshUserHeartbeat(userId);
      }

      res.json({
        success: true,
        lastSeen: user.presence.lastSeen,
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

  async markOffline(req, res) {
    try {
      const userId = req.user.id;

      // Update PresenceService
      if (this.presenceService && this.presenceService.updateUserStatus) {
        await this.presenceService.updateUserStatus(userId, "offline");
      }

      // Update database using BaseUser (works for all user types)
      await BaseUser.updateOne(
        { _id: userId },
        {
          $set: {
            "presence.status": "offline",
            "presence.lastSeen": new Date(),
          },
        }
      );

      // Clear cache
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

      // Process in batches
      const batchSize = 10;
      for (let i = 0; i < limitedIds.length; i += batchSize) {
        const batch = limitedIds.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (userId) => {
            try {
              // Update PresenceService
              if (this.presenceService && this.presenceService.setUserOffline) {
                await this.presenceService.setUserOffline(userId);
              }

              // Update database using BaseUser
              await BaseUser.updateOne(
                { _id: userId },
                {
                  $set: {
                    "presence.status": "offline",
                    "presence.lastSeen": new Date(),
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

      // Clear cache
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

      // Return cached stats if valid
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

      const fiveMinutesAgo = new Date(now - CONFIG.ONLINE_THRESHOLD_MS);
      const oneHourAgo = new Date(now - 60 * 60 * 1000);

      // Build filters based on user type
      const buildFilter = (baseFilter) => {
        if (userType === "dating") {
          return { ...baseFilter, userType: "DatingUser" };
        } else if (userType === "staff") {
          return { ...baseFilter, userType: { $in: ["Moderator", "Admin", "SuperAdmin"] } };
        } else if (userType === "moderator") {
          return { ...baseFilter, userType: "Moderator" };
        } else if (userType === "admin") {
          return { ...baseFilter, userType: { $in: ["Admin", "SuperAdmin"] } };
        }
        return baseFilter;
      };

      const [onlineCount, activeCount, totalUsers] = await Promise.all([
        BaseUser.countDocuments(buildFilter({
          "presence.lastSeen": { $gt: fiveMinutesAgo },
          "presence.status": "online",
          accountStatus: "active",
        })),
        BaseUser.countDocuments(buildFilter({
          "presence.lastSeen": { $gt: oneHourAgo },
          accountStatus: "active",
        })),
        BaseUser.countDocuments(buildFilter({ accountStatus: "active" })),
      ]);

      const stats = {
        onlineUsers: onlineCount,
        activeUsers: activeCount,
        totalUsers,
        userType: userType || "all",
        updatedAt: new Date().toISOString(),
      };

      // Cache the stats (only for "all" user type)
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

      // Get PresenceService metrics
      if (this.presenceService && this.presenceService.getMetrics) {
        metrics.presenceService = this.presenceService.getMetrics();
      }

      // Get Redis metrics if available
      if (this.presenceService?.redisService?.getMetrics) {
        metrics.redis = this.presenceService.redisService.getMetrics();
      }

      // Get database stats by user type
      const userTypes = ["all", "dating", "staff", "moderator", "admin"];
      const statsPromises = userTypes.map(async (type) => {
        const reqCopy = { ...req, query: { userType: type } };
        const stats = await this.getPresenceStats(reqCopy, { json: () => {} });
        return { [type]: stats?.data };
      });

      const statsResults = await Promise.all(statsPromises);
      metrics.database = Object.assign({}, ...statsResults);

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

      // Get from PresenceService
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
        // Clear for specific user
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

      // Clear local cache
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

      // Build filter
      const filter = {
        "presence.status": "online",
        "presence.lastSeen": { $lt: thresholdTime },
        accountStatus: "active",
      };

      // Add user type filter if specified
      if (userType === "dating") {
        filter.userType = "DatingUser";
      } else if (userType === "staff") {
        filter.userType = { $in: ["Moderator", "Admin", "SuperAdmin"] };
      }

      const staleUsers = await BaseUser.find(filter).select("_id presence userType");

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
            user.presence.status = "offline";
            await user.save({ validateBeforeSave: false });
            
            // Update PresenceService
            if (this.presenceService && this.presenceService.updateUserStatus) {
              await this.presenceService.updateUserStatus(user._id.toString(), "offline");
            }
            
            results.updated++;
            results.users.push({
              userId: user._id.toString(),
              userType: user.userType,
              lastSeen: user.presence.lastSeen,
            });
          } catch (error) {
            logger.error(`Failed to cleanup user ${user._id}:`, error);
          }
        });

        await Promise.all(updatePromises);
        
        // Clear cache
        this.statsCache.data = null;
      } else {
        results.users = staleUsers.map((user) => ({
          userId: user._id.toString(),
          userType: user.userType,
          lastSeen: user.presence.lastSeen,
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