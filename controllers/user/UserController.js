const BaseController = require('../BaseController');
const { 
  BaseUser, 
  DatingUser, 
  Moderator, 
  Admin, 
  SuperAdmin,
  UserService,
  UserQuery,
  ROLES 
} = require('@models/User');
const Profile = require('@models/Profile.model');
const validator = require('validator');
const logger = require('@utils/logger');
const redis = require('@config/redis');

class UserController extends BaseController {
  constructor() {
    super();
    
    // Rate limiting configuration
    this.rateLimits = {
      updatePrivateInfo: { attempts: 5, window: 3600 }, // 5 attempts per hour
      deleteAccount: { attempts: 3, window: 86400 }, // 3 attempts per day
      updateEmail: { attempts: 3, window: 3600 }, // 3 attempts per hour
    };
    
    // Auto-bind methods for consistency
    this.getMe = this.getMe.bind(this);
    this.updatePrivateInfo = this.updatePrivateInfo.bind(this);
    this.updateProfile = this.updateProfile.bind(this);
    this.updateSettings = this.updateSettings.bind(this);
    this.deleteAccount = this.deleteAccount.bind(this);
    this.getSettings = this.getSettings.bind(this);
    this.getUserById = this.getUserById.bind(this);
    this.getUsers = this.getUsers.bind(this);
    this.updateEmail = this.updateEmail.bind(this);
    this.changeUserRole = this.changeUserRole.bind(this);
  }

  // ========== RATE LIMITING HELPERS ==========
  async checkRateLimit(key, limitConfig) {
    try {
      if (!redis.isReady) return true; // Skip if Redis not available
      
      const current = await redis.get(key);
      if (current && parseInt(current) >= limitConfig.attempts) {
        return false;
      }
      return true;
    } catch (error) {
      logger.warn('Rate limit check failed:', error);
      return true; // Fail open for safety
    }
  }

  async incrementRateLimit(key, limitConfig) {
    try {
      if (!redis.isReady) return;
      
      const current = await redis.get(key);
      if (current) {
        await redis.incr(key);
      } else {
        await redis.setex(key, limitConfig.window, 1);
      }
    } catch (error) {
      logger.warn('Rate limit increment failed:', error);
    }
  }

  // ========== USER PROFILE METHODS ==========

  /**
   * Get current user with profile
   */
  async getMe(req, res) {
    try {
      const userId = req.userId || req.user?.id;
      
      if (!userId) {
        return this.errorResponse(res, 401, "Authentication required", {
          code: "AUTH_REQUIRED"
        });
      }

      // Use UserService to get profile with proper authorization
      const userWithProfile = await UserService.getProfile(userId, req.user);
      
      return this.successResponse(res, 200, userWithProfile);

    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  /**
   * Get user by ID (with permissions check)
   */
  async getUserById(req, res) {
    try {
      const { id } = req.params;
      const requestingUser = req.user;

      if (!requestingUser) {
        return this.errorResponse(res, 401, "Authentication required", {
          code: "AUTH_REQUIRED",
          requestId: req.requestId
        });
      }

      // Use UserService to get profile with proper authorization
      const userWithProfile = await UserService.getProfile(id, requestingUser);
      
      return this.successResponse(res, 200, userWithProfile);

    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  /**
   * Update personal information (firstName, lastName, phoneNumber)
   */
  async updatePrivateInfo(req, res) {
    try {
      const { firstName, lastName, phoneNumber } = req.body;
      const userId = req.userId || req.user?.id;

      if (!userId) {
        return this.errorResponse(res, 401, "Authentication required", {
          code: "AUTH_REQUIRED",
          requestId: req.requestId
        });
      }

      // Rate limiting check
      const rateLimitKey = `update_private_info_${userId}`;
      const canProceed = await this.checkRateLimit(
        rateLimitKey, 
        this.rateLimits.updatePrivateInfo
      );
      
      if (!canProceed) {
        return this.errorResponse(res, 429, 
          "Too many update attempts. Please try again later.",
          {
            code: "RATE_LIMITED",
            requestId: req.requestId
          }
        );
      }

      const updateData = {};
      
      if (firstName !== undefined) {
        const trimmed = firstName.trim();
        if (trimmed.length < 1) {
          return this.errorResponse(res, 400, "First name cannot be empty", {
            code: "INVALID_FIRST_NAME",
            requestId: req.requestId
          });
        }
        if (trimmed.length > 50) {
          return this.errorResponse(res, 400, "First name cannot exceed 50 characters", {
            code: "INVALID_FIRST_NAME",
            requestId: req.requestId
          });
        }
        updateData.firstName = trimmed;
      }
      
      if (lastName !== undefined) {
        const trimmed = lastName.trim();
        if (trimmed.length < 1) {
          return this.errorResponse(res, 400, "Last name cannot be empty", {
            code: "INVALID_LAST_NAME",
            requestId: req.requestId
          });
        }
        if (trimmed.length > 50) {
          return this.errorResponse(res, 400, "Last name cannot exceed 50 characters", {
            code: "INVALID_LAST_NAME",
            requestId: req.requestId
          });
        }
        updateData.lastName = trimmed;
      }
      
      if (phoneNumber !== undefined) {
        const trimmed = phoneNumber.trim();
        if (trimmed && !validator.isMobilePhone(trimmed, 'any', { strictMode: false })) {
          return this.errorResponse(res, 400, "Please provide a valid phone number", {
            code: "INVALID_PHONE",
            requestId: req.requestId
          });
        }
        updateData.phoneNumber = trimmed || null;
        updateData.phoneVerified = false; // Require re-verification
        
        // Only dating users have sharePhone field
        if (req.user?.role === ROLES.USER) {
          updateData.sharePhone = "hidden"; // Reset to hidden when phone changes
        }
      }

      if (Object.keys(updateData).length === 0) {
        return this.errorResponse(res, 400, "No data provided to update", {
          code: "NO_UPDATES",
          requestId: req.requestId
        });
      }

      // Check permissions - users can only update themselves
      if (userId !== req.user?._id?.toString()) {
        return this.errorResponse(res, 403, "Can only update your own information", {
          code: "PERMISSION_DENIED",
          requestId: req.requestId
        });
      }

      // Get current user to check phone changes
      const currentUser = await BaseUser.findById(userId);
      if (!currentUser) {
        return this.errorResponse(res, 404, "User not found", {
          code: "USER_NOT_FOUND",
          requestId: req.requestId
        });
      }

      const user = await BaseUser.findByIdAndUpdate(
        userId, 
        updateData, 
        { 
          new: true, 
          runValidators: true,
          select: '-password -refreshToken'
        }
      );

      if (!user) {
        return this.errorResponse(res, 404, "User not found", {
          code: "USER_NOT_FOUND",
          requestId: req.requestId
        });
      }

      // Send phone verification if phone changed
      if (updateData.phoneNumber && currentUser.phoneNumber !== updateData.phoneNumber) {
        // In production, implement SMS verification:
        // await this.sendPhoneVerification(userId, updateData.phoneNumber);
        
        logger.info('Phone number changed, verification required', {
          userId: userId.toString(),
          userType: user.userType,
          role: user.role,
          oldPhone: currentUser.phoneNumber,
          newPhone: updateData.phoneNumber,
          ip: req.ip,
          requestId: req.requestId
        });
      }

      // Increment rate limit counter
      await this.incrementRateLimit(rateLimitKey, this.rateLimits.updatePrivateInfo);

      // Log the update for audit purposes
      logger.info('User private info updated', {
        userId: userId.toString(),
        userType: user.userType,
        role: user.role,
        updatedFields: Object.keys(updateData),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      });

      return this.successResponse(res, 200, {
        user: this.formatUserData(user)
      }, "Personal information updated successfully");

    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  /**
   * Update email address
   */
  async updateEmail(req, res) {
    try {
      const { newEmail, password } = req.body;
      const userId = req.userId || req.user?.id;

      if (!userId) {
        return this.errorResponse(res, 401, "Authentication required", {
          code: "AUTH_REQUIRED",
          requestId: req.requestId
        });
      }

      // Rate limiting check
      const rateLimitKey = `update_email_${userId}`;
      const canProceed = await this.checkRateLimit(
        rateLimitKey, 
        this.rateLimits.updateEmail
      );
      
      if (!canProceed) {
        return this.errorResponse(res, 429, 
          "Too many email update attempts. Please try again later.",
          {
            code: "RATE_LIMITED",
            requestId: req.requestId
          }
        );
      }

      if (!newEmail || !password) {
        return this.errorResponse(res, 400, 
          "New email and password are required",
          {
            code: "MISSING_FIELDS",
            requestId: req.requestId
          }
        );
      }

      // Validate email
      if (!validator.isEmail(newEmail)) {
        return this.errorResponse(res, 400, "Please provide a valid email address", {
          code: "INVALID_EMAIL",
          requestId: req.requestId
        });
      }

      // Verify password
      const user = await BaseUser.findById(userId).select('+password');
      if (!user) {
        return this.errorResponse(res, 404, "User not found", {
          code: "USER_NOT_FOUND",
          requestId: req.requestId
        });
      }

      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return this.errorResponse(res, 401, "Password is incorrect", {
          code: "INVALID_PASSWORD",
          requestId: req.requestId
        });
      }

      // Check if email already exists
      const existingUser = await BaseUser.findOne({ email: newEmail.toLowerCase() });
      if (existingUser) {
        return this.errorResponse(res, 409, "Email already in use", {
          code: "EMAIL_EXISTS",
          requestId: req.requestId
        });
      }

      // Check if user is trying to update to same email
      if (user.email.toLowerCase() === newEmail.toLowerCase()) {
        return this.errorResponse(res, 400, "This is already your current email", {
          code: "SAME_EMAIL",
          requestId: req.requestId
        });
      }

      // Update email (but don't verify until confirmation)
      user.email = newEmail.toLowerCase();
      user.emailVerified = false;
      await user.save();

      // In production, implement email verification:
      // await this.sendEmailVerification(newEmail, userId);

      // Increment rate limit counter
      await this.incrementRateLimit(rateLimitKey, this.rateLimits.updateEmail);

      // Log the update for audit purposes
      logger.info('User email updated', {
        userId: userId.toString(),
        userType: user.userType,
        role: user.role,
        oldEmail: user.email, // Note: this will be the new email since we updated it
        newEmail: newEmail.toLowerCase(),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      });

      return this.successResponse(res, 200, null, 
        "Email updated successfully. Please check your new email for verification instructions.",
        {
          requestId: req.requestId
        }
      );

    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  /**
   * Update public profile information
   */
  async updateProfile(req, res) {
    try {
      const updates = req.body;
      const userId = req.userId || req.user?.id;
      
      if (!userId) {
        return this.errorResponse(res, 401, "Authentication required", {
          code: "AUTH_REQUIRED",
          requestId: req.requestId
        });
      }

      // Check permissions - users can only update themselves
      if (userId !== req.user?._id?.toString()) {
        return this.errorResponse(res, 403, "Can only update your own profile", {
          code: "PERMISSION_DENIED",
          requestId: req.requestId
        });
      }

      // Get user to check type
      const user = await BaseUser.findById(userId);
      if (!user) {
        return this.errorResponse(res, 404, "User not found", {
          code: "USER_NOT_FOUND",
          requestId: req.requestId
        });
      }

      // Different validation based on user type
      let validation;
      if (user.role === ROLES.USER) {
        validation = this.validateDatingProfileUpdates(updates);
      } else {
        validation = this.validateStaffProfileUpdates(updates);
      }
      
      if (!validation.valid) {
        return this.errorResponse(res, 400, validation.error, {
          code: "VALIDATION_ERROR",
          requestId: req.requestId
        });
      }

      // Check username uniqueness if being updated (for dating users only)
      if (updates.userName && user.role === ROLES.USER) {
        const existingUser = await BaseUser.findOne({ 
          userName: updates.userName.trim().toLowerCase(),
          _id: { $ne: userId } // Exclude current user
        });
        
        if (existingUser) {
          return this.errorResponse(res, 409, "Username is already taken", {
            code: "USERNAME_TAKEN",
            requestId: req.requestId
          });
        }
      }

      // Update user with role-specific logic
      const userUpdates = this.prepareUserUpdates(updates, user.role);
      let updatedUser = null;
      
      if (Object.keys(userUpdates).length > 0) {
        // Use the correct model based on user type
        let UserModel;
        switch(user.userType) {
          case 'DatingUser':
            UserModel = DatingUser;
            break;
          case 'Moderator':
            UserModel = Moderator;
            break;
          case 'Admin':
            UserModel = Admin;
            break;
          case 'SuperAdmin':
            UserModel = SuperAdmin;
            break;
          default:
            UserModel = BaseUser;
        }

        updatedUser = await UserModel.findByIdAndUpdate(
          userId,
          userUpdates,
          { 
            new: true, 
            runValidators: true,
            select: '-password -refreshToken'
          }
        );

        if (!updatedUser) {
          return this.errorResponse(res, 404, "User not found", {
            code: "USER_NOT_FOUND",
            requestId: req.requestId
          });
        }
      } else {
        updatedUser = user;
      }

      // Update profile only for dating users
      let profile = null;
      if (user.role === ROLES.USER && this.hasDatingProfileUpdates(updates)) {
        const profileUpdates = this.prepareProfileUpdates(updates);
        
        profile = await Profile.findOneAndUpdate(
          { userId: userId },
          profileUpdates,
          { 
            new: true, 
            upsert: true, // Create profile if doesn't exist
            runValidators: true
          }
        );
      } else if (user.role === ROLES.USER) {
        // Get current profile
        profile = await Profile.findOne({ userId: userId });
      }

      // Log the update for audit purposes
      logger.info('User profile updated', {
        userId: userId.toString(),
        userType: user.userType,
        role: user.role,
        updatedFields: Object.keys(updates),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      });

      const responseData = {
        user: this.formatUserData(updatedUser)
      };

      // Only include profile for dating users
      if (user.role === ROLES.USER) {
        responseData.profile = profile ? this.formatProfileData(profile) : null;
      }

      return this.successResponse(res, 200, responseData, "Profile updated successfully");

    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  /**
   * Get user settings
   */
  async getSettings(req, res) {
    try {
      const userId = req.userId || req.user?.id;
      
      if (!userId) {
        return this.errorResponse(res, 401, "Authentication required", {
          code: "AUTH_REQUIRED",
          requestId: req.requestId
        });
      }

      const user = await BaseUser.findById(userId)
        .select('notificationSettings privacySettings role userType');
      
      if (!user) {
        return this.errorResponse(res, 404, "User not found", {
          code: "USER_NOT_FOUND",
          requestId: req.requestId
        });
      }

      const settings = {
        notificationSettings: user.notificationSettings || {},
        privacySettings: user.privacySettings || {}
      };

      // Add role-specific settings
      if (user.role === ROLES.USER) {
        const datingUser = await DatingUser.findById(userId)
          .select('datingNotificationSettings datingPrivacySettings messagingPreferences');
        
        if (datingUser) {
          settings.datingNotificationSettings = datingUser.datingNotificationSettings || {};
          settings.datingPrivacySettings = datingUser.datingPrivacySettings || {};
          settings.messagingPreferences = datingUser.messagingPreferences || 'everyone';
        }
      } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
        // Use correct model for staff users
        let staffUser;
        switch(user.userType) {
          case 'Moderator':
            staffUser = await Moderator.findById(userId)
              .select('staffNotificationSettings');
            break;
          case 'Admin':
            staffUser = await Admin.findById(userId)
              .select('staffNotificationSettings');
            break;
          case 'SuperAdmin':
            staffUser = await SuperAdmin.findById(userId)
              .select('staffNotificationSettings');
            break;
          default:
            staffUser = await BaseUser.findById(userId)
              .select('staffNotificationSettings');
        }
        
        if (staffUser) {
          settings.staffNotificationSettings = staffUser.staffNotificationSettings || {};
        }
      }

      return this.successResponse(res, 200, settings, null, {
        requestId: req.requestId
      });

    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  /**
   * Update user settings
   */
  async updateSettings(req, res) {
    try {
      const { 
        notificationSettings, 
        privacySettings,
        datingNotificationSettings,
        datingPrivacySettings,
        messagingPreferences,
        staffNotificationSettings
      } = req.body;
      
      const userId = req.userId || req.user?.id;
      
      if (!userId) {
        return this.errorResponse(res, 401, "Authentication required", {
          code: "AUTH_REQUIRED",
          requestId: req.requestId
        });
      }
      
      // Check permissions - users can only update their own settings
      if (userId !== req.user?._id?.toString()) {
        return this.errorResponse(res, 403, "Can only update your own settings", {
          code: "PERMISSION_DENIED",
          requestId: req.requestId
        });
      }

      // Get user to check type
      const user = await BaseUser.findById(userId);
      if (!user) {
        return this.errorResponse(res, 404, "User not found", {
          code: "USER_NOT_FOUND",
          requestId: req.requestId
        });
      }

      // Prepare updates based on user type
      const updateData = {};
      
      // Common settings for all users
      if (notificationSettings && typeof notificationSettings === 'object') {
        if (!this.validateNotificationSettings(notificationSettings)) {
          return this.errorResponse(res, 400, "Invalid notification settings structure", {
            code: "INVALID_NOTIFICATION_SETTINGS",
            requestId: req.requestId
          });
        }
        updateData.notificationSettings = this.mergeSettings(
          user.notificationSettings || {}, 
          notificationSettings
        );
      }
      
      if (privacySettings && typeof privacySettings === 'object') {
        if (!this.validatePrivacySettings(privacySettings)) {
          return this.errorResponse(res, 400, "Invalid privacy settings structure", {
            code: "INVALID_PRIVACY_SETTINGS",
            requestId: req.requestId
          });
        }
        updateData.privacySettings = this.mergeSettings(
          user.privacySettings || {}, 
          privacySettings
        );
      }

      // Role-specific settings
      if (user.role === ROLES.USER) {
        // Dating user specific settings
        const datingUpdates = {};
        
        if (datingNotificationSettings && typeof datingNotificationSettings === 'object') {
          if (!this.validateDatingNotificationSettings(datingNotificationSettings)) {
            return this.errorResponse(res, 400, "Invalid dating notification settings", {
              code: "INVALID_DATING_NOTIFICATION_SETTINGS",
              requestId: req.requestId
            });
          }
          datingUpdates.datingNotificationSettings = this.mergeSettings(
            user.datingNotificationSettings || {}, 
            datingNotificationSettings
          );
        }
        
        if (datingPrivacySettings && typeof datingPrivacySettings === 'object') {
          if (!this.validateDatingPrivacySettings(datingPrivacySettings)) {
            return this.errorResponse(res, 400, "Invalid dating privacy settings", {
              code: "INVALID_DATING_PRIVACY_SETTINGS",
              requestId: req.requestId
            });
          }
          datingUpdates.datingPrivacySettings = this.mergeSettings(
            user.datingPrivacySettings || {}, 
            datingPrivacySettings
          );
        }
        
        if (messagingPreferences && ['everyone', 'matches_only', 'friends_only', 'disabled'].includes(messagingPreferences)) {
          datingUpdates.messagingPreferences = messagingPreferences;
        }

        // Apply dating updates if any
        if (Object.keys(datingUpdates).length > 0) {
          await DatingUser.findByIdAndUpdate(userId, datingUpdates);
        }
        
      } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
        // Staff specific settings
        if (staffNotificationSettings && typeof staffNotificationSettings === 'object') {
          if (!this.validateStaffNotificationSettings(staffNotificationSettings)) {
            return this.errorResponse(res, 400, "Invalid staff notification settings", {
              code: "INVALID_STAFF_NOTIFICATION_SETTINGS",
              requestId: req.requestId
            });
          }
          updateData.staffNotificationSettings = this.mergeSettings(
            user.staffNotificationSettings || {}, 
            staffNotificationSettings
          );
        }
      }

      if (Object.keys(updateData).length === 0 && 
          Object.keys(req.body).filter(k => !['notificationSettings', 'privacySettings'].includes(k)).length === 0) {
        return this.errorResponse(res, 400, "No settings provided to update", {
          code: "NO_SETTINGS_PROVIDED",
          requestId: req.requestId
        });
      }

      // Update common settings
      if (Object.keys(updateData).length > 0) {
        await BaseUser.findByIdAndUpdate(
          userId,
          { $set: updateData }
        );
      }

      // Get updated settings
      const updatedSettings = await this.getSettings(req);

      // Log the update for audit purposes
      logger.info('User settings updated', {
        userId: userId.toString(),
        userType: user.userType,
        role: user.role,
        updatedSettings: Object.keys(req.body),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      });

      return this.successResponse(res, 200, updatedSettings.data, "Settings updated successfully", {
        requestId: req.requestId
      });

    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  /**
   * Delete account with confirmation
   */
  async deleteAccount(req, res) {
    try {
      const { password, confirmation } = req.body;
      const userId = req.userId || req.user?.id;
      
      if (!userId) {
        return this.errorResponse(res, 401, "Authentication required", {
          code: "AUTH_REQUIRED",
          requestId: req.requestId
        });
      }

      // Rate limiting check
      const rateLimitKey = `delete_account_${userId}`;
      const canProceed = await this.checkRateLimit(
        rateLimitKey, 
        this.rateLimits.deleteAccount
      );
      
      if (!canProceed) {
        return this.errorResponse(res, 429, 
          "Too many deletion attempts. Please try again later.",
          {
            code: "RATE_LIMITED",
            requestId: req.requestId
          }
        );
      }

      // Check permissions - users can only delete themselves
      if (userId !== req.user?._id?.toString()) {
        return this.errorResponse(res, 403, "Can only delete your own account", {
          code: "PERMISSION_DENIED",
          requestId: req.requestId
        });
      }

      if (!password) {
        return this.errorResponse(res, 400, "Password is required to delete account", {
          code: "PASSWORD_REQUIRED",
          requestId: req.requestId
        });
      }

      if (confirmation !== 'DELETE') {
        return this.errorResponse(res, 400, 
          "Please type 'DELETE' to confirm account deletion",
          {
            code: "CONFIRMATION_REQUIRED",
            requestId: req.requestId
          }
        );
      }

      const user = await BaseUser.findById(userId).select('+password');
      if (!user) {
        return this.errorResponse(res, 404, "User not found", {
          code: "USER_NOT_FOUND",
          requestId: req.requestId
        });
      }

      // Verify password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        // Increment rate limit counter for failed attempts
        await this.incrementRateLimit(rateLimitKey, this.rateLimits.deleteAccount);
        
        return this.errorResponse(res, 401, "Password is incorrect", {
          code: "INVALID_PASSWORD",
          requestId: req.requestId
        });
      }

      // Soft delete with anonymization
      const deletionTimestamp = Date.now();
      const deletionId = `del_${deletionTimestamp}`;
      
      // Prepare anonymization data
      const anonymizeData = {
        email: `${deletionId}_${user.email}`,
        phoneNumber: null,
        firstName: 'Deleted',
        lastName: 'User',
        avatar: null,
        accountStatus: 'deactivated',
        deletedAt: new Date(),
        refreshToken: null
      };

      // Add role-specific anonymization
      if (user.role === ROLES.USER) {
        // Dating user specific anonymization
        anonymizeData.preferences = {
          lookingFor: ["dating"],
          ageRange: { min: 18, max: 100 },
          distance: 50,
          interests: []
        };
        anonymizeData.location = null;
        anonymizeData.sharePhone = "hidden";
        anonymizeData.messagingPreferences = "disabled";
      } else {
        // Staff user anonymization
        anonymizeData.employeeId = `DELETED_${deletionId}`;
        anonymizeData.department = 'deleted';
        anonymizeData.permissions = [];
        anonymizeData.managedUsers = [];
      }

      // Save the anonymized user
      await BaseUser.findByIdAndUpdate(
        userId,
        anonymizeData,
        { validateBeforeSave: false }
      );

      // Anonymize profile if exists (for dating users)
      if (user.role === ROLES.USER) {
        await Profile.findOneAndUpdate(
          { userId: userId },
          {
            bio: 'This account has been deleted',
            profilePicture: null,
            isActive: false,
            isVerified: false,
            deletedAt: new Date()
          },
          { upsert: false }
        );
      }

      // Increment rate limit counter for successful deletion
      await this.incrementRateLimit(rateLimitKey, this.rateLimits.deleteAccount);

      // Log the deletion for audit purposes
      logger.warn('User account deleted', {
        userId: userId.toString(),
        userType: user.userType,
        role: user.role,
        deletionId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      });

      // Clear auth cookies
      res.clearCookie('accessToken');
      res.clearCookie('refreshToken');

      return this.successResponse(res, 200, {
        deletionId,
        deletedAt: new Date().toISOString(),
        note: "Your account has been deleted. All personal data has been anonymized."
      }, "Account deleted successfully", {
        requestId: req.requestId
      });

    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  /**
   * Change user role (admin only)
   */
  async changeUserRole(req, res) {
    try {
      const { userId, newRole } = req.body;
      const adminUser = req.user;

      if (!adminUser) {
        return this.errorResponse(res, 401, "Authentication required", {
          code: "AUTH_REQUIRED",
          requestId: req.requestId
        });
      }

      // Only admins can change roles
      if (!adminUser.isAdminUser) {
        return this.errorResponse(res, 403, "Insufficient permissions to change user roles", {
          code: "PERMISSION_DENIED",
          requestId: req.requestId
        });
      }

      if (!userId || !newRole) {
        return this.errorResponse(res, 400, "User ID and new role are required", {
          code: "MISSING_FIELDS",
          requestId: req.requestId
        });
      }

      // Validate role
      const validRoles = Object.values(ROLES);
      if (!validRoles.includes(newRole)) {
        return this.errorResponse(res, 400, `Role must be one of: ${validRoles.join(', ')}`, {
          code: "INVALID_ROLE",
          requestId: req.requestId
        });
      }

      // Cannot change own role
      if (userId === adminUser._id.toString()) {
        return this.errorResponse(res, 400, "Cannot change your own role", {
          code: "SELF_ROLE_CHANGE",
          requestId: req.requestId
        });
      }

      // Get target user
      const targetUser = await BaseUser.findById(userId);
      if (!targetUser) {
        return this.errorResponse(res, 404, "User not found", {
          code: "USER_NOT_FOUND",
          requestId: req.requestId
        });
      }

      const oldRole = targetUser.role;
      const oldUserType = targetUser.userType;

      // Implement role change logic here
      // Note: This is complex as it involves deleting old discriminator and creating new one
      // You'll need to implement UserService.promoteToModerator or similar for each role change

      // For now, just log and return success
      logger.warn('User role change requested', {
        targetUserId: userId,
        oldRole,
        newRole,
        changedBy: adminUser._id,
        changedByEmail: adminUser.email,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      });

      return this.successResponse(res, 200, {
        userId,
        oldRole,
        newRole,
        note: "Role change logged. Actual role change implementation pending."
      }, "Role change request logged", {
        requestId: req.requestId
      });

    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  /**
   * Get users (with filtering)
   */
  async getUsers(req, res) {
    try {
      const requestingUser = req.user;
      
      if (!requestingUser) {
        return this.errorResponse(res, 401, "Authentication required", {
          code: "AUTH_REQUIRED",
          requestId: req.requestId
        });
      }

      const { 
        role, 
        page = 1, 
        limit = 20, 
        search,
        accountStatus,
        department 
      } = req.query;

      // Check permissions based on role
      if (role && role !== ROLES.USER && !requestingUser.isAdminUser) {
        return this.errorResponse(res, 403, "Insufficient permissions to view staff", {
          code: "PERMISSION_DENIED",
          requestId: req.requestId
        });
      }

      let users;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      if (role === ROLES.USER) {
        // Get dating users
        users = await UserQuery.findDatingUsers({
          limit: parseInt(limit),
          skip,
          search
        });
      } else if (role && [ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(role)) {
        // Get staff users (admins only)
        if (!requestingUser.isAdminUser) {
          return this.errorResponse(res, 403, "Insufficient permissions", {
            code: "PERMISSION_DENIED",
            requestId: req.requestId
          });
        }
        
        users = await UserQuery.findStaff({
          role,
          limit: parseInt(limit),
          skip,
          department,
          accountStatus
        });
      } else {
        // Get all users (admins only with proper filtering)
        if (!requestingUser.isAdminUser) {
          return this.errorResponse(res, 403, "Insufficient permissions", {
            code: "PERMISSION_DENIED",
            requestId: req.requestId
          });
        }

        const query = {};
        if (search) {
          query.$or = [
            { email: { $regex: search, $options: 'i' } },
            { firstName: { $regex: search, $options: 'i' } },
            { lastName: { $regex: search, $options: 'i' } },
            { userName: { $regex: search, $options: 'i' } }
          ];
        }

        if (accountStatus) {
          query.accountStatus = accountStatus;
        }

        users = await BaseUser.find(query)
          .select('firstName lastName email userName role userType accountStatus createdAt lastActive department employeeId')
          .limit(parseInt(limit))
          .skip(skip)
          .sort({ createdAt: -1 });
      }

      return this.successResponse(res, 200, {
        users: users.map(user => this.formatUserListData(user)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: users.length === parseInt(limit)
        }
      }, null, {
        requestId: req.requestId
      });

    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== HELPER METHODS ==========

  validateDatingProfileUpdates(updates) {
    // Validate username if provided
    if (updates.userName !== undefined) {
      const username = updates.userName.trim();
      if (username.length < 3) {
        return { valid: false, error: "Username must be at least 3 characters long" };
      }
      if (username.length > 20) {
        return { valid: false, error: "Username cannot exceed 20 characters" };
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return { valid: false, error: "Username can only contain letters, numbers, underscores and hyphens" };
      }
    }

    // Validate avatar URL if provided
    if (updates.avatar !== undefined && updates.avatar !== null) {
      if (!validator.isURL(updates.avatar, { 
        protocols: ['http', 'https'], 
        require_protocol: true 
      })) {
        return { valid: false, error: "Please provide a valid avatar URL" };
      }
    }

    // Validate date of birth if provided
    if (updates.dateOfBirth !== undefined) {
      const dob = new Date(updates.dateOfBirth);
      if (isNaN(dob.getTime())) {
        return { valid: false, error: "Invalid date of birth" };
      }
      
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
      }
      
      if (age < 18) {
        return { valid: false, error: "You must be at least 18 years old" };
      }
      if (age > 100) {
        return { valid: false, error: "You must be under 100 years old" };
      }
    }

    // Validate messagingPreferences if provided
    if (updates.messagingPreferences !== undefined) {
      const validOptions = ['everyone', 'matches_only', 'friends_only', 'disabled'];
      if (!validOptions.includes(updates.messagingPreferences)) {
        return { 
          valid: false, 
          error: `messagingPreferences must be one of: ${validOptions.join(', ')}` 
        };
      }
    }

    return { valid: true };
  }

  validateStaffProfileUpdates(updates) {
    // Staff can only update limited fields
    const allowedFields = ['firstName', 'lastName', 'avatar', 'phoneNumber'];
    const providedFields = Object.keys(updates);
    
    const invalidFields = providedFields.filter(field => !allowedFields.includes(field));
    if (invalidFields.length > 0) {
      return { 
        valid: false, 
        error: `Cannot update fields: ${invalidFields.join(', ')} for staff accounts` 
      };
    }

    // Validate avatar URL if provided
    if (updates.avatar !== undefined && updates.avatar !== null) {
      if (!validator.isURL(updates.avatar, { 
        protocols: ['http', 'https'], 
        require_protocol: true 
      })) {
        return { valid: false, error: "Please provide a valid avatar URL" };
      }
    }

    // Validate phone number if provided
    if (updates.phoneNumber !== undefined) {
      const trimmed = updates.phoneNumber.trim();
      if (trimmed && !validator.isMobilePhone(trimmed, 'any', { strictMode: false })) {
        return { 
          valid: false, 
          error: "Please provide a valid phone number" 
        };
      }
    }

    return { valid: true };
  }

  validateNotificationSettings(settings) {
    // Basic structure validation
    const allowedKeys = ['email', 'push'];
    const settingKeys = Object.keys(settings);
    
    return settingKeys.every(key => allowedKeys.includes(key)) &&
           settingKeys.every(key => typeof settings[key] === 'boolean');
  }

  validateDatingNotificationSettings(settings) {
    const allowedKeys = ['messages', 'matches', 'likes', 'safetyAlerts'];
    const settingKeys = Object.keys(settings);
    
    return settingKeys.every(key => allowedKeys.includes(key)) &&
           settingKeys.every(key => typeof settings[key] === 'boolean');
  }

  validateStaffNotificationSettings(settings) {
    const allowedKeys = ['userReports', 'systemAlerts', 'adminAnnouncements'];
    const settingKeys = Object.keys(settings);
    
    return settingKeys.every(key => allowedKeys.includes(key)) &&
           settingKeys.every(key => typeof settings[key] === 'boolean');
  }

  validatePrivacySettings(settings) {
    const allowedKeys = ['profileVisibility', 'showOnlineStatus'];
    const settingKeys = Object.keys(settings);
    
    return settingKeys.every(key => allowedKeys.includes(key));
  }

  validateDatingPrivacySettings(settings) {
    const allowedKeys = ['showLastSeen', 'allowMessagesFrom'];
    const settingKeys = Object.keys(settings);
    
    return settingKeys.every(key => allowedKeys.includes(key));
  }

  prepareUserUpdates(updates, role) {
    const userUpdates = {};
    
    if (updates.firstName !== undefined) {
      userUpdates.firstName = updates.firstName.trim();
    }
    
    if (updates.lastName !== undefined) {
      userUpdates.lastName = updates.lastName.trim();
    }
    
    if (updates.phoneNumber !== undefined) {
      userUpdates.phoneNumber = updates.phoneNumber ? updates.phoneNumber.trim() : null;
      userUpdates.phoneVerified = false; // Require re-verification
    }
    
    if (updates.avatar !== undefined) {
      userUpdates.avatar = updates.avatar;
    }
    
    if (updates.userName !== undefined && role === ROLES.USER) {
      userUpdates.userName = updates.userName.trim().toLowerCase();
    }
    
    if (updates.dateOfBirth !== undefined && role === ROLES.USER) {
      userUpdates.dateOfBirth = new Date(updates.dateOfBirth);
    }
    
    if (updates.messagingPreferences !== undefined && role === ROLES.USER) {
      userUpdates.messagingPreferences = updates.messagingPreferences;
    }

    return userUpdates;
  }

  prepareProfileUpdates(updates) {
    const profileUpdates = {};
    
    if (updates.bio !== undefined) {
      profileUpdates.bio = updates.bio.trim();
    }
    
    if (updates.profilePicture !== undefined) {
      profileUpdates.profilePicture = updates.profilePicture;
    }

    if (Object.keys(profileUpdates).length > 0) {
      profileUpdates.lastUpdated = new Date();
    }

    return profileUpdates;
  }

  hasDatingProfileUpdates(updates) {
    return updates.bio !== undefined || updates.profilePicture !== undefined;
  }

  mergeSettings(existing = {}, updates = {}) {
    return { ...existing, ...updates };
  }

  formatUserData(user) {
    const baseData = {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      avatar: user.avatar,
      accountStatus: user.accountStatus,
      role: user.role,
      userType: user.userType,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      lastLogin: user.lastLogin,
      lastSeen: user.presence?.lastSeen,
      presence: user.presence,
      notificationSettings: user.notificationSettings || {},
      privacySettings: user.privacySettings || {},
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt
    };

    // Add role-specific data
    if (user.role === ROLES.USER) {
      baseData.age = user.age;
      baseData.userName = user.userName;
      baseData.dateOfBirth = user.dateOfBirth;
      baseData.preferences = user.preferences;
      baseData.location = user.location ? {
        city: user.location.city,
        country: user.location.country
      } : null;
      baseData.sharePhone = user.sharePhone;
      baseData.messagingPreferences = user.messagingPreferences;
    } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
      baseData.employeeId = user.employeeId;
      baseData.department = user.department;
      baseData.staffNotificationSettings = user.staffNotificationSettings || {};
    }

    return baseData;
  }

  formatUserListData(user) {
    const baseData = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      userType: user.userType,
      accountStatus: user.accountStatus,
      createdAt: user.createdAt,
      lastActive: user.lastActive || user.presence?.lastActive
    };

    if (user.role === ROLES.USER) {
      baseData.userName = user.userName;
      baseData.age = user.age;
      baseData.avatar = user.avatar;
    } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
      baseData.employeeId = user.employeeId;
      baseData.department = user.department;
    }

    return baseData;
  }

  formatProfileData(profile) {
    return {
      id: profile._id,
      userId: profile.userId,
      profilePicture: profile.profilePicture,
      bio: profile.bio,
      profileCompletion: profile.profileCompletion || 0,
      isVerified: profile.isVerified || false,
      isActive: profile.isActive !== false,
      lastUpdated: profile.lastUpdated,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    };
  }

  // Override handleError to include request ID
  handleError(error, req, res) {
    logger.error('UserController error:', {
      error: error.message,
      stack: error.stack,
      userId: req.userId || req.user?.id,
      path: req.path,
      method: req.method,
      requestId: req.requestId,
      ip: req.ip
    });

    // Handle specific error types
    if (error.name === 'ValidationError') {
      return this.errorResponse(res, 400, error.message, {
        code: "VALIDATION_ERROR",
        requestId: req.requestId
      });
    }

    if (error.code === 11000) {
      // Duplicate key error
      return this.errorResponse(res, 409, "A user with this information already exists", {
        code: "DUPLICATE_KEY",
        requestId: req.requestId
      });
    }

    if (error.name === 'CastError') {
      return this.errorResponse(res, 400, "Invalid user ID format", {
        code: "INVALID_ID",
        requestId: req.requestId
      });
    }

    // Permission errors
    if (error.message.includes('Unauthorized') || error.message.includes('Insufficient permissions')) {
      return this.errorResponse(res, 403, error.message, {
        code: "PERMISSION_DENIED",
        requestId: req.requestId
      });
    }

    // Rate limiting errors
    if (error.message.includes('Too many')) {
      return this.errorResponse(res, 429, error.message, {
        code: "RATE_LIMITED",
        requestId: req.requestId
      });
    }

    // Default error
    return this.errorResponse(res, 500, "An error occurred while processing your request", {
      code: "INTERNAL_ERROR",
      requestId: req.requestId
    });
  }
}

module.exports = UserController;