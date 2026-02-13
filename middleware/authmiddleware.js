// middleware/authmiddleware.js - COMPLETE FIXED VERSION with NEW SCHEMA
const jwt = require("jsonwebtoken");
const { BaseUser, ROLES, DatingUser } = require("@models/User");
const Profile = require("@models/Profile/Profile.model");
const logger = require("@utils/logger");

// ========== DEBUG LOGGING ==========
console.log("🔄 Loading auth middleware...");

// ========== CORE AUTHENTICATION ==========
const protect = async (req, res, next) => {
  try {
    console.log("🛡️ protect middleware called for path:", req.path);
    
    let token;
    
    if (req.headers.authorization?.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Not authorized. No token provided.",
        code: "NO_TOKEN",
        timestamp: new Date().toISOString(),
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
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
    
    // ========== GET DATING USER WITH NEW SCHEMA ==========
    let datingUser = null;
    if (baseUser.userType === 'DatingUser') {
      datingUser = await DatingUser.findById(decoded.userId)
        .select('isPremium ageVerified datingStats.lastActiveDate datingPrivacySettings')
        .lean();
    }
    
    // ========== GET PROFILE WITH NEW SCHEMA NESTED FIELDS ==========
    const profile = await Profile.findOne({ userId: decoded.userId })
      .select(
        'basic.userName ' +
        'basic.bio ' +
        'basic.dateOfBirth ' +
        'basic.gender ' +
        'basic.height ' +
        'photos.profile.url ' +
        'photos.gallery ' +
        'location.city ' +
        'location.country ' +
        'faith.servingAs ' +
        'faith.baptismDate ' +
        'faith.pioneerHours ' +
        'faith.congregation ' +
        'faith.missionary ' +
        'faith.bethel ' +
        'relationship.status ' +
        'relationship.lookingFor ' +
        'relationship.children ' +
        'relationship.livingSituation ' +
        'career.education ' +
        'career.work ' +
        'lifestyle.hobbies ' +
        'lifestyle.languages ' +
        'lifestyle.pets ' +
        'lifestyle.diet ' +
        'lifestyle.exercise ' +
        'lifestyle.smoking ' +
        'lifestyle.drinking ' +
        'personality.introvertExtrovert ' +
        'personality.loveLanguage ' +
        'personality.communicationStyle ' +
        'personality.spiritualGoals ' +
        'personality.meetingAttendance ' +
        'preferences.basic ' +
        'preferences.faith ' +
        'preferences.relationship ' +
        'preferences.dealbreakers ' +
        'settings.isVisible ' +
        'settings.isPaused ' +
        'settings.tags ' +
        'settings.privacy ' +
        'badges ' +
        'stats ' +
        'progress.completion ' +
        'progress.onboardingCompleted ' +
        'age'
      )
      .lean();

    // ========== BUILD USER OBJECT WITH NEW SCHEMA PATHS ==========
    req.user = {
      ...baseUser,
      _id: baseUser._id,
      id: baseUser._id.toString(),
      role: baseUser.role,
      userType: baseUser.userType,
      email: baseUser.email,
      firstName: baseUser.firstName,
      lastName: baseUser.lastName,
      
      // Full profile object
      profile: profile || null,
      
      // Computed properties
      hasProfile: !!profile,
      hasDatingProfile: !!datingUser,
      profileCompletion: profile?.progress?.completion || 0,
      isDatingEligible: profile?.age >= 18 || false,
      hasCompletedOnboarding: profile?.progress?.onboardingCompleted || false,
      
      // ========== FLATTENED AUTH FIELDS - NEW SCHEMA ==========
      // Basic info
      userName: profile?.basic?.userName || null,
      avatar: profile?.photos?.profile?.url || null,
      bio: profile?.basic?.bio || null,
      age: profile?.age || null,
      gender: profile?.basic?.gender || null,
      height: profile?.basic?.height || null,
      
      // Location
      city: profile?.location?.city || null,
      country: profile?.location?.country || null,
      
      // JW Faith
      servingAs: profile?.faith?.servingAs || null,
      isBaptized: !!profile?.faith?.baptismDate,
      isPioneer: ['regular_pioneer', 'auxiliary_pioneer', 'special_pioneer'].includes(profile?.faith?.servingAs),
      isMissionary: profile?.faith?.missionary?.served || false,
      isBethelite: profile?.faith?.bethel?.served || false,
      
      // Relationship
      relationshipStatus: profile?.relationship?.status || null,
      lookingFor: profile?.relationship?.lookingFor || [],
      
      // Career
      occupation: profile?.career?.work?.occupation || null,
      education: profile?.career?.education?.level || null,
      
      // Lifestyle
      hobbies: profile?.lifestyle?.hobbies || [],
      languages: profile?.lifestyle?.languages || [],
      
      // Dating settings
      isDatingVisible: profile?.settings?.isVisible ?? true,
      isDatingPaused: profile?.settings?.isPaused ?? false,
      showAge: profile?.settings?.privacy?.showAge ?? true,
      showDistance: profile?.settings?.privacy?.showDistance ?? true,
      showLastActive: profile?.settings?.privacy?.showLastActive || 'everyone',
      showCongregation: profile?.settings?.privacy?.showCongregation || false,
      
      // Badges
      badges: profile?.badges?.map(b => b.type) || [],
      isVerified: profile?.badges?.length > 0 || false,
      
      // Dating user data
      dating: datingUser || null,
      isPremium: datingUser?.isPremium || false,
      ageVerified: datingUser?.ageVerified || false,
      lastActive: datingUser?.datingStats?.lastActiveDate || profile?.stats?.lastActive || null,
      
      // Privacy settings from dating user
      datingPrivacy: datingUser?.datingPrivacySettings || {
        showAge: true,
        showDistance: true,
        showLastActive: 'matches'
      }
    };
    
    req.userId = baseUser._id.toString();
    req.userRole = baseUser.role;
    req.userType = baseUser.userType;
    
    logger.debug("User authenticated successfully", {
      userId: req.userId,
      userType: req.userType,
      role: req.userRole,
      hasDatingProfile: !!datingUser,
      hasProfile: !!profile,
      profileCompletion: profile?.progress?.completion || 0
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
      error: "Not authorized",
      code: "AUTH_FAILED",
      timestamp: new Date().toISOString(),
    });
  }
};

// ========== OPTIONAL AUTHENTICATION ==========
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    
    if (req.headers.authorization?.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }
    
    if (!token) {
      req.user = null;
      req.userId = null;
      req.userRole = null;
      req.userType = null;
      return next();
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
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
    
    // Get minimal profile data for optional auth
    const profile = await Profile.findOne({ userId: decoded.userId })
      .select(
        'basic.userName ' +
        'photos.profile.url ' +
        'progress.completion ' +
        'age ' +
        'settings.isVisible'
      )
      .lean();
    
    req.user = {
      ...baseUser,
      _id: baseUser._id,
      id: baseUser._id.toString(),
      role: baseUser.role,
      userType: baseUser.userType,
      profile: profile || null,
      hasProfile: !!profile,
      userName: profile?.basic?.userName || null,
      avatar: profile?.photos?.profile?.url || null,
      profileCompletion: profile?.progress?.completion || 0,
      age: profile?.age || null,
      isDatingVisible: profile?.settings?.isVisible ?? true
    };
    
    req.userId = baseUser._id.toString();
    req.userRole = baseUser.role;
    req.userType = baseUser.userType;
    
    next();
  } catch (error) {
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
    
    if (!req.user.hasDatingProfile) {
      return res.status(404).json({
        success: false,
        error: "Dating profile not found",
        code: "NO_DATING_PROFILE",
        timestamp: new Date().toISOString(),
      });
    }
    
    if (!req.user.isDatingEligible) {
      return res.status(403).json({
        success: false,
        error: "You must be 18 or older to use dating features",
        code: "AGE_RESTRICTION",
        timestamp: new Date().toISOString(),
      });
    }
    
    if (req.user.isDatingVisible === false) {
      return res.status(403).json({
        success: false,
        error: "Your dating profile is hidden. Enable visibility to continue.",
        code: "PROFILE_HIDDEN",
        timestamp: new Date().toISOString(),
      });
    }
    
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
      
      const completion = req.user.profileCompletion || 0;
      
      if (completion < minCompletion) {
        return res.status(403).json({
          success: false,
          error: `Profile completion must be at least ${minCompletion}%`,
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

// ========== HELPER: GET MISSING PROFILE FIELDS ==========
const getMissingProfileFields = async (userId) => {
  try {
    const profile = await Profile.findOne({ userId })
      .select(
        'basic.userName ' +
        'photos.profile.url ' +
        'basic.bio ' +
        'basic.dateOfBirth ' +
        'basic.gender ' +
        'location.city ' +
        'lifestyle.hobbies ' +
        'faith.servingAs ' +
        'relationship.status ' +
        'relationship.lookingFor'
      )
      .lean();
    
    if (!profile) return ['Complete profile'];
    
    const missing = [];
    
    if (!profile.basic?.userName) missing.push('Username');
    if (!profile.photos?.profile?.url) missing.push('Profile picture');
    if (!profile.basic?.bio || profile.basic.bio.length < 50) missing.push('Bio (minimum 50 characters)');
    if (!profile.basic?.dateOfBirth) missing.push('Age');
    if (!profile.basic?.gender) missing.push('Gender');
    if (!profile.location?.city) missing.push('Location');
    if (!profile.lifestyle?.hobbies || profile.lifestyle.hobbies.length < 3) missing.push('At least 3 hobbies');
    if (!profile.faith?.servingAs) missing.push('Service privilege');
    if (!profile.relationship?.status) missing.push('Relationship status');
    if (!profile.relationship?.lookingFor?.length) missing.push('What you\'re looking for');
    
    return missing;
  } catch (error) {
    logger.error("Error getting missing profile fields:", error);
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
    
    if (req.user.userType !== 'DatingUser') {
      return next();
    }
    
    if (!req.user.ageVerified) {
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
        targetUserId = req.params[resourcePath] || req.userId;
      }
      
      if (req.user.role === 'admin' || req.user.role === 'super_admin') {
        return next();
      }
      
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
    
    if (!req.user.isPremium) {
      return res.status(403).json({
        success: false,
        error: "Premium subscription required",
        code: "PREMIUM_REQUIRED",
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

// ========== QUICK ACCESS MIDDLEWARE ==========
const userOnly = authorize('user');
const moderatorOnly = authorize('moderator');
const adminOnly = authorize('admin');
const superAdminOnly = authorize('super_admin');
const datingUserOnly = authorizeUserType('DatingUser');
const staffOnly = authorize('moderator', 'admin', 'super_admin');

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
  requireMinimumRole,
  canViewAdminDashboard,
  canModerateContent,
  
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