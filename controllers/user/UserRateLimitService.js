const redis = require('@config/redis');
const logger = require('@utils/logger');

class UserRateLimitService {
  constructor() {
    this.rateLimits = {
      updatePrivateInfo: { attempts: 5, window: 3600 },
      deleteAccount: { attempts: 3, window: 86400 },
      updateEmail: { attempts: 3, window: 3600 },
    };
  }

  async checkRateLimit(key, limitType) {
    try {
      const limitConfig = this.rateLimits[limitType];
      if (!limitConfig) {
        logger.warn(`No rate limit config found for type: ${limitType}`);
        return true;
      }

      if (!redis.isReady) return true; // Skip if Redis not available
      
      const fullKey = `${limitType}_${key}`;
      const current = await redis.get(fullKey);
      if (current && parseInt(current) >= limitConfig.attempts) {
        return false;
      }
      return true;
    } catch (error) {
      logger.warn('Rate limit check failed:', error);
      return true; // Fail open for safety
    }
  }

  async incrementRateLimit(key, limitType) {
    try {
      const limitConfig = this.rateLimits[limitType];
      if (!limitConfig) return;

      if (!redis.isReady) return;
      
      const fullKey = `${limitType}_${key}`;
      const current = await redis.get(fullKey);
      if (current) {
        await redis.incr(fullKey);
      } else {
        await redis.setex(fullKey, limitConfig.window, 1);
      }
    } catch (error) {
      logger.warn('Rate limit increment failed:', error);
    }
  }

  getRateLimitKey(userId, action) {
    return `${action}_${userId}`;
  }
}

module.exports = UserRateLimitService;