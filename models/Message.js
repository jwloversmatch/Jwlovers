const mongoose = require('mongoose');
const crypto = require('crypto');

const messageSchema = new mongoose.Schema({
  // Core identifiers
  conversationId: {  
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Content (ALWAYS encrypted at rest for dating app)
  content: {
    type: String,
    required: true,
    maxlength: 20000, // Allow for base64 expansion
    validate: {
      validator: function(v) {
        return v && v.length > 0;
      },
      message: 'Message content cannot be empty'
    }
  },
  
  // Message type
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'file', 'audio', 'system', 'location', 'sticker'],
    default: 'text',
  },
  
  // Media information (if applicable)
  mediaInfo: {
    url: String,
    thumbnailUrl: String,
    fileSize: Number,
    mimeType: String,
    width: Number,
    height: Number,
    duration: Number,
    fileName: String,
    // Media encryption metadata
    mediaKey: String,
    mediaIv: String
  },
  
  // Deduplication
  clientMessageId: {
    type: String,
    sparse: true,
    unique: true,
  },
  contentHash: {
    type: String,
  },
  source: {
    type: String,
    enum: ['socket', 'http', 'manual', 'system', 'import'],
    default: 'socket'
  },
  
  // Delivery tracking
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'pending_moderation', 'blocked'],
    default: 'sent',
  },
  deliveredAt: Date,
  readAt: Date,
  readBy: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
  }],
  failedReason: String,
  
  // Encryption metadata (MINIMAL - for dating app security)
  encryption: {
    version: {
      type: String,
      enum: ['v1', 'v2', 'v3'],
      default: 'v2'
    },
    keyId: {
      type: String,
      default: 'default'
    },
    // Algorithm determined by version, not stored
    migrated: {
      type: Boolean,
      default: false
    },
    migratedAt: Date,
    // DO NOT store: isEncrypted, originalLength, algorithm
  },
  
  // Moderation & Safety (CRITICAL for dating app)
  moderation: {
    status: {
      type: String,
      enum: ['pending', 'approved', 'flagged', 'hidden', 'deleted_by_mod', 'quarantined'],
      default: 'pending',
    },
    score: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    flags: [{
      type: String,
      enum: [
        'harassment', 'spam', 'inappropriate_content', 'nudity',
        'personal_info', 'underage', 'commercial', 'hate_speech',
        'threat', 'scam', 'impersonation', 'copyright'
      ]
    }],
    reviewedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    reviewedAt: Date,
    autoModerated: Boolean,
    moderationNote: String
  },
  
  // User reports
  reports: [{
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    reason: {
      type: String,
      enum: [
        'harassment', 'spam', 'inappropriate', 'scam',
        'underage', 'personal_info', 'other'
      ]
    },
    details: String,
    timestamp: { 
      type: Date, 
      default: Date.now 
    }
  }],
  reportCount: {
    type: Number,
    default: 0,
  },
  
  // Soft delete
  deletedFor: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  permanentlyDeleted: {
    type: Boolean,
    default: false,
  },
  
  // Edit tracking
  editedAt: Date,
  isEdited: Boolean,
  editHistory: [{
    content: String,
    editedAt: Date,
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  
  // Reactions
  reactions: [{
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    emoji: String,
    timestamp: { 
      type: Date, 
      default: Date.now 
    }
  }],
  
  // Privacy controls
  hiddenForUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  visibleOnlyTo: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  // Analytics metadata (safe, encrypted data only)
  metadata: {
    encryptedLength: Number,
    charCount: Number,
    timestampHash: String,
    conversationPosition: Number,
    // Dating app specific
    isFirstMessage: Boolean,
    matchDuration: Number, // How long users were matched before message
    sharedInterests: [String],
    // Safety metadata
    safetyChecked: Boolean,
    safetyCheckTimestamp: Date
  }
}, {
  timestamps: true,
  collation: { locale: 'en', strength: 2 }
});

// ========== COMPOUND INDEXES FOR PERFORMANCE ==========

// For fetching conversation messages
// messageSchema.index({ 
//   conversationId: 1, 
//   createdAt: -1 
// }, { 
//   name: 'conversation_messages_idx' 
// });

// messageSchema.index({ 
//   conversationId: 1, 
//   'metadata.conversationPosition': 1 
// }, { 
//   name: 'conversation_position_idx' 
// });

// For user-specific queries
// messageSchema.index({ 
//   senderId: 1, 
//   createdAt: -1 
// }, { 
//   name: 'user_sent_messages_idx',
//   partialFilterExpression: { 
//     permanentlyDeleted: false,
//     'moderation.status': { $in: ['pending', 'approved'] }
//   }
// });

// messageSchema.index({ 
//   receiverId: 1, 
//   createdAt: -1 
// }, { 
//   name: 'user_received_messages_idx',
//   partialFilterExpression: { 
//     permanentlyDeleted: false,
//     'moderation.status': { $in: ['pending', 'approved'] }
//   }
// });

// For moderation queue
// messageSchema.index({ 
//   'moderation.status': 1,
//   createdAt: 1 
// }, { 
//   name: 'moderation_queue_idx',
//   partialFilterExpression: { 
//     'moderation.status': 'pending',
//     type: { $in: ['text', 'image', 'video'] }
//   }
// });

// For safety scoring
// messageSchema.index({ 
//   'moderation.score': -1,
//   createdAt: -1 
// }, { 
//   name: 'safety_score_idx',
//   partialFilterExpression: { 
//     'moderation.score': { $gt: 0.5 }
//   }
// });

// For duplicate detection (short TTL)
// messageSchema.index({ 
//   contentHash: 1,
//   createdAt: 1 
// }, { 
//   name: 'duplicate_detection_idx',
//   expireAfterSeconds: 300, // 5 minutes
//   partialFilterExpression: { 
//     source: { $in: ['socket', 'http'] }
//   }
// });

// For read receipts
// messageSchema.index({ 
//   conversationId: 1,
//   readBy: 1 
// }, { 
//   name: 'read_status_idx',
//   sparse: true
// });

// For cleanup of old failed messages
// messageSchema.index({ 
//   createdAt: 1 
// }, { 
//   name: 'cleanup_idx',
//   expireAfterSeconds: 30 * 24 * 60 * 60, // 30 days
//   partialFilterExpression: { 
//     status: 'failed',
//     permanentlyDeleted: true
//   }
// });

// ========== PRE-SAVE MIDDLEWARE ==========

messageSchema.pre('save', async function(next) {
  // Only for new documents
  if (this.isNew) {
    try {
      // Generate conversationId if not set (fallback)
      if (!this.conversationId && this.senderId && this.receiverId) {
        // This should ideally come from Conversation service
        // For now, create a deterministic ID
        const participants = [this.senderId, this.receiverId]
          .map(id => id.toString())
          .sort();
        this.conversationId = new mongoose.Types.ObjectId(); // Placeholder
      }
      
      // Generate content hash for deduplication (SHA-256)
      if (this.content) {
        this.contentHash = crypto
          .createHash('sha256')
          .update(this.content)
          .digest('hex')
          .substring(0, 32);
      }
      
      // Set metadata
      if (!this.metadata) {
        this.metadata = {};
      }
      
      this.metadata.encryptedLength = this.content ? this.content.length : 0;
      this.metadata.charCount = this.content ? this.content.length : 0;
      
      // Set conversation position (incrementing)
      if (this.conversationId) {
        const lastMessage = await mongoose.models.Message.findOne(
          { conversationId: this.conversationId },
          { 'metadata.conversationPosition': 1 }
        )
        .sort({ 'metadata.conversationPosition': -1 })
        .lean();
        
        this.metadata.conversationPosition = (lastMessage?.metadata?.conversationPosition || 0) + 1;
      }
      
      // Check if this is first message between users
      const existingMessages = await mongoose.models.Message.countDocuments({
        $or: [
          { senderId: this.senderId, receiverId: this.receiverId },
          { senderId: this.receiverId, receiverId: this.senderId }
        ]
      });
      
      this.metadata.isFirstMessage = existingMessages === 0;
      
      // Generate timestamp hash for ordering without exposing exact time
      this.metadata.timestampHash = crypto
        .createHash('md5')
        .update(Date.now().toString() + this._id.toString())
        .digest('hex')
        .substring(0, 16);
      
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

// ========== INSTANCE METHODS ==========

// Check if message is encrypted (based on version)
messageSchema.methods.isEncrypted = function() {
  return this.encryption.version !== 'system';
};

// Check if message needs moderation
messageSchema.methods.needsModeration = function() {
  return this.moderation.status === 'pending' && 
         this.type !== 'system' &&
         !this.permanentlyDeleted;
};

// Get safe content for display (placeholder for encrypted)
messageSchema.methods.getSafeContent = function() {
  if (this.type === 'system') {
    return this.content;
  }
  
  if (this.moderation.status === 'hidden' || this.moderation.status === 'deleted_by_mod') {
    return '[This message has been removed by moderators]';
  }
  
  if (this.moderation.status === 'flagged') {
    return '[This message is under review]';
  }
  
  // For encrypted messages, client will decrypt
  return this.content;
};

// Check if user can view this message
messageSchema.methods.canUserView = function(userId) {
  if (this.permanentlyDeleted) {
    return false;
  }
  
  if (this.deletedFor?.includes(userId)) {
    return false;
  }
  
  if (this.hiddenForUsers?.includes(userId)) {
    return false;
  }
  
  if (this.visibleOnlyTo?.length > 0 && !this.visibleOnlyTo.includes(userId)) {
    return false;
  }
  
  // Check if user is sender or receiver
  const isParticipant = 
    this.senderId.toString() === userId.toString() ||
    this.receiverId.toString() === userId.toString();
    
  if (!isParticipant) {
    return false;
  }
  
  // Check moderation status
  if (this.moderation.status === 'hidden' || this.moderation.status === 'deleted_by_mod') {
    return false;
  }
  
  return true;
};

// ========== STATIC METHODS ==========

// Find messages for a conversation with safety checks
messageSchema.statics.findSafeMessages = function(conversationId, userId, options = {}) {
  const query = {
    conversationId,
    deletedFor: { $ne: userId },
    hiddenForUsers: { $ne: userId },
    permanentlyDeleted: false,
    $or: [
      { 'moderation.status': { $in: ['pending', 'approved'] } },
      { 
        $and: [
          { 'moderation.status': 'flagged' },
          { 
            $or: [
              { senderId: userId },
              { receiverId: userId }
            ]
          }
        ]
      }
    ]
  };
  
  return this.find(query)
    .sort({ createdAt: 1 })
    .skip(options.skip || 0)
    .limit(options.limit || 50)
    .populate('senderId', 'firstName lastName avatar userName isVerified')
    .populate('receiverId', 'firstName lastName avatar userName isVerified')
    .lean();
};

// Count unread messages for a user in conversation
messageSchema.statics.countUnread = function(conversationId, userId) {
  return this.countDocuments({
    conversationId,
    receiverId: userId,
    readBy: { $ne: userId },
    deletedFor: { $ne: userId },
    permanentlyDeleted: false,
    'moderation.status': { $in: ['pending', 'approved'] }
  });
};

// Find messages needing moderation
messageSchema.statics.findNeedingModeration = function(limit = 100) {
  return this.find({
    'moderation.status': 'pending',
    type: { $in: ['text', 'image', 'video'] },
    permanentlyDeleted: false
  })
  .sort({ 'moderation.score': -1, createdAt: 1 })
  .limit(limit)
  .populate('senderId', 'firstName lastName email ageVerified')
  .populate('receiverId', 'firstName lastName email ageVerified')
  .lean();
};

// Update moderation status
messageSchema.statics.updateModerationStatus = function(messageId, status, moderatorId = null, note = '') {
  const update = {
    'moderation.status': status,
    'moderation.reviewedAt': new Date()
  };
  
  if (moderatorId) {
    update['moderation.reviewedBy'] = moderatorId;
  }
  
  if (note) {
    update['moderation.moderationNote'] = note;
  }
  
  return this.findByIdAndUpdate(
    messageId,
    { $set: update },
    { new: true }
  );
};

// Find potential duplicates
messageSchema.statics.findDuplicates = function(senderId, receiverId, contentHash, timeWindowSeconds = 10) {
  const timeWindow = new Date(Date.now() - (timeWindowSeconds * 1000));
  
  return this.find({
    senderId,
    receiverId,
    contentHash,
    createdAt: { $gte: timeWindow }
  })
  .select('_id createdAt')
  .lean();
};

// Cleanup old messages (admin only)
messageSchema.statics.cleanupOldMessages = async function(days = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const result = await this.updateMany(
    {
      createdAt: { $lt: cutoffDate },
      permanentlyDeleted: true,
      type: { $ne: 'system' }
    },
    {
      $set: {
        content: '[DELETED]',
        'mediaInfo.url': null,
        'mediaInfo.thumbnailUrl': null
      }
    }
  );
  
  return result;
};

// ========== VIRTUAL FIELDS ==========

messageSchema.virtual('isRead').get(function() {
  return this.status === 'read' || this.readAt != null;
});

messageSchema.virtual('isDelivered').get(function() {
  return this.status === 'delivered' || this.deliveredAt != null;
});

messageSchema.virtual('hasMedia').get(function() {
  return this.type !== 'text' && this.type !== 'system';
});

messageSchema.virtual('isSafe').get(function() {
  return this.moderation.status === 'approved' || 
         (this.moderation.status === 'pending' && this.moderation.score < 0.3);
});

// ========== QUERY HELPERS ==========

messageSchema.query.byConversation = function(conversationId) {
  return this.where({ conversationId });
};

messageSchema.query.byUser = function(userId) {
  return this.where({
    $or: [
      { senderId: userId },
      { receiverId: userId }
    ]
  });
};

messageSchema.query.notDeletedFor = function(userId) {
  return this.where({ deletedFor: { $ne: userId } });
};

messageSchema.query.safeForUser = function(userId) {
  return this.where({
    deletedFor: { $ne: userId },
    hiddenForUsers: { $ne: userId },
    permanentlyDeleted: false,
    'moderation.status': { $in: ['pending', 'approved'] }
  });
};

// ========== POST-SAVE HOOKS ==========

messageSchema.post('save', function(doc) {
  // Emit event for real-time updates
  // This would be handled by your Socket.io or event system
  // For example:
  // require('../events/messageEvents').emit('message:saved', doc);
});

messageSchema.post('findOneAndUpdate', function(doc) {
  if (doc) {
    // Emit update event
    // require('../events/messageEvents').emit('message:updated', doc);
  }
});

module.exports = mongoose.model('Message', messageSchema);