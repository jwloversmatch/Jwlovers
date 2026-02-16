const Profile = require("@models/Profile/Profile.model");
const { BaseUser, DatingUser } = require("@models/User");
const optionService = require("@services/option.service");
const logger = require("@utils/logger");
const { v4: uuidv4 } = require("uuid");

// ========== CONSTANTS ==========
const CONFIG = {
  MAX_BIO_LENGTH: 500,
  MAX_CAPTION_LENGTH: 100,
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 20,
  DEFAULT_DISTANCE: 50,
  MIN_AGE: 18,
  MAX_AGE: 100
};

// ========== HELPER FUNCTIONS ==========
const calculateAge = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
};

const createError = (message, code = "PROFILE_ERROR", statusCode = 400) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

// Deep merge utility for nested objects
const deepMerge = (target, source) => {
  if (!source) return target;
  
  const output = { ...target };
  
  Object.keys(source).forEach(key => {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!output[key]) output[key] = {};
      output[key] = deepMerge(output[key], source[key]);
    } else {
      output[key] = source[key];
    }
  });
  
  return output;
};

// Build nested update operations safely
const buildNestedUpdateOps = (obj, basePath = '') => {
  const ops = {};
  
  Object.keys(obj).forEach(key => {
    const path = basePath ? `${basePath}.${key}` : key;
    const value = obj[key];
    
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(ops, buildNestedUpdateOps(value, path));
    } else {
      ops[path] = value;
    }
  });
  
  return ops;
};

// ========== PROFILE CONTROLLER ==========
class ProfileController {
  
  // ========== GET PROFILES ==========
  getMyProfile = async (req, res) => {
    try {
      const userId = req.user.id;
      
      const [user, profile, datingUser] = await Promise.all([
        BaseUser.findById(userId).select('firstName lastName email phoneNumber emailVerified phoneVerified lastLogin userType userName ageVerified'),
        Profile.findOne({ userId }),
        DatingUser.findById(userId).select('isPremium ageVerified presence datingStats')
      ]);

      const response = {
        success: true,
        data: {
          user: {
            _id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            fullName: `${user.firstName} ${user.lastName}`,
            email: { address: user.email, verified: user.emailVerified },
            phone: { number: user.phoneNumber, verified: user.phoneVerified },
            lastLogin: user.lastLogin,
            userType: user.userType,
            userName: user.userName || null,
            ageVerified: user.ageVerified || false
          },
          profile: profile ? this.formatOwnProfile(profile) : null,
          dating: datingUser ? {
            isPremium: datingUser.isPremium || false,
            ageVerified: datingUser.ageVerified || false,
            presence: datingUser.presence || { status: 'offline', lastSeen: null },
            datingStats: datingUser.datingStats
          } : null
        },
        timestamp: new Date().toISOString()
      };

      res.json(response);
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  getPublicProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const viewerId = req.user?.id;

    if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
      throw createError("Invalid user ID format", "INVALID_USER_ID", 400);
    }

    const [user, profile, datingUser] = await Promise.all([
      BaseUser.findById(userId).select('firstName userName'),
      Profile.findOne({ userId }),
      DatingUser.findById(userId).select('isPremium ageVerified presence')
    ]);

    if (!user || !profile) {
      throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
    }

    if (!profile.settings?.isVisible && viewerId !== userId) {
      throw createError("Profile is private", "PROFILE_PRIVATE", 403);
    }

    this.incrementStats(userId, 'profileViews').catch(err => 
      logger.error("Failed to increment profile views:", err)
    );

    const publicProfile = {
      userId: profile.userId,
      firstName: user.firstName,
      userName: profile.basic?.userName || user.userName,
      
      basic: {
        userName: profile.basic?.userName,
        bio: profile.basic?.bio,
        age: profile.settings?.privacy?.showAge !== false ? profile.age : null,
        gender: profile.basic?.gender,
        genderLabel: await this.getOptionLabel('gender', profile.basic?.gender)
      },

      photos: {
        profile: profile.photos?.profile?.url || null,
        gallery: profile.photos?.gallery?.map(p => ({
          url: p.url,
          caption: p.caption
        })) || []
      },

      location: profile.location ? {
        city: profile.location.city,
        country: profile.location.country,
        distance: viewerId === userId ? 0 : await this.calculateDistance(viewerId, userId)
      } : null,

      faith: {
        servingAs: profile.faith?.servingAs,
        servingAsLabel: await this.getOptionLabel('servingAs', profile.faith?.servingAs),
        missionary: profile.faith?.missionary?.served || false,
        bethel: profile.faith?.bethel?.served || false,
        pioneer: ['regular_pioneer', 'auxiliary_pioneer', 'special_pioneer'].includes(profile.faith?.servingAs)
      },

      relationship: {
        status: profile.relationship?.status,
        statusLabel: await this.getOptionLabel('relationshipStatus', profile.relationship?.status),
        lookingFor: profile.relationship?.lookingFor || []
      },

      career: {
        occupation: profile.career?.work?.occupation,
        education: profile.career?.education?.level,
        educationLabel: await this.getOptionLabel('education', profile.career?.education?.level)
      },

      lifestyle: {
        hobbies: profile.lifestyle?.hobbies?.slice(0, 10) || [],
        languages: profile.lifestyle?.languages?.map(l => l.language) || [],
        exercise: profile.lifestyle?.exercise?.frequency,
        smoking: profile.lifestyle?.smoking,
        drinking: profile.lifestyle?.drinking,
        pets: profile.lifestyle?.pets || []
      },

      personality: {
        introvertExtrovert: profile.personality?.introvertExtrovert,
        communicationStyle: profile.personality?.communicationStyle,
        meetingAttendance: profile.personality?.meetingAttendance
      },

      // Preferences are intentionally public — visitors can see what a
      // profile owner is looking for before deciding to connect.
      preferences: {
        basic: {
          gender:   profile.preferences?.basic?.gender   || [],
          ageRange: profile.preferences?.basic?.ageRange || { min: 18, max: 45 },
          distance: profile.preferences?.basic?.distance ?? 50,
        },
        faith: {
          mustBeJW:            profile.preferences?.faith?.mustBeJW            ?? true,
          servingAs:           profile.preferences?.faith?.servingAs           || [],
          pioneerPreferred:    profile.preferences?.faith?.pioneerPreferred    ?? false,
          missionaryPreferred: profile.preferences?.faith?.missionaryPreferred ?? false,
          bethelPreferred:     profile.preferences?.faith?.bethelPreferred     ?? false,
        },
        relationship: {
          goals: profile.preferences?.relationship?.goals || [],
          children: {
            accept:   profile.preferences?.relationship?.children?.accept   ?? true,
            wantMore: profile.preferences?.relationship?.children?.wantMore ?? null,
          },
        },
        dealbreakers: {
          mustHaves:    profile.preferences?.dealbreakers?.mustHaves    || [],
          dealBreakers: profile.preferences?.dealbreakers?.dealBreakers || [],
        },
      },

      badges: profile.badges?.map(b => b.type) || [],
      
      stats: {
        profileCompletion: profile.progress?.completion || 0,
        lastActive: profile.stats?.lastActive || profile.updatedAt
      },

      dating: datingUser ? {
        isPremium: datingUser.isPremium || false,
        isVerified: datingUser.ageVerified || false,
        presence: {
          status: datingUser.presence?.status || 'offline',
          lastSeen: datingUser.presence?.lastSeen,
          isOnline: datingUser.presence?.status === 'online' && 
                   datingUser.presence?.lastSeen && 
                   (new Date() - datingUser.presence.lastSeen) < 5 * 60 * 1000
        }
      } : null
    };

    res.json({
      success: true,
      data: publicProfile,
      meta: {
        isOwner: viewerId === userId,
        isDatingProfile: !!datingUser,
        requestId: req.requestId
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    this.handleError(error, req, res);
  }
};

  // ========== CREATE PROFILE ==========
  createProfile = async (req, res) => {
    try {
      const userId = req.user.id;
      const profileData = req.body;

      const [existingProfile, user] = await Promise.all([
        Profile.findOne({ userId }),
        BaseUser.findById(userId)
      ]);

      if (existingProfile) {
        throw createError("Profile already exists", "PROFILE_EXISTS", 409);
      }

      if (!user) {
        throw createError("User not found", "USER_NOT_FOUND", 404);
      }

      if (profileData.basic?.userName) {
        const userNameTaken = await Profile.findOne({ 
          'basic.userName': { $regex: new RegExp(`^${profileData.basic.userName}$`, 'i') }
        });
        if (userNameTaken) {
          throw createError("Username already taken", "USERNAME_TAKEN", 409);
        }
      }

      const defaults = Profile.getDefaultValues();
      
      // Ensure location is properly initialized
      const mergedProfile = {
        userId,
        ...deepMerge(defaults, profileData),
        location: {
          type: 'Point',
          coordinates: [0, 0],
          city: '',
          country: '',
          countryCode: '',
          formattedAddress: '',
          lastUpdated: new Date(),
          ...(profileData.location || {})
        },
        'progress.onboardingCompleted': false
      };

      const profile = new Profile(mergedProfile);
      await profile.save();

      if (profile.age >= 18 && user.userType !== "DatingUser") {
        user.userType = "DatingUser";
        await user.save();
      }

      logger.info("Profile created", { 
        userId, 
        profileId: profile._id,
        hasDateOfBirth: !!profile.basic?.dateOfBirth,
        hasUserName: !!profile.basic?.userName,
        hasGender: !!profile.basic?.gender
      });

      res.status(201).json({
        success: true,
        message: "Profile created successfully",
        data: { profile: this.formatOwnProfile(profile) },
        meta: {
          nextSteps: profile.age >= 18 ? [
            "Add profile picture",
            "Complete your bio",
            "Add your service privileges",
            "Set your preferences"
          ] : [
            "Complete your profile"
          ],
          requestId: req.requestId
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  // ========== UPDATE PROFILE - FULLY FIXED with location handling ==========
  updateProfile = async (req, res) => {
    try {
      const userId = req.user.id;
      const updateData = req.body;

      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      // Remove protected fields
      const protectedFields = ['_id', 'userId', 'badges', 'stats', 'progress', 'createdAt', 'updatedAt'];
      protectedFields.forEach(field => delete updateData[field]);

      // Check username availability
      if (updateData.basic?.userName && 
          updateData.basic.userName !== profile.basic?.userName) {
        const userNameTaken = await Profile.findOne({
          'basic.userName': { $regex: new RegExp(`^${updateData.basic.userName}$`, 'i') },
          userId: { $ne: userId }
        });
        if (userNameTaken) {
          throw createError("Username already taken", "USERNAME_TAKEN", 409);
        }
      }

      // ===== FIX: Build update operations with proper nested handling =====
      const updateOps = {};
      
      // Handle location specially - ensure it's never null
      if (updateData.location) {
        // Initialize location object if it doesn't exist
        if (!profile.location) {
          updateOps['location'] = {
            type: 'Point',
            coordinates: [0, 0],
            city: '',
            country: '',
            countryCode: '',
            formattedAddress: '',
            lastUpdated: new Date()
          };
        }
        
        // Add location updates
        Object.keys(updateData.location).forEach(key => {
          updateOps[`location.${key}`] = updateData.location[key];
        });
        
        // Always update lastUpdated when location changes
        updateOps['location.lastUpdated'] = new Date();
        
        // Remove location from updateData so we don't process it again
        delete updateData.location;
      }

      // Handle all other nested fields safely
      Object.keys(updateData).forEach(key => {
        if (updateData[key] && typeof updateData[key] === 'object' && !Array.isArray(updateData[key])) {
          // Use recursive helper for deep nested objects
          const nestedOps = buildNestedUpdateOps(updateData[key], key);
          Object.assign(updateOps, nestedOps);
        } else {
          updateOps[key] = updateData[key];
        }
      });

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        { $set: updateOps },
        { new: true, runValidators: true }
      );

      // Update user type if age changed to 18+
      if (updateData.basic?.dateOfBirth) {
        const age = calculateAge(updateData.basic.dateOfBirth);
        if (age >= 18) {
          const user = await BaseUser.findById(userId);
          if (user && user.userType !== "DatingUser") {
            user.userType = "DatingUser";
            await user.save();
          }
        }
      }

      logger.info("Profile updated", { 
        userId, 
        fields: Object.keys(updateOps) 
      });

      res.json({
        success: true,
        message: "Profile updated successfully",
        data: { profile: this.formatOwnProfile(updatedProfile) },
        meta: {
          completion: updatedProfile.progress?.completion || 0,
          requestId: req.requestId
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  // ========== SECTION UPDATES - FIXED with proper nested handling ==========
  updateBasicInfo = async (req, res) => {
    try {
      const userId = req.user.id;
      const { basic } = req.body;

      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const updateOps = buildNestedUpdateOps(basic, 'basic');

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        { $set: updateOps },
        { new: true, runValidators: true }
      );

      res.json({
        success: true,
        data: { basic: updatedProfile.basic },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  updateFaithInfo = async (req, res) => {
    try {
      const userId = req.user.id;
      const { faith } = req.body;

      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const updateOps = buildNestedUpdateOps(faith, 'faith');

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        { $set: updateOps },
        { new: true, runValidators: true }
      );

      res.json({
        success: true,
        data: { faith: updatedProfile.faith },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  updateRelationshipInfo = async (req, res) => {
    try {
      const userId = req.user.id;
      const { relationship } = req.body;

      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const updateOps = buildNestedUpdateOps(relationship, 'relationship');

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        { $set: updateOps },
        { new: true, runValidators: true }
      );

      res.json({
        success: true,
        data: { relationship: updatedProfile.relationship },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  updateCareerInfo = async (req, res) => {
    try {
      const userId = req.user.id;
      const { career } = req.body;

      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const updateOps = buildNestedUpdateOps(career, 'career');

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        { $set: updateOps },
        { new: true, runValidators: true }
      );

      res.json({
        success: true,
        data: { career: updatedProfile.career },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  updateLifestyle = async (req, res) => {
    try {
      const userId = req.user.id;
      const { lifestyle } = req.body;

      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const updateOps = buildNestedUpdateOps(lifestyle, 'lifestyle');

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        { $set: updateOps },
        { new: true, runValidators: true }
      );

      res.json({
        success: true,
        data: { lifestyle: updatedProfile.lifestyle },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  updatePersonality = async (req, res) => {
    try {
      const userId = req.user.id;
      const { personality } = req.body;

      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const updateOps = buildNestedUpdateOps(personality, 'personality');

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        { $set: updateOps },
        { new: true, runValidators: true }
      );

      res.json({
        success: true,
        data: { personality: updatedProfile.personality },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  updatePreferences = async (req, res) => {
    try {
      const userId = req.user.id;
      const { preferences } = req.body;

      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const updateOps = buildNestedUpdateOps(preferences, 'preferences');

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        { $set: updateOps },
        { new: true, runValidators: true }
      );

      res.json({
        success: true,
        data: { preferences: updatedProfile.preferences },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  updateSettings = async (req, res) => {
    try {
      const userId = req.user.id;
      const { settings } = req.body;

      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const updateOps = buildNestedUpdateOps(settings, 'settings');

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        { $set: updateOps },
        { new: true, runValidators: true }
      );

      res.json({
        success: true,
        data: { settings: updatedProfile.settings },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  // ========== PHOTO MANAGEMENT ==========
  updateProfilePicture = async (req, res) => {
    try {
      const userId = req.user.id;
      const { url } = req.body;

      if (!url) {
        throw createError("Photo URL is required", "URL_REQUIRED", 400);
      }

      const profile = await Profile.findOneAndUpdate(
        { userId },
        {
          $set: {
            'photos.profile.url': url,
            'photos.profile.uploadedAt': new Date()
          }
        },
        { new: true }
      );

      res.json({
        success: true,
        data: { profilePicture: profile.photos.profile },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  updateGallery = async (req, res) => {
    try {
      const userId = req.user.id;
      const { photos } = req.body;

      if (!Array.isArray(photos)) {
        throw createError("Photos must be an array", "INVALID_PHOTOS", 400);
      }

      const validatedPhotos = photos.map((photo, index) => ({
        url: photo.url,
        order: photo.order ?? index,
        caption: photo.caption || "",
        uploadedAt: new Date()
      }));

      const profile = await Profile.findOneAndUpdate(
        { userId },
        { $set: { 'photos.gallery': validatedPhotos } },
        { new: true }
      );

      res.json({
        success: true,
        data: { gallery: profile.photos.gallery },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  // ========== BADGES ==========
  addBadge = async (req, res) => {
    try {
      const userId = req.user.id;
      const { badge } = req.body;

      const validBadges = ["email", "phone", "photo", "identity", "premium", "baptized", "pioneer", "missionary", "bethel"];
      
      if (!validBadges.includes(badge)) {
        throw createError("Invalid badge type", "INVALID_BADGE", 400);
      }

      const profile = await Profile.findOne({ userId });
      
      const added = profile.addBadge(badge);
      if (!added) {
        throw createError("Badge already exists or invalid", "BADGE_ERROR", 400);
      }

      await profile.save();

      res.json({
        success: true,
        message: "Badge added successfully",
        data: { badges: profile.badges },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  // ========== STATS & PROGRESS ==========
  getStats = async (req, res) => {
    try {
      const userId = req.user.id;
      
      const [profile, datingUser] = await Promise.all([
        Profile.findOne({ userId }).select('stats progress'),
        DatingUser.findById(userId).select('datingStats')
      ]);

      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const stats = {
        profile: {
          views: profile.stats?.profileViews || 0,
          likes: profile.stats?.likes || 0,
          matches: profile.stats?.matches || 0,
          responseRate: profile.stats?.responseRate || 0,
          completion: profile.progress?.completion || 0,
          lastActive: profile.stats?.lastActive || profile.updatedAt
        },
        dating: datingUser?.datingStats || null
      };

      res.json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  getCompletion = async (req, res) => {
    try {
      const userId = req.user.id;
      
      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw createError("Profile not found", "PROFILE_NOT_FOUND", 404);
      }

      const completion = profile.progress?.completion || 0;
      const missing = this.getMissingFields(profile);

      res.json({
        success: true,
        data: {
          percentage: completion,
          missing: missing,
          nextSteps: missing.slice(0, 3),
          isComplete: completion >= 80
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  // ========== OPTIONS ==========
  getOptions = async (req, res) => {
    try {
      const { category } = req.query;
      
      let options;
      if (category) {
        options = await optionService.getOptionsByCategory(category);
      } else {
        options = await optionService.getAllOptions();
      }

      res.json({
        success: true,
        data: options,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.handleError(error, req, res);
    }
  };

  // ========== PRIVATE HELPERS ==========
  async getOptionLabel(category, value) {
    if (!category || !value) return null;
    try {
      return await optionService.getOptionLabel(category, value);
    } catch (error) {
      logger.warn(`Failed to get label for ${category}:${value}`, error.message);
      return value;
    }
  }

  async getMultiOptionLabels(category, values) {
    if (!category || !Array.isArray(values)) return [];
    const labels = await Promise.all(
      values.map(v => this.getOptionLabel(category, v))
    );
    return labels.filter(Boolean);
  }

  formatOwnProfile(profile) {
    return {
      id: profile._id,
      userId: profile.userId,
      basic: profile.basic,
      photos: profile.photos,
      location: profile.location,
      faith: profile.faith,
      relationship: profile.relationship,
      career: profile.career,
      lifestyle: profile.lifestyle,
      personality: profile.personality,
      preferences: profile.preferences,
      settings: profile.settings,
      badges: profile.badges?.map(b => b.type) || [],
      progress: {
        completion: profile.progress?.completion || 0,
        onboardingCompleted: profile.progress?.onboardingCompleted || false
      },
      stats: {
        lastActive: profile.stats?.lastActive || profile.updatedAt
      },
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    };
  }

  getMissingFields(profile) {
    const checks = [
      { field: 'basic.userName', label: 'Username', condition: (p) => p.basic?.userName },
      { field: 'photos.profile.url', label: 'Profile Picture', condition: (p) => p.photos?.profile?.url },
      { field: 'basic.bio', label: 'Bio', condition: (p) => p.basic?.bio?.length >= 50 },
      { field: 'basic.dateOfBirth', label: 'Age', condition: (p) => p.basic?.dateOfBirth },
      { field: 'basic.gender', label: 'Gender', condition: (p) => p.basic?.gender },
      { field: 'location.city', label: 'Location', condition: (p) => p.location?.city },
      { field: 'faith.servingAs', label: 'Service Privilege', condition: (p) => p.faith?.servingAs },
      { field: 'relationship.status', label: 'Relationship Status', condition: (p) => p.relationship?.status },
      { field: 'relationship.lookingFor', label: 'Looking For', condition: (p) => p.relationship?.lookingFor?.length > 0 },
      { field: 'lifestyle.hobbies', label: 'Hobbies', condition: (p) => p.lifestyle?.hobbies?.length >= 3 },
      { field: 'photos.gallery', label: 'Additional Photos', condition: (p) => p.photos?.gallery?.length >= 2 },
      { field: 'badges', label: 'Verification', condition: (p) => p.badges?.length >= 1 }
    ];

    return checks
      .filter(check => !check.condition(profile))
      .map(check => check.label);
  }

  async incrementStats(userId, field) {
    try {
      await Profile.findOneAndUpdate(
        { userId },
        { $inc: { [`stats.${field}`]: 1 } }
      );
    } catch (error) {
      logger.error("Failed to increment stats:", error);
    }
  }

  async calculateDistance(viewerId, targetUserId) {
    // Implement distance calculation logic here
    return null;
  }

  // ========== ERROR HANDLER ==========
  handleError(error, req, res) {
    const requestId = req.requestId || uuidv4();
    
    logger.error("Profile controller error:", {
      requestId,
      userId: req.user?.id,
      path: req.path,
      error: error.message,
      code: error.code,
      stack: error.stack
    });

    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message,
        value: error.errors[key].value
      }));
      
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        errors,
        code: "VALIDATION_ERROR",
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(409).json({
        success: false,
        error: `${field} already exists`,
        code: "DUPLICATE_ERROR",
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: `Invalid ${error.path}: ${error.value}`,
        code: "INVALID_ID",
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Internal server error",
      code: error.code || "INTERNAL_ERROR",
      requestId,
      timestamp: new Date().toISOString()
    });
  }
}

// ========== EXPORT ==========
module.exports = new ProfileController();