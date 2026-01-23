// services/AuthService.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const validator = require("validator");
const { BaseUser, DatingUser, Moderator, Admin, SuperAdmin, ROLES } = require("@models/User");
const Profile = require("@models/Profile.model");
const InviteCode = require("@models/InviteCode.model");

class AuthService {
  constructor() {
    this.logger = console;
    this.MAX_FAILED_ATTEMPTS = 5;
  }

  // ========== USER CREATION ==========
  async createUserWithRole(data, session) {
    const { email, password, firstName, lastName, userName, dateOfBirth, role, phoneNumber } = data;

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    const finalUsername = userName?.trim().toLowerCase() || await this.generateUsername(firstName, session);

    const commonData = {
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      userName: finalUsername,
      role: role || ROLES.USER,
      accountStatus: "pending_verification",
      emailVerified: false,
      failedLoginAttempts: 0,
      accountLockedUntil: null,
      passwordHistory: [hashedPassword],
      lastPasswordChange: new Date(),
      presence: { status: "offline", lastSeen: new Date(), lastActive: new Date() },
      notificationSettings: { email: true, push: true },
      privacySettings: { profileVisibility: "public", showOnlineStatus: true },
    };

    if (phoneNumber) {
      commonData.phoneNumber = phoneNumber.trim();
      commonData.phoneVerified = false;
    }

    let user;
    switch (role) {
      case ROLES.USER:
        user = new DatingUser({
          ...commonData,
          dateOfBirth: new Date(dateOfBirth),
          ageVerified: true,
          preferences: { lookingFor: ["dating"], ageRange: { min: 18, max: 100 }, distance: 50, interests: [] },
          datingNotificationSettings: { messages: true, matches: true, likes: true, safetyAlerts: true },
          datingPrivacySettings: { showLastSeen: "everyone", allowMessagesFrom: "everyone" },
          messagingPreferences: "everyone",
          sharePhone: "hidden",
        });
        break;

      case ROLES.MODERATOR:
      case ROLES.ADMIN:
      case ROLES.SUPER_ADMIN:
        const staffData = {
          ...commonData,
          employeeId: data.employeeId || `EMP${Date.now()}`,
          department: data.department || "management",
          permissions: data.permissions || [],
          staffNotificationSettings: {
            userReports: "assigned", systemAlerts: true, adminAnnouncements: true,
            shiftReminders: true, caseUpdates: true, teamMessages: true,
          },
          workStats: {
            casesResolved: 0, casesEscalated: 0, averageResolutionTime: 0,
            responseTime: 0, lastActiveShift: null, totalShiftHours: 0, performanceScore: 0,
          },
          hireDate: data.hireDate || new Date(),
          accessLevel: data.accessLevel || "basic",
          managedUsers: data.managedUsers || [],
        };

        if (role === ROLES.MODERATOR) user = new Moderator(staffData);
        else if (role === ROLES.ADMIN) user = new Admin(staffData);
        else user = new SuperAdmin(staffData);
        break;

      default:
        throw new Error(`Invalid role: ${role}`);
    }

    await user.save({ session });
    return user;
  }

  async generateUsername(firstName, session) {
    const baseName = firstName.toLowerCase().replace(/[^a-z]/g, "");
    let finalUsername = `${baseName}${Math.floor(1000 + Math.random() * 9000)}`;

    for (let attempts = 0; attempts < 5; attempts++) {
      const existingUser = await BaseUser.findOne({ userName: finalUsername }).session(session || null);
      if (!existingUser) return finalUsername;
      finalUsername = `${baseName}${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const timestamp = Date.now().toString().slice(-6);
    return `user_${timestamp}_${Math.floor(Math.random() * 1000)}`;
  }

  async createProfile(user, session) {
    if (user.role !== ROLES.USER) return null;
    
    const [profile] = await Profile.create([{
      userId: user._id,
      profileCompletion: 0,
      verificationBadges: [],
    }], { session });
    
    return profile;
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

  // ========== AUTHENTICATION ==========
  async authenticateUser(email, password) {
    const user = await BaseUser.findOne({ email: email.toLowerCase().trim() })
      .select("+password +refreshToken +failedLoginAttempts +accountLockedUntil +accountStatus");

    if (!user) {
      return { success: false, error: "Invalid email or password", code: 401 };
    }

    // Check account status
    if (user.accountStatus === "banned") {
      return { success: false, error: "Account permanently banned.", code: 403 };
    }

    if (user.accountStatus === "suspended") {
      const message = user.role === ROLES.USER 
        ? "Account suspended. Please contact support."
        : "Account suspended. Contact senior staff for assistance.";
      return { success: false, error: message, code: 403 };
    }

    if (user.accountStatus === "deactivated") {
      const message = user.role === ROLES.USER
        ? "Account deactivated. Please contact support to reactivate."
        : `${user.role} account deactivated. Contact system administrator.`;
      return { success: false, error: message, code: 403 };
    }

    // Staff email verification check
    if ([ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(user.role) && !user.emailVerified) {
      return { success: false, error: "Staff account requires email verification. Please check your email.", code: 403 };
    }

    // Account lock check
    if (user.accountLockedUntil) {
      const error = user.role !== ROLES.USER ? {
        error: "Staff Account Locked",
        message: "This staff account is locked for security reasons.",
        action: "contact-super-admin",
        instructions: "Please contact a super administrator for assistance.",
        supportRequired: true,
      } : {
        error: "Account locked for security",
        message: "Too many failed login attempts detected.",
        action: "forgot-password",
        instructions: "Please use the 'Forgot Password' feature to reset your password and unlock your account.",
        contactSupport: false,
      };
      return { success: false, error, code: 403 };
    }

    // Password validation
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return await this.handleFailedLogin(user);
    }

    // Successful login
    user.failedLoginAttempts = 0;
    user.lastLogin = new Date();
    
    if (typeof user.updatePresence === "function") {
      await user.updatePresence("online");
    } else {
      user.presence = { status: "online", lastSeen: new Date(), lastActive: new Date() };
    }

    await user.save({ validateBeforeSave: false });

    return { success: true, user };
  }

  async handleFailedLogin(user) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

    if (user.failedLoginAttempts >= this.MAX_FAILED_ATTEMPTS) {
      user.accountLockedUntil = new Date(8640000000000000);
      user.accountStatus = "suspended";
      await user.save({ validateBeforeSave: false });

      const error = user.role !== ROLES.USER ? {
        error: "Staff Account Locked",
        message: "Multiple failed login attempts detected on staff account.",
        action: "security-team",
        instructions: "The security team has been notified. Contact system administrator.",
        supportRequired: true,
        severity: "HIGH",
      } : {
        error: "Account locked for security",
        message: "Multiple failed login attempts detected.",
        action: "forgot-password",
        instructions: "Your account has been locked for security reasons. Please use the 'Forgot Password' feature to reset your password.",
        supportInfo: { email: "security@yourdomain.com", phone: "+1-XXX-XXX-XXXX", hours: "24/7" },
      };

      return { success: false, error, code: 403 };
    }

    await user.save({ validateBeforeSave: false });

    const remainingAttempts = this.MAX_FAILED_ATTEMPTS - user.failedLoginAttempts;
    const error = {
      error: "Invalid credentials",
      message: "Invalid email or password.",
      details: {
        remainingAttempts,
        role: user.role,
        userType: user.userType,
        lockWarning: remainingAttempts <= 2 
          ? `Account will be locked after ${remainingAttempts} more failed attempt(s).`
          : null,
      },
    };

    return { success: false, error, code: 401 };
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
      { userId: user._id, tokenType: "refresh", role: user.role, userType: user.userType },
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

  // ========== PASSWORD MANAGEMENT ==========
  async changePassword(user, currentPassword, newPassword) {
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
  }

  async initiatePasswordReset(email) {
    const user = await BaseUser.findOne({ email: email.toLowerCase().trim() })
      .select("+accountLockedUntil +passwordResetToken +passwordResetExpires +role +userType");

    if (!user) {
      return { success: true, userFound: false };
    }

    if (user.passwordResetExpires && user.passwordResetExpires > Date.now()) {
      const minutesLeft = Math.ceil((user.passwordResetExpires - Date.now()) / (60 * 1000));
      return { success: false, error: { error: "Reset already requested", message: `Password reset already requested. Please check your email or try again in ${minutesLeft} minutes.`, retryAfter: minutesLeft } };
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

    user.passwordResetToken = hashedToken;
    user.passwordResetExpires = Date.now() + 15 * 60 * 1000;

    const wasLocked = !!user.accountLockedUntil;

    if (wasLocked) {
      user.accountLockedUntil = null;
      user.failedLoginAttempts = 0;
      user.accountStatus = "active";
    }

    await user.save();

    return { success: true, userFound: true, resetToken, wasLocked, user };
  }

  async resetPassword(token, newPassword) {
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await BaseUser.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    }).select("+passwordHistory +accountLockedUntil +role +userType");

    if (!user) {
      return { success: false, error: { error: "Invalid or expired token", message: "The reset token is invalid or has expired.", action: "request-new-token", instructions: "Please request a new password reset link." } };
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
    user.accountStatus = "active";

    await user.save();

    return { success: true, user, wasLocked };
  }
}

module.exports = new AuthService();