const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const RedisStore = require("rate-limit-redis").RedisStore;
const redis = require("@config/redis");
const logger = require("@utils/logger");
const validator = require("validator");


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
          }
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
              `Redis command ${command} not supported via sendCommand`
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

const getRateLimitConfig = () => {
  const env = process.env.NODE_ENV || "development";

  const baseConfigs = {
    // Production defaults
    production: {
      api: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: parseInt(process.env.RATE_LIMIT_API_MAX) || 100,
      },
      auth: {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 10,
        blockDuration: 30 * 60 * 1000, // Block for 30 minutes after exceeding
      },
      messages: {
        windowMs: 60 * 1000, // 1 minute
        max: parseInt(process.env.RATE_LIMIT_MESSAGES_MAX) || 60,
        blockDuration: 5 * 60 * 1000, // Block for 5 minutes
      },
      registration: {
        windowMs: 24 * 60 * 60 * 1000, // 24 hours
        max: parseInt(process.env.RATE_LIMIT_REGISTRATION_MAX) || 5,
        blockDuration: 24 * 60 * 60 * 1000, // Block for 24 hours
      },
      socket: {
        windowMs: 60 * 1000, // 1 minute
        max: parseInt(process.env.RATE_LIMIT_SOCKET_MAX) || 120,
      },
    },
    // Development defaults (more permissive)
    development: {
      api: {
        windowMs: 15 * 60 * 1000,
        max: 1000,
      },
      auth: {
        windowMs: 60 * 60 * 1000,
        max: 100,
      },
      messages: {
        windowMs: 60 * 1000,
        max: 600,
      },
      registration: {
        windowMs: 24 * 60 * 60 * 1000,
        max: 50,
      },
      socket: {
        windowMs: 60 * 1000,
        max: 1200,
      },
    },
    // Test defaults
    test: {
      api: {
        windowMs: 15 * 60 * 1000,
        max: 5000,
      },
      auth: {
        windowMs: 60 * 60 * 1000,
        max: 500,
      },
      messages: {
        windowMs: 60 * 1000,
        max: 3000,
      },
      registration: {
        windowMs: 24 * 60 * 60 * 1000,
        max: 100,
      },
      socket: {
        windowMs: 60 * 1000,
        max: 5000,
      },
    },
  };

  // Get config for current environment, fallback to development
  const config = baseConfigs[env] || baseConfigs.development;

  // Override with environment variables if present
  if (process.env.RATE_LIMIT_API_MAX) {
    config.api.max = parseInt(process.env.RATE_LIMIT_API_MAX);
  }
  if (process.env.RATE_LIMIT_AUTH_MAX) {
    config.auth.max = parseInt(process.env.RATE_LIMIT_AUTH_MAX);
  }
  if (process.env.RATE_LIMIT_MESSAGES_MAX) {
    config.messages.max = parseInt(process.env.RATE_LIMIT_MESSAGES_MAX);
  }
  if (process.env.RATE_LIMIT_REGISTRATION_MAX) {
    config.registration.max = parseInt(process.env.RATE_LIMIT_REGISTRATION_MAX);
  }
  if (process.env.RATE_LIMIT_SOCKET_MAX) {
    config.socket.max = parseInt(process.env.RATE_LIMIT_SOCKET_MAX);
  }

  logger.info(`📊 Rate limit config loaded for ${env} environment`);
  logger.info(
    `   API: ${config.api.max} requests/${config.api.windowMs / 60000} minutes`
  );
  logger.info(
    `   Auth: ${config.auth.max} requests/${config.auth.windowMs / 3600000} hours`
  );
  logger.info(`   Messages: ${config.messages.max} messages/minute`);
  logger.info(
    `   Registration: ${config.registration.max} registrations/24 hours`
  );

  return config;
};

const config = getRateLimitConfig();

const RATE_LIMIT_CONFIG = {
  production: getRateLimitConfig(),
  development: getRateLimitConfig(),
  test: getRateLimitConfig(),
};

const rateLimitHandler = (req, res, options) => {
  const retryAfter = Math.ceil(options.windowMs / 1000);
  const isAuthEndpoint =
    req.path.includes("/auth") || req.path.includes("/login");

  // Different messages based on endpoint type
  let message = options.message || "Too many requests, please try again later.";

  if (isAuthEndpoint) {
    message =
      "Too many authentication attempts. Please try again later or reset your password.";
  }

  // Log rate limit hits for security monitoring
  logger.warn("Rate limit exceeded", {
    path: req.path,
    ip: req.ip,
    userAgent: req.headers["user-agent"]?.substring(0, 100),
    userId: req.user?.id,
    key: options.key,
    retryAfter,
  });

  // Set standard rate limit headers (RFC 6585)
  res.setHeader("Retry-After", retryAfter);
  res.setHeader("X-RateLimit-Limit", options.limit || options.max);
  res.setHeader("X-RateLimit-Remaining", 0);
  res.setHeader(
    "X-RateLimit-Reset",
    Math.floor(Date.now() / 1000) + retryAfter
  );

  res.status(429).json({
    success: false,
    error: message,
    code: "RATE_LIMIT_EXCEEDED",
    retryAfter,
    path: req.path,
    timestamp: new Date().toISOString(),
    documentation:
      process.env.API_DOCS_URL ||
      "https://your-dating-app.com/docs/rate-limiting",
  });
};

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

  // Skip for API keys with unlimited access
  const apiKey = req.headers["x-api-key"];
  const unlimitedKeys = (process.env.UNLIMITED_API_KEYS || "")
    .split(",")
    .filter((key) => key.trim());

  if (apiKey && unlimitedKeys.includes(apiKey)) {
    logger.debug(
      `Rate limit skipped for unlimited API key: ${apiKey.substring(0, 8)}...`
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

const getKeyGenerator = (type) => {
  switch (type) {
    case "auth":
      return (req) => {
        // For auth endpoints, include email to prevent targeted attacks
        const email = req.body?.email;
        if (email && validator.isEmail(email)) {
          return `auth:${ipKeyGenerator(req)}:${email.toLowerCase().trim()}`;
        }
        return `auth:${ipKeyGenerator(req)}`;
      };

    case "registration":
      return (req) => {
        // Include email and IP for registration limits
        const email = req.body?.email;

        if (email && validator.isEmail(email)) {
          return `reg:${ipKeyGenerator(req)}:${email.toLowerCase().trim()}`;
        }

        // Also limit by IP alone
        return `reg:${ipKeyGenerator(req)}`;
      };

    case "messages":
      return (req) => {
        // Limit by user AND conversation to prevent harassment
        const userId = req.user?.id;
        const conversationId =
          req.params?.conversationId || req.body?.conversationId;

        if (userId && conversationId) {
          return `msg:user:${userId}:conv:${conversationId}`;
        }

        return userId ? `msg:user:${userId}` : `msg:ip:${ipKeyGenerator(req)}`;
      };

    case "user":
      return (req) => {
        return req.user?.id
          ? `user:${req.user.id}`
          : `ip:${ipKeyGenerator(req)}`;
      };

    default:
      return (req) => {
        const apiKey = req.headers["x-api-key"];
        return apiKey
          ? `${ipKeyGenerator(req)}:${apiKey}`
          : ipKeyGenerator(req);
      };
  }
};

const getUploadKeyGenerator = () => {
  return (req) => {
    return req.user
      ? `upload:user:${req.user.id}`
      : `upload:ip:${ipKeyGenerator(req)}`;
  };
};

const getSearchKeyGenerator = () => {
  return (req) => {
    return req.user
      ? `search:user:${req.user.id}`
      : `search:ip:${ipKeyGenerator(req)}`;
  };
};

const getProfileViewKeyGenerator = () => {
  return (req) => {
    const profileId = req.params?.userId || req.params?.id;
    return `profile:view:${ipKeyGenerator(req)}:${profileId || "general"}`;
  };
};

const getPasswordResetKeyGenerator = () => {
  return (req) => {
    const email = req.body?.email;
    if (email && validator.isEmail(email)) {
      return `password_reset:${ipKeyGenerator(req)}:${email.toLowerCase().trim()}`;
    }
    return `password_reset:${ipKeyGenerator(req)}`;
  };
};

const getEmailResendKeyGenerator = () => {
  return (req) => {
    const email = req.body?.email;
    if (email && validator.isEmail(email)) {
      return `email_resend:${ipKeyGenerator(req)}:${email.toLowerCase().trim()}`;
    }
    return `email_resend:${ipKeyGenerator(req)}`;
  };
};

const getProfileUpdateKeyGenerator = () => {
  return (req) => {
    return req.user
      ? `profile_update:user:${req.user.id}`
      : `profile_update:ip:${ipKeyGenerator(req)}`;
  };
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

const apiLimiter = rateLimit({
  windowMs: config.api.windowMs,
  max: config.api.max,
  message: "Too many API requests from this IP.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipRateLimit,
  handler: rateLimitHandler,
  keyGenerator: getKeyGenerator("api"),
  store: rateLimitStore,
  validate: false, 
});

const authLimiter = rateLimit({
  windowMs: config.auth.windowMs,
  max: config.auth.max,
  message: "Too many authentication attempts.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipRateLimit,
  skipSuccessfulRequests: true,
  handler: rateLimitHandler,
  keyGenerator: getKeyGenerator("auth"),
  store: rateLimitStore,
  validate: false, 
});

const messageLimiter = rateLimit({
  windowMs: config.messages.windowMs,
  max: config.messages.max,
  message: "Message sending rate limit exceeded.",
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: getKeyGenerator("messages"),
  store: rateLimitStore,
  validate: false,
});

const registrationLimiter = rateLimit({
  windowMs: config.registration.windowMs,
  max: config.registration.max,
  message: "Too many registration attempts from this IP/email.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipRateLimit,
  handler: rateLimitHandler,
  keyGenerator: getKeyGenerator("registration"),
  store: rateLimitStore,
  validate: false,
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX) || 50,
  message: "Too many uploads, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: getUploadKeyGenerator(),
  store: rateLimitStore,
  validate: false, 
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_SEARCH_MAX) || 30,
  message: "Too many search requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: getSearchKeyGenerator(),
  store: rateLimitStore,
  validate: false, 
});

const profileViewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_PROFILE_VIEWS_MAX) || 60,
  message: "Too many profile views, please slow down.",
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: getProfileViewKeyGenerator(),
  store: rateLimitStore,
  validate: false, 
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many password reset requests. Please wait before trying again.",
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: getPasswordResetKeyGenerator(),
  store: rateLimitStore,
  validate: false, 
});

const emailResendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message:
    "Too many verification email requests. Please wait before trying again.",
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: getEmailResendKeyGenerator(),
  store: rateLimitStore,
  validate: false, // Changed from true to false
});

const profileUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many profile updates. Please wait before making more changes.",
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: getProfileUpdateKeyGenerator(),
  store: rateLimitStore,
  validate: false,
});

const rateLimitInfoMiddleware = (req, res, next) => {
  // Store original send function
  const originalSend = res.send;

  res.send = function (body) {
    // Only add rate limit headers if req.rateLimit exists
    if (req.rateLimit && typeof req.rateLimit === 'object') {
      try {
        const limit = req.rateLimit.limit || req.rateLimit.max;
        const remaining = req.rateLimit.remaining || 
                         (limit !== undefined ? limit - (req.rateLimit.used || 0) : undefined);
        
        // Only set headers with defined values
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
      } catch (error) {
        // Silently fail - don't break the response
        logger.debug('Error setting rate limit headers:', error.message);
      }
    }

    return originalSend.call(this, body);
  };

  next();
};

const socketRateLimit = (socket, next) => {
  const userId = socket.user?.id;
  const ip = socket.handshake.address;

  if (!userId) {
    return next(new Error("Authentication required for rate limiting"));
  }

  const key = `socket:user:${userId}`;
  const ipKey = `socket:ip:${ip}`;
  const windowMs = config.socket.windowMs;
  const userMax = config.socket.max;
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
            `Socket user rate limit exceeded for user ${userId}: ${userCount}/${userMax}`
          );
          return next(
            new Error(
              `User rate limit exceeded: ${userCount}/${userMax} events per minute`
            )
          );
        }

        if (ipCount > ipMax) {
          logger.warn(
            `Socket IP rate limit exceeded for IP ${ip}: ${ipCount}/${ipMax}`
          );
          return next(
            new Error(
              `IP rate limit exceeded: ${ipCount}/${ipMax} events per minute`
            )
          );
        }

        // Calculate and add rate limit info to socket
        socket.rateLimit = {
          user: {
            current: userCount,
            limit: userMax,
            remaining: userMax - userCount,
            reset: Math.ceil((now + windowMs) / 1000),
          },
          ip: {
            current: ipCount,
            limit: ipMax,
            remaining: ipMax - ipCount,
          },
        };

        // Emit rate limit warning if needed
        if (userCount > userMax * 0.8) {
          socket.emit("rate_limit_warning", {
            type: "user",
            current: userCount,
            limit: userMax,
            remaining: userMax - userCount,
          });
        }

        next();
      } catch (error) {
        logger.error("Socket rate limit error:", {
          error: error.message,
          userId,
          ip,
        });
        next(); // Allow on error
      }
    })
    .catch(() => {
      next(); // Circuit breaker open - allow request
    });
};

const createDynamicRateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    keyGenerator = ipKeyGenerator, 
    message = "Rate limit exceeded",
    skip = shouldSkipRateLimit,
    skipSuccessfulRequests = false,
    blockDuration,
  } = options;

  return rateLimit({
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
    skipSuccessfulRequests,
    handler: rateLimitHandler,
    keyGenerator,
    store: rateLimitStore,
    validate: false, // DISABLED validation to prevent IPv6 errors
    ...(blockDuration && { blockDuration }),
  });
};

const createTypedRateLimiter = (type, customOptions = {}) => {
  const typeConfigs = {
    presence: {
      windowMs: 10000, // 10 seconds
      max: 30,
      message: "Too many presence requests.",
      keyGenerator: (req) => `presence:${ipKeyGenerator(req)}`,
    },
    profile: {
      windowMs: 60000, // 1 minute
      max: 20,
      message: "Too many profile requests.",
      keyGenerator: (req) => `profile:${ipKeyGenerator(req)}`,
    },
    admin: {
      windowMs: 30000, // 30 seconds
      max: 10,
      message: "Too many admin requests.",
      keyGenerator: (req) => `admin:${ipKeyGenerator(req)}`,
    },
    default: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100,
      message: "Too many requests.",
      keyGenerator: ipKeyGenerator,
    },
  };

  const config = typeConfigs[type] || typeConfigs.default;

  return rateLimit({
    windowMs: customOptions.windowMs || config.windowMs,
    max: customOptions.max || config.max,
    message: customOptions.message || config.message,
    keyGenerator: customOptions.keyGenerator || config.keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkipRateLimit,
    handler: rateLimitHandler,
    store: rateLimitStore,
    validate: false, // DISABLED validation
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
      },
    };
  } catch (error) {
    return {
      status: "error",
      error: error.message,
    };
  }
};

module.exports = {
  apiLimiter,
  authLimiter,
  messageLimiter,
  registrationLimiter,
  uploadLimiter,
  searchLimiter,
  profileViewLimiter,
  passwordResetLimiter,
  emailResendLimiter,
  profileUpdateLimiter,

  // Socket rate limiting
  socketRateLimit,

  // Factory functions
  createDynamicRateLimiter,
  createTypedRateLimiter, // NEW: Add this export

  // Utility functions
  resetRateLimit,
  getRateLimitInfo,
  getRateLimitMetrics,
  resetCircuitBreaker,
  clearMemoryStore,
  getRateLimitHealth,

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
};