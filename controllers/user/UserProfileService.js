const validator = require('validator');
const logger = require('@utils/logger');
const { 
  BaseUser, 
  DatingUser, 
  Moderator, 
  Admin, 
  SuperAdmin,
  UserService,
  ROLES 
} = require('@models/User');
const Profile = require('@models/Profile.model');
const UserValidationService = require('./UserValidationService');
const UserFormatterService = require('./UserFormatterService');

class UserProfileService {
  constructor(rateLimitService) {
    this.rateLimitService = rateLimitService;
    this.validationService = new UserValidationService();
    this.formatterService = new UserFormatterService();
  }

  async getMe(req, res, controller) {
    const userId = req.userId || req.user?.id;
    
    if (!userId) {
      return controller.errorResponse(res, 401, "Authentication required", {
        code: "AUTH_REQUIRED"
      });
    }

    const userWithProfile = await UserService.getProfile(userId, req.user);
    return controller.successResponse(res, 200, userWithProfile);
  }

  async getUserById(req, res, controller) {
    const { id } = req.params;
    const requestingUser = req.user;

    if (!requestingUser) {
      return controller.errorResponse(res, 401, "Authentication required", {
        code: "AUTH_REQUIRED",
        requestId: req.requestId
      });
    }

    const userWithProfile = await UserService.getProfile(id, requestingUser);
    return controller.successResponse(res, 200, userWithProfile);
  }

  async updatePrivateInfo(req, res, controller) {
    const { firstName, lastName, phoneNumber } = req.body;
    const userId = req.userId || req.user?.id;

    if (!userId) {
      return controller.errorResponse(res, 401, "Authentication required", {
        code: "AUTH_REQUIRED",
        requestId: req.requestId
      });
    }

    // Rate limiting check
    const canProceed = await this.rateLimitService.checkRateLimit(
      userId, 
      'updatePrivateInfo'
    );
    
    if (!canProceed) {
      return controller.errorResponse(res, 429, 
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
        return controller.errorResponse(res, 400, "First name cannot be empty", {
          code: "INVALID_FIRST_NAME",
          requestId: req.requestId
        });
      }
      if (trimmed.length > 50) {
        return controller.errorResponse(res, 400, "First name cannot exceed 50 characters", {
          code: "INVALID_FIRST_NAME",
          requestId: req.requestId
        });
      }
      updateData.firstName = trimmed;
    }
    
    if (lastName !== undefined) {
      const trimmed = lastName.trim();
      if (trimmed.length < 1) {
        return controller.errorResponse(res, 400, "Last name cannot be empty", {
          code: "INVALID_LAST_NAME",
          requestId: req.requestId
        });
      }
      if (trimmed.length > 50) {
        return controller.errorResponse(res, 400, "Last name cannot exceed 50 characters", {
          code: "INVALID_LAST_NAME",
          requestId: req.requestId
        });
      }
      updateData.lastName = trimmed;
    }
    
    if (phoneNumber !== undefined) {
      const trimmed = phoneNumber.trim();
      if (trimmed && !validator.isMobilePhone(trimmed, 'any', { strictMode: false })) {
        return controller.errorResponse(res, 400, "Please provide a valid phone number", {
          code: "INVALID_PHONE",
          requestId: req.requestId
        });
      }
      updateData.phoneNumber = trimmed || null;
      updateData.phoneVerified = false;
      
      if (req.user?.role === ROLES.USER) {
        updateData.sharePhone = "hidden";
      }
    }

    if (Object.keys(updateData).length === 0) {
      return controller.errorResponse(res, 400, "No data provided to update", {
        code: "NO_UPDATES",
        requestId: req.requestId
      });
    }

    // Check permissions - users can only update themselves
    if (userId !== req.user?._id?.toString()) {
      return controller.errorResponse(res, 403, "Can only update your own information", {
        code: "PERMISSION_DENIED",
        requestId: req.requestId
      });
    }

    // Get current user to check phone changes
    const currentUser = await BaseUser.findById(userId);
    if (!currentUser) {
      return controller.errorResponse(res, 404, "User not found", {
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
      return controller.errorResponse(res, 404, "User not found", {
        code: "USER_NOT_FOUND",
        requestId: req.requestId
      });
    }

    // Send phone verification if phone changed
    if (updateData.phoneNumber && currentUser.phoneNumber !== updateData.phoneNumber) {
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
    await this.rateLimitService.incrementRateLimit(userId, 'updatePrivateInfo');

    logger.info('User private info updated', {
      userId: userId.toString(),
      userType: user.userType,
      role: user.role,
      updatedFields: Object.keys(updateData),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId
    });

    return controller.successResponse(res, 200, {
      user: this.formatterService.formatUserData(user)
    }, "Personal information updated successfully");
  }

  async updateEmail(req, res, controller) {
    const { newEmail, password } = req.body;
    const userId = req.userId || req.user?.id;

    if (!userId) {
      return controller.errorResponse(res, 401, "Authentication required", {
        code: "AUTH_REQUIRED",
        requestId: req.requestId
      });
    }

    // Rate limiting check
    const canProceed = await this.rateLimitService.checkRateLimit(
      userId, 
      'updateEmail'
    );
    
    if (!canProceed) {
      return controller.errorResponse(res, 429, 
        "Too many email update attempts. Please try again later.",
        {
          code: "RATE_LIMITED",
          requestId: req.requestId
        }
      );
    }

    if (!newEmail || !password) {
      return controller.errorResponse(res, 400, 
        "New email and password are required",
        {
          code: "MISSING_FIELDS",
          requestId: req.requestId
        }
      );
    }

    // Validate email
    if (!validator.isEmail(newEmail)) {
      return controller.errorResponse(res, 400, "Please provide a valid email address", {
        code: "INVALID_EMAIL",
        requestId: req.requestId
      });
    }

    // Verify password
    const user = await BaseUser.findById(userId).select('+password');
    if (!user) {
      return controller.errorResponse(res, 404, "User not found", {
        code: "USER_NOT_FOUND",
        requestId: req.requestId
      });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return controller.errorResponse(res, 401, "Password is incorrect", {
        code: "INVALID_PASSWORD",
        requestId: req.requestId
      });
    }

    // Check if email already exists
    const existingUser = await BaseUser.findOne({ email: newEmail.toLowerCase() });
    if (existingUser) {
      return controller.errorResponse(res, 409, "Email already in use", {
        code: "EMAIL_EXISTS",
        requestId: req.requestId
      });
    }

    // Check if user is trying to update to same email
    if (user.email.toLowerCase() === newEmail.toLowerCase()) {
      return controller.errorResponse(res, 400, "This is already your current email", {
        code: "SAME_EMAIL",
        requestId: req.requestId
      });
    }

    // Update email (but don't verify until confirmation)
    user.email = newEmail.toLowerCase();
    user.emailVerified = false;
    await user.save();

    // Increment rate limit counter
    await this.rateLimitService.incrementRateLimit(userId, 'updateEmail');

    logger.info('User email updated', {
      userId: userId.toString(),
      userType: user.userType,
      role: user.role,
      oldEmail: user.email,
      newEmail: newEmail.toLowerCase(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId
    });

    return controller.successResponse(res, 200, null, 
      "Email updated successfully. Please check your new email for verification instructions.",
      {
        requestId: req.requestId
      }
    );
  }

  async updateProfile(req, res, controller) {
    const updates = req.body;
    const userId = req.userId || req.user?.id;
    
    if (!userId) {
      return controller.errorResponse(res, 401, "Authentication required", {
        code: "AUTH_REQUIRED",
        requestId: req.requestId
      });
    }

    // Check permissions - users can only update themselves
    if (userId !== req.user?._id?.toString()) {
      return controller.errorResponse(res, 403, "Can only update your own profile", {
        code: "PERMISSION_DENIED",
        requestId: req.requestId
      });
    }

    // Get user to check type
    const user = await BaseUser.findById(userId);
    if (!user) {
      return controller.errorResponse(res, 404, "User not found", {
        code: "USER_NOT_FOUND",
        requestId: req.requestId
      });
    }

    // Different validation based on user type
    let validation;
    if (user.role === ROLES.USER) {
      validation = this.validationService.validateDatingProfileUpdates(updates);
    } else {
      validation = this.validationService.validateStaffProfileUpdates(updates);
    }
    
    if (!validation.valid) {
      return controller.errorResponse(res, 400, validation.error, {
        code: "VALIDATION_ERROR",
        requestId: req.requestId
      });
    }

    // Check username uniqueness if being updated (for dating users only)
    if (updates.userName && user.role === ROLES.USER) {
      const existingUser = await BaseUser.findOne({ 
        userName: updates.userName.trim().toLowerCase(),
        _id: { $ne: userId }
      });
      
      if (existingUser) {
        return controller.errorResponse(res, 409, "Username is already taken", {
          code: "USERNAME_TAKEN",
          requestId: req.requestId
        });
      }
    }

    // Update user with role-specific logic
    const userUpdates = this.validationService.prepareUserUpdates(updates, user.role);
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
        return controller.errorResponse(res, 404, "User not found", {
          code: "USER_NOT_FOUND",
          requestId: req.requestId
        });
      }
    } else {
      updatedUser = user;
    }

    // Update profile only for dating users
    let profile = null;
    if (user.role === ROLES.USER && this.validationService.hasDatingProfileUpdates(updates)) {
      const profileUpdates = this.validationService.prepareProfileUpdates(updates);
      
      profile = await Profile.findOneAndUpdate(
        { userId: userId },
        profileUpdates,
        { 
          new: true, 
          upsert: true,
          runValidators: true
        }
      );
    } else if (user.role === ROLES.USER) {
      // Get current profile
      profile = await Profile.findOne({ userId: userId });
    }

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
      user: this.formatterService.formatUserData(updatedUser)
    };

    // Only include profile for dating users
    if (user.role === ROLES.USER) {
      responseData.profile = profile ? this.formatterService.formatProfileData(profile) : null;
    }

    return controller.successResponse(res, 200, responseData, "Profile updated successfully");
  }

  async deleteAccount(req, res, controller) {
    const { password, confirmation } = req.body;
    const userId = req.userId || req.user?.id;
    
    if (!userId) {
      return controller.errorResponse(res, 401, "Authentication required", {
        code: "AUTH_REQUIRED",
        requestId: req.requestId
      });
    }

    // Rate limiting check
    const canProceed = await this.rateLimitService.checkRateLimit(
      userId, 
      'deleteAccount'
    );
    
    if (!canProceed) {
      return controller.errorResponse(res, 429, 
        "Too many deletion attempts. Please try again later.",
        {
          code: "RATE_LIMITED",
          requestId: req.requestId
        }
      );
    }

    // Check permissions - users can only delete themselves
    if (userId !== req.user?._id?.toString()) {
      return controller.errorResponse(res, 403, "Can only delete your own account", {
        code: "PERMISSION_DENIED",
        requestId: req.requestId
      });
    }

    if (!password) {
      return controller.errorResponse(res, 400, "Password is required to delete account", {
        code: "PASSWORD_REQUIRED",
        requestId: req.requestId
      });
    }

    if (confirmation !== 'DELETE') {
      return controller.errorResponse(res, 400, 
        "Please type 'DELETE' to confirm account deletion",
        {
          code: "CONFIRMATION_REQUIRED",
          requestId: req.requestId
        }
      );
    }

    const user = await BaseUser.findById(userId).select('+password');
    if (!user) {
      return controller.errorResponse(res, 404, "User not found", {
        code: "USER_NOT_FOUND",
        requestId: req.requestId
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      // Increment rate limit counter for failed attempts
      await this.rateLimitService.incrementRateLimit(userId, 'deleteAccount');
      
      return controller.errorResponse(res, 401, "Password is incorrect", {
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
    await this.rateLimitService.incrementRateLimit(userId, 'deleteAccount');

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

    return controller.successResponse(res, 200, {
      deletionId,
      deletedAt: new Date().toISOString(),
      note: "Your account has been deleted. All personal data has been anonymized."
    }, "Account deleted successfully", {
      requestId: req.requestId
    });
  }
}

module.exports = UserProfileService;