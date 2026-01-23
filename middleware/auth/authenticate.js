const jwt = require("jsonwebtoken");
const { BaseUser, DatingUser, UserQuery, ROLES } = require("@models/User");
const tokenManager = require("./token-manager");
const logger = require("@utils/logger");

class AuthenticationMiddleware {
  async protect(req, res, next) {
    try {
      const token = this.extractToken(req);

      if (!token) {
        return this.unauthorized(res, "Authentication required. Please login.");
      }

      // Verify token
      const decoded = this.verifyToken(token);
      if (!decoded) {
        return this.unauthorized(res, "Invalid authentication token.");
      }

      // Check token blacklist
      const isBlacklisted = await tokenManager.isTokenBlacklisted(token);
      if (isBlacklisted) {
        return this.unauthorized(
          res,
          "Token has been revoked. Please login again."
        );
      }

      // Get user using UserQuery
      const user = await this.getUser(decoded);
      if (!user) {
        return this.unauthorized(res, "User account not found.");
      }

      if (user.accountStatus !== "active") {
        return this.unauthorized(
          res,
          `Account is ${user.accountStatus}. Please contact support.`
        );
      }

      // Age verification for dating users
      if (user.userType === 'DatingUser' && (!user.ageVerified || !user.dateOfBirth)) {
        return this.unauthorized(
          res,
          "Age verification required. Please update your profile."
        );
      }

      // Update last seen for non-GET requests
      if (req.method !== "GET") {
        await this.updateLastSeen(user);
      }

      // Attach to request
      this.attachUserToRequest(req, user, token);

      next();
    } catch (error) {
      this.handleAuthError(error, req, res);
    }
  }

  async optionalAuth(req, res, next) {
    try {
      const token = this.extractToken(req);

      if (token) {
        try {
          const decoded = this.verifyToken(token);
          if (decoded) {
            const isBlacklisted = await tokenManager.isTokenBlacklisted(token);

            if (!isBlacklisted) {
              const user = await this.getUser(decoded);
              if (user && user.accountStatus === "active") {
                this.attachUserToRequest(req, user, token);
              }
            }
          }
        } catch (error) {
          // Silently ignore token errors for optional auth
          logger.debug("Optional auth token error (ignored):", error.message);
        }
      }

      next();
    } catch (error) {
      logger.error("Optional auth error:", error);
      next();
    }
  }

  // Role-based middleware
  requireRole(...roles) {
    return (req, res, next) => {
      if (!req.user) {
        return this.unauthorized(res, "Authentication required.");
      }

      if (!roles.includes(req.user.role)) {
        logger.warn("Unauthorized role access attempt", {
          userId: req.user.id,
          userRole: req.user.role,
          requiredRoles: roles,
          path: req.path,
          method: req.method
        });
        return this.forbidden(res, "Insufficient permissions.");
      }

      next();
    };
  }

  // User type middleware
  requireUserType(...userTypes) {
    return (req, res, next) => {
      if (!req.user) {
        return this.unauthorized(res, "Authentication required.");
      }

      if (!userTypes.includes(req.user.userType)) {
        logger.warn("Unauthorized user type access attempt", {
          userId: req.user.id,
          userType: req.user.userType,
          requiredUserTypes: userTypes,
          path: req.path,
          method: req.method
        });
        return this.forbidden(res, "Insufficient permissions.");
      }

      next();
    };
  }

  // Admin middleware (Admin or SuperAdmin)
  requireAdmin() {
    return (req, res, next) => {
      if (!req.user) {
        return this.unauthorized(res, "Authentication required.");
      }

      if (!['Admin', 'SuperAdmin'].includes(req.user.userType)) {
        logger.warn("Non-admin user attempted admin access", {
          userId: req.user.id,
          userType: req.user.userType,
          path: req.path,
          method: req.method
        });
        return this.forbidden(res, "Admin access required.");
      }

      next();
    };
  }

  // Staff middleware (Moderator, Admin, SuperAdmin)
  requireStaff() {
    return (req, res, next) => {
      if (!req.user) {
        return this.unauthorized(res, "Authentication required.");
      }

      if (!['Moderator', 'Admin', 'SuperAdmin'].includes(req.user.userType)) {
        logger.warn("Non-staff user attempted staff access", {
          userId: req.user.id,
          userType: req.user.userType,
          path: req.path,
          method: req.method
        });
        return this.forbidden(res, "Staff access required.");
      }

      next();
    };
  }

  // Dating user middleware
  requireDatingUser() {
    return (req, res, next) => {
      if (!req.user) {
        return this.unauthorized(res, "Authentication required.");
      }

      if (req.user.userType !== 'DatingUser') {
        logger.warn("Non-dating user attempted dating feature access", {
          userId: req.user.id,
          userType: req.user.userType,
          path: req.path,
          method: req.method
        });
        return this.forbidden(res, "Dating user access required.");
      }

      next();
    };
  }

  // Check if user has permission
  hasPermission(...permissions) {
    return (req, res, next) => {
      if (!req.user) {
        return this.unauthorized(res, "Authentication required.");
      }

      // Staff users have permissions array
      if (['Moderator', 'Admin', 'SuperAdmin'].includes(req.user.userType)) {
        const userPermissions = req.user.permissions || [];
        const hasAllPermissions = permissions.every(permission => 
          userPermissions.includes(permission)
        );

        if (!hasAllPermissions) {
          logger.warn("Insufficient permissions", {
            userId: req.user.id,
            userType: req.user.userType,
            requiredPermissions: permissions,
            userPermissions: userPermissions,
            path: req.path,
            method: req.method
          });
          return this.forbidden(res, "Insufficient permissions.");
        }
      }

      next();
    };
  }

  // Helper methods
  extractToken(req) {
    // Extract from headers, cookies, query, etc.
    if (req.headers.authorization?.startsWith("Bearer ")) {
      return req.headers.authorization.split(" ")[1];
    }
    if (req.cookies?.accessToken) return req.cookies.accessToken;
    if (req.cookies?.token) return req.cookies.token;
    if (req.query?.token) return req.query.token;
    if (req.headers["x-access-token"]) return req.headers["x-access-token"];
    if (req.headers["x-auth-token"]) return req.headers["x-auth-token"];
    return null;
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256'],
        ignoreExpiration: false
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Session expired. Please login again.');
      }
      throw new Error('Invalid authentication token.');
    }
  }

  async getUser(decoded) {
    const userId = decoded.userId || decoded.id || decoded.sub;
    
    // Use UserQuery for user lookup
    const user = await UserQuery.getUserById(userId);
    if (!user) return null;

    // Return minimal user data with type-specific fields
    const baseUser = {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      avatar: user.avatar,
      accountStatus: user.accountStatus,
      role: user.role,
      userType: user.userType,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      lastLogin: user.lastLogin,
      presence: user.presence,
      notificationSettings: user.notificationSettings || {},
      privacySettings: user.privacySettings || {},
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    // Add role-specific data
    if (user.userType === 'DatingUser') {
      baseUser.age = user.age;
      baseUser.userName = user.userName;
      baseUser.dateOfBirth = user.dateOfBirth;
      baseUser.ageVerified = user.ageVerified;
      baseUser.preferences = user.preferences;
      baseUser.location = user.location;
      baseUser.sharePhone = user.sharePhone;
      baseUser.messagingPreferences = user.messagingPreferences;
    } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
      baseUser.employeeId = user.employeeId;
      baseUser.department = user.department;
      baseUser.permissions = user.permissions || [];
      baseUser.staffNotificationSettings = user.staffNotificationSettings || {};
    }

    return baseUser;
  }

  async updateLastSeen(user) {
    try {
      if (!user.presence) {
        user.presence = {
          status: 'online',
          lastSeen: new Date(),
          lastActive: new Date()
        };
      } else {
        user.presence.lastSeen = new Date();
        user.presence.lastActive = new Date();
      }

      // Update using BaseUser for all user types
      await BaseUser.findByIdAndUpdate(
        user._id,
        { $set: { 'presence.lastSeen': new Date(), 'presence.lastActive': new Date() } },
        { runValidators: false }
      );
    } catch (error) {
      logger.error('Failed to update last seen:', error);
    }
  }

  attachUserToRequest(req, user, token) {
    req.userId = user._id;
    req.user = {
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      name: `${user.firstName} ${user.lastName}`.trim(),
      userName: user.userName || `${user.firstName} ${user.lastName}`.toLowerCase().replace(/\s+/g, '.'),
      avatar: user.avatar,
      role: user.role,
      userType: user.userType,
      accountStatus: user.accountStatus,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      lastLogin: user.lastLogin,
      lastSeen: user.presence?.lastSeen,
      notificationSettings: user.notificationSettings || {},
      privacySettings: user.privacySettings || {},
      isAdminUser: ['Admin', 'SuperAdmin'].includes(user.userType),
      isStaffUser: ['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType),
      isDatingUser: user.userType === 'DatingUser',
      // Dating-specific fields
      ...(user.userType === 'DatingUser' && {
        age: user.age,
        dateOfBirth: user.dateOfBirth,
        ageVerified: user.ageVerified,
        preferences: user.preferences,
        location: user.location,
        sharePhone: user.sharePhone,
        messagingPreferences: user.messagingPreferences
      }),
      // Staff-specific fields
      ...((user.userType === 'Moderator' || user.userType === 'Admin' || user.userType === 'SuperAdmin') && {
        employeeId: user.employeeId,
        department: user.department,
        permissions: user.permissions || []
      })
    };
    req.token = token;
  }

  unauthorized(res, message) {
    return res.status(401).json({
      success: false,
      error: message,
      code: "UNAUTHORIZED",
      timestamp: new Date().toISOString()
    });
  }

  forbidden(res, message) {
    return res.status(403).json({
      success: false,
      error: message,
      code: "FORBIDDEN",
      timestamp: new Date().toISOString()
    });
  }

  handleAuthError(error, req, res) {
    logger.error("Auth middleware error:", {
      message: error.message,
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    if (error.message.includes('Session expired')) {
      return this.unauthorized(res, "Session expired. Please login again.");
    }

    if (error.message.includes('Invalid authentication token')) {
      return this.unauthorized(res, "Invalid authentication token.");
    }

    return this.unauthorized(res, "Authentication failed. Please try again.");
  }

  // Rate limiting middleware
  rateLimit(limit, windowMs) {
    const store = new Map();
    
    return (req, res, next) => {
      const key = req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
      const now = Date.now();
      
      if (!store.has(key)) {
        store.set(key, []);
      }
      
      const requests = store.get(key);
      
      // Remove old requests
      const windowStart = now - windowMs;
      while (requests.length > 0 && requests[0] < windowStart) {
        requests.shift();
      }
      
      // Check limit
      if (requests.length >= limit) {
        logger.warn("Rate limit exceeded", {
          key,
          limit,
          windowMs,
          path: req.path,
          method: req.method
        });
        
        return res.status(429).json({
          success: false,
          error: "Too many requests. Please try again later.",
          code: "RATE_LIMITED",
          retryAfter: Math.ceil((requests[0] + windowMs - now) / 1000),
          timestamp: new Date().toISOString()
        });
      }
      
      // Add current request
      requests.push(now);
      
      // Cleanup old entries periodically (every 10 minutes)
      if (Math.random() < 0.001) { // ~0.1% chance
        const cutoff = now - (windowMs * 2);
        for (const [k, reqs] of store.entries()) {
          const filtered = reqs.filter(time => time > cutoff);
          if (filtered.length === 0) {
            store.delete(k);
          } else {
            store.set(k, filtered);
          }
        }
      }
      
      next();
    };
  }

  // API key authentication
  async apiKeyAuth(req, res, next) {
    try {
      const apiKey = req.headers['x-api-key'] || req.query.apiKey;
      
      if (!apiKey) {
        return this.unauthorized(res, "API key required.");
      }
      
      // In production, validate against database
      const isValid = apiKey === process.env.API_KEY; // Simple validation
      
      if (!isValid) {
        return this.unauthorized(res, "Invalid API key.");
      }
      
      req.isApiKey = true;
      next();
    } catch (error) {
      logger.error("API key auth error:", error);
      return this.unauthorized(res, "API authentication failed.");
    }
  }
}

module.exports = new AuthenticationMiddleware();