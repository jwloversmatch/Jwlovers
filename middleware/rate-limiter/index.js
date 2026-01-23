const httpLimiter = require('./http-limiter');
const socketLimiter = require('./socket-limiter');

module.exports = {
  // HTTP rate limiters
  authRateLimiter: httpLimiter.createAuthLimiter(),
  messageRateLimiter: httpLimiter.createMessageLimiter(),
  apiRateLimiter: httpLimiter.createApiLimiter(),
  customLimiter: httpLimiter.createCustomLimiter,
  
  // WebSocket rate limiter
  socketRateLimiter: socketLimiter.socketRateLimiter,
};