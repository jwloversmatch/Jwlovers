// middleware/auth/SpecializedAuthMiddleware.js
const crypto = require("crypto");
const { ROLES } = require("@models/User");
const roleChecker = require("@utils/RoleChecker");
const RateLimit = require("@services/ratelimiter.service");
const logger = require("@utils/logger");

class SpecializedAuthMiddleware {
  // Verified users only
  async verifiedOnly(req, res, next) {
    const requestId = crypto.randomBytes(4).toString('hex');
    
    logger.debug(`Verified check [${requestId}]:`, {
      path: req.path,
      userId: req.user?._id,
      userRole: req.user?.role,
      userType: req.user?.userType
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
      
      // Staff roles bypass verification
      if (roleChecker.hasMinimumRole(req.user.role, ROLES.MODERATOR)) {
        logger.debug(`Staff role bypass verification [${requestId}]`, {
          role: req.user.role,
          userType: req.user.userType,
          path: req.path
        });
        return next();
      }
      
      // Dating users need age verification
      if (req.user.userType === 'DatingUser') {
        const isFullyVerified = req.user.emailVerified && req.user.ageVerified;
        
        if (!isFullyVerified) {
          const missingVerifications = [];
          if (!req.user.emailVerified) missingVerifications.push('email');
          if (!req.user.ageVerified) missingVerifications.push('age');
          
          logger.warn(`Dating user not fully verified [${requestId}]`, {
            userId: req.user._id,
            userType: req.user.userType,
            emailVerified: req.user.emailVerified,
            ageVerified: req.user.ageVerified,
            path: req.path
          });
          
          return res.status(403).json({
            success: false,
            error: "Account verification required for dating users",
            code: "VERIFICATION_REQUIRED",
            missing: missingVerifications,
            requestId
          });
        }
      }
      
      // Non-dating users need email verification
      if (!req.user.emailVerified) {
        logger.warn(`Email not verified [${requestId}]`, {
          userId: req.user._id,
          userType: req.user.userType,
          path: req.path
        });
        
        return res.status(403).json({
          success: false,
          error: "Email verification required",
          code: "EMAIL_VERIFICATION_REQUIRED",
          requestId
        });
      }
      
      logger.debug(`Verified check passed [${requestId}]`, {
        userId: req.user._id,
        userType: req.user.userType,
        path: req.path
      });
      
      next();
    } catch (error) {
      logger.error(`Verified check error [${requestId}]`, { error: error.message, path: req.path });
      
      return res.status(500).json({
        success: false,
        error: "Verification check failed",
        code: "VERIFICATION_ERROR",
        requestId
      });
    }
  }

  // Profile completion check
  async profileCompleted(req, res, next) {
    const requestId = crypto.randomBytes(4).toString('hex');
    
    logger.debug(`Profile completion check [${requestId}]:`, {
      userId: req.user?._id,
      userRole: req.user?.role,
      userType: req.user?.userType,
      path: req.path
    });
    
    try {
      if (!req.userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
          code: "AUTH_REQUIRED",
          requestId
        });
      }
      
      // Non-dating users don't need profile completion
      if (req.user.userType !== 'DatingUser') {
        logger.debug(`Non-dating user bypass profile completion [${requestId}]`, {
          userType: req.user.userType,
          path: req.path
        });
        return next();
      }
      
      const Profile = require("@models/Profile.model");
      const profile = await Profile.findOne({ userId: req.userId }).lean();
      
      if (!profile) {
        return res.status(403).json({
          success: false,
          error: "Please complete your dating profile to access this feature",
          code: "PROFILE_INCOMPLETE",
          redirectTo: "/profile/create",
          requestId
        });
      }
      
      const minCompletion = 70;
      const completion = profile.profileCompletion || 0;
      
      if (completion < minCompletion) {
        logger.warn(`Profile completion insufficient [${requestId}]`, {
          userId: req.userId,
          userType: req.user.userType,
          completion,
          required: minCompletion,
          path: req.path
        });
        
        return res.status(403).json({
          success: false,
          error: `Please complete your dating profile (at least ${minCompletion}%) to access this feature`,
          code: "PROFILE_INSUFFICIENT",
          profileCompletion: completion,
          requiredCompletion: minCompletion,
          redirectTo: "/profile/me",
          requestId
        });
      }
      
      req.profile = profile;
      logger.debug(`Profile check passed [${requestId}]`, {
        userId: req.userId,
        userType: req.user.userType,
        completion,
        path: req.path
      });
      
      next();
    } catch (error) {
      logger.error(`Profile check error [${requestId}]`, {
        error: error.message,
        userId: req.userId,
        userType: req.user?.userType,
        path: req.path
      });
      
      return res.status(500).json({
        success: false,
        error: "Profile check failed",
        code: "PROFILE_CHECK_ERROR",
        requestId
      });
    }
  }

  // Resource ownership check
  requireOwnership(options = {}) {
    const {
      modelName,
      idParam = 'id',
      ownerField = 'userId',
      adminOverride = true,
      moderatorOverride = false,
      allowPublic = false,
      allowSameUserType = false
    } = options;
    
    return async (req, res, next) => {
      const requestId = crypto.randomBytes(4).toString('hex');
      const resourceId = req.params[idParam];
      
      logger.debug(`Ownership check [${requestId}]:`, {
        modelName,
        resourceId,
        userId: req.user?._id,
        userRole: req.user?.role,
        userType: req.user?.userType,
        path: req.path
      });
      
      try {
        if (!resourceId) {
          return res.status(400).json({
            success: false,
            error: "Resource ID is required",
            code: "MISSING_RESOURCE_ID",
            requestId
          });
        }
        
        if (!req.user && !allowPublic) {
          return res.status(401).json({
            success: false,
            error: "Authentication required",
            code: "AUTH_REQUIRED",
            requestId
          });
        }
        
        const Model = require(`@models/${modelName}.model`);
        const resource = await Model.findById(resourceId).lean();
        
        if (!resource) {
          return res.status(404).json({
            success: false,
            error: "Resource not found",
            code: "RESOURCE_NOT_FOUND",
            requestId
          });
        }
        
        if (allowPublic && resource.isPublic === true) {
          logger.debug(`Public resource access granted [${requestId}]`, {
            modelName,
            resourceId,
            path: req.path
          });
          req.resource = resource;
          return next();
        }
        
        if (adminOverride && roleChecker.hasMinimumRole(req.user?.role, ROLES.ADMIN)) {
          logger.debug(`Admin ownership override [${requestId}]`, {
            modelName,
            resourceId,
            adminRole: req.user.role,
            userType: req.user.userType
          });
          req.resource = resource;
          return next();
        }
        
        if (moderatorOverride && roleChecker.hasMinimumRole(req.user?.role, ROLES.MODERATOR)) {
          logger.debug(`Moderator ownership override [${requestId}]`, {
            modelName,
            resourceId,
            moderatorRole: req.user.role,
            userType: req.user.userType
          });
          req.resource = resource;
          return next();
        }
        
        if (allowSameUserType && resource.userType && req.user?.userType === resource.userType) {
          logger.debug(`Same user type access granted [${requestId}]`, {
            modelName,
            resourceId,
            userType: req.user.userType
          });
          req.resource = resource;
          return next();
        }
        
        const ownerId = resource[ownerField] || resource.userId || resource.createdBy || resource.user;
        
        if (!ownerId) {
          logger.error(`No owner field found [${requestId}]`, {
            modelName,
            resourceId,
            availableFields: Object.keys(resource)
          });
          
          return res.status(500).json({
            success: false,
            error: "Resource ownership could not be determined",
            code: "OWNERSHIP_UNDETERMINED",
            requestId
          });
        }
        
        const ownerIdStr = ownerId.toString();
        const userIdStr = req.user?._id?.toString();
        
        if (ownerIdStr !== userIdStr) {
          logger.warn(`Ownership check failed [${requestId}]`, {
            modelName,
            resourceId,
            ownerId: ownerIdStr,
            userId: userIdStr,
            userType: req.user?.userType,
            path: req.path,
            ip: req.ip
          });
          
          await RateLimit.trackSuspiciousActivity(req.ip, 'ownership_violation_attempt');
          
          return res.status(403).json({
            success: false,
            error: "You don't have permission to access this resource",
            code: "OWNERSHIP_VIOLATION",
            requestId
          });
        }
        
        req.resource = resource;
        logger.debug(`Ownership check passed [${requestId}]`, {
          modelName,
          resourceId,
          userId: userIdStr,
          userType: req.user?.userType
        });
        
        next();
      } catch (error) {
        logger.error(`Ownership check error [${requestId}]`, {
          error: error.message,
          modelName,
          resourceId,
          path: req.path
        });
        
        return res.status(500).json({
          success: false,
          error: "Ownership verification failed",
          code: "OWNERSHIP_CHECK_ERROR",
          requestId
        });
      }
    };
  }
}

module.exports = new SpecializedAuthMiddleware();