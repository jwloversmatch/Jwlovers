// models/InviteCode.model.js - CORRECTED VERSION
const mongoose = require('mongoose');
const crypto = require('crypto');
const { ROLES } = require('@middleware/authmiddleware');

const inviteCodeSchema = new mongoose.Schema({
  // Unique code (auto-generated)
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    default: () => crypto.randomBytes(8).toString('hex').toUpperCase()
  },
  
  // Role this code grants
  role: {
    type: String,
    required: true,
    enum: Object.values(ROLES).filter(r => r !== ROLES.USER), // Only admin roles
    default: ROLES.MODERATOR
  },
  
  // Who created this code
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BaseUser',
    required: true,
  },
  
  // Who used this code
  usedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BaseUser',
  },
  
  usedAt: {
    type: Date,
  },
  
  // Status management - FIXED: Changed from String to Boolean
  isActive: {
    type: Boolean,  // ← FIXED THIS LINE
    default: true,
  },
  
  // Expiration
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
  },
  
  // Usage limits
  maxUses: {
    type: Number,
    default: 1,
    min: 1,
    max: 100,
    validate: {
      validator: Number.isInteger,
      message: 'maxUses must be an integer'
    }
  },
  
  uses: {
    type: Number,
    default: 0,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'uses must be an integer'
    }
  },
  
  // Optional description
  description: {
    type: String,
    maxlength: 500,
    trim: true
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      delete ret._id;
      return ret;
    }
  },
  toObject: {
    virtuals: true
  }
});

// ============ VIRTUAL PROPERTIES ============
inviteCodeSchema.virtual('remainingUses').get(function() {
  return this.maxUses - this.uses;
});

inviteCodeSchema.virtual('isExpired').get(function() {
  return this.expiresAt && this.expiresAt < new Date();
});

inviteCodeSchema.virtual('canBeUsed').get(function() {
  // FIX: Added explicit boolean check for isActive
  return this.isActive === true && this.uses < this.maxUses && 
         (!this.expiresAt || this.expiresAt > new Date());
});

// ============ INSTANCE METHODS ============
inviteCodeSchema.methods.isValid = function() {
  return this.canBeUsed;
};

inviteCodeSchema.methods.use = async function(userId) {
  if (!this.canBeUsed) {
    throw new Error('Invite code is not valid or has expired');
  }
  
  this.usedBy = userId;
  this.usedAt = new Date();
  this.uses += 1;
  
  // Deactivate if max uses reached
  if (this.uses >= this.maxUses) {
    this.isActive = false;
  }
  
  return this.save({
    validateBeforeSave: true,
    timestamps: true
  });
};

// ============ STATIC METHODS ============
inviteCodeSchema.statics.generate = async function(data) {
  const { role, createdBy, maxUses = 1, expiresAt, description } = data;
  
  if (!role || !createdBy) {
    throw new Error('Role and createdBy are required');
  }
  
  const code = await this.generateUniqueCode();
  
  const inviteCode = new this({
    code,
    role,
    createdBy,
    maxUses,
    expiresAt: expiresAt || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    description
  });
  
  return inviteCode.save();
};

inviteCodeSchema.statics.generateUniqueCode = async function(attempts = 0) {
  if (attempts >= 10) {
    throw new Error('Failed to generate unique invite code after 10 attempts');
  }
  
  const code = crypto.randomBytes(6).toString('hex').toUpperCase();
  const existing = await this.findOne({ code });
  
  if (existing) {
    return this.generateUniqueCode(attempts + 1);
  }
  
  return code;
};

inviteCodeSchema.statics.validateAndUse = async function(code, userId, requestedRole) {
  const invite = await this.findOne({ 
    code: code.trim().toUpperCase(),
    isActive: true
  });
  
  if (!invite) {
    throw new Error('Invalid or inactive invite code');
  }
  
  if (!invite.canBeUsed) {
    throw new Error('Invite code has expired or reached usage limit');
  }
  
  if (invite.role !== requestedRole) {
    throw new Error(`This invite code is for ${invite.role} role, not ${requestedRole}`);
  }
  
  return invite.use(userId);
};

// ============ QUERY HELPERS ============
inviteCodeSchema.query.active = function() {
  return this.where({ isActive: true })
            .where('expiresAt').gt(new Date())
            .where('uses').lt(this.maxUses);
};

inviteCodeSchema.query.byRole = function(role) {
  return this.where({ role });
};

inviteCodeSchema.query.expired = function() {
  return this.where('expiresAt').lt(new Date());
};

// ============ MODEL EXPORT ============
const InviteCode = mongoose.model('InviteCode', inviteCodeSchema);

module.exports = InviteCode;