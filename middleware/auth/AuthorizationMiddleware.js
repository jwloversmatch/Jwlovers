// middleware/auth/AuthorizationMiddleware.js - MINOR UPDATES
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
          
          // Track suspicious activity for role escalation attempts
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

  // ========== NEW: PROFILE-BASED AUTHORIZATION ==========
  
  requireProfile() {
    return async (req, res, next) => {
      const requestId = crypto.randomBytes(4).toString('hex');
      
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            error: "Authentication required",
            code: "AUTH_REQUIRED",
            requestId
          });
        }
        
        // Check if user has a profile
        if (!req.userData?.profile) {
          logger.warn(`Profile required but not found [${requestId}]`, {
            userId: req.user._id,
            userType: req.user.userType,
            path: req.path
          });
          
          return res.status(403).json({
            success: false,
            error: "Profile required to access this feature",
            code: "PROFILE_REQUIRED",
            endpoint: "/api/auth/profile",
            requestId
          });
        }
        
        logger.debug(`Profile check passed [${requestId}]`, {
          userId: req.user._id,
          hasProfile: true,
          path: req.path
        });
        
        next();
      } catch (error) {
        logger.error(`Profile check error [${requestId}]`, { error: error.message, path: req.path });
        
        return res.status(500).json({
          success: false,
          error: "Profile check failed",
          code: "PROFILE_CHECK_ERROR",
          requestId
        });
      }
    };
  }

  requireDatingProfile() {
    return async (req, res, next) => {
      const requestId = crypto.randomBytes(4).toString('hex');
      
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            error: "Authentication required",
            code: "AUTH_REQUIRED",
            requestId
          });
        }
        
        // Check if user is a dating user type
        if (req.user.userType !== 'DatingUser') {
          return res.status(403).json({
            success: false,
            error: "This feature is only available for dating users",
            code: "DATING_USER_REQUIRED",
            userType: req.user.userType,
            requestId
          });
        }
        
        // Check if user has a dating profile
        if (!req.userData?.datingUser) {
          logger.warn(`Dating profile required but not found [${requestId}]`, {
            userId: req.user._id,
            userType: req.user.userType,
            path: req.path
          });
          
          return res.status(403).json({
            success: false,
            error: "Dating profile required to access this feature",
            code: "DATING_PROFILE_REQUIRED",
            endpoint: "/api/auth/dating-profile",
            requestId
          });
        }
        
        logger.debug(`Dating profile check passed [${requestId}]`, {
          userId: req.user._id,
          hasDatingProfile: true,
          path: req.path
        });
        
        next();
      } catch (error) {
        logger.error(`Dating profile check error [${requestId}]`, { error: error.message, path: req.path });
        
        return res.status(500).json({
          success: false,
          error: "Dating profile check failed",
          code: "DATING_PROFILE_CHECK_ERROR",
          requestId
        });
      }
    };
  }

  requireCompleteProfile(minCompletion = 80) {
    return async (req, res, next) => {
      const requestId = crypto.randomBytes(4).toString('hex');
      
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            error: "Authentication required",
            code: "AUTH_REQUIRED",
            requestId
          });
        }
        
        // Check if user has a profile
        if (!req.userData?.profile) {
          return res.status(403).json({
            success: false,
            error: "Profile required",
            code: "PROFILE_REQUIRED",
            endpoint: "/api/auth/profile",
            requestId
          });
        }
        
        // Check profile completion
        const profileCompletion = req.userData.profile.profileCompletion || 0;
        
        if (profileCompletion < minCompletion) {
          logger.warn(`Profile completion too low [${requestId}]`, {
            userId: req.user._id,
            currentCompletion: profileCompletion,
            requiredCompletion: minCompletion,
            path: req.path
          });
          
          return res.status(403).json({
            success: false,
            error: `Profile must be at least ${minCompletion}% complete to access this feature`,
            code: "INCOMPLETE_PROFILE",
            currentCompletion: profileCompletion,
            requiredCompletion: minCompletion,
            requestId
          });
        }
        
        logger.debug(`Profile completion check passed [${requestId}]`, {
          userId: req.user._id,
          completion: profileCompletion,
          required: minCompletion,
          path: req.path
        });
        
        next();
      } catch (error) {
        logger.error(`Profile completion check error [${requestId}]`, { error: error.message, path: req.path });
        
        return res.status(500).json({
          success: false,
          error: "Profile completion check failed",
          code: "PROFILE_COMPLETION_CHECK_ERROR",
          requestId
        });
      }
    };
  }

  // ========== CONVENIENCE METHODS (Updated) ==========
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

  // NEW: Convenience methods for profile-based authorization
  get withProfile() {
    return this.requireProfile();
  }

  get withDatingProfile() {
    return this.requireDatingProfile();
  }

  get withCompleteProfile() {
    return this.requireCompleteProfile(80);
  }
}

module.exports = new AuthorizationMiddleware();