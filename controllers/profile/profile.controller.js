// controllers/ProfileController.js - FIXED VERSION
const Profile = require("@models/Profile.model"); 
const { BaseUser, DatingUser } = require("@models/User"); 
const optionService = require("@services/option.service");
const logger = require("@utils/logger");
const { v4: uuidv4 } = require("uuid");

// ========== CONSTANTS & CONFIG ==========
const CONFIG = {
  MAX_PHOTOS: 9,
  MAX_BIO_LENGTH: 500,
  MAX_CAPTION_LENGTH: 100,
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 30,
};

// ========== HELPER FUNCTIONS ==========
const createError = (message, code = "PROFILE_ERROR", statusCode = 400) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const handleControllerError = (error, req, res) => {
  const requestId = req.requestId || uuidv4();
  
  logger.error("Profile controller error:", {
    requestId,
    userId: req.user?.id || "anonymous",
    endpoint: req.path,
    error: error.message,
    code: error.code,
    statusCode: error.statusCode,
  });

  const response = {
    success: false,
    error: error.message,
    code: error.code || "INTERNAL_ERROR",
    requestId,
    timestamp: new Date().toISOString(),
  };

  if (process.env.NODE_ENV === "production" && error.statusCode === 500) {
    response.error = "Internal server error";
  }

  res.status(error.statusCode || 500).json(response);
};

// Calculate age from date of birth
const calculateAge = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
};

// ========== PROFILE CONTROLLER ==========
class ProfileController {
  constructor() {
    // All methods are arrow functions or properly bound
  }

  // ========== PUBLIC METHODS ==========
  getCompleteProfile = async (req, res) => {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        throw createError("User ID required", "USER_ID_REQUIRED", 401);
      }

      // Get base user
      const user = await BaseUser.findById(userId);
      
      if (!user) {
        throw createError("User not found", "USER_NOT_FOUND", 404);
      }

      // Get profile
      const profile = await Profile.findOne({ userId });

      if (!profile) {
        // Return empty profile structure if not found
        return res.json({
          success: true,
          data: {
            privateInfo: {
              firstName: user.firstName,
              lastName: user.lastName,
              email: {
                address: user.email,
                verified: user.emailVerified,
              },
              phoneNumber: {
                number: user.phoneNumber,
                verified: user.phoneVerified,
              },
              lastLogin: user.lastLogin,
            },
            publicProfile: {
              userId: user._id,
              userName: null,
              profileCompletion: 0,
              hasProfile: false,
              message: "No profile found. Create one at /api/auth/profile"
            }
          },
          timestamp: new Date().toISOString(),
        });
      }

      // Get dating user if exists
      const datingUser = await DatingUser.findById(userId);

      // Get dynamic option labels for the profile
      const [labels, verificationBadgesWithLabels] = await Promise.all([
        this.getAllLabels(profile), // FIXED: Use controller method
        this.getVerificationBadgesWithLabels(profile.verificationBadges),
      ]);

      const profileWithLabels = {
        ...profile.toObject(),
        age: calculateAge(profile.dateOfBirth), // FIXED: Calculate age
        isVerified: this.checkIsVerified(profile), // FIXED: Check verification
        ...labels,
        verificationBadgesWithLabels,
      };

      res.json({
        success: true,
        data: {
          // Private info (only for owner)
          privateInfo: {
            firstName: user.firstName,
            lastName: user.lastName,
            email: {
              address: user.email,
              verified: user.emailVerified,
            },
            phoneNumber: {
              number: user.phoneNumber,
              verified: user.phoneVerified,
            },
            lastLogin: user.lastLogin,
          },
          // Public profile with labels
          publicProfile: profileWithLabels,
          // Dating-specific info if exists
          datingInfo: datingUser ? {
            isPremium: datingUser.isPremium,
            ageVerified: datingUser.ageVerified,
            hasDatingProfile: true
          } : null
        },
        meta: {
          profileCompletion: profile.profileCompletion || 0,
          lastUpdated: profile.updatedAt,
          hasDatingProfile: !!datingUser,
          requestId: req.requestId,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };

  getPublicProfile = async (req, res) => {
    try {
      const { userId } = req.params;
      const viewerId = req.user?.id;

      // Validate userId format
      if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
        throw createError("Invalid user ID format", "INVALID_USER_ID", 400);
      }

      // Get base user
      const user = await BaseUser.findById(userId);
      
      if (!user) {
        throw createError("User not found", "USER_NOT_FOUND", 404);
      }

      // Get profile
      const profile = await Profile.findOne({ userId });

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      // Get dating user if exists
      const datingUser = await DatingUser.findById(userId);

      // Check dating profile visibility
      if (datingUser && profile.datingProfile?.isVisible === false) {
        throw createError("Profile is not visible", "PROFILE_PRIVATE", 403);
      }

      // Increment profile views (async)
      this.incrementProfileViews(profile._id).catch((err) =>
        logger.error("Failed to increment profile views:", err)
      );

      // Get labels for display
      const [labels, verificationBadgesWithLabels] = await Promise.all([
        this.getAllLabels(profile),
        this.getVerificationBadgesWithLabels(profile.verificationBadges),
      ]);

      // Get dating privacy settings
      const datingPrivacySettings = datingUser?.datingPrivacySettings || {};
      
      // Calculate age
      const age = calculateAge(profile.dateOfBirth);
      
      // FIXED: Proper null check for showAge
      const showAge = datingPrivacySettings.showAge !== undefined 
        ? datingPrivacySettings.showAge 
        : true; // Default to true if not set
      
      // Construct response with public data
      const publicProfile = {
        basicInfo: {
          userId: user._id,
          userName: profile.userName,
          profilePicture: profile.profilePicture,
          bio: profile.bio,
          age: showAge ? age : null, // FIXED: Proper condition
          gender: profile.gender,
          genderLabel: labels.genderLabel,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        location: {
          city: profile.location?.city,
          country: profile.location?.country,
          distance: datingPrivacySettings.showDistance !== false ? 
            this.calculateDistance(viewerId, userId, profile) : null
        },
        background: {
          countryOfOrigin: profile.countryOfOrigin,
          homeLanguage: profile.homeLanguage,
          religion: profile.religion,
          religionLabel: labels.religionLabel,
          education: profile.education,
          educationLabel: labels.educationLabel,
          occupation: profile.occupation,
          income: profile.income,
          incomeLabel: labels.incomeLabel,
        },
        lifestyle: {
          servingAs: profile.servingAs,
          servingAsLabel: labels.servingAsLabel,
          relationshipStatus: profile.relationshipStatus,
          relationshipStatusLabel: labels.relationshipStatusLabel,
          haveChildren: profile.haveChildren,
          haveChildrenLabel: labels.haveChildrenLabel,
          wantsChildren: profile.wantsChildren,
          wantsChildrenLabel: labels.wantsChildrenLabel,
          hobbies: profile.hobbies || [],
          languages: profile.languages || [],
        },
        photos: profile.photos?.map((photo) => ({
          url: photo.url,
          caption: photo.caption,
          order: photo.order,
        })) || [],
        preferences: {
          lookingFor: profile.lookingFor,
          lookingForLabel: labels.lookingForLabel,
        },
        verification: {
          isVerified: this.checkIsVerified(profile),
          badges: verificationBadgesWithLabels,
        },
        stats: {
          profileCompletion: profile.profileCompletion || 0,
          lastActive: this.getLastActive(datingUser, datingPrivacySettings, viewerId, userId),
        },
        // Dating-specific info
        datingInfo: datingUser ? {
          isPremium: datingUser.isPremium,
          isVerified: datingUser.ageVerified,
          preferences: {
            lookingFor: profile.lookingFor
          }
        } : null
      };

      res.json({
        success: true,
        data: publicProfile,
        meta: {
          isOwner: viewerId === userId,
          isDatingProfile: !!datingUser,
          requestId: req.requestId,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };

  createProfile = async (req, res) => {
    try {
      const userId = req.user?.id;
      const profileData = req.body;

      if (!userId) {
        throw createError("User ID required", "USER_ID_REQUIRED", 401);
      }

      // Check if user exists
      const user = await BaseUser.findById(userId);
      
      if (!user) {
        throw createError("User not found", "USER_NOT_FOUND", 404);
      }

      // Check if profile already exists
      const existingProfile = await Profile.findOne({ userId });
      if (existingProfile) {
        throw createError(
          "Profile already exists for this user",
          "PROFILE_EXISTS",
          409
        );
      }

      // Check userName availability
      if (profileData.userName) {
        const userNameTaken = await Profile.findOne({
          userName: { $regex: new RegExp(`^${profileData.userName}$`, "i") },
        });

        if (userNameTaken) {
          throw createError("Username already taken", "USERNAME_TAKEN", 409);
        }
      }

      // Apply middleware logic before creating
      const profileToCreate = this.applyProfileMiddleware({
        userId,
        ...profileData,
        userName: profileData.userName?.toLowerCase(),
        // Set default location if coordinates provided
        location: profileData.location && profileData.location.coordinates ? {
          type: 'Point',
          coordinates: profileData.location.coordinates,
          city: profileData.location.city,
          country: profileData.location.country,
          lastUpdated: new Date()
        } : null,
        profileViews: 0,
        likeCount: 0,
        matchCount: 0,
        responseRate: 0,
        profileCompletion: 0,
        lastProfileUpdate: new Date()
      }, false); // false = isUpdate

      // Create profile with middleware logic applied
      const profile = new Profile(profileToCreate);
      
      // Save using direct insert to avoid middleware issues
      const mongoose = require('mongoose');
      const ProfileModel = mongoose.model('Profile');
      
      const profileDataToSave = profile.toObject();
      const now = new Date();
      profileDataToSave.createdAt = now;
      profileDataToSave.updatedAt = now;
      
      const result = await ProfileModel.collection.insertOne(
        profileDataToSave
      );
      
      profile._id = result.insertedId;
      profile.isNew = false;

      // Update user's userType to DatingUser if age >= 18
      const age = calculateAge(profile.dateOfBirth);
      if (age >= 18 && user.userType !== "DatingUser") {
        user.userType = "DatingUser";
        await user.save();
      }

      logger.info("Profile created", {
        userId,
        profileId: profile._id,
        userName: profile.userName,
      });

      res.status(201).json({
        success: true,
        message: "Profile created successfully",
        data: {
          profile: this.getPublicProfileData(profile, true), // FIXED: Use controller method
        },
        meta: {
          nextSteps: age >= 18 ? [
            "Add profile picture",
            "Complete bio", 
            "Consider creating dating profile at /api/auth/dating-profile"
          ] : [
            "Add profile picture",
            "Complete bio"
          ],
          requestId: req.requestId,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };

  updateProfile = async (req, res) => {
    try {
      const userId = req.user?.id;
      const updateData = req.body;

      if (!userId) {
        throw createError("User ID required", "USER_ID_REQUIRED", 401);
      }

      // Check if profile exists
      const existingProfile = await Profile.findOne({ userId });
      if (!existingProfile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      // Handle userName change
      if (updateData.userName && updateData.userName !== existingProfile.userName) {
        const userNameTaken = await Profile.findOne({
          userName: { $regex: new RegExp(`^${updateData.userName}$`, "i") },
          userId: { $ne: userId },
        });

        if (userNameTaken) {
          throw createError("Username already taken", "USERNAME_TAKEN", 409);
        }
      }

      // Handle location update
      if (updateData.location && updateData.location.coordinates) {
        updateData.location = {
          type: 'Point',
          coordinates: updateData.location.coordinates,
          city: updateData.location.city,
          country: updateData.location.country,
          timezone: updateData.location.timezone,
          lastUpdated: new Date()
        };
      }

      // Validate dynamic fields
      await this.validateDynamicFields(updateData);

      // Apply middleware logic to update data
      const updatedProfileData = this.applyProfileMiddleware(
        { ...existingProfile.toObject(), ...updateData },
        true // true = isUpdate
      );

      // Update profile using findOneAndUpdate
      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        { $set: updatedProfileData },
        {
          new: true,
          runValidators: true,
        }
      );

      if (!updatedProfile) {
        throw createError("Failed to update profile", "UPDATE_FAILED", 500);
      }

      // Update user's userType if age changed and now >= 18
      if (updateData.dateOfBirth) {
        const age = calculateAge(updateData.dateOfBirth);
        if (age >= 18) {
          const user = await BaseUser.findById(userId);
          if (user && user.userType !== "DatingUser") {
            user.userType = "DatingUser";
            await user.save();
          }
        }
      }

      // Get labels for updated fields
      const labels = await this.getAllLabels(updatedProfile);

      logger.info("Profile updated", {
        userId,
        updatedFields: Object.keys(updateData),
        requestId: req.requestId,
      });

      res.json({
        success: true,
        message: "Profile updated successfully",
        data: {
          profile: this.getPublicProfileData(updatedProfile, true),
          updatedFields: Object.keys(updateData),
        },
        meta: {
          fieldsUpdated: Object.keys(updateData).length,
          profileCompletion: updatedProfile.profileCompletion || 0,
          requestId: req.requestId,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };

  // ========== OTHER METHODS (updated for new schema) ==========
  getProfileOptions = async (req, res) => {
    try {
      const options = await optionService.getAllOptions();

      res.json({
        success: true,
        data: options,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };

  getDefaultProfileValues = async (req, res) => {
    try {
      let defaults;
      if (typeof Profile.getDefaultValues === "function") {
        defaults = await Profile.getDefaultValues();
      } else {
        defaults = {
          userName: null,
          bio: "",
          profilePicture: null,
          photos: [],
          dateOfBirth: null,
          gender: null,
          height: null,
          location: null,
          countryOfOrigin: null,
          homeLanguage: null,
          religion: null,
          servingAs: null,
          relationshipStatus: null,
          lookingFor: ["dating"],
          haveChildren: null,
          wantsChildren: null,
          education: null,
          occupation: null,
          income: null,
          hobbies: [],
          languages: [],
          lifestyle: {
            smoking: null,
            drinking: null,
            exercise: null
          },
          matchPreferences: {
            gender: [],
            ageRange: { min: 18, max: 100 },
            locationRange: 50,
            relationshipGoals: [],
            mustHaves: [],
            dealBreakers: []
          },
          datingProfile: {
            isVisible: true,
            isPaused: false,
            tags: []
          },
          verificationBadges: [],
          profileViews: 0,
          likeCount: 0,
          matchCount: 0,
          responseRate: 0,
          profileCompletion: 0
        };
      }

      res.json({
        success: true,
        data: defaults,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };

  updateProfilePicture = async (req, res) => {
    try {
      const userId = req.user?.id;
      const { url, isVerified } = req.body;

      if (!userId) {
        throw createError("User ID required", "USER_ID_REQUIRED", 401);
      }

      if (!url) {
        throw createError("Profile picture URL is required", "URL_REQUIRED", 400);
      }

      const updateData = {
        profilePicture: {
          url,
          verified: isVerified || false,
          uploadedAt: new Date(),
        }
      };

      // Apply middleware logic
      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const updatedData = this.applyProfileMiddleware(
        { ...profile.toObject(), ...updateData },
        true
      );

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        { $set: updatedData },
        { new: true, runValidators: true }
      );

      if (!updatedProfile) {
        throw createError("Failed to update profile picture", "UPDATE_FAILED", 500);
      }

      res.json({
        success: true,
        message: "Profile picture updated successfully",
        data: {
          profilePicture: updatedProfile.profilePicture,
          profileCompletion: updatedProfile.profileCompletion || 0,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };

  updatePhotos = async (req, res) => {
    try {
      const userId = req.user?.id;
      const { photos } = req.body;

      if (!userId) {
        throw createError("User ID required", "USER_ID_REQUIRED", 401);
      }

      if (!Array.isArray(photos)) {
        throw createError("Photos must be an array", "INVALID_PHOTOS", 400);
      }

      const validatedPhotos = photos.map((photo, index) => ({
        url: photo.url || photo,
        order: photo.order || index,
        isVerified: photo.isVerified || false,
        caption: photo.caption || "",
        uploadedAt: photo.uploadedAt || new Date(),
      }));

      const profile = await Profile.findOneAndUpdate(
        { userId },
        { photos: validatedPhotos },
        { new: true, runValidators: true }
      );

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      // Apply middleware to update completion
      const updatedData = this.applyProfileMiddleware(profile.toObject(), true);
      await Profile.findByIdAndUpdate(profile._id, { $set: updatedData });

      res.json({
        success: true,
        message: "Photos updated successfully",
        data: {
          photos: validatedPhotos,
          profileCompletion: updatedData.profileCompletion || 0,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };

  updateMatchPreferences = async (req, res) => {
    try {
      const userId = req.user?.id;
      const updateData = req.body;

      if (!userId) {
        throw createError("User ID required", "USER_ID_REQUIRED", 401);
      }

      const profile = await Profile.findOneAndUpdate(
        { userId },
        { matchPreferences: updateData },
        { new: true, runValidators: true }
      );

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      res.json({
        success: true,
        message: "Match preferences updated successfully",
        data: {
          matchPreferences: profile.matchPreferences,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };

  addVerificationBadge = async (req, res) => {
    try {
      const userId = req.user?.id;
      const { badge } = req.body;

      if (!userId) {
        throw createError("User ID required", "USER_ID_REQUIRED", 401);
      }

      if (!badge) {
        throw createError("Badge type is required", "BADGE_REQUIRED", 400);
      }

      const profile = await Profile.findOne({ userId });

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      // Use our controller method
      const success = this.addVerificationBadgeToProfile(profile, badge);

      if (!success) {
        throw createError(
          "Invalid badge type or badge already exists",
          "BADGE_ERROR",
          400
        );
      }

      // Apply middleware and save
      const updatedData = this.applyProfileMiddleware(profile.toObject(), true);
      await Profile.findByIdAndUpdate(profile._id, { $set: updatedData });

      res.json({
        success: true,
        message: "Verification badge added successfully",
        data: {
          isVerified: this.checkIsVerified(profile),
          verificationBadges: profile.verificationBadges || [],
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };

  getProfileStats = async (req, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        throw createError("User ID required", "USER_ID_REQUIRED", 401);
      }

      const profile = await Profile.findOne({ userId });

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      // Get dating stats if exists
      const datingUser = await DatingUser.findById(userId);
      const datingStats = datingUser?.datingStats || {};

      const stats = {
        profileViews: profile.profileViews || 0,
        likeCount: profile.likeCount || 0,
        matchCount: profile.matchCount || 0,
        responseRate: profile.responseRate || 0,
        profileCompletion: profile.profileCompletion || 0,
        lastActive: profile.updatedAt,
        datingStats: {
          totalLikes: datingStats.totalLikes || 0,
          totalMatches: datingStats.totalMatches || 0,
          totalMessagesSent: datingStats.totalMessagesSent || 0,
          profileViews: datingStats.profileViews || 0,
        }
      };

      res.json({
        success: true,
        data: { stats },
        meta: {
          period: "all_time",
          hasDatingStats: !!datingUser,
          requestId: req.requestId,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };

  getProfileCompletion = async (req, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        throw createError("User ID required", "USER_ID_REQUIRED", 401);
      }

      const profile = await Profile.findOne({ userId });

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const completion = this.calculateProfileCompletion(profile);

      // Get missing fields
      const missingFields = this.getMissingFields(profile);

      res.json({
        success: true,
        data: {
          completionPercentage: completion,
          missingFields,
          nextSteps: missingFields.slice(0, 3),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };

  // ========== NEW: PROFILE MIDDLEWARE LOGIC (moved from Profile model) ==========
  
  /**
   * Apply profile middleware logic (moved from Profile model pre-save)
   * Call this before saving any profile
   */
  applyProfileMiddleware(profileData, isUpdate = false) {
    try {
      const profile = { ...profileData };
      
      // 1. Normalize username
      if (profile.userName && isUpdate) {
        profile.userName = profile.userName.toLowerCase();
      }
      
      // 2. Set lastProfileUpdate if certain fields changed or this is a new profile
      const fieldsToCheck = ['bio', 'profilePicture', 'photos', 'hobbies', 'location', 'verificationBadges'];
      const hasModifiedFields = fieldsToCheck.some(field => 
        profile[field] !== undefined && 
        (isUpdate || !profile._id) // If new profile or field is being set
      );
      
      if (hasModifiedFields || !profile.lastProfileUpdate) {
        profile.lastProfileUpdate = new Date();
      }
      
      // 3. Calculate profile completion
      this.calculateProfileCompletion(profile);
      
      return profile;
      
    } catch (error) {
      logger.error("Profile middleware error:", error);
      throw error;
    }
  }

  /**
   * Calculate profile completion (from Profile model)
   */
  calculateProfileCompletion(profile) {
    const requiredFields = [
      { field: 'userName', weight: 10 },
      { field: 'profilePicture.url', weight: 15 },
      { field: 'bio', weight: 10, condition: (val) => val && val.length > 50 },
      { field: 'dateOfBirth', weight: 5 },
      { field: 'gender', weight: 5 },
      { field: 'location.city', weight: 10 },
      { field: 'hobbies', weight: 10, condition: (val) => val && val.length >= 3 },
      { field: 'languages', weight: 5, condition: (val) => val && val.length >= 1 },
      { field: 'relationshipStatus', weight: 5 },
      { field: 'lookingFor', weight: 5, condition: (val) => val && val.length >= 1 },
      { field: 'verificationBadges', weight: 10, condition: (val) => val && val.length >= 1 }
    ];
    
    let completion = 0;
    
    requiredFields.forEach(({ field, weight, condition }) => {
      const value = field.split('.').reduce((obj, key) => obj && obj[key], profile);
      
      if (condition) {
        if (condition(value)) completion += weight;
      } else if (value) {
        completion += weight;
      }
    });
    
    // For new profiles, give a baseline
    if (completion < 10 && !profile._id) {
      completion = 10;
    }
    
    profile.profileCompletion = Math.min(completion, 100);
    return profile.profileCompletion;
  }

  // ========== PRIVATE HELPER METHODS ==========
  getAllLabels = async (profile) => {
    const labels = {};
    
    const fieldMap = {
      gender: "gender",
      religion: "religion",
      servingAs: "servingAs",
      relationshipStatus: "relationshipStatus",
      lookingFor: "lookingFor",
      haveChildren: "haveChildren",
      wantsChildren: "wantsChildren",
      education: "education",
      income: "income",
    };

    for (const [field, category] of Object.entries(fieldMap)) {
      if (profile[field]) {
        try {
          const label = await optionService.getOptionLabel(category, profile[field]);
          labels[`${field}Label`] = label;
        } catch (error) {
          labels[`${field}Label`] = profile[field];
          logger.warn(`Failed to get label for ${field}:`, error.message);
        }
      }
    }

    return labels;
  };

  getVerificationBadgesWithLabels = (verificationBadges = []) => {
    if (!Array.isArray(verificationBadges)) {
      return [];
    }

    const badgeLabels = {
      "email": "Email Verified",
      "phone": "Phone Verified", 
      "photo": "Photo Verified",
      "identity": "Identity Verified",
      "premium": "Premium Member",
      "social": "Social Media Connected"
    };
    
    return verificationBadges.map(badge => {
      if (typeof badge === 'object' && badge.type) {
        return {
          type: badge.type,
          label: badgeLabels[badge.type] || badge.type,
          verifiedAt: badge.verifiedAt || new Date()
        };
      }
      return {
        type: badge,
        label: badgeLabels[badge] || badge,
        earnedAt: new Date()
      };
    });
  };

  // Check if profile is verified
  checkIsVerified = (profile) => {
    return profile.verificationBadges && profile.verificationBadges.length > 0;
  };

  // Get public profile data
  getPublicProfileData = (profile, includeSensitive = false) => {
    const publicProfile = {
      id: profile._id,
      userId: profile.userId,
      userName: profile.userName,
      bio: profile.bio,
      profilePicture: profile.profilePicture,
      photos: profile.photos,
      age: calculateAge(profile.dateOfBirth),
      gender: profile.gender,
      location: {
        city: profile.location?.city,
        country: profile.location?.country
      },
      countryOfOrigin: profile.countryOfOrigin,
      homeLanguage: profile.homeLanguage,
      relationshipStatus: profile.relationshipStatus,
      lookingFor: profile.lookingFor,
      hobbies: profile.hobbies,
      lifestyle: profile.lifestyle,
      verificationBadges: profile.verificationBadges?.map(b => 
        typeof b === 'object' ? b.type : b
      ) || [],
      profileCompletion: profile.profileCompletion || 0
    };
    
    if (includeSensitive) {
      publicProfile.education = profile.education;
      publicProfile.occupation = profile.occupation;
      publicProfile.languages = profile.languages;
      publicProfile.height = profile.height;
      publicProfile.religion = profile.religion;
      publicProfile.servingAs = profile.servingAs;
    }
    
    return publicProfile;
  };

  validateDynamicFields = async (data) => {
    const fieldValidations = {
      gender: "gender",
      religion: "religion",
      servingAs: "servingAs",
      relationshipStatus: "relationshipStatus",
      lookingFor: "lookingFor",
      haveChildren: "haveChildren",
      wantsChildren: "wantsChildren",
      education: "education",
      income: "income",
    };

    for (const [field, category] of Object.entries(fieldValidations)) {
      if (data[field]) {
        try {
          const isValid = await optionService.validateOption(category, data[field]);
          if (!isValid) {
            throw createError(`Invalid value for ${field}: "${data[field]}"`, "VALIDATION_ERROR", 400);
          }
        } catch (error) {
          logger.warn(`Validation failed for ${field}:`, error.message);
          // Don't throw, just log warning
        }
      }
    }
  };

  incrementProfileViews = async (profileId) => {
    try {
      await Profile.findByIdAndUpdate(profileId, {
        $inc: { profileViews: 1 },
      });
    } catch (error) {
      logger.error("Failed to increment profile views:", error);
    }
  };

  addVerificationBadgeToProfile = (profile, badge) => {
    const validBadges = ["email", "phone", "photo", "identity", "premium", "social"];
    
    if (!validBadges.includes(badge)) {
      return false;
    }

    if (!profile.verificationBadges) {
      profile.verificationBadges = [];
    }

    // Check if badge already exists
    const exists = profile.verificationBadges.some(b => 
      (typeof b === 'object' ? b.type : b) === badge
    );
    
    if (exists) {
      return false;
    }

    // Add badge
    profile.verificationBadges.push({
      type: badge,
      verifiedAt: new Date()
    });
    
    return true;
  };

  getMissingFields = (profile) => {
    const fieldLabels = {
      userName: "Username",
      profilePicture: "Profile Picture",
      bio: "Bio",
      photos: "Photos",
      gender: "Gender",
      dateOfBirth: "Date of Birth",
      location: "Location",
      hobbies: "Hobbies",
      lookingFor: "Relationship Goals"
    };

    const missing = [];

    for (const [field, label] of Object.entries(fieldLabels)) {
      let isCompleted = false;

      if (field === "profilePicture") {
        isCompleted = !!(profile.profilePicture && profile.profilePicture.url);
      } else if (field === "photos") {
        isCompleted = profile.photos && profile.photos.length > 0;
      } else if (field === "location") {
        isCompleted = !!(profile.location && profile.location.city);
      } else if (field === "hobbies") {
        isCompleted = profile.hobbies && profile.hobbies.length > 0;
      } else if (field === "lookingFor") {
        isCompleted = profile.lookingFor && profile.lookingFor.length > 0;
      } else {
        isCompleted = !!profile[field];
      }

      if (!isCompleted) {
        missing.push(label);
      }
    }

    return missing;
  };

  // NEW: Calculate distance between users
  calculateDistance = (viewerId, targetUserId, targetProfile) => {
    if (!viewerId || viewerId === targetUserId || !targetProfile?.location?.coordinates) {
      return null;
    }
    
    // In real implementation, get viewer's location and calculate distance
    // This is a placeholder
    return null;
  };

  // NEW: Get last active based on privacy settings
  getLastActive = (datingUser, privacySettings, viewerId, targetUserId) => {
    if (!datingUser || viewerId === targetUserId) {
      return datingUser?.datingStats?.lastActiveDate || null;
    }

    if (privacySettings.showLastActive === "everyone") {
      return datingUser.datingStats?.lastActiveDate || null;
    } else if (privacySettings.showLastActive === "matches") {
      // Check if viewer is a match
      return null; // Implement match check
    }

    return null;
  };
}

// Export singleton instance
const profileController = new ProfileController();
module.exports = profileController;