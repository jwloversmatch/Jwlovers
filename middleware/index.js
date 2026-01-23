const auth = require('./auth');
const rateLimiter = require('./rate-limiter');
const ownership = require('./ownership');
const validation = require('./validation');

module.exports = {
  // Authentication
  protect: auth.protect,
  optionalAuth: auth.optionalAuth,
  protectSocket: auth.protectSocket,
  
  // Authorization
  authorize: auth.authorize,
  adminOnly: auth.adminOnly,
  verifiedOnly: auth.verifiedOnly,
  
  // Token Management
  blacklistToken: auth.blacklistToken,
  isTokenBlacklisted: auth.isTokenBlacklisted,
  revokeAllSessions: auth.revokeAllSessions,
  
  // Rate Limiting
  authRateLimiter: rateLimiter.authRateLimiter,
  messageRateLimiter: rateLimiter.messageRateLimiter,
  apiRateLimiter: rateLimiter.apiRateLimiter,
  socketRateLimiter: rateLimiter.socketRateLimiter,
  customLimiter: rateLimiter.customLimiter,
  
  // Ownership & Permissions
  requireOwnership: ownership.requireOwnership,
  canSendMessages: ownership.canSendMessages,
  canReceiveFrom: ownership.canReceiveFrom,
  profileCompleted: ownership.profileCompleted,
  
  // Validation
  validate: validation.validate,
  
  // Combined middlewares
  withAuth: [auth.protect],
  withAdmin: [auth.protect, auth.adminOnly],
  withVerified: [auth.protect, auth.verifiedOnly],
  withChatPermissions: [
    auth.protect, 
    auth.verifiedOnly, 
    ownership.canSendMessages,
    ownership.profileCompleted,
  ],
};