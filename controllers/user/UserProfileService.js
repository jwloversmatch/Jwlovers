// services/UserProfileService.js - FIXED VERSION
const { BaseUser, DatingUser } = require('@models/User'); // FIXED IMPORT
const Profile = require('@models/Profile/Profile.model'); 
const logger = require('@utils/logger');

class UserProfileService {
  constructor(rateLimitService) {
    this.rateLimitService = rateLimitService;
  }

  async getMe(req, res, controller) {
    try {
      const userId = req.userId || req.user?.id;
      
      if (!userId) {
        return controller.errorResponse(res, 401, 'Not authenticated', {
          code: 'AUTH_REQUIRED'
        });
      }

      // Get base user
      const user = await BaseUser.findById(userId)
        .select('-password -refreshToken -passwordHistory -__v');

      if (!user) {
        return controller.errorResponse(res, 404, 'User not found', {
          code: 'USER_NOT_FOUND'
        });
      }

      // Get profile and dating data
      const [profile, datingUser] = await Promise.all([
        Profile.findOne({ userId }),
        DatingUser.findById(userId).populate('profile')
      ]);

      // Build response
      const responseData = {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phoneNumber: user.phoneNumber,
          phoneVerified: user.phoneVerified,
          accountStatus: user.accountStatus,
          role: user.role,
          userType: user.userType,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        },
        profile: profile ? {
          id: profile._id,
          userName: profile.userName,
          profileCompletion: profile.profileCompletion,
          hasProfile: true
        } : {
          hasProfile: false,
          message: 'No profile found. Create one at /api/auth/profile'
        },
        dating: datingUser ? {
          hasDatingProfile: true,
          isPremium: datingUser.isPremium,
          ageVerified: datingUser.ageVerified
        } : null
      };

      return controller.successResponse(res, 200, responseData, 'User retrieved successfully');
    } catch (error) {
      // Check if it's the DatingUser model error
      if (error.message.includes('DatingUser.findById is not a function')) {
        logger.error('DatingUser model import error:', {
          error: error.message,
          userId: req.userId || req.user?.id,
          suggestion: 'Check that DatingUser is properly exported from @models/User'
        });
        
        // Return partial data without dating profile
        const user = await BaseUser.findById(req.userId || req.user?.id)
          .select('-password -refreshToken -passwordHistory -__v');
        
        const profile = await Profile.findOne({ userId: req.userId || req.user?.id });
        
        return controller.successResponse(res, 200, {
          user: {
            id: user._id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            userType: user.userType,
            emailVerified: user.emailVerified,
            createdAt: user.createdAt
          },
          profile: profile ? {
            id: profile._id,
            userName: profile.userName,
            profileCompletion: profile.profileCompletion,
            hasProfile: true
          } : {
            hasProfile: false
          },
          dating: null,
          warning: 'Dating profile data temporarily unavailable'
        }, 'User retrieved with partial data');
      }
      
      throw error;
    }
  }

  async getUserById(req, res, controller) {
    try {
      const { id } = req.params;
      const requestingUserId = req.userId || req.user?.id;

      // Validate ID format
      if (!/^[0-9a-fA-F]{24}$/.test(id)) {
        return controller.errorResponse(res, 400, 'Invalid user ID format', {
          code: 'INVALID_ID'
        });
      }

      // Check rate limit for profile viewing
      const rateLimitCheck = await this.rateLimitService.checkProfileViewLimit(requestingUserId);
      if (!rateLimitCheck.allowed) {
        return controller.errorResponse(res, 429, rateLimitCheck.message, {
          code: 'RATE_LIMITED',
          retryAfter: rateLimitCheck.retryAfter
        });
      }

      // Get base user
      const user = await BaseUser.findById(id)
        .select('-password -refreshToken -passwordHistory -__v');

      if (!user) {
        return controller.errorResponse(res, 404, 'User not found', {
          code: 'USER_NOT_FOUND'
        });
      }

      // Get profile
      const profile = await Profile.findOne({ userId: id });

      if (!profile) {
        return controller.errorResponse(res, 404, 'Profile not found', {
          code: 'PROFILE_NOT_FOUND'
        });
      }

      // Check privacy settings - handle DatingUser model gracefully
      let datingUser = null;
      try {
        datingUser = await DatingUser.findById(id);
      } catch (datingError) {
        logger.warn('Could not fetch DatingUser:', {
          userId: id,
          error: datingError.message
        });
        // Continue without dating user data
      }

      const isOwner = requestingUserId === id;

      if (!isOwner && datingUser) {
        // Check if dating profile is visible
        if (profile.datingProfile?.isVisible === false) {
          return controller.errorResponse(res, 403, 'Profile is not visible', {
            code: 'PROFILE_PRIVATE'
          });
        }

        // Check if profile is paused
        if (profile.datingProfile?.isPaused === true) {
          return controller.errorResponse(res, 403, 'Profile is currently paused', {
            code: 'PROFILE_PAUSED'
          });
        }
      }

      // Increment profile views if not owner
      if (!isOwner) {
        await Profile.findByIdAndUpdate(profile._id, {
          $inc: { profileViews: 1 }
        });
      }

      // Prepare response based on relationship
      const responseData = this.prepareUserResponse(user, profile, datingUser, isOwner);

      return controller.successResponse(res, 200, responseData, 'User retrieved successfully');
    } catch (error) {
      throw error;
    }
  }

  async updatePrivateInfo(req, res, controller) {
    try {
      const userId = req.userId || req.user?.id;
      const { firstName, lastName, phoneNumber } = req.body;

      if (!userId) {
        return controller.errorResponse(res, 401, 'Not authenticated', {
          code: 'AUTH_REQUIRED'
        });
      }

      // Check rate limit for profile updates
      const rateLimitCheck = await this.rateLimitService.checkProfileUpdateLimit(userId);
      if (!rateLimitCheck.allowed) {
        return controller.errorResponse(res, 429, rateLimitCheck.message, {
          code: 'RATE_LIMITED',
          retryAfter: rateLimitCheck.retryAfter
        });
      }

      const updateData = {};
      if (firstName) updateData.firstName = firstName;
      if (lastName) updateData.lastName = lastName;
      if (phoneNumber) updateData.phoneNumber = phoneNumber;

      if (Object.keys(updateData).length === 0) {
        return controller.errorResponse(res, 400, 'No valid fields to update', {
          code: 'NO_UPDATES'
        });
      }

      const updatedUser = await BaseUser.findByIdAndUpdate(
        userId,
        updateData,
        { new: true, runValidators: true }
      ).select('-password -refreshToken -passwordHistory -__v');

      if (!updatedUser) {
        return controller.errorResponse(res, 404, 'User not found', {
          code: 'USER_NOT_FOUND'
        });
      }

      return controller.successResponse(res, 200, {
        user: {
          id: updatedUser._id,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          phoneNumber: updatedUser.phoneNumber,
          updatedAt: updatedUser.updatedAt
        }
      }, 'Private information updated successfully');
    } catch (error) {
      throw error;
    }
  }

  async updateEmail(req, res, controller) {
    try {
      const userId = req.userId || req.user?.id;
      const { newEmail, password } = req.body;

      if (!userId) {
        return controller.errorResponse(res, 401, 'Not authenticated', {
          code: 'AUTH_REQUIRED'
        });
      }

      if (!newEmail || !password) {
        return controller.errorResponse(res, 400, 'New email and password are required', {
          code: 'MISSING_FIELDS'
        });
      }

      // Check rate limit for email updates
      const rateLimitCheck = await this.rateLimitService.checkEmailUpdateLimit(userId);
      if (!rateLimitCheck.allowed) {
        return controller.errorResponse(res, 429, rateLimitCheck.message, {
          code: 'RATE_LIMITED',
          retryAfter: rateLimitCheck.retryAfter
        });
      }

      const user = await BaseUser.findById(userId).select('+password');

      if (!user) {
        return controller.errorResponse(res, 404, 'User not found', {
          code: 'USER_NOT_FOUND'
        });
      }

      // Verify password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return controller.errorResponse(res, 401, 'Invalid password', {
          code: 'INVALID_PASSWORD'
        });
      }

      // Check if email is already in use
      const existingUser = await BaseUser.findOne({ email: newEmail.toLowerCase() });
      if (existingUser && existingUser._id.toString() !== userId) {
        return controller.errorResponse(res, 409, 'Email already in use', {
          code: 'EMAIL_EXISTS'
        });
      }

      // Update email
      user.email = newEmail.toLowerCase();
      user.emailVerified = false; // Reset verification
      await user.save();

      // TODO: Send verification email to new email

      return controller.successResponse(res, 200, {
        email: user.email,
        emailVerified: user.emailVerified,
        updatedAt: user.updatedAt,
        requiresVerification: true
      }, 'Email updated successfully. Please verify your new email.');
    } catch (error) {
      throw error;
    }
  }

async deleteAccount(req, res, controller) {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return controller.errorResponse(res, 401, "User not authenticated");
    }
    
    const { password } = req.body || {};
    
    if (!password) {
      return controller.errorResponse(res, 400, "Password is required for account deletion");
    }
    
    const { BaseUser } = require('@models/User');
    
    // IMPORTANT: Select password field explicitly
    const user = await BaseUser.findById(userId).select('+password +email +accountStatus');
    
    if (!user) {
      return controller.errorResponse(res, 404, "User not found");
    }
    
    // Debug logging
    console.log('🔍 Password verification:', {
      userId: user._id,
      hasPassword: !!user.password,
      passwordLength: user.password?.length,
      email: user.email
    });
    
    // Verify password
    try {
      const isPasswordValid = await user.comparePassword(password);
      
      if (!isPasswordValid) {
        return controller.errorResponse(res, 401, "Incorrect password");
      }
    } catch (passwordError) {
      console.error('❌ Password comparison error:', passwordError.message);
      
      // If password comparison fails, check if user has password at all
      if (!user.password) {
        return controller.errorResponse(res, 400, 
          "Account security issue: No password found. Please contact support."
        );
      }
      
      return controller.errorResponse(res, 500, 
        "Password verification failed. Please try again or contact support."
      );
    }
    
    // Soft delete the account
    user.accountStatus = 'deactivated';
    user.deactivatedAt = new Date();
    user.deactivatedBy = userId;
    
    await user.save();
    
    // Log the deletion
    console.log('✅ Account deactivated:', {
      userId: user._id,
      email: user.email,
      timestamp: new Date().toISOString()
    });
    
    return controller.successResponse(res, 200, {
      message: "Account deactivated successfully",
      note: "Your data will be permanently deleted after 30 days",
      contactSupport: "support@jwlovers.com to reactivate account",
      userEmail: user.email
    }, "Account deactivated");
  } catch (error) {
    console.error('❌ Delete account error:', error);
    return controller.handleError(error, req, res);
  }
}

  // Helper methods
  prepareUserResponse(user, profile, datingUser, isOwner) {
    const baseResponse = {
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        accountStatus: user.accountStatus,
        role: user.role,
        userType: user.userType,
        createdAt: user.createdAt
      },
      profile: {
        id: profile._id,
        userName: profile.userName,
        bio: profile.bio,
        profilePicture: profile.profilePicture,
        age: this.calculateAge(profile.dateOfBirth), // Calculate age
        gender: profile.gender,
        profileCompletion: profile.profileCompletion,
        location: profile.location ? {
          city: profile.location.city,
          country: profile.location.country
        } : null
      }
    };

    // Add owner-specific data
    if (isOwner) {
      baseResponse.user.email = user.email;
      baseResponse.user.phoneNumber = user.phoneNumber;
      baseResponse.user.emailVerified = user.emailVerified;
      baseResponse.user.phoneVerified = user.phoneVerified;
      
      if (datingUser) {
        baseResponse.dating = {
          isPremium: datingUser.isPremium,
          ageVerified: datingUser.ageVerified,
          hasCompleteProfile: datingUser.hasCompleteDatingProfile
        };
      }
    } else {
      // Public view
      if (datingUser) {
        const privacySettings = datingUser.datingPrivacySettings || {};
        
        baseResponse.dating = {
          isPremium: datingUser.isPremium,
          preferences: {
            lookingFor: profile.lookingFor
          }
        };

        // Apply privacy settings
        if (privacySettings.showAge === false) {
          baseResponse.profile.age = null;
        }
        if (privacySettings.showDistance === false) {
          if (baseResponse.profile.location) {
            baseResponse.profile.location.distance = null;
          }
        }
      }
    }

    return baseResponse;
  }

  // Calculate age from date of birth
  calculateAge(dateOfBirth) {
    if (!dateOfBirth) return null;
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  }
}

module.exports = UserProfileService;