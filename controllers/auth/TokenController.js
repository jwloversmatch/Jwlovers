// controllers/auth/TokenController.js - COMPLETE FIXED VERSION
const { BaseUser, ROLES } = require("@models/User");
const authService = require("@services/AuthService");
const authHelpers = require("@utils/AuthHelpers");
const jwt = require("jsonwebtoken");

const TOKEN_EXPIRY = {
  [ROLES.USER]: 1800,
  DEFAULT_STAFF: 900,
};

const getExpiresIn = (role) =>
  role === ROLES.USER ? TOKEN_EXPIRY[ROLES.USER] : TOKEN_EXPIRY.DEFAULT_STAFF;

class TokenController {
  constructor() {
    this.logger = console;
    this.refreshAttempts = new Map();
  }

  async refreshToken(req, res, { standardizedSuccessResponse, standardizedErrorResponse }) {
    try {
      // ── Rate limiting ──────────────────────────────────────────────────────
      const ip = req.ip;
      const now = Date.now();
      const windowMs = 15 * 60 * 1000;
      const maxAttempts = 10;

      if (!this.refreshAttempts.has(ip)) {
        this.refreshAttempts.set(ip, []);
      }

      const attempts = this.refreshAttempts.get(ip);
      const validAttempts = attempts.filter((time) => now - time < windowMs);

      if (validAttempts.length >= maxAttempts) {
        this.refreshAttempts.set(ip, validAttempts);
        return standardizedErrorResponse(res, 429, "Too many refresh attempts. Please try again later.");
      }

      validAttempts.push(now);

      if (validAttempts.length === 0) {
        this.refreshAttempts.delete(ip);
      } else {
        this.refreshAttempts.set(ip, validAttempts);
      }

      // ── Extract refresh token ──────────────────────────────────────────────
      const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken || req.headers["x-refresh-token"];

      if (!refreshToken) {
        return standardizedErrorResponse(res, 401, "Refresh token is required");
      }

      // ── Verify JWT signature ───────────────────────────────────────────────
      let decoded;
      try {
        decoded = jwt.verify(
          refreshToken,
          process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + "-refresh",
        );
      } catch (jwtError) {
        authHelpers.clearAuthCookies(res);
        if (jwtError.name === "TokenExpiredError") {
          return standardizedErrorResponse(res, 401, "Session expired. Please login again.");
        }
        if (jwtError.name === "JsonWebTokenError") {
          return standardizedErrorResponse(res, 401, "Invalid token");
        }
        return standardizedErrorResponse(res, 401, "Authentication failed");
      }

      // ── Load user ──────────────────────────────────────────────────────────
      let user;
      try {
        user = await BaseUser.findOne({
          _id: decoded.userId,
          accountStatus: { $nin: ["suspended", "banned", "deactivated"] },
        }).select("+refreshToken +tokenVersion");
      } catch (dbError) {
        this.logger.error("Database error during token refresh:", dbError);
        return standardizedErrorResponse(res, 503, "Service temporarily unavailable");
      }

      if (!user) {
        authHelpers.clearAuthCookies(res);
        return standardizedErrorResponse(res, 401, "Invalid refresh token");
      }

      // ── Token version check ────────────────────────────────────────────────
      const tokenHasVersion = decoded.tokenVersion !== undefined && decoded.tokenVersion !== null;
      const dbHasVersion = user.tokenVersion !== undefined && user.tokenVersion !== null;

      if (dbHasVersion) {
        if (!tokenHasVersion || user.tokenVersion !== decoded.tokenVersion) {
          authHelpers.clearAuthCookies(res);
          user.refreshToken = null;
          await user.save({ validateBeforeSave: false }).catch(err => {
            this.logger.error("Error clearing refresh token:", err);
          });
          return standardizedErrorResponse(res, 401, "Session expired. Please login again.");
        }
      }

      // ── Stored token check ─────────────────────────────────────────────────
      if (user.refreshToken && user.refreshToken !== refreshToken) {
        authHelpers.clearAuthCookies(res);
        user.refreshToken = null;
        await user.save({ validateBeforeSave: false }).catch(err => {
          this.logger.error("Error clearing refresh token:", err);
        });
        return standardizedErrorResponse(res, 401, "Session invalidated. Please login again.");
      }

      // ── Rotate tokens ──────────────────────────────────────────────────────
      let accessToken, newRefreshToken;
      try {
        const tokens = authService.generateTokens(user);
        accessToken = tokens.accessToken;
        newRefreshToken = tokens.refreshToken;
      } catch (tokenError) {
        this.logger.error("Error generating tokens:", tokenError);
        return standardizedErrorResponse(res, 500, "Failed to generate tokens");
      }

      user.refreshToken = newRefreshToken;
      user.lastLogin = new Date();

      if (typeof user.updatePresence === "function") {
        try {
          await user.updatePresence("online");
        } catch (presenceError) {
          this.logger.error("Error updating presence:", presenceError);
          // Non-critical error, continue
        }
      }

      await user.save({ validateBeforeSave: false }).catch(err => {
        this.logger.error("Error saving user during token refresh:", err);
        return standardizedErrorResponse(res, 500, "Failed to update user session");
      });

      authHelpers.setAuthCookies(res, accessToken, newRefreshToken);

      const responseData = {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: getExpiresIn(user.role),
        tokenType: "Bearer",
        requiresVerification: !user.emailVerified,
        role: user.role,
        userType: user.userType,
        features: authHelpers.getRoleFeatures(user.role),
        permissions: authHelpers.getRolePermissions(user.role),
      };

      return standardizedSuccessResponse(res, 200, responseData, "Token refreshed successfully");

    } catch (error) {
      authHelpers.clearAuthCookies(res);
      
      // 🚨🚨🚨 CRITICAL: Log the error but ALWAYS return 401 for auth failures
      this.logger.error("Unexpected error in refreshToken:", error);
      
      return standardizedErrorResponse(
        res,
        401, // ✅ NEVER return 500 for auth endpoints!
        "Authentication failed. Please login again."
      );
    }
  }

  cleanupRateLimitingData() {
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    
    for (const [ip, attempts] of this.refreshAttempts.entries()) {
      const validAttempts = attempts.filter(time => now - time < windowMs);
      if (validAttempts.length === 0) {
        this.refreshAttempts.delete(ip);
      } else {
        this.refreshAttempts.set(ip, validAttempts);
      }
    }
  }
}

module.exports = new TokenController();