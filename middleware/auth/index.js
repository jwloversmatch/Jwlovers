const authenticate = require('./authenticate');
const authorize = require('./authorize');
const socketAuth = require('./socket-auth');
const tokenManager = require('./token-manager');

module.exports = {
  // HTTP Authentication
  protect: authenticate.protect,
  optionalAuth: authenticate.optionalAuth,
  
  // Authorization
  authorize: authorize.authorize,
  adminOnly: authorize.adminOnly,
  verifiedOnly: authorize.verifiedOnly,
  
  // WebSocket
  protectSocket: socketAuth.protectSocket,
  
  // Token Management
  blacklistToken: tokenManager.blacklistToken,
  isTokenBlacklisted: tokenManager.isTokenBlacklisted,
  revokeAllSessions: tokenManager.revokeAllSessions,
  
  // Combined middlewares
  withProfile: [authenticate.protect, authorize.verifiedOnly],
  withAdmin: [authenticate.protect, authorize.adminOnly],
  withChatPermissions: [authenticate.protect, authorize.verifiedOnly],
};