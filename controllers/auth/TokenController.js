// controllers/auth/TokenController.js - Token Management Module
const { BaseUser, ROLES } = require("@models/User");
const authService = require("@services/AuthService");
const authHelpers = require("@utils/AuthHelpers");
const jwt = require("jsonwebtoken");

class TokenController {
  constructor() {
    this.logger = console;
    this.refreshAttempts = new Map();
  }

  /**
   * Refresh access token
   */
  async refreshToken(req, res, { standardizedSuccessResponse, standardizedErrorResponse }) {
    try {
      // Simple rate limiting
      const ip = req.ip;
      const now = Date.now();
      const windowMs = 15 * 60 * 1000; // 15 minutes
      const maxAttempts = 10;

      if (!this.refreshAttempts.has(ip)) {
        this.refreshAttempts.set(ip, []);
      }

      const attempts = this.refreshAttempts.get(ip);
      const validAttempts = attempts.filter((time) => now - time < windowMs);

      if (validAttempts.length >= maxAttempts) {
        return standardizedErrorResponse(
          res,
          429,
          "Too many refresh attempts. Please try again later.",
        );
      }

      validAttempts.push(now);
      this.refreshAttempts.set(ip, validAttempts);

      const refreshToken =
        req.cookies?.refreshToken ||
        req.body?.refreshToken ||
        req.headers["x-refresh-token"];

      if (!refreshToken) {
        return standardizedErrorResponse(
          res,
          401,
          "Refresh token is required",
        );
      }

      const decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + "-refresh",
      );

      const user = await BaseUser.findOne({
        _id: decoded.userId,
        accountStatus: { $nin: ["suspended", "banned", "deactivated"] },
        emailVerified: true,
      }).select("+refreshToken +tokenVersion");

      if (!user) {
        authHelpers.clearAuthCookies(res);
        return standardizedErrorResponse(
          res,
          401,
          "Invalid refresh token",
        );
      }

      // Check token version
     if (decoded.tokenVersion && user.tokenVersion && user.tokenVersion !== decoded.tokenVersion) {
  authHelpers.clearAuthCookies(res);
  user.refreshToken = null;
  await user.save({ validateBeforeSave: false });
  return standardizedErrorResponse(
    res,
    401,
    "Session expired. Please login again.",
  );
}
      // Check stored token
      // if (user.refreshToken && user.refreshToken !== refreshToken) {
      //   authHelpers.clearAuthCookies(res);
      //   user.refreshToken = null;
      //   await user.save({ validateBeforeSave: false });
      //   return standardizedErrorResponse(
      //     res,
      //     401,
      //     "Session invalidated. Please login again.",
      //   );
      // }

      // Generate new tokens (TOKEN ROTATION)
      const { accessToken, refreshToken: newRefreshToken } = authService.generateTokens(user);

      // Store new refresh token
      user.refreshToken = newRefreshToken;
      user.lastLogin = new Date();

      if (typeof user.updatePresence === "function") {
        await user.updatePresence("online");
      }

      await user.save({ validateBeforeSave: false });

      authHelpers.setAuthCookies(res, accessToken, newRefreshToken);

      const responseData = {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: 900,
        tokenType: "Bearer",
        requiresVerification: !user.emailVerified,
        role: user.role,
        userType: user.userType,
        features: authHelpers.getRoleFeatures(user.role),
        permissions: authHelpers.getRolePermissions(user.role),
      };

      return standardizedSuccessResponse(
        res,
        200,
        responseData,
        "Token refreshed successfully",
      );
    } catch (error) {
      authHelpers.clearAuthCookies(res);

      if (error.name === "TokenExpiredError") {
        return standardizedErrorResponse(
          res,
          401,
          "Session expired. Please login again.",
        );
      }

      if (error.name === "JsonWebTokenError") {
        return standardizedErrorResponse(res, 401, "Invalid token");
      }

      this.logger.error("Refresh token error:", error);
      return standardizedErrorResponse(res, 500, "Internal server error");
    }
  }
}

module.exports = new TokenController();