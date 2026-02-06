// models/User/datingUserSchema.js - FIXED VERSION
const mongoose = require("mongoose");

const datingUserSchema = new mongoose.Schema({
  // ========== REFERENCES ==========
  // This schema extends BaseUser, so it has the same _id
  profile: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: false,  
    unique: true
  },
  
  // ========== DATING SPECIFIC VERIFICATION ==========
  ageVerified: {
    type: Boolean,
    default: false,
  },
  
  ageVerifiedAt: Date,
  
  // ========== DATING PREFERENCES ==========
  // Extends Profile.matchPreferences with dating-specific options
  datingPreferences: {
    ageRange: {
      min: { type: Number, min: 18, max: 100, default: 18 },
      max: { type: Number, min: 18, max: 100, default: 100 }
    },
    distance: {
      type: Number,
      min: 1,
      max: 100,
      default: 50
    },
    notificationRadius: {
      type: Number,
      min: 1,
      max: 100,
      default: 10
    },
    dealBreakers: [String],
    preferredMeetingTypes: [{
      type: String,
      enum: ["coffee", "dinner", "drinks", "activity", "virtual", "group"]
    }],
    activityLevel: {
      type: String,
      enum: ["low", "moderate", "high", "very_high"],
      default: "moderate"
    }
  },
  
  // ========== DATING SPECIFIC SETTINGS ==========
  datingNotificationSettings: {
    newMatches: { type: Boolean, default: true },
    newLikes: { type: Boolean, default: true },
    superLikes: { type: Boolean, default: true },
    profileViews: { type: Boolean, default: true },
    safetyAlerts: { type: Boolean, default: true },
    promotionOffers: { type: Boolean, default: false },
    matchSuggestions: { type: Boolean, default: true },
    eventInvitations: { type: Boolean, default: true }
  },
  
  datingPrivacySettings: {
    showAge: { type: Boolean, default: true },
    showDistance: { type: Boolean, default: true },
    showInterests: { type: Boolean, default: true },
    showLastActive: { 
      type: String,
      enum: ["everyone", "matches", "nobody"],
      default: "matches"
    },
    allowMessagesFrom: {
      type: String,
      enum: ["everyone", "matches", "friends", "nobody"],
      default: "everyone"
    },
    hideProfileFrom: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DatingUser'
    }]
  },
  
  // ========== DATING STATISTICS ==========
  datingStats: {
    totalLikes: { type: Number, default: 0 },
    totalDislikes: { type: Number, default: 0 },
    totalMatches: { type: Number, default: 0 },
    totalMessagesSent: { type: Number, default: 0 },
    totalMessagesReceived: { type: Number, default: 0 },
    profileViews: { type: Number, default: 0 },
    lastActiveDate: { type: Date, default: Date.now },
    averageResponseTime: { type: Number, default: 0 }, // in minutes
    matchRate: { type: Number, default: 0, min: 0, max: 100 }, // percentage
    streakDays: { type: Number, default: 0 }
  },
  
  // ========== DATING SPECIFIC FLAGS ==========
  isPremium: {
    type: Boolean,
    default: false
  },
  
  premiumExpiresAt: {
    type: Date,
    default: null
  },
  
  premiumFeatures: [{
    type: String,
    enum: ["unlimited_likes", "see_who_liked_you", "boost_profile", "incognito_mode", "travel_mode", "advanced_filters"]
  }],
  
  incognitoMode: {
    type: Boolean,
    default: false
  },
  
  incognitoModeExpiresAt: Date,
  
  travelMode: {
    enabled: { type: Boolean, default: false },
    location: {
      type: {
        type: String,
        enum: ['Point']
      },
      coordinates: [Number],
      city: String,
      country: String
    },
    activatedAt: Date,
    expiresAt: Date,
    isVisible: { type: Boolean, default: true }
  },
  
  // ========== MATCHING ALGORITHM DATA ==========
  matchScore: {
    type: Number,
    default: 50,  // FIXED: Added default value
    min: 0,
    max: 100
  },
  
  lastMatchRefresh: {
    type: Date,
    default: Date.now  // FIXED: Added default
  },
  
  compatibilityScores: {
    // Store compatibility with users who liked/viewed this user
    type: Map,
    of: Number,
    default: {}
  },
  
  // ========== DATING SECURITY ==========
  reportedCount: { type: Number, default: 0 },
  warningCount: { type: Number, default: 0 },
  isShadowBanned: { type: Boolean, default: false },
  shadowBanExpiresAt: Date,
  lastSafetyCheck: {
    type: Date,
    default: Date.now  // FIXED: Added default
  },
  
  // ========== DATING ACTIVITY ==========
  dailyActivity: [{
    date: { type: Date, default: Date.now },
    likesGiven: { type: Number, default: 0 },
    likesReceived: { type: Number, default: 0 },
    matchesMade: { type: Number, default: 0 },
    messagesSent: { type: Number, default: 0 }
  }],
  
  // ========== DATING QUEUE & SWIPING ==========
  seenProfiles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile'
  }],
  
  likedProfiles: [{
    profile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile'
    },
    likedAt: { type: Date, default: Date.now },
    isSuperLike: { type: Boolean, default: false }
  }],
  
  // ========== BOOST SETTINGS ==========
  boost: {
    isActive: { type: Boolean, default: false },
    activatedAt: Date,
    expiresAt: Date,
    boostType: {
      type: String,
      enum: ["regular", "super", "mega"]
    },
    multiplier: { type: Number, default: 1 }
  }
}, {
  timestamps: true
});

// ========== INDEXES ==========
datingUserSchema.index({ profile: 1 }, { unique: true });
datingUserSchema.index({ isPremium: 1 });
datingUserSchema.index({ 'datingStats.lastActiveDate': -1 });
datingUserSchema.index({ matchScore: -1 });
datingUserSchema.index({ incognitoMode: 1 });
datingUserSchema.index({ 'travelMode.enabled': 1 });
datingUserSchema.index({ isShadowBanned: 1 });
datingUserSchema.index({ 'boost.isActive': 1, 'boost.expiresAt': 1 });

// ========== VIRTUAL PROPERTIES ==========
datingUserSchema.virtual("age").get(function () {
  if (!this.profile || !this.populated('profile')) return null;
  return this.profile.age;
});

datingUserSchema.virtual("hasCompleteDatingProfile").get(function () {
  if (!this.profile || !this.populated('profile')) return false;
  return this.profile.profileCompletion >= 70 && this.ageVerified;
});

datingUserSchema.virtual("isVerifiedUser").get(function () {
  if (!this.profile || !this.populated('profile')) return false;
  const badges = this.profile.verificationBadges.map(b => b.type);
  return badges.includes('phone') && badges.includes('email');
});

datingUserSchema.virtual("isCurrentlyTraveling").get(function () {
  return this.travelMode?.enabled && 
         this.travelMode.expiresAt && 
         new Date(this.travelMode.expiresAt) > new Date();
});

datingUserSchema.virtual("isBoostActive").get(function () {
  return this.boost?.isActive && 
         this.boost.expiresAt && 
         new Date(this.boost.expiresAt) > new Date();
});

// ========== INSTANCE METHODS ==========
datingUserSchema.methods.getDatingProfile = async function (viewerId = null) {
  await this.populate({
    path: 'profile',
    select: 'userName bio profilePicture photos age gender location city country hobbies verificationBadges profileCompletion'
  });
  
  const isSelf = viewerId && viewerId.toString() === this._id.toString();
  const profile = this.profile;
  
  const datingProfile = {
    id: this._id,
    profileId: profile._id,
    userName: profile.userName,
    avatar: profile.profilePicture?.url,
    age: this.datingPrivacySettings?.showAge ? profile.age : null,
    bio: profile.bio,
    interests: profile.hobbies || [],
    location: this.getVisibleLocation(viewerId),
    preferences: this.getVisiblePreferences(viewerId),
    isVerified: this.isVerifiedUser,
    isPremium: this.isPremium,
    isBoostActive: this.isBoostActive,
    profileCompletion: profile.profileCompletion,
    verificationBadges: profile.verificationBadges.map(b => b.type),
    isOnline: this.isCurrentlyActive(),
    lastSeen: this.getVisibleLastSeen(viewerId),
    tags: profile.datingProfile?.tags || []
  };
  
  // Add dating-specific data for self-viewing
  if (isSelf) {
    datingProfile.datingStats = this.datingStats;
    datingProfile.datingNotificationSettings = this.datingNotificationSettings;
    datingProfile.datingPrivacySettings = this.datingPrivacySettings;
    datingProfile.datingPreferences = this.datingPreferences;
    datingProfile.ageVerified = this.ageVerified;
    datingProfile.incognitoMode = this.incognitoMode;
    datingProfile.travelMode = this.travelMode;
  }
  
  return datingProfile;
};

datingUserSchema.methods.getVisibleLocation = function(viewerId = null) {
  if (!this.profile || !this.profile.location) return null;
  
  const isSelf = viewerId && viewerId.toString() === this._id.toString();
  
  if (isSelf || this.datingPrivacySettings?.showDistance) {
    return {
      city: this.profile.location.city,
      country: this.profile.location.country,
      distance: this.calculateDistance(viewerId)
    };
  }
  
  // For others with privacy restrictions
  return {
    city: this.profile.location.city,
    country: this.profile.location.country
  };
};

datingUserSchema.methods.getVisiblePreferences = function(viewerId = null) {
  const isSelf = viewerId && viewerId.toString() === this._id.toString();
  
  if (isSelf) {
    return {
      ageRange: this.datingPreferences.ageRange,
      distance: this.datingPreferences.distance,
      lookingFor: this.profile.lookingFor
    };
  }
  
  // For others, only show what they're looking for
  return {
    lookingFor: this.profile.lookingFor || ["dating"]
  };
};

datingUserSchema.methods.getVisibleLastSeen = function(viewerId = null) {
  const isSelf = viewerId && viewerId.toString() === this._id.toString();
  
  if (isSelf) {
    return this.datingStats?.lastActiveDate;
  }
  
  // Check privacy settings
  if (this.datingPrivacySettings?.showLastActive === 'everyone') {
    return this.datingStats?.lastActiveDate;
  } else if (this.datingPrivacySettings?.showLastActive === 'matches') {
    // Check if viewerId is a match
    const isMatch = this.isMatch(viewerId);
    return isMatch ? this.datingStats?.lastActiveDate : null;
  }
  
  return null;
};

datingUserSchema.methods.isMatch = async function(otherUserId) {
  // Implementation depends on your Match model
  // This is a placeholder
  const Match = mongoose.model('Match');
  const match = await Match.findOne({
    $or: [
      { user1: this._id, user2: otherUserId },
      { user1: otherUserId, user2: this._id }
    ],
    status: 'matched'
  });
  
  return !!match;
};

datingUserSchema.methods.calculateDistance = function(viewerId) {
  // If viewer is the same user or viewer location not available
  if (!viewerId || viewerId.toString() === this._id.toString()) {
    return 0;
  }
  
  // This would require fetching viewer's location
  // Placeholder implementation
  return null;
};

datingUserSchema.methods.isWithinPreferences = function(targetProfile) {
  const targetAge = targetProfile.age;
  const myAgeRange = this.datingPreferences?.ageRange || { min: 18, max: 100 };
  
  // Check age
  if (targetAge < myAgeRange.min || targetAge > myAgeRange.max) {
    return false;
  }
  
  // Check gender preferences from profile
  const myGenderPrefs = this.profile?.matchPreferences?.gender || [];
  if (myGenderPrefs.length > 0 && !myGenderPrefs.includes('any')) {
    if (!myGenderPrefs.includes(targetProfile.gender)) {
      return false;
    }
  }
  
  // Check lookingFor compatibility
  const myLookingFor = this.profile?.lookingFor || [];
  const theirLookingFor = targetProfile.lookingFor || [];
  
  if (myLookingFor.length > 0 && theirLookingFor.length > 0) {
    const hasCommonGoal = myLookingFor.some(goal => theirLookingFor.includes(goal));
    if (!hasCommonGoal) {
      return false;
    }
  }
  
  return true;
};

datingUserSchema.methods.activateTravelMode = async function(locationData, durationHours = 72) {
  this.travelMode = {
    enabled: true,
    location: {
      type: 'Point',
      coordinates: locationData.coordinates,
      city: locationData.city,
      country: locationData.country
    },
    activatedAt: new Date(),
    expiresAt: new Date(Date.now() + (durationHours * 60 * 60 * 1000)),
    isVisible: true
  };
  
  return await this.save({ validateBeforeSave: false });
};

datingUserSchema.methods.activateBoost = async function(boostType = "regular", durationHours = 1) {
  this.boost = {
    isActive: true,
    activatedAt: new Date(),
    expiresAt: new Date(Date.now() + (durationHours * 60 * 60 * 1000)),
    boostType: boostType,
    multiplier: boostType === "super" ? 3 : boostType === "mega" ? 5 : 2
  };
  
  return await this.save({ validateBeforeSave: false });
};

datingUserSchema.methods.updateDatingStats = async function(updates) {
  Object.keys(updates).forEach(key => {
    if (this.datingStats[key] !== undefined) {
      if (key === 'averageResponseTime') {
        // Calculate new average
        const currentAvg = this.datingStats[key];
        const newValue = updates[key];
        const totalResponses = this.datingStats.totalMessagesReceived || 1;
        this.datingStats[key] = ((currentAvg * totalResponses) + newValue) / (totalResponses + 1);
      } else if (key === 'matchRate') {
        const totalLikes = this.datingStats.totalLikes || 0;
        const totalMatches = this.datingStats.totalMatches || 0;
        this.datingStats[key] = totalLikes > 0 ? (totalMatches / totalLikes) * 100 : 0;
      } else {
        this.datingStats[key] += updates[key];
      }
    }
  });
  
  this.datingStats.lastActiveDate = new Date();
  return await this.save({ validateBeforeSave: false });
};

datingUserSchema.methods.isCurrentlyActive = function() {
  const lastActive = this.datingStats?.lastActiveDate;
  if (!lastActive) return false;
  
  const now = new Date();
  const minutesSinceLastActive = (now - lastActive) / (1000 * 60);
  
  return minutesSinceLastActive < 5; // Considered online if active within last 5 minutes
};

// ========== STATIC METHODS ==========
datingUserSchema.statics.findCompatibleUsers = async function(userId, options = {}) {
  const currentUser = await this.findById(userId).populate('profile');
  
  if (!currentUser || !currentUser.profile) {
    throw new Error('User or profile not found');
  }
  
  const query = {
    _id: { $ne: userId },
    'profile.datingProfile.isVisible': true,
    'profile.datingProfile.isPaused': false,
    isShadowBanned: false,
    'profile.profileCompletion': { $gte: options.minCompletion || 60 }
  };
  
  // Age range filter
  const today = new Date();
  const minBirthDate = new Date(today.getFullYear() - currentUser.datingPreferences.ageRange.max - 1, today.getMonth(), today.getDate());
  const maxBirthDate = new Date(today.getFullYear() - currentUser.datingPreferences.ageRange.min, today.getMonth(), today.getDate());
  
  query['profile.dateOfBirth'] = { $gte: minBirthDate, $lte: maxBirthDate };
  
  // Gender preference
  const genderPrefs = currentUser.profile.matchPreferences?.gender || [];
  if (genderPrefs.length > 0 && !genderPrefs.includes('any')) {
    query['profile.gender'] = { $in: genderPrefs };
  }
  
  // Location filter
  if (currentUser.profile.location?.coordinates && currentUser.datingPreferences.distance) {
    query['profile.location.coordinates'] = {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: currentUser.profile.location.coordinates
        },
        $maxDistance: currentUser.datingPreferences.distance * 1000 // Convert km to meters
      }
    };
  }
  
  // Exclude already seen/liked profiles
  if (currentUser.seenProfiles && currentUser.seenProfiles.length > 0) {
    query['profile._id'] = { $nin: currentUser.seenProfiles };
  }
  
  return this.find(query)
    .populate({
      path: 'profile',
      select: 'userName profilePicture bio age gender location.city location.country hobbies verificationBadges profileCompletion lookingFor'
    })
    .limit(options.limit || 20)
    .skip(options.skip || 0)
    .sort({ 
      matchScore: -1,
      isPremium: -1,
      'profile.profileCompletion': -1 
    });
};

datingUserSchema.statics.findNearbyActiveUsers = function(coordinates, radiusKm = 50, options = {}) {
  const query = {
    'profile.location.coordinates': {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: coordinates
        },
        $maxDistance: radiusKm * 1000
      }
    },
    'profile.datingProfile.isVisible': true,
    isShadowBanned: false,
    'datingStats.lastActiveDate': {
      $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Active in last 7 days
    }
  };
  
  if (options.minAge || options.maxAge) {
    const today = new Date();
    const conditions = {};
    
    if (options.minAge) {
      const maxBirthDate = new Date(today.getFullYear() - options.minAge, today.getMonth(), today.getDate());
      conditions.$lte = maxBirthDate;
    }
    
    if (options.maxAge) {
      const minBirthDate = new Date(today.getFullYear() - options.maxAge - 1, today.getMonth(), today.getDate());
      conditions.$gte = minBirthDate;
    }
    
    query['profile.dateOfBirth'] = conditions;
  }
  
  return this.find(query)
    .populate({
      path: 'profile',
      select: 'userName profilePicture age gender location.city hobbies'
    })
    .limit(options.limit || 50)
    .sort({ 'datingStats.lastActiveDate': -1 });
};

// ========== MIDDLEWARE ==========
datingUserSchema.pre('save', function(next) {
  try {
    // Update last active date on certain changes
    if (this.isModified('datingStats') || 
        this.isModified('travelMode') || 
        this.isModified('incognitoMode')) {
      this.datingStats.lastActiveDate = new Date();
    }
    
    // Ensure travel mode has expiration
    if (this.travelMode?.enabled && !this.travelMode.expiresAt) {
      this.travelMode.expiresAt = new Date(Date.now() + (72 * 60 * 60 * 1000));
    }
    
    // Ensure boost has expiration
    if (this.boost?.isActive && !this.boost.expiresAt) {
      this.boost.expiresAt = new Date(Date.now() + (60 * 60 * 1000));
    }
    
    // Only call next if it's a function
    if (typeof next === 'function') {
      next();
    }
  } catch (error) {
    if (typeof next === 'function') {
      next(error);
    } else {
      throw error;
    }
  }
});

module.exports = datingUserSchema;