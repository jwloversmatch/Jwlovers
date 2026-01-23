const { BaseUser, DatingUser, UserQuery, UserService: CoreUserService, ROLES } = require('@models/User');
const Profile = require('@models/Profile.model');
const Match = require('@models/Match.model');
const optionService = require('@services/option.service');
const logger = require('@utils/logger');

class ProfileService {
  
  // Get complete user info (private + public)
  async getCompleteUser(userId, requestingUser = null) {
    try {
      const [user, profile] = await Promise.all([
        UserQuery.getUserById(userId),
        Profile.findOne({ userId }).populate('user', 'firstName lastName')
      ]);
      
      if (!user) {
        throw new Error('User not found');
      }

      // Check if user is a dating user
      if (user.userType !== 'DatingUser') {
        throw new Error('Profile features only available for dating users');
      }

      if (!profile) {
        throw new Error('Profile not found');
      }

      // Check authorization
      if (requestingUser && !user._id.equals(requestingUser._id) && !requestingUser.isAdminUser) {
        throw new Error('Unauthorized to view private information');
      }

      // Get labels for profile fields
      const labels = await this.getProfileLabels(profile);

      return {
        privateInfo: requestingUser && user._id.equals(requestingUser._id) ? {
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          emailVerified: user.emailVerified,
          phoneVerified: user.phoneVerified,
          lastLogin: user.lastLogin,
          dateOfBirth: user.dateOfBirth,
          age: user.age
        } : null, // Only return private info for owner or admin
        
        publicProfile: {
          userId: profile.userId,
          userName: profile.userName,
          profilePicture: profile.profilePicture,
          bio: profile.bio,
          photos: profile.photos || [],
          // About Him
          age: profile.age,
          gender: profile.gender,
          genderLabel: labels.genderLabel,
          height: profile.height,
          countryOfOrigin: profile.countryOfOrigin,
          currentLocation: profile.currentLocation,
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
          // Match preferences
          matchPreferences: profile.matchPreferences || {
            gender: '',
            ageRange: { min: 18, max: 99 },
            locationRange: 100,
            religion: '',
            educationLevel: '',
            wantsChildren: ''
          },
          // Stats
          profileCompletion: profile.profileCompletion || 0,
          isVerified: profile.isVerified || false,
          verificationBadges: profile.verificationBadges || [],
          profileViews: profile.profileViews || 0,
          likeCount: profile.likeCount || 0,
          matchCount: profile.matchCount || 0,
          responseRate: profile.responseRate || 0,
          lastActive: profile.lastActive
        }
      };
    } catch (error) {
      logger.error('Failed to get complete user:', error);
      throw error;
    }
  }
  
  // Update private info
  async updatePrivateInfo(userId, updateData, requestingUser = null) {
    try {
      // Check permissions
      if (requestingUser && userId !== requestingUser._id.toString()) {
        throw new Error('Can only update your own private information');
      }

      const user = await UserQuery.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const allowedFields = ['firstName', 'lastName', 'phoneNumber', 'notificationSettings', 'privacySettings'];
      const filteredData = {};
      
      allowedFields.forEach(field => {
        if (updateData[field] !== undefined) {
          filteredData[field] = updateData[field];
        }
      });
      
      // Handle password change separately
      if (updateData.currentPassword && updateData.newPassword) {
        const isPasswordValid = await user.comparePassword(updateData.currentPassword);
        if (!isPasswordValid) {
          throw new Error('Current password is incorrect');
        }
        filteredData.password = updateData.newPassword;
      }
      
      // Reset verification if phone changes
      if (updateData.phoneNumber && updateData.phoneNumber !== user.phoneNumber) {
        filteredData.phoneVerified = false;
      }

      // Update the appropriate model based on user type
      let updatedUser;
      switch(user.userType) {
        case 'DatingUser':
          updatedUser = await DatingUser.findByIdAndUpdate(
            userId,
            filteredData,
            { new: true, runValidators: true, select: '-password -refreshToken' }
          );
          break;
        case 'Moderator':
        case 'Admin':
        case 'SuperAdmin':
          updatedUser = await BaseUser.findByIdAndUpdate(
            userId,
            filteredData,
            { new: true, runValidators: true, select: '-password -refreshToken' }
          );
          break;
        default:
          throw new Error(`Unknown user type: ${user.userType}`);
      }

      if (!updatedUser) {
        throw new Error('Failed to update user');
      }

      logger.info('Private info updated', {
        userId,
        updatedFields: Object.keys(filteredData),
        userType: user.userType
      });

      return updatedUser;
    } catch (error) {
      logger.error('Failed to update private info:', error);
      throw error;
    }
  }
  
  // Update public profile
  async updatePublicProfile(userId, updateData, requestingUser = null) {
    try {
      // Check permissions
      if (requestingUser && userId !== requestingUser._id.toString()) {
        throw new Error('Can only update your own profile');
      }

      const user = await UserQuery.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Only dating users have profiles
      if (user.userType !== 'DatingUser') {
        throw new Error('Only dating users have profiles');
      }

      // Validate dynamic fields
      await this.validateProfileData(updateData);

      // Handle username change
      if (updateData.userName && updateData.userName !== user.userName) {
        const existingProfile = await Profile.findOne({
          userName: { $regex: new RegExp(`^${updateData.userName}$`, 'i') },
          userId: { $ne: userId }
        });

        if (existingProfile) {
          throw new Error('Username already taken');
        }

        // Update username in user model too
        await DatingUser.findByIdAndUpdate(userId, {
          userName: updateData.userName.toLowerCase()
        });
      }

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId: userId },
        updateData,
        { new: true, runValidators: true, upsert: true }
      );

      logger.info('Public profile updated', {
        userId,
        updatedFields: Object.keys(updateData),
        userType: user.userType
      });

      return updatedProfile;
    } catch (error) {
      logger.error('Failed to update public profile:', error);
      throw error;
    }
  }
  
  // Find potential matches
  async findPotentialMatches(userId, options = {}) {
    try {
      const user = await UserQuery.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Only dating users can find matches
      if (user.userType !== 'DatingUser') {
        throw new Error('Match features only available for dating users');
      }

      const userProfile = await Profile.findOne({ userId });
      if (!userProfile) {
        throw new Error('Profile not found');
      }
      
      const { limit = 20, skip = 0 } = options;
      
      // Build match query based on user's preferences
      const query = {
        userId: { $ne: userId },
        accountStatus: 'active'
      };

      // Gender filter
      if (userProfile.matchPreferences?.gender) {
        if (userProfile.matchPreferences.gender === 'both') {
          query.gender = { $in: ['male', 'female'] };
        } else {
          query.gender = userProfile.matchPreferences.gender;
        }
      }

      // Age filter
      if (userProfile.matchPreferences?.ageRange) {
        query.age = {
          $gte: userProfile.matchPreferences.ageRange.min || 18,
          $lte: userProfile.matchPreferences.ageRange.max || 99
        };
      }

      // Religion filter
      if (userProfile.matchPreferences?.religion) {
        query.religion = userProfile.matchPreferences.religion;
      }

      // Wants children filter
      if (userProfile.matchPreferences?.wantsChildren) {
        query.wantsChildren = userProfile.matchPreferences.wantsChildren;
      }

      // Exclude already liked/disliked/blocked users
      const excludedUsers = [
        ...(userProfile.likes || []),
        ...(userProfile.dislikes || []),
        ...(userProfile.blocked || [])
      ];
      
      if (excludedUsers.length > 0) {
        query.userId = { 
          $ne: userId,
          $nin: excludedUsers 
        };
      }

      // Find profiles
      const potentialMatches = await Profile.find(query)
        .populate('user', 'firstName lastName lastActive')
        .sort({ profileCompletion: -1, lastActive: -1 })
        .skip(skip)
        .limit(limit);
      
      // Calculate compatibility for each
      const matchesWithCompatibility = await Promise.all(
        potentialMatches.map(async (profile) => {
          const compatibility = this.calculateCompatibility(userProfile, profile);
          const matchesPreferences = this.matchesPreferences(userProfile, profile);
          
          // Get user details
          const matchedUser = await DatingUser.findById(profile.userId)
            .select('firstName lastName avatar userName');
          
          return {
            profile: {
              userId: profile.userId,
              userName: profile.userName || matchedUser?.userName,
              profilePicture: profile.profilePicture || matchedUser?.avatar,
              bio: profile.bio,
              age: profile.age,
              gender: profile.gender,
              height: profile.height,
              countryOfOrigin: profile.countryOfOrigin,
              currentLocation: profile.currentLocation,
              homeLanguage: profile.homeLanguage,
              religion: profile.religion,
              servingAs: profile.servingAs,
              relationshipStatus: profile.relationshipStatus,
              lookingFor: profile.lookingFor || [],
              haveChildren: profile.haveChildren,
              wantsChildren: profile.wantsChildren,
              education: profile.education,
              occupation: profile.occupation,
              income: profile.income,
              profileCompletion: profile.profileCompletion || 0,
              lastActive: profile.lastActive || matchedUser?.lastActive
            },
            compatibilityScore: compatibility,
            matchesPreferences: matchesPreferences,
            distance: userProfile.currentLocation?.coordinates?.[0] !== 0 && 
                     profile.currentLocation?.coordinates?.[0] !== 0
              ? await this.calculateDistance(userProfile.currentLocation, profile.currentLocation)
              : 'Unknown'
          };
        })
      );
      
      // Sort by compatibility score
      return matchesWithCompatibility.sort((a, b) => b.compatibilityScore - a.compatibilityScore);
    } catch (error) {
      logger.error('Failed to find potential matches:', error);
      throw error;
    }
  }
  
  // Get existing matches
  async getExistingMatches(userId) {
    try {
      const user = await UserQuery.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Only dating users can have matches
      if (user.userType !== 'DatingUser') {
        throw new Error('Match features only available for dating users');
      }

      const matches = await Match.find({
        $or: [{ user1: userId }, { user2: userId }],
        status: 'active'
      })
      .populate('user1', 'firstName lastName')
      .populate('user2', 'firstName lastName')
      .sort({ lastMessageAt: -1, matchedAt: -1 });
      
      // Get full profiles for matches
      const matchDetails = await Promise.all(
        matches.map(async (match) => {
          const otherUserId = match.user1.toString() === userId ? match.user2 : match.user1;
          const otherProfile = await Profile.findOne({ userId: otherUserId });
          const otherUser = await DatingUser.findById(otherUserId)
            .select('firstName lastName avatar userName lastActive');
          
          return {
            matchId: match._id,
            matchedAt: match.matchedAt,
            compatibilityScore: match.compatibilityScore,
            lastMessageAt: match.lastMessageAt,
            otherUser: {
              userId: otherUserId,
              firstName: otherUser?.firstName,
              lastName: otherUser?.lastName,
              userName: otherProfile?.userName || otherUser?.userName,
              avatar: otherProfile?.profilePicture || otherUser?.avatar,
              lastActive: otherProfile?.lastActive || otherUser?.lastActive
            },
            profile: otherProfile ? {
              userName: otherProfile.userName,
              profilePicture: otherProfile.profilePicture,
              age: otherProfile.age,
              gender: otherProfile.gender,
              bio: otherProfile.bio,
              location: otherProfile.currentLocation?.city,
              religion: otherProfile.religion,
              occupation: otherProfile.occupation,
              education: otherProfile.education,
              wantsChildren: otherProfile.wantsChildren,
              profileCompletion: otherProfile.profileCompletion || 0
            } : null
          };
        })
      );
      
      return matchDetails;
    } catch (error) {
      logger.error('Failed to get existing matches:', error);
      throw error;
    }
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
          // If validation service fails, log warning but continue
          logger.warn(`Validation failed for ${field}:`, error.message);
        }
      }
    }
  }

  calculateCompatibility(profile1, profile2) {
    let score = 50;
    
    // Age compatibility
    const ageDiff = Math.abs(profile1.age - profile2.age);
    if (ageDiff <= 2) score += 15;
    else if (ageDiff <= 5) score += 10;
    else if (ageDiff <= 10) score += 5;
    
    // Religion compatibility
    if (profile1.religion && profile2.religion) {
      if (profile1.religion === profile2.religion) score += 10;
    }
    
    // Education compatibility
    if (profile1.education && profile2.education) {
      const educationLevels = {
        'high_school': 1,
        'associate': 2,
        'bachelor': 3,
        'master': 4,
        'phd': 5
      };
      
      const edu1 = educationLevels[profile1.education] || 0;
      const edu2 = educationLevels[profile2.education] || 0;
      
      if (Math.abs(edu1 - edu2) <= 1) score += 10;
    }
    
    // Want children compatibility
    if (profile1.wantsChildren && profile2.wantsChildren) {
      if (profile1.wantsChildren === profile2.wantsChildren) score += 15;
    }
    
    return Math.min(Math.round(score), 100);
  }

  matchesPreferences(userProfile, otherProfile) {
    const matches = [];
    
    if (userProfile.matchPreferences?.gender) {
      if (userProfile.matchPreferences.gender === 'both' || 
          userProfile.matchPreferences.gender === otherProfile.gender) {
        matches.push('gender');
      }
    }
    
    if (userProfile.matchPreferences?.ageRange) {
      const { min = 18, max = 99 } = userProfile.matchPreferences.ageRange;
      if (otherProfile.age >= min && otherProfile.age <= max) {
        matches.push('age');
      }
    }
    
    if (userProfile.matchPreferences?.religion && 
        userProfile.matchPreferences.religion === otherProfile.religion) {
      matches.push('religion');
    }
    
    if (userProfile.matchPreferences?.wantsChildren && 
        userProfile.matchPreferences.wantsChildren === otherProfile.wantsChildren) {
      matches.push('wantsChildren');
    }
    
    return matches;
  }

  async calculateDistance(location1, location2) {
    if (!location1?.coordinates || !location2?.coordinates) {
      return 'Unknown';
    }
    
    try {
      const [lon1, lat1] = location1.coordinates;
      const [lon2, lat2] = location2.coordinates;
      
      // Haversine formula for distance calculation
      const R = 6371; // Earth's radius in km
      const dLat = this.deg2rad(lat2 - lat1);
      const dLon = this.deg2rad(lon2 - lon1);
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c;
      
      return `${Math.round(distance)} km`;
    } catch (error) {
      logger.error('Failed to calculate distance:', error);
      return 'Unknown';
    }
  }

  deg2rad(deg) {
    return deg * (Math.PI/180);
  }

  // Get profile stats
  async getProfileStats(userId) {
    try {
      const profile = await Profile.findOne({ userId });
      if (!profile) {
        throw new Error('Profile not found');
      }

      const stats = {
        profileViews: profile.profileViews || 0,
        likeCount: profile.likeCount || 0,
        matchCount: profile.matchCount || 0,
        responseRate: profile.responseRate || 0,
        profileCompletion: profile.profileCompletion || 0,
        lastActive: profile.lastActive,
        daysSinceLastActive: Math.floor(
          (Date.now() - new Date(profile.lastActive).getTime()) / (1000 * 60 * 60 * 24)
        ),
        verificationBadges: profile.verificationBadges?.length || 0,
        isVerified: profile.isVerified || false
      };

      return stats;
    } catch (error) {
      logger.error('Failed to get profile stats:', error);
      throw error;
    }
  }

  // Increment profile views
  async incrementProfileViews(profileId) {
    try {
      await Profile.findByIdAndUpdate(profileId, {
        $inc: { profileViews: 1 },
        $set: { lastViewed: new Date() }
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

      const validBadges = ["email", "phone", "photo", "document", "social"];
      
      if (!validBadges.includes(badge)) {
        throw new Error('Invalid badge type');
      }

      if (!profile.verificationBadges) {
        profile.verificationBadges = [];
      }

      if (profile.verificationBadges.includes(badge)) {
        throw new Error('Badge already exists');
      }

      profile.verificationBadges.push(badge);
      profile.isVerified = profile.verificationBadges.length > 0;
      
      await profile.save();

      return profile;
    } catch (error) {
      logger.error('Failed to add verification badge:', error);
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

      const completion = Math.round((completed / fields.length) * 100);

      // Get missing fields
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

  getMissingFields(profile) {
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
  }
}

module.exports = new ProfileService();