// models/Profile/Profile.js - FIXED VERSION
const mongoose = require("mongoose");
const validator = require("validator");

const profileSchema = new mongoose.Schema({
  // ========== RELATIONSHIP ==========
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "BaseUser",
    required: true,
    unique: true,
  },
  
  // ========== USERNAME (for profile URL) ==========
  userName: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
    lowercase: true,
    minlength: [3, "Username must be at least 3 characters"],
    maxlength: [20, "Username cannot exceed 20 characters"],
    validate: {
      validator: function(v) {
        return /^[a-zA-Z0-9_-]+$/.test(v);
      },
      message: "Username can only contain letters, numbers, underscores and hyphens"
    }
  },
  
  // ========== PUBLIC BIO & DETAILS ==========
  bio: {
    type: String,
    maxlength: [500, "Bio cannot exceed 500 characters"],
    default: "",
  },
  
  profilePicture: {
    url: {
      type: String,
      validate: {
        validator: function(v) {
          if (!v) return true;
          return validator.isURL(v, {
            protocols: ['http', 'https'],
            require_protocol: true,
            require_valid_protocol: true
          });
        },
        message: "Please provide a valid profile picture URL"
      }
    },
    verified: { type: Boolean, default: false },
    uploadedAt: { type: Date, default: Date.now }
  },
  
  photos: [{
    url: { 
      type: String, 
      required: true,
      validate: {
        validator: function(v) {
          return validator.isURL(v, {
            protocols: ['http', 'https'],
            require_protocol: true,
            require_valid_protocol: true
          });
        },
        message: "Please provide a valid photo URL"
      }
    },
    order: { type: Number, default: 0 },
    isVerified: { type: Boolean, default: false },
    caption: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  
  // ========== PERSONAL DETAILS ==========
  dateOfBirth: {
    type: Date,
    required: [true, "Date of birth is required"],
    validate: {
      validator: function(v) {
        // Check if v is null/undefined
        if (!v) return false;
        
        // Don't re-wrap if already a Date object
        const birthDate = v instanceof Date ? v : new Date(v);
        
        // Check if valid date
        if (isNaN(birthDate.getTime())) {
          return false;
        }
        
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
        
        return age >= 13 && age <= 100; // General app minimum age
      },
      message: "You must be 13-100 years old"
    }
  },
  
  gender: {
    type: String,
    enum: ["male", "female", "non-binary", "other", "prefer-not-to-say"],
  },
  
  height: {
    type: Number,
    min: 100,
    max: 250,
  },
  
  // ========== LOCATION & BACKGROUND ==========
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    },
    city: String,
    country: String,
    timezone: String,
    lastUpdated: Date
  },
  
  countryOfOrigin: String,
  
  homeLanguage: String,
  
  // ========== RELIGIOUS & SPIRITUAL ==========
  religion: {
    type: String,
    enum: ["christian", "muslim", "hindu", "buddhist", "jewish", "atheist", "agnostic", "other", "prefer_not_to_say"]
  },
  
  servingAs: {
    type: String,
    enum: ["elder", "ministerial_servant", "pioneer", "regular_publisher", "other"]
  },
  
  // ========== RELATIONSHIP STATUS ==========
  relationshipStatus: {
    type: String,
    enum: ["single", "dating", "married", "divorced", "separated", "complicated"],
  },
  
  lookingFor: {
    type: [String],
    enum: ["friendship", "dating", "relationship", "marriage", "casual"]
  },
  
  // ========== FAMILY & CHILDREN ==========
  haveChildren: {
    type: String,
    enum: ["yes", "no", "prefer_not_to_say"]
  },
  
  wantsChildren: {
    type: String,
    enum: ["yes", "no", "maybe", "prefer_not_to_say"]
  },
  
  // ========== EDUCATION & CAREER ==========
  education: {
    type: String,
    enum: ["high_school", "some_college", "bachelors", "masters", "phd", "other"],
  },
  
  occupation: String,
  
  income: {
    type: String,
    enum: ["under_30k", "30k_60k", "60k_100k", "100k_150k", "150k_plus", "prefer_not_to_say"],
  },
  
  // ========== LIFESTYLE & INTERESTS ==========
  hobbies: [String],
  
  languages: [{
    language: String,
    proficiency: {
      type: String,
      enum: ["basic", "conversational", "fluent", "native"]
    }
  }],
  
  lifestyle: {
    smoking: {
      type: String,
      enum: ["never", "occasionally", "socially", "regularly"]
    },
    drinking: {
      type: String,
      enum: ["never", "occasionally", "socially", "regularly"]
    },
    exercise: {
      type: String,
      enum: ["never", "occasionally", "weekly", "daily"]
    }
  },
  
  // ========== MATCH PREFERENCES (Generic) ==========
  matchPreferences: {
    gender: {
      type: [String],
      enum: ["male", "female", "non-binary", "any"]
    },
    ageRange: {
      min: { type: Number, min: 18, max: 100, default: 18 },
      max: { type: Number, min: 18, max: 100, default: 100 }
    },
    locationRange: { 
      type: Number, 
      min: 1, 
      max: 1000, 
      default: 50 
    },
    relationshipGoals: [{
      type: String,
      enum: ["casual_dating", "serious_relationship", "marriage", "friendship"]
    }],
    mustHaves: [String],
    dealBreakers: [String]
  },
  
  // ========== DATING PROFILE FLAGS ==========
  datingProfile: {
    isVisible: { type: Boolean, default: true },
    isPaused: { type: Boolean, default: false },
    pausedUntil: Date,
    tags: [String],
    preferredLocations: [{
      city: String,
      country: String,
      coordinates: [Number]
    }]
  },
  
  // ========== VERIFICATION BADGES ==========
  verificationBadges: [{
    type: {
      type: String,
      enum: ["email", "phone", "photo", "identity", "premium", "social"],
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
  
  // ========== STATISTICS ==========
  profileViews: { type: Number, default: 0 },
  likeCount: { type: Number, default: 0 },
  matchCount: { type: Number, default: 0 },
  responseRate: { type: Number, default: 0, min: 0, max: 100 },
  
  // ========== PROFILE COMPLETION ==========
  profileCompletion: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  // ========== METADATA ==========
  lastProfileUpdate: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// ========== INDEXES ==========
profileSchema.index({ userId: 1 }, { unique: true });
profileSchema.index({ userName: 1 }, { sparse: true });
profileSchema.index({ 'location.coordinates': '2dsphere' });
profileSchema.index({ profileCompletion: -1 });
profileSchema.index({ gender: 1, 'matchPreferences.gender': 1 });
profileSchema.index({ religion: 1 });
profileSchema.index({ 'datingProfile.isVisible': 1, 'datingProfile.isPaused': 1 });
profileSchema.index({ 'verificationBadges.type': 1 });
profileSchema.index({ dateOfBirth: 1 });

// ========== VIRTUAL PROPERTIES ==========
profileSchema.virtual('age').get(function() {
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

profileSchema.virtual('isVerified').get(function() {
  return this.verificationBadges && this.verificationBadges.length > 0;
});

profileSchema.virtual('hasCompleteProfile').get(function() {
  return this.profileCompletion >= 80;
});

profileSchema.virtual('isEligibleForDating').get(function() {
  const age = this.age;
  return age >= 18 && age <= 100 && this.datingProfile?.isVisible && !this.datingProfile?.isPaused;
});

// ========== INSTANCE METHODS ==========
profileSchema.methods.calculateCompletion = function() {
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
    const value = field.split('.').reduce((obj, key) => obj && obj[key], this);
    
    if (condition) {
      if (condition(value)) completion += weight;
    } else if (value) {
      completion += weight;
    }
  });
  
  this.profileCompletion = Math.min(completion, 100);
  return this.profileCompletion;
};

profileSchema.methods.addVerificationBadge = function(badgeType, verifiedBy = null, expiresAt = null) {
  const validBadges = ["email", "phone", "photo", "identity", "premium", "social"];
  
  if (!validBadges.includes(badgeType)) {
    throw new Error(`Invalid badge type: ${badgeType}`);
  }
  
  // Remove existing badge of same type
  this.verificationBadges = this.verificationBadges.filter(badge => badge.type !== badgeType);
  
  // Add new badge
  this.verificationBadges.push({
    type: badgeType,
    verifiedAt: new Date(),
    expiresAt,
    verifiedBy
  });
  
  this.calculateCompletion();
  return true;
};

profileSchema.methods.getPublicProfile = function(includeSensitive = false) {
  const profile = {
    id: this._id,
    userId: this.userId,
    userName: this.userName,
    bio: this.bio,
    profilePicture: this.profilePicture,
    photos: this.photos,
    age: this.age,
    gender: this.gender,
    location: {
      city: this.location?.city,
      country: this.location?.country
    },
    countryOfOrigin: this.countryOfOrigin,
    homeLanguage: this.homeLanguage,
    relationshipStatus: this.relationshipStatus,
    lookingFor: this.lookingFor,
    hobbies: this.hobbies,
    lifestyle: this.lifestyle,
    verificationBadges: this.verificationBadges.map(b => b.type),
    profileCompletion: this.profileCompletion
  };
  
  if (includeSensitive) {
    profile.education = this.education;
    profile.occupation = this.occupation;
    profile.languages = this.languages;
    profile.height = this.height;
    profile.religion = this.religion;
    profile.servingAs = this.servingAs;
  }
  
  return profile;
};

profileSchema.methods.updateLocation = function(coordinates, city, country, timezone) {
  this.location = {
    type: 'Point',
    coordinates: coordinates,
    city: city,
    country: country,
    timezone: timezone,
    lastUpdated: new Date()
  };
  
  return this.save();
};

// ========== STATIC METHODS ==========
profileSchema.statics.findByUserId = function(userId) {
  return this.findOne({ userId }).populate('userId', 'firstName lastName email phoneNumber');
};

profileSchema.statics.findNearby = function(coordinates, maxDistance = 50000, options = {}) {
  const query = {
    'location.coordinates': {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: coordinates
        },
        $maxDistance: maxDistance
      }
    },
    'datingProfile.isVisible': true,
    'datingProfile.isPaused': false,
    profileCompletion: { $gte: options.minCompletion || 50 }
  };
  
  if (options.gender) {
    query.gender = options.gender;
  }
  
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
    
    query.dateOfBirth = conditions;
  }
  
  return this.find(query)
    .select('userName profilePicture bio age gender location.city location.country hobbies profileCompletion')
    .limit(options.limit || 50)
    .skip(options.skip || 0);
};

profileSchema.statics.getDefaultValues = function() {
  return {
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
      pausedUntil: null,
      tags: [],
      preferredLocations: []
    },
    verificationBadges: [],
    profileViews: 0,
    likeCount: 0,
    matchCount: 0,
    responseRate: 0,
    profileCompletion: 0
  };
};

// ========== MIDDLEWARE ==========
profileSchema.pre('save', function(next) {
  if (this.isModified('userName') && this.userName) {
    this.userName = this.userName.toLowerCase();
  }
  
  if (this.isModified('bio') || this.isModified('profilePicture') || 
      this.isModified('photos') || this.isModified('hobbies') ||
      this.isModified('location') || this.isModified('verificationBadges')) {
    this.lastProfileUpdate = new Date();
    // this.calculateCompletion();
  }
  
  next();
});

module.exports = mongoose.model("Profile", profileSchema);