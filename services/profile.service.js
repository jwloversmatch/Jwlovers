const { BaseUser, DatingUser } = require('@models/User');
const Profile = require('@models/Profile.model');
const optionService = require('@services/option.service');
const logger = require('@utils/logger');

class ProfileService {
  
  // ========== PROFILE RETRIEVAL ==========
  
  // Get complete user info (combines all schemas)
  async getCompleteUserInfo(userId, viewerId = null) {
    try {
      // Get base user
      const baseUser = await BaseUser.findById(userId)
        .select('-password -refreshToken -refreshTokens')
        .lean();
      
      if (!baseUser) {
        throw new Error('User not found');
      }

      // Get profile
      const profile = await Profile.findOne({ userId }).lean();
      
      if (!profile) {
        throw new Error('Profile not found');
      }

      // Get dating user if exists
      let datingUser = null;
      if (baseUser.userType === 'DatingUser') {
        datingUser = await DatingUser.findById(userId).lean();
      }

      const isOwner = viewerId && viewerId.toString() === userId.toString();
      const isAdmin = viewerId ? await this.isAdminUser(viewerId) : false;

      // Get labels for profile fields
      const labels = await this.getProfileLabels(profile);

      // Build response
      const response = {
        base: {
          id: baseUser._id,
          email: baseUser.email,
          firstName: baseUser.firstName,
          lastName: baseUser.lastName,
          role: baseUser.role,
          userType: baseUser.userType,
          accountStatus: baseUser.accountStatus,
          createdAt: baseUser.createdAt
        },
        profile: {
          id: profile._id,
          userName: profile.userName,
          bio: profile.bio,
          age: profile.age,
          gender: profile.gender,
          genderLabel: labels.genderLabel,
          location: profile.location,
          countryOfOrigin: profile.countryOfOrigin,
          homeLanguage: profile.homeLanguage,
          religion: profile.religion,
          religionLabel: labels.religionLabel,
          servingAs: profile.servingAs,
          servingAsLabel: labels.servingAsLabel,
          relationshipStatus: profile.relationshipStatus,
          relationshipStatusLabel: labels.relationshipStatusLabel,
          lookingFor: profile.lookingFor || [],
          lookingForLabel: labels.lookingForLabel,
          haveChildren: profile.haveChildren,
          haveChildrenLabel: labels.haveChildrenLabel,
          wantsChildren: profile.wantsChildren,
          wantsChildrenLabel: labels.wantsChildrenLabel,
          education: profile.education,
          educationLabel: labels.educationLabel,
          occupation: profile.occupation,
          income: profile.income,
          incomeLabel: labels.incomeLabel,
          hobbies: profile.hobbies || [],
          languages: profile.languages || [],
          profilePicture: profile.profilePicture,
          photos: profile.photos || [],
          profileCompletion: profile.profileCompletion || 0,
          verificationBadges: profile.verificationBadges || [],
          isVerified: profile.isVerified || false,
          profileViews: profile.profileViews || 0,
          likeCount: profile.likeCount || 0,
          matchCount: profile.matchCount || 0,
          responseRate: profile.responseRate || 0,
          matchPreferences: profile.matchPreferences || {},
          datingProfile: profile.datingProfile || {}
        }
      };

      // Add dating-specific info
      if (datingUser) {
        response.dating = {
          id: datingUser._id,
          ageVerified: datingUser.ageVerified,
          isPremium: datingUser.isPremium,
          premiumExpiresAt: datingUser.premiumExpiresAt,
          incognitoMode: datingUser.incognitoMode,
          travelMode: datingUser.travelMode,
          datingPreferences: datingUser.datingPreferences,
          datingNotificationSettings: datingUser.datingNotificationSettings,
          datingPrivacySettings: datingUser.datingPrivacySettings,
          datingStats: datingUser.datingStats,
          boost: datingUser.boost,
          matchScore: datingUser.matchScore,
          isShadowBanned: datingUser.isShadowBanned
        };
      }

      // Add private info if owner or admin
      if (isOwner || isAdmin) {
        response.private = {
          emailVerified: baseUser.emailVerified,
          phoneNumber: baseUser.phoneNumber,
          phoneVerified: baseUser.phoneVerified,
          dateOfBirth: baseUser.dateOfBirth,
          lastLogin: baseUser.lastLogin,
          accountStatus: baseUser.accountStatus,
          failedLoginAttempts: baseUser.failedLoginAttempts,
          accountLockedUntil: baseUser.accountLockedUntil
        };

        if (datingUser) {
          response.private.dating = {
            seenProfiles: datingUser.seenProfiles?.length || 0,
            likedProfiles: datingUser.likedProfiles?.length || 0,
            dailyActivity: datingUser.dailyActivity,
            compatibilityScores: datingUser.compatibilityScores,
            reportedCount: datingUser.reportedCount,
            warningCount: datingUser.warningCount
          };
        }
      }

      return response;
    } catch (error) {
      logger.error('Failed to get complete user info:', error);
      throw error;
    }
  }

  // Get public profile (for viewing by others)
  async getPublicProfile(userId, viewerId = null) {
    try {
      const completeInfo = await this.getCompleteUserInfo(userId, viewerId);
      const isOwner = viewerId && viewerId.toString() === userId.toString();
      
      // Build public profile based on privacy settings
      const publicProfile = {
        userId: completeInfo.base.id,
        userName: completeInfo.profile.userName,
        bio: completeInfo.profile.bio,
        age: this.getVisibleAge(completeInfo, viewerId),
        gender: completeInfo.profile.gender,
        genderLabel: completeInfo.profile.genderLabel,
        location: this.getVisibleLocation(completeInfo, viewerId),
        profilePicture: completeInfo.profile.profilePicture,
        photos: completeInfo.profile.photos || [],
        profileCompletion: completeInfo.profile.profileCompletion,
        verificationBadges: completeInfo.profile.verificationBadges,
        isVerified: completeInfo.profile.isVerified,
        hobbies: completeInfo.profile.hobbies || [],
        languages: completeInfo.profile.languages || []
      };

      // Add dating-specific public info
      if (completeInfo.dating) {
        publicProfile.dating = {
          isPremium: completeInfo.dating.isPremium,
          ageVerified: completeInfo.dating.ageVerified,
          lastActive: this.getVisibleLastActive(completeInfo, viewerId),
          matchScore: completeInfo.dating.matchScore,
          isBoostActive: this.isBoostActive(completeInfo.dating.boost)
        };
      }

      // Add background info based on privacy
      const showBackground = this.shouldShowBackground(completeInfo, viewerId);
      if (showBackground) {
        publicProfile.background = {
          countryOfOrigin: completeInfo.profile.countryOfOrigin,
          homeLanguage: completeInfo.profile.homeLanguage,
          religion: completeInfo.profile.religion,
          religionLabel: completeInfo.profile.religionLabel,
          education: completeInfo.profile.education,
          educationLabel: completeInfo.profile.educationLabel,
          occupation: completeInfo.profile.occupation,
          income: completeInfo.profile.income,
          incomeLabel: completeInfo.profile.incomeLabel
        };
      }

      // Add lifestyle info
      const showLifestyle = this.shouldShowLifestyle(completeInfo, viewerId);
      if (showLifestyle) {
        publicProfile.lifestyle = {
          servingAs: completeInfo.profile.servingAs,
          servingAsLabel: completeInfo.profile.servingAsLabel,
          relationshipStatus: completeInfo.profile.relationshipStatus,
          relationshipStatusLabel: completeInfo.profile.relationshipStatusLabel,
          haveChildren: completeInfo.profile.haveChildren,
          haveChildrenLabel: completeInfo.profile.haveChildrenLabel,
          wantsChildren: completeInfo.profile.wantsChildren,
          wantsChildrenLabel: completeInfo.profile.wantsChildrenLabel
        };
      }

      // Add preferences (limited)
      if (isOwner) {
        publicProfile.preferences = {
          lookingFor: completeInfo.profile.lookingFor,
          matchPreferences: completeInfo.profile.matchPreferences
        };
      } else {
        publicProfile.preferences = {
          lookingFor: completeInfo.profile.lookingFor
        };
      }

      return publicProfile;
    } catch (error) {
      logger.error('Failed to get public profile:', error);
      throw error;
    }
  }

  // ========== PROFILE MANAGEMENT ==========
  
  // Create new profile
  async createProfile(userId, profileData) {
    try {
      // Check if user exists
      const user = await BaseUser.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if profile already exists
      const existingProfile = await Profile.findOne({ userId });
      if (existingProfile) {
        throw new Error('Profile already exists for this user');
      }

      // Validate username
      if (profileData.userName) {
        const userNameTaken = await Profile.findOne({
          userName: { $regex: new RegExp(`^${profileData.userName}$`, 'i') }
        });
        
        if (userNameTaken) {
          throw new Error('Username already taken');
        }
      }

      // Create profile
      const profile = await Profile.create({
        userId,
        ...profileData,
        userName: profileData.userName?.toLowerCase(),
        profileCompletion: await this.calculateProfileCompletion(profileData)
      });

      // Update user type if needed
      if (profile.age >= 18 && user.userType !== 'DatingUser') {
        user.userType = 'DatingUser';
        await user.save();
      }

      logger.info('Profile created successfully', {
        userId,
        profileId: profile._id,
        userName: profile.userName
      });

      return profile;
    } catch (error) {
      logger.error('Failed to create profile:', error);
      throw error;
    }
  }

  // Update profile
  async updateProfile(userId, updateData) {
    try {
      // Check if profile exists
      const existingProfile = await Profile.findOne({ userId });
      if (!existingProfile) {
        throw new Error('Profile not found');
      }

      // Handle username change
      if (updateData.userName && updateData.userName !== existingProfile.userName) {
        const userNameTaken = await Profile.findOne({
          userName: { $regex: new RegExp(`^${updateData.userName}$`, 'i') },
          userId: { $ne: userId }
        });

        if (userNameTaken) {
          throw new Error('Username already taken');
        }
      }

      // Handle location update
      if (updateData.location && updateData.location.coordinates) {
        updateData.location = {
          type: 'Point',
          coordinates: updateData.location.coordinates,
          city: updateData.location.city,
          country: updateData.location.country,
          lastUpdated: new Date()
        };
      }

      // Validate dynamic fields
      await this.validateProfileData(updateData);

      // Update profile
      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        updateData,
        { new: true, runValidators: true }
      );

      // Recalculate profile completion
      const completion = await this.calculateProfileCompletion(updatedProfile);
      updatedProfile.profileCompletion = completion;
      await updatedProfile.save();

      // Update user type if age changed and now >= 18
      if (updateData.dateOfBirth || updateData.age >= 18) {
        const user = await BaseUser.findById(userId);
        if (user && user.userType !== 'DatingUser') {
          user.userType = 'DatingUser';
          await user.save();
        }
      }

      logger.info('Profile updated successfully', {
        userId,
        updatedFields: Object.keys(updateData),
        profileCompletion: completion
      });

      return updatedProfile;
    } catch (error) {
      logger.error('Failed to update profile:', error);
      throw error;
    }
  }

  // ========== PROFILE STATS & COMPLETION ==========

  // Get profile stats
  async getProfileStats(userId) {
    try {
      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw new Error('Profile not found');
      }

      // Get dating stats if exists
      const datingUser = await DatingUser.findById(userId);
      const datingStats = datingUser?.datingStats || {};

      const stats = {
        profile: {
          views: profile.profileViews || 0,
          likes: profile.likeCount || 0,
          matches: profile.matchCount || 0,
          responseRate: profile.responseRate || 0,
          completion: profile.profileCompletion || 0,
          lastActive: profile.updatedAt,
          verificationBadges: profile.verificationBadges?.length || 0
        },
        dating: datingUser ? {
          totalLikes: datingStats.totalLikes || 0,
          totalMatches: datingStats.totalMatches || 0,
          totalMessages: datingStats.totalMessagesSent || 0,
          profileViews: datingStats.profileViews || 0,
          lastActive: datingStats.lastActiveDate,
          averageResponseTime: datingStats.averageResponseTime || 0,
          matchRate: datingStats.matchRate || 0,
          streakDays: datingStats.streakDays || 0
        } : null
      };

      return stats;
    } catch (error) {
      logger.error('Failed to get profile stats:', error);
      throw error;
    }
  }

  // Get profile completion
  async getProfileCompletion(userId) {
    try {
      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw new Error('Profile not found');
      }

      const completion = await this.calculateProfileCompletion(profile);
      const missingFields = this.getMissingFields(profile);

      return {
        completionPercentage: completion,
        missingFields,
        nextSteps: missingFields.slice(0, 3)
      };
    } catch (error) {
      logger.error('Failed to get profile completion:', error);
      throw error;
    }
  }

  // Calculate profile completion
  async calculateProfileCompletion(profile) {
    const fields = [
      { field: 'userName', weight: 10 },
      { field: 'profilePicture', weight: 15, check: (p) => !!(p.profilePicture && p.profilePicture.url) },
      { field: 'bio', weight: 10, check: (p) => p.bio && p.bio.length >= 50 },
      { field: 'age', weight: 5 },
      { field: 'gender', weight: 5 },
      { field: 'location', weight: 10, check: (p) => !!(p.location && p.location.city) },
      { field: 'photos', weight: 10, check: (p) => p.photos && p.photos.length >= 1 },
      { field: 'hobbies', weight: 5, check: (p) => p.hobbies && p.hobbies.length >= 1 },
      { field: 'lookingFor', weight: 5, check: (p) => p.lookingFor && p.lookingFor.length >= 1 },
      { field: 'countryOfOrigin', weight: 5 },
      { field: 'religion', weight: 5 },
      { field: 'education', weight: 5 },
      { field: 'occupation', weight: 5 },
      { field: 'relationshipStatus', weight: 5 }
    ];

    let totalWeight = 0;
    let completedWeight = 0;

    for (const field of fields) {
      totalWeight += field.weight;
      
      let isCompleted = false;
      if (field.check) {
        isCompleted = field.check(profile);
      } else {
        isCompleted = !!profile[field.field];
      }
      
      if (isCompleted) {
        completedWeight += field.weight;
      }
    }

    return Math.round((completedWeight / totalWeight) * 100);
  }

  // ========== HELPER METHODS ==========

  async getProfileLabels(profile) {
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
        }
      }
    }

    return labels;
  }

  async validateProfileData(data) {
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
            throw new Error(`Invalid value for ${field}: "${data[field]}"`);
          }
        } catch (error) {
          logger.warn(`Validation failed for ${field}:`, error.message);
        }
      }
    }
  }

  getMissingFields(profile) {
    const fieldLabels = {
      userName: "Username",
      profilePicture: "Profile Picture",
      bio: "Bio (at least 50 characters)",
      photos: "At least one photo",
      gender: "Gender",
      age: "Age",
      location: "Location",
      hobbies: "At least one hobby/interest",
      lookingFor: "Relationship goals"
    };

    const missing = [];

    for (const [field, label] of Object.entries(fieldLabels)) {
      let isCompleted = false;

      if (field === 'profilePicture') {
        isCompleted = !!(profile.profilePicture && profile.profilePicture.url);
      } else if (field === 'photos') {
        isCompleted = profile.photos && profile.photos.length >= 1;
      } else if (field === 'bio') {
        isCompleted = profile.bio && profile.bio.length >= 50;
      } else if (field === 'hobbies') {
        isCompleted = profile.hobbies && profile.hobbies.length >= 1;
      } else if (field === 'lookingFor') {
        isCompleted = profile.lookingFor && profile.lookingFor.length >= 1;
      } else if (field === 'location') {
        isCompleted = !!(profile.location && profile.location.city);
      } else {
        isCompleted = !!profile[field];
      }

      if (!isCompleted) {
        missing.push(label);
      }
    }

    return missing;
  }

  // Privacy helpers
  getVisibleAge(userInfo, viewerId) {
    const isOwner = viewerId && viewerId.toString() === userInfo.base.id.toString();
    
    if (isOwner) {
      return userInfo.profile.age;
    }

    if (userInfo.dating && userInfo.dating.datingPrivacySettings?.showAge === false) {
      return null;
    }

    return userInfo.profile.age;
  }

  getVisibleLocation(userInfo, viewerId) {
    const isOwner = viewerId && viewerId.toString() === userInfo.base.id.toString();
    
    if (isOwner) {
      return userInfo.profile.location;
    }

    if (userInfo.dating) {
      const showDistance = userInfo.dating.datingPrivacySettings?.showDistance !== false;
      if (showDistance) {
        return {
          city: userInfo.profile.location?.city,
          country: userInfo.profile.location?.country
          // Distance calculation would go here
        };
      }
    }

    return {
      city: userInfo.profile.location?.city,
      country: userInfo.profile.location?.country
    };
  }

  getVisibleLastActive(userInfo, viewerId) {
    const isOwner = viewerId && viewerId.toString() === userInfo.base.id.toString();
    
    if (isOwner) {
      return userInfo.dating?.datingStats?.lastActiveDate || null;
    }

    if (userInfo.dating) {
      const showLastActive = userInfo.dating.datingPrivacySettings?.showLastActive;
      
      if (showLastActive === 'everyone') {
        return userInfo.dating.datingStats?.lastActiveDate || null;
      } else if (showLastActive === 'matches') {
        // Check if viewer is a match
        // This would require a match check implementation
        return null;
      }
    }

    return null;
  }

  shouldShowBackground(userInfo, viewerId) {
    const isOwner = viewerId && viewerId.toString() === userInfo.base.id.toString();
    
    if (isOwner) {
      return true;
    }

    if (userInfo.dating) {
      return userInfo.dating.datingPrivacySettings?.showInterests !== false;
    }

    return true;
  }

  shouldShowLifestyle(userInfo, viewerId) {
    const isOwner = viewerId && viewerId.toString() === userInfo.base.id.toString();
    
    if (isOwner) {
      return true;
    }

    if (userInfo.dating) {
      return userInfo.dating.datingPrivacySettings?.showInterests !== false;
    }

    return true;
  }

  isBoostActive(boost) {
    return boost?.isActive && 
           boost.expiresAt && 
           new Date(boost.expiresAt) > new Date();
  }

  async isAdminUser(userId) {
    const user = await BaseUser.findById(userId);
    return user && (user.role === 'admin' || user.role === 'super_admin');
  }

  // Increment profile views
  async incrementProfileViews(profileId) {
    try {
      await Profile.findByIdAndUpdate(profileId, {
        $inc: { profileViews: 1 }
      });
    } catch (error) {
      logger.error('Failed to increment profile views:', error);
    }
  }

  // Add verification badge
  async addVerificationBadge(userId, badge) {
    try {
      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw new Error('Profile not found');
      }

      const validBadges = ['email', 'phone', 'photo', 'identity', 'premium', 'social'];
      
      if (!validBadges.includes(badge)) {
        throw new Error('Invalid badge type');
      }

      if (!profile.verificationBadges) {
        profile.verificationBadges = [];
      }

      // Check if badge already exists
      const exists = profile.verificationBadges.some(b => 
        (typeof b === 'object' ? b.type : b) === badge
      );
      
      if (exists) {
        throw new Error('Badge already exists');
      }

      // Add badge
      profile.verificationBadges.push({
        type: badge,
        verifiedAt: new Date()
      });
      
      profile.isVerified = profile.verificationBadges.length >= 2; // Need at least 2 badges to be verified
      
      await profile.save();

      return profile;
    } catch (error) {
      logger.error('Failed to add verification badge:', error);
      throw error;
    }
  }
}

module.exports = new ProfileService();