const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { BaseUser, DatingUser} = require('@models/User');
// const DatingUser = require('@models/User/datingUserSchema');
const Profile = require('@models/Profile.model');
const logger = require('@utils/logger');

class SocketAuthMiddleware {
  constructor(redisService) {
    this.redisService = redisService;
    this.config = {
      MAX_CONNECTIONS_PER_USER: 5, // Increased for multi-device
      MAX_FAILED_ATTEMPTS_PER_IP: 10,
      RATE_LIMIT_WINDOW: 60, // seconds
      BLOCK_DURATION: 15 * 60 * 1000,
      USER_CACHE_TTL: 5 * 60 * 1000 // 5 minutes
    };
    
    // In-memory cache for active users
    this.userCache = new Map();
    this.metrics = {
      totalAuthentications: 0,
      failedAuthentications: 0,
      suspiciousConnections: 0,
      connectionsByUserType: {},
      cacheHits: 0,
      cacheMisses: 0
    };
    
    // Cleanup cache every minute
    setInterval(() => this.cleanupCache(), 60 * 1000);
  }

  extractToken(socket) {
    // Try multiple token sources (same as updated version)
    if (socket.handshake.auth?.token) {
      return socket.handshake.auth.token;
    }
    
    if (socket.handshake.query?.token) {
      return socket.handshake.query.token;
    }
    
    if (socket.handshake.headers?.authorization) {
      const authHeader = socket.handshake.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
      }
    }
    
    // Check cookies
    if (socket.handshake.headers?.cookie) {
      const cookies = this.parseCookies(socket.handshake.headers.cookie);
      if (cookies.accessToken) {
        return cookies.accessToken;
      }
    }
    
    return null;
  }

  parseCookies(cookieHeader) {
    const cookies = {};
    cookieHeader.split(';').forEach(cookie => {
      const [name, ...rest] = cookie.split('=');
      cookies[name.trim()] = rest.join('=').trim();
    });
    return cookies;
  }

  verifyToken(token) {
    if (!token) {
      return { success: false, error: 'No token provided' };
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256'],
        ignoreExpiration: false
      });
      
      return { 
        success: true, 
        decoded,
        needsRefresh: false
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message,
        code: error.name 
      };
    }
  }

  async checkRateLimit(clientIp) {
    if (!this.redisService?.isReady()) {
      return true; // Fail open if Redis unavailable
    }
    
    try {
      const key = `ratelimit:auth:ip:${clientIp}`;
      const current = await this.redisService.get(key);
      const attempts = current ? parseInt(current) : 0;
      
      if (attempts >= this.config.MAX_FAILED_ATTEMPTS_PER_IP) {
        return false;
      }
      
      await this.redisService.incr(key);
      if (attempts === 0) {
        await this.redisService.expire(key, this.config.RATE_LIMIT_WINDOW);
      }
      
      return true;
    } catch (error) {
      logger.error('Rate limit check failed:', error);
      return true;
    }
  }

  async canUserConnect(userId, clientIp) {
    // Skip check in development if Redis unavailable
    if (!this.redisService || !this.redisService.isReady()) {
      if (process.env.NODE_ENV === 'production') {
        logger.warn('Redis unavailable in production, enforcing strict limits');
        return this.fallbackConnectionCheck(userId);
      }
      return true;
    }
    
    try {
      return await this.redisService.canUserConnect(userId, this.config.MAX_CONNECTIONS_PER_USER);
    } catch (error) {
      logger.error('Failed to check user connection limit:', error);
      return process.env.NODE_ENV === 'production' ? false : true;
    }
  }

  fallbackConnectionCheck(userId) {
    // Simple in-memory tracking for when Redis is down
    // In production, you might want to fail closed
    return true;
  }

  getClientIp(socket) {
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
    
    return socket.handshake.address || 'unknown';
  }

  isValidIP(ip) {
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipv4Regex.test(ip);
  }

  async authenticateSocket(socket, next) {
    const socketId = socket.id;
    const clientIp = this.getClientIp(socket);
    
    this.metrics.totalAuthentications++;
    
    try {
      // Rate limiting per IP
      const canProceed = await this.checkRateLimit(clientIp);
      if (!canProceed) {
        logger.warn('IP rate limit exceeded', { socketId, ip: clientIp });
        this.metrics.failedAuthentications++;
        return next(new Error('Too many authentication attempts'));
      }
      
      // Extract token
      const token = this.extractToken(socket);
      
      if (!token) {
        logger.warn('Socket connection without token', { socketId, ip: clientIp });
        this.metrics.failedAuthentications++;
        return next(new Error('Authentication token required'));
      }
      
      // Check token blacklist (if Redis available)
      if (this.redisService?.isReady() && this.redisService.isTokenBlacklisted) {
        const isBlacklisted = await this.redisService.isTokenBlacklisted(token);
        if (isBlacklisted) {
          logger.warn('Blacklisted token used', { socketId, ip: clientIp });
          this.metrics.failedAuthentications++;
          return next(new Error('Token has been revoked'));
        }
      }
      
      // Verify token
      const verification = this.verifyToken(token);
      if (!verification.success) {
        logger.warn('Socket auth failed: Invalid token', { 
          socketId, 
          ip: clientIp,
          error: verification.error 
        });
        this.metrics.failedAuthentications++;
        return next(new Error('Invalid or expired token'));
      }
      
      const { decoded } = verification;
      const userId = decoded.userId || decoded.id || decoded.sub;
      
      if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        this.metrics.failedAuthentications++;
        return next(new Error('Invalid user identifier'));
      }
      
      // Check connection limit
      const canConnect = await this.canUserConnect(userId, clientIp);
      if (!canConnect) {
        logger.warn('User connection limit reached', { userId, socketId });
        this.metrics.failedAuthentications++;
        return next(new Error('Too many active connections'));
      }
      
      // Check cache first
      const cachedUser = this.userCache.get(userId);
      if (cachedUser && Date.now() - cachedUser.timestamp < this.config.USER_CACHE_TTL) {
        this.metrics.cacheHits++;
        socket.user = cachedUser.data;
        socket.userId = userId;
        socket.userRole = cachedUser.data.role;
        socket.userType = cachedUser.data.userType;
        this.setupSocket(socket, clientIp, next);
        return;
      }
      
      this.metrics.cacheMisses++;
      
      // Fetch user from database - SAME AS AUTHMIDDLEWARE
      const baseUser = await BaseUser.findById(userId)
        .select("-password")
        .lean();
      
      if (!baseUser) {
        this.metrics.failedAuthentications++;
        return next(new Error('User not found'));
      }
      
      // Account validation
      if (baseUser.accountStatus !== 'active') {
        const statusMessages = {
          'pending_verification': 'Account requires email verification',
          'suspended': 'Account suspended',
          'deactivated': 'Account deactivated',
          'banned': 'Account banned'
        };
        this.metrics.failedAuthentications++;
        return next(new Error(statusMessages[baseUser.accountStatus] || 'Account is not active'));
      }
      
      // Get dating user and profile if exists - SAME AS AUTHMIDDLEWARE
      let datingUser = null;
      let profile = null;
      
      if (baseUser.userType === 'DatingUser') {
        datingUser = await DatingUser.findById(userId)
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
        profile = await Profile.findOne({ userId: userId })
          .select('userName profilePicture profileCompletion age gender location hobbies verificationBadges bio')
          .lean();
      }
      
      // Build user object - SAME STRUCTURE AS AUTHMIDDLEWARE
      const userData = {
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
      
      // Additional validation for dating users
      if (baseUser.userType === 'DatingUser' && datingUser) {
        if (!datingUser.ageVerified) {
          logger.warn('Dating user not age verified', { userId, socketId });
          // Don't block connection, but log it
        }
      }
      
      socket.user = userData;
      socket.userId = baseUser._id.toString();
      socket.userRole = baseUser.role;
      socket.userType = baseUser.userType;
      
      // Cache user data
      this.userCache.set(userId, {
        data: userData,
        timestamp: Date.now()
      });
      
      // Setup socket and track connection
      this.setupSocket(socket, clientIp, next);
      
    } catch (error) {
      this.metrics.failedAuthentications++;
      logger.error('Socket auth error:', {
        socketId,
        ip: clientIp,
        error: error.message,
        stack: error.stack
      });
      
      next(new Error('Authentication failed'));
    }
  }

  setupSocket(socket, clientIp, next) {
    const { userId, user } = socket;
    
    // Attach additional info
    socket.clientIp = clientIp;
    socket.connectedAt = new Date();
    
    // Join rooms
    this.joinRooms(socket);
    
    // Check for suspicious activity
    this.checkSuspiciousActivity(socket).catch(() => {});
    
    // Track metrics
    const userType = user.userType || 'unknown';
    this.metrics.connectionsByUserType[userType] = 
      (this.metrics.connectionsByUserType[userType] || 0) + 1;
    
    logger.info('Socket authenticated', {
      socketId: socket.id,
      userId,
      userName: user.profile?.userName || `${user.firstName} ${user.lastName}`,
      userType: user.userType,
      role: user.role,
      ip: clientIp,
      hasDatingProfile: user.hasDatingProfile,
      hasProfile: user.hasProfile
    });
    
    next();
  }

  joinRooms(socket) {
    const { userId, user } = socket;
    
    socket.join(`user:${userId}`);
    socket.join(`role:${user.role}`);
    socket.join(`userType:${user.userType}`);
    
    if (user.userType === 'DatingUser') {
      socket.join('userType:dating');
      
      // Use profile lookingFor if available
      const lookingFor = user.profile?.lookingFor || user.dating?.datingProfile?.lookingFor;
      if (lookingFor) {
        if (Array.isArray(lookingFor)) {
          lookingFor.forEach(goal => socket.join(`lookingFor:${goal}`));
        } else {
          socket.join(`lookingFor:${lookingFor}`);
        }
      }
    } else if (user.userType === 'Moderator') {
      socket.join('userType:moderator');
      socket.join('userType:staff');
    } else if (['Admin', 'SuperAdmin'].includes(user.userType)) {
      socket.join('userType:admin');
      socket.join('userType:staff');
    }
  }

  async checkSuspiciousActivity(socket) {
    if (!this.redisService?.isReady()) return;
    
    try {
      const { userId, clientIp } = socket;
      const locationKey = `user:${userId}:last_ip`;
      const lastIp = await this.redisService.get(locationKey);
      
      if (lastIp && lastIp !== clientIp) {
        const timeKey = `user:${userId}:ip_change_time`;
        const lastChange = await this.redisService.get(timeKey);
        
        if (lastChange && Date.now() - parseInt(lastChange) < 5 * 60 * 1000) {
          // IP changed within 5 minutes - mark as suspicious
          socket.suspicious = true;
          this.metrics.suspiciousConnections++;
          
          logger.warn('Suspicious IP change detected', {
            userId,
            oldIp: lastIp,
            newIp: clientIp,
            socketId: socket.id
          });
        }
      }
      
      // Update tracking
      await this.redisService.set(locationKey, clientIp);
      await this.redisService.set(`user:${userId}:ip_change_time`, Date.now().toString());
      
    } catch (error) {
      logger.error('Suspicious activity check failed:', error);
    }
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

  cleanupCache() {
    const now = Date.now();
    let cleaned = 0;
    for (const [userId, cache] of this.userCache.entries()) {
      if (now - cache.timestamp > this.config.USER_CACHE_TTL) {
        this.userCache.delete(userId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.debug(`Cleaned ${cleaned} cached socket auth entries`);
    }
  }

  invalidateUserCache(userId) {
    const deleted = this.userCache.delete(userId);
    if (deleted) {
      logger.debug(`Invalidated socket auth cache for user ${userId}`);
    }
    return deleted;
  }

  // Role middleware functions
  requireRole(requiredRole) {
    return (socket, next) => {
      if (!socket.user) {
        return next(new Error('Authentication required'));
      }
      
      if (socket.user.role !== requiredRole) {
        logger.warn('Unauthorized role access attempt', {
          userId: socket.userId,
          userRole: socket.user.role,
          requiredRole,
          socketId: socket.id
        });
        return next(new Error('Insufficient permissions'));
      }
      
      next();
    };
  }

  requireUserType(requiredUserType) {
    return (socket, next) => {
      if (!socket.user) {
        return next(new Error('Authentication required'));
      }
      
      if (socket.user.userType !== requiredUserType) {
        logger.warn('Unauthorized user type access attempt', {
          userId: socket.userId,
          userType: socket.user.userType,
          requiredUserType,
          socketId: socket.id
        });
        return next(new Error('Insufficient permissions'));
      }
      
      next();
    };
  }

  requireAdmin() {
    return (socket, next) => {
      if (!socket.user) {
        return next(new Error('Authentication required'));
      }
      
      if (!['Admin', 'SuperAdmin'].includes(socket.user.userType)) {
        logger.warn('Non-admin user attempted admin access', {
          userId: socket.userId,
          userType: socket.user.userType,
          socketId: socket.id
        });
        return next(new Error('Admin access required'));
      }
      
      next();
    };
  }

  requireStaff() {
    return (socket, next) => {
      if (!socket.user) {
        return next(new Error('Authentication required'));
      }
      
      if (!['Moderator', 'Admin', 'SuperAdmin'].includes(socket.user.userType)) {
        logger.warn('Non-staff user attempted staff access', {
          userId: socket.userId,
          userType: socket.user.userType,
          socketId: socket.id
        });
        return next(new Error('Staff access required'));
      }
      
      next();
    };
  }

  requireDatingUser() {
    return (socket, next) => {
      if (!socket.user) {
        return next(new Error('Authentication required'));
      }
      
      if (socket.user.userType !== 'DatingUser') {
        logger.warn('Non-dating user attempted dating feature access', {
          userId: socket.userId,
          userType: socket.user.userType,
          socketId: socket.id
        });
        return next(new Error('Dating user access required'));
      }
      
      next();
    };
  }

  getMetrics() {
    const total = this.metrics.totalAuthentications;
    const failed = this.metrics.failedAuthentications;
    const cacheTotal = this.metrics.cacheHits + this.metrics.cacheMisses;
    
    return {
      ...this.metrics,
      successRate: total > 0 
        ? ((total - failed) / total * 100).toFixed(2) + '%'
        : '0%',
      cacheHitRate: cacheTotal > 0
        ? ((this.metrics.cacheHits / cacheTotal) * 100).toFixed(2) + '%'
        : '0%',
      cacheSize: this.userCache.size
    };
  }
}

module.exports = SocketAuthMiddleware;