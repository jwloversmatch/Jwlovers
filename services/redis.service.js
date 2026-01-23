const Redis = require("ioredis");

class RedisService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    this.redisConfig = {
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      enableOfflineQueue: true,
      connectTimeout: 10000,
      commandTimeout: 5000
    };
    
    this.pubClient = null;
    this.subClient = null;
    this.redisReady = false;
    this.metrics = {
      operations: 0,
      errors: 0,
      fallbacks: 0
    };
  }

  async init() {
    try {
      this.logger.info("🔄 Initializing Redis connections...");
      
      this.pubClient = new Redis(this.redisUrl, this.redisConfig);
      this.subClient = this.pubClient.duplicate();

      // Wait for connections with timeout
      await Promise.race([
        Promise.all([
          new Promise((resolve) => {
            this.pubClient.on("connect", () => {
              this.logger.info("✅ Redis Pub Client connected");
              resolve();
            });
          }),
          new Promise((resolve) => {
            this.subClient.on("connect", () => {
              this.logger.info("✅ Redis Sub Client connected");
              resolve();
            });
          })
        ]),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Redis connection timeout")), 10000)
        )
      ]);

      await this.pubClient.ping();
      this.redisReady = true;
      this.logger.info("✅ Redis connection test successful");

      // Setup event listeners
      this.setupEventListeners();

      return { pubClient: this.pubClient, subClient: this.subClient, ready: this.redisReady };
    } catch (error) {
      this.logger.error("❌ Redis initialization failed:", error);
      throw error;
    }
  }

  setupEventListeners() {
    this.pubClient.on("error", (err) => {
      this.logger.error("Redis Pub Client Error:", err);
      this.redisReady = false;
      this.metrics.errors++;
    });
    
    this.subClient.on("error", (err) => {
      this.logger.error("Redis Sub Client Error:", err);
      this.redisReady = false;
      this.metrics.errors++;
    });
    
    this.pubClient.on("end", () => {
      this.logger.warn("Redis Pub Client disconnected");
      this.redisReady = false;
    });
    
    this.subClient.on("end", () => {
      this.logger.warn("Redis Sub Client disconnected");
      this.redisReady = false;
    });
    
    this.pubClient.on("ready", () => {
      this.redisReady = true;
      this.logger.info("✅ Redis Pub Client ready");
    });
    
    this.subClient.on("ready", () => {
      this.logger.info("✅ Redis Sub Client ready");
    });
  }

  async safeOperation(operation, fallback = null, operationName = "redis_operation") {
    this.metrics.operations++;
    
    if (!this.redisReady || !this.pubClient) {
      this.logger.warn("⚠️ Redis not ready, using fallback");
      this.metrics.fallbacks++;
      return fallback;
    }
    
    try {
      return await operation();
    } catch (error) {
      this.logger.error(`Redis operation failed (${operationName}):`, error);
      this.metrics.errors++;
      return fallback;
    }
  }

  // ========== USER PRESENCE ==========
  async setUserOnline(userId, socketId, userData) {
    return this.safeOperation(async () => {
      const key = `${this.config.USER_PREFIX || 'user:presence:'}${userId}`;
      const timestamp = new Date().toISOString();
      
      // Use transaction for atomic operations
      const multi = this.pubClient.multi();
      
      // Store user details
      multi.hset(key, {
        socketId,
        status: "online",
        lastSeen: timestamp,
        userName: userData.userName || "Unknown",
        avatar: userData.avatar || "",
        connectedAt: timestamp,
        userId: userId
      });
      multi.expire(key, this.config.PRESENCE_TTL || 3600);
      
      // Add to online users sorted set (score = timestamp)
      const onlineSetKey = this.config.ONLINE_SET_KEY || 'online:users';
      multi.zadd(onlineSetKey, Date.now(), userId);
      multi.expire(onlineSetKey, (this.config.PRESENCE_TTL || 3600) + 60);
      
      // Track connections
      const connectionsKey = `${this.config.CONNECTION_PREFIX || 'user:connections:'}${userId}`;
      multi.incr(connectionsKey);
      multi.expire(connectionsKey, this.config.PRESENCE_TTL || 3600);
      
      const results = await multi.exec();
      return results ? true : false;
    }, false, "setUserOnline");
  }

  async setUserOffline(userId) {
    return this.safeOperation(async () => {
      const key = `${this.config.USER_PREFIX || 'user:presence:'}${userId}`;
      const onlineSetKey = this.config.ONLINE_SET_KEY || 'online:users';
      
      const multi = this.pubClient.multi();
      multi.del(key);
      multi.zrem(onlineSetKey, userId);
      
      // Decrement connections
      const connectionsKey = `${this.config.CONNECTION_PREFIX || 'user:connections:'}${userId}`;
      multi.decr(connectionsKey);
      multi.expire(connectionsKey, this.config.PRESENCE_TTL || 3600);
      
      const results = await multi.exec();
      return results ? true : false;
    }, false, "setUserOffline");
  }

  async getUserPresence(userId) {
    return this.safeOperation(async () => {
      const key = `${this.config.USER_PREFIX || 'user:presence:'}${userId}`;
      const data = await this.pubClient.hgetall(key);
      if (!data || Object.keys(data).length === 0) {
        return null;
      }
      return data;
    }, null, "getUserPresence");
  }

  async refreshUserHeartbeat(userId) {
    return this.safeOperation(async () => {
      const key = `${this.config.USER_PREFIX || 'user:presence:'}${userId}`;
      const exists = await this.pubClient.exists(key);
      if (exists) {
        await this.pubClient.hset(key, "lastSeen", new Date().toISOString());
        await this.pubClient.expire(key, this.config.PRESENCE_TTL || 3600);
        
        // Also update timestamp in sorted set
        const onlineSetKey = this.config.ONLINE_SET_KEY || 'online:users';
        await this.pubClient.zadd(onlineSetKey, Date.now(), userId);
        return true;
      }
      return false;
    }, false, "refreshUserHeartbeat");
  }

  async updateUserStatus(userId, status, customStatus = '') {
    return this.safeOperation(async () => {
      const key = `${this.config.USER_PREFIX || 'user:presence:'}${userId}`;
      const multi = this.pubClient.multi();
      multi.hset(key, 'status', status);
      if (customStatus) {
        multi.hset(key, 'customStatus', customStatus);
      }
      multi.hset(key, 'lastSeen', new Date().toISOString());
      multi.expire(key, this.config.PRESENCE_TTL || 3600);
      
      const results = await multi.exec();
      return results ? true : false;
    }, false, "updateUserStatus");
  }

  // ========== OFFLINE MESSAGES ==========
  async queueOfflineMessage(userId, message) {
    return this.safeOperation(async () => {
      const key = `${this.config.OFFLINE_PREFIX || 'offline:msg:'}${userId}`;
      await this.pubClient.rpush(key, JSON.stringify(message));
      await this.pubClient.expire(key, this.config.OFFLINE_TTL || 604800); // 7 days
      this.logger.info(`📦 Queued offline message for user ${userId}`);
      return true;
    }, false, "queueOfflineMessage");
  }

  async getOfflineMessages(userId) {
    return this.safeOperation(async () => {
      const key = `${this.config.OFFLINE_PREFIX || 'offline:msg:'}${userId}`;
      const lockKey = `offline_lock:${userId}`;

      // Try to acquire lock
      const lockAcquired = await this.pubClient.set(
        lockKey, 
        "1", 
        "NX", 
        "EX", 
        this.config.LOCK_TTL || 30
      );

      if (!lockAcquired) {
        this.logger.warn(`Lock not acquired for offline messages of user ${userId}`);
        return [];
      }

      let messages = [];
      try {
        messages = await this.pubClient.lrange(key, 0, -1);
        if (messages.length > 0) {
          await this.pubClient.del(key);
        }
      } finally {
        // Always release lock
        await this.pubClient.del(lockKey).catch(() => {});
      }

      return messages.map(msg => {
        try {
          return JSON.parse(msg);
        } catch (e) {
          return msg;
        }
      });
    }, [], "getOfflineMessages");
  }

  // ========== DUPLICATE DETECTION ==========
  async isDuplicateMessage(senderId, receiverId, content, windowMs = 2000) {
    const crypto = require("crypto");
    return this.safeOperation(async () => {
      const timestamp = Date.now();
      const contentHash = crypto
        .createHash("sha256")
        .update(content + timestamp.toString().slice(0, -3)) // Trim to seconds
        .digest("hex");
      
      const key = `${this.config.DUPLICATE_PREFIX || 'duplicate:'}${senderId}:${receiverId}:${contentHash}`;
      const exists = await this.pubClient.get(key);

      if (exists) {
        this.logger.warn(`⏭️ Duplicate message blocked: ${senderId} -> ${receiverId}`);
        return true;
      }

      await this.pubClient.setex(key, Math.ceil(windowMs / 1000), "1");
      return false;
    }, false, "isDuplicateMessage");
  }

  // ========== ONLINE USERS ==========
  async getOnlineUsers(limit = 100) {
    return this.safeOperation(async () => {
      const onlineSetKey = this.config.ONLINE_SET_KEY || 'online:users';
      
      // Get user IDs from sorted set (most recent first)
      const userIds = await this.pubClient.zrange(onlineSetKey, 0, limit - 1, 'REV');
      
      if (!userIds || userIds.length === 0) {
        return [];
      }
      
      // Use pipeline for batch operations
      const pipeline = this.pubClient.pipeline();
      userIds.forEach(userId => {
        const key = `${this.config.USER_PREFIX || 'user:presence:'}${userId}`;
        pipeline.hgetall(key);
      });
      
      const results = await pipeline.exec();
      
      return results
        .map(([err, data], index) => {
          if (err || !data || Object.keys(data).length === 0) return null;
          return {
            userId: userIds[index],
            name: data.userName || 'Unknown',
            status: data.status || 'online',
            avatar: data.avatar || '',
            lastSeen: data.lastSeen || new Date().toISOString(),
            socketId: data.socketId,
            connectedAt: data.connectedAt
          };
        })
        .filter(user => user && user.name && user.status === 'online');
    }, [], "getOnlineUsers");
  }

  // ========== CONNECTION MANAGEMENT ==========
  async canUserConnect(userId, maxConnections = 3) {
    return this.safeOperation(async () => {
      const connectionsKey = `${this.config.CONNECTION_PREFIX || 'user:connections:'}${userId}`;
      const currentConnections = await this.pubClient.get(connectionsKey) || 0;
      return parseInt(currentConnections) < maxConnections;
    }, true, "canUserConnect");
  }

  async isUserBlocked(userId) {
    return this.safeOperation(async () => {
      const blockedKey = `${this.config.BLOCK_PREFIX || 'user:blocked:'}${userId}`;
      const blocked = await this.pubClient.get(blockedKey);
      return blocked === "1";
    }, false, "isUserBlocked");
  }

  async getUserConnectionsCount(userId) {
    return this.safeOperation(async () => {
      const connectionsKey = `${this.config.CONNECTION_PREFIX || 'user:connections:'}${userId}`;
      const count = await this.pubClient.get(connectionsKey) || 0;
      return parseInt(count);
    }, 0, "getUserConnectionsCount");
  }

  // ========== UTILITY METHODS ==========
  async publish(channel, message) {
    return this.safeOperation(async () => {
      await this.pubClient.publish(channel, JSON.stringify(message));
      return true;
    }, false, "publish");
  }

  async subscribe(channel, callback) {
    return this.safeOperation(async () => {
      await this.subClient.subscribe(channel);
      this.subClient.on('message', (ch, msg) => {
        if (ch === channel) {
          try {
            callback(JSON.parse(msg));
          } catch (e) {
            callback(msg);
          }
        }
      });
      return true;
    }, false, "subscribe");
  }

  // ========== METRICS ==========
  getMetrics() {
    return {
      ...this.metrics,
      redisReady: this.redisReady,
      uptime: process.uptime()
    };
  }

  getClient() {
    return this.pubClient;
  }

  getSubClient() {
    return this.subClient;
  }

  isReady() {
    return this.redisReady;
  }

  async quit() {
    try {
      if (this.pubClient) await this.pubClient.quit();
      if (this.subClient) await this.subClient.quit();
      this.redisReady = false;
      this.logger.info("Redis connections closed");
    } catch (error) {
      this.logger.error("Error closing Redis connections:", error);
    }
  }
}

module.exports = RedisService;