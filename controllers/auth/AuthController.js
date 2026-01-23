// controllers/AuthController.js - UPDATED WITH SECURITY SESSION
const BaseController = require("../BaseController");
const { BaseUser, ROLES } = require("@models/User");
const authService = require("@services/AuthService");
const validationService = require("@services/ValidationService");
const authHelpers = require("@utils/AuthHelpers");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

class AuthController extends BaseController {
  constructor() {
    super();
    this.logger = console;
    this.validateEnvVars();
  }

  validateEnvVars() {
    const required = ["JWT_SECRET"];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}`,
      );
    }
  }

  // ========== MAIN REGISTRATION METHOD (UPDATED) ==========
  async register(req, res) {
    const session = await BaseUser.startSession();
    
    try {
      await session.startTransaction();

      const {
        email,
        password,
        firstName,
        lastName,
        userName,
        dateOfBirth,
        role = ROLES.USER,
        inviteCode,
        sessionId, // REQUIRED for dating users
        employeeId,
        department,
        jobTitle,
        managedUsers = [],
        gender,
        phoneNumber,
        country,
        registrationType = req.registrationType || 'dating', // From middleware
      } = req.body;

      // ===== 1. DETERMINE USER TYPE =====
      let userType;
      let userRole = role;
      
      if (registrationType === 'staff') {
        userType = 'Staff';
        console.log(`👔 Staff registration detected for: ${email}`);
      } else {
        userType = 'DatingUser';
        userRole = ROLES.USER; // Dating users are always USER role
        console.log(`💑 Dating registration detected for: ${email}`);
      }

      // ===== 2. SECURITY VALIDATION =====
      if (registrationType === 'dating') {
        // VALIDATE sessionId FOR ALL DATING USERS
        if (!sessionId) {
          await session.abortTransaction();
          return this.errorResponse(
            res, 
            403, 
            "Security verification required for dating user registration. Please answer the security question first."
          );
        }
        
        // Validate the sessionId from security question
        const sessionValidation = await this.validateSecuritySession(sessionId);
        if (!sessionValidation.valid) {
          await session.abortTransaction();
          return this.errorResponse(res, 403, sessionValidation.error);
        }
      }
      
      if (registrationType === 'staff') {
        // Validate invite code for staff
        if (!inviteCode) {
          await session.abortTransaction();
          return this.errorResponse(
            res, 
            403, 
            "Invite code is required for staff registration. Please contact an administrator."
          );
        }
        
        const inviteValidation = await authService.validateAdminInvite(inviteCode, userRole);
        if (!inviteValidation.valid) {
          await session.abortTransaction();
          return this.errorResponse(res, 403, inviteValidation.error);
        }
        
        // Validate staff-specific fields
        if (!employeeId || !department || !jobTitle) {
          await session.abortTransaction();
          return this.errorResponse(
            res,
            400,
            "Staff registration requires employeeId, department, and jobTitle"
          );
        }
      }

      // ===== 3. INPUT VALIDATION =====
      const validation = validationService.validateRegistrationInput(req.body);
      if (!validation.valid) {
        await session.abortTransaction();
        return this.errorResponse(res, 400, validation.error);
      }

      // ===== 4. AGE VALIDATION FOR DATING USERS =====
      if (userType === 'DatingUser' && dateOfBirth) {
        const age = this.calculateAge(new Date(dateOfBirth));
        if (age < 18) {
          await session.abortTransaction();
          return this.errorResponse(res, 400, "You must be at least 18 years old");
        }
        if (age > 100) {
          await session.abortTransaction();
          return this.errorResponse(res, 400, "Please enter a valid date of birth");
        }
      }

      // ===== 5. EXISTING USER CHECKS =====
      const existingUser = await BaseUser.findOne({
        email: email.toLowerCase().trim(),
      }).session(session);
      
      if (existingUser) {
        await session.abortTransaction();
        return this.errorResponse(res, 400, "Email already exists");
      }

      if (userName) {
        const existingUserWithUsername = await BaseUser.findOne({
          userName: userName.trim().toLowerCase(),
        }).session(session);
        
        if (existingUserWithUsername) {
          await session.abortTransaction();
          return this.errorResponse(res, 400, "Username already exists");
        }
      }

      // Additional check for staff employeeId
      if (userType === 'Staff' && employeeId) {
        const existingEmployee = await BaseUser.findOne({ 
          employeeId 
        }).session(session);
        
        if (existingEmployee) {
          await session.abortTransaction();
          return this.errorResponse(res, 400, "Employee ID already exists");
        }
      }

      // ===== 6. CREATE USER =====
      const userData = {
        email: email.toLowerCase().trim(),
        password,
        firstName: firstName?.trim(),
        lastName: lastName?.trim(),
        userName: userName?.trim().toLowerCase(),
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        role: userRole,
        userType: userType,
        isActive: true,
        isEmailVerified: false,
        registrationType: registrationType,
        registrationDate: new Date(),
        securitySessionId: sessionId, // Store the validated sessionId
      };

      // Add staff-specific fields if applicable
      if (userType === 'Staff') {
        userData.employeeId = employeeId;
        userData.department = department;
        userData.jobTitle = jobTitle;
        userData.managedUsers = managedUsers;
      }

      // Add optional fields
      if (gender) userData.gender = gender;
      if (phoneNumber) userData.phoneNumber = phoneNumber;
      if (country) userData.country = country;

      const user = await authService.createUserWithRole(userData, session);

      // ===== 7. CREATE DATING PROFILE FOR DATING USERS =====
      if (userType === 'DatingUser') {
        await authService.createProfile(user, session);
      }

      // ===== 8. EMAIL VERIFICATION =====
      const verificationToken = authService.generateVerificationToken();
      user.emailVerificationToken = verificationToken.hashed;
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
      await user.save({ session });

      // ===== 9. MARK INVITE AS USED (FOR STAFF) =====
      if (userType === 'Staff' && inviteCode) {
        await authService.markInviteAsUsed(inviteValidation.invite._id, user._id, session);
      }

      // ===== 10. MARK SECURITY SESSION AS COMPLETED =====
      if (userType === 'DatingUser' && sessionId) {
        await this.markSecuritySessionCompleted(sessionId, user._id, session);
      }

      await session.commitTransaction();

      // ===== 11. LOG AND SEND EMAIL =====
      this.logger.info(
        `✅ User registered: ${user._id}, Type: ${userType}, Role: ${userRole}, Security Session: ${sessionId}`
      );

      if (userType === 'DatingUser') {
        await this.sendVerificationEmail(
          user.email,
          verificationToken.plain,
          userType
        );
      } else {
        await this.sendStaffVerificationEmail(
          user.email,
          verificationToken.plain,
          user.role,
          user.firstName,
          user.employeeId
        );
      }

      // ===== 12. SEND RESPONSE =====
      let message;
      if (userType === 'DatingUser') {
        message = "Registration successful. Please verify your email to complete your profile.";
      } else {
        message = `Staff account created successfully as ${userRole}. Please verify your email.`;
      }

      return this.sendAuthResponse(user, res, 201, message);

    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      this.logger.error("Registration error:", error);

      if (error.name === "ValidationError") {
        const messages = Object.values(error.errors).map((err) => err.message);
        return this.errorResponse(res, 400, messages.join(", "));
      }

      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        return this.errorResponse(res, 400, `${field} already exists`);
      }

      return this.handleError(error, req, res);
    } finally {
      session.endSession();
    }
  }

  // ===== LEGACY STAFF REGISTRATION (FOR BACKWARD COMPATIBILITY) =====
  async registerStaff(req, res) {
    // Set registration type and forward to main register method
    req.registrationType = 'staff';
    return this.register(req, res);
  }

  // ===== SECURITY SESSION VALIDATION METHODS =====
  async validateSecuritySession(sessionId) {
    try {
      const securityController = require('@controllers/securityquestion.controller');
      return await securityController.validateSessionForRegistration(sessionId);
    } catch (error) {
      console.error("Session validation error:", error);
      return { valid: false, error: "Security session validation failed" };
    }
  }

  async markSecuritySessionCompleted(sessionId, userId, dbSession) {
    try {
      const securityController = require('@controllers/securityquestion.controller');
      await securityController.markSessionAsUsed(sessionId, userId);
      
      console.log(`✅ Security session ${sessionId} linked to user ${userId}`);
    } catch (error) {
      console.error("Error marking session completed:", error);
      // Don't throw error here - registration should still succeed
    }
  }

  // Helper method to calculate age
  calculateAge(birthDate) {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  }

  // ========== AUTHENTICATION ==========
  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return this.errorResponse(
          res,
          400,
          "Please provide email and password",
        );
      }

      const result = await authService.authenticateUser(email, password);

      if (!result.success) {
        return this.errorResponse(res, result.code, result.error);
      }

      await authHelpers.logSecurityEvent(result.user._id, "login_success", {
        role: result.user.role,
        userType: result.user.userType,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        timestamp: new Date().toISOString(),
        securityLevel:
          result.user.role !== ROLES.USER ? "elevated" : "standard",
      });

      return this.sendAuthResponse(
        result.user,
        res,
        200,
        authHelpers.getWelcomeMessage(result.user),
      );
    } catch (error) {
      this.logger.error("Login error:", error);
      return this.handleError(error, req, res);
    }
  }

  async logout(req, res) {
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
      return this.successResponse(res, 200, {}, "Logged out successfully");
    } catch (error) {
      authHelpers.clearAuthCookies(res);
      this.logger.error("Logout error:", error);
      return this.successResponse(res, 200, {}, "Logged out successfully");
    }
  }

  async refreshToken(req, res) {
    try {
      const refreshToken =
        req.cookies?.refreshToken ||
        req.body?.refreshToken ||
        req.headers["x-refresh-token"];

      if (!refreshToken) {
        return this.errorResponse(res, 401, "Refresh token is required");
      }

      const decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + "-refresh",
      );

      const user = await BaseUser.findOne({
        _id: decoded.userId,
        accountStatus: { $nin: ["suspended", "banned", "deactivated"] },
      }).select("+refreshToken");

      if (!user) {
        authHelpers.clearAuthCookies(res);
        return this.errorResponse(res, 401, "Invalid refresh token");
      }

      if (user.refreshToken && user.refreshToken !== refreshToken) {
        authHelpers.clearAuthCookies(res);
        user.refreshToken = null;
        await user.save({ validateBeforeSave: false });
        return this.errorResponse(res, 401, "Refresh token invalidated");
      }

      const { accessToken, newRefreshToken } = authService.generateTokens(user);

      user.refreshToken = newRefreshToken;

      if (typeof user.updatePresence === "function") {
        await user.updatePresence("online");
      }

      await user.save({ validateBeforeSave: false });

      authHelpers.setAuthCookies(res, accessToken, newRefreshToken);

      return this.successResponse(
        res,
        200,
        {
          accessToken,
          refreshToken: newRefreshToken,
          expiresIn: 900,
          tokenType: "Bearer",
          requiresVerification: !user.emailVerified,
          role: user.role,
          userType: user.userType,
          features: authHelpers.getRoleFeatures(user.role),
        },
        "Token refreshed successfully",
      );
    } catch (error) {
      authHelpers.clearAuthCookies(res);
      if (
        error.name === "JsonWebTokenError" ||
        error.name === "TokenExpiredError"
      ) {
        return this.errorResponse(res, 401, "Invalid or expired refresh token");
      }
      this.logger.error("Refresh token error:", error);
      return this.handleError(error, req, res);
    }
  }

  // ========== PASSWORD MANAGEMENT ==========
  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body;

      if (!currentPassword || !newPassword || !confirmPassword) {
        return this.errorResponse(res, 400, "All password fields are required");
      }

      if (newPassword !== confirmPassword) {
        return this.errorResponse(res, 400, "New passwords do not match");
      }

      const user = await BaseUser.findById(req.userId).select(
        "+password +passwordHistory +accountLockedUntil +role +userType",
      );
      if (!user) {
        return this.errorResponse(res, 404, "User not found");
      }

      if (user.accountLockedUntil) {
        const message =
          user.role !== ROLES.USER
            ? "Staff account locked. Contact security team."
            : "Cannot change password while account is locked.";
        return this.errorResponse(res, 403, {
          error: "Account locked",
          message,
        });
      }

      const result = await authService.changePassword(
        user,
        currentPassword,
        newPassword,
      );

      if (!result.success) {
        return this.errorResponse(res, 400, result.error);
      }

      await authHelpers.logSecurityEvent(user._id, "password_changed", {
        role: user.role,
        userType: user.userType,
        ip: req.ip,
        timestamp: new Date().toISOString(),
        securityLevel: user.role !== ROLES.USER ? "high" : "standard",
      });

      authHelpers.clearAuthCookies(res);
      return this.successResponse(
        res,
        200,
        null,
        "Password changed successfully. Please login again.",
      );
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async forgotPassword(req, res) {
    try {
      const { email } = req.body;

      if (!email || !require("validator").isEmail(email)) {
        return this.errorResponse(
          res,
          400,
          "Please provide a valid email address",
        );
      }

      const result = await authService.initiatePasswordReset(email);

      if (!result.success && result.error) {
        return this.errorResponse(res, 429, result.error);
      }

      if (result.userFound) {
        await this.sendPasswordResetEmail(
          result.user.email,
          result.resetToken,
          result.wasLocked,
          result.user.role,
        );

        return this.successResponse(res, 200, {
          message: "Password reset instructions sent to your email",
          expiresIn: 15,
          accountWasLocked: result.wasLocked,
          userType: result.user.userType,
          note: "Check your spam folder if you don't see the email within 5 minutes",
        });
      }

      return this.successResponse(
        res,
        200,
        {},
        "If your email is registered, you will receive password reset instructions within 5 minutes.",
      );
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async resetPassword(req, res) {
    try {
      const { token, password, confirmPassword } = req.body;

      if (!token || !password || !confirmPassword) {
        return this.errorResponse(
          res,
          400,
          "Token, new password, and confirmation are required",
        );
      }

      if (password !== confirmPassword) {
        return this.errorResponse(res, 400, "Passwords do not match");
      }

      const result = await authService.resetPassword(token, password);

      if (!result.success) {
        return this.errorResponse(res, 400, result.error);
      }

      await authHelpers.logSecurityEvent(
        result.user._id,
        "password_reset_with_token",
        {
          ip: req.ip,
          role: result.user.role,
          userType: result.user.userType,
          timestamp: new Date().toISOString(),
          accountWasUnlocked: result.wasLocked,
        },
      );

      await this.sendPasswordResetConfirmation(
        result.user.email,
        result.wasLocked,
        result.user.role,
      );

      return this.successResponse(
        res,
        200,
        {
          message: "Password reset successful",
          accountUnlocked: result.wasLocked,
          userType: result.user.userType,
          email: result.user.email,
          nextStep: "login",
        },
        "Password reset successful. Your account has been unlocked. Please login with your new password.",
      );
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== HELPER METHODS ==========
  async sendAuthResponse(user, res, statusCode, message) {
    const { accessToken, refreshToken } = authService.generateTokens(user);

    user.refreshToken = refreshToken;

    if (typeof user.updatePresence === "function") {
      await user.updatePresence("online");
    }

    await user.save({ validateBeforeSave: false });

    authHelpers.setAuthCookies(res, accessToken, refreshToken);

    const userData = authHelpers.formatUserResponse(user);

    return this.successResponse(
      res,
      statusCode,
      {
        user: userData,
        accessToken,
        refreshToken,
        expiresIn: user.role !== ROLES.USER ? 1800 : 900,
        tokenType: "Bearer",
        requiresVerification: !user.emailVerified,
        role: user.role,
        userType: user.userType,
        permissions: authHelpers.getRolePermissions(user.role),
        features: authHelpers.getRoleFeatures(user.role),
      },
      message,
    );
  }

  async sendVerificationEmail(email, token, userType) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;
    this.logger.info(
      `📧 Verification email for ${email} (${userType}): ${verificationUrl}`,
    );
  }

  async sendStaffVerificationEmail(email, token, role, firstName, employeeId) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;
    this.logger.info(`📧 Staff verification email prepared for ${email}:`, {
      verificationUrl,
      role,
      employeeId,
    });
  }

  async sendPasswordResetEmail(email, token, wasLocked, role) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    this.logger.info(`🔐 Password reset email prepared for ${email}:`, {
      resetUrl: resetUrl.substring(0, 50) + "...",
      wasLocked,
      role,
    });
  }

  async sendPasswordResetConfirmation(email, wasLocked, role) {
    this.logger.info(`✅ Password reset confirmation sent to ${email}`, {
      wasLocked,
      role,
    });
  }
}

module.exports = AuthController;