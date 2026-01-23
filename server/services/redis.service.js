const Redis = require("ioredis");
const crypto = require("crypto");
const CONFIG = require("../config/constants");
const logger = require("../utils/logger");

class RedisService {
  constructor() {
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
      logger.info("🔄 Initializing Redis connections...");
      
      this.pubClient = new Redis(this.redisUrl, this.redisConfig);
      this.subClient = this.pubClient.duplicate();

      await Promise.race([
        Promise.all([
          new Promise((resolve) => {
            this.pubClient.on("connect", () => {
              logger.info("✅ Redis Pub Client connected");
              resolve();
            });
          }),
          new Promise((resolve) => {
            this.subClient.on("connect", () => {
              logger.info("✅ Redis Sub Client connected");
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
      logger.info("✅ Redis connection test successful");

      this.setupEventListeners();
      return this;
    } catch (error) {
      logger.error("❌ Redis initialization failed:", error);
      throw error;
    }
  }

  setupEventListeners() {
    this.pubClient.on("error", (err) => {
      logger.error("Redis Pub Client Error:", err);
      this.redisReady = false;
      this.metrics.errors++;
    });
    
    this.subClient.on("error", (err) => {
      logger.error("Redis Sub Client Error:", err);
      this.redisReady = false;
      this.metrics.errors++;
    });
    
    this.pubClient.on("end", () => {
      logger.warn("Redis Pub Client disconnected");
      this.redisReady = false;
    });
    
    this.subClient.on("end", () => {
      logger.warn("Redis Sub Client disconnected");
      this.redisReady = false;
    });
  }

  async safeOperation(operation, fallback = null, operationName = "redis_operation") {
    this.metrics.operations++;
    
    if (!this.redisReady || !this.pubClient) {
      logger.warn("⚠️ Redis not ready, using fallback");
      this.metrics.fallbacks++;
      return fallback;
    }
    
    try {
      return await operation();
    } catch (error) {
      logger.error(`Redis operation failed (${operationName}):`, error);
      this.metrics.errors++;
      return fallback;
    }
  }

  async setUserOnline(userId, socketId, userData) {
    return this.safeOperation(async () => {
      const key = `${CONFIG.REDIS.USER_PREFIX}${userId}`;
      const timestamp = new Date().toISOString();
      
      const multi = this.pubClient.multi();
      
      multi.hset(key, {
        socketId,
        status: "online",
        lastSeen: timestamp,
        userName: userData.userName || "Unknown",
        avatar: userData.avatar || "",
        connectedAt: timestamp
      });
      multi.expire(key, CONFIG.REDIS.PRESENCE_TTL);
      
      multi.sadd(CONFIG.REDIS.ONLINE_SET_KEY, userId);
      multi.expire(CONFIG.REDIS.ONLINE_SET_KEY, CONFIG.REDIS.PRESENCE_TTL + 60);
      
      const connectionsKey = `${CONFIG.REDIS.CONNECTION_PREFIX}${userId}`;
      multi.incr(connectionsKey);
      multi.expire(connectionsKey, CONFIG.REDIS.PRESENCE_TTL);
      
      await multi.exec();
      return true;
    }, false, "setUserOnline");
  }

  async setUserOffline(userId) {
    return this.safeOperation(async () => {
      const key = `${CONFIG.REDIS.USER_PREFIX}${userId}`;
      
      const multi = this.pubClient.multi();
      multi.del(key);
      multi.srem(CONFIG.REDIS.ONLINE_SET_KEY, userId);
      
      const connectionsKey = `${CONFIG.REDIS.CONNECTION_PREFIX}${userId}`;
      multi.decr(connectionsKey);
      multi.expire(connectionsKey, CONFIG.REDIS.PRESENCE_TTL);
      
      await multi.exec();
      return true;
    }, false, "setUserOffline");
  }

  async getUserPresence(userId) {
    return this.safeOperation(async () => {
      const key = `${CONFIG.REDIS.USER_PREFIX}${userId}`;
      const data = await this.pubClient.hgetall(key);
      if (!data || Object.keys(data).length === 0) {
        return null;
      }
      return data;
    }, null, "getUserPresence");
  }

  async refreshUserHeartbeat(userId) {
    return this.safeOperation(async () => {
      const key = `${CONFIG.REDIS.USER_PREFIX}${userId}`;
      const exists = await this.pubClient.exists(key);
      if (exists) {
        await this.pubClient.hset(key, "lastSeen", new Date().toISOString());
        await this.pubClient.expire(key, CONFIG.REDIS.PRESENCE_TTL);
        return true;
      }
      return false;
    }, false, "refreshUserHeartbeat");
  }

  async queueOfflineMessage(userId, message) {
    return this.safeOperation(async () => {
      const key = `${CONFIG.REDIS.OFFLINE_PREFIX}${userId}`;
      await this.pubClient.rpush(key, JSON.stringify(message));
      await this.pubClient.expire(key, CONFIG.REDIS.OFFLINE_TTL);
      logger.info(`📦 Queued offline message for user ${userId}`);
      return true;
    }, false, "queueOfflineMessage");
  }

  async getOfflineMessages(userId) {
    return this.safeOperation(async () => {
      const key = `${CONFIG.REDIS.OFFLINE_PREFIX}${userId}`;
      const lockKey = `offline_lock:${userId}`;

      const lockAcquired = await this.pubClient.set(
        lockKey, 
        "1", 
        "NX", 
        "EX", 
        CONFIG.REDIS.LOCK_TTL
      );

      if (!lockAcquired) {
        logger.warn(`Lock not acquired for offline messages of user ${userId}`);
        return [];
      }

      let messages = [];
      try {
        messages = await this.pubClient.lrange(key, 0, -1);
        if (messages.length > 0) {
          await this.pubClient.del(key);
        }
      } finally {
        await this.pubClient.del(lockKey).catch(() => {});
      }

      const EncryptionService = require("./EncryptionService");
      return messages
        .map((msg) => {
          try {
            const parsed = JSON.parse(msg);
            if (parsed.isEncrypted && parsed.encryptionType === "server-side" && parsed.content) {
              const decrypted = EncryptionService.decryptForFrontend(parsed.content, parsed.encryptionType);
              if (decrypted && !decrypted.startsWith("🔒")) {
                parsed.content = decrypted;
                parsed.isEncrypted = false;
              } else {
                parsed.content = "🔒 [Encrypted message - legacy format]";
                parsed.isEncrypted = true;
                parsed.needsMigration = true;
              }
            }
            return parsed;
          } catch (parseError) {
            logger.error("Failed to parse offline message:", parseError);
            return null;
          }
        })
        .filter((msg) => msg !== null);
    }, [], "getOfflineMessages");
  }

  async isDuplicateMessage(senderId, receiverId, content, windowMs = 2000) {
    return this.safeOperation(async () => {
      const timestamp = Date.now();
      const contentHash = crypto
        .createHash("sha256")
        .update(content + timestamp.toString().slice(0, -3))
        .digest("hex");
      
      const key = `${CONFIG.REDIS.DUPLICATE_PREFIX}${senderId}:${receiverId}:${contentHash}`;
      const exists = await this.pubClient.get(key);

      if (exists) {
        logger.warn(`⏭️ Duplicate message blocked: ${senderId} -> ${receiverId}`);
        return true;
      }

      await this.pubClient.setex(key, Math.ceil(windowMs / 1000), "1");
      return false;
    }, false, "isDuplicateMessage");
  }

  async getOnlineUsers() {
    return this.safeOperation(async () => {
      const userIds = await this.pubClient.smembers(CONFIG.REDIS.ONLINE_SET_KEY);
      
      const pipeline = this.pubClient.pipeline();
      userIds.forEach(userId => {
        pipeline.hgetall(`${CONFIG.REDIS.USER_PREFIX}${userId}`);
      });
      
      const results = await pipeline.exec();
      
      return results
        .map(([err, data], index) => {
          if (err || !data) return null;
          return {
            userId: userIds[index],
            name: data.userName,
            status: data.status,
            avatar: data.avatar,
            lastSeen: data.lastSeen
          };
        })
        .filter(user => user && user.name);
    }, [], "getOnlineUsers");
  }

  async canUserConnect(userId) {
    return this.safeOperation(async () => {
      const connectionsKey = `${CONFIG.REDIS.CONNECTION_PREFIX}${userId}`;
      const currentConnections = await this.pubClient.get(connectionsKey) || 0;
      return parseInt(currentConnections) < CONFIG.RATE_LIMITS.MAX_CONNECTIONS_PER_USER;
    }, true, "canUserConnect");
  }

  async isUserBlocked(userId) {
    return this.safeOperation(async () => {
      const blockedKey = `${CONFIG.REDIS.BLOCK_PREFIX}${userId}`;
      const blocked = await this.pubClient.get(blockedKey);
      return blocked === "1";
    }, false, "isUserBlocked");
  }

  getMetrics() {
    return {
      ...this.metrics,
      redisReady: this.redisReady,
      uptime: process.uptime()
    };
  }

  async shutdown() {
    try {
      if (this.pubClient) await this.pubClient.quit();
      if (this.subClient) await this.subClient.quit();
      logger.info("✅ Redis connections closed");
    } catch (error) {
      logger.error("Error shutting down Redis:", error);
    }
  }
}

let redisServiceInstance = null;

const initRedis = async () => {
  if (!redisServiceInstance) {
    redisServiceInstance = new RedisService();
    await redisServiceInstance.init();
  }
  return redisServiceInstance;
};

module.exports = { RedisService, initRedis };