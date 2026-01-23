  // models/User/baseUserSchema.js - FIXED VERSION WITH PASSWORD HISTORY
  const mongoose = require("mongoose");
  const validator = require("validator");
  const bcrypt = require("bcryptjs");

  // ========== ROLE CONSTANTS & PERMISSIONS ==========
  const ROLES = {
    USER: "user",
    MODERATOR: "moderator",
    ADMIN: "admin",
    SUPER_ADMIN: "super_admin",
  };

  const ROLE_HIERARCHY = {
    [ROLES.USER]: 0,
    [ROLES.MODERATOR]: 1,
    [ROLES.ADMIN]: 2,
    [ROLES.SUPER_ADMIN]: 3,
  };

  const USER_PERMISSIONS = ["read_own_profile", "update_own_profile"];
  const MODERATOR_PERMISSIONS = [
    ...USER_PERMISSIONS,
    "view_all_profiles",
    "review_reports",
  ];
  const ADMIN_PERMISSIONS = [
    ...MODERATOR_PERMISSIONS,
    "manage_users",
    "system_config",
  ];
  const SUPER_ADMIN_PERMISSIONS = [
    ...ADMIN_PERMISSIONS,
    "manage_admins",
    "full_access",
  ];

  const ROLE_PERMISSIONS = {
    [ROLES.USER]: USER_PERMISSIONS,
    [ROLES.MODERATOR]: MODERATOR_PERMISSIONS,
    [ROLES.ADMIN]: ADMIN_PERMISSIONS,
    [ROLES.SUPER_ADMIN]: SUPER_ADMIN_PERMISSIONS,
  };

  // ========== BASE SCHEMA (Common to ALL roles) ==========
  const baseUserSchema = new mongoose.Schema(
    {
      // ========== AUTHENTICATION ==========
      email: {
        type: String,
        required: [true, "Email is required"],
        unique: true,
        trim: true,
        lowercase: true,
        validate: {
          validator: validator.isEmail,
          message: "Please provide a valid email address",
        },
      },

      password: {
        type: String,
        required: [true, "Password is required"],
        minlength: [8, "Password must be at least 8 characters"],
        select: false,
      },

      // ========== CORE IDENTITY ==========
      firstName: {
        type: String,
        required: [true, "First name is required"],
        trim: true,
        maxlength: [50, "First name cannot exceed 50 characters"],
      },

      lastName: {
        type: String,
        required: [true, "Last name is required"],
        trim: true,
        maxlength: [50, "Last name cannot exceed 50 characters"],
      },

      userName: {
        type: String,
        trim: true,
        unique: true,
        sparse: true,
        lowercase: true,
        minlength: [3, "Username must be at least 3 characters"],
        maxlength: [20, "Username cannot exceed 20 characters"],
        validate: {
          validator: function (v) {
            return /^[a-zA-Z0-9_-]+$/.test(v);
          },
          message:
            "Username can only contain letters, numbers, underscores and hyphens",
        },
      },

      // ========== ACCOUNT STATUS ==========
      accountStatus: {
        type: String,
        enum: [
          "pending_verification",
          "active",
          "suspended",
          "deactivated",
          "banned",
        ],
        default: "pending_verification",
      },

      emailVerified: {
        type: Boolean,
        default: false,
      },

      // ========== PRESENCE & ONLINE STATUS ==========
      presence: {
        status: {
          type: String,
          enum: ["online", "away", "busy", "offline", "invisible"],
          default: "offline",
        },
        lastSeen: {
          type: Date,
          default: Date.now,
        },
        lastActive: {
          type: Date,
          default: Date.now,
        },
      },

      // ========== ROLE ==========
      role: {
        type: String,
        enum: Object.values(ROLES),
        default: ROLES.USER,
      },

      // ========== TOKENS & SESSIONS ==========
      refreshToken: {
        type: String,
        select: false,
      },

      currentSessionId: {
        type: String,
        select: false,
      },

      // ========== SECURITY ==========
      failedLoginAttempts: {
        type: Number,
        default: 0,
        select: false,
      },

      accountLockedUntil: {
        type: Date,
        select: false,
      },

      // PASSWORD HISTORY FIELD
      passwordHistory: {
        type: [String],
        default: [],
        select: false,
        validate: {
          validator: function (arr) {
            return arr.length <= 10;
          },
          message: "Password history cannot exceed 10 entries",
        },
      },

      lastPasswordChange: {
        type: Date,
        default: Date.now,
        select: false,
      },

      passwordResetToken: {
        type: String,
        select: false,
      },

      passwordResetExpires: {
        type: Date,
        select: false,
      },

      emailVerificationToken: {
        type: String,
        select: false,
      },

      emailVerificationExpires: {
        type: Date,
        select: false,
      },

      // ========== SETTINGS ==========
      notificationSettings: {
        email: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
      },

      privacySettings: {
        profileVisibility: {
          type: String,
          enum: ["public", "private"],
          default: "public",
        },
        showOnlineStatus: { type: Boolean, default: true },
      },
    },
    {
      timestamps: true,
      discriminatorKey: "userType",
      toJSON: {
        virtuals: true,
        transform: function (doc, ret) {
          ret.id = ret._id;

          // Hide sensitive fields
          const sensitiveFields = [
            "password",
            "__v",
            "refreshToken",
            "failedLoginAttempts",
            "accountLockedUntil",
            "passwordHistory",
            "lastPasswordChange",
            "passwordResetToken",
            "passwordResetExpires",
            "emailVerificationToken",
            "emailVerificationExpires",
            "currentSessionId",
          ];

          sensitiveFields.forEach((field) => {
            delete ret[field];
          });

          return ret;
        },
      },
    },
  );

  // ========== VIRTUAL PROPERTIES ==========
  baseUserSchema.virtual("fullName").get(function () {
    return `${this.firstName} ${this.lastName}`.trim();
  });

  baseUserSchema.virtual("isActive").get(function () {
  return this.accountStatus === "active" || this.accountStatus === "pending_verification";
});

  baseUserSchema.virtual("isAdminUser").get(function () {
  // Debug what's happening
  console.log("DEBUG: Checking isAdminUser for:", this.email);
  console.log("DEBUG: this.role =", this.role);
  console.log("DEBUG: ROLES.ADMIN =", ROLES.ADMIN);
  console.log("DEBUG: ROLES.SUPER_ADMIN =", ROLES.SUPER_ADMIN);
  console.log("DEBUG: Result =", this.role === ROLES.ADMIN || this.role === ROLES.SUPER_ADMIN);
  
  // Make it work regardless of case
  const roleLower = String(this.role).toLowerCase();
  const adminLower = String(ROLES.ADMIN).toLowerCase();
  const superAdminLower = String(ROLES.SUPER_ADMIN).toLowerCase();
  
  return roleLower === adminLower || roleLower === superAdminLower;
});

  baseUserSchema.virtual("isSuperAdminUser").get(function () {
  const roleLower = String(this.role).toLowerCase();
  const superAdminLower = String(ROLES.SUPER_ADMIN).toLowerCase();
  return roleLower === superAdminLower;
});

  baseUserSchema.virtual("age").get(function () {
    if (!this.dateOfBirth) return null;
    const today = new Date();
    const birthDate = new Date(this.dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return age;
  });

  // ========== INSTANCE METHODS (Common) ==========
  baseUserSchema.methods.comparePassword = async function (candidatePassword) {
    try {
      return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
      console.error("Error comparing password:", error);
      return false;
    }
  };

  baseUserSchema.methods.hasPermission = function (permission) {
    const permissions = ROLE_PERMISSIONS[this.role] || [];
    return permissions.includes(permission);
  };

  baseUserSchema.methods.updateLastSeen = async function () {
    try {
      // Check if presence exists
      if (!this.presence) {
        this.presence = {
          status: "offline",
          lastSeen: new Date(),
          lastActive: new Date(),
        };
      } else {
        this.presence.lastSeen = new Date();
        this.presence.lastActive = new Date();
      }

      // Save without validation
      return await this.save({ validateBeforeSave: false });
    } catch (error) {
      console.error("Error in updateLastSeen:", error.message);
      return this;
    }
  };

  baseUserSchema.methods.updatePresence = async function (status = "online") {
    try {
      if (!this.presence) {
        this.presence = {
          status: status,
          lastSeen: new Date(),
          lastActive: new Date(),
        };
      } else {
        this.presence.status = status;
        this.presence.lastSeen = new Date();
        this.presence.lastActive = new Date();
      }

      return await this.save({ validateBeforeSave: false });
    } catch (error) {
      console.error("Error updating presence:", error);
      return this;
    }
  };

  // NEW: Check if password exists in history
  baseUserSchema.methods.isPasswordInHistory = async function (
    candidatePassword,
  ) {
    try {
      if (!this.passwordHistory || this.passwordHistory.length === 0) {
        return false;
      }

      // Check against all passwords in history
      for (const oldHash of this.passwordHistory) {
        if (await bcrypt.compare(candidatePassword, oldHash)) {
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error("Error checking password history:", error);
      return false;
    }
  };

  // NEW: Add current password to history and update
  baseUserSchema.methods.updatePassword = async function (newPassword) {
    try {
      // Hash the new password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);

      // Add current password to history before changing it
      if (this.password) {
        if (!this.passwordHistory) {
          this.passwordHistory = [];
        }

        // Add current password to beginning of history
        this.passwordHistory.unshift(this.password);

        // Keep only last 5 passwords for regular users, 10 for staff
        const maxHistory = ["admin", "super_admin", "moderator"].includes(
          this.role,
        )
          ? 10
          : 5;
        if (this.passwordHistory.length > maxHistory) {
          this.passwordHistory = this.passwordHistory.slice(0, maxHistory);
        }
      }

      // Update password
      this.password = hashedPassword;
      this.lastPasswordChange = new Date();

      // Clear failed attempts when password is changed
      this.failedLoginAttempts = 0;
      this.accountLockedUntil = null;

      return await this.save({ validateBeforeSave: false });
    } catch (error) {
      console.error("Error updating password:", error);
      throw error;
    }
  };

  // NEW: Get password history age (days since last change)
  baseUserSchema.methods.getPasswordAge = function () {
    if (!this.lastPasswordChange) return 0;
    const now = new Date();
    const lastChange = new Date(this.lastPasswordChange);
    const diffInMs = now - lastChange;
    return Math.floor(diffInMs / (1000 * 60 * 60 * 24)); // Convert to days
  };

  // NEW: Check if password is expired (older than 90 days)
  baseUserSchema.methods.isPasswordExpired = function () {
    const passwordAge = this.getPasswordAge();
    const maxAge = ["admin", "super_admin"].includes(this.role) ? 60 : 90; // Staff: 60 days, Users: 90 days
    return passwordAge > maxAge;
  };

  // ========== STATIC METHODS (Common) ==========
  baseUserSchema.statics.getRoleHierarchy = function () {
    return ROLE_HIERARCHY;
  };

  baseUserSchema.statics.getRolePermissions = function (role) {
    return ROLE_PERMISSIONS[role] || [];
  };

  baseUserSchema.statics.updateLastSeen = async function (userId) {
    try {
      if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        console.error("Invalid userId provided to updateLastSeen:", userId);
        return null;
      }

      const result = await this.findByIdAndUpdate(
        userId,
        {
          $set: {
            "presence.lastSeen": new Date(),
            "presence.lastActive": new Date(),
          },
        },
        { new: true },
      );

      return result;
    } catch (error) {
      console.error("Error updating last seen via static method:", error);
      return null;
    }
  };

  // Helper method for password hashing
  baseUserSchema.statics.hashPassword = async function (password) {
    try {
      const salt = await bcrypt.genSalt(10);
      return await bcrypt.hash(password, salt);
    } catch (error) {
      console.error("Error hashing password:", error);
      throw error;
    }
  };

  // Helper method to verify password
  baseUserSchema.statics.verifyPassword = async function (
    password,
    hashedPassword,
  ) {
    try {
      return await bcrypt.compare(password, hashedPassword);
    } catch (error) {
      console.error("Error verifying password:", error);
      return false;
    }
  };

  // NEW: Static method to add password to history
  baseUserSchema.statics.addPasswordToHistory = async function (
    userId,
    hashedPassword,
  ) {
    try {
      const user = await this.findById(userId);
      if (!user) return null;

      if (!user.passwordHistory) {
        user.passwordHistory = [];
      }

      // Add new password to history
      user.passwordHistory.unshift(hashedPassword);

      // Keep appropriate number of passwords based on role
      const maxHistory = ["admin", "super_admin", "moderator"].includes(user.role)
        ? 10
        : 5;
      if (user.passwordHistory.length > maxHistory) {
        user.passwordHistory = user.passwordHistory.slice(0, maxHistory);
      }

      user.lastPasswordChange = new Date();
      await user.save({ validateBeforeSave: false });

      return user;
    } catch (error) {
      console.error("Error adding password to history:", error);
      return null;
    }
  };

  // NEW: Static method to validate password strength
  baseUserSchema.statics.validatePasswordStrength = function (password) {
    const errors = [];

    if (password.length < 8) {
      errors.push("Password must be at least 8 characters long");
    }

    if (!/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }

    if (!/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    }

    if (!/[0-9]/.test(password)) {
      errors.push("Password must contain at least one number");
    }

    if (!/[@$!%*?&]/.test(password)) {
      errors.push(
        "Password must contain at least one special character (@$!%*?&)",
      );
    }

    return {
      isValid: errors.length === 0,
      errors: errors,
    };
  };

  // NEW: Static method to get users with expired passwords
  baseUserSchema.statics.findUsersWithExpiredPasswords = async function (
    role = null,
  ) {
    const query = {};

    if (role) {
      query.role = role;
    }

    // Calculate date threshold based on role
    const maxAge = ["admin", "super_admin", "moderator"].includes(role) ? 60 : 90;
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - maxAge);

    query.lastPasswordChange = { $lt: thresholdDate };
    query.accountStatus = "active";

    return this.find(query)
      .select("firstName lastName email role lastPasswordChange")
      .sort({ lastPasswordChange: 1 });
  };

  // ========== PRE-SAVE HOOKS ==========
  // baseUserSchema.pre('save', async function(next) {
  //   // Only hash the password if it has been modified (or is new)
  //   if (!this.isModified('password')) return next();

  //   try {
  //     // Generate a salt
  //     const salt = await bcrypt.genSalt(10);

  //     // Hash the password along with the new salt
  //     const hashedPassword = await bcrypt.hash(this.password, salt);

  //     // If this is not a new user (i.e., password change), add old password to history
  //     if (!this.isNew && this.passwordHistory) {
  //       const oldPassword = this.password; // This is the hashed password from before the update
  //       this.passwordHistory.unshift(oldPassword);

  //       // Keep appropriate number of passwords based on role
  //       const maxHistory = ['admin', 'super_admin', 'moderator'].includes(this.role) ? 10 : 5;
  //       if (this.passwordHistory.length > maxHistory) {
  //         this.passwordHistory = this.passwordHistory.slice(0, maxHistory);
  //       }
  //     }

  //     // Set the hashed password
  //     this.password = hashedPassword;

  //     // Update last password change timestamp
  //     this.lastPasswordChange = new Date();

  //     // Reset failed login attempts on password change
  //     this.failedLoginAttempts = 0;
  //     this.accountLockedUntil = null;

  //     next();
  //   } catch (error) {
  //     console.error('Error in pre-save hook:', error);
  //     next(error);
  //   }
  // });

  // ========== PRE-FIND HOOKS (For discriminators) ==========
  baseUserSchema.pre("find", function () {
    this.where({ accountStatus: { $ne: "deleted" } });
  });

  baseUserSchema.pre("findOne", function () {
    this.where({ accountStatus: { $ne: "deleted" } });
  });

  // ========== INDEXES ==========
  // baseUserSchema.index({ email: 1 }, { unique: true });
  // baseUserSchema.index({ userName: 1 }, { unique: true, sparse: true });
  // baseUserSchema.index({ role: 1, accountStatus: 1 });
  // baseUserSchema.index({ "presence.lastSeen": -1 });
  // baseUserSchema.index({ lastPasswordChange: 1 });
  // baseUserSchema.index({ accountStatus: 1, role: 1, emailVerified: 1 });

  module.exports = {
    baseUserSchema,
    ROLES,
    ROLE_HIERARCHY,
    ROLE_PERMISSIONS,
  };
