// controllers/AuthController.js - UPDATED for consistent user data structure
const BaseController = require("../BaseController");
const { BaseUser, ROLES, DatingUser } = require("@models/User");
const Profile = require("@models/Profile.model");
const authService = require("@services/AuthService");
const authHelpers = require("@utils/AuthHelpers");

// Import specialized controllers
const registrationController = require("./RegistrationController");
const authenticationController = require("./AuthenticationController");
const emailVerificationController = require("./EmailVerificationController");
const passwordController = require("./PasswordController");
const tokenController = require("./TokenController");

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

  // ========== HELPER METHODS (Shared utilities) ==========
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
      userData.isAdminUser =
        user.role === ROLES.ADMIN || user.role === ROLES.SUPER_ADMIN;
    }

    if (userData.isSuperAdminUser === undefined) {
      userData.isSuperAdminUser = user.role === ROLES.SUPER_ADMIN;
    }

    // Add profile data if available
    if (user.profile) {
      userData.userName = user.profile.userName;
      userData.avatar = user.profile.profilePicture?.url || null;
      userData.profileCompletion = user.profile.profileCompletion || 0;
      userData.age = user.profile.age;
    }

    // Add dating data if available
    if (user.dating) {
      userData.ageVerified = user.dating.ageVerified;
      userData.isPremium = user.dating.isPremium;
      userData.hasDatingProfile = true;
    }

    // Computed properties
    if (userData.hasDatingProfile === undefined) {
      userData.hasDatingProfile = !!user.dating;
    }
    if (userData.hasProfile === undefined) {
      userData.hasProfile = !!user.profile;
    }

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
        expiresIn: user.role !== ROLES.USER ? 1800 : 900,
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
      const securityController = require("@controllers/securityquestion.controller");
      return await securityController.validateSessionForRegistration(sessionId);
    } catch (error) {
      console.error("Session validation error:", error);
      return { valid: false, error: "Security session validation failed" };
    }
  }

  async markSecuritySessionCompleted(sessionId, userId, dbSession) {
    try {
      const securityController = require("@controllers/securityquestion.controller");
      await securityController.markSessionAsUsed(sessionId, userId);
      console.log(`✅ Security session ${sessionId} linked to user ${userId}`);
    } catch (error) {
      console.error("Error marking session completed:", error);
    }
  }

  // Get helper methods for passing to modules
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

  // ========== GET CURRENT USER - UPDATED TO MATCH MIDDLEWARE STRUCTURE ==========
  async getCurrentUser(req, res) {
  try {
    if (!req.userId) {
      return this.standardizedErrorResponse(res, 401, "Not authenticated");
    }

    // Use same query pattern as authmiddleware
    const baseUser = await BaseUser.findById(req.userId)
      .select("-password -refreshToken -passwordHistory -__v -securitySessionId -emailVerificationToken -emailVerificationExpires")
      .lean();

    if (!baseUser) {
      return this.standardizedErrorResponse(res, 404, "User not found");
    }

    // ⚠️ FIX: Remove isActive check since field doesn't exist
    // Check accountStatus instead
    if (baseUser.accountStatus && ["suspended", "banned", "deactivated"].includes(baseUser.accountStatus)) {
      return this.standardizedErrorResponse(
        res,
        403,
        `Account is ${baseUser.accountStatus}`,
        null,
        {
          accountStatus: baseUser.accountStatus,
          requiresVerification: !baseUser.emailVerified
        }
      );
    }

    // ⚠️ FIX: Also check if email is verified for dating users
    if (baseUser.userType === "DatingUser" && !baseUser.emailVerified) {
      return this.standardizedErrorResponse(
        res,
        403,
        "Please verify your email to access your account",
        null,
        {
          requiresVerification: true,
          accountStatus: baseUser.accountStatus
        }
      );
    }

    // Get dating user and profile - SAME AS AUTHMIDDLEWARE
    let datingUser = null;
    let profile = null;

    if (baseUser.userType === 'DatingUser') {
      datingUser = await DatingUser.findById(req.userId)
        .populate({
          path: 'profile',
          select: 'userName profilePicture profileCompletion age gender location hobbies verificationBadges bio lookingFor'
        })
        .lean();
      
      profile = datingUser?.profile || null;
    }

    // If no profile from datingUser, query directly by userId
    if (!profile) {
      profile = await Profile.findOne({ userId: req.userId })
        .select('userName profilePicture profileCompletion age gender location hobbies verificationBadges bio')
        .lean();
    }

    // Build user object - SAME STRUCTURE AS AUTHMIDDLEWARE
    const user = {
      ...baseUser,
      hasDatingProfile: !!datingUser,
      hasProfile: !!profile,
      profileCompletion: profile?.profileCompletion || 0,
      base: baseUser,
      dating: datingUser,
      profile: profile,
      _id: baseUser._id,
      id: baseUser._id.toString(),
      role: baseUser.role,
      userType: baseUser.userType,
      email: baseUser.email,
      firstName: baseUser.firstName,
      lastName: baseUser.lastName
    };

    const accessToken = req.headers.authorization?.replace("Bearer ", "");

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
      
      return this.standardizedErrorResponse(
        res,
        400,
        "Validation error",
        fieldErrors
      );
    }

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return this.standardizedErrorResponse(
        res,
        400,
        `${field} already exists`
      );
    }

    return this.standardizedErrorResponse(res, 500, "Internal server error");
  }

  // ========== HEALTH CHECK ==========
  async healthCheck(req, res) {
    try {
      const dbStatus =
        (await BaseUser.db.readyState) === 1 ? "connected" : "disconnected";
      const tokensConfigured = !!(
        process.env.JWT_SECRET && process.env.JWT_REFRESH_SECRET
      );
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