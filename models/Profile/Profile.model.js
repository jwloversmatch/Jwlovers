// models/Profile/Profile.js - FIXED with proper location defaults
const mongoose = require("mongoose");
const validator = require("validator");

const profileSchema = new mongoose.Schema({
  // ========== CORE RELATIONSHIP ==========
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "BaseUser",
    required: true,
    unique: true,
  },
  
  // ========== BASIC PROFILE ==========
  basic: {
    userName: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      lowercase: true,
      minlength: [3, "Username must be at least 3 characters"],
      maxlength: [20, "Username cannot exceed 20 characters"],
      validate: {
        validator: (v) => /^[a-zA-Z0-9_-]+$/.test(v),
        message: "Username can only contain letters, numbers, underscores and hyphens"
      }
    },
    
    bio: {
      type: String,
      maxlength: [500, "Bio cannot exceed 500 characters"],
      default: "",
    },
    
    dateOfBirth: {
      type: Date,
      required: true,
      validate: {
        validator: function(v) {
          if (!v) return false;
          const birthDate = new Date(v);
          if (isNaN(birthDate.getTime())) return false;
          
          const today = new Date();
          let age = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();
          
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }
          
          return age >= 18 && age <= 100;
        },
        message: "You must be 18-100 years old"
      }
    },
    
    gender: {
      type: String,
      enum: ["male", "female", "other", "prefer-not-to-say"],
    },
    
    height: {
      type: Number,
      min: 100,
      max: 250,
    }
  },
  
  // ========== PHOTOS ==========
  photos: {
    profile: {
      url: {
        type: String,
        required: false,  // ✅ Not required
        default: '',      // ✅ Default to empty string
        validate: {
          validator: function(v) {
            // ✅ Allow empty/null OR valid URL
            if (!v || v === '' || v === null) return true;
            return /^https?:\/\/.+/.test(v);
          },
          message: 'Please provide a valid profile picture URL'
        }
      },
      cloudinaryId: { type: String, default: '' }, 
      filename: {
        type: String,
        default: ''
      },
      verified: { 
        type: Boolean, 
        default: false 
      },
      uploadedAt: Date
    },
    gallery: {
      type: [
        {
          url: {
            type: String,
            required: true,  
            validate: {
              validator: function(v) {
                return /^https?:\/\/.+/.test(v);
              },
              message: 'Please provide a valid gallery photo URL'
            }
          },
          cloudinaryId: { type: String, required: true }, 
          filename: {
            type: String,
          },
          caption: { 
            type: String, 
            maxlength: 100,
            default: ''
          },
          order: {
            type: Number,
            default: 0
          },
          uploadedAt: {
            type: Date,
            default: Date.now
          }
        }
      ],
      default: []
    }
  },
  
  // ========== LOCATION - FIXED WITH DEFAULTS ==========
  location: {
    city: { type: String, default: '' },
    country: { type: String, default: '' },
    countryCode: { type: String, default: '' },
    formattedAddress: { type: String, default: '' },
    coordinates: {
      type: [Number],
      default: [0, 0],
    },
    lastUpdated: { type: Date, default: Date.now }
  },
  
  // ========== JW FAITH & SERVICE ==========
  faith: {
    baptismDate: Date,
    
    servingAs: {
      type: String,
      enum: ["elder", "ministerial_servant", "regular_pioneer", "auxiliary_pioneer", "special_pioneer", "regular_publisher", "other", null]
    },
    
    pioneerHours: {
      type: String,
      enum: ["30", "50", "70", "100", null]
    },
    
    congregation: {
      name: String,
      circuit: String,
      language: String
    },
    
    bethel: {
      served: { type: Boolean, default: false },
      location: String,
      years: String
    },
    
    missionary: {
      served: { type: Boolean, default: false },
      country: String,
      years: String
    },
    
    otherSheep: { type: Boolean, default: true },
    annointed: { type: Boolean, default: false }
  },
  
  // ========== RELATIONSHIP STATUS & GOALS ==========
  relationship: {
    status: {
      type: String,
      enum: ["single", "dating", "engaged", "married", "divorced", "widowed", "separated", null]
    },
    
    lookingFor: [{
      type: String,
      enum: ["friendship", "pen_pals", "dating", "serious_relationship", "marriage"]
    }],
    
    children: {
      have: {
        type: String,
        enum: ["yes", "no", "prefer_not_to_say", null]
      },
      want: {
        type: String,
        enum: ["yes", "no", "maybe", "open_to_adoption", "prefer_not_to_say", null]
      },
      livingWith: {
        type: String,
        enum: ["full_time", "part_time", "independently", "not_living_with", null]
      }
    },
    
    livingSituation: {
      type: String,
      enum: ["alone", "with_family", "with_roommates", "with_children", "other", null]
    }
  },
  
  // ========== CAREER & EDUCATION ==========
  career: {
    education: {
      level: {
        type: String,
        enum: ["high_school", "some_college", "associates", "bachelors", "masters", "phd", "trade_school", "other", null]
      },
      field: String,
      school: String
    },
    
    work: {
      occupation: String,
      industry: String,
      schedule: {
        type: String,
        enum: ["9to5", "flexible", "nights", "weekends", "shift_work", "stay_at_home", "retired", "student", null]
      },
      income: {
        type: String,
        enum: ["under_30k", "30k_60k", "60k_100k", "100k_150k", "150k_plus", "prefer_not_to_say", null]
      }
    }
  },
  
  // ========== LIFESTYLE & INTERESTS ==========
  lifestyle: {
    hobbies: [String],
    
    languages: [{
      language: String,
      proficiency: {
        type: String,
        enum: ["basic", "conversational", "fluent", "native"]
      }
    }],
    
    pets: [{
      type: String,
      enum: ["dog", "cat", "bird", "fish", "reptile", "small_furry", "horse", "other", "none"]
    }],
    
    diet: {
      type: String,
      enum: ["omnivore", "vegetarian", "vegan", "pescatarian", "kosher", "halal", "other", null]
    },
    
    exercise: {
      frequency: {
        type: String,
        enum: ["never", "occasionally", "1-2_times_week", "3-4_times_week", "daily", null]
      },
      activities: [String]
    },
    
    smoking: {
      type: String,
      enum: ["never", "socially", "occasionally", "regularly", "trying_to_quit", null]
    },
    
    drinking: {
      type: String,
      enum: ["never", "socially", "occasionally", "regularly", null]
    }
  },
  
  // ========== PERSONALITY & VALUES ==========
  personality: {
    introvertExtrovert: {
      type: String,
      enum: ["introvert", "ambivert", "extrovert", null]
    },
    
    loveLanguage: [{
      type: String,
      enum: ["words_of_affirmation", "acts_of_service", "receiving_gifts", "quality_time", "physical_touch"]
    }],
    
    communicationStyle: {
      type: String,
      enum: ["texter", "caller", "video_chat", "mixed", null]
    },
    
    spiritualGoals: [String],
    
    meetingAttendance: {
      type: String,
      enum: ["every_meeting", "most_meetings", "occasionally", "currently_inactive", null]
    }
  },
  
  // ========== WHAT I'M LOOKING FOR ==========
  preferences: {
    basic: {
      gender: [{
        type: String,
        enum: ["male", "female", "any"]
      }],
      
      ageRange: {
        min: { type: Number, min: 18, max: 100, default: 18 },
        max: { type: Number, min: 18, max: 100, default: 45 }
      },
      
      distance: { 
        type: Number, 
        min: 1, 
        max: 500, 
        default: 50 
      }
    },
    
    faith: {
      mustBeJW: { type: Boolean, default: true },
      servingAs: [String],
      pioneerPreferred: { type: Boolean, default: false },
      missionaryPreferred: { type: Boolean, default: false },
      bethelPreferred: { type: Boolean, default: false }
    },
    
    relationship: {
      goals: [{
        type: String,
        enum: ["friendship", "pen_pals", "dating", "serious_relationship", "marriage"]
      }],
      
      children: {
        accept: { type: Boolean, default: true },
        wantMore: { type: String, enum: ["yes", "no", "maybe", null] }
      }
    },
    
    dealbreakers: {
      mustHaves: [String],
      dealBreakers: [String]
    }
  },
  
  // ========== DATING PROFILE SETTINGS ==========
  settings: {
    isVisible: { type: Boolean, default: true },
    isPaused: { type: Boolean, default: false },
    pauseUntil: Date,
    
    tags: [String],
    
    privacy: {
      showAge: { type: Boolean, default: true },
      showDistance: { type: Boolean, default: true },
      showLastActive: { 
        type: String, 
        enum: ["everyone", "matches", "nobody"],
        default: "everyone"
      },
      showCongregation: { type: Boolean, default: false }
    }
  },
  
  // ========== VERIFICATION BADGES ==========
  badges: [{
    type: {
      type: String,
      enum: ["email", "phone", "photo", "identity", "premium", "baptized", "pioneer", "missionary", "bethel"],
      required: true
    },
    verifiedAt: { type: Date, default: Date.now },
    expiresAt: Date
  }],
  
  // ========== STATISTICS ==========
  stats: {
    profileViews: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    matches: { type: Number, default: 0 },
    responseRate: { type: Number, default: 0, min: 0, max: 100 },
    lastActive: Date
  },
  
  // ========== PROGRESS ==========
  progress: {
    completion: { type: Number, default: 0, min: 0, max: 100 },
    onboardingCompleted: { type: Boolean, default: false },
    lastUpdated: { type: Date, default: Date.now }
  }

}, {
  timestamps: true
});

// ========== VIRTUAL PROPERTIES ==========
profileSchema.virtual('age').get(function() {
  if (!this.basic.dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(this.basic.dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
});

profileSchema.virtual('isVerified').get(function() {
  return this.badges?.length > 0;
});

profileSchema.virtual('isEligibleForDating').get(function() {
  return this.age >= 18 && this.settings?.isVisible && !this.settings?.isPaused;
});

profileSchema.virtual('fullName').get(function() {
  return this.populated('userId') ? `${this.userId.firstName} ${this.userId.lastName}` : null;
});

// ========== INSTANCE METHODS ==========
profileSchema.methods.calculateCompletion = function() {
  let completion = 0;

  // ========== BASIC (max 30) ==========
  if (this.basic?.userName) completion += 5;                    // 5
  if (this.basic?.bio?.length >= 50) completion += 10;         // 10
  if (this.basic?.dateOfBirth) completion += 5;                // 5
  if (this.basic?.gender) completion += 5;                     // 5
  if (this.basic?.height) completion += 3;                     // 3
  if (this.photos?.profile?.url) completion += 2;              // 2 (part of photos below)

  // ========== PHOTOS (max 20) ==========
  if (this.photos?.profile?.url) completion += 10;             // 10
  if (this.photos?.gallery?.length >= 2) completion += 10;     // 10

  // ========== LOCATION (max 10) ==========
  if (this.location?.city?.trim()) completion += 5;            // 5
  if (this.location?.country?.trim()) completion += 5;         // 5

  // ========== FAITH (max 25) ==========
  if (this.faith?.baptismDate) completion += 5;                // 5
  if (this.faith?.servingAs) completion += 10;                 // 10
  if (this.faith?.congregation?.name) completion += 3;         // 3
  if (this.faith?.missionary?.served) completion += 2;         // 2
  if (this.faith?.bethel?.served) completion += 2;             // 2
  if (this.faith?.pioneerHours) completion += 3;               // 3

  // ========== RELATIONSHIP (max 20) ==========
  if (this.relationship?.status) completion += 5;              // 5
  if (this.relationship?.lookingFor?.length > 0) completion += 5; // 5
  if (this.relationship?.children?.have) completion += 3;      // 3
  if (this.relationship?.children?.want) completion += 3;      // 3
  if (this.relationship?.livingSituation) completion += 4;     // 4

  // ========== CAREER (max 15) ==========
  if (this.career?.work?.occupation) completion += 8;          // 8
  if (this.career?.education?.level) completion += 7;          // 7

  // ========== LIFESTYLE (max 25) ==========
  if (this.lifestyle?.hobbies?.length >= 3) completion += 5;   // 5
  if (this.lifestyle?.languages?.length >= 1) completion += 4; // 4
  if (this.lifestyle?.pets?.length > 0) completion += 3;       // 3
  if (this.lifestyle?.diet) completion += 3;                   // 3
  if (this.lifestyle?.exercise?.frequency) completion += 3;    // 3
  if (this.lifestyle?.smoking) completion += 2;                // 2
  if (this.lifestyle?.drinking) completion += 2;               // 2
  if (this.lifestyle?.exercise?.activities?.length > 0) completion += 3; // 3

  // ========== PERSONALITY (max 20) ==========
  if (this.personality?.introvertExtrovert) completion += 4;   // 4
  if (this.personality?.loveLanguage?.length > 0) completion += 4; // 4
  if (this.personality?.communicationStyle) completion += 4;   // 4
  if (this.personality?.spiritualGoals?.length > 0) completion += 4; // 4
  if (this.personality?.meetingAttendance) completion += 4;    // 4

  // ========== PREFERENCES (max 20) ==========
  if (this.preferences?.basic?.gender?.length > 0) completion += 5;   // 5
  if (this.preferences?.basic?.ageRange?.min && this.preferences?.basic?.ageRange?.max) completion += 5; // 5
  if (this.preferences?.faith?.servingAs?.length > 0) completion += 5; // 5
  if (this.preferences?.relationship?.goals?.length > 0) completion += 5; // 5

  // ========== BADGES (max 10) ==========
  if (this.badges?.length >= 1) completion += 10;              // 10

  // Cap at 100
  this.progress.completion = Math.min(completion, 100);
  return this.progress.completion;
};

profileSchema.methods.addBadge = function(badgeType) {
  const validBadges = ["email", "phone", "photo", "identity", "premium", "baptized", "pioneer", "missionary", "bethel"];
  
  if (!validBadges.includes(badgeType)) return false;
  
  if (!this.badges) this.badges = [];
  
  const exists = this.badges.some(b => b.type === badgeType);
  if (exists) return false;
  
  this.badges.push({ type: badgeType, verifiedAt: new Date() });
  this.calculateCompletion();
  return true;
};

profileSchema.methods.getPublicProfile = function() {
  return {
    userId: this.userId,
    basic: {
      userName: this.basic.userName,
      bio: this.basic.bio,
      age: this.age,
      gender: this.basic.gender,
      height: this.basic.height
    },
    photos: {
      profile: this.photos.profile.url,
      gallery: this.photos.gallery.map(p => ({ url: p.url, caption: p.caption }))
    },
    location: {
      city: this.location?.city,
      country: this.location?.country,
      distance: null
    },
    faith: {
      servingAs: this.faith.servingAs,
      missionary: this.faith.missionary.served,
      bethel: this.faith.bethel.served
    },
    relationship: {
      status: this.relationship.status,
      lookingFor: this.relationship.lookingFor
    },
    career: {
      occupation: this.career.work.occupation,
      education: this.career.education.level
    },
    lifestyle: {
      hobbies: this.lifestyle.hobbies,
      languages: this.lifestyle.languages,
      exercise: this.lifestyle.exercise.frequency,
      smoking: this.lifestyle.smoking,
      drinking: this.lifestyle.drinking
    },
    personality: {
      introvertExtrovert: this.personality.introvertExtrovert,
      communicationStyle: this.personality.communicationStyle
    },
    badges: this.badges?.map(b => b.type) || [],
    stats: {
      profileCompletion: this.progress.completion,
      lastActive: this.stats.lastActive
    }
  };
};

// ========== STATIC METHODS - FIXED with proper location defaults ==========
profileSchema.statics.getDefaultValues = () => ({
  basic: {
    userName: null,
    bio: "",
    dateOfBirth: null,
    gender: null,
    height: null
  },
  photos: {
    profile: { url: null, verified: false },
    gallery: []
  },
  // ===== FIXED: location is now an object with defaults, NOT null =====
  location: {
    city: '',
    country: '',
    countryCode: '',
    formattedAddress: '',
    coordinates: [0, 0],
    lastUpdated: new Date()
  },
  faith: {
    baptismDate: null,
    servingAs: null,
    pioneerHours: null,
    congregation: { name: null, circuit: null, language: null },
    bethel: { served: false },
    missionary: { served: false },
    otherSheep: true,
    annointed: false
  },
  relationship: {
    status: null,
    lookingFor: [],
    children: { have: null, want: null, livingWith: null },
    livingSituation: null
  },
  career: {
    education: { level: null, field: null, school: null },
    work: { occupation: null, industry: null, schedule: null, income: null }
  },
  lifestyle: {
    hobbies: [],
    languages: [],
    pets: [],
    diet: null,
    exercise: { frequency: null, activities: [] },
    smoking: null,
    drinking: null
  },
  personality: {
    introvertExtrovert: null,
    loveLanguage: [],
    communicationStyle: null,
    spiritualGoals: [],
    meetingAttendance: null
  },
  preferences: {
    basic: {
      gender: [],
      ageRange: { min: 18, max: 45 },
      distance: 50
    },
    faith: {
      mustBeJW: true,
      servingAs: [],
      pioneerPreferred: false,
      missionaryPreferred: false,
      bethelPreferred: false
    },
    relationship: {
      goals: [],
      children: { accept: true, wantMore: null }
    },
    dealbreakers: {
      mustHaves: [],
      dealBreakers: []
    }
  },
  settings: {
    isVisible: true,
    isPaused: false,
    tags: [],
    privacy: {
      showAge: true,
      showDistance: true,
      showLastActive: "everyone",
      showCongregation: false
    }
  },
  badges: [],
  stats: { profileViews: 0, likes: 0, matches: 0, responseRate: 0 },
  progress: { completion: 0, onboardingCompleted: false }
});

profileSchema.index({ 
  'basic.gender': 1, 
  'basic.dateOfBirth': -1,
  'settings.isVisible': 1,
  'settings.isPaused': 1
});

// Index for profile completion and activity (sorting)
profileSchema.index({ 
  'progress.completion': -1,
  'stats.lastActive': -1
});

// Index for faith-based filtering
profileSchema.index({
  'faith.servingAs': 1,
  'faith.baptismDate': -1
});

// Index for relationship goals
profileSchema.index({
  'relationship.lookingFor': 1,
  'relationship.status': 1
});

// Geospatial index for location (VERIFY this exists)
profileSchema.index({ 'location.coordinates': '2dsphere' });

// Index for verification badges
profileSchema.index({ 'badges.type': 1 });

// Index for lifestyle/preferences
profileSchema.index({
  'lifestyle.hobbies': 1,
  'lifestyle.smoking': 1,
  'lifestyle.drinking': 1
});

// Index for career
profileSchema.index({
  'career.education.level': 1,
  'career.work.occupation': 1
});

// ========== MIDDLEWARE - FIXED with location initialization ==========
profileSchema.pre('save', function() {
  // Initialize location if it's somehow null
  if (!this.location || this.location === null) {
    this.location = {
      city: '',
      country: '',
      countryCode: '',
      formattedAddress: '',
      coordinates: [0, 0],
      lastUpdated: new Date()
    };
  }
  
  this.calculateCompletion();
  this.stats.lastActive = new Date();
  this.progress.lastUpdated = new Date();
});

// ========== ADD findOneAndUpdate middleware to prevent location null issues ==========
profileSchema.pre('findOneAndUpdate', async function() {
  const update = this.getUpdate();
  
  // If we're updating location fields, ensure location object exists
  const hasLocationUpdate = 
    update.$set?.location || 
    update.$set?.['location.city'] || 
    update.$set?.['location.country'] || 
    update.$set?.['location.coordinates'] ||
    update.location;
  
  if (hasLocationUpdate) {
    const doc = await this.model.findOne(this.getQuery());
    
    // If document exists and location is null, initialize it first
    if (doc && (!doc.location || doc.location === null)) {
      const initOps = {
        $set: {
          location: {
            city: '',
            country: '',
            countryCode: '',
            formattedAddress: '',
            coordinates: [0, 0],
            lastUpdated: new Date()
          }
        }
      };
      
      // Merge existing updates
      if (update.$set) {
        Object.assign(initOps.$set, update.$set);
      }
      
      this.setUpdate(initOps);
    }
  }
});

// ========== SYNC USERNAME TO BASEUSER ==========
profileSchema.post('save', async function(doc) {
  try {
    if (!doc.basic?.userName) return;
    
    const { BaseUser } = require("../User");
    await BaseUser.findByIdAndUpdate(
      doc.userId,
      { $set: { userName: doc.basic.userName } },
      { runValidators: false }
    );
    
    console.log(`✅ Synced username '${doc.basic.userName}' to BaseUser ${doc.userId}`);
  } catch (error) {
    console.error('❌ Failed to sync username to BaseUser:', error.message);
  }
});

profileSchema.post('findOneAndUpdate', async function(doc) {
  if (!doc) return;
  
  try {
    if (doc.basic?.userName) {
      const { BaseUser } = require("../User");
      await BaseUser.findByIdAndUpdate(
        doc.userId,
        { $set: { userName: doc.basic.userName } },
        { runValidators: false }
      );
      
      console.log(`✅ Synced username '${doc.basic.userName}' to BaseUser ${doc.userId}`);
    }
  } catch (error) {
    console.error('❌ Failed to sync username to BaseUser:', error.message);
  }
});

module.exports = mongoose.model("Profile", profileSchema);