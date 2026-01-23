const jwt = require('jsonwebtoken');
const redis = require('@config/redis');
const UserSession = require('@models/UserSession');
const logger = require('@utils/logger');

class TokenManager {
  async blacklistToken(token, expiresIn = 3600) {
    try {
      if (!process.env.REDIS_HOST) return false;

      const decoded = jwt.decode(token);
      const ttl = this.calculateTokenTTL(decoded, expiresIn);
      
      await redis.getClient().setex(`blacklist:${token}`, ttl, '1');
      return true;
    } catch (error) {
      logger.error('Failed to blacklist token:', error);
      return false;
    }
  }

  async isTokenBlacklisted(token) {
    try {
      if (!process.env.REDIS_HOST) return false;
      const result = await redis.getClient().get(`blacklist:${token}`);
      return !!result;
    } catch (error) {
      logger.error('Failed to check token blacklist:', error);
      return false;
    }
  }

  async revokeAllSessions(userId) {
    try {
      const sessions = await UserSession.find({
        userId,
        status: 'active',
        disconnectedAt: null,
      });

      await Promise.all(sessions.map(session => session.disconnect()));
      
      logger.info(`Revoked all sessions for user ${userId}`);
      return true;
    } catch (error) {
      logger.error('Failed to revoke user sessions:', error);
      return false;
    }
  }

  // Helper methods
  calculateTokenTTL(decoded, fallbackTTL) {
    if (decoded?.exp) {
      const expiresIn = Math.floor((decoded.exp * 1000 - Date.now()) / 1000);
      return Math.max(expiresIn, fallbackTTL);
    }
    return fallbackTTL;
  }

  decodeToken(token) {
    try {
      return jwt.decode(token);
    } catch (error) {
      logger.error('Failed to decode token:', error);
      return null;
    }
  }
}

module.exports = new TokenManager();