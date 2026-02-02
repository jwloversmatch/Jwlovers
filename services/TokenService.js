// services/TokenService.js
const jwt = require("jsonwebtoken");
const AUTH_CONFIG = require("@config/AuthConfig");
const logger = require("@utils/logger");

class TokenService {
  validateToken(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token must be a string' };
    }
    
    if (token.length < AUTH_CONFIG.TOKEN_MIN_LENGTH) {
      return { valid: false, error: 'Token too short' };
    }
    
    if (token.split('.').length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }
    
    try {
      const decoded = jwt.decode(token);
      
      if (!decoded) {
        return { valid: false, error: 'Invalid token structure' };
      }
      
      const requiredClaims = ['userId', 'iat'];
      for (const claim of requiredClaims) {
        if (!decoded[claim]) {
          return { valid: false, error: `Missing required claim: ${claim}` };
        }
      }
      
      if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000) - 86400) {
        return { valid: false, error: 'Token expired long ago', suspicious: true };
      }
      
      return { valid: true, decoded };
    } catch (error) {
      return { valid: false, error: 'Failed to decode token' };
    }
  }

  verifyJWT(token) {
    try {
      const validation = this.validateToken(token);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256'],
        ignoreExpiration: false,
        clockTolerance: 30,
        maxAge: '7d'
      });
      
      if (decoded.iss && decoded.iss !== 'dating-app-api') {
        return { success: false, error: 'Invalid token issuer', code: 'INVALID_ISSUER' };
      }
      
      if (decoded.aud && decoded.aud !== 'dating-app-client') {
        return { success: false, error: 'Invalid token audience', code: 'INVALID_AUDIENCE' };
      }
      
      const now = Math.floor(Date.now() / 1000);
      const timeToExpiry = decoded.exp ? decoded.exp - now : Infinity;
      
      return {
        success: true,
        decoded,
        needsRefresh: timeToExpiry < 300,
        expiresIn: timeToExpiry
      };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return { success: false, error: 'Token expired', code: 'TOKEN_EXPIRED', expiredAt: error.expiredAt };
      }
      
      if (error.name === 'JsonWebTokenError') {
        return { success: false, error: 'Invalid token', code: 'INVALID_TOKEN', details: error.message };
      }
      
      if (error.name === 'NotBeforeError') {
        return { success: false, error: 'Token not yet valid', code: 'TOKEN_NOT_ACTIVE' };
      }
      
      logger.error('Unexpected JWT verification error:', error);
      return { success: false, error: 'Token verification failed', code: 'VERIFICATION_FAILED' };
    }
  }

  extractToken(req) {
    const sources = [
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
      {
        name: 'x-access-token',
        extract: () => req.headers[AUTH_CONFIG.TOKEN_SOURCES.X_ACCESS_TOKEN],
        priority: 2
      },
      {
        name: 'access-token-cookie',
        extract: () => req.cookies?.[AUTH_CONFIG.TOKEN_SOURCES.ACCESS_TOKEN_COOKIE],
        priority: 3,
        requiresHttpOnly: true
      },
      {
        name: 'query-parameter',
        extract: () => {
          if (!AUTH_CONFIG.ALLOW_QUERY_TOKEN) return null;
          return req.query?.[AUTH_CONFIG.TOKEN_SOURCES.QUERY_PARAM];
        },
        priority: 4,
        warn: true
      }
    ];
    
    sources.sort((a, b) => a.priority - b.priority);
    
    for (const source of sources) {
      const token = source.extract();
      if (token) {
        if (typeof token !== 'string' || token.trim().length === 0) {
          logger.warn(`Invalid token from ${source.name}:`, { tokenLength: token?.length, tokenType: typeof token });
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
        
        return { token: token.trim(), source: source.name, secure: !source.warn };
      }
    }
    
    return null;
  }
}

module.exports = new TokenService();