// services/RateLimiterService.js
const { RateLimiterRedis, RateLimiterMongo, RateLimiterMemory } = require("rate-limiter-flexible");
const mongoose = require("mongoose");
const Redis = require("ioredis");
const logger = require("@utils/logger");

class RateLimiterService {
  constructor() {
    this.redisClient = null;
    this.limiters = new Map();
    this.memoryFallback = new Map();
    this.initialized = false;
    this.useRedis = process.env.REDIS_URL && process.env.REDIS_URL !== 'disabled';
    
    // Configuration for different rate limits
    this.configs = {
      // Registration attempts per IP
      registration: {
        points: 5, // 5 attempts
        duration: 15 * 60, // 15 minutes
        blockDuration: 30 * 60, // Block for 30 minutes after exceeding
        keyPrefix: 'rate:reg:ip'
      },
      
      // Question requests per IP
      questions: {
        points: 20, // 20 questions per hour
        duration: 60 * 60, // 1 hour
        keyPrefix: 'rate:questions:ip'
      },
      
      // Login attempts per IP (critical for security)
      login: {
        points: 5, // 5 attempts
        duration: 15 * 60, // 15 minutes
        blockDuration: 30 * 60, // Block for 30 minutes
        keyPrefix: 'rate:login:ip'
      },
      
      // Login attempts per user (additional protection)
      loginUser: {
        points: 10, // 10 attempts per user
        duration: 60 * 60, // 1 hour
        blockDuration: 60 * 60, // Block for 1 hour
        keyPrefix: 'rate:login:user'
      },
      
      // Message sending per user (prevent spam)
      messaging: {
        points: 30, // 30 messages per minute
        duration: 60, // 1 minute
        keyPrefix: 'rate:messages:user'
      },
      
      // Message sending per conversation (prevent harassment)
      conversation: {
        points: 10, // 10 messages per minute per conversation
        duration: 60, // 1 minute
        keyPrefix: 'rate:messages:conv'
      },
      
      // API requests per user (general API protection)
      api: {
        points: 100, // 100 requests per 15 minutes
        duration: 15 * 60, // 15 minutes
        keyPrefix: 'rate:api:user'
      },
      
      // Password reset requests
      passwordReset: {
        points: 3, // 3 attempts per hour
        duration: 60 * 60, // 1 hour
        keyPrefix: 'rate:password:reset'
      },
      
      // Email verification resend
      emailResend: {
        points: 3, // 3 resends per hour
        duration: 60 * 60, // 1 hour
        keyPrefix: 'rate:email:resend'
      },
      
      // Profile updates (prevent abuse)
      profileUpdate: {
        points: 10, // 10 updates per minute
        duration: 60, // 1 minute
        keyPrefix: 'rate:profile:update'
      }
    };
    
    // Initialize in background
    this.init().catch(error => {
      logger.error('Failed to initialize RateLimiterService:', error);
    });
  }
  
  async init() {
    try {
      if (this.useRedis) {
        await this.initRedis();
      } else {
        await this.initMongoDB();
      }
      this.initialized = true;
      logger.info(`RateLimiterService initialized with ${this.useRedis ? 'Redis' : 'MongoDB'} backend`);
    } catch (error) {
      logger.error('Rate limiter initialization failed, falling back to memory:', error);
      await this.initMemory();
      this.initialized = true;
    }
  }
  
  async initRedis() {
    try {
      this.redisClient = new Redis(process.env.REDIS_URL, {
        retryStrategy: (times) => {
          const delay = Math.min(times * 100, 2000);
          return delay;
        },
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        lazyConnect: true,
        // TLS for production
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined
      });
      
      this.redisClient.on('error', (error) => {
        logger.error('Redis connection error in RateLimiter:', error.message);
        // Fallback to memory
        this.fallbackToMemory();
      });
      
      this.redisClient.on('connect', () => {
        logger.info('✅ Redis connected for rate limiting');
      });
      
      await this.redisClient.connect();
      
      // Initialize Redis-based limiters
      for (const [name, config] of Object.entries(this.configs)) {
        this.limiters.set(name, new RateLimiterRedis({
          storeClient: this.redisClient,
          points: config.points,
          duration: config.duration,
          blockDuration: config.blockDuration,
          keyPrefix: config.keyPrefix,
          // Additional Redis options
          insuranceLimiter: new RateLimiterMemory({
            points: config.points,
            duration: config.duration
          })
        }));
      }
      
    } catch (error) {
      logger.error('Failed to initialize Redis for rate limiting:', error);
      throw error;
    }
  }
  
  async initMongoDB() {
    try {
      // Initialize MongoDB-based limiters
      for (const [name, config] of Object.entries(this.configs)) {
        this.limiters.set(name, new RateLimiterMongo({
          storeClient: mongoose.connection,
          points: config.points,
          duration: config.duration,
          blockDuration: config.blockDuration,
          keyPrefix: config.keyPrefix,
          // MongoDB collection options
          tableName: 'rateLimits',
          createTtlIndex: true
        }));
      }
      
      // Ensure TTL index is created
      await mongoose.connection.db.collection('rateLimits').createIndex(
        { expireAt: 1 },
        { expireAfterSeconds: 0, background: true }
      );
      
    } catch (error) {
      logger.error('Failed to initialize MongoDB for rate limiting:', error);
      throw error;
    }
  }
  
  async initMemory() {
    // Memory-based limiters (fallback when Redis/MongoDB unavailable)
    for (const [name, config] of Object.entries(this.configs)) {
      this.limiters.set(name, new RateLimiterMemory({
        points: config.points,
        duration: config.duration,
        blockDuration: config.blockDuration,
        keyPrefix: config.keyPrefix
      }));
    }
  }
  
  fallbackToMemory() {
    logger.warn('Falling back to memory-based rate limiting');
    this.useRedis = false;
    this.initMemory();
  }
  
  /**
   * Check rate limit for a specific action
   */
  async checkLimit(action, key, points = 1) {
    if (!this.initialized) {
      // Allow if not initialized (fail-open for availability)
      return { success: true, remainingPoints: Infinity };
    }
    
    const limiter = this.limiters.get(action);
    if (!limiter) {
      logger.error(`No rate limiter configured for action: ${action}`);
      return { success: true, remainingPoints: Infinity };
    }
    
    try {
      const res = await limiter.consume(key, points);
      
      return {
        success: true,
        remainingPoints: res.remainingPoints,
        consumedPoints: points,
        resetTime: new Date(Date.now() + res.msBeforeNext)
      };
    } catch (error) {
      if (error instanceof Error) {
        // Rate limit exceeded
        const retryAfter = Math.ceil(error.msBeforeNext / 1000);
        const message = this.getRateLimitMessage(action, retryAfter);
        
        // Log rate limit hit
        logger.warn(`Rate limit exceeded for ${action}`, {
          key,
          action,
          retryAfter,
          points,
          ip: key.includes('ip:') ? key.split(':')[1] : undefined
        });
        
        return {
          success: false,
          message,
          retryAfter,
          msBeforeNext: error.msBeforeNext,
          remainingPoints: 0,
          limitExceeded: true
        };
      }
      
      // Other errors
      logger.error(`Rate limit check error for ${action}:`, error);
      return { 
        success: true, // Fail-open on error
        remainingPoints: Infinity,
        error: error.message 
      };
    }
  }
  
  /**
   * Get rate limit message based on action
   */
  getRateLimitMessage(action, retryAfter) {
    const messages = {
      registration: `Too many registration attempts. Please try again in ${retryAfter} seconds.`,
      login: `Too many login attempts. Please try again in ${retryAfter} seconds.`,
      questions: `Too many question requests. Please slow down.`,
      messaging: `You're sending messages too quickly. Please wait ${retryAfter} seconds.`,
      conversation: `You're sending too many messages to this conversation. Please wait ${retryAfter} seconds.`,
      api: `Too many API requests. Please slow down.`,
      passwordReset: `Too many password reset attempts. Please try again in ${retryAfter} seconds.`,
      emailResend: `Too many email verification requests. Please try again in ${retryAfter} seconds.`,
      profileUpdate: `Too many profile updates. Please wait ${retryAfter} seconds.`
    };
    
    return messages[action] || `Rate limit exceeded. Please try again in ${retryAfter} seconds.`;
  }
  
  /**
   * Get rate limit info without consuming points
   */
  async getLimitInfo(action, key) {
    if (!this.initialized) {
      return { remainingPoints: Infinity, resetTime: null };
    }
    
    const limiter = this.limiters.get(action);
    if (!limiter) {
      return { remainingPoints: Infinity, resetTime: null };
    }
    
    try {
      const res = await limiter.get(key);
      return {
        remainingPoints: res?.remainingPoints || this.configs[action]?.points,
        resetTime: res?.msBeforeNext ? new Date(Date.now() + res.msBeforeNext) : null,
        consumedPoints: res?.consumedPoints || 0
      };
    } catch (error) {
      logger.error(`Failed to get rate limit info for ${action}:`, error);
      return { remainingPoints: Infinity, resetTime: null };
    }
  }
  
  /**
   * Delete rate limit entries (for testing or manual reset)
   */
  async deleteLimit(action, key) {
    if (!this.initialized) return false;
    
    const limiter = this.limiters.get(action);
    if (!limiter) return false;
    
    try {
      await limiter.delete(key);
      logger.info(`Rate limit deleted for ${action}: ${key}`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete rate limit for ${action}:`, error);
      return false;
    }
  }
  
  /**
   * Reset rate limit for a key
   */
  async resetLimit(action, key) {
    return await this.deleteLimit(action, key);
  }
  
  /**
   * Check IP-based registration limit
   */
  async checkIpLimit(ip) {
    return await this.checkLimit('registration', `ip:${ip}`);
  }
  
  /**
   * Check question request limit
   */
  async checkQuestionLimit(ip) {
    return await this.checkLimit('questions', `ip:${ip}`);
  }
  
  /**
   * Check login attempts per IP
   */
  async checkLoginIpLimit(ip) {
    return await this.checkLimit('login', `ip:${ip}`);
  }
  
  /**
   * Check login attempts per user
   */
  async checkLoginUserLimit(userId) {
    return await this.checkLimit('loginUser', `user:${userId}`);
  }
  
  /**
   * Check messaging rate limit per user
   */
  async checkMessagingLimit(userId) {
    return await this.checkLimit('messaging', `user:${userId}`);
  }
  
  /**
   * Check messaging rate limit per conversation
   */
  async checkConversationLimit(conversationId, userId) {
    return await this.checkLimit('conversation', `conv:${conversationId}:user:${userId}`);
  }
  
  /**
   * Check API rate limit per user
   */
  async checkApiLimit(userId) {
    return await this.checkLimit('api', `user:${userId}`);
  }
  
  /**
   * Check password reset limit
   */
  async checkPasswordResetLimit(email) {
    return await this.checkLimit('passwordReset', `email:${email}`);
  }
  
  /**
   * Check email resend limit
   */
  async checkEmailResendLimit(email) {
    return await this.checkLimit('emailResend', `email:${email}`);
  }
  
  /**
   * Check profile update limit
   */
  async checkProfileUpdateLimit(userId) {
    return await this.checkLimit('profileUpdate', `user:${userId}`);
  }
  
  /**
   * Middleware factory for Express routes
   */
  middleware(action, getKeyFn) {
    return async (req, res, next) => {
      try {
        const key = getKeyFn ? getKeyFn(req) : this.getDefaultKey(req, action);
        const result = await this.checkLimit(action, key);
        
        if (!result.success) {
          // Set Retry-After header
          res.setHeader('Retry-After', result.retryAfter);
          
          return res.status(429).json({
            success: false,
            error: result.message,
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: result.retryAfter,
            path: req.path,
            method: req.method
          });
        }
        
        // Add rate limit headers to response
        this.setRateLimitHeaders(res, result);
        
        next();
      } catch (error) {
        logger.error(`Rate limit middleware error for ${action}:`, error);
        // Fail-open: allow request on error
        next();
      }
    };
  }
  
  /**
   * Get default key for rate limiting
   */
  getDefaultKey(req, action) {
    // Default key generation based on action type
    switch (action) {
      case 'registration':
      case 'login':
      case 'questions':
        return `ip:${req.ip}`;
        
      case 'loginUser':
      case 'messaging':
      case 'api':
      case 'profileUpdate':
        return `user:${req.userId || req.user?._id || 'anonymous'}`;
        
      case 'conversation':
        const conversationId = req.params.conversationId || req.body.conversationId;
        return `conv:${conversationId}:user:${req.userId || 'anonymous'}`;
        
      case 'passwordReset':
      case 'emailResend':
        const email = req.body.email || req.params.email;
        return `email:${email}`;
        
      default:
        return `ip:${req.ip}:action:${action}`;
    }
  }
  
  /**
   * Set rate limit headers (RFC 6585)
   */
  setRateLimitHeaders(res, limitInfo) {
    if (limitInfo.success) {
      res.setHeader('X-RateLimit-Limit', this.configs[limitInfo.action]?.points || 0);
      res.setHeader('X-RateLimit-Remaining', limitInfo.remainingPoints);
      res.setHeader('X-RateLimit-Reset', limitInfo.resetTime?.getTime() || 0);
    }
  }
  
  /**
   * Get statistics about rate limiting
   */
  async getStats() {
    const stats = {
      initialized: this.initialized,
      backend: this.useRedis ? 'redis' : 'mongodb',
      configs: Object.keys(this.configs),
      memoryFallback: this.memoryFallback.size > 0
    };
    
    if (this.redisClient && this.redisClient.status === 'ready') {
      try {
        const redisInfo = await this.redisClient.info();
        stats.redis = {
          connected: true,
          version: redisInfo.match(/redis_version:(.+)/)?.[1],
          usedMemory: redisInfo.match(/used_memory_human:(.+)/)?.[1]
        };
      } catch (error) {
        stats.redis = { connected: false, error: error.message };
      }
    }
    
    return stats;
  }
  
  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
        logger.info('Redis connection closed for rate limiting');
      } catch (error) {
        logger.error('Error closing Redis connection:', error);
      }
    }
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  const service = module.exports;
  if (service.cleanup) {
    service.cleanup().catch(err => 
      logger.error('Error during rate limiter cleanup:', err)
    );
  }
});

process.on('SIGINT', () => {
  const service = module.exports;
  if (service.cleanup) {
    service.cleanup().catch(err => 
      logger.error('Error during rate limiter cleanup:', err)
    );
  }
});

// Export singleton instance
const instance = new RateLimiterService();
module.exports = instance;