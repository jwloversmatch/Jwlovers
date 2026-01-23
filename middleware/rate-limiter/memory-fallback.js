const { RateLimiterMemory } = require('rate-limiter-flexible');

class MemoryRateLimiter {
  constructor() {
    this.limiters = new Map();
  }

  getMiddleware(type = 'api') {
    if (!this.limiters.has(type)) {
      const configs = {
        auth: { points: 5, duration: 15 * 60 },
        api: { points: 100, duration: 60 },
        strict: { points: 10, duration: 60 * 60 },
      };
      
      this.limiters.set(type, new RateLimiterMemory(configs[type]));
    }

    return async (req, res, next) => {
      try {
        await this.limiters.get(type).consume(req.ip);
        next();
      } catch {
        res.status(429).json({ error: 'Too Many Requests' });
      }
    };
  }
}

module.exports = new MemoryRateLimiter();