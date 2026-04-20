const mongoose = require("mongoose");
const validator = require("validator");

const userProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "BaseUser",
    required: true,
    unique: true,
  },
  
  // Extended Profile Information
  bio: {
    type: String,
    maxlength: [500, "Bio cannot exceed 500 characters"],
    default: "",
  },
  
  phoneNumber: {
    type: String,
    validate: {
      validator: function(v) {
        return !v || validator.isMobilePhone(v, "any", { strictMode: false });
      },
      message: "Please provide a valid phone number",
    },
  },
  
  phoneVerified: {
    type: Boolean,
    default: false,
  },
  
  dateOfBirth: Date,
  
  gender: {
    type: String,
    enum: ["male", "female", "other", "prefer-not-to-say"],
  },
  
  location: {
    city: String,
    country: String,
    timezone: String,
  },
  
  website: {
    type: String,
    validate: {
      validator: function(v) {
        return !v || validator.isURL(v, { protocols: ["http", "https"] });
      },
      message: "Please provide a valid website URL",
    },
  },
  
  socialLinks: {
    twitter: String,
    facebook: String,
    linkedin: String,
    github: String,
    instagram: String,
  },
  
  // Professional Information
  company: String,
  jobTitle: String,
  
  // Interests/Hobbies
  interests: [String],
  
  // Metadata
  metadata: {
    registrationSource: {
      type: String,
      enum: ["web", "mobile", "api"],
      default: "web",
    },
    locale: {
      type: String,
      default: "en-US",
    },
    appVersion: String,
  },
  
}, {
  timestamps: true,
});


module.exports = mongoose.model("UserProfile", userProfileSchema);