// models/User/datingUserSchema.js - UPDATED
const mongoose = require("mongoose");
const validator = require("validator");

const datingUserSchema = new mongoose.Schema({
  // ========== DATING PROFILE SPECIFIC ==========
  dateOfBirth: {
    type: Date,
    required: [true, "Date of birth is required for dating app"],
    validate: {
      validator: function(v) {
        const today = new Date();
        const birthDate = new Date(v);
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
        
        return age >= 18 && age <= 100;
      },
      message: "You must be 18-100 years old to register"
    }
  },
  
  avatar: {
    type: String,
    default: null,
    validate: {
      validator: function(v) {
        if (!v) return true;
        return validator.isURL(v, {
          protocols: ['http', 'https'],
          require_protocol: true,
          require_valid_protocol: true
        });
      },
      message: "Please provide a valid avatar URL"
    }
  },
  
  ageVerified: {
    type: Boolean,
    default: false,
  },
  
  // ========== DATING PREFERENCES ==========
  preferences: {
    lookingFor: {
      type: [String],
      enum: ["friendship", "dating", "relationship", "casual", "marriage"],
      default: ["dating"]
    },
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
    interests: [{
      type: String,
      trim: true
    }]
  },
  
  // ========== LOCATION (For matching) ==========
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      index: '2dsphere'
    },
    city: String,
    country: String,
    timezone: String,
    lastUpdated: Date
  },
  
  // ========== DATING SPECIFIC SETTINGS ==========
  // Note: messagingPreferences, phoneNumber, phoneVerified, sharePhone are in base schema
  // We'll override some settings with dating-specific versions
  
  datingNotificationSettings: {
    newMessages: { type: Boolean, default: true },
    newMatches: { type: Boolean, default: true },
    likes: { type: Boolean, default: true },
    superLikes: { type: Boolean, default: true },
    profileViews: { type: Boolean, default: true },
    safetyAlerts: { type: Boolean, default: true },
    promotionOffers: { type: Boolean, default: false }
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
    }
  },
  
  // ========== DATING PROFILE COMPLETION ==========
  profileCompletion: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  
  bio: {
    type: String,
    maxlength: [500, "Bio cannot exceed 500 characters"],
    default: ""
  },
  
  // ========== DATING STATISTICS ==========
  datingStats: {
    totalLikes: { type: Number, default: 0 },
    totalMatches: { type: Number, default: 0 },
    totalMessagesSent: { type: Number, default: 0 },
    totalMessagesReceived: { type: Number, default: 0 },
    profileViews: { type: Number, default: 0 },
    lastActiveDate: { type: Date, default: Date.now }
  },
  
  // ========== VERIFICATION BADGES ==========
  verificationBadges: [{
    type: {
      type: String,
      enum: ['phone', 'email', 'photo', 'identity', 'social', 'premium'],
      required: true
    },
    verifiedAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: Date,
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BaseUser'
    }
  }],
  
  // ========== DATING SPECIFIC FLAGS ==========
  isPremium: {
    type: Boolean,
    default: false
  },
  
  premiumExpiresAt: {
    type: Date,
    default: null
  },
  
  incognitoMode: {
    type: Boolean,
    default: false
  },
  
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
    expiresAt: Date
  }
});

// ========== DATING SPECIFIC INDEXES ==========
datingUserSchema.index({ 'location.coordinates': '2dsphere' });
datingUserSchema.index({ 'preferences.lookingFor': 1 });
datingUserSchema.index({ dateOfBirth: 1 });
datingUserSchema.index({ 'datingStats.lastActiveDate': -1 });
datingUserSchema.index({ 'preferences.ageRange.min': 1, 'preferences.ageRange.max': 1 });
datingUserSchema.index({ profileCompletion: -1 });
datingUserSchema.index({ isPremium: 1, 'datingStats.lastActiveDate': -1 });

// ========== DATING SPECIFIC VIRTUAL PROPERTIES ==========
datingUserSchema.virtual("age").get(function () {
  if (!this.dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(this.dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
});

datingUserSchema.virtual("hasCompleteProfile").get(function () {
  return this.profileCompletion >= 80;
});

datingUserSchema.virtual("isVerifiedUser").get(function () {
  const requiredBadges = ['email', 'phone'];
  const userBadges = this.verificationBadges?.map(b => b.type) || [];
  return requiredBadges.every(badge => userBadges.includes(badge));
});

datingUserSchema.virtual("isCurrentlyTraveling").get(function () {
  return this.travelMode?.enabled && 
         this.travelMode.expiresAt && 
         new Date(this.travelMode.expiresAt) > new Date();
});

// ========== DATING SPECIFIC METHODS ==========
datingUserSchema.methods.getDatingProfile = function (viewerId = null) {
  const isSelf = viewerId && viewerId.toString() === this._id.toString();
  const profile = {
    id: this._id,
    userName: this.userName,
    firstName: this.firstName,
    lastName: this.lastName,
    avatar: this.avatar,
    age: this.datingPrivacySettings?.showAge ? this.age : null,
    bio: this.bio,
    interests: this.preferences?.interests || [],
    location: this.getVisibleLocation(viewerId),
    preferences: this.getVisiblePreferences(viewerId),
    isVerified: this.isVerifiedUser,
    isPremium: this.isPremium,
    profileCompletion: this.profileCompletion,
    isOnline: isSelf ? this.presence?.status === 'online' : undefined,
    lastSeen: isSelf ? this.presence?.lastSeen : this.getVisibleLastSeen(viewerId),
    verificationBadges: this.verificationBadges?.map(b => b.type) || []
  };
  
  // Add dating stats if viewing own profile
  if (isSelf) {
    profile.datingStats = this.datingStats;
    profile.datingNotificationSettings = this.datingNotificationSettings;
    profile.datingPrivacySettings = this.datingPrivacySettings;
  }
  
  return profile;
};

datingUserSchema.methods.getVisibleLocation = function(viewerId = null) {
  if (!this.location) return null;
  
  const isSelf = viewerId && viewerId.toString() === this._id.toString();
  
  if (isSelf) {
    return {
      city: this.location.city,
      country: this.location.country,
      timezone: this.location.timezone,
      coordinates: this.location.coordinates
    };
  }
  
  // For others, only show city and country
  return {
    city: this.location.city,
    country: this.location.country
  };
};

datingUserSchema.methods.getVisiblePreferences = function(viewerId = null) {
  const isSelf = viewerId && viewerId.toString() === this._id.toString();
  
  if (isSelf) {
    return this.preferences;
  }
  
  // For others, only show lookingFor
  return {
    lookingFor: this.preferences?.lookingFor || ["dating"]
  };
};

datingUserSchema.methods.getVisibleLastSeen = function(viewerId = null) {
  const isSelf = viewerId && viewerId.toString() === this._id.toString();
  
  if (isSelf) {
    return this.presence?.lastSeen;
  }
  
  // Check privacy settings
  if (this.datingPrivacySettings?.showLastActive === 'everyone') {
    return this.datingStats?.lastActiveDate;
  } else if (this.datingPrivacySettings?.showLastActive === 'matches') {
    // You would check if viewerId is a match
    // For now, return null if not self
    return null;
  }
  
  return null;
};

datingUserSchema.methods.isWithinPreferences = function(targetUser) {
  const targetAge = targetUser.age;
  const myAgeRange = this.preferences?.ageRange || { min: 18, max: 100 };
  
  return targetAge >= myAgeRange.min && targetAge <= myAgeRange.max;
};

datingUserSchema.methods.calculateProfileCompletion = function() {
  let completion = 0;
  const totalPoints = 10;
  
  // Avatar (1 point)
  if (this.avatar) completion += 1;
  
  // Bio (2 points)
  if (this.bio && this.bio.length > 50) completion += 2;
  
  // Interests (2 points)
  if (this.preferences?.interests && this.preferences.interests.length >= 3) completion += 2;
  
  // Location (2 points)
  if (this.location?.city && this.location?.country) completion += 2;
  
  // Verification badges (3 points)
  const badgeCount = this.verificationBadges?.length || 0;
  completion += Math.min(badgeCount, 3);
  
  this.profileCompletion = Math.round((completion / totalPoints) * 100);
  return this.profileCompletion;
};

datingUserSchema.methods.addVerificationBadge = async function(badgeType, verifiedBy = null, expiresAt = null) {
  this.verificationBadges = this.verificationBadges || [];
  
  // Remove existing badge of same type
  this.verificationBadges = this.verificationBadges.filter(b => b.type !== badgeType);
  
  // Add new badge
  this.verificationBadges.push({
    type: badgeType,
    verifiedAt: new Date(),
    expiresAt,
    verifiedBy
  });
  
  // Recalculate profile completion
  this.calculateProfileCompletion();
  
  return await this.save({ validateBeforeSave: false });
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
    expiresAt: new Date(Date.now() + (durationHours * 60 * 60 * 1000))
  };
  
  return await this.save({ validateBeforeSave: false });
};

datingUserSchema.methods.deactivateTravelMode = async function() {
  this.travelMode = {
    enabled: false,
    location: null,
    activatedAt: null,
    expiresAt: null
  };
  
  return await this.save({ validateBeforeSave: false });
};

// ========== DATING SPECIFIC STATIC METHODS ==========
datingUserSchema.statics.findNearbyUsers = function(userId, coordinates, maxDistance = 50000, options = {}) {
  const query = {
    _id: { $ne: userId },
    'location.coordinates': {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: coordinates
        },
        $maxDistance: maxDistance
      }
    },
    accountStatus: 'active',
    profileCompletion: { $gte: options.minProfileCompletion || 50 }
  };
  
  // Apply filters
  if (options.ageRange) {
    const today = new Date();
    const maxBirthDate = new Date(today.getFullYear() - options.ageRange.min, today.getMonth(), today.getDate());
    const minBirthDate = new Date(today.getFullYear() - options.ageRange.max - 1, today.getMonth(), today.getDate());
    
    query.dateOfBirth = { $gte: minBirthDate, $lte: maxBirthDate };
  }
  
  if (options.lookingFor) {
    query['preferences.lookingFor'] = { $in: Array.isArray(options.lookingFor) ? options.lookingFor : [options.lookingFor] };
  }
  
  return this.find(query)
    .select('firstName lastName avatar userName age bio preferences.lookingFor location.city profileCompletion')
    .limit(options.limit || 50)
    .skip(options.skip || 0);
};

datingUserSchema.statics.findCompatibleUsers = function(userId, userPreferences, coordinates, options = {}) {
  const query = {
    _id: { $ne: userId },
    accountStatus: 'active',
    profileCompletion: { $gte: 70 }
  };
  
  // Age compatibility
  if (userPreferences.ageRange) {
    const today = new Date();
    const maxBirthDate = new Date(today.getFullYear() - userPreferences.ageRange.min, today.getMonth(), today.getDate());
    const minBirthDate = new Date(today.getFullYear() - userPreferences.ageRange.max - 1, today.getMonth(), today.getDate());
    
    query.dateOfBirth = { $gte: minBirthDate, $lte: maxBirthDate };
  }
  
  // Distance compatibility
  if (coordinates && userPreferences.distance) {
    query['location.coordinates'] = {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: coordinates
        },
        $maxDistance: userPreferences.distance * 1000 // Convert km to meters
      }
    };
  }
  
  // Looking for compatibility
  if (userPreferences.lookingFor && userPreferences.lookingFor.length > 0) {
    query['preferences.lookingFor'] = { $in: userPreferences.lookingFor };
  }
  
  return this.find(query)
    .select('firstName lastName avatar userName age bio preferences.lookingFor location.city profileCompletion verificationBadges')
    .limit(options.limit || 100)
    .skip(options.skip || 0)
    .sort({ profileCompletion: -1, 'verificationBadges': -1 });
};

module.exports = datingUserSchema;