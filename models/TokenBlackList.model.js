// @models/TokenBlacklist.model.js
const mongoose = require('mongoose');

const tokenBlacklistSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    
  },
  type: {
    type: String,
    enum: ['access', 'refresh', 'password_reset', 'verification'],
    default: 'access'
  },
  reason: {
    type: String,
    enum: ['logout', 'refresh', 'compromised', 'password_change', 'expired'],
    default: 'logout'
  },
  expiresAt: {
    type: Date,
    required: true,
    
    expires: 0 // Auto-delete after expiration
  },
  blacklistedAt: {
    type: Date,
    default: Date.now
  },
  usedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Add compound indexes
tokenBlacklistSchema.index({ userId: 1, type: 1 });
tokenBlacklistSchema.index({ token: 1, userId: 1 });

module.exports = mongoose.model('TokenBlacklist', tokenBlacklistSchema);