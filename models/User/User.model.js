// const mongoose = require("mongoose");
// const validator = require("validator");
// const bcrypt = require("bcryptjs");

// // ========== ROLE CONSTANTS & PERMISSIONS ==========
// const ROLES = {
//   USER: 'user',
//   MODERATOR: 'moderator',
//   ADMIN: 'admin',
//   SUPER_ADMIN: 'super_admin'
// };

// const ROLE_HIERARCHY = {
//   [ROLES.USER]: 0,
//   [ROLES.MODERATOR]: 1,
//   [ROLES.ADMIN]: 2,
//   [ROLES.SUPER_ADMIN]: 3
// };

// // First define the base permissions for each role
// const USER_PERMISSIONS = [
//   'read_own_profile',
//   'update_own_profile',
//   'view_matches',
//   'send_messages',
//   'like_profiles',
//   'update_own_settings'
// ];

// const MODERATOR_PERMISSIONS = [
//   ...USER_PERMISSIONS,
//   'view_all_profiles',
//   'suspend_users',
//   'review_reports',
//   'remove_content',
//   'manage_user_content'
// ];

// const ADMIN_PERMISSIONS = [
//   ...MODERATOR_PERMISSIONS,
//   'create_moderators',
//   'manage_all_users',
//   'view_analytics',
//   'configure_system',
//   'manage_user_roles'
// ];

// const SUPER_ADMIN_PERMISSIONS = [
//   ...ADMIN_PERMISSIONS,
//   'create_admins',
//   'manage_admins',
//   'system_configuration',
//   'database_operations',
//   'view_audit_logs',
//   'full_system_access'
// ];

// // Now define ROLE_PERMISSIONS using the individual arrays
// const ROLE_PERMISSIONS = {
//   [ROLES.USER]: USER_PERMISSIONS,
//   [ROLES.MODERATOR]: MODERATOR_PERMISSIONS,
//   [ROLES.ADMIN]: ADMIN_PERMISSIONS,
//   [ROLES.SUPER_ADMIN]: SUPER_ADMIN_PERMISSIONS
// };

// const userSchema = new mongoose.Schema(
//   {
//     // ========== AUTHENTICATION ==========
//     email: {
//       type: String,
//       required: [true, "Email is required"],
//       unique: true,
//       trim: true,
//       lowercase: true,
//       validate: {
//         validator: validator.isEmail,
//         message: "Please provide a valid email address",
//       },
//     },
    
//     password: {
//       type: String,
//       required: [true, "Password is required"],
//       minlength: [8, "Password must be at least 8 characters"],
//       select: false,
//       validate: {
//         validator: function(v) {
//           // Only validate on registration/update, not on login
//           if (this.isModified('password') && !v.startsWith('$2')) {
//             return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(v);
//           }
//           return true;
//         },
//         message: "Password must contain uppercase, lowercase, numbers, and special characters"
//       }
//     },
    
//     passwordHistory: {
//       type: [String],
//       select: false,
//       default: []
//     },
    
//     // ========== CORE IDENTITY ==========
//     firstName: {
//       type: String,
//       required: [true, "First name is required"],
//       trim: true,
//       maxlength: [50, "First name cannot exceed 50 characters"],
//     },
    
//     lastName: {
//       type: String,
//       required: [true, "Last name is required"],
//       trim: true,
//       maxlength: [50, "Last name cannot exceed 50 characters"],
//     },
    
//     userName: {
//       type: String,
//       trim: true,
//       unique: true,
//       sparse: true,
//       lowercase: true,
//       minlength: [3, "Username must be at least 3 characters"],
//       maxlength: [20, "Username cannot exceed 20 characters"],
//       validate: {
//         validator: function(v) {
//           return /^[a-zA-Z0-9_-]+$/.test(v);
//         },
//         message: "Username can only contain letters, numbers, underscores and hyphens"
//       },
//     },
    
//     // ========== PHONE (Auth + Optional Sharing) ==========
//     phoneNumber: {
//       type: String,
//       trim: true,
//       select: false,
//       validate: {
//         validator: function(v) {
//           return !v || validator.isMobilePhone(v, "any", { strictMode: false });
//         },
//         message: "Please provide a valid phone number"
//       }
//     },
    
//     phoneVerified: {
//       type: Boolean,
//       default: false,
//       select: false
//     },
    
//     sharePhone: {
//       type: String,
//       enum: ["hidden", "matches_only", "verified_matches", "everyone"],
//       default: "hidden"
//     },
    
//     // ========== DATING APP ESSENTIALS ==========
//     dateOfBirth: {
//       type: Date,
//       required: [true, "Date of birth is required for dating app"],
//       validate: {
//         validator: function(v) {
//           const today = new Date();
//           const birthDate = new Date(v);
//           let age = today.getFullYear() - birthDate.getFullYear();
//           const monthDiff = today.getMonth() - birthDate.getMonth();
          
//           if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
//             age--;
//           }
          
//           return age >= 18 && age <= 100;
//         },
//         message: "You must be 18-100 years old to register"
//       }
//     },
    
//     avatar: {
//       type: String,
//       default: null,
//       validate: {
//         validator: function(v) {
//           if (!v) return true;
//           return validator.isURL(v, {
//             protocols: ['http', 'https'],
//             require_protocol: true,
//             require_valid_protocol: true
//           });
//         },
//         message: "Please provide a valid avatar URL"
//       }
//     },
    
//     // ========== ACCOUNT STATUS ==========
//     accountStatus: {
//       type: String,
//       enum: ["pending_verification", "active", "suspended", "deactivated", "banned"],
//       default: "pending_verification",
//     },
    
//     emailVerified: {
//       type: Boolean,
//       default: false,
//     },
    
//     ageVerified: {
//       type: Boolean,
//       default: false,
//     },
    
//     // ========== PRESENCE & ONLINE STATUS ==========
//     presence: {
//       status: {
//         type: String,
//         enum: ["online", "away", "busy", "offline", "invisible"],
//         default: "offline",
//       },
//       lastSeen: {
//         type: Date,
//         default: Date.now,
//       },
//       lastActive: {
//         type: Date,
//         default: Date.now,
//       }
//     },
    
//     // ========== ROLE & PERMISSIONS ==========
//     role: {
//       type: String,
//       enum: ["user", "moderator", "admin", "super_admin"],
//       default: "user",
//     },
    
//     // ========== ADMIN SPECIFIC FIELDS ==========
//     adminNotes: {
//       type: String,
//       select: false,
//       default: null,
//       maxlength: [500, "Admin notes cannot exceed 500 characters"]
//     },
    
//     lastAdminAction: {
//       action: String,
//       performedBy: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: 'User'
//       },
//       performedAt: Date,
//       reason: String
//     },
    
//     statusChangeHistory: [{
//       from: String,
//       to: String,
//       changedBy: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: 'User'
//       },
//       reason: String,
//       timestamp: {
//         type: Date,
//         default: Date.now
//       }
//     }],
    
//     // ========== TOKENS & SESSIONS ==========
//     refreshToken: {
//       type: String,
//       select: false,
//     },
//     currentSessionId: {
//       type: String,
//       select: false
//     },
    
//     // ========== DATING PREFERENCES (Basic) ==========
//     preferences: {
//       lookingFor: {
//         type: [String],
//         enum: ["friendship", "dating", "relationship", "casual", "marriage"],
//         default: ["dating"]
//       },
//       ageRange: {
//         min: { type: Number, min: 18, max: 100, default: 18 },
//         max: { type: Number, min: 18, max: 100, default: 100 }
//       },
//       distance: {
//         type: Number,
//         min: 1,
//         max: 100,
//         default: 50
//       },
//       interests: [{
//         type: String,
//         trim: true
//       }]
//     },
    
//     // ========== LOCATION (For matching) ==========
//     location: {
//       type: {
//         type: String,
//         enum: ['Point'],
//         default: 'Point'
//       },
//       coordinates: {
//         type: [Number], // [longitude, latitude]
//         index: '2dsphere'
//       },
//       city: String,
//       country: String,
//       timezone: String,
//       lastUpdated: Date
//     },
    
//     // ========== SECURITY ==========
//     failedLoginAttempts: {
//       type: Number,
//       default: 0,
//       select: false
//     },
//     accountLockedUntil: {
//       type: Date,
//       select: false
//     },
//     lastPasswordChange: {
//       type: Date,
//       default: Date.now,
//       select: false
//     },
//     passwordResetToken: {
//       type: String,
//       select: false
//     },
//     passwordResetExpires: {
//       type: Date,
//       select: false
//     },
//     emailVerificationToken: {
//       type: String,
//       select: false
//     },
//     emailVerificationExpires: {
//       type: Date,
//       select: false
//     },
    
//     // ========== SETTINGS (Simple) ==========
//     notificationSettings: {
//       email: { type: Boolean, default: true },
//       push: { type: Boolean, default: true },
//       messages: { type: Boolean, default: true },
//       matches: { type: Boolean, default: true },
//       likes: { type: Boolean, default: true },
//       safetyAlerts: { type: Boolean, default: true }
//     },
    
//     privacySettings: {
//       profileVisibility: {
//         type: String,
//         enum: ["public", "matches_only", "private"],
//         default: "public"
//       },
//       showOnlineStatus: { type: Boolean, default: true },
//       showLastSeen: { 
//         type: String,
//         enum: ["everyone", "matches", "nobody"],
//         default: "everyone"
//       },
//       allowMessagesFrom: {
//         type: String,
//         enum: ["everyone", "matches", "nobody"],
//         default: "everyone"
//       }
//     },
    
//     messagingPreferences: {
//       type: String,
//       enum: ["everyone", "matches_only", "friends_only", "disabled"],
//       default: "everyone"
//     },
//   },
//   {
//     timestamps: true,
//     toJSON: {
//       virtuals: true,
//       transform: function (doc, ret) {
//         ret.id = ret._id;
        
//         if (ret.dateOfBirth) {
//           ret.age = doc.calculateAge(new Date(ret.dateOfBirth));
//         }
        
//         // Hide sensitive fields
//         const sensitiveFields = [
//           'password', '__v', 'refreshToken', 'passwordHistory',
//           'failedLoginAttempts', 'accountLockedUntil', 'passwordResetToken',
//           'passwordResetExpires', 'emailVerificationToken', 'emailVerificationExpires',
//           'currentSessionId', 'phoneNumber', 'phoneVerified'
//         ];
        
//         // Don't show admin fields to non-admins in toJSON
//         if (!doc._isAdminView) {
//           sensitiveFields.push('adminNotes', 'lastAdminAction', 'statusChangeHistory');
//         }
        
//         sensitiveFields.forEach(field => {
//           delete ret[field];
//         });
        
//         return ret;
//       },
//     },
//   }
// );

// // ========== INDEXES ==========
// userSchema.index({ email: 1 }, { unique: true });
// userSchema.index({ userName: 1 }, { sparse: true, unique: true });
// userSchema.index({ 'location.coordinates': '2dsphere' });
// userSchema.index({ accountStatus: 1, 'presence.lastSeen': -1 });
// userSchema.index({ accountStatus: 1, lastActive: -1 });
// userSchema.index({ role: 1, createdAt: -1 }); // For admin queries
// userSchema.index({ 'statusChangeHistory.timestamp': -1 }); // For audit logs

// // ========== VIRTUAL PROPERTIES ==========
// userSchema.virtual("fullName").get(function () {
//   return `${this.firstName} ${this.lastName}`.trim();
// });

// userSchema.virtual("age").get(function () {
//   if (!this.dateOfBirth) return null;
//   return this.calculateAge(this.dateOfBirth);
// });

// userSchema.virtual("isActuallyOnline").get(function () {
//   if (!this.presence || !this.presence.lastSeen) return false;
  
//   const lastSeenTime = new Date(this.presence.lastSeen).getTime();
//   const currentTime = Date.now();
//   const fiveMinutesAgo = currentTime - (5 * 60 * 1000);
  
//   return lastSeenTime > fiveMinutesAgo && this.presence.status === 'online';
// });

// userSchema.virtual("isActive").get(function () {
//   return this.accountStatus === "active";
// });

// userSchema.virtual("isAdminUser").get(function () {
//   return this.role === ROLES.ADMIN || this.role === ROLES.SUPER_ADMIN;
// });

// userSchema.virtual("isSuperAdminUser").get(function () {
//   return this.role === ROLES.SUPER_ADMIN;
// });

// // ========== INSTANCE METHODS ==========

// // Role-based methods
// userSchema.methods.hasRole = function(role) {
//   return this.role === role;
// };

// userSchema.methods.hasAnyRole = function(roles) {
//   return roles.includes(this.role);
// };

// userSchema.methods.hasMinimumRole = function(requiredRole) {
//   const userLevel = ROLE_HIERARCHY[this.role];
//   const requiredLevel = ROLE_HIERARCHY[requiredRole];
//   return userLevel >= requiredLevel;
// };

// userSchema.methods.isAdmin = function() {
//   return this.role === ROLES.ADMIN || this.role === ROLES.SUPER_ADMIN;
// };

// userSchema.methods.isSuperAdmin = function() {
//   return this.role === ROLES.SUPER_ADMIN;
// };

// userSchema.methods.getPermissions = function() {
//   return ROLE_PERMISSIONS[this.role] || [];
// };

// userSchema.methods.hasPermission = function(permission) {
//   const permissions = this.getPermissions();
//   return permissions.includes(permission);
// };

// userSchema.methods.canManageUser = function(targetUser) {
//   // Users can only manage themselves
//   if (this.role === ROLES.USER) {
//     return this._id.equals(targetUser._id);
//   }
  
//   const userLevel = ROLE_HIERARCHY[this.role];
//   const targetLevel = ROLE_HIERARCHY[targetUser.role];
  
//   // Cannot manage users with same or higher level
//   return userLevel > targetLevel;
// };

// userSchema.methods.canViewUser = function(targetUser) {
//   // Everyone can view themselves
//   if (this._id.equals(targetUser._id)) {
//     return true;
//   }
  
//   // Admins can view all users
//   if (this.isAdmin()) {
//     // Regular admin cannot view other admins unless super admin
//     if (targetUser.isAdmin() && !this.isSuperAdmin()) {
//       return false;
//     }
//     return true;
//   }
  
//   // Moderators can view non-admin users
//   if (this.role === ROLES.MODERATOR && !targetUser.isAdmin()) {
//     return true;
//   }
  
//   // Users can only view themselves
//   return false;
// };

// // Age calculation method
// userSchema.methods.calculateAge = function (birthDate) {
//   const today = new Date();
//   let age = today.getFullYear() - birthDate.getFullYear();
//   const monthDiff = today.getMonth() - birthDate.getMonth();
  
//   if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
//     age--;
//   }
  
//   return age;
// };

// // Password comparison method
// userSchema.methods.comparePassword = async function (candidatePassword) {
//   return await bcrypt.compare(candidatePassword, this.password);
// };

// // Profile methods
// userSchema.methods.getPublicProfile = function (viewerId = null) {
//   const profile = {
//     id: this._id.toString(),
//     userName: this.userName,
//     firstName: this.firstName,
//     lastName: this.lastName,
//     avatar: this.avatar,
//     age: this.age,
//     interests: this.preferences?.interests || [],
//     location: this.location ? {
//       city: this.location.city,
//       country: this.location.country
//     } : null,
//     isOnline: this.privacySettings?.showOnlineStatus ? this.isActuallyOnline : undefined,
//     lastSeen: null,
//     role: this.role // Include role in public profile for moderation purposes
//   };
  
//   // Apply privacy settings
//   if (this.privacySettings) {
//     if (!this.privacySettings.showOnlineStatus) {
//       delete profile.isOnline;
//     }
    
//     if (this.privacySettings.showLastSeen === 'everyone' || 
//         (this.privacySettings.showLastSeen === 'matches' && viewerId)) {
//       profile.lastSeen = this.presence?.lastSeen;
//     }
    
//     if (!this.privacySettings.showAge) {
//       delete profile.age;
//     }
//   }
  
//   return profile;
// };

// // Admin-specific profile view
// userSchema.methods.getAdminProfile = function(requestingAdmin) {
//   if (!requestingAdmin.isAdmin()) {
//     throw new Error('Insufficient permissions');
//   }
  
//   // Regular admin cannot view other admin profiles
//   if (this.isAdmin() && !requestingAdmin.isSuperAdmin() && !this._id.equals(requestingAdmin._id)) {
//     throw new Error('Cannot view other admin profiles');
//   }
  
//   const profile = this.toObject();
  
//   // Add admin view flag for toJSON transformation
//   profile._isAdminView = true;
  
//   // Calculate additional admin metrics
//   profile.accountAge = Math.floor((new Date() - new Date(profile.createdAt)) / (1000 * 60 * 60 * 24));
//   profile.isCurrentlyOnline = this.isActuallyOnline;
  
//   return profile;
// };

// // Online status methods
// userSchema.methods.isOnline = async function() {
//   try {
//     // First check Redis for real-time status
//     if (global.redisClient) {
//       const redisKey = `user:presence:${this._id}`;
//       const redisStatus = await global.redisClient.get(redisKey);
      
//       if (redisStatus) {
//         const presenceData = JSON.parse(redisStatus);
//         const isOnline = presenceData.status === 'online' && 
//                         Date.now() - new Date(presenceData.lastSeen).getTime() < (5 * 60 * 1000);
//         return isOnline;
//       }
//     }
    
//     // Fallback to database check
//     if (!this.presence || !this.presence.lastSeen) return false;
    
//     const lastSeenTime = new Date(this.presence.lastSeen).getTime();
//     const currentTime = Date.now();
//     const fiveMinutesAgo = currentTime - (5 * 60 * 1000);
    
//     return lastSeenTime > fiveMinutesAgo && this.presence.status === 'online';
    
//   } catch (error) {
//     console.error('isOnline check error:', error);
//     return false;
//   }
// };

// userSchema.methods.updatePresence = async function(status = 'online', options = {}) {
//   const session = options.session;
//   const socketId = options.socketId;
//   const customStatus = options.customStatus;
  
//   const oldStatus = this.presence?.status || 'offline';
  
//   // Update presence object
//   this.presence = {
//     status,
//     lastSeen: new Date(),
//     lastActive: new Date(),
//     customStatus: customStatus || this.presence?.customStatus || '',
//     socketId: socketId || this.presence?.socketId
//   };
  
//   // Update timestamps
//   if (status === 'online') {
//     this.lastLogin = new Date();
//   }
  
//   const saveOptions = { validateBeforeSave: false };
//   if (session) saveOptions.session = session;
  
//   await this.save(saveOptions);
  
//   // Update Redis cache
//   await this.updatePresenceCache(status, socketId);
  
//   // Emit WebSocket event
//   await this.emitPresenceUpdate(oldStatus, status);
  
//   return this;
// };

// // FIXED: Redis methods for ioredis
// userSchema.methods.updatePresenceCache = async function(status, socketId = null) {
//   try {
//     if (!global.redisClient) return;
    
//     const redisKey = `user:presence:${this._id}`;
//     const presenceData = {
//       userId: this._id.toString(),
//       status,
//       lastSeen: new Date().toISOString(),
//       socketId: socketId || this.presence?.socketId,
//       customStatus: this.presence?.customStatus || '',
//       name: `${this.firstName} ${this.lastName}`,
//       avatar: this.avatar,
//       role: this.role // Include role in presence data
//     };
    
//     // ioredis uses setex (lowercase, seconds, value)
//     await global.redisClient.setex(redisKey, 600, JSON.stringify(presenceData));
    
//     // Update online users sorted set
//     if (status === 'online') {
//       // ioredis zadd syntax: zadd(key, score, member)
//       await global.redisClient.zadd('online:users', Date.now(), this._id.toString());
//     } else {
//       // ioredis zrem syntax: zrem(key, member)
//       await global.redisClient.zrem('online:users', this._id.toString());
//     }
    
//   } catch (error) {
//     console.error('Redis presence update error:', error);
//   }
// };

// userSchema.methods.emitPresenceUpdate = async function(oldStatus, newStatus) {
//   try {
//     const io = global.io;
//     if (!io) return;
    
//     const presenceEvent = {
//       userId: this._id.toString(),
//       oldStatus,
//       newStatus,
//       timestamp: new Date().toISOString(),
//       user: {
//         id: this._id.toString(),
//         name: `${this.firstName} ${this.lastName}`,
//         avatar: this.avatar,
//         userName: this.userName,
//         role: this.role
//       }
//     };
    
//     // Broadcast to everyone
//     io.emit('presence:update', presenceEvent);
    
//     // Emit to user's personal room
//     io.to(`user:${this._id}`).emit('presence:personal', presenceEvent);
    
//     // Emit to user's chat rooms
//     io.to(`chat:${this._id}`).emit('presence:chat', presenceEvent);
    
//   } catch (error) {
//     console.error('WebSocket emit error:', error);
//   }
// };

// userSchema.methods.getPublicPresence = function(viewerId = null) {
//   const canShowOnline = this.privacySettings?.showOnlineStatus !== false;
//   const canShowLastSeen = this.privacySettings?.showLastSeen !== false;
  
//   const presence = {
//     userId: this._id.toString(),
//     status: this.presence?.status || 'offline',
//     isOnline: undefined,
//     lastSeen: null,
//     customStatus: this.presence?.customStatus || '',
//     user: {
//       id: this._id.toString(),
//       name: `${this.firstName} ${this.lastName}`,
//       userName: this.userName,
//       avatar: this.avatar,
//       role: this.role // Include role in presence
//     }
//   };
  
//   // Apply privacy settings
//   if (canShowOnline) {
//     // We'll calculate isOnline when needed
//     presence.isOnline = undefined; // Will be populated by service
//   }
  
//   if (canShowLastSeen) {
//     if (this.privacySettings?.showLastSeen === 'everyone' || 
//         (this.privacySettings?.showLastSeen === 'matches' && viewerId)) {
//       presence.lastSeen = this.presence?.lastSeen;
//     }
//   }
  
//   return presence;
// };

// // Update last seen method
// userSchema.methods.updateLastSeen = async function() {
//   try {
//     if (!this.presence) {
//       this.presence = {};
//     }
    
//     this.presence.lastSeen = new Date();
//     this.presence.lastActive = new Date();
    
//     return await this.save({ validateBeforeSave: false });
//   } catch (error) {
//     console.error('Update last seen error:', error);
//     throw error;
//   }
// };

// // Admin action logging
// userSchema.methods.logAdminAction = async function(action, performedBy, reason = null) {
//   this.lastAdminAction = {
//     action,
//     performedBy: performedBy._id,
//     performedAt: new Date(),
//     reason
//   };
  
//   return await this.save({ validateBeforeSave: false });
// };

// // Status change with history tracking
// userSchema.methods.changeStatus = async function(newStatus, changedBy, reason = null) {
//   const oldStatus = this.accountStatus;
  
//   this.accountStatus = newStatus;
  
//   // Add to history
//   this.statusChangeHistory = this.statusChangeHistory || [];
//   this.statusChangeHistory.push({
//     from: oldStatus,
//     to: newStatus,
//     changedBy: changedBy._id,
//     reason,
//     timestamp: new Date()
//   });
  
//   // Log admin action
//   await this.logAdminAction(`status_change:${oldStatus}_to_${newStatus}`, changedBy, reason);
  
//   return await this.save({ validateBeforeSave: false });
// };

// // ========== STATIC METHODS ==========

// // Role-based static methods
// userSchema.statics.getRoleHierarchy = function() {
//   return ROLE_HIERARCHY;
// };

// userSchema.statics.getRolePermissions = function(role) {
//   return ROLE_PERMISSIONS[role] || [];
// };

// userSchema.statics.getManageableRoles = function(userRole) {
//   const userLevel = ROLE_HIERARCHY[userRole];
//   return Object.entries(ROLE_HIERARCHY)
//     .filter(([role, level]) => level < userLevel)
//     .map(([role]) => role);
// };

// userSchema.statics.canModifyRole = function(managerRole, targetRole) {
//   const managerLevel = ROLE_HIERARCHY[managerRole];
//   const targetLevel = ROLE_HIERARCHY[targetRole];
  
//   // Can only assign roles lower than your own
//   return managerLevel > targetLevel;
// };

// // Find active users with filtering
// userSchema.statics.findActiveUsers = function (options = {}) {
//   const query = {
//     accountStatus: "active",
//     'privacySettings.profileVisibility': { $ne: 'private' }
//   };
  
//   if (options.ageRange) {
//     query.age = { $gte: options.ageRange.min, $lte: options.ageRange.max };
//   }
  
//   if (options.lookingFor) {
//     query['preferences.lookingFor'] = { $in: Array.isArray(options.lookingFor) ? options.lookingFor : [options.lookingFor] };
//   }
  
//   return this.find(query)
//     .select('firstName lastName avatar userName age preferences.lookingFor location.city lastActive role')
//     .limit(options.limit || 50)
//     .skip(options.skip || 0);
// };

// // Find users by role (for admin purposes)
// userSchema.statics.findByRole = function(role, options = {}) {
//   const query = { role };
  
//   if (options.accountStatus) {
//     query.accountStatus = options.accountStatus;
//   }
  
//   return this.find(query)
//     .select(options.select || 'firstName lastName email userName role accountStatus createdAt lastActive')
//     .sort(options.sort || { createdAt: -1 })
//     .limit(options.limit || 100)
//     .skip(options.skip || 0);
// };

// // Get online admins/moderators
// userSchema.statics.getOnlineStaff = async function() {
//   try {
//     if (global.redisClient) {
//       const onlineUserIds = await global.redisClient.zrange('online:users', 0, -1);
      
//       if (onlineUserIds.length === 0) return [];
      
//       const users = await this.find({
//         _id: { $in: onlineUserIds },
//         role: { $in: [ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN] }
//       }).select('_id firstName lastName role avatar presence.status');
      
//       return users;
//     }
    
//     // Fallback to database query
//     const fiveMinutesAgo = new Date(Date.now() - (5 * 60 * 1000));
    
//     return await this.find({
//       role: { $in: [ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN] },
//       'presence.lastSeen': { $gte: fiveMinutesAgo },
//       'presence.status': 'online',
//       accountStatus: 'active'
//     }).select('_id firstName lastName role avatar presence.status');
    
//   } catch (error) {
//     console.error('Error getting online staff:', error);
//     return [];
//   }
// };

// // Static method for auth middleware
// userSchema.statics.updateLastSeen = async function(userId) {
//   try {
//     return await this.findByIdAndUpdate(
//       userId,
//       {
//         $set: {
//           'presence.lastSeen': new Date(),
//           'presence.lastActive': new Date()
//         }
//       },
//       { new: true }
//     );
//   } catch (error) {
//     console.error('Update last seen error:', error);
//     throw error;
//   }
// };

// // FIXED: Redis methods for ioredis
// userSchema.statics.getBulkPresence = async function(userIds, viewerId = null) {
//   try {
//     // Try Redis first
//     if (global.redisClient) {
//       const redisKeys = userIds.map(id => `user:presence:${id}`);
//       // ioredis uses mget (lowercase)
//       const redisResults = await global.redisClient.mget(redisKeys);
      
//       const result = {};
//       const missingFromRedis = [];
      
//       userIds.forEach((userId, index) => {
//         const redisData = redisResults[index];
        
//         if (redisData) {
//           const presence = JSON.parse(redisData);
//           result[userId] = {
//             userId: presence.userId,
//             status: presence.status,
//             isOnline: presence.status === 'online' && 
//                      Date.now() - new Date(presence.lastSeen).getTime() < (5 * 60 * 1000),
//             lastSeen: presence.lastSeen,
//             role: presence.role,
//             user: {
//               name: presence.name,
//               avatar: presence.avatar
//             }
//           };
//         } else {
//           missingFromRedis.push(userId);
//         }
//       });
      
//       // If all found in Redis, return
//       if (missingFromRedis.length === 0) {
//         return result;
//       }
      
//       // Fetch missing from database
//       const users = await this.find({
//         _id: { $in: missingFromRedis }
//       }).select('_id firstName lastName avatar userName role privacySettings presence');
      
//       users.forEach(user => {
//         const userId = user._id.toString();
//         const canShowOnline = user.privacySettings?.showOnlineStatus !== false;
//         const canShowLastSeen = user.privacySettings?.showLastSeen !== false;
        
//         result[userId] = {
//           userId,
//           status: user.presence?.status || 'offline',
//           isOnline: canShowOnline ? undefined : false, // Will calculate on demand
//           lastSeen: canShowLastSeen ? user.presence?.lastSeen : null,
//           role: user.role,
//           user: {
//             name: `${user.firstName} ${user.lastName}`,
//             userName: user.userName,
//             avatar: user.avatar
//           }
//         };
//       });
      
//       return result;
//     }
    
//     // Fallback to database only
//     const users = await this.find({
//       _id: { $in: userIds }
//     }).select('_id firstName lastName avatar userName role privacySettings presence');
    
//     const result = {};
    
//     users.forEach(user => {
//       const userId = user._id.toString();
//       const canShowOnline = user.privacySettings?.showOnlineStatus !== false;
//       const canShowLastSeen = user.privacySettings?.showLastSeen !== false;
      
//       result[userId] = {
//         userId,
//         status: user.presence?.status || 'offline',
//         isOnline: canShowOnline ? undefined : false,
//         lastSeen: canShowLastSeen ? user.presence?.lastSeen : null,
//         role: user.role,
//         user: {
//           name: `${user.firstName} ${user.lastName}`,
//           userName: user.userName,
//           avatar: user.avatar
//         }
//       };
//     });
    
//     return result;
    
//   } catch (error) {
//     console.error('getBulkPresence error:', error);
//     throw error;
//   }
// };

// // Export constants with the model
// const User = mongoose.model("User", userSchema);
// User.ROLES = ROLES;
// User.ROLE_HIERARCHY = ROLE_HIERARCHY;
// User.ROLE_PERMISSIONS = ROLE_PERMISSIONS;

// module.exports = User;