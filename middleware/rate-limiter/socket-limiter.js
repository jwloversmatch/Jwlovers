const redis = require('../../config/redis');
const logger = require('../../utils/logger');

class SocketRateLimiter {
  socketRateLimiter(socket, next) {
    const userId = socket.user?.id;
    
    if (!userId) {
      return next(new Error('Authentication required'));
    }

    const key = `socket:rl:${userId}`;
    const windowMs = 60000; // 1 minute
    const max = 120; // 120 events

    redis.getClient().multi()
      .incr(key)
      .ttl(key)
      .exec((err, replies) => {
        if (err) {
          logger.error('Redis error in socket rate limit:', err);
          return next(new Error('Internal server error'));
        }

        const [current, ttl] = replies;

        if (current === 1) {
          redis.getClient().expire(key, windowMs / 1000);
        }

        if (current > max) {
          logger.warn(`Socket rate limit exceeded for user ${userId}: ${current} requests`);
          return next(new Error('Rate limit exceeded'));
        }

        next();
      });
  }
}

module.exports = new SocketRateLimiter();