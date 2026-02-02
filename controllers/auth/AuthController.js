// controllers/AuthController.js - SIMPLIFIED PRACTICAL VERSION
const BaseController = require("../BaseController");
const { BaseUser, ROLES } = require("@models/User");
const authService = require("@services/AuthService");
const validationService = require("@services/ValidationService");
const authHelpers = require("@utils/AuthHelpers");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const validator = require("validator");

class AuthController extends BaseController {
  constructor() {
    super();
    this.logger = console;
    this.validateEnvVars();
    // Simple in-memory rate limiting for refresh tokens
    this.refreshAttempts = new Map();
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
  /**
   * Standardize success responses for consistent frontend handling
   */
  standardizedSuccessResponse(res, statusCode, data, message = "") {
    // Always ensure data field exists
    const responseData = {
      success: true,
      data: data || {},
      message,
      timestamp: new Date().toISOString(),
    };
    
    return res.status(statusCode).json(responseData);
  }

  /**
   * Standardize error responses for consistent frontend handling
   */
  standardizedErrorResponse(res, statusCode, errorMessage, fieldErrors = null) {
    const response = {
      success: false,
      message: errorMessage,
      statusCode,
      timestamp: new Date().toISOString(),
    };
    
    if (fieldErrors) {
      response.errors = fieldErrors;
    }
    
    return res.status(statusCode).json(response);
  }

  /**
   * Enhance user object with virtual fields for frontend
   */
  enhanceUserResponse(user) {
    if (!user) return null;
    
    // Get base formatted user
    const userData = authHelpers.formatUserResponse(user);
    
    // Ensure virtual fields are present
    if (!userData.fullName && user.firstName && user.lastName) {
      userData.fullName = `${user.firstName} ${user.lastName}`;
    }
    
    if (userData.isActive === undefined) {
      userData.isActive = user.accountStatus === 'active' || user.accountStatus === 'pending_verification';
    }
    
    if (userData.isAdminUser === undefined) {
      userData.isAdminUser = user.role === ROLES.ADMIN || user.role === ROLES.SUPER_ADMIN;
    }
    
    if (userData.isSuperAdminUser === undefined) {
      userData.isSuperAdminUser = user.role === ROLES.SUPER_ADMIN;
    }
    
    // Add age for dating users
    if (user.userType === 'DatingUser' && user.dateOfBirth) {
      userData.age = this.calculateAge(new Date(user.dateOfBirth));
    }
    
    return userData;
  }

  /**
   * Generate consistent auth response data
   */
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

  // ========== REGISTRATION ==========
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
        sessionId,
        employeeId,
        department,
        jobTitle,
        managedUsers = [],
        gender,
        phoneNumber,
        country,
        registrationType = req.registrationType || 'dating',
      } = req.body;

      // ===== 1. DETERMINE USER TYPE =====
      let userType;
      let userRole = role;
      let inviteValidation = null;
      
      if (registrationType === 'staff') {
        userType = 'Staff';
        console.log(`👔 Staff registration detected for: ${email}`);
      } else {
        userType = 'DatingUser';
        userRole = ROLES.USER;
        console.log(`💑 Dating registration detected for: ${email}`);
      }

      // ===== 2. SECURITY VALIDATION =====
      if (registrationType === 'dating') {
        if (!sessionId) {
          await session.abortTransaction();
          return this.standardizedErrorResponse(
            res, 
            403, 
            "Security verification required for dating user registration. Please answer the security question first."
          );
        }
        
        const sessionValidation = await this.validateSecuritySession(sessionId);
        if (!sessionValidation.valid) {
          await session.abortTransaction();
          return this.standardizedErrorResponse(res, 403, sessionValidation.error);
        }
      }
      
      if (registrationType === 'staff') {
        if (!inviteCode) {
          await session.abortTransaction();
          return this.standardizedErrorResponse(
            res, 
            403, 
            "Invite code is required for staff registration. Please contact an administrator."
          );
        }
        
        inviteValidation = await authService.validateAdminInvite(inviteCode, userRole);
        if (!inviteValidation.valid) {
          await session.abortTransaction();
          return this.standardizedErrorResponse(res, 403, inviteValidation.error);
        }
        
        if (!employeeId || !department || !jobTitle) {
          await session.abortTransaction();
          return this.standardizedErrorResponse(
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
        return this.standardizedErrorResponse(res, 400, validation.error);
      }

      // ===== 4. AGE VALIDATION FOR DATING USERS =====
      if (userType === 'DatingUser' && dateOfBirth) {
        const age = this.calculateAge(new Date(dateOfBirth));
        if (age < 18) {
          await session.abortTransaction();
          return this.standardizedErrorResponse(res, 400, "You must be at least 18 years old");
        }
        if (age > 100) {
          await session.abortTransaction();
          return this.standardizedErrorResponse(res, 400, "Please enter a valid date of birth");
        }
      }

      // ===== 5. EXISTING USER CHECKS =====
      const existingUser = await BaseUser.findOne({
        email: email.toLowerCase().trim(),
      }).session(session);
      
      if (existingUser) {
        await session.abortTransaction();
        return this.standardizedErrorResponse(res, 400, "Email already exists");
      }

      if (userName) {
        const existingUserWithUsername = await BaseUser.findOne({
          userName: userName.trim().toLowerCase(),
        }).session(session);
        
        if (existingUserWithUsername) {
          await session.abortTransaction();
          return this.standardizedErrorResponse(res, 400, "Username already exists");
        }
      }

      if (userType === 'Staff' && employeeId) {
        const existingEmployee = await BaseUser.findOne({ 
          employeeId 
        }).session(session);
        
        if (existingEmployee) {
          await session.abortTransaction();
          return this.standardizedErrorResponse(res, 400, "Employee ID already exists");
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
        securitySessionId: sessionId,
        // Add tokenVersion field for logout everywhere feature
        tokenVersion: 1,
      };

      if (userType === 'Staff') {
        userData.employeeId = employeeId;
        userData.department = department;
        userData.jobTitle = jobTitle;
        userData.managedUsers = managedUsers;
      }

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
      if (userType === 'Staff' && inviteCode && inviteValidation) {
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

      // Generate enhanced auth response
      const authResponseData = this.generateAuthResponseData(user, true);
      
      // Update user with refresh token (TOKEN ROTATION - store new token)
      user.refreshToken = authResponseData.refreshToken;
      user.lastLogin = new Date();
      if (typeof user.updatePresence === "function") {
        await user.updatePresence("online");
      }
      await user.save({ validateBeforeSave: false });
      
      authHelpers.setAuthCookies(res, authResponseData.accessToken, authResponseData.refreshToken);

      return this.standardizedSuccessResponse(res, 201, authResponseData, message);

    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      this.logger.error("Registration error:", error);

      if (error.name === "ValidationError") {
        const messages = Object.values(error.errors).map((err) => err.message);
        return this.standardizedErrorResponse(res, 400, messages.join(", "));
      }

      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        return this.standardizedErrorResponse(res, 400, `${field} already exists`);
      }

      return this.handleError(error, req, res);
    } finally {
      session.endSession();
    }
  }

  // ===== LEGACY STAFF REGISTRATION =====
  async registerStaff(req, res) {
    req.registrationType = 'staff';
    return this.register(req, res);
  }

  // ========== AUTHENTICATION ==========
  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return this.standardizedErrorResponse(
          res,
          400,
          "Please provide email and password",
        );
      }

      const result = await authService.authenticateUser(email, password);

      if (!result.success) {
        return this.standardizedErrorResponse(res, result.code, result.error);
      }

      await authHelpers.logSecurityEvent(result.user._id, "login_success", {
        role: result.user.role,
        userType: result.user.userType,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        timestamp: new Date().toISOString(),
        securityLevel: result.user.role !== ROLES.USER ? "elevated" : "standard",
      });

      // Generate enhanced auth response
      const authResponseData = this.generateAuthResponseData(result.user, true);
      
      // Update user with refresh token
      result.user.refreshToken = authResponseData.refreshToken;
      result.user.lastLogin = new Date();
      if (typeof result.user.updatePresence === "function") {
        await result.user.updatePresence("online");
      }
      await result.user.save({ validateBeforeSave: false });
      
      authHelpers.setAuthCookies(res, authResponseData.accessToken, authResponseData.refreshToken);

      return this.standardizedSuccessResponse(
        res,
        200,
        authResponseData,
        authHelpers.getWelcomeMessage(result.user)
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
          // Clear refresh token (simple logout)
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
      
      return this.standardizedSuccessResponse(
        res,
        200,
        { 
          message: "Logged out successfully",
          timestamp: new Date().toISOString()
        },
        "Logged out successfully"
      );
    } catch (error) {
      authHelpers.clearAuthCookies(res);
      this.logger.error("Logout error:", error);
      
      // Still return success response for logout
      return this.standardizedSuccessResponse(
        res,
        200,
        { 
          message: "Logged out successfully",
          timestamp: new Date().toISOString()
        },
        "Logged out successfully"
      );
    }
  }

  // ========== REFRESH TOKEN - SIMPLIFIED & SECURE ==========
  async refreshToken(req, res) {
    try {
      // Simple rate limiting check
      const ip = req.ip;
      const now = Date.now();
      const windowMs = 15 * 60 * 1000; // 15 minutes
      const maxAttempts = 10;
      
      if (!this.refreshAttempts.has(ip)) {
        this.refreshAttempts.set(ip, []);
      }
      
      const attempts = this.refreshAttempts.get(ip);
      const validAttempts = attempts.filter(time => now - time < windowMs);
      
      if (validAttempts.length >= maxAttempts) {
        return this.standardizedErrorResponse(res, 429, 'Too many refresh attempts. Please try again later.');
      }
      
      validAttempts.push(now);
      this.refreshAttempts.set(ip, validAttempts);

      const refreshToken =
        req.cookies?.refreshToken ||
        req.body?.refreshToken ||
        req.headers["x-refresh-token"];

      if (!refreshToken) {
        return this.standardizedErrorResponse(res, 401, "Refresh token is required");
      }

      const decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + "-refresh",
      );

      const user = await BaseUser.findOne({
        _id: decoded.userId,
        accountStatus: { $nin: ["suspended", "banned", "deactivated"] },
      }).select("+refreshToken +tokenVersion");

      if (!user) {
        authHelpers.clearAuthCookies(res);
        return this.standardizedErrorResponse(res, 401, "Invalid refresh token");
      }

      // Check token version (for logout everywhere feature)
      if (user.tokenVersion !== decoded.tokenVersion) {
        authHelpers.clearAuthCookies(res);
        user.refreshToken = null;
        await user.save({ validateBeforeSave: false });
        return this.standardizedErrorResponse(res, 401, "Session expired. Please login again.");
      }

      // Check if stored token matches (simple security)
      if (user.refreshToken && user.refreshToken !== refreshToken) {
        // Token mismatch - clear all tokens
        authHelpers.clearAuthCookies(res);
        user.refreshToken = null;
        await user.save({ validateBeforeSave: false });
        return this.standardizedErrorResponse(res, 401, "Session invalidated. Please login again.");
      }

      // Generate new tokens (TOKEN ROTATION - critical!)
      const { accessToken, newRefreshToken } = authService.generateTokens(user);

      // Store new refresh token (ROTATION)
      user.refreshToken = newRefreshToken;
      user.lastLogin = new Date();

      if (typeof user.updatePresence === "function") {
        await user.updatePresence("online");
      }

      await user.save({ validateBeforeSave: false });

      authHelpers.setAuthCookies(res, accessToken, newRefreshToken);

      // Generate enhanced response
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

      return this.standardizedSuccessResponse(
        res,
        200,
        responseData,
        "Token refreshed successfully"
      );
    } catch (error) {
      authHelpers.clearAuthCookies(res);
      
      if (error.name === "TokenExpiredError") {
        return this.standardizedErrorResponse(res, 401, "Session expired. Please login again.");
      }
      
      if (error.name === "JsonWebTokenError") {
        return this.standardizedErrorResponse(res, 401, "Invalid token");
      }
      
      this.logger.error("Refresh token error:", error);
      return this.standardizedErrorResponse(res, 500, "Internal server error");
    }
  }

  // ========== LOGOUT EVERYWHERE (Optional but nice feature) ==========
  async logoutEverywhere(req, res) {
    try {
      if (!req.userId) {
        return this.standardizedErrorResponse(res, 401, "Not authenticated");
      }

      const user = await BaseUser.findById(req.userId);
      if (!user) {
        return this.standardizedErrorResponse(res, 404, "User not found");
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

      return this.standardizedSuccessResponse(
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
      return this.handleError(error, req, res);
    }
  }

  // ========== EMAIL VERIFICATION ==========
  async verifyEmail(req, res) {
    try {
      const { token } = req.params;

      if (!token) {
        return this.standardizedErrorResponse(res, 400, "Verification token is required");
      }

      const hashedToken = authService.hashToken(token);
      
      const user = await BaseUser.findOne({
        emailVerificationToken: hashedToken,
        emailVerificationExpires: { $gt: Date.now() },
        isEmailVerified: false,
      });

      if (!user) {
        return this.standardizedErrorResponse(res, 400, "Invalid or expired verification token");
      }

      user.isEmailVerified = true;
      user.emailVerificationToken = null;
      user.emailVerificationExpires = null;
      user.emailVerifiedAt = new Date();
      await user.save();

      await authHelpers.logSecurityEvent(user._id, "email_verified", {
        email: user.email,
        userType: user.userType,
        timestamp: new Date().toISOString(),
      });

      if (user.userType === 'DatingUser') {
        await this.sendWelcomeEmail(user.email, user.firstName);
      }

      return this.standardizedSuccessResponse(
        res,
        200,
        {
          email: user.email,
          userType: user.userType,
          requiresCompleteProfile: user.userType === 'DatingUser',
          // Include user info for immediate frontend update
          user: this.enhanceUserResponse(user),
        },
        "Email verified successfully"
      );
    } catch (error) {
      this.logger.error("Verify email error:", error);
      return this.handleError(error, req, res);
    }
  }

  // ========== GET CURRENT USER ==========
  async getCurrentUser(req, res) {
    try {
      if (!req.userId) {
        return this.standardizedErrorResponse(res, 401, "Not authenticated");
      }

      const user = await BaseUser.findById(req.userId)
        .select('-password -refreshToken -passwordHistory -__v -securitySessionId -emailVerificationToken -emailVerificationExpires');

      if (!user) {
        return this.standardizedErrorResponse(res, 404, "User not found");
      }

      if (!user.isActive || user.accountStatus && ['suspended', 'banned', 'deactivated'].includes(user.accountStatus)) {
        return this.standardizedErrorResponse(res, 403, "Account is not active");
      }

      const accessToken = req.headers.authorization?.replace('Bearer ', '');

      // Generate enhanced response
      const responseData = {
        user: this.enhanceUserResponse(user),
        accessToken: accessToken || undefined,
        requiresVerification: !user.isEmailVerified,
        role: user.role,
        userType: user.userType,
        permissions: authHelpers.getRolePermissions(user.role),
        features: authHelpers.getRoleFeatures(user.role),
      };

      return this.standardizedSuccessResponse(
        res,
        200,
        responseData,
        "User retrieved successfully"
      );
    } catch (error) {
      this.logger.error("Get current user error:", error);
      return this.handleError(error, req, res);
    }
  }

  // ========== PASSWORD MANAGEMENT ==========
  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body;

      if (!currentPassword || !newPassword || !confirmPassword) {
        return this.standardizedErrorResponse(res, 400, "All password fields are required");
      }

      if (newPassword !== confirmPassword) {
        return this.standardizedErrorResponse(res, 400, "New passwords do not match");
      }

      const user = await BaseUser.findById(req.userId).select(
        "+password +passwordHistory +accountLockedUntil +role +userType",
      );
      if (!user) {
        return this.standardizedErrorResponse(res, 404, "User not found");
      }

      if (user.accountLockedUntil) {
        const message =
          user.role !== ROLES.USER
            ? "Staff account locked. Contact security team."
            : "Cannot change password while account is locked.";
        return this.standardizedErrorResponse(res, 403, {
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
        return this.standardizedErrorResponse(res, 400, result.error);
      }

      await authHelpers.logSecurityEvent(user._id, "password_changed", {
        role: user.role,
        userType: user.userType,
        ip: req.ip,
        timestamp: new Date().toISOString(),
        securityLevel: user.role !== ROLES.USER ? "high" : "standard",
      });

      // Invalidate all tokens when password changes (security best practice)
      user.refreshToken = null;
      user.tokenVersion = (user.tokenVersion || 1) + 1;
      await user.save({ validateBeforeSave: false });
      
      authHelpers.clearAuthCookies(res);
      
      return this.standardizedSuccessResponse(
        res,
        200,
        {
          message: "Password changed successfully. Please login again.",
          requiresReauthentication: true,
          timestamp: new Date().toISOString(),
        },
        "Password changed successfully"
      );
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async forgotPassword(req, res) {
    try {
      const { email } = req.body;

      if (!email || !validator.isEmail(email)) {
        return this.standardizedErrorResponse(
          res,
          400,
          "Please provide a valid email address",
        );
      }

      const result = await authService.initiatePasswordReset(email);

      if (!result.success && result.error) {
        return this.standardizedErrorResponse(res, 429, result.error);
      }

      if (result.userFound) {
        await this.sendPasswordResetEmail(
          result.user.email,
          result.resetToken,
          result.wasLocked,
          result.user.role,
        );

        return this.standardizedSuccessResponse(res, 200, {
          message: "Password reset instructions sent to your email",
          expiresIn: 15,
          accountWasLocked: result.wasLocked,
          userType: result.user.userType,
          note: "Check your spam folder if you don't see the email within 5 minutes",
        });
      }

      // Always return success for security reasons (don't reveal if email exists)
      return this.standardizedSuccessResponse(
        res,
        200,
        {
          message: "If your email is registered, you will receive password reset instructions within 5 minutes.",
          note: "Check your spam folder",
        }
      );
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async resetPassword(req, res) {
    try {
      const { token, password, confirmPassword } = req.body;

      if (!token || !password || !confirmPassword) {
        return this.standardizedErrorResponse(
          res,
          400,
          "Token, new password, and confirmation are required",
        );
      }

      if (password !== confirmPassword) {
        return this.standardizedErrorResponse(res, 400, "Passwords do not match");
      }

      const result = await authService.resetPassword(token, password);

      if (!result.success) {
        return this.standardizedErrorResponse(res, 400, result.error);
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

      // Invalidate all existing tokens after password reset
      result.user.refreshToken = null;
      result.user.tokenVersion = (result.user.tokenVersion || 1) + 1;
      await result.user.save({ validateBeforeSave: false });

      await this.sendPasswordResetConfirmation(
        result.user.email,
        result.wasLocked,
        result.user.role,
      );

      return this.standardizedSuccessResponse(
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

  // ========== SECURITY SESSION METHODS ==========
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

  // ========== EMAIL METHODS ==========
  async sendVerificationEmail(email, token, userType) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;
    this.logger.info(
      `📧 Verification email for ${email} (${userType}): ${verificationUrl}`,
    );
    // TODO: Implement actual email sending
  }

  async sendStaffVerificationEmail(email, token, role, firstName, employeeId) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;
    this.logger.info(`📧 Staff verification email prepared for ${email}:`, {
      verificationUrl,
      role,
      employeeId,
    });
    // TODO: Implement actual email sending
  }

  async sendPasswordResetEmail(email, token, wasLocked, role) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    this.logger.info(`🔐 Password reset email prepared for ${email}:`, {
      resetUrl: resetUrl.substring(0, 50) + "...",
      wasLocked,
      role,
    });
    // TODO: Implement actual email sending
  }

  async sendPasswordResetConfirmation(email, wasLocked, role) {
    this.logger.info(`✅ Password reset confirmation sent to ${email}`, {
      wasLocked,
      role,
    });
    // TODO: Implement actual email sending
  }

  async sendWelcomeEmail(email, firstName) {
    this.logger.info(`🎉 Welcome email prepared for ${email}`, {
      firstName,
    });
    // TODO: Implement actual email sending
  }

  // ========== UTILITY METHODS ==========
  calculateAge(birthDate) {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  }

  // ========== HEALTH CHECK ==========
  async healthCheck(req, res) {
    try {
      const dbStatus = await BaseUser.db.readyState === 1 ? 'connected' : 'disconnected';
      const tokensConfigured = !!(process.env.JWT_SECRET && process.env.JWT_REFRESH_SECRET);
      const frontendUrlConfigured = !!process.env.FRONTEND_URL;
      
      return this.standardizedSuccessResponse(
        res,
        200,
        {
          status: 'healthy',
          database: dbStatus,
          tokensConfigured,
          frontendUrlConfigured,
          timestamp: new Date().toISOString(),
          version: '1.0.0'
        },
        'Auth service is healthy'
      );
    } catch (error) {
      return this.standardizedErrorResponse(res, 503, 'Service unavailable');
    }
  }
}

module.exports = AuthController;