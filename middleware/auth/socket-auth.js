const jwt = require("jsonwebtoken");
const { BaseUser, DatingUser, UserQuery, ROLES } = require("@models/User");
const UserSession = require("@models/UserSession");
const tokenManager = require("./token-manager");
const logger = require("@utils/logger");

class SocketAuthMiddleware {
  async protectSocket(socket, next) {
    try {
      const token = this.extractSocketToken(socket);

      if (!token) {
        this.logUnauthenticatedConnection(socket);
        return next(new Error("Authentication required"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const isBlacklisted = await tokenManager.isTokenBlacklisted(token);
      if (isBlacklisted) {
        this.logBlacklistedToken(socket, decoded);
        return next(new Error("Token has been revoked"));
      }

      // Use UserQuery to get user with discriminator data
      const user = await UserQuery.getUserById(decoded.id || decoded.userId);
      if (!user) {
        this.logUserNotFound(socket, decoded);
        return next(new Error("User not found"));
      }

      if (user.accountStatus !== "active") {
        this.logInactiveUser(socket, user);
        return next(new Error(`Account is ${user.accountStatus}`));
      }

      // Age verification for dating users
      if (user.userType === 'DatingUser') {
        if (!user.ageVerified || !user.dateOfBirth) {
          this.logAgeNotVerified(socket, user);
          return next(new Error("Age verification required"));
        }

        const age = this.calculateAge(new Date(user.dateOfBirth));
        if (age < 18) {
          this.logUnderageUser(socket, user, age);
          return next(new Error("Must be 18 or older"));
        }
      }

      await this.updateUserLastSeen(user);
      await this.createSession(socket, user);

      this.attachUserToSocket(socket, user);

      this.logSuccessfulAuth(socket, user);
      next();
    } catch (error) {
      this.handleSocketAuthError(error, socket, next);
    }
  }

  // Role-based socket middleware
  requireSocketRole(...allowedRoles) {
    return (socket, next) => {
      if (!socket.user) {
        this.logMissingUser(socket);
        return next(new Error("Authentication required"));
      }

      if (!allowedRoles.includes(socket.user.role)) {
        this.logUnauthorizedRole(socket, allowedRoles);
        return next(new Error("Insufficient permissions"));
      }

      next();
    };
  }

  // User type-based socket middleware
  requireSocketUserType(...allowedUserTypes) {
    return (socket, next) => {
      if (!socket.user) {
        this.logMissingUser(socket);
        return next(new Error("Authentication required"));
      }

      if (!allowedUserTypes.includes(socket.user.userType)) {
        this.logUnauthorizedUserType(socket, allowedUserTypes);
        return next(new Error("User type not authorized"));
      }

      next();
    };
  }

  // Admin socket middleware
  requireSocketAdmin() {
    return this.requireSocketUserType("Admin", "SuperAdmin");
  }

  // Staff socket middleware
  requireSocketStaff() {
    return this.requireSocketUserType("Moderator", "Admin", "SuperAdmin");
  }

  // Dating user socket middleware
  requireSocketDatingUser() {
    return this.requireSocketUserType("DatingUser");
  }

  // Verified email socket middleware
  requireSocketVerified() {
    return async (socket, next) => {
      if (!socket.user) {
        this.logMissingUser(socket);
        return next(new Error("Authentication required"));
      }

      if (!socket.user.emailVerified) {
        this.logUnverifiedEmail(socket);
        return next(new Error("Email verification required"));
      }

      next();
    };
  }

  // Age verified socket middleware (for dating users)
  requireSocketAgeVerified() {
    return async (socket, next) => {
      if (!socket.user) {
        this.logMissingUser(socket);
        return next(new Error("Authentication required"));
      }

      if (socket.user.userType !== 'DatingUser') {
        return next();
      }

      if (!socket.user.ageVerified) {
        this.logAgeNotVerified(socket, socket.user);
        return next(new Error("Age verification required"));
      }

      next();
    };
  }

  // Helper methods
  extractSocketToken(socket) {
    const tokenSources = [
      socket.handshake.auth?.token,
      socket.handshake.auth?.accessToken,
      socket.handshake.headers?.authorization?.replace("Bearer ", ""),
      socket.handshake.query?.token,
      socket.handshake.headers?.['x-access-token'],
      socket.handshake.headers?.['x-auth-token']
    ];

    for (const token of tokenSources) {
      if (token && typeof token === 'string' && token.trim().length > 0) {
        return token.trim();
      }
    }

    return null;
  }

  async updateUserLastSeen(user) {
    try {
      // Initialize presence if not exists
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
      logger.error("Failed to update user last seen:", error);
    }
  }

  async createSession(socket, user) {
    const sessionData = {
      userId: user._id,
      socketId: socket.id,
      userAgent: socket.handshake.headers["user-agent"] || "",
      ipAddress: this.extractClientIp(socket),
      deviceInfo: this.extractDeviceInfo(socket),
      userType: user.userType,
      role: user.role,
      connectionDetails: {
        transport: socket.conn?.transport?.name || "unknown",
        remoteAddress: socket.handshake.address,
        secure: socket.handshake.secure || false
      },
      connectedAt: new Date()
    };

    try {
      await UserSession.create(sessionData);
    } catch (err) {
      logger.error("Failed to create user session:", err);
    }
  }

  extractClientIp(socket) {
    const ipSources = [
      socket.handshake.headers['x-real-ip'],
      socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim(),
      socket.handshake.address
    ];

    for (const ip of ipSources) {
      if (ip && this.isValidIP(ip)) {
        return ip;
      }
    }

    return socket.handshake.address || "unknown";
  }

  isValidIP(ip) {
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipv4Regex.test(ip);
  }

  extractDeviceInfo(socket) {
    const userAgent = socket.handshake.headers["user-agent"] || "";
    
    return {
      browser: this.extractBrowser(userAgent),
      os: this.extractOS(userAgent),
      isMobile: /mobile/i.test(userAgent),
      isTablet: /tablet/i.test(userAgent),
      isDesktop: !/mobile|tablet/i.test(userAgent),
      userAgent: userAgent.substring(0, 200) // Limit length
    };
  }

  extractBrowser(userAgent) {
    if (/chrome/i.test(userAgent) && !/edg/i.test(userAgent)) return "Chrome";
    if (/firefox/i.test(userAgent)) return "Firefox";
    if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) return "Safari";
    if (/edg/i.test(userAgent)) return "Edge";
    if (/opera|opr/i.test(userAgent)) return "Opera";
    return "Unknown";
  }

  extractOS(userAgent) {
    if (/windows/i.test(userAgent)) return "Windows";
    if (/mac os/i.test(userAgent)) return "macOS";
    if (/linux/i.test(userAgent)) return "Linux";
    if (/android/i.test(userAgent)) return "Android";
    if (/ios|iphone|ipad|ipod/i.test(userAgent)) return "iOS";
    return "Unknown";
  }

  calculateAge(birthDate) {
    if (!birthDate) return 0;
    
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  }

  attachUserToSocket(socket, user) {
    socket.user = {
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      name: `${user.firstName} ${user.lastName}`.trim(),
      userName: user.userName || `${user.firstName} ${user.lastName}`.toLowerCase().replace(/\s+/g, '.'),
      avatar: user.avatar,
      role: user.role,
      userType: user.userType || 'DatingUser',
      accountStatus: user.accountStatus,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      lastLogin: user.lastLogin,
      presence: user.presence,
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
    
    socket.userId = user._id.toString();
    socket.clientIp = this.extractClientIp(socket);
    socket.connectedAt = new Date();

    // Join user-specific room
    socket.join(`user:${socket.userId}`);
    
    // Join role-specific rooms
    socket.join(`role:${socket.user.role}`);
    socket.join(`userType:${socket.user.userType}`);
    
    // Join additional rooms based on user type
    if (socket.user.userType === 'DatingUser') {
      socket.join('userType:dating');
      if (socket.user.preferences?.lookingFor) {
        socket.join(`lookingFor:${socket.user.preferences.lookingFor}`);
      }
    } else if (socket.user.userType === 'Moderator') {
      socket.join('userType:moderator');
      socket.join('userType:staff');
    } else if (socket.user.userType === 'Admin' || socket.user.userType === 'SuperAdmin') {
      socket.join('userType:admin');
      socket.join('userType:staff');
    }
  }

  // Logging methods
  logUnauthenticatedConnection(socket) {
    logger.warn("Socket connection attempt without token", {
      socketId: socket.id,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers["user-agent"]
    });
  }

  logBlacklistedToken(socket, decoded) {
    logger.warn("Socket connection with blacklisted token", {
      userId: decoded.id || decoded.userId,
      socketId: socket.id,
      ip: socket.handshake.address
    });
  }

  logUserNotFound(socket, decoded) {
    logger.warn("Socket auth failed: User not found", {
      userId: decoded.id || decoded.userId,
      socketId: socket.id,
      ip: socket.handshake.address
    });
  }

  logInactiveUser(socket, user) {
    logger.warn("Socket auth failed: User not active", {
      userId: user._id,
      userType: user.userType,
      accountStatus: user.accountStatus,
      socketId: socket.id
    });
  }

  logAgeNotVerified(socket, user) {
    logger.warn("Socket auth failed: Age not verified", {
      userId: user._id,
      userType: user.userType,
      socketId: socket.id,
      hasDateOfBirth: !!user.dateOfBirth,
      ageVerified: user.ageVerified
    });
  }

  logUnderageUser(socket, user, age) {
    logger.warn("Socket auth failed: Underage user", {
      userId: user._id,
      userType: user.userType,
      age,
      dateOfBirth: user.dateOfBirth,
      socketId: socket.id
    });
  }

  logMissingUser(socket) {
    logger.warn("Socket middleware: Missing user object", {
      socketId: socket.id,
      hasUser: !!socket.user
    });
  }

  logUnauthorizedRole(socket, allowedRoles) {
    logger.warn("Socket unauthorized role access", {
      socketId: socket.id,
      userId: socket.user?.id,
      userRole: socket.user?.role,
      allowedRoles,
      userType: socket.user?.userType
    });
  }

  logUnauthorizedUserType(socket, allowedUserTypes) {
    logger.warn("Socket unauthorized user type access", {
      socketId: socket.id,
      userId: socket.user?.id,
      userType: socket.user?.userType,
      allowedUserTypes,
      userRole: socket.user?.role
    });
  }

  logUnverifiedEmail(socket) {
    logger.warn("Socket unverified email access", {
      socketId: socket.id,
      userId: socket.user?.id,
      userType: socket.user?.userType,
      email: socket.user?.email
    });
  }

  logSuccessfulAuth(socket, user) {
    logger.info("Socket authenticated", {
      socketId: socket.id,
      userId: user._id,
      userType: user.userType,
      role: user.role,
      userName: user.userName || `${user.firstName} ${user.lastName}`,
      ip: socket.handshake.address
    });
  }

  handleSocketAuthError(error, socket, next) {
    logger.error("Socket authentication error:", {
      message: error.message,
      socketId: socket.id,
      errorName: error.name,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers["user-agent"]
    });

    if (error.name === "TokenExpiredError") {
      return next(new Error("Token expired"));
    } else if (error.name === "JsonWebTokenError") {
      return next(new Error("Invalid token"));
    } else if (error.message.includes("Age verification")) {
      return next(new Error(error.message));
    } else if (error.message.includes("Must be 18")) {
      return next(new Error(error.message));
    }

    next(new Error("Authentication failed"));
  }
}

module.exports = new SocketAuthMiddleware();