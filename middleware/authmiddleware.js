// middleware/auth.js - REFACTORED MAIN EXPORT
const { ROLES, ROLE_HIERARCHY } = require("@models/User");

// Import modular components
const authCoreMiddleware = require("./auth/AuthCoreMiddleware");
const authorizationMiddleware = require("./auth/AuthorizationMiddleware");
const specializedAuthMiddleware = require("./auth/SpecializedAuthMiddleware");
const tokenService = require("@services/TokenService");
const userSanitizer = require("@utils/UserSanitizer");
const roleChecker = require("@utils/RoleChecker");

// ========== CORE AUTHENTICATION ==========
exports.protect = authCoreMiddleware.protect.bind(authCoreMiddleware);
exports.optionalAuth = authCoreMiddleware.optionalAuth.bind(authCoreMiddleware);

// ========== AUTHORIZATION ==========
exports.authorize = authorizationMiddleware.authorize.bind(authorizationMiddleware);
exports.authorizeUserType = authorizationMiddleware.authorizeUserType.bind(authorizationMiddleware);
exports.requireMinimumRole = authorizationMiddleware.requireMinimumRole.bind(authorizationMiddleware);

// Convenience authorization methods
exports.userOnly = authorizationMiddleware.userOnly;
exports.staffOnly = authorizationMiddleware.staffOnly;
exports.moderatorOnly = authorizationMiddleware.moderatorOnly;
exports.adminOnly = authorizationMiddleware.adminOnly;
exports.superAdminOnly = authorizationMiddleware.superAdminOnly;

// ========== SPECIALIZED MIDDLEWARE ==========
exports.verifiedOnly = specializedAuthMiddleware.verifiedOnly.bind(specializedAuthMiddleware);
exports.profileCompleted = specializedAuthMiddleware.profileCompleted.bind(specializedAuthMiddleware);
exports.requireOwnership = specializedAuthMiddleware.requireOwnership.bind(specializedAuthMiddleware);

// ========== ADDITIONAL MIDDLEWARE (Keep existing implementations) ==========
// These can be moved to separate files later if needed
const crypto = require("crypto");
const { BaseUser } = require("@models/User");
const RateLimit = require("@services/ratelimiter.service");
const logger = require("@utils/logger");
const AUTH_CONFIG = require("@config/AuthConfig");

// Rate limiting middleware
exports.rateLimit = (options = {}) => {
  const {
    windowMs = AUTH_CONFIG.RATE_LIMIT_WINDOW,
    max = AUTH_CONFIG.MAX_REQUESTS_PER_WINDOW,
    keyGenerator = (req) => req.userId || req.ip,
    skip = (req) => false,
    roleLimits = {},
    userTypeLimits = {}
  } = options;
  
  return async (req, res, next) => {
    if (skip(req)) return next();
    
    const key = keyGenerator(req);
    const requestId = crypto.randomBytes(4).toString('hex');
    
    try {
      let effectiveMax = max;
      if (req.user?.role && roleLimits[req.user.role]) {
        effectiveMax = roleLimits[req.user.role];
      }
      
      if (req.user?.userType && userTypeLimits[req.user.userType]) {
        effectiveMax = userTypeLimits[req.user.userType];
      }
      
      const canProceed = await RateLimit.checkRateLimit(key, windowMs, effectiveMax);
      
      if (!canProceed) {
        logger.warn(`Rate limit exceeded [${requestId}]`, {
          key,
          path: req.path,
          ip: req.ip,
          userId: req.userId,
          userRole: req.user?.role,
          userType: req.user?.userType,
          limit: effectiveMax
        });
        
        return res.status(429).json({
          success: false,
          error: "Too many requests. Please try again later.",
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter: Math.ceil(windowMs / 1000),
          requestId
        });
      }
      
      next();
    } catch (error) {
      logger.error(`Rate limit check failed [${requestId}]`, { error: error.message, path: req.path });
      next();
    }
  };
};

// Can message user check
exports.canMessageUser = async (req, res, next) => {
  const requestId = crypto.randomBytes(4).toString('hex');
  const targetUserId = req.params.userId || req.body.receiverId;
  
  if (!targetUserId) return next();
  
  logger.debug(`Can message check [${requestId}]:`, {
    userId: req.user?._id,
    userRole: req.user?.role,
    userType: req.user?.userType,
    targetUserId,
    path: req.path
  });
  
  try {
    if (roleChecker.hasMinimumRole(req.user?.role, ROLES.MODERATOR)) {
      logger.debug(`Staff can message anyone [${requestId}]`, {
        role: req.user.role,
        userType: req.user.userType,
        targetUserId,
        path: req.path
      });
      return next();
    }
    
    const Block = require("@models/Block.model");
    
    const targetUser = await BaseUser.findById(targetUserId)
      .select('accountStatus messagingPreferences role userType')
      .lean();
    
    if (!targetUser || targetUser.accountStatus !== 'active') {
      return res.status(404).json({
        success: false,
        error: "User not found or inactive",
        code: "USER_UNAVAILABLE",
        requestId
      });
    }
    
    const isBlocked = await Block.exists({
      blocker: targetUserId,
      blocked: req.userId,
      active: true
    });
    
    if (isBlocked) {
      logger.warn(`User blocked from messaging [${requestId}]`, { userId: req.userId, targetUserId, path: req.path });
      
      return res.status(403).json({
        success: false,
        error: "Cannot send message to this user",
        code: "USER_BLOCKED",
        requestId
      });
    }
    
    if (roleChecker.hasMinimumRole(targetUser.role, ROLES.MODERATOR)) {
      logger.debug(`Target is staff, allowing messages [${requestId}]`, {
        targetRole: targetUser.role,
        targetUserType: targetUser.userType,
        userId: req.userId
      });
      return next();
    }
    
    if (targetUser.userType === 'DatingUser') {
      if (targetUser.messagingPreferences === 'matches_only') {
        const Match = require("@models/Match.model");
        const areMatched = await Match.exists({
          users: { $all: [req.userId, targetUserId] },
          status: 'matched'
        });
        
        if (!areMatched) {
          return res.status(403).json({
            success: false,
            error: "User only accepts messages from matches",
            code: "MATCH_REQUIRED",
            requestId
          });
        }
      } else if (targetUser.messagingPreferences === 'disabled') {
        return res.status(403).json({
          success: false,
          error: "User is not accepting messages",
          code: "MESSAGING_DISABLED",
          requestId
        });
      }
    }
    
    logger.debug(`Can message check passed [${requestId}]`, {
      userId: req.userId,
      userType: req.user?.userType,
      targetUserId,
      targetUserType: targetUser.userType
    });
    
    next();
  } catch (error) {
    logger.error(`Can message check error [${requestId}]`, {
      error: error.message,
      userId: req.userId,
      userType: req.user?.userType,
      targetUserId
    });
    next();
  }
};

// Additional specialized checks
exports.canViewAdminDashboard = authorizationMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN, { allowHigherRoles: true });
exports.canModerateContent = authorizationMiddleware.authorize(ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN, { allowHigherRoles: true });
exports.canManageUsers = authorizationMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN, { allowHigherRoles: true });

// ========== EXPORTS FOR TESTING ==========
exports._extractToken = tokenService.extractToken.bind(tokenService);
exports._validateToken = tokenService.validateToken.bind(tokenService);
exports._verifyJWT = tokenService.verifyJWT.bind(tokenService);
exports._sanitizeUser = userSanitizer.sanitizeUser.bind(userSanitizer);
exports._setSecurityHeaders = authCoreMiddleware.setSecurityHeaders.bind(authCoreMiddleware);
exports._hasMinimumRole = roleChecker.hasMinimumRole.bind(roleChecker);
exports._isRoleAllowed = roleChecker.isRoleAllowed.bind(roleChecker);
exports._isUserTypeAllowed = roleChecker.isUserTypeAllowed.bind(roleChecker);

// Export role constants
exports.ROLES = ROLES;
exports.ROLE_HIERARCHY = ROLE_HIERARCHY;