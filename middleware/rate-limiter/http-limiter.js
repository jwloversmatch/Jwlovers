const rateLimit = require('express-rate-limit');
const { MemoryStore } = require('express-rate-limit');

class HttpRateLimiter {
  createStore() {
    console.log('🟡 Using memory store for rate limiting');
    return new MemoryStore();
  }

  // Helper to get safe key without IPv6 warnings
  getSafeKey(req, identifier) {
    // Use identifier if provided (email, token, userId)
    if (identifier) return identifier;
    
    // For IP-based keys, use session or user ID
    if (req.user?._id) return `user:${req.user._id}`;
    if (req.sessionID) return `session:${req.sessionID}`;
    
    // Last resort: use IP but wrap it properly
    return `ip:${req.ip}`;
  }

  createAuthLimiter() {
    return rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 10,
      message: {
        success: false,
        error: 'Too many login attempts',
        message: 'Please try again in an hour.',
      },
      skipSuccessfulRequests: true,
      store: this.createStore(),
      standardHeaders: true,
      legacyHeaders: false,
    });
  }

  createEmailLimiter(options = {}) {
    return rateLimit({
      windowMs: options.windowMs || 60 * 60 * 1000,
      max: options.max || 3,
      message: options.message || {
        success: false,
        error: 'Too many requests',
        message: 'Please try again later.',
      },
      store: this.createStore(),
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        const email = req.body?.email;
        return this.getSafeKey(req, email ? `email:${email}` : null);
      }
    });
  }

  createTokenLimiter(options = {}) {
    return rateLimit({
      windowMs: options.windowMs || 15 * 60 * 1000,
      max: options.max || 5,
      message: options.message || {
        success: false,
        error: 'Too many attempts',
        message: 'Please try again later.',
      },
      store: this.createStore(),
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        const token = req.params?.token || req.body?.token;
        return this.getSafeKey(req, token ? `token:${token}` : null);
      }
    });
  }

  createStrictLimiter() {
    return rateLimit({
      windowMs: 5 * 60 * 1000,
      max: 5,
      message: {
        success: false,
        error: 'Too many attempts',
        message: 'Please wait 5 minutes before trying again.',
      },
      store: this.createStore(),
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: false,
    });
  }

  createCustomLimiter(options = {}) {
    // Don't use keyGenerator at all for IP-based limiting
    // Let express-rate-limit handle it automatically
    return rateLimit({
      windowMs: options.windowMs || 15 * 60 * 1000,
      max: options.max || 100,
      skip: options.skip || (() => false),
      message: options.message || {
        success: false,
        error: 'Rate limit exceeded',
        message: 'Please try again later.',
      },
      store: this.createStore(),
      standardHeaders: true,
      legacyHeaders: false,
    });
  }
}

module.exports = new HttpRateLimiter();