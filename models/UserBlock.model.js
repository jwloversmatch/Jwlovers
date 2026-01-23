const mongoose = require("mongoose");

const userBlockSchema = new mongoose.Schema({
  blockerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    
  },
  
  blockedId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    
  },
  
  reason: {
    type: String,
    enum: ["spam", "harassment", "inappropriate", "other"],
    default: "other",
  },
  
  notes: String,
  
  blockedAt: {
    type: Date,
    default: Date.now,
  },
  
  expiresAt: Date, // For temporary blocks
  
}, {
  timestamps: true,
});

// Ensure unique block pairs
userBlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

module.exports = mongoose.model("UserBlock", userBlockSchema);