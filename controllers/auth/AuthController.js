// controllers/AuthController.js - FIXED VERSION
const BaseController = require("../BaseController");
const { BaseUser, ROLES, DatingUser } = require("@models/User");
const Profile = require("@models/Profile/Profile.model");
const authService = require("@services/AuthService");
const authHelpers = require("@utils/AuthHelpers");

// FIX: Move require out of method body — was being called inline on every request.
// If this caused a circular dependency previously, the real fix is to extract the
// shared logic into a SecurityQuestionService and import that instead.
const securityController = require("@controllers/securityquestion.controller");

// Import specialized controllers
const registrationController = require("./RegistrationController");
const authenticationController = require("./AuthenticationController");
const emailVerificationController = require("./EmailVerificationController");
const passwordController = require("./PasswordController");
const tokenController = require("./TokenController");

// FIX: Single source of truth for token lifetimes — shared with TokenController.
// Higher privilege (staff/admin) = shorter window. Regular users get a longer session for UX.
// TokenController imports this same constant so login and refresh always agree.
const TOKEN_EXPIRY_SECONDS = {
  [ROLES.USER]: 1800,    // 30 min for regular users
  DEFAULT_STAFF: 900,    // 15 min for staff/admin/moderator
};

const getExpiresIn = (role) =>
  role === ROLES.USER ? TOKEN_EXPIRY_SECONDS[ROLES.USER] : TOKEN_EXPIRY_SECONDS.DEFAULT_STAFF;

class AuthController extends BaseController {
  constructor() {
    super();
    this.logger = console;
    this.validateEnvVars();
  }

  validateEnvVars() {
    const required = ["JWT_SECRET", "FRONTEND_URL"];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}`,
      );
    }
  }

  // ========== HELPER METHODS ==========
  standardizedSuccessResponse(res, statusCode, data, message = "") {
    const responseData = {
      success: true,
      data: data || {},
      message,
      timestamp: new Date().toISOString(),
    };
    return res.status(statusCode).json(responseData);
  }

  standardizedErrorResponse(res, statusCode, errorMessage, fieldErrors = null, additionalData = {}) {
    let messageString;
    let finalAdditionalData = { ...additionalData };

    if (typeof errorMessage === 'object' && errorMessage !== null) {
      messageString = errorMessage.message || errorMessage.error || "An error occurred";
      const { message, error, ...rest } = errorMessage;
      finalAdditionalData = { ...rest, ...finalAdditionalData };
    } else {
      messageString = String(errorMessage);
    }

    const response = {
      success: false,
      message: messageString,
      statusCode,
      timestamp: new Date().toISOString(),
      ...finalAdditionalData,
    };

    if (fieldErrors && Object.keys(fieldErrors).length > 0) {
      response.errors = fieldErrors;
    }

    return res.status(statusCode).json(response);
  }

  enhanceUserResponse(user) {
    if (!user) return null;

    const userData = authHelpers.formatUserResponse(user);

    if (!userData.fullName && user.firstName && user.lastName) {
      userData.fullName = `${user.firstName} ${user.lastName}`;
    }

    if (user.accountStatus && !userData.accountStatus) {
      userData.accountStatus = user.accountStatus;
    }

    if (userData.isActive === undefined) {
      userData.isActive =
        user.accountStatus === "active" ||
        user.accountStatus === "pending_verification";
    }

    if (userData.isAdminUser === undefined) {
      const roleLower = String(user.role).toLowerCase();
      userData.isAdminUser = roleLower === "admin" || roleLower === "super_admin";
    }

    if (userData.isSuperAdminUser === undefined) {
      const roleLower = String(user.role).toLowerCase();
      userData.isSuperAdminUser = roleLower === "super_admin";
    }

    userData.userName = user.userName || null;
    userData.ageVerified = user.ageVerified || false;
    userData.ageVerifiedAt = user.ageVerifiedAt || null;
    userData.profileCompletion = user.profileCompletion || 0;
    userData.hasCompletedOnboarding = user.hasCompletedOnboarding || false;
    userData.avatar = user.avatar || null;
    userData.age = user.age || null;
    userData.servingAs = user.servingAs || null;
    userData.isDatingVisible = user.isDatingVisible !== undefined ? user.isDatingVisible : true;
    userData.isPremium = user.isPremium || false;
    userData.hasProfile = user.hasProfile !== undefined ? user.hasProfile : false;
    userData.hasDatingProfile = user.hasDatingProfile !== undefined ? user.hasDatingProfile : false;
    userData.isDatingEligible = user.isDatingEligible || false;

    return userData;
  }

  generateAuthResponseData(user, includeTokens = true) {
    const userData = this.enhanceUserResponse(user);
    const permissions = authHelpers.getRolePermissions(user.role);
    const features = authHelpers.getRoleFeatures(user.role);

    const baseResponse = {
      user: userData,
      requiresVerification: !user.emailVerified,
      role: user.role,
      userType: user.userType,
      permissions,
      features,
    };

    if (includeTokens) {
      const { accessToken, refreshToken } = authService.generateTokens(user);
      return {
        ...baseResponse,
        accessToken,
        refreshToken,
        // FIX: Was inverted — staff got 1800, users got 900.
        // Higher privilege = shorter token lifetime. Users get longer sessions for UX.
        expiresIn: getExpiresIn(user.role),
        tokenType: "Bearer",
      };
    }
    return baseResponse;
  }

  calculateAge(birthDate) {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return age;
  }

  async validateSecuritySession(sessionId) {
    try {
      // FIX: Was re-requiring inside the method on every call.
      // Now uses the top-level import.
      return await securityController.validateSessionForRegistration(sessionId);
    } catch (error) {
      console.error("Session validation error:", error);
      return { valid: false, error: "Security session validation failed" };
    }
  }

  async markSecuritySessionCompleted(sessionId, userId) {
    try {
      await securityController.markSessionAsUsed(sessionId, userId);
      console.log(`✅ Security session ${sessionId} linked to user ${userId}`);
    } catch (error) {
      console.error("Error marking session completed:", error);
    }
  }

  getHelpers() {
    return {
      standardizedSuccessResponse: this.standardizedSuccessResponse.bind(this),
      standardizedErrorResponse: this.standardizedErrorResponse.bind(this),
      enhanceUserResponse: this.enhanceUserResponse.bind(this),
      generateAuthResponseData: this.generateAuthResponseData.bind(this),
      calculateAge: this.calculateAge.bind(this),
      validateSecuritySession: this.validateSecuritySession.bind(this),
      markSecuritySessionCompleted: this.markSecuritySessionCompleted.bind(this),
    };
  }

  // ========== DELEGATION METHODS ==========

  async register(req, res) {
    try {
      return await registrationController.register(req, res, this.getHelpers());
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async registerStaff(req, res) {
    req.registrationType = "staff";
    return this.register(req, res);
  }

  async login(req, res) {
    try {
      return await authenticationController.login(req, res, this.getHelpers());
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async logout(req, res) {
    try {
      return await authenticationController.logout(req, res, this.getHelpers());
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async logoutEverywhere(req, res) {
    try {
      return await authenticationController.logoutEverywhere(req, res, this.getHelpers());
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async resendVerificationEmail(req, res) {
    try {
      return await emailVerificationController.resendVerification(req, res, this.getHelpers());
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async verifyEmail(req, res) {
    try {
      return await emailVerificationController.verifyEmail(req, res, this.getHelpers());
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async refreshToken(req, res) {
    try {
      return await tokenController.refreshToken(req, res, this.getHelpers());
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async changePassword(req, res) {
    try {
      return await passwordController.changePassword(req, res, this.getHelpers());
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async forgotPassword(req, res) {
    try {
      return await passwordController.forgotPassword(req, res, this.getHelpers());
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async resetPassword(req, res) {
    try {
      return await passwordController.resetPassword(req, res, this.getHelpers());
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== GET CURRENT USER ==========
  async getCurrentUser(req, res) {
    try {
      if (!req.userId) {
        return this.standardizedErrorResponse(res, 401, "Not authenticated");
      }

      // FIX: MongoDB forbids mixing exclusions ("-field") and forced inclusions
      // ("+field") in the same projection. The "+" prefix tells MongoDB this is
      // an inclusion projection, which then rejects any "-field" in the same query:
      //   MongoServerError: Cannot do exclusion on field password in inclusion projection
      //
      // The sensitive fields (password, refreshToken, passwordHistory, etc.) are
      // already marked `select: false` in the BaseUser schema, so they are excluded
      // automatically without listing them here. Only the "+" prefix fields need to
      // be specified — those override `select: false` to force-include them.
      const baseUser = await BaseUser.findById(req.userId)
        .select("+ageVerified +ageVerifiedAt")
        .lean();

      if (!baseUser) {
        return this.standardizedErrorResponse(res, 404, "User not found");
      }

      // Hard block for genuinely disabled accounts
      if (baseUser.accountStatus && ["suspended", "banned", "deactivated"].includes(baseUser.accountStatus)) {
        return this.standardizedErrorResponse(
          res,
          403,
          `Account is ${baseUser.accountStatus}`,
          null,
          {
            accountStatus: baseUser.accountStatus,
            requiresVerification: !baseUser.emailVerified,
          }
        );
      }

      // FIX: Removed the hard 403 block for unverified DatingUsers.
      // A user who just registered is unverified by definition — blocking /me here
      // would crash the post-registration flow (verify-email-notice page,
      // any Redux initialAuthCheck, etc.).
      // Instead, pass requiresVerification: true in the response so the frontend
      // can route them to the verification screen without treating it as an auth failure.

      let datingUser = null;
      let datingData = {};

      if (baseUser.userType === 'DatingUser') {
        datingUser = await DatingUser.findById(req.userId)
          .select('isPremium ageVerified presence datingStats.lastActiveDate')
          .lean();

        if (datingUser) {
          datingData = {
            isPremium: datingUser.isPremium || false,
            ageVerified: datingUser.ageVerified || false,
            lastActive: datingUser.datingStats?.lastActiveDate || null,
            presence: datingUser.presence || { status: 'offline', lastSeen: null },
          };
        }
      }

      let profile = null;
      let profileData = {};

      // FIX: Two issues with the original query:
      //
      // 1. 'basic.age' was in the .select() string but that field does NOT exist
      //    in the DB. Age is a Mongoose virtual computed from basic.dateOfBirth.
      //    Selecting a non-existent path is silently ignored — profile.basic.age
      //    was always undefined.
      //
      // 2. .lean() strips Mongoose virtuals, so profile.age was also always
      //    undefined. Fix: select basic.dateOfBirth instead, then compute age
      //    in JS. (Alternatively: .lean({ virtuals: true }) if the project uses
      //    the mongoose-lean-virtuals plugin — but the JS fallback works regardless.)
      profile = await Profile.findOne({ userId: req.userId })
        .select('basic.userName basic.dateOfBirth photos.profile.url faith.servingAs progress.completion progress.onboardingCompleted settings.isVisible')
        .lean();

      if (profile) {
        // Compute age from dateOfBirth since .lean() doesn't include virtuals.
        let profileAge = null;
        if (profile.basic?.dateOfBirth) {
          const today = new Date();
          const birth = new Date(profile.basic.dateOfBirth);
          let age = today.getFullYear() - birth.getFullYear();
          const m = today.getMonth() - birth.getMonth();
          if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
          profileAge = age;
        }

        profileData = {
          userName: profile.basic?.userName || null,
          avatar: profile.photos?.profile?.url || null,
          age: profileAge,
          servingAs: profile.faith?.servingAs || null,
          isDatingVisible: profile.settings?.isVisible ?? true,
          profileCompletion: profile.progress?.completion || 0,
          hasCompletedOnboarding: profile.progress?.onboardingCompleted || false,
        };
      }

      const user = {
        ...baseUser,
        _id: baseUser._id,
        id: baseUser._id.toString(),
        userName: baseUser.userName || profileData.userName || null,
        ageVerified: baseUser.ageVerified || datingData.ageVerified || false,
        ageVerifiedAt: baseUser.ageVerifiedAt || null,
        avatar: profileData.avatar || null,
        age: profileData.age || null,
        servingAs: profileData.servingAs || null,
        isDatingVisible: profileData.isDatingVisible ?? true,
        profileCompletion: profileData.profileCompletion || 0,
        hasCompletedOnboarding: profileData.hasCompletedOnboarding || false,
        isPremium: datingData.isPremium || false,
        lastActive: datingData.lastActive || null,
        presence: datingData.presence || { status: 'offline', lastSeen: null },
        hasProfile: !!profile,
        hasDatingProfile: !!datingUser,
        isDatingEligible: baseUser.userType === 'DatingUser' && (profileData.age || 0) >= 18,
        isActive: baseUser.accountStatus === "active" || baseUser.accountStatus === "pending_verification",
        fullName: `${baseUser.firstName} ${baseUser.lastName}`,
      };

      // FIX: Bearer header extraction was case-sensitive.
      // "bearer eyJ..." would not be stripped, returning the full header string.
      const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, "") || undefined;

      const responseData = {
        user: this.enhanceUserResponse(user),
        accessToken: accessToken || undefined,
        requiresVerification: !user.emailVerified,
        role: user.role,
        userType: user.userType,
        permissions: authHelpers.getRolePermissions(user.role),
        features: authHelpers.getRoleFeatures(user.role),
      };

      return this.standardizedSuccessResponse(
        res,
        200,
        responseData,
        "User retrieved successfully",
      );
    } catch (error) {
      this.logger.error("Get current user error:", error);
      return this.standardizedErrorResponse(res, 500, "Failed to retrieve user information");
    }
  }

  // ========== ERROR HANDLER ==========
  async handleError(error, req, res) {
    this.logger.error("Auth controller error:", error);

    if (error.name === "ValidationError") {
      const fieldErrors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
      }));

      return this.standardizedErrorResponse(res, 400, "Validation error", fieldErrors);
    }

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return this.standardizedErrorResponse(res, 400, `${field} already exists`);
    }

    return this.standardizedErrorResponse(res, 500, "Internal server error");
  }

  // ========== HEALTH CHECK ==========
  async healthCheck(req, res) {
    try {
      // FIX: readyState is a synchronous integer, not a Promise. Removed spurious await.
      const dbStatus = BaseUser.db.readyState === 1 ? "connected" : "disconnected";
      const tokensConfigured = !!(process.env.JWT_SECRET && process.env.JWT_REFRESH_SECRET);
      const frontendUrlConfigured = !!process.env.FRONTEND_URL;

      return this.standardizedSuccessResponse(
        res,
        200,
        {
          status: "healthy",
          database: dbStatus,
          tokensConfigured,
          frontendUrlConfigured,
          timestamp: new Date().toISOString(),
          version: "2.0.0",
        },
        "Auth service is healthy",
      );
    } catch (error) {
      return this.standardizedErrorResponse(res, 503, "Service unavailable");
    }
  }
}

module.exports = AuthController;