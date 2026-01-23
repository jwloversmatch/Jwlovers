const mongoose = require("mongoose");

const profileSchema = new mongoose.Schema({
  // ========== RELATIONSHIP ==========
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
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
    url: String,
    verified: { type: Boolean, default: false },
    uploadedAt: { type: Date, default: Date.now }
  },
  
  photos: [{
    url: { type: String, required: true },
    order: { type: Number, default: 0 },
    isVerified: { type: Boolean, default: false },
    caption: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  
  // ========== PERSONAL DETAILS ==========
  dateOfBirth: Date,
  
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
  countryOfOrigin: String,
  
  currentLocation: {
    city: String,
    country: String
  },
  
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
  
  // ========== MATCH PREFERENCES (Detailed) ==========
  matchPreferences: {
    gender: {
      type: [String],
      enum: ["male", "female", "non-binary", "any"]
    },
    ageRange: {
      min: { type: Number, min: 18, max: 100 },
      max: { type: Number, min: 18, max: 100 }
    },
    locationRange: { type: Number, min: 1, max: 1000 }, // in km
    relationshipGoals: [{
      type: String,
      enum: ["casual_dating", "serious_relationship", "marriage", "friendship"]
    }],
    mustHaves: [String],
    dealBreakers: [String]
  },
  
  // ========== VERIFICATION BADGES ==========
  verificationBadges: [{
    type: String,
    enum: ["email", "phone", "photo", "identity", "premium"]
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

// // ========== INDEXES ==========
// profileSchema.index({ userId: 1 }, { unique: true });
// profileSchema.index({ userName: 1 }, { sparse: true });
// profileSchema.index({ profileCompletion: -1, lastProfileUpdate: -1 });
// profileSchema.index({ gender: 1, 'matchPreferences.gender': 1 });
// profileSchema.index({ countryOfOrigin: 1 });
// profileSchema.index({ religion: 1 });

// ========== VIRTUAL PROPERTIES ==========
profileSchema.virtual('verificationBadgesWithLabels').get(function() {
  const badgeLabels = {
    "email": "Email Verified",
    "phone": "Phone Verified", 
    "photo": "Photo Verified",
    "identity": "Identity Verified",
    "premium": "Premium Member"
  };
  
  return this.verificationBadges.map(badge => ({
    type: badge,
    label: badgeLabels[badge] || badge,
    earnedAt: new Date()
  }));
});

profileSchema.virtual('isVerified').get(function() {
  return this.verificationBadges && this.verificationBadges.length > 0;
});

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

profileSchema.virtual('lastActive').get(function() {
  return this.updatedAt;
});

// ========== STATIC METHODS ==========
profileSchema.statics.getDefaultValues = async function() {
  return {
    userName: null,
    bio: "",
    profilePicture: null,
    photos: [],
    dateOfBirth: null,
    gender: null,
    height: null,
    countryOfOrigin: null,
    currentLocation: null,
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
    verificationBadges: [],
    profileViews: 0,
    likeCount: 0,
    matchCount: 0,
    responseRate: 0,
    profileCompletion: 0
  };
};

// ========== INSTANCE METHODS ==========
profileSchema.methods.calculateCompletion = function() {
  const fields = [
    'userName', 'bio', 'profilePicture', 'photos', 'dateOfBirth',
    'gender', 'height', 'countryOfOrigin', 'currentLocation', 'homeLanguage',
    'religion', 'servingAs', 'relationshipStatus', 'lookingFor', 'haveChildren',
    'wantsChildren', 'education', 'occupation', 'income', 'hobbies',
    'languages', 'matchPreferences'
  ];
  
  let completed = 0;
  
  fields.forEach(field => {
    let isCompleted = false;
    
    if (field === 'userName') {
      isCompleted = !!this.userName;
    } else if (field === 'profilePicture') {
      isCompleted = !!(this.profilePicture && this.profilePicture.url);
    } else if (field === 'photos') {
      isCompleted = !!(this.photos && this.photos.length > 0);
    } else if (field === 'currentLocation') {
      isCompleted = !!(this.currentLocation && 
                      (this.currentLocation.city || this.currentLocation.country));
    } else if (field === 'lookingFor') {
      isCompleted = !!(this.lookingFor && this.lookingFor.length > 0);
    } else if (field === 'hobbies') {
      isCompleted = !!(this.hobbies && this.hobbies.length > 0);
    } else if (field === 'languages') {
      isCompleted = !!(this.languages && this.languages.length > 0);
    } else if (field === 'matchPreferences') {
      isCompleted = !!(this.matchPreferences && 
                      (this.matchPreferences.gender && this.matchPreferences.gender.length > 0 ||
                       this.matchPreferences.ageRange));
    } else {
      isCompleted = !!this[field];
    }
    
    if (isCompleted) completed++;
  });
  
  return Math.round((completed / fields.length) * 100);
};

profileSchema.methods.addVerificationBadge = function(badgeType) {
  const validBadges = ["email", "phone", "photo", "identity", "premium"];
  
  if (!validBadges.includes(badgeType)) {
    return false;
  }
  
  if (!this.verificationBadges.includes(badgeType)) {
    this.verificationBadges.push(badgeType);
    return true;
  }
  
  return false;
};

profileSchema.methods.getPublicProfile = function() {
  return {
    userName: this.userName,
    bio: this.bio,
    profilePicture: this.profilePicture,
    photos: this.photos,
    age: this.age,
    gender: this.gender,
    height: this.height,
    countryOfOrigin: this.countryOfOrigin,
    currentLocation: this.currentLocation,
    homeLanguage: this.homeLanguage,
    religion: this.religion,
    servingAs: this.servingAs,
    relationshipStatus: this.relationshipStatus,
    lookingFor: this.lookingFor,
    haveChildren: this.haveChildren,
    wantsChildren: this.wantsChildren,
    education: this.education,
    occupation: this.occupation,
    income: this.income,
    hobbies: this.hobbies,
    lifestyle: this.lifestyle,
    verificationBadges: this.verificationBadges,
    profileCompletion: this.profileCompletion
  };
};

// Method: Get labels for all enum fields
profileSchema.methods.getAllLabels = async function() {
  const labels = {};
  
  // Helper function to get label from optionService
  const getLabel = async (category, value) => {
    try {
      if (global.optionService) {
        return await global.optionService.getOptionLabel(category, value);
      }
    } catch (error) {
      console.error(`Error getting label for ${category}:`, error);
    }
    return value; // Fallback to original value
  };
  
  // Map fields to their option categories
  const fieldMappings = {
    gender: 'gender',
    religion: 'religion',
    servingAs: 'servingAs',
    relationshipStatus: 'relationshipStatus',
    lookingFor: 'lookingFor',
    haveChildren: 'haveChildren',
    wantsChildren: 'wantsChildren',
    education: 'education',
    income: 'income'
  };
  
  // Get labels for each field
  for (const [field, category] of Object.entries(fieldMappings)) {
    if (this[field]) {
      if (Array.isArray(this[field])) {
        // Handle array fields (like lookingFor)
        labels[`${field}Label`] = await Promise.all(
          this[field].map(value => getLabel(category, value))
        );
      } else {
        labels[`${field}Label`] = await getLabel(category, this[field]);
      }
    }
  }
  
  return labels;
};

module.exports = mongoose.model("Profile", profileSchema);