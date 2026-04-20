const mongoose = require("mongoose");

// ========== ROLES & PERMISSIONS ==========
const ROLES = {
  USER: 'user',
  MODERATOR: 'moderator',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin'
};

const ROLE_HIERARCHY = {
  [ROLES.USER]: 0,
  [ROLES.MODERATOR]: 1,
  [ROLES.ADMIN]: 2,
  [ROLES.SUPER_ADMIN]: 3
};

// ========== DEFINE ROLE_PERMISSIONS WITHOUT SELF-REFERENCE ==========
const USER_PERMISSIONS = [
  'view_profile',
  'edit_own_profile',
  'send_messages',
  'create_matches',
  'use_dating_features',
  'report_users',
  'block_users'
];

const MODERATOR_PERMISSIONS = [
  ...USER_PERMISSIONS,
  'view_reports',
  'review_content',
  'warn_users',
  'suspend_users',
  'view_analytics'
];

const ADMIN_PERMISSIONS = [
  ...MODERATOR_PERMISSIONS,
  'manage_staff',
  'view_all_data',
  'manage_settings',
  'export_data',
  'manage_premium_features'
];

const SUPER_ADMIN_PERMISSIONS = [
  ...ADMIN_PERMISSIONS,
  'manage_admins',
  'system_config',
  'delete_data',
  'audit_logs',
  'manage_permissions'
];

const ROLE_PERMISSIONS = {
  [ROLES.USER]: USER_PERMISSIONS,
  [ROLES.MODERATOR]: MODERATOR_PERMISSIONS,
  [ROLES.ADMIN]: ADMIN_PERMISSIONS,
  [ROLES.SUPER_ADMIN]: SUPER_ADMIN_PERMISSIONS
};

// ========== BASE USER SCHEMA ==========
const baseUserSchema = new mongoose.Schema({
  // ========== CORE FIELDS ==========
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  
  phoneNumber: {
    type: String,
    sparse: true,
    trim: true,
    unique: true,
    match: [/^\+?[\d\s-]+$/, 'Please enter a valid phone number']
  },
  
  phoneVerified: {
    type: Boolean,
    default: false
  },
  
  emailVerified: {
    type: Boolean,
    default: false
  },
  
  emailVerifiedAt: Date,
  phoneVerifiedAt: Date,
  
  // ========== EMAIL VERIFICATION TOKENS ==========
  emailVerificationToken: {
    type: String,
    sparse: true,
    index: true
  },
  
  emailVerificationExpires: {
    type: Date,
    index: true
  },
  
  // ========== PASSWORD RESET TOKENS ==========
  passwordResetToken: {
    type: String,
    sparse: true,
    index: true
  },
  
  passwordResetExpires: {
    type: Date,
    index: true
  },
  
  // ========== PASSWORD HISTORY ==========
  passwordHistory: [{
    type: String,
    select: false
  }],
  
  lastPasswordChange: {
    type: Date,
    default: Date.now
  },
  
  // ========== FAILED LOGIN TRACKING ==========
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  
  accountLockedUntil: {
    type: Date,
    default: null
  },
  
  // ========== AGE VERIFICATION (SYNCED FROM DATING USER) ==========
  ageVerified: {
    type: Boolean,
    default: false
  },
  
  ageVerifiedAt: Date,
  
  // ========== USER IDENTITY ==========
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  
  userName: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  
  dateOfBirth: {
    type: Date,
    required: false
  },
  
  // ========== ROLE & PERMISSIONS ==========
  role: {
    type: String,
    enum: Object.values(ROLES),
    default: ROLES.USER,
    required: true
  },
  
  userType: {
    type: String,
    enum: ['BaseUser', 'DatingUser', 'Moderator', 'Admin', 'SuperAdmin'],
    default: 'BaseUser',
    required: true
  },
  
  permissions: [String],
  
  // ========== TOKEN VERSION ==========
  tokenVersion: {
    type: Number,
    default: 1
  },
  
  // ========== ACCOUNT STATUS ==========
  accountStatus: {
    type: String,
    enum: ['active', 'pending_verification', 'pending_approval', 'suspended', 'deactivated', 'banned'],
    default: 'pending_verification',
    required: true
  },
  
  suspensionReason: String,
  suspendedUntil: Date,
  deactivatedAt: Date,
  bannedAt: Date,
  
  // ========== SECURITY ==========
  loginAttempts: {
    type: Number,
    default: 0
  },
  
  lockUntil: Date,
  
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  
  twoFactorSecret: String,
  
  refreshTokens: [{
    token: String,
    deviceId: String,
    deviceName: String,
    ipAddress: String,
    userAgent: String,
    expiresAt: Date,
    createdAt: { type: Date, default: Date.now }
  }],
  
  refreshToken: {
    type: String,
    select: false,
    sparse: true
  },
  
  // ========== VERIFICATION BADGES ==========
  badges: [{
    type: {
      type: String,
      enum: ['phone', 'email', 'age', 'identity', 'premium', 'staff', 'verified']
    },
    grantedAt: { type: Date, default: Date.now },
    expiresAt: Date,
    grantedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BaseUser'
    }
  }],
  
  // ========== PRESENCE ==========
  presence: {
    status: {
      type: String,
      enum: ['online', 'away', 'busy', 'offline'],
      default: 'offline'
    },
    lastSeen: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now }
  },
  
  // ========== TIMESTAMPS ==========
  lastLogin: Date,
  lastActive: { type: Date, default: Date.now },
  ipAddress: String,
  
  registrationDate: {
    type: Date,
    default: Date.now
  },
  
  // ========== TERMS & CONSENT ==========
  termsAccepted: {
    type: Boolean,
    default: false
  },
  
  termsAcceptedAt: Date,
  privacyPolicyAcceptedAt: Date,
  marketingConsent: { type: Boolean, default: false }
}, {
  timestamps: true,
  discriminatorKey: 'userType',
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ========== INDEXES ==========
baseUserSchema.index({ role: 1, accountStatus: 1 });
baseUserSchema.index({ createdAt: -1 });
baseUserSchema.index({ lastActive: -1 });
baseUserSchema.index({ 'badges.type': 1 });
baseUserSchema.index({ tokenVersion: 1 });

// ========== VIRTUAL PROPERTIES ==========
baseUserSchema.virtual("fullName").get(function() {
  return `${this.firstName} ${this.lastName}`;
});

baseUserSchema.virtual("age").get(function() {
  if (!this.dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(this.dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
});

baseUserSchema.virtual("isActive").get(function() {
  return this.accountStatus === 'active';
});

baseUserSchema.virtual("isPendingVerification").get(function() {
  return this.accountStatus === 'pending_verification';
});

baseUserSchema.virtual("isLocked").get(function() {
  return this.lockUntil && this.lockUntil > Date.now();
});

baseUserSchema.virtual("isAdminUser").get(function() {
  return [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(this.role);
});

baseUserSchema.virtual("isStaffUser").get(function() {
  return [ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(this.role);
});

// ========== INSTANCE METHODS ==========
baseUserSchema.methods.hasPermission = function(permission) {
  if (this.role === ROLES.SUPER_ADMIN) return true;
  const rolePermissions = ROLE_PERMISSIONS[this.role] || [];
  return rolePermissions.includes(permission) || this.permissions?.includes(permission);
};

baseUserSchema.methods.compareRole = function(otherUser) {
  const thisLevel = ROLE_HIERARCHY[this.role] || 0;
  const otherLevel = ROLE_HIERARCHY[otherUser.role] || 0;
  return thisLevel - otherLevel;
};

baseUserSchema.methods.canManageUser = function(targetUser) {
  if (this._id.equals(targetUser._id)) return false;
  if (this.role === ROLES.SUPER_ADMIN) return true;
  return this.compareRole(targetUser) > 0;
};

baseUserSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.twoFactorSecret;
  delete obj.refreshTokens;
  delete obj.refreshToken;
  delete obj.passwordHistory;
  delete obj.__v;
  return obj;
};

baseUserSchema.methods.incrementLoginAttempts = function() {
  this.loginAttempts += 1;
  if (this.loginAttempts >= 5) {
    this.lockUntil = Date.now() + 30 * 60 * 1000;
  }
  return this.save();
};

baseUserSchema.methods.resetLoginAttempts = function() {
  this.loginAttempts = 0;
  this.lockUntil = null;
  return this.save();
};

baseUserSchema.methods.addBadge = function(badgeType, expiresIn = null, grantedBy = null) {
  const badge = {
    type: badgeType,
    grantedAt: new Date(),
    grantedBy
  };
  
  if (expiresIn) {
    badge.expiresAt = new Date(Date.now() + expiresIn);
  }
  
  this.badges.push(badge);
  return this.save();
};

baseUserSchema.methods.hasBadge = function(badgeType) {
  return this.badges.some(badge => 
    badge.type === badgeType && 
    (!badge.expiresAt || badge.expiresAt > new Date())
  );
};

baseUserSchema.methods.isPasswordInHistory = async function(newPassword) {
  if (!this.passwordHistory || this.passwordHistory.length === 0) return false;
  
  const bcrypt = require('bcryptjs');
  for (const oldPassword of this.passwordHistory) {
    const isMatch = await bcrypt.compare(newPassword, oldPassword);
    if (isMatch) return true;
  }
  return false;
};

baseUserSchema.methods.updatePassword = async function(newPassword) {
  const bcrypt = require('bcryptjs');
  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(newPassword, salt);
  
  this.password = hashedPassword;
  this.lastPasswordChange = new Date();
  
  if (!this.passwordHistory) {
    this.passwordHistory = [];
  }
  
  this.passwordHistory.push(hashedPassword);
  if (this.passwordHistory.length > 5) {
    this.passwordHistory = this.passwordHistory.slice(-5);
  }
  
  this.tokenVersion = (this.tokenVersion || 1) + 1;
  this.refreshToken = null;
  this.refreshTokens = [];
  
  return this;
};

baseUserSchema.methods.updatePresence = async function(status) {
  this.presence = {
    status: status || 'online',
    lastSeen: new Date(),
    lastActive: new Date()
  };
  this.lastActive = new Date();
  return this.save({ validateBeforeSave: false });
};

// ========== STATIC METHODS ==========
baseUserSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

baseUserSchema.statics.findByUserName = function(userName) {
  return this.findOne({ userName });
};

baseUserSchema.statics.findActive = function() {
  return this.find({ accountStatus: 'active' });
};

baseUserSchema.statics.findByRole = function(role) {
  return this.find({ role });
};

baseUserSchema.statics.findByVerificationToken = function(token) {
  const hashedToken = require('crypto').createHash('sha256').update(token).digest('hex');
  return this.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() }
  });
};

baseUserSchema.statics.findByPasswordResetToken = function(token) {
  const hashedToken = require('crypto').createHash('sha256').update(token).digest('hex');
  return this.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() }
  });
};

baseUserSchema.statics.validatePasswordStrength = function(password) {
  if (!password) return { isValid: false, errors: ['Password is required'] };
  
  const errors = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  const commonPasswords = ['password123', '12345678', 'qwerty123', 'admin123', 'password'];
  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push('This password is too common');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    strength: errors.length === 0 ? 'strong' : errors.length <= 2 ? 'medium' : 'weak'
  };
};

// ========== MIDDLEWARE ==========
baseUserSchema.pre('save', function() {
  this.lastActive = new Date();
  
  if (this.emailVerified && !this.emailVerifiedAt) {
    this.emailVerifiedAt = new Date();
  }
  
  if (this.phoneVerified && !this.phoneVerifiedAt) {
    this.phoneVerifiedAt = new Date();
  }
  
  if (this.isModified('accountStatus') && this.accountStatus === 'active') {
    this.emailVerified = true;
    if (!this.emailVerifiedAt) {
      this.emailVerifiedAt = new Date();
    }
  }
});

baseUserSchema.pre('save', function() {
  if (!this.presence) {
    this.presence = {
      status: 'offline',
      lastSeen: new Date(),
      lastActive: new Date()
    };
  }
});

module.exports = {
  baseUserSchema,
  ROLES,
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS
};