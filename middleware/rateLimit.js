const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const RedisStore = require("rate-limit-redis").RedisStore;
const redis = require("@config/redis");
const logger = require("@utils/logger");
const validator = require("validator");

// NEW: Import user models for rate limit adjustments
const { BaseUser } = require("@models/User");
const DatingUser = require("@models/User/datingUserSchema");

class RedisCircuitBreaker {
  constructor(failureThreshold = 3, resetTimeout = 60000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = "CLOSED";
    this.metrics = {
      totalRequests: 0,
      failedRequests: 0,
      stateTransitions: 0,
    };
  }

  async execute(operation) {
    this.metrics.totalRequests++;

    if (this.state === "OPEN") {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure > this.resetTimeout) {
        this.state = "HALF_OPEN";
        this.metrics.stateTransitions++;
        logger.info("Rate limit circuit breaker transitioning to HALF_OPEN");
      } else {
        this.metrics.failedRequests++;
        throw new Error("Circuit breaker is OPEN");
      }
    }

    try {
      const result = await operation();

      if (this.state === "HALF_OPEN") {
        this.state = "CLOSED";
        this.failureCount = 0;
        this.metrics.stateTransitions++;
        logger.info("Rate limit circuit breaker reset to CLOSED");
      }

      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      this.metrics.failedRequests++;

      if (this.failureCount >= this.failureThreshold) {
        this.state = "OPEN";
        this.metrics.stateTransitions++;
        logger.error(
          `Rate limit circuit breaker OPEN after ${this.failureCount} failures`,
          {
            error: error.message,
            lastFailureTime: new Date(this.lastFailureTime).toISOString(),
          },
        );
      }

      throw error;
    }
  }

  getStats() {
    return {
      ...this.metrics,
      state: this.state,
      failureCount: this.failureCount,
      isOpen: this.state === "OPEN",
      uptime: this.lastFailureTime ? Date.now() - this.lastFailureTime : null,
    };
  }

  reset() {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.metrics.stateTransitions++;
    logger.info("Rate limit circuit breaker manually reset");
  }
}

const redisCircuitBreaker = new RedisCircuitBreaker();

const createEnhancedRedisStore = () => {
  const memoryStore = new Map();
  const metrics = {
    redisHits: 0,
    memoryFallbacks: 0,
    errors: 0,
    lastFallbackTime: null,
  };

  // Helper function to execute Redis commands with proper error handling
  const executeRedisCommand = async (command, ...params) => {
    try {
      const client = redis.getClient();

      if (!client || !client.isReady) {
        throw new Error("Redis client not available or not ready");
      }

      const startTime = Date.now();
      let result;

      switch (command.toLowerCase()) {
        case "set":
          if (params.length >= 3) {
            // set key value EX seconds
            result = await client.set(params[0], params[1], { EX: params[2] });
          } else {
            result = await client.set(params[0], params[1]);
          }
          break;
        case "get":
          result = await client.get(params[0]);
          break;
        case "incr":
          result = await client.incr(params[0]);
          break;
        case "incrby":
          result = await client.incrBy(params[0], parseInt(params[1]));
          break;
        case "del":
          result = await client.del(params);
          break;
        case "expire":
          result = await client.expire(params[0], parseInt(params[1]));
          break;
        case "exists":
          result = await client.exists(params);
          break;
        case "eval":
          // Handle Lua scripts
          result = await client.eval(params[0], {
            keys: params[1] || [],
            arguments: params[2] || [],
          });
          break;
        default:
          // Try generic sendCommand for other commands
          try {
            result = await client.sendCommand([command, ...params]);
          } catch (sendError) {
            // If sendCommand fails, log and return null
            logger.warn(
              `Redis command ${command} not supported via sendCommand`,
            );
            return null;
          }
      }

      const duration = Date.now() - startTime;
      if (duration > 100) {
        logger.warn(`Slow Redis command: ${command} took ${duration}ms`);
      }

      metrics.redisHits++;
      return result;
    } catch (error) {
      metrics.errors++;
      metrics.memoryFallbacks++;
      metrics.lastFallbackTime = Date.now();

      logger.warn("Redis command failed, using memory fallback:", {
        command,
        error: error.message,
        memoryFallbacks: metrics.memoryFallbacks,
      });

      return null; // Return null to trigger memory fallback
    }
  };

  // Create RedisStore with proper sendCommand wrapper
  const store = new RedisStore({
    sendCommand: async (...args) => {
      try {
        const result = await redisCircuitBreaker.execute(async () => {
          return await executeRedisCommand(...args);
        });
        return result;
      } catch (error) {
        // Circuit breaker is open or operation failed
        metrics.errors++;
        metrics.memoryFallbacks++;
        metrics.lastFallbackTime = Date.now();
        logger.warn("Circuit breaker triggered for Redis command:", {
          command: args[0],
          error: error.message,
        });
        return null; // Trigger memory fallback
      }
    },
    prefix: "rl:",
  });

  // Overwrite increment method to handle Redis failures gracefully
  const originalIncrement = store.increment.bind(store);

  store.increment = async (key, windowMs, opts = {}) => {
    try {
      const result = await originalIncrement(key, windowMs, opts);
      return result;
    } catch (error) {
      metrics.memoryFallbacks++;
      metrics.lastFallbackTime = Date.now();

      logger.warn("Rate limit increment failed, using memory fallback:", {
        key,
        error: error.message,
        totalMemoryFallbacks: metrics.memoryFallbacks,
      });

      // Fallback to in-memory counter with sliding window
      const memoryKey = `memory:${key}`;
      const now = Date.now();

      // Initialize if not exists
      if (!memoryStore.has(memoryKey)) {
        memoryStore.set(memoryKey, {
          hits: [],
          resetTime: now + windowMs,
          lastCleanup: now,
        });
      }

      const data = memoryStore.get(memoryKey);

      // Clean old entries (sliding window)
      const cutoff = now - windowMs;
      data.hits = data.hits.filter((timestamp) => timestamp > cutoff);

      // Add current hit
      data.hits.push(now);
      data.resetTime = now + windowMs;

      // Periodic cleanup of expired keys
      if (now - data.lastCleanup > 60000) {
        for (const [k, d] of memoryStore.entries()) {
          if (now > d.resetTime + 60000) {
            memoryStore.delete(k);
          }
        }
        data.lastCleanup = now;
      }

      const totalHits = data.hits.length;

      return {
        totalHits,
        resetTime: data.resetTime,
      };
    }
  };

  // Add method to get store metrics
  store.getMetrics = () => ({
    ...metrics,
    memoryStoreSize: memoryStore.size,
    circuitBreaker: redisCircuitBreaker.getStats(),
    redisStatus: redis.getClient()?.isReady ? "ready" : "not ready",
  });

  // Add method to clear memory store
  store.clearMemoryStore = () => {
    const size = memoryStore.size;
    memoryStore.clear();
    logger.info(`Cleared memory rate limit store (${size} entries)`);
  };

  // Add method to reset Redis connection
  store.resetRedisConnection = async () => {
    try {
      const client = redis.getClient();
      if (client) {
        await client.quit();
        logger.info("Redis connection reset requested");
      }
    } catch (error) {
      logger.error("Failed to reset Redis connection:", error);
    }
  };

  return store;
};

// NEW: Helper function to get user info for rate limit adjustments
const getUserRateLimitInfo = async (userId) => {
  try {
    const baseUser = await BaseUser.findById(userId).lean();
    if (!baseUser) return null;

    let datingUser = null;
    let isPremium = false;
    let boostMultiplier = 1;

    if (baseUser.userType === "DatingUser") {
      datingUser = await DatingUser.findById(userId).lean();
      if (datingUser) {
        isPremium = datingUser.isPremium;
        // Check if boost is active
        if (
          datingUser.boost?.isActive &&
          datingUser.boost.expiresAt > new Date()
        ) {
          boostMultiplier = datingUser.boost.multiplier || 2;
        }
      }
    }

    return {
      baseUser,
      datingUser,
      isPremium,
      boostMultiplier,
      role: baseUser.role,
      userType: baseUser.userType,
      accountStatus: baseUser.accountStatus,
    };
  } catch (error) {
    logger.warn("Failed to get user rate limit info:", error.message);
    return null;
  }
};

const getRateLimitConfig = () => {
  const env = process.env.NODE_ENV || "development";

  const baseConfigs = {
    production: {
      api: {
        windowMs: 15 * 60 * 1000,
        max: parseInt(process.env.RATE_LIMIT_API_MAX) || 100,
        // NEW: Different limits based on user type
        userTypeLimits: {
          DatingUser: 150,
          Staff: 300,
          Admin: 500,
        },
        premiumMultiplier: 2, // Premium users get 2x limit
        boostMultiplier: 3, // Boost active gets 3x limit
      },
      auth: {
        windowMs: 60 * 60 * 1000,
        max: parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 10,
        blockDuration: 30 * 60 * 1000,
        // NEW: Higher limits for staff auth
        roleLimits: {
          moderator: 20,
          admin: 50,
          super_admin: 100,
        },
      },
      messages: {
        windowMs: 60 * 1000,
        max: parseInt(process.env.RATE_LIMIT_MESSAGES_MAX) || 60,
        blockDuration: 5 * 60 * 1000,
        // NEW: Premium users can send more messages
        premiumMultiplier: 3,
      },
      registration: {
        windowMs: 24 * 60 * 60 * 1000,
        max: parseInt(process.env.RATE_LIMIT_REGISTRATION_MAX) || 5,
        blockDuration: 24 * 60 * 60 * 1000,
      },
      socket: {
        windowMs: 60 * 1000,
        max: parseInt(process.env.RATE_LIMIT_SOCKET_MAX) || 120,
        // NEW: Premium users get higher socket limits
        premiumMultiplier: 2,
      },
      dating: {
        windowMs: 60 * 1000,
        max: parseInt(process.env.RATE_LIMIT_DATING_MAX) || 30,
        // NEW: Dating-specific limits
        swipesPerMinute: 60,
        likesPerHour: 100,
        superLikesPerDay: 5,
        premiumSuperLikesPerDay: 25,
      },
    },
    development: {
      api: {
        windowMs: 15 * 60 * 1000,
        max: 1000,
        userTypeLimits: {
          DatingUser: 2000,
          Staff: 3000,
          Admin: 5000,
        },
        premiumMultiplier: 2,
        boostMultiplier: 3,
      },
      auth: {
        windowMs: 60 * 60 * 1000,
        max: 100,
        roleLimits: {
          moderator: 200,
          admin: 500,
          super_admin: 1000,
        },
      },
      messages: {
        windowMs: 60 * 1000,
        max: 600,
        premiumMultiplier: 3,
      },
      registration: {
        windowMs: 24 * 60 * 60 * 1000,
        max: 50,
      },
      socket: {
        windowMs: 60 * 1000,
        max: 1200,
        premiumMultiplier: 2,
      },
      dating: {
        windowMs: 60 * 1000,
        max: 300,
        swipesPerMinute: 600,
        likesPerHour: 1000,
        superLikesPerDay: 50,
        premiumSuperLikesPerDay: 250,
      },
    },
    test: {
      api: {
        windowMs: 15 * 60 * 1000,
        max: 5000,
        userTypeLimits: {
          DatingUser: 10000,
          Staff: 15000,
          Admin: 20000,
        },
        premiumMultiplier: 2,
        boostMultiplier: 3,
      },
      auth: {
        windowMs: 60 * 60 * 1000,
        max: 500,
        roleLimits: {
          moderator: 1000,
          admin: 2000,
          super_admin: 5000,
        },
      },
      messages: {
        windowMs: 60 * 1000,
        max: 3000,
        premiumMultiplier: 3,
      },
      registration: {
        windowMs: 24 * 60 * 60 * 1000,
        max: 100,
      },
      socket: {
        windowMs: 60 * 1000,
        max: 5000,
        premiumMultiplier: 2,
      },
      dating: {
        windowMs: 60 * 1000,
        max: 1500,
        swipesPerMinute: 3000,
        likesPerHour: 5000,
        superLikesPerDay: 250,
        premiumSuperLikesPerDay: 1250,
      },
    },
  };

  // Get config for current environment, fallback to development
  const config = baseConfigs[env] || baseConfigs.development;

  // Override with environment variables if present
  const overrides = [
    "RATE_LIMIT_API_MAX",
    "RATE_LIMIT_AUTH_MAX",
    "RATE_LIMIT_MESSAGES_MAX",
    "RATE_LIMIT_REGISTRATION_MAX",
    "RATE_LIMIT_SOCKET_MAX",
    "RATE_LIMIT_DATING_MAX",
  ];

  overrides.forEach((envVar) => {
    if (process.env[envVar]) {
      const key = envVar
        .toLowerCase()
        .replace("rate_limit_", "")
        .replace("_max", "");
      config[key].max = parseInt(process.env[envVar]);
    }
  });

  logger.info(`📊 Rate limit config loaded for ${env} environment`);
  logger.info(
    `   API: ${config.api.max} requests/${config.api.windowMs / 60000} minutes`,
  );
  logger.info(
    `   Dating: ${config.dating.max} actions/${config.dating.windowMs / 60000} minutes`,
  );
  logger.info(`   Premium multiplier: ${config.api.premiumMultiplier}x`);
  logger.info(`   Boost multiplier: ${config.api.boostMultiplier}x`);

  return config;
};

const config = getRateLimitConfig();

const RATE_LIMIT_CONFIG = {
  production: getRateLimitConfig(),
  development: getRateLimitConfig(),
  test: getRateLimitConfig(),
};

// NEW: Improved rate limit handler with user-specific messages
const rateLimitHandler = (req, res, options) => {
  const retryAfter = Math.ceil(options.windowMs / 1000);

  // Determine message based on endpoint and user type
  let message = options.message || "Too many requests, please try again later.";

  const isDatingEndpoint =
    req.path.includes("/dating") || req.path.includes("/swipe");
  const isAuthEndpoint =
    req.path.includes("/auth") || req.path.includes("/login");
  const isProfileEndpoint = req.path.includes("/profile");

  if (isDatingEndpoint) {
    message = "Too many dating actions. Please slow down and be thoughtful.";
  } else if (isAuthEndpoint) {
    message = "Too many authentication attempts. Please try again later.";
  } else if (isProfileEndpoint) {
    message =
      "Too many profile updates. Please wait before making more changes.";
  }

  // Log with user context
  logger.warn("Rate limit exceeded", {
    path: req.path,
    ip: req.ip,
    userAgent: req.headers["user-agent"]?.substring(0, 100),
    userId: req.user?.id || req.userId,
    userRole: req.user?.role || req.userRole,
    userType: req.user?.userType || req.userType,
    key: options.key,
    retryAfter,
    limit: options.limit || options.max,
    userLimit: options.userLimit || "N/A",
  });

  const limitValue = options.limit ?? options.max;
  const retryAfter = Math.ceil(options.windowMs / 1000);
  // Set rate limit headers
  res.setHeader("Retry-After", retryAfter);
  if (limitValue != null) {
    res.setHeader("X-RateLimit-Limit", limitValue);
    res.setHeader("X-RateLimit-Remaining", 0);
    res.setHeader(
      "X-RateLimit-Reset",
      Math.floor(Date.now() / 1000) + retryAfter,
    );
  }

  // Add user-specific info if available
  if (req.user?.userType) {
    res.setHeader("X-RateLimit-User-Type", req.user.userType);
  }
  if (req.user?.dating?.isPremium) {
    res.setHeader("X-RateLimit-Premium", "true");
  }

  res.status(429).json({
    success: false,
    error: message,
    code: "RATE_LIMIT_EXCEEDED",
    retryAfter,
    path: req.path,
    userType: req.user?.userType,
    isPremium: req.user?.dating?.isPremium || false,
    timestamp: new Date().toISOString(),
    suggestion: isDatingEndpoint
      ? "Dating should be about quality, not quantity. Take your time!"
      : "Consider upgrading to premium for higher limits.",
    documentation:
      process.env.API_DOCS_URL || "https://docs.example.com/rate-limiting",
  });
};

// NEW: Enhanced skip function with user type consideration
const shouldSkipRateLimit = (req) => {
  const skipRoutes = ["/health", "/metrics", "/status", "/docs", "/api-docs"];

  // Skip health checks and metrics
  if (skipRoutes.some((route) => req.path.startsWith(route))) {
    return true;
  }

  // Skip for whitelisted IPs (admin, internal services)
  const whitelistedIPs = (process.env.RATE_LIMIT_WHITELIST_IPS || "")
    .split(",")
    .filter((ip) => ip.trim());
  if (whitelistedIPs.includes(req.ip)) {
    logger.debug(`Rate limit skipped for whitelisted IP: ${req.ip}`);
    return true;
  }

  const isPrivateIP = (ip) => {
    if (ip === "::1" || ip === "127.0.0.1") return true;

    if (ip.includes(":")) {
      // IPv6 localhost
      return ip === "::ffff:127.0.0.1" || ip === "0:0:0:0:0:0:0:1";
    }

    const parts = ip.split(".").map(Number);
    return (
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254)
    );
  };

  if (
    isPrivateIP(req.ip) &&
    process.env.SKIP_RATE_LIMIT_FOR_PRIVATE_IPS === "true"
  ) {
    return true;
  }

  // NEW: Skip for super admins
  if (req.user?.role === "super_admin") {
    return true;
  }

  // Skip for API keys with unlimited access
  const apiKey = req.headers["x-api-key"];
  const unlimitedKeys = (process.env.UNLIMITED_API_KEYS || "")
    .split(",")
    .filter((key) => key.trim());

  if (apiKey && unlimitedKeys.includes(apiKey)) {
    logger.debug(
      `Rate limit skipped for unlimited API key: ${apiKey.substring(0, 8)}...`,
    );
    return true;
  }

  // Skip for emergency access tokens
  const emergencyToken = req.headers["x-emergency-token"];
  if (emergencyToken && emergencyToken === process.env.EMERGENCY_BYPASS_TOKEN) {
    logger.warn(`Emergency rate limit bypass used for IP: ${req.ip}`);
    return true;
  }

  return false;
};

// NEW: Enhanced key generator with user type and premium status
const getKeyGenerator = (type) => {
  switch (type) {
    case "auth":
      return async (req) => {
        const email = req.body?.email;
        const userType = req.body?.userType || "DatingUser";

        if (email && validator.isEmail(email)) {
          return `auth:${ipKeyGenerator(req)}:${email.toLowerCase().trim()}:${userType}`;
        }
        return `auth:${ipKeyGenerator(req)}:${userType}`;
      };

    case "registration":
      return async (req) => {
        const email = req.body?.email;
        const userType = req.body?.userType || "DatingUser";

        if (email && validator.isEmail(email)) {
          return `reg:${ipKeyGenerator(req)}:${email.toLowerCase().trim()}:${userType}`;
        }
        return `reg:${ipKeyGenerator(req)}:${userType}`;
      };

    case "messages":
      return async (req) => {
        const userId = req.user?.id;
        const conversationId =
          req.params?.conversationId || req.body?.conversationId;
        const userType = req.user?.userType || "unknown";

        if (userId && conversationId) {
          return `msg:user:${userId}:type:${userType}:conv:${conversationId}`;
        }

        return userId
          ? `msg:user:${userId}:type:${userType}`
          : `msg:ip:${ipKeyGenerator(req)}`;
      };

    case "user":
      return async (req) => {
        if (req.user?.id) {
          const userType = req.user.userType || "unknown";
          const isPremium = req.user.dating?.isPremium ? "premium" : "free";
          return `user:${req.user.id}:type:${userType}:tier:${isPremium}`;
        }
        return `ip:${ipKeyGenerator(req)}`;
      };

    case "dating":
      return async (req) => {
        const userId = req.user?.id;
        const action = req.body?.action || "swipe";
        const userType = req.user?.userType || "unknown";
        const isPremium = req.user?.dating?.isPremium ? "premium" : "free";

        if (userId) {
          return `dating:${action}:user:${userId}:type:${userType}:tier:${isPremium}`;
        }
        return `dating:${action}:ip:${ipKeyGenerator(req)}`;
      };

    default:
      return async (req) => {
        const apiKey = req.headers["x-api-key"];
        const userType = req.user?.userType || "anonymous";

        return apiKey
          ? `${ipKeyGenerator(req)}:${apiKey}:type:${userType}`
          : `${ipKeyGenerator(req)}:type:${userType}`;
      };
  }
};

// NEW: Dating-specific key generators
const getDatingKeyGenerator = (action) => {
  return async (req) => {
    const userId = req.user?.id;
    const userType = req.user?.userType || "unknown";
    const isPremium = req.user?.dating?.isPremium ? "premium" : "free";

    if (userId) {
      return `dating:${action}:user:${userId}:type:${userType}:tier:${isPremium}`;
    }
    return `dating:${action}:ip:${ipKeyGenerator(req)}`;
  };
};

const getUploadKeyGenerator = () => {
  return async (req) => {
    const userId = req.user?.id;
    const userType = req.user?.userType || "unknown";
    const isPremium = req.user?.dating?.isPremium ? "premium" : "free";

    return userId
      ? `upload:user:${userId}:type:${userType}:tier:${isPremium}`
      : `upload:ip:${ipKeyGenerator(req)}`;
  };
};

const getSearchKeyGenerator = () => {
  return async (req) => {
    const userId = req.user?.id;
    const userType = req.user?.userType || "unknown";
    const isPremium = req.user?.dating?.isPremium ? "premium" : "free";

    return userId
      ? `search:user:${userId}:type:${userType}:tier:${isPremium}`
      : `search:ip:${ipKeyGenerator(req)}`;
  };
};

const getProfileViewKeyGenerator = () => {
  return async (req) => {
    const profileId = req.params?.userId || req.params?.id;
    const userId = req.user?.id;
    const userType = req.user?.userType || "unknown";

    if (userId) {
      return `profile:view:user:${userId}:type:${userType}:profile:${profileId || "general"}`;
    }
    return `profile:view:ip:${ipKeyGenerator(req)}:profile:${profileId || "general"}`;
  };
};

const getPasswordResetKeyGenerator = () => {
  return async (req) => {
    const email = req.body?.email;
    const userType = req.body?.userType || "DatingUser";

    if (email && validator.isEmail(email)) {
      return `password_reset:${ipKeyGenerator(req)}:${email.toLowerCase().trim()}:type:${userType}`;
    }
    return `password_reset:${ipKeyGenerator(req)}:type:${userType}`;
  };
};

const getEmailResendKeyGenerator = () => {
  return async (req) => {
    const email = req.body?.email;
    const userType = req.body?.userType || "DatingUser";

    if (email && validator.isEmail(email)) {
      return `email_resend:${ipKeyGenerator(req)}:${email.toLowerCase().trim()}:type:${userType}`;
    }
    return `email_resend:${ipKeyGenerator(req)}:type:${userType}`;
  };
};

const getProfileUpdateKeyGenerator = () => {
  return async (req) => {
    const userId = req.user?.id;
    const userType = req.user?.userType || "unknown";
    const isPremium = req.user?.dating?.isPremium ? "premium" : "free";

    return userId
      ? `profile_update:user:${userId}:type:${userType}:tier:${isPremium}`
      : `profile_update:ip:${ipKeyGenerator(req)}`;
  };
};

// NEW: Helper function to calculate dynamic limits based on user info
const calculateDynamicLimit = async (req, baseLimit, config) => {
  let limit = baseLimit;

  // If we have user info, apply multipliers
  if (req.user?.id) {
    const userInfo = await getUserRateLimitInfo(req.user.id);

    if (userInfo) {
      // Apply user type multiplier
      if (config.userTypeLimits && config.userTypeLimits[userInfo.userType]) {
        limit = config.userTypeLimits[userInfo.userType];
      }

      // Apply role-based limits for auth
      if (config.roleLimits && config.roleLimits[userInfo.role]) {
        limit = config.roleLimits[userInfo.role];
      }

      // Apply premium multiplier
      if (userInfo.isPremium && config.premiumMultiplier) {
        limit = Math.floor(limit * config.premiumMultiplier);
      }

      // Apply boost multiplier (stackable with premium)
      if (userInfo.boostMultiplier > 1 && config.boostMultiplier) {
        limit = Math.floor(limit * userInfo.boostMultiplier);
      }
    }
  }

  return limit;
};

const createStore = () => {
  try {
    const client = redis.getClient();
    if (client && client.isReady) {
      logger.info("Using Redis store for rate limiting");
      return createEnhancedRedisStore();
    } else {
      logger.warn("Redis not available, using memory store for rate limiting");
      return undefined;
    }
  } catch (error) {
    logger.error("Failed to create rate limit store:", error);
    return undefined;
  }
};

const rateLimitStore = createStore();

// NEW: Enhanced limiter with dynamic limits
const createDynamicLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    baseMax = 100,
    message = "Too many requests.",
    keyGenerator = getKeyGenerator("api"),
    configPath = "api", // Which config section to use
    skip = shouldSkipRateLimit,
    skipSuccessfulRequests = false,
    blockDuration,
  } = options;

  return rateLimit({
    windowMs,
    max: async (req) => {
      // Calculate dynamic limit based on user
      const configSection = config[configPath] || config.api;
      const limit = await calculateDynamicLimit(req, baseMax, configSection);

      // Store the calculated limit for logging
      req.calculatedRateLimit = limit;
      req.rateLimitConfig = configPath;

      return limit;
    },
    message,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
    skipSuccessfulRequests,
    handler: rateLimitHandler,
    keyGenerator,
    store: rateLimitStore,
    validate: false,
    ...(blockDuration && { blockDuration }),
  });
};

// Updated limiters using the new dynamic system
const apiLimiter = createDynamicLimiter({
  windowMs: config.api.windowMs,
  baseMax: config.api.max,
  message: "Too many API requests.",
  configPath: "api",
  keyGenerator: getKeyGenerator("api"),
});

const authLimiter = createDynamicLimiter({
  windowMs: config.auth.windowMs,
  baseMax: config.auth.max,
  message: "Too many authentication attempts.",
  configPath: "auth",
  keyGenerator: getKeyGenerator("auth"),
  skipSuccessfulRequests: true,
});

// NEW: Dating-specific limiter
const datingLimiter = createDynamicLimiter({
  windowMs: config.dating.windowMs,
  baseMax: config.dating.max,
  message: "Too many dating actions.",
  configPath: "dating",
  keyGenerator: getKeyGenerator("dating"),
});

const messageLimiter = createDynamicLimiter({
  windowMs: config.messages.windowMs,
  baseMax: config.messages.max,
  message: "Message sending rate limit exceeded.",
  configPath: "messages",
  keyGenerator: getKeyGenerator("messages"),
});

const registrationLimiter = createDynamicLimiter({
  windowMs: config.registration.windowMs,
  baseMax: config.registration.max,
  message: "Too many registration attempts.",
  configPath: "registration",
  keyGenerator: getKeyGenerator("registration"),
});

const uploadLimiter = createDynamicLimiter({
  windowMs: 60 * 60 * 1000,
  baseMax: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX) || 50,
  message: "Too many uploads.",
  keyGenerator: getUploadKeyGenerator(),
});

const searchLimiter = createDynamicLimiter({
  windowMs: 60 * 1000,
  baseMax: parseInt(process.env.RATE_LIMIT_SEARCH_MAX) || 30,
  message: "Too many search requests.",
  keyGenerator: getSearchKeyGenerator(),
});

const profileViewLimiter = createDynamicLimiter({
  windowMs: 60 * 1000,
  baseMax: parseInt(process.env.RATE_LIMIT_PROFILE_VIEWS_MAX) || 60,
  message: "Too many profile views.",
  keyGenerator: getProfileViewKeyGenerator(),
});

const passwordResetLimiter = createDynamicLimiter({
  windowMs: 60 * 60 * 1000,
  baseMax: 5,
  message: "Too many password reset requests.",
  keyGenerator: getPasswordResetKeyGenerator(),
});

const emailResendLimiter = createDynamicLimiter({
  windowMs: 60 * 60 * 1000,
  baseMax: 3,
  message: "Too many verification email requests.",
  keyGenerator: getEmailResendKeyGenerator(),
});

const profileUpdateLimiter = createDynamicLimiter({
  windowMs: 15 * 60 * 1000,
  baseMax: 20,
  message: "Too many profile updates.",
  keyGenerator: getProfileUpdateKeyGenerator(),
});

// NEW: Dating action specific limiters
const swipeLimiter = createDynamicLimiter({
  windowMs: config.dating.windowMs,
  baseMax: config.dating.swipesPerMinute,
  message: "Too many swipes. Take your time!",
  keyGenerator: getDatingKeyGenerator("swipe"),
});

const likeLimiter = createDynamicLimiter({
  windowMs: 60 * 60 * 1000,
  baseMax: config.dating.likesPerHour,
  message: "Too many likes. Be selective!",
  keyGenerator: getDatingKeyGenerator("like"),
});

const superLikeLimiter = createDynamicLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  baseMax: async (req) => {
    // Different limits for premium vs free users
    const isPremium = req.user?.dating?.isPremium;
    return isPremium
      ? config.dating.premiumSuperLikesPerDay
      : config.dating.superLikesPerDay;
  },
  message: "Daily super like limit reached.",
  keyGenerator: getDatingKeyGenerator("super_like"),
});

const rateLimitInfoMiddleware = (req, res, next) => {
  // Store original send function
  const originalSend = res.send;

  res.send = function (body) {
    // Add rate limit info headers
    if (req.rateLimit && typeof req.rateLimit === "object") {
      try {
        const limit =
          req.rateLimit.limit || req.calculatedRateLimit || req.rateLimit.max;
        const remaining =
          req.rateLimit.remaining ||
          (limit !== undefined ? limit - (req.rateLimit.used || 0) : undefined);

        if (limit !== undefined && limit !== null) {
          res.setHeader("X-RateLimit-Limit", limit);
        }

        if (remaining !== undefined && remaining !== null) {
          res.setHeader("X-RateLimit-Remaining", remaining);
        }

        if (req.rateLimit.resetTime) {
          const reset = Math.ceil(req.rateLimit.resetTime.getTime() / 1000);
          res.setHeader("X-RateLimit-Reset", reset);
        }

        // Add user-specific headers
        if (req.user?.userType) {
          res.setHeader("X-RateLimit-User-Type", req.user.userType);
        }
        if (req.user?.dating?.isPremium) {
          res.setHeader("X-RateLimit-Premium", "true");
        }
        if (req.rateLimitConfig) {
          res.setHeader("X-RateLimit-Config", req.rateLimitConfig);
        }
      } catch (error) {
        logger.debug("Error setting rate limit headers:", error.message);
      }
    }

    return originalSend.call(this, body);
  };

  next();
};

// NEW: Enhanced socket rate limiting with user type support
const socketRateLimit = (socket, next) => {
  const userId = socket.user?.id;
  const userType = socket.user?.userType;
  const isPremium = socket.user?.dating?.isPremium;
  const ip = socket.handshake.address;

  if (!userId) {
    return next(new Error("Authentication required for rate limiting"));
  }

  const key = `socket:user:${userId}:type:${userType}`;
  const ipKey = `socket:ip:${ip}`;
  const windowMs = config.socket.windowMs;

  // Calculate dynamic limits
  let userMax = config.socket.max;
  if (isPremium && config.socket.premiumMultiplier) {
    userMax = Math.floor(userMax * config.socket.premiumMultiplier);
  }
  const ipMax = Math.floor(config.socket.max * 0.5);

  const now = Date.now();

  redisCircuitBreaker
    .execute(async () => {
      const client = redis.getClient();

      if (!client || !client.isReady) {
        logger.warn("Redis not available for socket rate limiting");
        return next(); // Allow if Redis is down
      }

      try {
        // Use Redis pipeline for efficiency
        const pipeline = client.multi();

        // User-based rate limiting
        pipeline.zadd(key, now, `event:${now}:${Math.random()}`);
        pipeline.zremrangebyscore(key, 0, now - windowMs);
        pipeline.zcard(key);
        pipeline.expire(key, Math.ceil(windowMs / 1000));

        // IP-based rate limiting
        pipeline.zadd(ipKey, now, `ip:${now}:${Math.random()}`);
        pipeline.zremrangebyscore(ipKey, 0, now - windowMs);
        pipeline.zcard(ipKey);
        pipeline.expire(ipKey, Math.ceil(windowMs / 1000));

        const results = await pipeline.exec();
        const userCount = results[2][1];
        const ipCount = results[5][1];

        // Check both limits
        if (userCount > userMax) {
          logger.warn(
            `Socket rate limit exceeded for user ${userId}: ${userCount}/${userMax}`,
          );
          return next(
            new Error(
              `Rate limit exceeded: ${userCount}/${userMax} events per minute`,
            ),
          );
        }

        if (ipCount > ipMax) {
          logger.warn(
            `Socket IP rate limit exceeded for IP ${ip}: ${ipCount}/${ipMax}`,
          );
          return next(
            new Error(
              `IP rate limit exceeded: ${ipCount}/${ipMax} events per minute`,
            ),
          );
        }

        // Add rate limit info to socket
        socket.rateLimit = {
          user: {
            current: userCount,
            limit: userMax,
            remaining: userMax - userCount,
            reset: Math.ceil((now + windowMs) / 1000),
            userType,
            isPremium,
          },
          ip: {
            current: ipCount,
            limit: ipMax,
            remaining: ipMax - ipCount,
          },
        };

        // Emit warning if needed
        if (userCount > userMax * 0.8) {
          socket.emit("rate_limit_warning", socket.rateLimit.user);
        }

        next();
      } catch (error) {
        logger.error("Socket rate limit error:", {
          error: error.message,
          userId,
          userType,
          ip,
        });
        next(); // Allow on error
      }
    })
    .catch(() => {
      next(); // Circuit breaker open - allow request
    });
};

// NEW: Typed rate limiter with enhanced user type support
const createTypedRateLimiter = (type, customOptions = {}) => {
  const typeConfigs = {
    presence: {
      windowMs: 10000,
      baseMax: 30,
      message: "Too many presence requests.",
      keyGenerator: (req) => `presence:${ipKeyGenerator(req)}`,
      configPath: "api",
    },
    profile: {
      windowMs: 60000,
      baseMax: 20,
      message: "Too many profile requests.",
      keyGenerator: (req) => `profile:${ipKeyGenerator(req)}`,
      configPath: "api",
    },
    admin: {
      windowMs: 30000,
      baseMax: 10,
      message: "Too many admin requests.",
      keyGenerator: (req) => `admin:${ipKeyGenerator(req)}`,
      configPath: "auth",
    },
    dating_swipe: {
      windowMs: config.dating.windowMs,
      baseMax: config.dating.swipesPerMinute,
      message: "Too many swipes.",
      keyGenerator: getDatingKeyGenerator("swipe"),
      configPath: "dating",
    },
    dating_like: {
      windowMs: 60 * 60 * 1000,
      baseMax: config.dating.likesPerHour,
      message: "Too many likes.",
      keyGenerator: getDatingKeyGenerator("like"),
      configPath: "dating",
    },
    default: {
      windowMs: 15 * 60 * 1000,
      baseMax: 100,
      message: "Too many requests.",
      keyGenerator: ipKeyGenerator,
      configPath: "api",
    },
  };

  const config = typeConfigs[type] || typeConfigs.default;

  return createDynamicLimiter({
    windowMs: customOptions.windowMs || config.windowMs,
    baseMax: customOptions.baseMax || config.baseMax,
    message: customOptions.message || config.message,
    keyGenerator: customOptions.keyGenerator || config.keyGenerator,
    configPath: customOptions.configPath || config.configPath,
    ...customOptions,
  });
};

const resetRateLimit = async (key, prefix = "rl:") => {
  try {
    const client = redis.getClient();
    if (client && client.isReady) {
      const fullKey = `${prefix}${key}`;
      const deleted = await client.del(fullKey);
      logger.info(`Reset rate limit for key: ${key} (deleted: ${deleted})`);
      return deleted > 0;
    }
  } catch (error) {
    logger.error("Failed to reset rate limit:", error);
  }
  return false;
};

const getRateLimitInfo = async (key, prefix = "rl:") => {
  try {
    const client = redis.getClient();
    if (client && client.isReady) {
      const fullKey = `${prefix}${key}`;
      const data = await client.get(fullKey);

      if (data) {
        const parsed = JSON.parse(data);
        const now = Date.now();
        const resetTime = new Date(parsed.resetTime);
        const remaining = Math.max(0, parsed.limit - parsed.totalHits);
        const timeUntilReset = Math.max(0, resetTime.getTime() - now);

        return {
          totalHits: parsed.totalHits,
          limit: parsed.limit,
          remaining,
          resetTime,
          timeUntilReset,
          isExceeded: parsed.totalHits >= parsed.limit,
          key: key,
        };
      }
    }
  } catch (error) {
    logger.error("Failed to get rate limit info:", error);
  }
  return null;
};

const getRateLimitMetrics = () => {
  if (rateLimitStore && rateLimitStore.getMetrics) {
    return rateLimitStore.getMetrics();
  }
  return {
    error: "Metrics not available",
    storeType: rateLimitStore ? "redis" : "memory",
  };
};

const resetCircuitBreaker = () => {
  redisCircuitBreaker.reset();
  return { success: true, message: "Circuit breaker reset" };
};

const clearMemoryStore = () => {
  if (rateLimitStore && rateLimitStore.clearMemoryStore) {
    rateLimitStore.clearMemoryStore();
    return { success: true, message: "Memory store cleared" };
  }
  return { success: false, message: "Memory store not available" };
};

const getRateLimitHealth = async () => {
  try {
    const client = redis.getClient();
    let redisStatus = "disconnected";

    if (client) {
      try {
        await client.ping();
        redisStatus = client.isReady ? "ready" : "not ready";
      } catch (error) {
        redisStatus = "error";
      }
    }

    return {
      status: "ok",
      rateLimiting: {
        store: rateLimitStore ? "redis" : "memory",
        redis: redisStatus,
        circuitBreaker: redisCircuitBreaker.getStats(),
      },
      config: {
        environment: process.env.NODE_ENV || "development",
        api: config.api,
        auth: config.auth,
        dating: config.dating,
      },
      userTypes: {
        DatingUser: config.api.userTypeLimits?.DatingUser || "default",
        Staff: config.api.userTypeLimits?.Staff || "default",
        Admin: config.api.userTypeLimits?.Admin || "default",
      },
      multipliers: {
        premium: config.api.premiumMultiplier || 1,
        boost: config.api.boostMultiplier || 1,
      },
    };
  } catch (error) {
    return {
      status: "error",
      error: error.message,
    };
  }
};

// NEW: Function to get user's current rate limit status
const getUserRateLimitStatus = async (userId) => {
  try {
    const userInfo = await getUserRateLimitInfo(userId);
    if (!userInfo) return null;

    const userKey = `user:${userId}:type:${userInfo.userType}:tier:${userInfo.isPremium ? "premium" : "free"}`;

    // Check API limits
    const apiLimit = await getRateLimitInfo(userKey);

    // Check dating-specific limits if applicable
    let datingLimits = null;
    if (userInfo.userType === "DatingUser") {
      const swipeKey = `dating:swipe:user:${userId}`;
      const likeKey = `dating:like:user:${userId}`;
      const superLikeKey = `dating:super_like:user:${userId}`;

      datingLimits = {
        swipes: await getRateLimitInfo(swipeKey),
        likes: await getRateLimitInfo(likeKey),
        superLikes: await getRateLimitInfo(superLikeKey),
      };
    }

    return {
      user: {
        id: userId,
        type: userInfo.userType,
        role: userInfo.role,
        isPremium: userInfo.isPremium,
        boostMultiplier: userInfo.boostMultiplier,
      },
      limits: {
        api: apiLimit,
        dating: datingLimits,
      },
      multipliers: {
        premium: config.api.premiumMultiplier,
        boost: config.api.boostMultiplier,
      },
    };
  } catch (error) {
    logger.error("Failed to get user rate limit status:", error);
    return null;
  }
};

module.exports = {
  // Main limiters
  apiLimiter,
  authLimiter,
  datingLimiter,
  messageLimiter,
  registrationLimiter,
  uploadLimiter,
  searchLimiter,
  profileViewLimiter,
  passwordResetLimiter,
  emailResendLimiter,
  profileUpdateLimiter,

  // Dating-specific limiters
  swipeLimiter,
  likeLimiter,
  superLikeLimiter,

  // Socket rate limiting
  socketRateLimit,

  // Factory functions
  createDynamicRateLimiter: createDynamicLimiter,
  createTypedRateLimiter,

  // Utility functions
  resetRateLimit,
  getRateLimitInfo,
  getRateLimitMetrics,
  resetCircuitBreaker,
  clearMemoryStore,
  getRateLimitHealth,
  getUserRateLimitStatus,

  // Middleware
  rateLimitInfoMiddleware,
  shouldSkipRateLimit,

  // Configuration
  RATE_LIMIT_CONFIG,

  // For monitoring
  redisCircuitBreaker,

  // Export ipKeyGenerator
  ipKeyGenerator,

  // Export the store creation function for testing
  createEnhancedRedisStore,

  // Export the store instance
  rateLimitStore,

  // Export helper functions
  calculateDynamicLimit,
  getUserRateLimitInfo,
  getKeyGenerator,
};
