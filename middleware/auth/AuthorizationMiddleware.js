// middleware/auth/AuthorizationMiddleware.js
const crypto = require("crypto");
const { ROLES } = require("@models/User");
const roleChecker = require("@utils/RoleChecker");
const RateLimit = require("@services/ratelimiter.service");
const logger = require("@utils/logger");

class AuthorizationMiddleware {
  authorize(...allowedRoles) {
    return async (req, res, next) => {
      const requestId = crypto.randomBytes(4).toString('hex');
      const options = typeof allowedRoles[allowedRoles.length - 1] === 'object' 
        ? allowedRoles.pop() 
        : {};
      
      logger.debug(`Role check [${requestId}]:`, {
        allowedRoles,
        userRole: req.user?.role,
        userType: req.user?.userType,
        path: req.path,
        options
      });
      
      try {
        if (!req.user) {
          logger.warn(`No user for role check [${requestId}]`, { path: req.path, ip: req.ip });
          
          return res.status(401).json({
            success: false,
            error: "Authentication required",
            code: "AUTH_REQUIRED",
            requestId
          });
        }
        
        if (!roleChecker.isRoleAllowed(req.user.role, allowedRoles, options)) {
          logger.warn(`Role not allowed [${requestId}]`, {
            userRole: req.user.role,
            userType: req.user.userType,
            allowedRoles,
            userId: req.user._id,
            path: req.path,
            ip: req.ip
          });
          
          if (req.user.role === 'user' && allowedRoles.includes('moderator')) {
            await RateLimit.trackSuspiciousActivity(req.ip, 'role_escalation_attempt');
          }
          
          return res.status(403).json({
            success: false,
            error: `Access denied. ${req.user.role} role cannot perform this action.`,
            code: "ROLE_NOT_ALLOWED",
            requiredRoles: allowedRoles,
            userRole: req.user.role,
            userType: req.user.userType,
            requestId
          });
        }
        
        logger.debug(`Role check passed [${requestId}]`, {
          role: req.user.role,
          userType: req.user.userType,
          path: req.path
        });
        
        next();
      } catch (error) {
        logger.error(`Role check error [${requestId}]`, { error: error.message, path: req.path });
        
        return res.status(500).json({
          success: false,
          error: "Authorization check failed",
          code: "AUTHORIZATION_ERROR",
          requestId
        });
      }
    };
  }

  authorizeUserType(...allowedUserTypes) {
    return async (req, res, next) => {
      const requestId = crypto.randomBytes(4).toString('hex');
      
      logger.debug(`User type check [${requestId}]:`, {
        allowedUserTypes,
        userType: req.user?.userType,
        userRole: req.user?.role,
        path: req.path
      });
      
      try {
        if (!req.user) {
          logger.warn(`No user for user type check [${requestId}]`, { path: req.path, ip: req.ip });
          
          return res.status(401).json({
            success: false,
            error: "Authentication required",
            code: "AUTH_REQUIRED",
            requestId
          });
        }
        
        if (!roleChecker.isUserTypeAllowed(req.user.userType, allowedUserTypes)) {
          logger.warn(`User type not allowed [${requestId}]`, {
            userType: req.user.userType,
            allowedUserTypes,
            userId: req.user._id,
            path: req.path,
            ip: req.ip
          });
          
          return res.status(403).json({
            success: false,
            error: `Access denied. ${req.user.userType} accounts cannot perform this action.`,
            code: "USER_TYPE_NOT_ALLOWED",
            requiredUserTypes: allowedUserTypes,
            userType: req.user.userType,
            userRole: req.user.role,
            requestId
          });
        }
        
        logger.debug(`User type check passed [${requestId}]`, {
          userType: req.user.userType,
          path: req.path
        });
        
        next();
      } catch (error) {
        logger.error(`User type check error [${requestId}]`, { error: error.message, path: req.path });
        
        return res.status(500).json({
          success: false,
          error: "User type check failed",
          code: "USER_TYPE_CHECK_ERROR",
          requestId
        });
      }
    };
  }

  requireMinimumRole(minimumRole) {
    return async (req, res, next) => {
      const requestId = crypto.randomBytes(4).toString('hex');
      
      logger.debug(`Minimum role check [${requestId}]:`, {
        minimumRole,
        userRole: req.user?.role,
        userType: req.user?.userType,
        path: req.path
      });
      
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            error: "Authentication required",
            code: "AUTH_REQUIRED",
            requestId
          });
        }
        
        if (!roleChecker.hasMinimumRole(req.user.role, minimumRole)) {
          logger.warn(`Minimum role not met [${requestId}]`, {
            userRole: req.user.role,
            userType: req.user.userType,
            minimumRole,
            userId: req.user._id,
            path: req.path
          });
          
          return res.status(403).json({
            success: false,
            error: `Access denied. Minimum role required: ${minimumRole}`,
            code: "INSUFFICIENT_ROLE",
            requiredRole: minimumRole,
            userRole: req.user.role,
            userType: req.user.userType,
            requestId
          });
        }
        
        logger.debug(`Minimum role check passed [${requestId}]`, {
          userRole: req.user.role,
          userType: req.user.userType,
          minimumRole,
          path: req.path
        });
        
        next();
      } catch (error) {
        logger.error(`Minimum role check error [${requestId}]`, { error: error.message, path: req.path });
        
        return res.status(500).json({
          success: false,
          error: "Role check failed",
          code: "ROLE_CHECK_ERROR",
          requestId
        });
      }
    };
  }

  // Convenience methods
  get userOnly() {
    return this.authorizeUserType('DatingUser');
  }

  get staffOnly() {
    return this.authorizeUserType('Moderator', 'Admin', 'SuperAdmin');
  }

  get moderatorOnly() {
    return this.authorize(ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN, { allowHigherRoles: true });
  }

  get adminOnly() {
    return this.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN, { allowHigherRoles: true });
  }

  get superAdminOnly() {
    return this.authorize(ROLES.SUPER_ADMIN);
  }
}

module.exports = new AuthorizationMiddleware();