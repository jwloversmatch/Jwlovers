// models/User/datingUserSchema.js - FINAL FIXED VERSION
// ONLY account-level data, NO profile/preferences data
const mongoose = require("mongoose");

const datingUserSchema = new mongoose.Schema({
  // ========== REFERENCES ==========
  profile: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: false,
  },

  // ========== DATING SPECIFIC VERIFICATION ==========
  ageVerified: {
    type: Boolean,
    default: false,
  },

  ageVerifiedAt: Date,

  // ========== PRESENCE & ONLINE STATUS ==========
  // NO isOnline field - derived from status + lastSeen
  presence: {
    status: {
      type: String,
      enum: ['online', 'away', 'busy', 'offline'],
      default: 'offline'
    },
    lastSeen: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now }
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
    averageResponseTime: { type: Number, default: 0 },
    matchRate: { type: Number, default: 0, min: 0, max: 100 },
    streakDays: { type: Number, default: 0 }
  },

  // ========== DATING ACCOUNT FEATURES ==========
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
    default: 50,
    min: 0,
    max: 100
  },

  lastMatchRefresh: {
    type: Date,
    default: Date.now
  },

  compatibilityScores: {
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
    default: Date.now
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
datingUserSchema.index({ 'presence.status': 1, 'presence.lastActive': -1 });

// ========== VIRTUAL PROPERTIES ==========
// ONLINE STATUS - DERIVED FROM PRESENCE STATUS + LAST SEEN
datingUserSchema.virtual("isOnline").get(function () {
  return this.presence?.status === 'online' && 
         this.presence?.lastSeen && 
         (new Date() - this.presence.lastSeen) < 5 * 60 * 1000; // 5 minutes
});

// AGE - POPULATED FROM PROFILE
datingUserSchema.virtual("age").get(function () {
  if (!this.profile || !this.populated('profile')) return null;
  return this.profile.age;
});

// COMPLETE DATING PROFILE
datingUserSchema.virtual("hasCompleteDatingProfile").get(function () {
  if (!this.profile || !this.populated('profile')) return false;
  return this.profile.progress?.completion >= 70 && this.ageVerified;
});

// VERIFIED USER
datingUserSchema.virtual("isVerifiedUser").get(function () {
  if (!this.profile || !this.populated('profile')) return false;
  const badges = this.profile.badges?.map(b => b.type) || [];
  return badges.includes('phone') && badges.includes('email');
});

// TRAVEL MODE ACTIVE
datingUserSchema.virtual("isCurrentlyTraveling").get(function () {
  return this.travelMode?.enabled && 
         this.travelMode.expiresAt && 
         new Date(this.travelMode.expiresAt) > new Date();
});

// BOOST ACTIVE
datingUserSchema.virtual("isBoostActive").get(function () {
  return this.boost?.isActive && 
         this.boost.expiresAt && 
         new Date(this.boost.expiresAt) > new Date();
});

// ========== INSTANCE METHODS ==========
/**
 * GET DATING PROFILE FOR VIEWING
 * This is the PUBLIC facing dating profile
 * Preferences and private settings are only shown to self
 */
datingUserSchema.methods.getDatingProfile = async function (viewerId = null) {
  await this.populate({
    path: 'profile',
    select: 'basic.userName basic.bio photos.profile.url photos.gallery basic.age basic.gender location.city location.country lifestyle.hobbies badges progress.completion relationship.lookingFor settings.tags datingPreferences datingPrivacySettings'
  });

  const isSelf = viewerId && viewerId.toString() === this._id.toString();
  const profile = this.profile;

  // ===== PUBLIC PROFILE DATA =====
  const datingProfile = {
    id: this._id,
    profileId: profile._id,
    userName: profile.basic?.userName,
    avatar: profile.photos?.profile?.url,
    age: profile.datingPrivacySettings?.showAge ? profile.age : null,
    bio: profile.basic?.bio,
    interests: profile.lifestyle?.hobbies || [],
    location: this.getVisibleLocation(viewerId, profile),
    lookingFor: this.getVisibleLookingFor(viewerId, profile),
    isVerified: this.isVerifiedUser,
    isPremium: this.isPremium,
    isBoostActive: this.isBoostActive,
    profileCompletion: profile.progress?.completion || 0,
    verificationBadges: profile.badges?.map(b => b.type) || [],
    tags: profile.settings?.tags || [],
    // Presence - derived from status + lastSeen
    presence: {
      status: this.presence?.status || 'offline',
      lastSeen: this.getVisibleLastSeen(viewerId),
      isOnline: this.isOnline
    }
  };

  // ===== SELF-ONLY PRIVATE DATA =====
  if (isSelf) {
    datingProfile.datingStats = this.datingStats;
    datingProfile.datingPreferences = profile.datingPreferences; // From Profile model
    datingProfile.datingPrivacySettings = profile.datingPrivacySettings; // From Profile model
    datingProfile.datingNotificationSettings = profile.datingNotificationSettings; // From Profile model
    datingProfile.ageVerified = this.ageVerified;
    datingProfile.incognitoMode = this.incognitoMode;
    datingProfile.travelMode = this.travelMode;
    datingProfile.presence = this.presence; // Full presence data
    datingProfile.email = this.email; // Only self sees email
    datingProfile.phoneNumber = this.phoneNumber; // Only self sees phone
  }

  return datingProfile;
};

/**
 * GET VISIBLE LOCATION BASED ON PRIVACY SETTINGS
 */
datingUserSchema.methods.getVisibleLocation = function(viewerId = null, profile) {
  if (!profile || !profile.location) return null;

  const isSelf = viewerId && viewerId.toString() === this._id.toString();

  if (isSelf || profile.datingPrivacySettings?.showDistance) {
    return {
      city: profile.location.city,
      country: profile.location.country,
      distance: this.calculateDistance(viewerId)
    };
  }

  return {
    city: profile.location.city,
    country: profile.location.country
  };
};

/**
 * GET VISIBLE LOOKING FOR (NOT FULL PREFERENCES)
 */
datingUserSchema.methods.getVisibleLookingFor = function(viewerId = null, profile) {
  const isSelf = viewerId && viewerId.toString() === this._id.toString();

  if (isSelf) {
    return profile.relationship?.lookingFor || [];
  }

  // Public view - only show lookingFor, not full preferences
  return profile.relationship?.lookingFor || ["dating"];
};

/**
 * GET VISIBLE LAST SEEN BASED ON PRIVACY SETTINGS
 */
datingUserSchema.methods.getVisibleLastSeen = function(viewerId = null) {
  const isSelf = viewerId && viewerId.toString() === this._id.toString();

  if (isSelf) {
    return this.presence?.lastSeen || this.datingStats?.lastActiveDate;
  }

  // Need to populate profile to check privacy settings
  if (!this.populated('profile')) {
    return null;
  }

  const privacySettings = this.profile?.datingPrivacySettings;
  
  if (privacySettings?.showLastActive === 'everyone') {
    return this.presence?.lastSeen || this.datingStats?.lastActiveDate;
  } else if (privacySettings?.showLastActive === 'matches') {
    const isMatch = this.isMatch(viewerId);
    return isMatch ? (this.presence?.lastSeen || this.datingStats?.lastActiveDate) : null;
  }

  return null;
};

/**
 * CHECK IF USER IS A MATCH WITH ANOTHER USER
 */
datingUserSchema.methods.isMatch = async function(otherUserId) {
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

/**
 * CALCULATE DISTANCE (PLACEHOLDER)
 */
datingUserSchema.methods.calculateDistance = function(viewerId) {
  if (!viewerId || viewerId.toString() === this._id.toString()) {
    return 0;
  }
  return null;
};

/**
 * CHECK IF USER IS WITHIN PREFERENCES OF ANOTHER USER
 * Uses datingPreferences from Profile model
 */
datingUserSchema.methods.isWithinPreferences = async function(targetUserId) {
  // Need to populate profile to get preferences
  if (!this.populated('profile')) {
    await this.populate('profile');
  }

  const targetUser = await mongoose.model('DatingUser').findById(targetUserId).populate('profile');
  
  if (!targetUser || !targetUser.profile) return false;

  const myPreferences = this.profile?.datingPreferences;
  const targetProfile = targetUser.profile;
  const targetAge = targetProfile.age;

  // Age range check
  if (targetAge < myPreferences?.ageRange?.min || targetAge > myPreferences?.ageRange?.max) {
    return false;
  }

  // Gender preference check
  const myGenderPrefs = this.profile?.preferences?.basic?.gender || [];
  if (myGenderPrefs.length > 0 && !myGenderPrefs.includes('any')) {
    if (!myGenderPrefs.includes(targetProfile.basic?.gender)) {
      return false;
    }
  }

  // Looking for match check
  const myLookingFor = this.profile?.relationship?.lookingFor || [];
  const theirLookingFor = targetProfile.relationship?.lookingFor || [];

  if (myLookingFor.length > 0 && theirLookingFor.length > 0) {
    const hasCommonGoal = myLookingFor.some(goal => theirLookingFor.includes(goal));
    if (!hasCommonGoal) {
      return false;
    }
  }

  return true;
};

/**
 * ACTIVATE TRAVEL MODE
 */
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

/**
 * ACTIVATE BOOST
 */
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

/**
 * UPDATE DATING STATISTICS
 */
datingUserSchema.methods.updateDatingStats = async function(updates) {
  Object.keys(updates).forEach(key => {
    if (this.datingStats[key] !== undefined) {
      if (key === 'averageResponseTime') {
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
  this.presence.lastActive = new Date();
  this.presence.lastSeen = new Date();

  return await this.save({ validateBeforeSave: false });
};

/**
 * UPDATE PRESENCE STATUS
 */
datingUserSchema.methods.updatePresence = async function(status = 'online') {
  this.presence = {
    status,
    lastSeen: new Date(),
    lastActive: new Date()
  };
  this.datingStats.lastActiveDate = new Date();

  return await this.save({ validateBeforeSave: false });
};

/**
 * CHECK IF USER IS CURRENTLY ACTIVE
 */
datingUserSchema.methods.isCurrentlyActive = function() {
  const lastActive = this.presence?.lastActive || this.datingStats?.lastActiveDate;
  if (!lastActive) return false;

  const now = new Date();
  const minutesSinceLastActive = (now - lastActive) / (1000 * 60);

  return minutesSinceLastActive < 5 && this.presence?.status === 'online';
};

// ========== STATIC METHODS ==========
/**
 * FIND COMPATIBLE USERS FOR DATING
 */
datingUserSchema.statics.findCompatibleUsers = async function(userId, options = {}) {
  const currentUser = await this.findById(userId).populate('profile');

  if (!currentUser || !currentUser.profile) {
    throw new Error('User or profile not found');
  }

  const myPreferences = currentUser.profile.datingPreferences;
  const myLocation = currentUser.profile.location;

  const query = {
    _id: { $ne: userId },
    'profile.settings.isVisible': true,
    'profile.settings.isPaused': false,
    isShadowBanned: false,
    'profile.progress.completion': { $gte: options.minCompletion || 60 }
  };

  // Age range filter
  const today = new Date();
  const minBirthDate = new Date(today.getFullYear() - myPreferences.ageRange.max - 1, today.getMonth(), today.getDate());
  const maxBirthDate = new Date(today.getFullYear() - myPreferences.ageRange.min, today.getMonth(), today.getDate());

  query['profile.basic.dateOfBirth'] = { $gte: minBirthDate, $lte: maxBirthDate };

  // Gender preference filter
  const genderPrefs = currentUser.profile.preferences?.basic?.gender || [];
  if (genderPrefs.length > 0 && !genderPrefs.includes('any')) {
    query['profile.basic.gender'] = { $in: genderPrefs };
  }

  // Distance filter
  if (myLocation?.coordinates && myPreferences.distance) {
    query['profile.location.coordinates'] = {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: myLocation.coordinates
        },
        $maxDistance: myPreferences.distance * 1000
      }
    };
  }

  // Exclude seen profiles
  if (currentUser.seenProfiles && currentUser.seenProfiles.length > 0) {
    query['profile._id'] = { $nin: currentUser.seenProfiles };
  }

  return this.find(query)
    .populate({
      path: 'profile',
      select: 'basic.userName basic.bio photos.profile.url basic.age basic.gender location.city location.country lifestyle.hobbies badges progress.completion relationship.lookingFor datingPreferences'
    })
    .limit(options.limit || 20)
    .skip(options.skip || 0)
    .sort({
      matchScore: -1,
      isPremium: -1,
      'profile.progress.completion': -1
    });
};

/**
 * FIND NEARBY ACTIVE USERS
 */
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
    'profile.settings.isVisible': true,
    isShadowBanned: false,
    'presence.lastActive': {
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

    query['profile.basic.dateOfBirth'] = conditions;
  }

  return this.find(query)
    .populate({
      path: 'profile',
      select: 'basic.userName photos.profile.url basic.age basic.gender location.city lifestyle.hobbies'
    })
    .limit(options.limit || 50)
    .sort({ 'presence.lastActive': -1 });
};

// ========== MIDDLEWARE ==========
datingUserSchema.pre('save', function() {
  try {
    // Update lastActiveDate when relevant fields change
    if (this.isModified('datingStats') ||
        this.isModified('travelMode') ||
        this.isModified('incognitoMode') ||
        this.isModified('presence')) {
      this.datingStats.lastActiveDate = new Date();
    }

    // Set default travelMode expiry
    if (this.travelMode?.enabled && !this.travelMode.expiresAt) {
      this.travelMode.expiresAt = new Date(Date.now() + (72 * 60 * 60 * 1000));
    }

    // Set default boost expiry
    if (this.boost?.isActive && !this.boost.expiresAt) {
      this.boost.expiresAt = new Date(Date.now() + (60 * 60 * 1000));
    }

    // Initialize presence if not set
    if (!this.presence) {
      this.presence = {
        status: 'offline',
        lastSeen: new Date(),
        lastActive: new Date()
      };
    }

  } catch (error) {
    throw error;
  }
});

module.exports = datingUserSchema;