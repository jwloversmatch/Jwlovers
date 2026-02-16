const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema({
  // Store users individually for better querying
  user1: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "DatingUser",
    required: true,
    index: true
  },
  
  user2: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "DatingUser",
    required: true,
    index: true
  },
  
  // Keep array for backward compatibility if needed
  users: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "DatingUser"
  }],
  
  // FIX: Added "matched" to enum.
  // The controller creates matches with status: "matched" but the original enum
  // only had: pending | active | rejected | expired | blocked | archived.
  // MongoDB would silently fail validation on every likeUser mutual-match save.
  // "matched" = two users have mutually liked; distinct from "active" (conversation
  // is in progress) so both are kept.
  status: {
    type: String,
    enum: ["pending", "matched", "active", "rejected", "expired", "blocked", "archived"],
    default: "matched"
  },
  
  initiator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "DatingUser"
  },
  
  matchedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  lastInteraction: {
    type: Date,
    default: Date.now
  },
  
  compatibilityScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
    index: true
  },
  
  // Conversation metadata
  conversation: {
    lastMessage: String,
    lastMessageAt: Date,
    unreadCount: {
      type: Map,
      of: Number,
      default: {}
    },
    messageCount: {
      type: Number,
      default: 0
    }
  },
  
  // Preferences and restrictions
  preferences: {
    hideFrom: [{
      userId: mongoose.Schema.Types.ObjectId,
      hiddenAt: Date,
      reason: String
    }],
    notificationSettings: {
      newMessage: { type: Boolean, default: true },
      matchActivity: { type: Boolean, default: true },
      dailyDigest: { type: Boolean, default: false }
    }
  },
  
  // Activity tracking
  activity: {
    lastMessageAt: Date,
    lastPhotoSharedAt: Date,
    lastVideoCallAt: Date,
    meetupSuggestedAt: Date,
    totalInteractions: { type: Number, default: 0 }
  },
  
  // Match quality metrics
  metrics: {
    responseRate: Number,
    engagementScore: Number,
    conversationDepth: Number,
    // FIX: This is the canonical location for report data (matches the schema).
    // The reportMatch controller was incorrectly writing to metadata.reports instead.
    // It has been corrected to write here. See MatchController.js reportMatch fix.
    reported: {
      count: { type: Number, default: 0 },
      reasons: [String],
      lastReportedAt: Date
    }
  },
  
  // Metadata
  metadata: {
    source: {
      type: String,
      enum: ["swipe", "suggestion", "search", "premium", "friend_referral", "event"],
      default: "swipe"
    },
    seenBy: [{
      userId: mongoose.Schema.Types.ObjectId,
      seenAt: Date
    }],
    icebreakersUsed: [String],
    matchStreak: {
      count: { type: Number, default: 0 },
      lastMatchedAt: Date
    },
    // Additional fields written by the controller that are not formally
    // validated by the schema (stored as untyped metadata).
    superLikeUsed: Boolean,
    unmatchReason: String,
    unmatchedBy: mongoose.Schema.Types.ObjectId,
    unmatchedAt: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for common queries
matchSchema.index({ user1: 1, user2: 1 }, { unique: true }); // Prevent duplicates
matchSchema.index({ user1: 1, status: 1, matchedAt: -1 });
matchSchema.index({ user2: 1, status: 1, matchedAt: -1 });
matchSchema.index({ status: 1, matchedAt: -1 });
matchSchema.index({ compatibilityScore: -1 });
matchSchema.index({ "conversation.lastMessageAt": -1 });
matchSchema.index({ "activity.lastInteraction": -1 });

// Virtual for easy access
matchSchema.virtual('isActive').get(function() {
  return this.status === 'active' || this.status === 'matched';
});

matchSchema.virtual('isNew').get(function() {
  // Consider match new for 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return this.matchedAt > oneDayAgo;
});

// Pre-save middleware to ensure users array is populated
matchSchema.pre('save', function() {
  if (!this.users || this.users.length === 0) {
    this.users = [this.user1, this.user2];
  }
  
  // Ensure users are unique
  this.users = [...new Set(this.users.map(id => id.toString()))].map(id => 
    mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id
  );
  
});

// Static methods for better querying
matchSchema.statics.findByUsers = function(user1Id, user2Id) {
  return this.findOne({
    $or: [
      { user1: user1Id, user2: user2Id },
      { user1: user2Id, user2: user1Id }
    ]
  });
};

matchSchema.statics.findUserMatches = function(userId, options = {}) {
  const query = {
    $or: [{ user1: userId }, { user2: userId }],
    status: options.status || { $ne: 'blocked' }
  };
  
  if (options.minCompatibility) {
    query.compatibilityScore = { $gte: options.minCompatibility };
  }
  
  if (options.excludeUsers) {
    query.$or[0].user1.$nin = options.excludeUsers;
    query.$or[1].user2.$nin = options.excludeUsers;
  }
  
  return this.find(query)
    .sort(options.sort || { matchedAt: -1 })
    .populate(options.populate || 'user1 user2')
    .limit(options.limit || 100)
    .skip(options.skip || 0);
};

matchSchema.statics.findPotentialDuplicates = function(user1Id, user2Id) {
  return this.find({
    $or: [
      { user1: user1Id, user2: user2Id },
      { user1: user2Id, user2: user1Id }
    ],
    status: { $nin: ['rejected', 'expired', 'blocked'] }
  });
};

// Instance methods
matchSchema.methods.hasUser = function(userId) {
  const idStr = userId.toString();
  return this.user1.toString() === idStr || 
         this.user2.toString() === idStr ||
         this.users.some(id => id.toString() === idStr);
};

matchSchema.methods.getOtherUser = function(userId) {
  const idStr = userId.toString();
  if (this.user1.toString() === idStr) return this.user2;
  if (this.user2.toString() === idStr) return this.user1;
  
  // Fallback to array if direct fields not populated
  return this.users.find(id => id.toString() !== idStr);
};

matchSchema.methods.getOtherUserId = function(userId) {
  const otherUser = this.getOtherUser(userId);
  return otherUser ? otherUser._id || otherUser : null;
};

matchSchema.methods.markAsSeen = function(userId) {
  const seenEntry = {
    userId: mongoose.Types.ObjectId.isValid(userId) ? userId : new mongoose.Types.ObjectId(userId),
    seenAt: new Date()
  };
  
  // Remove existing entry if exists
  this.metadata.seenBy = this.metadata.seenBy || [];
  this.metadata.seenBy = this.metadata.seenBy.filter(
    entry => entry.userId.toString() !== userId.toString()
  );
  
  this.metadata.seenBy.push(seenEntry);
  return this.save();
};

matchSchema.methods.incrementUnread = function(userId) {
  const otherUserId = this.getOtherUserId(userId).toString();
  const currentCount = this.conversation.unreadCount.get(otherUserId) || 0;
  this.conversation.unreadCount.set(otherUserId, currentCount + 1);
  return this.save();
};

matchSchema.methods.resetUnread = function(userId) {
  this.conversation.unreadCount.set(userId.toString(), 0);
  return this.save();
};

matchSchema.methods.updateLastInteraction = function(interactionType = 'message') {
  this.lastInteraction = new Date();
  
  switch (interactionType) {
    case 'message':
      this.conversation.lastMessageAt = new Date();
      break;
    case 'photo':
      this.activity.lastPhotoSharedAt = new Date();
      break;
    case 'video':
      this.activity.lastVideoCallAt = new Date();
      break;
    case 'meetup':
      this.activity.meetupSuggestedAt = new Date();
      break;
  }
  
  this.activity.totalInteractions += 1;
  return this.save();
};

// Query helper for active conversations
matchSchema.query.activeConversations = function(userId) {
  return this.where({
    $or: [{ user1: userId }, { user2: userId }],
    status: { $in: ['active', 'matched'] },
    'conversation.lastMessageAt': { $exists: true, $ne: null }
  });
};

// Query helper for new matches
matchSchema.query.newMatches = function(userId) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return this.where({
    $or: [{ user1: userId }, { user2: userId }],
    status: { $in: ['active', 'matched'] },
    matchedAt: { $gte: oneDayAgo },
    'metadata.seenBy.userId': { $ne: userId }
  });
};

module.exports = mongoose.model("Match", matchSchema);