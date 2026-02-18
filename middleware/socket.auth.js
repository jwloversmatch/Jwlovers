// middleware/socket.auth.js - FIXED RedisService usage
const jwt = require('jsonwebtoken');
const logger = require('@utils/logger');

class SocketAuthMiddleware {
  constructor(redisService) {
    this.redisService = redisService;
    this.redisClient = redisService?.getClient?.() || null;
    
    this.rateLimitConfig = {
      'auth:attempt': { max: 10, windowMs: 60000 }, // 10 auth attempts per minute
      'connection': { max: 5, windowMs: 10000 },    // 5 connections per 10 seconds
    };
    
    logger.info('✅ SocketAuthMiddleware initialized with RedisService');
  }

  /**
   * Main authentication middleware for Socket.IO
   */
  authenticateSocket(socket, next) {
    const startTime = Date.now();
    
    try {
      // Extract token from various sources
      const token = this.extractToken(socket);
      
      if (!token) {
        logger.warn('WebSocket connection without token', {
          socketId: socket.id,
          ip: socket.handshake.address
        });
        return next(new Error('Authentication token required'));
      }

      // Verify JWT
      const decoded = this.verifyToken(token);
      if (!decoded) {
        return next(new Error('Invalid or expired token'));
      }

      // Extract user ID
      const userId = decoded.userId || decoded.id || decoded.sub;
      if (!userId) {
        return next(new Error('Invalid token payload: missing user ID'));
      }

      // Check rate limiting (async, but don't block connection)
      this.checkRateLimit(socket.handshake.address, 'connection')
        .catch(err => {
          logger.warn('Rate limit check failed:', err.message);
          // Don't block connection on rate limit check failure
        });

      // Attach user data to socket
      socket.userId = userId;
      socket.user = {
        id: userId,
        _id: userId,
        email: decoded.email,
        firstName: decoded.firstName,
        lastName: decoded.lastName,
        userName: decoded.userName,
        name: decoded.name || decoded.userName || `${decoded.firstName || ''} ${decoded.lastName || ''}`.trim(),
        avatar: decoded.avatar,
        userType: decoded.userType || 'User',
        role: decoded.role || 'user',
        profile: decoded.profile,
      };

      logger.debug('Socket authenticated', {
        socketId: socket.id,
        userId: userId.substring(0, 8),
        duration: Date.now() - startTime
      });

      next();
    } catch (error) {
      logger.error('Socket authentication error:', {
        error: error.message,
        socketId: socket.id,
        stack: error.stack
      });
      return next(new Error('Authentication failed'));
    }
  }

  /**
   * Extract token from socket handshake
   */
  extractToken(socket) {
    // Try auth object first (preferred)
    if (socket.handshake.auth?.token) {
      return socket.handshake.auth.token;
    }

    // Try Authorization header
    const authHeader = socket.handshake.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Try query parameter (fallback)
    if (socket.handshake.query?.token) {
      return socket.handshake.query.token;
    }

    return null;
  }

  /**
   * Verify JWT token
   */
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        logger.debug('Token expired');
      } else if (error.name === 'JsonWebTokenError') {
        logger.debug('Invalid token');
      } else {
        logger.error('Token verification error:', error.message);
      }
      return null;
    }
  }

  /**
   * Check rate limiting using Redis
   * FIXED: Use redisClient.get() instead of redisService.get()
   */
  async checkRateLimit(identifier, limitType = 'connection') {
    // Skip if Redis not available
    if (!this.redisClient || !this.redisService?.isReady?.()) {
      logger.debug('Redis not available, skipping rate limit check');
      return true;
    }

    const config = this.rateLimitConfig[limitType];
    if (!config) {
      return true;
    }

    try {
      const key = `socket:ratelimit:${limitType}:${identifier}`;
      
      // FIXED: Use safeOperation wrapper or direct client access
      const current = await this.redisService.safeOperation(
        async () => {
          const value = await this.redisClient.get(key);
          return value ? parseInt(value) : 0;
        },
        0, // fallback value
        'checkRateLimit-get'
      );

      if (current >= config.max) {
        logger.warn('Rate limit exceeded', {
          identifier,
          limitType,
          current,
          max: config.max
        });
        throw new Error('Rate limit exceeded');
      }

      // Increment counter
      await this.redisService.safeOperation(
        async () => {
          const multi = this.redisClient.multi();
          multi.incr(key);
          multi.expire(key, Math.ceil(config.windowMs / 1000));
          await multi.exec();
        },
        null,
        'checkRateLimit-incr'
      );

      return true;
    } catch (error) {
      // Log but don't block on rate limit errors
      logger.error('Rate limit check failed:', error.message);
      return true;
    }
  }

  /**
   * Validate token freshness (optional additional check)
   */
  async validateTokenFreshness(userId, token) {
    if (!this.redisClient || !this.redisService?.isReady?.()) {
      return true; // Skip if Redis not available
    }

    try {
      const key = `user:token:${userId}`;
      
      const storedToken = await this.redisService.safeOperation(
        async () => await this.redisClient.get(key),
        null,
        'validateTokenFreshness'
      );

      if (!storedToken) {
        return true; // No stored token, allow connection
      }

      // Check if token matches
      return storedToken === token;
    } catch (error) {
      logger.error('Token freshness check failed:', error.message);
      return true; // Don't block on errors
    }
  }

  /**
   * Revoke a token (add to blacklist)
   */
  async revokeToken(token) {
    if (!this.redisClient || !this.redisService?.isReady?.()) {
      logger.warn('Cannot revoke token: Redis not available');
      return false;
    }

    try {
      const decoded = this.verifyToken(token);
      if (!decoded) {
        return false;
      }

      const key = `token:blacklist:${token}`;
      const expiresIn = decoded.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 86400;

      await this.redisService.safeOperation(
        async () => {
          await this.redisClient.setex(key, Math.max(expiresIn, 60), 'revoked');
        },
        null,
        'revokeToken'
      );

      logger.info('Token revoked', {
        userId: decoded.userId || decoded.id,
        expiresIn
      });

      return true;
    } catch (error) {
      logger.error('Token revocation failed:', error.message);
      return false;
    }
  }

  /**
   * Check if token is blacklisted
   */
  async isTokenBlacklisted(token) {
    if (!this.redisClient || !this.redisService?.isReady?.()) {
      return false;
    }

    try {
      const key = `token:blacklist:${token}`;
      
      const isBlacklisted = await this.redisService.safeOperation(
        async () => {
          const result = await this.redisClient.get(key);
          return result === 'revoked';
        },
        false,
        'isTokenBlacklisted'
      );

      return isBlacklisted;
    } catch (error) {
      logger.error('Blacklist check failed:', error.message);
      return false;
    }
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics() {
    return {
      rateLimitConfig: this.rateLimitConfig,
      redisAvailable: this.redisService?.isReady?.() || false,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = SocketAuthMiddleware;