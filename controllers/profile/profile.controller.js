const Profile = require("@models/Profile.model");
const { BaseUser, DatingUser, UserService, UserQuery } = require("@models/User");
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

  // Hide sensitive error details in production
  if (process.env.NODE_ENV === "production" && error.statusCode === 500) {
    response.error = "Internal server error";
  }

  res.status(error.statusCode || 500).json(response);
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

      const user = await UserQuery.getUserById(userId);
      
      if (!user) {
        throw createError("User not found", "USER_NOT_FOUND", 404);
      }

      // Check if user is a dating user
      if (user.userType !== 'DatingUser') {
        throw createError("Profile features only available for dating users", "INVALID_USER_TYPE", 403);
      }

      // FIXED: Populate 'userId' field instead of 'user'
      const profile = await Profile.findOne({ userId }).populate({
        path: 'userId',
        model: 'DatingUser',
        select: 'firstName lastName email avatar dateOfBirth'
      });

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      // Get dynamic option labels for the profile
      const [labels, verificationBadgesWithLabels] = await Promise.all([
        profile.getAllLabels ? profile.getAllLabels() : this.getAllLabels(profile),
        profile.verificationBadgesWithLabels || this.getVerificationBadgesWithLabels(profile),
      ]);

      const profileWithLabels = {
        ...profile.toObject(),
        ...labels,
        verificationBadgesWithLabels,
      };

      res.json({
        success: true,
        data: {
          // Private info (only for owner)
          privateInfo: {
            firstName: profile.userId?.firstName || user.firstName,
            lastName: profile.userId?.lastName || user.lastName,
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
        },
        meta: {
          profileCompletion: profile.profileCompletion || 0,
          lastUpdated: profile.updatedAt,
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

      // Get user to check if they're a dating user
      const user = await UserQuery.getUserById(userId);
      
      if (!user) {
        throw createError("User not found", "USER_NOT_FOUND", 404);
      }

      if (user.userType !== 'DatingUser') {
        throw createError("Public profiles only available for dating users", "INVALID_USER_TYPE", 403);
      }

      // FIXED: Populate 'userId' field instead of 'user'
      const profile = await Profile.findOne({ userId })
        .populate({
          path: 'userId',
          model: 'DatingUser',
          select: 'firstName lastName avatar lastActive'
        })
        .select("-__v -createdAt -updatedAt -_id -userId");

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      // Increment profile views (async)
      this.incrementProfileViews(profile._id).catch((err) =>
        logger.error("Failed to increment profile views:", err)
      );

      // Get labels for display
      const [labels, verificationBadgesWithLabels] = await Promise.all([
        profile.getAllLabels ? profile.getAllLabels() : this.getAllLabels(profile),
        profile.verificationBadgesWithLabels || this.getVerificationBadgesWithLabels(profile),
      ]);

      // Construct response with public data
      const publicProfile = {
        basicInfo: {
          userId: user._id,
          userName: profile.userName,
          profilePicture: profile.profilePicture,
          bio: profile.bio,
          age: profile.age,
          gender: profile.gender,
          genderLabel: labels.genderLabel,
          firstName: profile.userId?.firstName,
          lastName: profile.userId?.lastName,
          avatar: profile.userId?.avatar,
        },
        location: {
          city: profile.currentLocation?.city,
          country: profile.currentLocation?.country,
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
        },
        photos:
          profile.photos?.map((photo) => ({
            url: photo.url,
            caption: photo.caption,
            order: photo.order,
          })) || [],
        preferences: {
          lookingFor: profile.lookingFor,
          lookingForLabel: labels.lookingForLabel,
        },
        verification: {
          isVerified: profile.isVerified,
          badges: verificationBadgesWithLabels,
        },
        stats: {
          profileCompletion: profile.profileCompletion || 0,
          lastActive: profile.userId?.lastActive || profile.updatedAt,
        },
      };

      res.json({
        success: true,
        data: publicProfile,
        meta: {
          isOwner: viewerId === userId,
          requestId: req.requestId,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleControllerError(error, req, res);
    }
  };

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
      // Check if Profile.getDefaultValues exists, otherwise use fallback
      let defaults;
      if (typeof Profile.getDefaultValues === "function") {
        defaults = await Profile.getDefaultValues();
      } else {
        defaults = this.getDefaultValues();
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

  createProfile = async (req, res) => {
    try {
      const userId = req.user?.id;
      const { userName } = req.body;

      if (!userId) {
        throw createError("User ID required", "USER_ID_REQUIRED", 401);
      }

      // Check if user exists and is a dating user
      const user = await UserQuery.getUserById(userId);
      
      if (!user) {
        throw createError("User not found", "USER_NOT_FOUND", 404);
      }

      if (user.userType !== 'DatingUser') {
        throw createError("Only dating users can create profiles", "INVALID_USER_TYPE", 403);
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

      // Check userName availability (case-insensitive)
      const userNameTaken = await Profile.findOne({
        userName: { $regex: new RegExp(`^${userName}$`, "i") },
      });

      if (userNameTaken) {
        throw createError("Username already taken", "USERNAME_TAKEN", 409);
      }

      // Get default values
      const defaultValues =
        typeof Profile.getDefaultValues === "function"
          ? await Profile.getDefaultValues()
          : this.getDefaultValues();

      // Create profile with defaults and provided data
      const profileData = {
        userId,
        userName: userName.toLowerCase(),
        ...defaultValues,
        ...req.body,
      };

      const profile = await Profile.create(profileData);

      // Update userName in User model (now DatingUser)
      await DatingUser.findByIdAndUpdate(userId, {
        userName: userName.toLowerCase(),
      });

      logger.info("Profile created", {
        userId,
        userName,
        profileId: profile._id,
      });

      res.status(201).json({
        success: true,
        message: "Profile created successfully",
        data: {
          profile: {
            userName: profile.userName,
            profileCompletion: profile.profileCompletion || 0,
            createdAt: profile.createdAt,
          },
        },
        meta: {
          nextSteps: ["Add profile picture", "Complete bio", "Add interests"],
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

      // Check if user is a dating user
      const user = await UserQuery.getUserById(userId);
      
      if (!user) {
        throw createError("User not found", "USER_NOT_FOUND", 404);
      }

      if (user.userType !== 'DatingUser') {
        throw createError("Only dating users can update profiles", "INVALID_USER_TYPE", 403);
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

        // Update userName in DatingUser model
        await DatingUser.findByIdAndUpdate(userId, {
          userName: updateData.userName.toLowerCase(),
        });
      }

      // Validate dynamic fields
      await this.validateDynamicFields(updateData);

      // Use findOneAndUpdate to get updated document
      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        updateData,
        {
          new: true,
          runValidators: true,
        }
      ).populate({
        path: 'userId',
        model: 'DatingUser',
        select: 'firstName lastName email avatar'
      });

      if (!updatedProfile) {
        throw createError("Failed to update profile", "UPDATE_FAILED", 500);
      }

      // Get labels for updated fields
      const labels = updatedProfile.getAllLabels
        ? await updatedProfile.getAllLabels()
        : await this.getAllLabels(updatedProfile);

      // Prepare response
      const responseData = this.prepareUpdateResponse(
        existingProfile,
        updatedProfile,
        updateData,
        labels
      );

      logger.info("Profile updated", {
        userId,
        updatedFields: Object.keys(updateData),
        requestId: req.requestId,
      });

      res.json({
        success: true,
        message: "Profile updated successfully",
        data: responseData,
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
        },
      };

      const profile = await Profile.findOneAndUpdate(
        { userId },
        updateData,
        { new: true, runValidators: true }
      );

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      res.json({
        success: true,
        message: "Profile picture updated successfully",
        data: {
          profilePicture: profile.profilePicture,
          profileCompletion: profile.profileCompletion || 0,
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

      // Validate each photo
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

      res.json({
        success: true,
        message: "Photos updated successfully",
        data: {
          photos: profile.photos,
          profileCompletion: profile.profileCompletion || 0,
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
      const {
        gender,
        ageRange,
        locationRange,
        religion,
        educationLevel,
        wantsChildren,
      } = req.body;

      if (!userId) {
        throw createError("User ID required", "USER_ID_REQUIRED", 401);
      }

      // Check if user is a dating user
      const user = await UserQuery.getUserById(userId);
      
      if (!user) {
        throw createError("User not found", "USER_NOT_FOUND", 404);
      }

      if (user.userType !== 'DatingUser') {
        throw createError("Only dating users can update match preferences", "INVALID_USER_TYPE", 403);
      }

      const updateData = { matchPreferences: {} };
      const validationErrors = [];

      // Validate each field
      if (gender) {
        const isValid = await optionService.validateOption("matchGender", gender);
        if (!isValid) {
          validationErrors.push(`Invalid value for match gender: "${gender}"`);
        } else {
          updateData.matchPreferences.gender = gender;
        }
      }

      if (ageRange) {
        const { min, max } = ageRange;
        if (min && max && min > max) {
          validationErrors.push("Minimum age cannot be greater than maximum age");
        } else {
          updateData.matchPreferences.ageRange = ageRange;
        }
      }

      if (locationRange) {
        const range = parseInt(locationRange);
        if (range >= 1 && range <= 10000) {
          updateData.matchPreferences.locationRange = range;
        } else {
          validationErrors.push("Location range must be between 1 and 10000 km");
        }
      }

      if (religion) {
        const isValid = await optionService.validateOption(
          "matchReligion",
          religion
        );
        if (!isValid) {
          validationErrors.push(`Invalid value for match religion: "${religion}"`);
        } else {
          updateData.matchPreferences.religion = religion;
        }
      }

      if (educationLevel) {
        const isValid = await optionService.validateOption(
          "matchEducationLevel",
          educationLevel
        );
        if (!isValid) {
          validationErrors.push(
            `Invalid value for match education level: "${educationLevel}"`
          );
        } else {
          updateData.matchPreferences.educationLevel = educationLevel;
        }
      }

      if (wantsChildren) {
        const isValid = await optionService.validateOption(
          "matchWantsChildren",
          wantsChildren
        );
        if (!isValid) {
          validationErrors.push(
            `Invalid value for match wants children: "${wantsChildren}"`
          );
        } else {
          updateData.matchPreferences.wantsChildren = wantsChildren;
        }
      }

      if (validationErrors.length > 0) {
        throw createError(
          validationErrors.join(", "),
          "VALIDATION_ERROR",
          400
        );
      }

      const profile = await Profile.findOneAndUpdate(
        { userId },
        updateData,
        { new: true, runValidators: true }
      );

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      // Get labels for the updated preferences
      const labels = {};
      if (profile.matchPreferences) {
        if (profile.matchPreferences.gender) {
          labels.genderLabel = await optionService.getOptionLabel(
            "matchGender",
            profile.matchPreferences.gender
          );
        }
        if (profile.matchPreferences.religion) {
          labels.religionLabel = await optionService.getOptionLabel(
            "matchReligion",
            profile.matchPreferences.religion
          );
        }
      }

      res.json({
        success: true,
        message: "Match preferences updated successfully",
        data: {
          matchPreferences: {
            ...(profile.matchPreferences?.toObject?.() || profile.matchPreferences),
            ...labels,
          },
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

      // Check if user is a dating user
      const user = await UserQuery.getUserById(userId);
      
      if (!user) {
        throw createError("User not found", "USER_NOT_FOUND", 404);
      }

      if (user.userType !== 'DatingUser') {
        throw createError("Only dating users can add verification badges", "INVALID_USER_TYPE", 403);
      }

      const profile = await Profile.findOne({ userId });

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      // Check if addVerificationBadge method exists on profile instance
      let success;
      if (typeof profile.addVerificationBadge === "function") {
        success = await profile.addVerificationBadge(badge);
      } else {
        success = await this.addVerificationBadgeToProfile(profile, badge);
      }

      if (!success) {
        throw createError(
          "Invalid badge type or badge already exists",
          "BADGE_ERROR",
          400
        );
      }

      await profile.save();

      res.json({
        success: true,
        message: "Verification badge added successfully",
        data: {
          isVerified: profile.isVerified,
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

      // Check if user is a dating user
      const user = await UserQuery.getUserById(userId);
      
      if (!user) {
        throw createError("User not found", "USER_NOT_FOUND", 404);
      }

      if (user.userType !== 'DatingUser') {
        throw createError("Profile stats only available for dating users", "INVALID_USER_TYPE", 403);
      }

      const profile = await Profile.findOne({ userId }).select(
        "profileViews likeCount matchCount responseRate profileCompletion lastActive"
      );

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const stats = {
        profileViews: profile.profileViews || 0,
        likeCount: profile.likeCount || 0,
        matchCount: profile.matchCount || 0,
        responseRate: profile.responseRate || 0,
        profileCompletion: profile.profileCompletion || 0,
        lastActive: profile.lastActive,
        daysSinceLastActive: Math.floor(
          (Date.now() - new Date(profile.lastActive).getTime()) /
            (1000 * 60 * 60 * 24)
        ),
      };

      res.json({
        success: true,
        data: { stats },
        meta: {
          period: "all_time",
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

      // Check if user is a dating user
      const user = await UserQuery.getUserById(userId);
      
      if (!user) {
        throw createError("User not found", "USER_NOT_FOUND", 404);
      }

      if (user.userType !== 'DatingUser') {
        throw createError("Profile completion only available for dating users", "INVALID_USER_TYPE", 403);
      }

      const profile = await Profile.findOne({ userId });

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const completion = profile.calculateCompletion
        ? await profile.calculateCompletion()
        : await this.calculateCompletion(profile);

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

  // ========== PRIVATE HELPER METHODS ==========
  getAllLabels = async (profile) => {
    const labels = {};
    
    // Define field to category mapping
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
        }
      }
    }

    return labels;
  };

  getVerificationBadgesWithLabels = async (profile) => {
    if (!profile.verificationBadges || !Array.isArray(profile.verificationBadges)) {
      return [];
    }

    return profile.verificationBadges.map(badge => ({
      type: badge,
      label: badge.charAt(0).toUpperCase() + badge.slice(1).replace(/-/g, ' '),
      verifiedAt: new Date(),
    }));
  };

  getDefaultValues = () => {
    return {
      profilePicture: null,
      bio: "",
      photos: [],
      gender: "",
      dateOfBirth: null,
      height: null,
      countryOfOrigin: "",
      currentLocation: {
        city: "",
        country: "",
      },
      homeLanguage: "",
      religion: "",
      servingAs: "",
      relationshipStatus: "",
      lookingFor: [],
      haveChildren: "",
      wantsChildren: "",
      education: "",
      occupation: "",
      income: "",
      matchPreferences: {
        gender: "",
        ageRange: { min: 18, max: 99 },
        locationRange: 100,
        religion: "",
        educationLevel: "",
        wantsChildren: "",
      },
      profileCompletion: 0,
      profileViews: 0,
      likeCount: 0,
      matchCount: 0,
      responseRate: 0,
      lastActive: new Date(),
      isVerified: false,
      verificationBadges: [],
    };
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
          // If validation service fails, continue with the value
          console.warn(`Validation failed for ${field}:`, error.message);
        }
      }
    }
  };

  prepareUpdateResponse = (oldProfile, newProfile, updateData, labels) => {
    const response = {
      updatedFields: {},
      profileCompletion: newProfile.profileCompletion || 0,
      updatedAt: newProfile.updatedAt,
    };

    // Add only fields that changed
    for (const field of Object.keys(updateData)) {
      if (field === "profileCompletion") continue;

      const oldValue = oldProfile[field];
      const newValue = newProfile[field];

      // Check if value actually changed
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        response.updatedFields[field] = newValue;
        
        // Add label if available
        const labelKey = `${field}Label`;
        if (labels[labelKey]) {
          response.updatedFields[labelKey] = labels[labelKey];
        }
      }
    }

    return response;
  };

  incrementProfileViews = async (profileId) => {
    try {
      await Profile.findByIdAndUpdate(profileId, {
        $inc: { profileViews: 1 },
        $set: { lastViewed: new Date() },
      });
    } catch (error) {
      logger.error("Failed to increment profile views:", error);
    }
  };

  addVerificationBadgeToProfile = async (profile, badge) => {
    const validBadges = ["email", "phone", "photo", "document", "social"];
    
    if (!validBadges.includes(badge)) {
      return false;
    }

    if (!profile.verificationBadges) {
      profile.verificationBadges = [];
    }

    if (profile.verificationBadges.includes(badge)) {
      return false;
    }

    profile.verificationBadges.push(badge);
    profile.isVerified = profile.verificationBadges.length > 0;
    
    return true;
  };

  calculateCompletion = async (profile) => {
    const fields = [
      "userName",
      "profilePicture",
      "bio",
      "photos",
      "gender",
      "dateOfBirth",
      "currentLocation",
      "religion",
      "education",
      "occupation",
    ];

    let completed = 0;
    
    for (const field of fields) {
      let isCompleted = false;

      if (field === "profilePicture") {
        isCompleted = !!(profile.profilePicture && profile.profilePicture.url);
      } else if (field === "photos") {
        isCompleted = profile.photos && profile.photos.length > 0;
      } else if (field === "currentLocation") {
        isCompleted = !!(
          profile.currentLocation &&
          (profile.currentLocation.city || profile.currentLocation.country)
        );
      } else {
        isCompleted = !!profile[field];
      }

      if (isCompleted) completed++;
    }

    return Math.round((completed / fields.length) * 100);
  };

  getMissingFields = (profile) => {
    const fieldLabels = {
      userName: "Username",
      profilePicture: "Profile Picture",
      bio: "Bio",
      photos: "Photos",
      gender: "Gender",
      dateOfBirth: "Date of Birth",
      currentLocation: "Current Location",
      religion: "Religion",
      education: "Education",
      occupation: "Occupation",
    };

    const missing = [];

    for (const [field, label] of Object.entries(fieldLabels)) {
      let isCompleted = false;

      if (field === "profilePicture") {
        isCompleted = !!(profile.profilePicture && profile.profilePicture.url);
      } else if (field === "photos") {
        isCompleted = profile.photos && profile.photos.length > 0;
      } else if (field === "currentLocation") {
        isCompleted = !!(
          profile.currentLocation &&
          (profile.currentLocation.city || profile.currentLocation.country)
        );
      } else {
        isCompleted = !!profile[field];
      }

      if (!isCompleted) {
        missing.push(label);
      }
    }

    return missing;
  };
}

// Export singleton instance
const profileController = new ProfileController();
module.exports = profileController;