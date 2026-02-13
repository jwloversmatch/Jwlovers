// services/AuthService.js - FINAL FIXED VERSION
// Removed all dating preferences/settings - now only in Profile model
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const validator = require("validator");
const { BaseUser, ROLES, DatingUser, Staff } = require("@models/User");
const Profile = require("@models/Profile/Profile.model"); 
const InviteCode = require("@models/InviteCode.model");

class AuthService {
  constructor() {
    this.logger = console;
    this.MAX_FAILED_ATTEMPTS = 5;
  }

  // ========== USER CREATION - UPDATED FOR TWO-STEP FLOW ==========
  async createUserWithRole(data, session) {
    const { userType, email, password, firstName, lastName, role, phoneNumber } = data;

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // ===== GENERATE VERIFICATION TOKEN HERE =====
    const verificationToken = this.generateVerificationToken();

    // ===== BASE USER DATA - ONLY ACCOUNT FIELDS =====
    // NO dating preferences, NO dating settings, NO dating privacy settings
    // These now belong in Profile model
    const baseUserData = {
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      role: role || ROLES.USER,
      userType: userType || (role === ROLES.USER ? "DatingUser" : "Staff"),
      accountStatus: "pending_verification",
      emailVerified: false,
      
      // ===== VERIFICATION TOKEN FIELDS =====
      emailVerificationToken: verificationToken.hashed,
      emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000,
      
      // ===== SECURITY FIELDS =====
      failedLoginAttempts: 0,
      accountLockedUntil: null,
      passwordHistory: [hashedPassword],
      lastPasswordChange: new Date(),
      tokenVersion: 1,
      
      // ===== PRESENCE =====
      presence: { 
        status: "offline", 
        lastSeen: new Date(), 
        lastActive: new Date() 
      },
      
      // ===== TIMESTAMPS =====
      registrationDate: new Date()
    };

    if (phoneNumber) {
      baseUserData.phoneNumber = phoneNumber.trim();
      baseUserData.phoneVerified = false;
    }

    // ===== STAFF-SPECIFIC FIELDS =====
    if (userType === "Staff") {
      baseUserData.employeeId = data.employeeId || `EMP${Date.now()}`;
      baseUserData.department = data.department || "management";
      baseUserData.permissions = data.permissions || [];
      baseUserData.hireDate = data.hireDate || new Date();
      baseUserData.accessLevel = data.accessLevel || "basic";
      baseUserData.managedUsers = data.managedUsers || [];
      
      // Staff notifications
      baseUserData.staffNotificationSettings = {
        userReports: "assigned", 
        systemAlerts: true, 
        adminAnnouncements: true,
        shiftReminders: true, 
        caseUpdates: true, 
        teamMessages: true,
      };
      
      // Staff work stats
      baseUserData.workStats = {
        casesResolved: 0, 
        casesEscalated: 0, 
        averageResolutionTime: 0,
        responseTime: 0, 
        lastActiveShift: null, 
        totalShiftHours: 0, 
        performanceScore: 0,
      };
      
      // Staff verification token expires sooner (12 hours)
      baseUserData.emailVerificationExpires = Date.now() + 12 * 60 * 60 * 1000;
    }

    // ===== CRITICAL: Remove profile field if it exists =====
    if (baseUserData.profile !== undefined) {
      delete baseUserData.profile;
    }

    this.logger.info(`🔄 Creating ${userType} user WITHOUT profile...`);
    this.logger.debug(`User data:`, {
      email: baseUserData.email,
      userType: baseUserData.userType,
      hasProfileField: 'profile' in baseUserData,
      hasVerificationToken: !!baseUserData.emailVerificationToken
    });

    // ===== CREATE APPROPRIATE USER BASED ON TYPE =====
    let user;
    try {
      if (userType === "DatingUser") {
        const datingUser = new DatingUser(baseUserData);
        
        const validationError = datingUser.validateSync();
        if (validationError) {
          this.logger.error('❌ DatingUser validation failed:', validationError.errors);
          throw validationError;
        }
        
        await datingUser.save({ session });
        user = datingUser;
        this.logger.info(`✅ DatingUser created WITHOUT profile: ${user._id}`);
        
      } else if (userType === "Staff") {
        const staffUser = new Staff(baseUserData);
        await staffUser.save({ session });
        user = staffUser;
        this.logger.info(`✅ Staff user created: ${user._id}`);
        
      } else {
        const baseUser = new BaseUser(baseUserData);
        await baseUser.save({ session });
        user = baseUser;
        this.logger.info(`✅ BaseUser created: ${user._id}`);
      }
      
      // ===== RETURN BOTH USER AND PLAIN TOKEN =====
      return { 
        user, 
        verificationToken: verificationToken.plain 
      };
      
    } catch (error) {
      this.logger.error(`❌ Failed to create user:`, error.message);
      if (error.errors && error.errors.profile) {
        this.logger.error(`Profile validation issue:`, error.errors.profile.message);
        if (error.errors.profile.message.includes('required') && userType === "DatingUser") {
          throw new Error('Dating user will be updated with profile in the next step');
        }
      }
      throw error;
    }
  }

  /**
   * Create profile for user - UPDATED to include dating preferences
   * This is called AFTER user creation in the two-step flow
   */
  async createProfileForUser(profileData, session) {
    const {
      userId,
      userName,
      dateOfBirth,
      gender,
      phoneNumber,
      country,
      userType,
      firstName,
      lastName,
      email
    } = profileData;

    this.logger.info(`📝 Creating Profile for user ${userId}...`);

    // Get default values from Profile model
    const defaults = Profile.getDefaultValues();

    // Create profile with defaults + provided data
    const profile = new Profile({
      userId,
      ...defaults,
      basic: {
        ...defaults.basic,
        userName: userName || this.generateUsernameFromEmail(email, firstName, lastName),
        dateOfBirth,
        gender: gender || "prefer-not-to-say"
      },
      phoneNumber: phoneNumber || "",
      countryOfOrigin: country || "",
      'datingProfile.isVisible': userType === "DatingUser",
      'datingProfile.isPaused': false
    });

    // Validate before saving
    const validationError = profile.validateSync();
    if (validationError) {
      this.logger.error(`❌ Profile validation error:`, validationError.errors);
      throw validationError;
    }
    
    await profile.save({ session });
    
    if (!profile._id) {
      throw new Error("Profile was saved but has no _id");
    }
    
    this.logger.info(`✅ Profile created: ${profile._id} for user: ${userId}`);
    return profile;
  }

  /**
   * Generate username from email/firstName/lastName
   */
  generateUsernameFromEmail(email, firstName, lastName) {
    const base = firstName ? 
      `${firstName.toLowerCase()}${lastName ? lastName.toLowerCase().charAt(0) : ''}` :
      email.split('@')[0].toLowerCase();
    
    const cleanBase = base.replace(/[^a-z0-9]/g, '');
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return `${cleanBase}${randomNum}`;
  }

  /**
   * Update DatingUser with profile reference
   */
  async updateDatingUserWithProfile(userId, profileId, session) {
    try {
      const datingUser = await DatingUser.findById(userId).session(session);
      
      if (!datingUser) {
        throw new Error(`DatingUser not found: ${userId}`);
      }
      
      this.logger.info(`📌 Updating DatingUser ${userId} with profile ${profileId}`);
      
      datingUser.profile = profileId;
      
      const validationError = datingUser.validateSync();
      if (validationError) {
        this.logger.error(`❌ DatingUser validation error when adding profile:`, validationError.errors);
        throw validationError;
      }
      
      await datingUser.save({ session });
      
      this.logger.info(`✅ DatingUser updated with profile: ${datingUser._id} -> ${profileId}`);
      return datingUser;
      
    } catch (error) {
      this.logger.error(`❌ Failed to update DatingUser profile:`, error);
      throw error;
    }
  }

  // ========== USERNAME GENERATION ==========
  async generateUsername(firstName, session) {
    const baseName = firstName.toLowerCase().replace(/[^a-z]/g, "");
    let finalUsername = `${baseName}${Math.floor(1000 + Math.random() * 9000)}`;

    for (let attempts = 0; attempts < 5; attempts++) {
      const existingProfile = await Profile.findOne({ 'basic.userName': finalUsername }).session(session || null);
      if (!existingProfile) return finalUsername;
      finalUsername = `${baseName}${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const timestamp = Date.now().toString().slice(-6);
    return `user_${timestamp}_${Math.floor(Math.random() * 1000)}`;
  }

  // ========== INVITE CODE VALIDATION ==========
  async validateAdminInvite(inviteCode, requestedRole) {
    try {
      if (!inviteCode) {
        return { valid: false, error: "Invite code is required for staff registration" };
      }

      const cleanCode = inviteCode.trim().toUpperCase();

      if (!/^[A-Z0-9]{8,16}$/.test(cleanCode)) {
        return { valid: false, error: "Invalid invite code format. Must be 8-16 alphanumeric characters." };
      }

      const invite = await InviteCode.findOne({ code: cleanCode, isActive: true });

      if (!invite) {
        return { valid: false, error: "Invalid invite code or code has been deactivated" };
      }

      if (invite.expiresAt && invite.expiresAt < new Date()) {
        await InviteCode.findByIdAndUpdate(invite._id, { isActive: false });
        return { valid: false, error: "Invite code has expired. Please request a new one." };
      }

      if (invite.uses >= invite.maxUses) {
        await InviteCode.findByIdAndUpdate(invite._id, { isActive: false });
        return { valid: false, error: "Invite code has reached maximum usage limit" };
      }

      if (invite.role !== requestedRole) {
        return { valid: false, error: `This invite code is for ${invite.role} role, not ${requestedRole}` };
      }

      if (invite.maxUses === 1 && invite.uses > 0) {
        return { valid: false, error: "This single-use invite code has already been used" };
      }

      return { valid: true, invite };
    } catch (error) {
      this.logger.error("Invite code validation error:", error);
      return { valid: false, error: "Failed to validate invite code" };
    }
  }

  async markInviteAsUsed(inviteId, userId, session) {
    const invite = await InviteCode.findById(inviteId);
    
    await InviteCode.findOneAndUpdate(
      { _id: inviteId },
      {
        $inc: { uses: 1 },
        $set: {
          usedBy: userId,
          usedAt: new Date(),
          isActive: invite.uses + 1 < invite.maxUses,
          lastUsedAt: new Date(),
        },
      },
      { session }
    );
  }

  // ========== EMAIL VERIFICATION ==========
  async verifyEmail(token) {
    try {
      const hashedToken = this.hashToken(token);
      
      const user = await BaseUser.findOne({
        emailVerificationToken: hashedToken,
        emailVerificationExpires: { $gt: Date.now() }
      });

      if (!user) {
        return { 
          success: false, 
          error: "Invalid or expired verification token" 
        };
      }

      user.emailVerified = true;
      user.emailVerifiedAt = new Date();
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      
      if (user.accountStatus === "pending_verification") {
        user.accountStatus = "active";
      }

      await user.save({ validateBeforeSave: false });

      // Add email verification badge to Profile
      const profile = await Profile.findOne({ userId: user._id });
      if (profile) {
        profile.addBadge('email');
        await profile.save({ validateBeforeSave: false });
      }

      this.logger.info(`✅ Email verified for user: ${user._id}`);
      
      return { 
        success: true, 
        user,
        message: "Email verified successfully. You can now log in."
      };
    } catch (error) {
      this.logger.error("Email verification error:", error);
      return { 
        success: false, 
        error: "Failed to verify email. Please try again." 
      };
    }
  }

  async resendVerificationEmail(email) {
    try {
      const user = await BaseUser.findOne({ 
        email: email.toLowerCase().trim(),
        emailVerified: false,
        accountStatus: "pending_verification"
      });

      if (!user) {
        return { 
          success: false, 
          error: "User not found or already verified" 
        };
      }

      const verificationToken = this.generateVerificationToken();
      
      user.emailVerificationToken = verificationToken.hashed;
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
      
      await user.save({ validateBeforeSave: false });

      this.logger.info(`📧 Resent verification email to: ${user.email}`);
      
      return { 
        success: true, 
        verificationToken: verificationToken.plain,
        user 
      };
    } catch (error) {
      this.logger.error("Resend verification email error:", error);
      return { 
        success: false, 
        error: "Failed to resend verification email" 
      };
    }
  }

  // ========== AUTHENTICATION ==========
  async authenticateUser(email, password) {
    try {
      const user = await BaseUser.findOne({ email: email.toLowerCase().trim() })
        .select("+password +refreshToken +failedLoginAttempts +accountLockedUntil +accountStatus +emailVerified +emailVerificationToken +emailVerificationExpires +presence");

      if (!user) {
        return { 
          success: false, 
          error: "Invalid email or password", 
          code: 401,
          additionalData: {}
        };
      }

      // Check if email is verified
      if (!user.emailVerified) {
        return { 
          success: false, 
          error: "Please verify your email before logging in.", 
          code: 403,
          additionalData: { 
            requiresVerification: true,
            email: user.email
          }
        };
      }

      // Check account status
      if (user.accountStatus === "banned") {
        return { 
          success: false, 
          error: "Account permanently banned.", 
          code: 403,
          additionalData: { accountStatus: "banned", requiresSupport: true }
        };
      }

      if (user.accountStatus === "suspended") {
        const message = user.role === ROLES.USER 
          ? "Account suspended. Please contact support."
          : "Account suspended. Contact senior staff for assistance.";
        return { 
          success: false, 
          error: message, 
          code: 403,
          additionalData: { accountStatus: "suspended", requiresSupport: true }
        };
      }

      if (user.accountStatus === "deactivated") {
        const message = user.role === ROLES.USER
          ? "Account deactivated. Please contact support to reactivate."
          : `${user.role} account deactivated. Contact system administrator.`;
        return { 
          success: false, 
          error: message, 
          code: 403,
          additionalData: { accountStatus: "deactivated", requiresSupport: true }
        };
      }

      // Account lock check
      if (user.accountLockedUntil && user.accountLockedUntil > new Date()) {
        const message = user.role !== ROLES.USER 
          ? "Staff account locked. Please contact a super administrator."
          : "Account locked for security. Please use 'Forgot Password' to reset.";
        
        return { 
          success: false, 
          error: message, 
          code: 403,
          additionalData: { 
            accountLocked: true,
            requiresSupport: user.role !== ROLES.USER,
            action: user.role !== ROLES.USER ? "contact-super-admin" : "forgot-password"
          }
        };
      }

      // Password validation
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        return await this.handleFailedLogin(user);
      }

      // Successful login
      user.failedLoginAttempts = 0;
      user.accountLockedUntil = null;
      user.lastLogin = new Date();
      
      // Update presence
      if (typeof user.updatePresence === "function") {
        await user.updatePresence("online");
      } else {
        user.presence = { 
          status: "online", 
          lastSeen: new Date(), 
          lastActive: new Date() 
        };
      }

      await user.save({ validateBeforeSave: false });

      return { success: true, user };
    } catch (error) {
      this.logger.error("Authenticate user error:", error);
      return { 
        success: false, 
        error: "Authentication failed. Please try again.", 
        code: 500,
        additionalData: {}
      };
    }
  }

  async handleFailedLogin(user) {
    try {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

      if (user.failedLoginAttempts >= this.MAX_FAILED_ATTEMPTS) {
        user.accountLockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
        user.accountStatus = user.accountStatus || "suspended";
        await user.save({ validateBeforeSave: false });

        const message = user.role !== ROLES.USER
          ? "Staff account locked due to multiple failed attempts. Security notified."
          : "Account locked for security. Use 'Forgot Password' to reset.";

        return { 
          success: false, 
          error: message,
          code: 403,
          additionalData: {
            accountLocked: true,
            requiresSupport: user.role !== ROLES.USER,
            remainingAttempts: 0,
            severity: user.role !== ROLES.USER ? "HIGH" : "MEDIUM"
          }
        };
      }

      await user.save({ validateBeforeSave: false });

      const remainingAttempts = this.MAX_FAILED_ATTEMPTS - user.failedLoginAttempts;
      const warning = remainingAttempts <= 2 
        ? ` Account will be locked after ${remainingAttempts} more failed attempt(s).`
        : "";

      return { 
        success: false, 
        error: `Invalid email or password.${warning}`,
        code: 401,
        additionalData: {
          remainingAttempts,
          role: user.role,
          userType: user.userType
        }
      };
    } catch (error) {
      this.logger.error("Handle failed login error:", error);
      return { 
        success: false, 
        error: "Authentication failed. Please try again.", 
        code: 500,
        additionalData: {}
      };
    }
  }

  // ========== TOKEN MANAGEMENT ==========
  generateTokens(user) {
    const accessToken = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        role: user.role,
        userType: user.userType,
        emailVerified: user.emailVerified,
        accountStatus: user.accountStatus,
      },
      process.env.JWT_SECRET,
      { expiresIn: user.role !== ROLES.USER ? "30m" : "15m" }
    );

    const refreshToken = jwt.sign(
      { 
        userId: user._id, 
        tokenType: "refresh", 
        role: user.role, 
        userType: user.userType,
        tokenVersion: user.tokenVersion || 1
      },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + "-refresh",
      { expiresIn: user.role !== ROLES.USER ? "30d" : "7d" }
    );

    return { accessToken, refreshToken };
  }

  generateVerificationToken() {
    const plainToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(plainToken).digest("hex");
    return { plain: plainToken, hashed: hashedToken };
  }

  hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  async refreshAccessToken(refreshToken) {
    try {
      const decoded = jwt.verify(
        refreshToken, 
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + "-refresh"
      );
      
      const user = await BaseUser.findById(decoded.userId)
        .select("+tokenVersion +refreshToken +accountStatus +emailVerified");
      
      if (!user) {
        return { success: false, error: "User not found" };
      }
      
      if (user.tokenVersion !== decoded.tokenVersion) {
        return { success: false, error: "Token invalidated" };
      }
      
      if (user.accountStatus !== "active" && user.accountStatus !== "pending_verification") {
        return { success: false, error: "Account is not active" };
      }
      
      const tokens = this.generateTokens(user);
      
      user.refreshToken = tokens.refreshToken;
      await user.save({ validateBeforeSave: false });
      
      return { success: true, ...tokens };
    } catch (error) {
      this.logger.error("Refresh token error:", error);
      return { success: false, error: "Invalid or expired refresh token" };
    }
  }

  // ========== PASSWORD MANAGEMENT ==========
  async changePassword(user, currentPassword, newPassword) {
    try {
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isPasswordValid) {
        return { success: false, error: "Current password is incorrect" };
      }

      const passwordStrength = BaseUser.validatePasswordStrength(newPassword);
      if (!passwordStrength.isValid) {
        return { success: false, error: passwordStrength.errors.join(", ") };
      }

      if (user.role !== ROLES.USER) {
        const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{12,}$/;
        if (!strongPasswordRegex.test(newPassword)) {
          return { success: false, error: "Staff passwords must be at least 12 characters and contain uppercase, lowercase, numbers, and special characters" };
        }
      }

      if (await user.isPasswordInHistory(newPassword)) {
        return { success: false, error: "New password cannot be the same as a previous password" };
      }

      await user.updatePassword(newPassword);
      user.refreshToken = null;
      await user.save();

      return { success: true };
    } catch (error) {
      this.logger.error("Change password error:", error);
      return { success: false, error: "Failed to change password. Please try again." };
    }
  }

  async initiatePasswordReset(email) {
    try {
      const user = await BaseUser.findOne({ email: email.toLowerCase().trim() })
        .select("+accountLockedUntil +passwordResetToken +passwordResetExpires +role +userType +emailVerified +accountStatus");

      if (!user) {
        return { success: true, userFound: false };
      }

      if (!user.emailVerified) {
        return { 
          success: false, 
          error: "Please verify your email before resetting your password.",
          additionalData: { requiresVerification: true }
        };
      }

      if (user.passwordResetExpires && user.passwordResetExpires > Date.now()) {
        const minutesLeft = Math.ceil((user.passwordResetExpires - Date.now()) / (60 * 1000));
        return { 
          success: false, 
          error: `Password reset already requested. Please check your email or try again in ${minutesLeft} minutes.`,
          additionalData: { retryAfter: minutesLeft }
        };
      }

      const resetToken = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

      user.passwordResetToken = hashedToken;
      user.passwordResetExpires = Date.now() + 15 * 60 * 1000;

      const wasLocked = !!user.accountLockedUntil;

      if (wasLocked) {
        user.accountLockedUntil = null;
        user.failedLoginAttempts = 0;
        if (user.accountStatus === "suspended") {
          user.accountStatus = "active";
        }
      }

      await user.save();

      return { success: true, userFound: true, resetToken, wasLocked, user };
    } catch (error) {
      this.logger.error("Initiate password reset error:", error);
      return { success: false, error: "Failed to initiate password reset. Please try again." };
    }
  }

  async resetPassword(token, newPassword) {
    try {
      const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

      const user = await BaseUser.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: Date.now() },
      }).select("+passwordHistory +accountLockedUntil +role +userType +emailVerified +accountStatus");

      if (!user) {
        return { 
          success: false, 
          error: "The reset token is invalid or has expired. Please request a new password reset link."
        };
      }

      const passwordStrength = BaseUser.validatePasswordStrength(newPassword);
      if (!passwordStrength.isValid) {
        return { success: false, error: passwordStrength.errors.join(", ") };
      }

      if (user.role !== ROLES.USER) {
        const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{12,}$/;
        if (!strongPasswordRegex.test(newPassword)) {
          return { success: false, error: "Staff passwords must be at least 12 characters and contain uppercase, lowercase, numbers, and special characters" };
        }
      }

      if (await user.isPasswordInHistory(newPassword)) {
        return { success: false, error: "New password cannot be the same as a previous password" };
      }

      await user.updatePassword(newPassword);
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      user.refreshToken = null;

      const wasLocked = !!user.accountLockedUntil;
      user.accountLockedUntil = null;
      user.failedLoginAttempts = 0;
      
      if (user.accountStatus === "suspended" || user.accountStatus === "pending_verification") {
        user.accountStatus = "active";
      }

      await user.save();

      return { success: true, user, wasLocked };
    } catch (error) {
      this.logger.error("Reset password error:", error);
      return { success: false, error: "Failed to reset password. Please try again." };
    }
  }

  // ========== LOGOUT ==========
  async logout(userId, refreshToken) {
    try {
      const user = await BaseUser.findById(userId);
      
      if (user) {
        if (refreshToken && user.refreshToken === refreshToken) {
          user.refreshToken = null;
        }
        
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
      }
      
      return { success: true };
    } catch (error) {
      this.logger.error("Logout error:", error);
      return { success: false, error: "Failed to logout" };
    }
  }

  // ========== ACCOUNT DEACTIVATION ==========
  async deactivateAccount(userId, password) {
    try {
      const user = await BaseUser.findById(userId).select("+password");
      
      if (!user) {
        return { success: false, error: "User not found" };
      }
      
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return { success: false, error: "Invalid password" };
      }
      
      user.accountStatus = "deactivated";
      user.deactivatedAt = new Date();
      user.refreshToken = null;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      
      if (typeof user.updatePresence === "function") {
        await user.updatePresence("offline");
      }
      
      await user.save({ validateBeforeSave: false });
      
      return { success: true };
    } catch (error) {
      this.logger.error("Deactivate account error:", error);
      return { success: false, error: "Failed to deactivate account" };
    }
  }
}

module.exports = new AuthService();