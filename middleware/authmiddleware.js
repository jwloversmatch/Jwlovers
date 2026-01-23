const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const mongoose = require("mongoose"); 
const { 
  BaseUser,
  ROLES,
  ROLE_HIERARCHY 
} = require("@models/User");
const RateLimit = require("@services/ratelimiter.service"); 
const logger = require("@utils/logger");

// ========== CONFIGURATION ==========
const AUTH_CONFIG = {
  // Token sources in order of priority
  TOKEN_SOURCES: {
    AUTH_HEADER: 'authorization',
    X_ACCESS_TOKEN: 'x-access-token',
    X_REFRESH_TOKEN: 'x-refresh-token',
    ACCESS_TOKEN_COOKIE: 'accessToken',
    REFRESH_TOKEN_COOKIE: 'refreshToken',
    QUERY_PARAM: 'token'
  },
  
  // Token validation
  ALLOW_QUERY_TOKEN: false, // Disable for security (URL tokens can be logged)
  TOKEN_MIN_LENGTH: 32,
  
  // User statuses allowed to access protected routes
  ALLOWED_STATUSES: ['active', 'verified', "pending_verification"],
  
  // Rate limiting
  RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 minutes
  MAX_REQUESTS_PER_WINDOW: 100,
  
  // Security headers
  SECURITY_HEADERS: {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block'
  }
};

// ========== SECURITY UTILITIES ==========

/**
 * Sanitize user object for request (remove sensitive data)
 */
function sanitizeUser(user) {
  if (!user) return null;
  
  const sanitized = {
    _id: user._id,
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    userName: user.userName,
    avatar: user.avatar,
    role: user.role || 'user',
    userType: user.userType || 'user',
    accountStatus: user.accountStatus || 'active',
    emailVerified: user.emailVerified || false,
    phoneVerified: user.phoneVerified || false,
    lastSeen: user.presence?.lastSeen,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    // Privacy settings (client might need these)
    privacySettings: user.privacySettings || {
      profileVisibility: 'public',
      showOnlineStatus: true
    },
    // Role-specific flags
    isStaff: user.role !== ROLES.USER,
    isAdmin: user.role === ROLES.ADMIN || user.role === ROLES.SUPER_ADMIN,
    isSuperAdmin: user.role === ROLES.SUPER_ADMIN
  };
  
  // Add role-specific data
  if (user.userType === 'DatingUser') {
    sanitized.ageVerified = user.ageVerified || false;
    sanitized.age = user.age;
    
    // Dating-specific settings
    sanitized.datingPrivacySettings = user.datingPrivacySettings || {
      showLastSeen: 'everyone',
      allowMessagesFrom: 'everyone'
    };
    sanitized.messagingPreferences = user.messagingPreferences || 'everyone';
  } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
    sanitized.employeeId = user.employeeId;
    sanitized.department = user.department;
    sanitized.staffNotificationSettings = user.staffNotificationSettings || {};
  }
  
  // Apply privacy settings to sanitized data
  if (sanitized.privacySettings) {
    if (!sanitized.privacySettings.showOnlineStatus) {
      delete sanitized.lastSeen;
      delete sanitized.lastLogin;
    }
  }
  
  return sanitized;
}

/**
 * Validate JWT token with enhanced security checks
 */
function validateToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token must be a string' };
  }
  
  // Check token length
  if (token.length < AUTH_CONFIG.TOKEN_MIN_LENGTH) {
    return { valid: false, error: 'Token too short' };
  }
  
  // Check token format (JWT has 3 parts separated by dots)
  if (token.split('.').length !== 3) {
    return { valid: false, error: 'Invalid token format' };
  }
  
  try {
    // Decode without verification to check structure
    const decoded = jwt.decode(token);
    
    if (!decoded) {
      return { valid: false, error: 'Invalid token structure' };
    }
    
    // Check for required claims
    const requiredClaims = ['userId', 'iat'];
    for (const claim of requiredClaims) {
      if (!decoded[claim]) {
        return { 
          valid: false, 
          error: `Missing required claim: ${claim}` 
        };
      }
    }
    
    // Check for suspicious claims
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000) - 86400) {
      // Token expired more than 24 hours ago - suspicious
      return { 
        valid: false, 
        error: 'Token expired long ago',
        suspicious: true 
      };
    }
    
    return { valid: true, decoded };
  } catch (error) {
    return { valid: false, error: 'Failed to decode token' };
  }
}

/**
 * Verify JWT with enhanced security
 */
function verifyJWT(token) {
  try {
    const validation = validateToken(token);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    
    // Verify signature with proper algorithm specification
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'], // Explicitly specify allowed algorithms
      ignoreExpiration: false,
      clockTolerance: 30, // Allow 30 seconds clock skew
      maxAge: '7d' // Maximum token age
    });
    
    // Additional security checks
    if (decoded.iss && decoded.iss !== 'dating-app-api') {
      return { 
        success: false, 
        error: 'Invalid token issuer',
        code: 'INVALID_ISSUER'
      };
    }
    
    if (decoded.aud && decoded.aud !== 'dating-app-client') {
      return { 
        success: false, 
        error: 'Invalid token audience',
        code: 'INVALID_AUDIENCE'
      };
    }
    
    // Check if token is about to expire (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const timeToExpiry = decoded.exp ? decoded.exp - now : Infinity;
    
    return {
      success: true,
      decoded,
      needsRefresh: timeToExpiry < 300, // 5 minutes
      expiresIn: timeToExpiry
    };
  } catch (error) {
    // Handle specific JWT errors
    if (error.name === 'TokenExpiredError') {
      return { 
        success: false, 
        error: 'Token expired', 
        code: 'TOKEN_EXPIRED',
        expiredAt: error.expiredAt
      };
    }
    
    if (error.name === 'JsonWebTokenError') {
      return { 
        success: false, 
        error: 'Invalid token', 
        code: 'INVALID_TOKEN',
        details: error.message
      };
    }
    
    if (error.name === 'NotBeforeError') {
      return { 
        success: false, 
        error: 'Token not yet valid', 
        code: 'TOKEN_NOT_ACTIVE'
      };
    }
    
    logger.error('Unexpected JWT verification error:', error);
    return { 
      success: false, 
      error: 'Token verification failed', 
      code: 'VERIFICATION_FAILED'
    };
  }
}

/**
 * Extract token from request with security considerations
 */
function extractToken(req) {
  const sources = [
    // 1. Authorization header (most secure)
    {
      name: 'authorization-header',
      extract: () => {
        const authHeader = req.headers[AUTH_CONFIG.TOKEN_SOURCES.AUTH_HEADER];
        if (authHeader && authHeader.startsWith('Bearer ')) {
          return authHeader.substring(7);
        }
        return null;
      },
      priority: 1
    },
    
    // 2. X-Access-Token header
    {
      name: 'x-access-token',
      extract: () => req.headers[AUTH_CONFIG.TOKEN_SOURCES.X_ACCESS_TOKEN],
      priority: 2
    },
    
    // 3. Access token cookie (HTTP-only, secure)
    {
      name: 'access-token-cookie',
      extract: () => req.cookies?.[AUTH_CONFIG.TOKEN_SOURCES.ACCESS_TOKEN_COOKIE],
      priority: 3,
      requiresHttpOnly: true
    },
    
    // 4. Query parameter (least secure, optional)
    {
      name: 'query-parameter',
      extract: () => {
        if (!AUTH_CONFIG.ALLOW_QUERY_TOKEN) return null;
        return req.query?.[AUTH_CONFIG.TOKEN_SOURCES.QUERY_PARAM];
      },
      priority: 4,
      warn: true // Log warning when used
    }
  ];
  
  // Sort by priority
  sources.sort((a, b) => a.priority - b.priority);
  
  for (const source of sources) {
    const token = source.extract();
    if (token) {
      // Basic validation
      if (typeof token !== 'string' || token.trim().length === 0) {
        logger.warn(`Invalid token from ${source.name}:`, { 
          tokenLength: token?.length,
          tokenType: typeof token
        });
        continue;
      }
      
      if (source.warn) {
        logger.warn(`Token extracted from insecure source: ${source.name}`, {
          path: req.path,
          method: req.method,
          ip: req.ip
        });
      }
      
      logger.debug(`Token extracted from ${source.name}`, {
        source: source.name,
        tokenPrefix: token.substring(0, 10) + '...',
        path: req.path
      });
      
      return {
        token: token.trim(),
        source: source.name,
        secure: !source.warn
      };
    }
  }
  
  return null;
}

/**
 * Set security headers on response
 */
function setSecurityHeaders(res) {
  Object.entries(AUTH_CONFIG.SECURITY_HEADERS).forEach(([header, value]) => {
    res.setHeader(header, value);
  });
}

/**
 * Check if user has minimum role level
 */
function hasMinimumRole(userRole, requiredRole) {
  const userLevel = ROLE_HIERARCHY[userRole] || 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;
  return userLevel >= requiredLevel;
}

/**
 * Check if user role is allowed (with hierarchy support)
 */
function isRoleAllowed(userRole, allowedRoles = [], options = {}) {
  // Always allow super_admin access
  if (userRole === ROLES.SUPER_ADMIN) {
    return true;
  }
  
  // Check if user role is directly in allowed roles
  if (allowedRoles.includes(userRole)) {
    return true;
  }
  
  // Check role hierarchy if enabled
  if (options.allowHigherRoles) {
    const userLevel = ROLE_HIERARCHY[userRole] || 0;
    
    // Find the highest allowed role level
    let highestAllowedLevel = -1;
    for (const role of allowedRoles) {
      const level = ROLE_HIERARCHY[role] || 0;
      if (level > highestAllowedLevel) {
        highestAllowedLevel = level;
      }
    }
    
    // If user role level is higher than the highest allowed role level, allow access
    if (userLevel > highestAllowedLevel) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if user type is allowed for specific actions
 */
function isUserTypeAllowed(userType, allowedUserTypes = []) {
  if (!userType) return false;
  
  // If no specific user types are specified, allow all
  if (!allowedUserTypes || allowedUserTypes.length === 0) {
    return true;
  }
  
  return allowedUserTypes.includes(userType);
}

// ========== MAIN AUTHENTICATION MIDDLEWARE ==========

/**
 * Main authentication middleware
 */
exports.protect = async (req, res, next) => {
  const requestId = crypto.randomBytes(4).toString('hex');
  const startTime = Date.now();
  
  logger.debug(`Auth request [${requestId}]:`, {
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent']?.substring(0, 100)
  });
  
  try {
    // Set security headers
    setSecurityHeaders(res);
    
    // ========== TOKEN EXTRACTION ==========
    const tokenInfo = extractToken(req);
    
    if (!tokenInfo) {
      logger.warn(`No token found [${requestId}]`, {
        path: req.path,
        ip: req.ip,
        headers: Object.keys(req.headers).filter(h => 
          h.toLowerCase().includes('token') || h.toLowerCase().includes('auth')
        )
      });
      
      return res.status(401).json({
        success: false,
        error: "Authentication required",
        code: "AUTH_REQUIRED",
        requestId
      });
    }
    
    const { token, source, secure } = tokenInfo;
    
    // ========== TOKEN VALIDATION ==========
    const verification = verifyJWT(token);
    
    if (!verification.success) {
      logger.warn(`Token verification failed [${requestId}]`, {
        code: verification.code,
        error: verification.error,
        source,
        path: req.path,
        ip: req.ip
      });
      
      // Track failed attempts for suspicious activity
      if (verification.code === 'INVALID_TOKEN' || verification.suspicious) {
        await RateLimit.trackFailedAuth(req.ip, 'invalid_token');
      }
      
      return res.status(401).json({
        success: false,
        error: verification.error,
        code: verification.code,
        requestId
      });
    }
    
    const { decoded, needsRefresh } = verification;
    
    // ========== USER VALIDATION ==========
    const userId = decoded.userId || decoded.id;
    
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      logger.warn(`Invalid user ID in token [${requestId}]`, {
        userId,
        decoded: Object.keys(decoded),
        path: req.path,
        ip: req.ip
      });
      
      return res.status(401).json({
        success: false,
        error: "Invalid user identifier",
        code: "INVALID_USER_ID",
        requestId
      });
    }
    
    // ========== FETCH USER ==========
    const user = await BaseUser.findById(userId)
      .select('+role +userType +accountStatus +emailVerified')
      .lean();
    
    if (!user) {
      logger.warn(`User not found [${requestId}]`, {
        userId,
        path: req.path,
        ip: req.ip
      });
      
      return res.status(401).json({
        success: false,
        error: "User account not found",
        code: "USER_NOT_FOUND",
        requestId
      });
    }
    
    // ========== ACCOUNT STATUS CHECK ==========
    if (!AUTH_CONFIG.ALLOWED_STATUSES.includes(user.accountStatus)) {
      logger.warn(`Account not active [${requestId}]`, {
        userId: user._id.toString(),
        status: user.accountStatus,
        email: user.email,
        userType: user.userType,
        path: req.path
      });
      
      return res.status(403).json({
        success: false,
        error: `Account is ${user.accountStatus}. Please contact support.`,
        code: "ACCOUNT_INACTIVE",
        accountStatus: user.accountStatus,
        requestId
      });
    }
    
    // ========== AGE VERIFICATION (FOR DATING USERS ONLY) ==========
    if (user.userType === 'DatingUser' && !user.ageVerified) {
      logger.warn(`Age not verified [${requestId}]`, {
        userId: user._id.toString(),
        email: user.email,
        path: req.path,
        userType: user.userType
      });
      
      return res.status(403).json({
        success: false,
        error: "Age verification required for dating users",
        code: "AGE_VERIFICATION_REQUIRED",
        requestId
      });
    }
    
    // ========== ATTACH USER TO REQUEST ==========
    req.userId = user._id;
    req.user = sanitizeUser(user);
    req.auth = {
      tokenSource: source,
      tokenSecure: secure,
      needsRefresh,
      sessionId: decoded.jti || crypto.randomBytes(8).toString('hex'),
      issuedAt: decoded.iat ? new Date(decoded.iat * 1000) : null,
      expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : null,
      role: user.role,
      userType: user.userType
    };
    
    // Update user's last seen (non-blocking)
    BaseUser.updateLastSeen(user._id).catch(err => 
      logger.error('Failed to update last seen:', err)
    );
    
    // Notify client if token needs refresh
    if (needsRefresh) {
      // Defer sending to avoid blocking
      process.nextTick(() => {
        try {
          req.socket?.emit?.('token:refresh_needed', {
            expiresAt: req.auth.expiresAt?.toISOString(),
            sessionId: req.auth.sessionId
          });
        } catch (socketError) {
          // Ignore if socket not available
        }
      });
    }
    
    const duration = Date.now() - startTime;
    logger.info(`Authentication successful [${requestId}]`, {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      userType: user.userType,
      duration: `${duration}ms`,
      path: req.path,
      needsRefresh
    });
    
    next();
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error(`Authentication error [${requestId}]`, {
      error: error.message,
      name: error.name,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      path: req.path,
      ip: req.ip,
      duration: `${duration}ms`
    });
    
    // Don't expose internal errors
    const userMessage = process.env.NODE_ENV === 'development'
      ? `Authentication error: ${error.message}`
      : "Authentication failed. Please try again.";
    
    return res.status(500).json({
      success: false,
      error: userMessage,
      code: "AUTH_INTERNAL_ERROR",
      requestId
    });
  }
};

/**
 * Role-based authorization middleware
 */
exports.authorize = (...allowedRoles) => {
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
        logger.warn(`No user for role check [${requestId}]`, {
          path: req.path,
          ip: req.ip
        });
        
        return res.status(401).json({
          success: false,
          error: "Authentication required",
          code: "AUTH_REQUIRED",
          requestId
        });
      }
      
      // Check if user role is allowed
      if (!isRoleAllowed(req.user.role, allowedRoles, options)) {
        logger.warn(`Role not allowed [${requestId}]`, {
          userRole: req.user.role,
          userType: req.user.userType,
          allowedRoles,
          userId: req.user._id,
          path: req.path,
          ip: req.ip
        });
        
        // Track suspicious access attempts
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
      logger.error(`Role check error [${requestId}]`, {
        error: error.message,
        path: req.path
      });
      
      return res.status(500).json({
        success: false,
        error: "Authorization check failed",
        code: "AUTHORIZATION_ERROR",
        requestId
      });
    }
  };
};

/**
 * User Type based authorization middleware
 */
exports.authorizeUserType = (...allowedUserTypes) => {
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
        logger.warn(`No user for user type check [${requestId}]`, {
          path: req.path,
          ip: req.ip
        });
        
        return res.status(401).json({
          success: false,
          error: "Authentication required",
          code: "AUTH_REQUIRED",
          requestId
        });
      }
      
      // Check if user type is allowed
      if (!isUserTypeAllowed(req.user.userType, allowedUserTypes)) {
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
      logger.error(`User type check error [${requestId}]`, {
        error: error.message,
        path: req.path
      });
      
      return res.status(500).json({
        success: false,
        error: "User type check failed",
        code: "USER_TYPE_CHECK_ERROR",
        requestId
      });
    }
  };
};

/**
 * User-only middleware (only regular dating users)
 */
exports.userOnly = exports.authorizeUserType('DatingUser');

/**
 * Staff-only middleware (moderators, admins, super admins)
 */
exports.staffOnly = exports.authorizeUserType('Moderator', 'Admin', 'SuperAdmin');

/**
 * Moderator-only middleware (moderators and above)
 */
exports.moderatorOnly = exports.authorize(ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN, { allowHigherRoles: true });

/**
 * Admin-only middleware (admins and super admins)
 */
exports.adminOnly = exports.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN, { allowHigherRoles: true });

/**
 * Super admin-only middleware
 */
exports.superAdminOnly = exports.authorize(ROLES.SUPER_ADMIN);

/**
 * Minimum role middleware (user must have at least this role)
 */
exports.requireMinimumRole = (minimumRole) => {
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
      
      if (!hasMinimumRole(req.user.role, minimumRole)) {
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
      logger.error(`Minimum role check error [${requestId}]`, {
        error: error.message,
        path: req.path
      });
      
      return res.status(500).json({
        success: false,
        error: "Role check failed",
        code: "ROLE_CHECK_ERROR",
        requestId
      });
    }
  };
};

/**
 * Verified users only (for dating app features)
 * Note: Staff roles bypass verification requirements
 */
exports.verifiedOnly = async (req, res, next) => {
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
    
    // Staff roles (moderator, admin, super_admin) bypass verification
    if (hasMinimumRole(req.user.role, ROLES.MODERATOR)) {
      logger.debug(`Staff role bypass verification [${requestId}]`, {
        role: req.user.role,
        userType: req.user.userType,
        path: req.path
      });
      return next();
    }
    
    // Only dating users need age verification
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
    
    // For non-dating users, only email verification is required
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
    logger.error(`Verified check error [${requestId}]`, {
      error: error.message,
      path: req.path
    });
    
    return res.status(500).json({
      success: false,
      error: "Verification check failed",
      code: "VERIFICATION_ERROR",
      requestId
    });
  }
};

/**
 * Optional authentication
 */
exports.optionalAuth = async (req, res, next) => {
  const requestId = crypto.randomBytes(4).toString('hex');
  
  logger.debug(`Optional auth [${requestId}]:`, {
    path: req.path,
    method: req.method
  });
  
  try {
    setSecurityHeaders(res);
    
    const tokenInfo = extractToken(req);
    
    if (tokenInfo) {
      const { token, source } = tokenInfo;
      const verification = verifyJWT(token);
      
      if (verification.success) {
        const { decoded } = verification;
        const userId = decoded.userId;
        
        if (userId && mongoose.Types.ObjectId.isValid(userId)) {
          const user = await BaseUser.findById(userId).lean();
          
          if (user && AUTH_CONFIG.ALLOWED_STATUSES.includes(user.accountStatus)) {
            req.userId = user._id;
            req.user = sanitizeUser(user);
            req.auth = {
              tokenSource: source,
              isOptional: true,
              sessionId: decoded.jti
            };
            
            logger.debug(`Optional auth: User authenticated [${requestId}]`, {
              userId: user._id.toString(),
              email: user.email,
              userType: user.userType,
              path: req.path
            });
          }
        }
      }
    }
    
    next();
  } catch (error) {
    // Silent fail for optional auth
    logger.debug(`Optional auth failed silently [${requestId}]`, {
      error: error.message,
      path: req.path
    });
    next();
  }
};

/**
 * Resource ownership check with role-based overrides
 */
exports.requireOwnership = (options = {}) => {
  const {
    modelName,
    idParam = 'id',
    ownerField = 'userId',
    adminOverride = true,
    moderatorOverride = false,
    allowPublic = false,
    allowSameUserType = false // Allow access to resources of same user type
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
      
      // Load model dynamically
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
      
      // Check if resource is publicly accessible
      if (allowPublic && resource.isPublic === true) {
        logger.debug(`Public resource access granted [${requestId}]`, {
          modelName,
          resourceId,
          path: req.path
        });
        req.resource = resource;
        return next();
      }
      
      // Admin override
      if (adminOverride && hasMinimumRole(req.user?.role, ROLES.ADMIN)) {
        logger.debug(`Admin ownership override [${requestId}]`, {
          modelName,
          resourceId,
          adminRole: req.user.role,
          userType: req.user.userType
        });
        req.resource = resource;
        return next();
      }
      
      // Moderator override
      if (moderatorOverride && hasMinimumRole(req.user?.role, ROLES.MODERATOR)) {
        logger.debug(`Moderator ownership override [${requestId}]`, {
          modelName,
          resourceId,
          moderatorRole: req.user.role,
          userType: req.user.userType
        });
        req.resource = resource;
        return next();
      }
      
      // Check same user type access
      if (allowSameUserType && resource.userType && req.user?.userType === resource.userType) {
        logger.debug(`Same user type access granted [${requestId}]`, {
          modelName,
          resourceId,
          userType: req.user.userType
        });
        req.resource = resource;
        return next();
      }
      
      // Check ownership
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
        
        // Track suspicious access attempts
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
};

/**
 * Rate limiting middleware
 */
exports.rateLimit = (options = {}) => {
  const {
    windowMs = AUTH_CONFIG.RATE_LIMIT_WINDOW,
    max = AUTH_CONFIG.MAX_REQUESTS_PER_WINDOW,
    keyGenerator = (req) => req.userId || req.ip,
    skip = (req) => false,
    roleLimits = {}, // Example: { 'admin': 1000, 'super_admin': 5000 }
    userTypeLimits = {} // Example: { 'DatingUser': 100, 'Moderator': 500 }
  } = options;
  
  return async (req, res, next) => {
    if (skip(req)) return next();
    
    const key = keyGenerator(req);
    const requestId = crypto.randomBytes(4).toString('hex');
    
    try {
      // Check if user has special rate limit based on role
      let effectiveMax = max;
      if (req.user?.role && roleLimits[req.user.role]) {
        effectiveMax = roleLimits[req.user.role];
      }
      
      // Check if user has special rate limit based on user type
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
      // Allow request if rate limiting fails
      logger.error(`Rate limit check failed [${requestId}]`, {
        error: error.message,
        path: req.path
      });
      next();
    }
  };
};

/**
 * Profile completion check (for dating users only)
 */
exports.profileCompleted = async (req, res, next) => {
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
    
    // Staff roles and non-dating users don't need profile completion
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
    
    // Check minimum completion percentage
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
};

/**
 * Check if user can message another user
 */
exports.canMessageUser = async (req, res, next) => {
  const requestId = crypto.randomBytes(4).toString('hex');
  const targetUserId = req.params.userId || req.body.receiverId;
  
  if (!targetUserId) {
    return next(); // No target user specified
  }
  
  logger.debug(`Can message check [${requestId}]:`, {
    userId: req.user?._id,
    userRole: req.user?.role,
    userType: req.user?.userType,
    targetUserId,
    path: req.path
  });
  
  try {
    // Staff can message anyone (for moderation purposes)
    if (hasMinimumRole(req.user?.role, ROLES.MODERATOR)) {
      logger.debug(`Staff can message anyone [${requestId}]`, {
        role: req.user.role,
        userType: req.user.userType,
        targetUserId,
        path: req.path
      });
      return next();
    }
    
    const Block = require("@models/Block.model");
    
    // Check if target user exists and can receive messages
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
    
    // Check if target user has blocked this user
    const isBlocked = await Block.exists({
      blocker: targetUserId,
      blocked: req.userId,
      active: true
    });
    
    if (isBlocked) {
      logger.warn(`User blocked from messaging [${requestId}]`, {
        userId: req.userId,
        targetUserId,
        path: req.path
      });
      
      return res.status(403).json({
        success: false,
        error: "Cannot send message to this user",
        code: "USER_BLOCKED",
        requestId
      });
    }
    
    // Staff can be messaged by anyone (for support purposes)
    if (hasMinimumRole(targetUser.role, ROLES.MODERATOR)) {
      logger.debug(`Target is staff, allowing messages [${requestId}]`, {
        targetRole: targetUser.role,
        targetUserType: targetUser.userType,
        userId: req.userId
      });
      return next();
    }
    
    // Only dating users have messaging preferences
    if (targetUser.userType === 'DatingUser') {
      // Check target user's messaging preferences
      if (targetUser.messagingPreferences === 'matches_only') {
        // Implement match check logic
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
    
    // Allow message to be sent if check fails (fail-open for user experience)
    next();
  }
};

// ========== ADDITIONAL ROLE-BASED MIDDLEWARE ==========

/**
 * Check if user can view admin dashboard
 */
exports.canViewAdminDashboard = async (req, res, next) => {
  const requestId = crypto.randomBytes(4).toString('hex');
  
  logger.debug(`Admin dashboard check [${requestId}]:`, {
    userId: req.user?._id,
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
    
    if (!hasMinimumRole(req.user.role, ROLES.ADMIN)) {
      logger.warn(`User cannot view admin dashboard [${requestId}]`, {
        userId: req.user._id,
        userRole: req.user.role,
        userType: req.user.userType
      });
      
      return res.status(403).json({
        success: false,
        error: "Access denied. Admin privileges required.",
        code: "ADMIN_ACCESS_REQUIRED",
        requestId
      });
    }
    
    next();
  } catch (error) {
    logger.error(`Admin dashboard check error [${requestId}]`, {
      error: error.message,
      userId: req.user?._id,
      userType: req.user?.userType
    });
    
    return res.status(500).json({
      success: false,
      error: "Admin check failed",
      code: "ADMIN_CHECK_ERROR",
      requestId
    });
  }
};

/**
 * Check if user can moderate content
 */
exports.canModerateContent = async (req, res, next) => {
  const requestId = crypto.randomBytes(4).toString('hex');
  
  logger.debug(`Moderation check [${requestId}]:`, {
    userId: req.user?._id,
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
    
    if (!hasMinimumRole(req.user.role, ROLES.MODERATOR)) {
      logger.warn(`User cannot moderate content [${requestId}]`, {
        userId: req.user._id,
        userRole: req.user.role,
        userType: req.user.userType
      });
      
      return res.status(403).json({
        success: false,
        error: "Access denied. Moderator privileges required.",
        code: "MODERATOR_ACCESS_REQUIRED",
        requestId
      });
    }
    
    next();
  } catch (error) {
    logger.error(`Moderation check error [${requestId}]`, {
      error: error.message,
      userId: req.user?._id,
      userType: req.user?.userType
    });
    
    return res.status(500).json({
      success: false,
      error: "Moderation check failed",
      code: "MODERATION_CHECK_ERROR",
      requestId
    });
  }
};

/**
 * Check if user can manage other users (role-based permissions)
 */
exports.canManageUsers = async (req, res, next) => {
  const requestId = crypto.randomBytes(4).toString('hex');
  const targetUserId = req.params.userId || req.body.userId;
  
  logger.debug(`Can manage users check [${requestId}]:`, {
    userId: req.user?._id,
    userRole: req.user?.role,
    userType: req.user?.userType,
    targetUserId,
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
    
    // Super admins can manage anyone
    if (req.user.role === ROLES.SUPER_ADMIN) {
      return next();
    }
    
    // If no target user specified, check general permission
    if (!targetUserId) {
      // Admins can manage users in general
      if (req.user.role === ROLES.ADMIN) {
        return next();
      }
      
      return res.status(403).json({
        success: false,
        error: "Insufficient permissions to manage users",
        code: "INSUFFICIENT_MANAGEMENT_PERMISSIONS",
        requestId
      });
    }
    
    // Check specific user management permissions
    const targetUser = await BaseUser.findById(targetUserId)
      .select('role userType')
      .lean();
    
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: "Target user not found",
        code: "TARGET_USER_NOT_FOUND",
        requestId
      });
    }
    
    // Check role hierarchy permissions
    const userLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
    
    // Can only manage users with lower role level
    if (userLevel <= targetLevel) {
      logger.warn(`Cannot manage user with same or higher role [${requestId}]`, {
        userId: req.user._id,
        userRole: req.user.role,
        userType: req.user.userType,
        targetUserId: targetUser._id,
        targetRole: targetUser.role,
        targetUserType: targetUser.userType
      });
      
      return res.status(403).json({
        success: false,
        error: `Cannot manage ${targetUser.role} user`,
        code: "CANNOT_MANAGE_HIGHER_ROLE",
        requestId
      });
    }
    
    // Regular admins cannot manage other admins (only super admins can)
    if (req.user.role === ROLES.ADMIN && targetUser.role === ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        error: "Only super admins can manage other admins",
        code: "ADMIN_MANAGEMENT_RESTRICTED",
        requestId
      });
    }
    
    next();
  } catch (error) {
    logger.error(`Can manage users check error [${requestId}]`, {
      error: error.message,
      path: req.path
    });
    
    return res.status(500).json({
      success: false,
      error: "User management check failed",
      code: "USER_MANAGEMENT_CHECK_ERROR",
      requestId
    });
  }
};

// ========== EXPORTS FOR TESTING ==========
exports._extractToken = extractToken;
exports._validateToken = validateToken;
exports._verifyJWT = verifyJWT;
exports._sanitizeUser = sanitizeUser;
exports._setSecurityHeaders = setSecurityHeaders;
exports._hasMinimumRole = hasMinimumRole;
exports._isRoleAllowed = isRoleAllowed;
exports._isUserTypeAllowed = isUserTypeAllowed;

// Export role constants (re-export from User model)
exports.ROLES = ROLES;
exports.ROLE_HIERARCHY = ROLE_HIERARCHY;