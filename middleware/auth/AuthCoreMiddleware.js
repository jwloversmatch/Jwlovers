// middleware/auth/AuthCoreMiddleware.js
const crypto = require("crypto");
const mongoose = require("mongoose");
const { BaseUser } = require("@models/User");
const AUTH_CONFIG = require("@config/AuthConfig");
const tokenService = require("@services/TokenService");
const userSanitizer = require("@utils/UserSanitizer");
const RateLimit = require("@services/ratelimiter.service");
const logger = require("@utils/logger");

class AuthCoreMiddleware {
  setSecurityHeaders(res) {
    Object.entries(AUTH_CONFIG.SECURITY_HEADERS).forEach(([header, value]) => {
      res.setHeader(header, value);
    });
  }

  async protect(req, res, next) {
    const requestId = crypto.randomBytes(4).toString('hex');
    const startTime = Date.now();
    
    logger.debug(`Auth request [${requestId}]:`, {
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 100)
    });
    
    try {
      this.setSecurityHeaders(res);
      
      const tokenInfo = tokenService.extractToken(req);
      
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
      
      const verification = tokenService.verifyJWT(token);
      
      if (!verification.success) {
        logger.warn(`Token verification failed [${requestId}]`, {
          code: verification.code,
          error: verification.error,
          source,
          path: req.path,
          ip: req.ip
        });
        
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
      
      req.userId = user._id;
      req.user = userSanitizer.sanitizeUser(user);
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
      
      BaseUser.updateLastSeen(user._id).catch(err => 
        logger.error('Failed to update last seen:', err)
      );
      
      if (needsRefresh) {
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
  }

  async optionalAuth(req, res, next) {
    const requestId = crypto.randomBytes(4).toString('hex');
    
    logger.debug(`Optional auth [${requestId}]:`, {
      path: req.path,
      method: req.method
    });
    
    try {
      this.setSecurityHeaders(res);
      
      const tokenInfo = tokenService.extractToken(req);
      
      if (tokenInfo) {
        const { token, source } = tokenInfo;
        const verification = tokenService.verifyJWT(token);
        
        if (verification.success) {
          const { decoded } = verification;
          const userId = decoded.userId;
          
          if (userId && mongoose.Types.ObjectId.isValid(userId)) {
            const user = await BaseUser.findById(userId).lean();
            
            if (user && AUTH_CONFIG.ALLOWED_STATUSES.includes(user.accountStatus)) {
              req.userId = user._id;
              req.user = userSanitizer.sanitizeUser(user);
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
      logger.debug(`Optional auth failed silently [${requestId}]`, {
        error: error.message,
        path: req.path
      });
      next();
    }
  }
}

module.exports = new AuthCoreMiddleware();