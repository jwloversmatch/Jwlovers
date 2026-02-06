// controllers/auth/AuthenticationController.js - UPDATED for consistent user structure
const { BaseUser, ROLES } = require("@models/User");
const DatingUser = require("@models/User/datingUserSchema");
const Profile = require("@models/Profile.model"); 
const authService = require("@services/AuthService");
const authHelpers = require("@utils/AuthHelpers");

class AuthenticationController {
  constructor() {
    this.logger = console;
  }

  /**
   * Handle user login - UPDATED to match middleware structure
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

      // UPDATED: Populate profile and dating data using same pattern as middleware
      const userId = result.user._id.toString();
      let datingUser = null;
      let profile = null;

      try {
        // Get dating user and profile - SAME AS AUTHMIDDLEWARE
        if (result.user.userType === 'DatingUser') {
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

        // Build enhanced user object - SAME STRUCTURE AS MIDDLEWARE
        const enhancedUser = {
          ...result.user.toObject(),
          // Add computed properties
          hasDatingProfile: !!datingUser,
          hasProfile: !!profile,
          profileCompletion: profile?.profileCompletion || 0,
          // Store separate for easy access
          base: result.user.toObject(),
          dating: datingUser,
          profile: profile,
          // Backward compatibility
          _id: result.user._id,
          id: result.user._id.toString(),
          role: result.user.role,
          userType: result.user.userType,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName
        };

        // Replace result.user with enhanced version
        result.user = enhancedUser;

      } catch (profileError) {
        this.logger.warn("Could not load profile/dating data:", profileError.message);
        // Continue without profile data - user object remains as is
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

      // Generate auth response (will use enhanceUserResponse which now understands the structure)
      const authResponseData = generateAuthResponseData(result.user, true);

      // Update user session (need to get actual BaseUser instance for save)
      const userInstance = await BaseUser.findById(userId);
      if (userInstance) {
        userInstance.refreshToken = authResponseData.refreshToken;
        userInstance.lastLogin = new Date();
        if (typeof userInstance.updatePresence === "function") {
          await userInstance.updatePresence("online");
        }
        await userInstance.save({ validateBeforeSave: false });
      }

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