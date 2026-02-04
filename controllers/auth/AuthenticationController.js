// controllers/auth/AuthenticationController.js - Login/Logout Module
const { BaseUser, ROLES } = require("@models/User");
const authService = require("@services/AuthService");
const authHelpers = require("@utils/AuthHelpers");

class AuthenticationController {
  constructor() {
    this.logger = console;
  }

  /**
   * Handle user login
   */
  async login(req, res, {
    standardizedSuccessResponse,
    standardizedErrorResponse,
    generateAuthResponseData
  }) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return standardizedErrorResponse(
          res,
          400,
          "Please provide email and password"
        );
      }

      const result = await authService.authenticateUser(email, password);

      if (!result.success) {
        // Extract error message and additional data from the result
        const errorMessage = result.error || "Authentication failed";
        const additionalData = result.additionalData || {};
        
        return standardizedErrorResponse(
          res, 
          result.code || 401, 
          errorMessage,
          null, // fieldErrors is null
          additionalData // pass additional data
        );
      }

      // Check email verification for regular users
      if (!result.user.emailVerified && result.user.role === ROLES.USER) {
        return standardizedErrorResponse(
          res,
          403,
          "Please verify your email before logging in",
          null,
          {
            requiresVerification: true,
            email: result.user.email,
            userType: result.user.userType,
            accountStatus: result.user.accountStatus
          }
        );
      }

      // Log security event
      await authHelpers.logSecurityEvent(result.user._id, "login_success", {
        role: result.user.role,
        userType: result.user.userType,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        timestamp: new Date().toISOString(),
        securityLevel: result.user.role !== ROLES.USER ? "elevated" : "standard",
      });

      // Generate auth response
      const authResponseData = generateAuthResponseData(result.user, true);

      // Update user session
      result.user.refreshToken = authResponseData.refreshToken;
      result.user.lastLogin = new Date();
      if (typeof result.user.updatePresence === "function") {
        await result.user.updatePresence("online");
      }
      await result.user.save({ validateBeforeSave: false });

      // Set cookies
      authHelpers.setAuthCookies(
        res,
        authResponseData.accessToken,
        authResponseData.refreshToken
      );

      return standardizedSuccessResponse(
        res,
        200,
        authResponseData,
        authHelpers.getWelcomeMessage(result.user)
      );
    } catch (error) {
      this.logger.error("Login error:", error);
      return standardizedErrorResponse(
        res,
        500,
        "An unexpected error occurred during login. Please try again.",
        null,
        { requiresSupport: true }
      );
    }
  }

  /**
   * Handle user logout
   */
  async logout(req, res, { standardizedSuccessResponse }) {
    try {
      if (req.userId) {
        const user = await BaseUser.findById(req.userId);
        if (user) {
          user.refreshToken = null;

          if (typeof user.updatePresence === "function") {
            await user.updatePresence("offline");
          } else {
            user.presence = {
              ...user.presence,
              status: "offline",
              lastSeen: new Date(),
            };
          }

          await user.save({ validateBeforeSave: false });

          if (user.role !== ROLES.USER) {
            await authHelpers.logSecurityEvent(user._id, "staff_logout", {
              role: user.role,
              userType: user.userType,
              ip: req.ip,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      authHelpers.clearAuthCookies(res);

      return standardizedSuccessResponse(
        res,
        200,
        {
          message: "Logged out successfully",
          timestamp: new Date().toISOString(),
        },
        "Logged out successfully"
      );
    } catch (error) {
      authHelpers.clearAuthCookies(res);
      this.logger.error("Logout error:", error);

      // Still return success for logout
      return standardizedSuccessResponse(
        res,
        200,
        {
          message: "Logged out successfully",
          timestamp: new Date().toISOString(),
        },
        "Logged out successfully"
      );
    }
  }

  /**
   * Logout from all devices
   */
  async logoutEverywhere(req, res, { standardizedSuccessResponse, standardizedErrorResponse }) {
    try {
      if (!req.userId) {
        return standardizedErrorResponse(
          res,
          401,
          "Not authenticated"
        );
      }

      const user = await BaseUser.findById(req.userId);
      if (!user) {
        return standardizedErrorResponse(
          res,
          404,
          "User not found"
        );
      }

      // Increment token version to invalidate all tokens
      user.tokenVersion = (user.tokenVersion || 1) + 1;
      user.refreshToken = null;
      await user.save({ validateBeforeSave: false });

      authHelpers.clearAuthCookies(res);

      await authHelpers.logSecurityEvent(user._id, "logout_everywhere", {
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return standardizedSuccessResponse(
        res,
        200,
        {
          message: "Logged out from all devices",
          timestamp: new Date().toISOString(),
        },
        "Logged out from all devices successfully"
      );
    } catch (error) {
      this.logger.error("Logout everywhere error:", error);
      return standardizedErrorResponse(
        res,
        500,
        "Failed to logout from all devices. Please try again.",
        null,
        { requiresSupport: true }
      );
    }
  }
}

module.exports = new AuthenticationController();