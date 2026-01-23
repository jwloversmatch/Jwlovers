const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema({
  users: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  }],
  
  status: {
    type: String,
    enum: ["pending", "matched", "rejected", "expired", "blocked"],
    default: "pending"
  },
  
  initiator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  
  matchedAt: {
    type: Date,
    default: Date.now
  },
  
  lastInteraction: {
    type: Date,
    default: Date.now
  },
  
  compatibilityScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  
  conversation: {
    lastMessage: String,
    lastMessageAt: Date,
    unreadCount: {
      type: Map,
      of: Number,
      default: {}
    }
  },
  
  metadata: {
    source: {
      type: String,
      enum: ["swipe", "suggestion", "search", "premium"]
    },
    seenBy: [{
      userId: mongoose.Schema.Types.ObjectId,
      seenAt: Date
    }]
  }
}, {
  timestamps: true
});

// Indexes for fast queries
matchSchema.index({ users: 1 });
matchSchema.index({ status: 1, matchedAt: -1 });
matchSchema.index({ "users": 1, status: 1 });

// Helper method to check if user is in match
matchSchema.methods.hasUser = function(userId) {
  return this.users.some(id => id.toString() === userId.toString());
};

// Helper method to get other user
matchSchema.methods.getOtherUser = function(userId) {
  return this.users.find(id => id.toString() !== userId.toString());
};

module.exports = mongoose.model("Match", matchSchema);