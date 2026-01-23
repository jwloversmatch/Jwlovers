const mongoose = require("mongoose");

const userContactSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    
  },
  
  contactId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    
  },
  
  // Contact metadata
  nickname: String,
  isFavorite: {
    type: Boolean,
    default: false,
  },
  
  // Privacy settings for this contact
  settings: {
    showOnlineStatus: { type: Boolean, default: true },
    showLastSeen: { type: Boolean, default: true },
    allowNotifications: { type: Boolean, default: true },
  },
  
  // Statistics
  lastMessageAt: Date,
  unreadCount: {
    type: Number,
    default: 0,
  },
  
  addedAt: {
    type: Date,
    default: Date.now,
  },
  
  notes: String,
  
}, {
  timestamps: true,
});

// Ensure unique contact pairs
userContactSchema.index({ userId: 1, contactId: 1 }, { unique: true });

module.exports = mongoose.model("UserContact", userContactSchema);