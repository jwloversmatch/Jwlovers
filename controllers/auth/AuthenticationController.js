// controllers/auth/AuthenticationController.js - FIXED for new schema
const { BaseUser, ROLES, DatingUser } = require("@models/User");
// FIX: Was `const DatingUser = require("@models/User/datingUserSchema")`.
// That imports the raw Mongoose Schema object, not the compiled Model.
// Schema objects have no .findById() — that is a Model method.
// Every login attempt logged: "Could not load profile/dating data: DatingUser.findById is not a function"
// and fell back to returning basic user data with no profile/dating enrichment.
// The compiled Model lives in the User barrel alongside BaseUser.

const Profile = require("@models/Profile/Profile.model"); 
const authService = require("@services/AuthService");
const authHelpers = require("@utils/AuthHelpers");

class AuthenticationController {
  constructor() {
    this.logger = console;
  }

  /**
   * Handle user login - UPDATED to match new schema
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
        const errorMessage = result.error || "Authentication failed";
        const additionalData = result.additionalData || {};
        
        return standardizedErrorResponse(
          res, 
          result.code || 401, 
          errorMessage,
          null,
          additionalData
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

      // ===== FETCH PROFILE AND DATING DATA WITH NEW SCHEMA PATHS =====
      const userId = result.user._id.toString();
      let datingUser = null;
      let profile = null;

      try {
        // Get dating user with minimal fields (account-level only)
        if (result.user.userType === 'DatingUser') {
          datingUser = await DatingUser.findById(userId)
            .select('isPremium ageVerified presence datingStats.lastActiveDate')
            .populate({
              path: 'profile',
              select: 'basic.userName basic.age basic.gender photos.profile.url progress.completion faith.servingAs settings.isVisible relationship.lookingFor lifestyle.hobbies badges'
            })
            .lean();
          
          // Extract profile from populated datingUser
          profile = datingUser?.profile || null;
        }

        // If no profile from datingUser, query directly by userId
        if (!profile) {
          profile = await Profile.findOne({ userId: userId })
            .select('basic.userName basic.age basic.gender photos.profile.url progress.completion faith.servingAs settings.isVisible relationship.lookingFor lifestyle.hobbies badges')
            .lean();
        }

        // ===== BUILD ENHANCED USER OBJECT WITH NEW SCHEMA PATHS =====
        const enhancedUser = {
          ...result.user.toObject(),
          
          // Profile data - using new schema paths
          userName: profile?.basic?.userName || null,
          avatar: profile?.photos?.profile?.url || null,
          age: profile?.age || null,
          servingAs: profile?.faith?.servingAs || null,
          isDatingVisible: profile?.settings?.isVisible ?? true,
          profileCompletion: profile?.progress?.completion || 0,
          hasCompletedOnboarding: profile?.progress?.onboardingCompleted || false,
          lookingFor: profile?.relationship?.lookingFor || [],
          hobbies: profile?.lifestyle?.hobbies || [],
          verificationBadges: profile?.badges?.map(b => b.type) || [],
          
          // Dating data
          isPremium: datingUser?.isPremium || false,
          ageVerified: datingUser?.ageVerified || false,
          lastActive: datingUser?.datingStats?.lastActiveDate || null,
          presence: datingUser?.presence || { status: 'offline', lastSeen: null },
          
          // Flags
          hasDatingProfile: !!datingUser,
          hasProfile: !!profile,
          isDatingEligible: (profile?.age || 0) >= 18,
          
          // Backward compatibility
          _id: result.user._id,
          id: result.user._id.toString(),
          role: result.user.role,
          userType: result.user.userType,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          fullName: `${result.user.firstName} ${result.user.lastName}`
        };

        // Replace result.user with enhanced version
        result.user = enhancedUser;

      } catch (profileError) {
        this.logger.warn("Could not load profile/dating data:", profileError.message);
        // Continue with basic user data
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
              status: "offline",
              lastSeen: new Date(),
              lastActive: new Date()
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
        return standardizedErrorResponse(res, 401, "Not authenticated");
      }

      const user = await BaseUser.findById(req.userId);
      if (!user) {
        return standardizedErrorResponse(res, 404, "User not found");
      }

      // Increment token version to invalidate all tokens
      user.tokenVersion = (user.tokenVersion || 1) + 1;
      user.refreshToken = null;
      
      if (typeof user.updatePresence === "function") {
        await user.updatePresence("offline");
      } else {
        user.presence = {
          status: "offline",
          lastSeen: new Date(),
          lastActive: new Date()
        };
      }
      
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