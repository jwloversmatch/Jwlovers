const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { BaseUser, DatingUser, UserQuery } = require('@models/User');
const logger = require('@utils/logger');

class SocketAuthMiddleware {
  constructor(redisService) {
    this.redisService = redisService;
    this.config = {
      MAX_CONNECTIONS_PER_USER: 3,
      MAX_FAILED_ATTEMPTS: 5,
      BLOCK_DURATION: 15 * 60 * 1000,
      HEARTBEAT_TIMEOUT: 60 * 1000,
      CONNECTION_TIMEOUT: 24 * 60 * 60 * 1000
    };
  }

  extractToken(socket) {
    if (socket.handshake.auth?.token) {
      return socket.handshake.auth.token;
    }
    
    if (socket.handshake.headers?.authorization) {
      const authHeader = socket.handshake.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
      }
    }
    
    return null;
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

  async canUserConnect(userId, clientIp) {
    if (!this.redisService || !this.redisService.isReady()) {
      return true; 
    }
    
    try {
      return await this.redisService.canUserConnect(userId, this.config.MAX_CONNECTIONS_PER_USER);
    } catch (error) {
      logger.error('Failed to check user connection limit:', error);
      return true; // Fail open
    }
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
    
    try {
      // Extract token
      const token = this.extractToken(socket);
      
      if (!token) {
        logger.warn('Socket connection without token', { socketId, ip: clientIp });
        return next(new Error('Authentication token required'));
      }
      
      // Verify token
      const verification = this.verifyToken(token);
      if (!verification.success) {
        logger.warn('Socket auth failed: Invalid token', { 
          socketId, 
          ip: clientIp,
          error: verification.error 
        });
        return next(new Error('Invalid or expired token'));
      }
      
      const { decoded } = verification;
      const userId = decoded.userId || decoded.id || decoded.sub;
      
      if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        return next(new Error('Invalid user identifier'));
      }
      
      // Check connection limit
      const canConnect = await this.canUserConnect(userId, clientIp);
      if (!canConnect) {
        logger.warn('User connection limit reached', { userId, socketId });
        return next(new Error('Too many active connections'));
      }
      
      // Fetch user using UserQuery
      const user = await UserQuery.getUserById(userId);
      
      if (!user) {
        return next(new Error('User not found'));
      }
      
      // Account validation
      if (user.accountStatus !== 'active') {
        return next(new Error(`Account is ${user.accountStatus}`));
      }
      
      // Age verification for dating users
      if (user.userType === 'DatingUser') {
        if (!user.ageVerified || !user.dateOfBirth) {
          return next(new Error('Age verification required'));
        }
        
        const age = this.calculateAge(new Date(user.dateOfBirth));
        if (age < 18) {
          return next(new Error('Must be 18 or older'));
        }
      }
      
      // Attach user to socket
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
        // Dating-specific fields
        ...(user.userType === 'DatingUser' && {
          age: user.age,
          ageVerified: user.ageVerified,
          dateOfBirth: user.dateOfBirth,
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
      socket.clientIp = clientIp;
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
      
      // Setup disconnect cleanup
      socket.once('disconnect', () => {
        // Connection counts are handled by PresenceService
        logger.debug('Socket disconnected', { 
          socketId, 
          userId: socket.userId,
          userType: socket.user.userType 
        });
      });
      
      logger.info('Socket authenticated', {
        socketId,
        userId: socket.userId,
        userName: socket.user.userName,
        userType: socket.user.userType,
        role: socket.user.role,
        ip: clientIp
      });
      
      next();
      
    } catch (error) {
      logger.error('Socket auth error:', {
        socketId,
        ip: clientIp,
        error: error.message,
        stack: error.stack
      });
      
      next(new Error('Authentication failed'));
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

  // Middleware to check if user has specific role
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

  // Middleware to check if user has specific user type
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

  // Middleware to check if user is admin (Admin or SuperAdmin)
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

  // Middleware to check if user is staff (Moderator, Admin, or SuperAdmin)
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

  // Middleware to check if user is a dating user
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

  // Check if user is online
  async isUserOnline(userId) {
    try {
      if (!this.redisService || !this.redisService.isReady()) {
        return false;
      }
      
      return await this.redisService.isUserOnline(userId);
    } catch (error) {
      logger.error('Failed to check if user is online:', error);
      return false;
    }
  }

  // Get user's presence data
  async getUserPresence(userId) {
    try {
      if (!this.redisService || !this.redisService.isReady()) {
        const user = await UserQuery.getUserById(userId);
        if (!user || !user.presence) {
          return { isOnline: false, lastSeen: null };
        }
        
        const fiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000));
        const isOnline = new Date(user.presence.lastSeen) > fiveMinutesAgo && 
                        user.presence.status === 'online';
        
        return {
          isOnline,
          lastSeen: user.presence.lastSeen,
          status: user.presence.status,
          customStatus: user.presence.customStatus,
          userType: user.userType
        };
      }
      
      return await this.redisService.getUserPresence(userId);
    } catch (error) {
      logger.error('Failed to get user presence:', error);
      return { isOnline: false, lastSeen: null };
    }
  }

  // Check if a user can message another user (for dating users)
  async canMessage(senderId, receiverId) {
    try {
      const [sender, receiver] = await Promise.all([
        UserQuery.getUserById(senderId),
        UserQuery.getUserById(receiverId)
      ]);
      
      if (!sender || !receiver) {
        return false;
      }
      
      // Both users must be dating users
      if (sender.userType !== 'DatingUser' || receiver.userType !== 'DatingUser') {
        return false;
      }
      
      // Check sender's messaging preferences
      if (sender.messagingPreferences === 'disabled') {
        return false;
      }
      
      if (sender.messagingPreferences === 'matches_only') {
        // Check if they're matched (you'd need to implement this check)
        // For now, return true if both are online
        const [senderOnline, receiverOnline] = await Promise.all([
          this.isUserOnline(senderId),
          this.isUserOnline(receiverId)
        ]);
        
        return senderOnline && receiverOnline;
      }
      
      if (sender.messagingPreferences === 'friends_only') {
        // Check if they're contacts (you'd need to implement this check)
        // For now, return true if both are online
        const [senderOnline, receiverOnline] = await Promise.all([
          this.isUserOnline(senderId),
          this.isUserOnline(receiverId)
        ]);
        
        return senderOnline && receiverOnline;
      }
      
      // 'everyone' - allow messaging
      return true;
      
    } catch (error) {
      logger.error('Failed to check messaging permissions:', error);
      return false;
    }
  }
}

module.exports = SocketAuthMiddleware;