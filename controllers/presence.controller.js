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
  // Define user types based on your actual discriminators
  USER_TYPES: {
    DATING: "DatingUser",
    MODERATOR: "ModeratorUser",
    ADMIN: "AdminUser",
    SUPER_ADMIN: "SuperAdminUser",
  },
  // Staff user types (from ROLES enum)
  STAFF_ROLES: [ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN],
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
    return BaseUser.findById(userId); // BaseUser finds all discriminators
  }

  async updateUserPresence(userId, updateData) {
    return BaseUser.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: false }
    );
  }

  // Helper to determine user type from role or userType field
  getUserType(user) {
    if (!user) return 'unknown';
    
    // Check userType discriminator first
    if (user.userType === CONFIG.USER_TYPES.DATING) {
      return 'dating';
    }
    
    // Check for staff roles
    if (user.role && CONFIG.STAFF_ROLES.includes(user.role)) {
      return 'staff';
    }
    
    // Default to dating for users with role 'user'
    return 'dating';
  }

  // Helper to check if user is staff
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
        // Fallback to database - BaseUser queries all discriminators
        const users = await BaseUser.find({
          _id: { $in: limitedIds },
        }).select("_id presence userType role");

        for (const userId of limitedIds) {
          const user = users.find(u => u._id.toString() === userId);
          if (user && user.presence) {
            // Check privacy settings for dating users
            const showOnline = this.shouldShowOnlineStatus(user, req.user);
            // Use ONLY the status field from database
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

  // Helper to check if online status should be shown (respects privacy settings)
  shouldShowOnlineStatus(user, requestingUser) {
    // Always show to self
    if (requestingUser && requestingUser.id === user._id.toString()) {
      return true;
    }
    
    // Check base privacy settings
    if (user.privacySettings?.showOnlineStatus === false) {
      return false;
    }
    
    // Check dating-specific privacy settings
    if (user.userType === CONFIG.USER_TYPES.DATING) {
      const showLastActive = user.datingPrivacySettings?.showLastActive || 'matches';
      
      if (showLastActive === 'nobody') return false;
      if (showLastActive === 'matches') {
        // Would need to check if requesting user is a match
        // For now, return false for non-self
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

      // Build base filter based on user type
      const baseFilter = {
        accountStatus: "active",
        "privacySettings.profileVisibility": { $ne: "private" },
      };

      // Add user type filter
      if (userType === "dating") {
        // Dating users are either userType: "DatingUser" OR role: "user"
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
        // Add online filter - use ONLY the status field from database
        const onlineFilter = {
          ...baseFilter,
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
            }).select("_id userType role");
            
            const validUserIds = dbUsers.map(u => u._id.toString());
            users = users.filter(u => validUserIds.includes(u.userId));
          }
        } else {
          // Database fallback - BaseUser queries all discriminators
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
              // NO isOnline field - use status only
              lastSeen: user.presence?.lastSeen,
              status: user.presence?.status || 'offline',
              userType: this.getUserType(user),
              role: user.role,
              showOnlineStatus: showOnline,
            };
          });
        }
      } else {
        // For offline or all status
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
            // NO isOnline field - use status only
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

        const showOnline = this.shouldShowOnlineStatus(user, { id: requestingUserId });

        presence = {
          userId: user._id.toString(),
          name: `${user.firstName} ${user.lastName}`,
          userName: user.userName,
          avatar: user.avatar,
          // NO isOnline field - use status only
          lastSeen: user.presence?.lastSeen,
          status: user.presence?.status || 'offline',
          userType: this.getUserType(user),
          role: user.role,
          showOnlineStatus: showOnline,
        };

        // Add dating-specific info if applicable
        if (user.userType === CONFIG.USER_TYPES.DATING && requestingUserId === userId) {
          presence.datingPrivacySettings = user.datingPrivacySettings;
          presence.datingStats = user.datingStats;
        }
        
        // Add staff-specific info if applicable
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
        // NO isOnline field
        lastSeen: user.presence?.lastSeen,
        lastActive: user.presence?.lastActive,
        status: user.presence?.status || 'offline',
        connections: this.presenceService?.getUserConnections?.(userId) || [],
        userType: this.getUserType(user),
        role: user.role,
        privacySettings: user.privacySettings,
      };

      // Add dating-specific info
      if (user.userType === CONFIG.USER_TYPES.DATING) {
        presenceData.datingPrivacySettings = user.datingPrivacySettings;
        presenceData.datingStats = user.datingStats;
        presenceData.datingNotificationSettings = user.datingNotificationSettings;
      }
      
      // Add staff-specific info
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
  async updateStatus(req, res) {
    try {
      const userId = req.user.id;
      const { status, online } = req.body;

      // Handle both 'status' and 'online' fields
      let finalStatus = status;
      if (online !== undefined) {
        finalStatus = online ? 'online' : 'offline';
      }

      if (finalStatus) {
        // Use correct enum values from your base schema
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

      // Initialize presence if it doesn't exist
      if (!user.presence) {
        user.presence = {
          status: finalStatus || "online",
          lastSeen: new Date(),
          lastActive: new Date(),
        };
      } else {
        // Update user
        if (finalStatus) {
          user.presence.status = finalStatus;
        }
        
        user.presence.lastSeen = new Date();
        user.presence.lastActive = new Date();
      }
      
      await user.save({ validateBeforeSave: false });

      // Update PresenceService
      if (this.presenceService && this.presenceService.updateUserStatus) {
        await this.presenceService.updateUserStatus(userId, finalStatus);
      }

      // Clear cache
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

      // Initialize presence if it doesn't exist
      if (!user.presence) {
        user.presence = {
          status: "online",
          lastSeen: new Date(),
          lastActive: new Date(),
        };
      } else {
        // Update last seen
        user.presence.lastSeen = new Date();
        user.presence.lastActive = new Date();
      }
      
      await user.save({ validateBeforeSave: false });

      // Update PresenceService
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

  async markOffline(req, res) {
    try {
      const userId = req.user.id;

      // Update PresenceService
      if (this.presenceService && this.presenceService.updateUserStatus) {
        await this.presenceService.updateUserStatus(userId, "offline");
      }

      // Update database using BaseUser (works for all discriminators)
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

      // Build filters based on user type
      const buildFilter = (baseFilter) => {
        if (userType === "dating") {
          // Dating users are either DatingUser type OR role: user
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
          "presence.status": "online", // Use status only
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

      // Add discriminator breakdown
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
            // Initialize presence if it doesn't exist
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
            
            // Update PresenceService
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
        
        // Clear cache
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