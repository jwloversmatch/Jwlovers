// models/Block.model.js
const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema({
  // User who initiated the block
  blocker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Blocker user ID is required'],
    
  },
  
  // User who is being blocked
  blocked: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Blocked user ID is required'],
    
  },
  
  // Reason for blocking (optional)
  reason: {
    type: String,
    enum: [
      'inappropriate_content',
      'harassment',
      'spam',
      'fake_profile',
      'safety_concerns',
      'personal_reasons',
      'other'
    ],
    default: 'personal_reasons'
  },
  
  // Custom reason if "other" is selected
  customReason: {
    type: String,
    maxlength: 500,
    trim: true
  },
  
  // Is the block currently active?
  active: {
    type: Boolean,
    default: true,
    
  },
  
  // Block scope - what exactly is blocked
  scope: {
    messages: { type: Boolean, default: true },
    profileView: { type: Boolean, default: true },
    matches: { type: Boolean, default: true },
    notifications: { type: Boolean, default: true }
  },
  
  // Block duration (null for permanent)
  expiresAt: {
    type: Date,
    default: null
  },
  
  // Metadata
  metadata: {
    deviceInfo: String,
    ipAddress: String,
    userAgent: String
  },
  
  // Additional context
  context: {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation'
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    reported: {
      type: Boolean,
      default: false
    },
    reportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Report'
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound unique index to prevent duplicate active blocks
blockSchema.index(
  { blocker: 1, blocked: 1, active: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

// Index for checking expired blocks
blockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for checking if block is expired
blockSchema.virtual('isExpired').get(function() {
  if (!this.expiresAt) return false;
  return this.expiresAt < new Date();
});

// Virtual for checking if block is effective (active and not expired)
blockSchema.virtual('isEffective').get(function() {
  return this.active && !this.isExpired;
});

// Instance method to check if a specific action is blocked
blockSchema.methods.isActionBlocked = function(action) {
  if (!this.isEffective) return false;
  
  const actionMap = {
    'send_message': 'scope.messages',
    'view_profile': 'scope.profileView',
    'match': 'scope.matches',
    'notify': 'scope.notifications'
  };
  
  const scopePath = actionMap[action];
  return scopePath ? this.get(scopePath) : true;
};

// Instance method to unblock
blockSchema.methods.unblock = function() {
  this.active = false;
  this.expiresAt = null;
  return this.save();
};

// Static method to check if user A is blocked by user B
blockSchema.statics.isBlocked = async function(userA, userB) {
  if (!userA || !userB) return false;
  
  const block = await this.findOne({
    blocker: userB,
    blocked: userA,
    active: true,
    $or: [
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ]
  });
  
  return !!block;
};

// Static method to check if either user has blocked the other
blockSchema.statics.isEitherBlocked = async function(userA, userB) {
  if (!userA || !userB) return false;
  
  const blocks = await this.find({
    $or: [
      { blocker: userA, blocked: userB },
      { blocker: userB, blocked: userA }
    ],
    active: true,
    $or: [
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ]
  });
  
  return blocks.length > 0;
};

// Static method to get all users blocked by a user
blockSchema.statics.getBlockedUsers = async function(userId) {
  return this.find({
    blocker: userId,
    active: true,
    $or: [
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ]
  })
  .populate('blocked', 'firstName lastName avatar userName email')
  .select('blocked reason scope expiresAt createdAt')
  .lean();
};

// Static method to get all users who blocked a user
blockSchema.statics.getBlockedByUsers = async function(userId) {
  return this.find({
    blocked: userId,
    active: true,
    $or: [
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ]
  })
  .populate('blocker', 'firstName lastName avatar userName email')
  .select('blocker reason scope expiresAt createdAt')
  .lean();
};

// Static method to create a block with validation
blockSchema.statics.createBlock = async function(data) {
  const { blocker, blocked, reason, scope, durationDays } = data;
  
  // Check if already blocked
  const existingBlock = await this.findOne({
    blocker,
    blocked,
    active: true
  });
  
  if (existingBlock) {
    throw new Error('User is already blocked');
  }
  
  // Users cannot block themselves
  if (blocker.toString() === blocked.toString()) {
    throw new Error('Cannot block yourself');
  }
  
  // Calculate expiration if duration is specified
  let expiresAt = null;
  if (durationDays && durationDays > 0) {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);
  }
  
  // Create the block
  const block = new this({
    blocker,
    blocked,
    reason: reason || 'personal_reasons',
    scope: scope || {
      messages: true,
      profileView: true,
      matches: true,
      notifications: true
    },
    expiresAt
  });
  
  return block.save();
};

// Static method to find mutual blocks
blockSchema.statics.findMutualBlock = async function(userA, userB) {
  const blocks = await this.find({
    $or: [
      { blocker: userA, blocked: userB },
      { blocker: userB, blocked: userA }
    ],
    active: true
  });
  
  const result = {
    aBlockedB: false,
    bBlockedA: false,
    isMutual: false
  };
  
  blocks.forEach(block => {
    if (block.blocker.toString() === userA.toString()) {
      result.aBlockedB = true;
    } else {
      result.bBlockedA = true;
    }
  });
  
  result.isMutual = result.aBlockedB && result.bBlockedA;
  return result;
};

// Static method to cleanup expired blocks
blockSchema.statics.cleanupExpired = async function() {
  return this.updateMany(
    {
      active: true,
      expiresAt: { $lt: new Date(), $ne: null }
    },
    { active: false }
  );
};

// Pre-save middleware to validate
blockSchema.pre('save', function(next) {
  // Ensure blocker and blocked are different
  if (this.blocker && this.blocked && 
      this.blocker.toString() === this.blocked.toString()) {
    return next(new Error('Cannot block yourself'));
  }
  
  // Validate customReason if reason is 'other'
  if (this.reason === 'other' && (!this.customReason || this.customReason.trim() === '')) {
    return next(new Error('Custom reason is required when selecting "other"'));
  }
  
  next();
});

const Block = mongoose.model('Block', blockSchema);

module.exports = Block;