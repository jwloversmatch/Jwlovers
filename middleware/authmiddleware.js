const jwt = require("jsonwebtoken");
const { BaseUser, ROLES, DatingUser } = require("@models/User");
// const DatingUser = require("@models/User/datingUserSchema");
const Profile = require("@models/Profile.model");
const logger = require("@utils/logger");

// ========== DEBUG LOGGING ==========
console.log("🔄 Loading auth middleware...");

// ========== CORE AUTHENTICATION ==========
const protect = async (req, res, next) => {
  try {
    console.log("🛡️ protect middleware called for path:", req.path);
    
    let token;
    
    // Get token from Authorization header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }
    
    // Also check for token in cookies
    else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Not authorized to access this route. No token provided.",
        code: "NO_TOKEN",
        timestamp: new Date().toISOString(),
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get base user
    const baseUser = await BaseUser.findById(decoded.userId)
      .select("-password")
      .lean();
    
    if (!baseUser) {
      return res.status(401).json({
        success: false,
        error: "User not found",
        code: "USER_NOT_FOUND",
        timestamp: new Date().toISOString(),
      });
    }
    
    // Check account status
    if (baseUser.accountStatus !== 'active') {
      const statusMessages = {
        'pending_verification': 'Account requires email verification',
        'suspended': 'Account suspended',
        'deactivated': 'Account deactivated',
        'banned': 'Account banned'
      };
      
      return res.status(403).json({
        success: false,
        error: statusMessages[baseUser.accountStatus] || 'Account is not active',
        code: "ACCOUNT_INACTIVE",
        accountStatus: baseUser.accountStatus,
        timestamp: new Date().toISOString(),
      });
    }
    
    // Get dating user and profile if exists
    let datingUser = null;
    let profile = null;
    
    if (baseUser.userType === 'DatingUser') {
      datingUser = await DatingUser.findById(decoded.userId)
        .populate({
          path: 'profile',
          select: 'userName profilePicture profileCompletion age gender location hobbies verificationBadges bio lookingFor'
        })
        .lean();
      
      // Extract profile from populated datingUser
      profile = datingUser?.profile || null;
    }
    
    // If no profile from datingUser, query directly by userId
    if (!profile) {
      profile = await Profile.findOne({ userId: decoded.userId }).lean();
    }
    
    // Combine all user data
    req.user = {
      ...baseUser,
      // Add computed properties
      hasDatingProfile: !!datingUser,
      hasProfile: !!profile,
      profileCompletion: profile?.profileCompletion || 0,
      // Store separate for easy access
      base: baseUser,
      dating: datingUser,
      profile: profile,
      // Backward compatibility
      _id: baseUser._id,
      id: baseUser._id.toString(),
      role: baseUser.role,
      userType: baseUser.userType,
      email: baseUser.email,
      firstName: baseUser.firstName,
      lastName: baseUser.lastName
    };
    
    // Set request metadata
    req.userId = baseUser._id.toString();
    req.userRole = baseUser.role;
    req.userType = baseUser.userType;
    
    logger.debug("User authenticated successfully", {
      userId: req.userId,
      userType: req.userType,
      role: req.userRole,
      hasDatingProfile: !!datingUser,
      hasProfile: !!profile
    });
    
    next();
  } catch (error) {
    logger.error("Authentication error:", error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: "Invalid token",
        code: "INVALID_TOKEN",
        timestamp: new Date().toISOString(),
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: "Token expired",
        code: "TOKEN_EXPIRED",
        timestamp: new Date().toISOString(),
      });
    }
    
    return res.status(401).json({
      success: false,
      error: "Not authorized to access this route",
      code: "AUTH_FAILED",
      timestamp: new Date().toISOString(),
    });
  }
};

// ========== OPTIONAL AUTHENTICATION ==========
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }
    
    if (!token) {
      // No token, proceed as unauthenticated user
      req.user = null;
      req.userId = null;
      req.userRole = null;
      req.userType = null;
      return next();
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get base user
    const baseUser = await BaseUser.findById(decoded.userId)
      .select("-password")
      .lean();
    
    if (!baseUser) {
      req.user = null;
      req.userId = null;
      req.userRole = null;
      req.userType = null;
      return next();
    }
    
    // Get dating user and profile if exists
    let datingUser = null;
    let profile = null;
    
    if (baseUser.userType === 'DatingUser') {
      datingUser = await DatingUser.findById(decoded.userId)
        .populate({
          path: 'profile',
          select: 'userName profilePicture profileCompletion'
        })
        .lean();
      
      // Extract profile from populated datingUser
      profile = datingUser?.profile || null;
    }
    
    // If no profile from datingUser, query directly by userId
    if (!profile) {
      profile = await Profile.findOne({ userId: decoded.userId })
        .select('userName profilePicture profileCompletion')
        .lean();
    }
    
    // Set user data
    req.user = {
      ...baseUser,
      dating: datingUser,
      profile: profile,
      _id: baseUser._id,
      id: baseUser._id.toString(),
      role: baseUser.role,
      userType: baseUser.userType
    };
    
    req.userId = baseUser._id.toString();
    req.userRole = baseUser.role;
    req.userType = baseUser.userType;
    
    next();
  } catch (error) {
    // Invalid token, proceed as unauthenticated
    req.user = null;
    req.userId = null;
    req.userRole = null;
    req.userType = null;
    next();
  }
};

// ========== ROLE-BASED AUTHORIZATION ==========
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
        code: "NOT_AUTHENTICATED",
        timestamp: new Date().toISOString(),
      });
    }
    
    if (!roles.includes(req.user.role)) {
      logger.warn("Unauthorized access attempt", {
        userId: req.userId,
        userRole: req.userRole,
        requiredRoles: roles,
        path: req.path
      });
      
      return res.status(403).json({
        success: false,
        error: "You do not have permission to perform this action",
        code: "FORBIDDEN",
        requiredRoles: roles,
        timestamp: new Date().toISOString(),
      });
    }
    
    next();
  };
};

// ========== MINIMUM ROLE CHECK ==========
const requireMinimumRole = (requiredRole) => {
  return (req, res, next) => {
    console.log(`🔐 requireMinimumRole called: need ${requiredRole}, user has ${req.user?.role}`);
    
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
        code: "NOT_AUTHENTICATED",
        timestamp: new Date().toISOString(),
      });
    }
    
    // Define role hierarchy
    const roleHierarchy = {
      'user': 0,
      'moderator': 1,
      'admin': 2,
      'super_admin': 3
    };
    
    const userRoleLevel = roleHierarchy[req.user.role] || 0;
    const requiredRoleLevel = roleHierarchy[requiredRole] || 0;
    
    if (userRoleLevel < requiredRoleLevel) {
      logger.warn("Minimum role requirement not met", {
        userId: req.userId,
        userRole: req.user.role,
        requiredRole,
        path: req.path
      });
      
      return res.status(403).json({
        success: false,
        error: `Minimum role required: ${requiredRole}`,
        code: "MINIMUM_ROLE_REQUIRED",
        userRole: req.user.role,
        requiredRole,
        timestamp: new Date().toISOString(),
      });
    }
    
    next();
  };
};

// ========== SPECIFIC PERMISSION CHECKS ==========
const canViewAdminDashboard = (req, res, next) => {
  console.log("📊 canViewAdminDashboard middleware called");
  
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "Not authenticated",
      code: "NOT_AUTHENTICATED",
      timestamp: new Date().toISOString(),
    });
  }
  
  // Only staff can view admin dashboard
  if (!['moderator', 'admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: "Admin dashboard access restricted to staff",
      code: "ADMIN_DASHBOARD_RESTRICTED",
      userRole: req.user.role,
      timestamp: new Date().toISOString(),
    });
  }
  
  next();
};

const canModerateContent = (req, res, next) => {
  console.log("⚖️ canModerateContent middleware called");
  
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "Not authenticated",
      code: "NOT_AUTHENTICATED",
      timestamp: new Date().toISOString(),
    });
  }
  
  // Only moderators, admins, and super admins can moderate
  if (!['moderator', 'admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: "Content moderation restricted to staff",
      code: "MODERATION_RESTRICTED",
      userRole: req.user.role,
      timestamp: new Date().toISOString(),
    });
  }
  
  next();
};

// ========== USER TYPE AUTHORIZATION ==========
const authorizeUserType = (...userTypes) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
        code: "NOT_AUTHENTICATED",
        timestamp: new Date().toISOString(),
      });
    }
    
    if (!userTypes.includes(req.user.userType)) {
      logger.warn("Unauthorized user type access", {
        userId: req.userId,
        userType: req.userType,
        requiredTypes: userTypes,
        path: req.path
      });
      
      return res.status(403).json({
        success: false,
        error: "This action is not available for your account type",
        code: "USER_TYPE_RESTRICTED",
        requiredTypes: userTypes,
        timestamp: new Date().toISOString(),
      });
    }
    
    next();
  };
};

// ========== DATING PROFILE CHECK ==========
const requireDatingProfile = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
        code: "NOT_AUTHENTICATED",
        timestamp: new Date().toISOString(),
      });
    }
    
    if (req.user.userType !== 'DatingUser') {
      return res.status(403).json({
        success: false,
        error: "This feature is only available for dating users",
        code: "NOT_DATING_USER",
        timestamp: new Date().toISOString(),
      });
    }
    
    // Check if dating profile exists (could be from req.user.dating or fresh query)
    let datingUser = req.user.dating;
    
    if (!datingUser) {
      datingUser = await DatingUser.findById(req.userId);
    }
    
    if (!datingUser) {
      return res.status(404).json({
        success: false,
        error: "Dating profile not found",
        code: "NO_DATING_PROFILE",
        timestamp: new Date().toISOString(),
      });
    }
    
    // Store dating user data
    req.datingUser = datingUser;
    
    next();
  } catch (error) {
    logger.error("Dating profile check error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      code: "INTERNAL_ERROR",
      timestamp: new Date().toISOString(),
    });
  }
};

// ========== PROFILE COMPLETION CHECK ==========
const requireProfileCompletion = (minCompletion = 70) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: "Not authenticated",
          code: "NOT_AUTHENTICATED",
          timestamp: new Date().toISOString(),
        });
      }
      
      // Try to get profile from req.user first
      let profile = req.user.profile;
      
      // If not available, query by userId
      if (!profile) {
        profile = await Profile.findOne({ userId: req.userId })
          .select('profileCompletion');
      }
      
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: "Profile not found",
          code: "PROFILE_NOT_FOUND",
          timestamp: new Date().toISOString(),
        });
      }
      
      const completion = profile.profileCompletion || 0;
      
      if (completion < minCompletion) {
        return res.status(403).json({
          success: false,
          error: `Profile completion must be at least ${minCompletion}% to access this feature`,
          code: "INCOMPLETE_PROFILE",
          currentCompletion: completion,
          requiredCompletion: minCompletion,
          missingFields: await getMissingProfileFields(req.userId),
          timestamp: new Date().toISOString(),
        });
      }
      
      next();
    } catch (error) {
      logger.error("Profile completion check error:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        code: "INTERNAL_ERROR",
        timestamp: new Date().toISOString(),
      });
    }
  };
};

// Helper function to get missing profile fields
const getMissingProfileFields = async (userId) => {
  try {
    const profile = await Profile.findOne({ userId });
    if (!profile) return ['profile'];
    
    const missing = [];
    
    // Check essential fields
    if (!profile.userName) missing.push('username');
    if (!profile.profilePicture?.url) missing.push('profilePicture');
    if (!profile.bio || profile.bio.length < 10) missing.push('bio');
    if (!profile.age) missing.push('age');
    if (!profile.gender) missing.push('gender');
    if (!profile.location?.city) missing.push('location');
    if (!profile.hobbies || profile.hobbies.length === 0) missing.push('interests');
    
    return missing;
  } catch (error) {
    return [];
  }
};

// ========== AGE VERIFICATION CHECK ==========
const requireAgeVerification = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
        code: "NOT_AUTHENTICATED",
        timestamp: new Date().toISOString(),
      });
    }
    
    // Check if user is a DatingUser
    if (req.user.userType !== 'DatingUser') {
      return next(); // Non-dating users don't need age verification
    }
    
    // Try to get from req.user.dating first
    let datingUser = req.user.dating;
    
    // If not available, query
    if (!datingUser) {
      datingUser = await DatingUser.findById(req.userId)
        .select('ageVerified');
    }
    
    if (!datingUser || !datingUser.ageVerified) {
      return res.status(403).json({
        success: false,
        error: "Age verification required for dating features",
        code: "AGE_VERIFICATION_REQUIRED",
        timestamp: new Date().toISOString(),
      });
    }
    
    next();
  } catch (error) {
    logger.error("Age verification check error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      code: "INTERNAL_ERROR",
      timestamp: new Date().toISOString(),
    });
  }
};

// ========== EMAIL VERIFICATION CHECK ==========
const requireEmailVerification = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: "Not authenticated",
      code: "NOT_AUTHENTICATED",
      timestamp: new Date().toISOString(),
    });
  }
  
  if (!req.user.emailVerified) {
    return res.status(403).json({
      success: false,
      error: "Email verification required",
      code: "EMAIL_VERIFICATION_REQUIRED",
      timestamp: new Date().toISOString(),
    });
  }
  
  next();
};

// ========== OWNERSHIP CHECK ==========
const requireOwnership = (resourcePath = 'userId') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: "Not authenticated",
          code: "NOT_AUTHENTICATED",
          timestamp: new Date().toISOString(),
        });
      }
      
      // Extract target user ID from request
      let targetUserId;
      
      if (resourcePath === 'params.userId') {
        targetUserId = req.params.userId;
      } else if (resourcePath === 'params.id') {
        targetUserId = req.params.id;
      } else if (resourcePath === 'body.userId') {
        targetUserId = req.body.userId;
      } else if (resourcePath === 'self') {
        targetUserId = req.userId;
      } else {
        // Try to extract from params
        targetUserId = req.params[resourcePath] || req.userId;
      }
      
      // Allow admins to access any resource
      if (req.user.role === 'admin' || req.user.role === 'super_admin') {
        return next();
      }
      
      // Check ownership
      if (targetUserId !== req.userId) {
        logger.warn("Ownership violation attempt", {
          userId: req.userId,
          targetUserId,
          path: req.path,
          userRole: req.userRole
        });
        
        return res.status(403).json({
          success: false,
          error: "You do not own this resource",
          code: "OWNERSHIP_VIOLATION",
          timestamp: new Date().toISOString(),
        });
      }
      
      next();
    } catch (error) {
      logger.error("Ownership check error:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        code: "INTERNAL_ERROR",
        timestamp: new Date().toISOString(),
      });
    }
  };
};

// ========== PREMIUM FEATURE CHECK ==========
const requirePremium = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
        code: "NOT_AUTHENTICATED",
        timestamp: new Date().toISOString(),
      });
    }
    
    // Try to get from req.user.dating first
    let datingUser = req.user.dating;
    
    // If not available, query
    if (!datingUser) {
      datingUser = await DatingUser.findById(req.userId)
        .select('isPremium premiumExpiresAt');
    }
    
    if (!datingUser || !datingUser.isPremium) {
      return res.status(403).json({
        success: false,
        error: "Premium subscription required",
        code: "PREMIUM_REQUIRED",
        timestamp: new Date().toISOString(),
      });
    }
    
    // Check if premium hasn't expired
    if (datingUser.premiumExpiresAt && datingUser.premiumExpiresAt < new Date()) {
      return res.status(403).json({
        success: false,
        error: "Premium subscription has expired",
        code: "PREMIUM_EXPIRED",
        timestamp: new Date().toISOString(),
      });
    }
    
    next();
  } catch (error) {
    logger.error("Premium check error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      code: "INTERNAL_ERROR",
      timestamp: new Date().toISOString(),
    });
  }
};

// ========== QUICK ACCESS MIDDLEWARE ==========
const userOnly = authorize('user');
const moderatorOnly = authorize('moderator');
const adminOnly = authorize('admin');
const superAdminOnly = authorize('super_admin');

const datingUserOnly = authorizeUserType('DatingUser');
const staffOnly = authorizeUserType('Staff', 'Admin', 'SuperAdmin');

// ========== EXPORTS ==========
module.exports = {
  // Core authentication
  protect,
  optionalAuth,
  authorize,
  authorizeUserType,
  
  // Specialized middleware
  requireDatingProfile,
  requireProfileCompletion,
  requireAgeVerification,
  requireEmailVerification,
  requireOwnership,
  requirePremium,
  requireMinimumRole, // ← NEW
  canViewAdminDashboard, // ← NEW
  canModerateContent, // ← NEW
  
  // Quick access middleware
  userOnly,
  moderatorOnly,
  adminOnly,
  superAdminOnly,
  datingUserOnly,
  staffOnly,
  
  // Constants
  ROLES,
  
  // Helper functions for testing
  _getMissingProfileFields: getMissingProfileFields
};

console.log("✅ Auth middleware loaded successfully!");