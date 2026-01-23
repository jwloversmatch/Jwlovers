// models/Option.model.js
const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
  // Category defines where this option is used
  category: {
    type: String,
    required: true,
    enum: [
      'gender',
      'religion', 
      'servingAs',
      'relationshipStatus',
      'lookingFor',
      'haveChildren',
      'education',
      'income',
      'matchGender',
      'matchReligion',
      'matchEducationLevel',
      'matchWantsChildren',
      'verificationBadge' 
    ]
  },
  
  // The actual value stored in database
  value: {
    type: String,
    required: true,
    trim: true
  },
  
  // Display label shown to users
  label: {
    type: String,
    required: true,
    trim: true
  },
  
  // Optional description
  description: {
    type: String,
    trim: true
  },
  
  // Order for sorting in dropdowns
  order: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Whether this option is active/available
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Whether this is the default selection
  isDefault: {
    type: Boolean,
    default: false
  },
  
  // For multi-language support (optional)
  translations: {
    type: Map,
    of: String,
    default: {}
  },
  
  // Metadata
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  },
  
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

optionSchema.index({ category: 1, value: 1 }, { unique: true });

// Method to get display text
optionSchema.methods.getDisplayText = function(language = 'en') {
  return this.translations.get(language) || this.label;
};

module.exports = mongoose.model('Option', optionSchema);