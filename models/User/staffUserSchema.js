// models/User/staffUserSchema.js - COMPLETE WORKING VERSION
const mongoose = require("mongoose");

const staffUserSchema = new mongoose.Schema({
  // ========== STAFF EMPLOYMENT INFO ==========
  employeeId: {
    type: String,
    required: [true, "Employee ID is required for staff"],
    unique: true,
    trim: true,
    uppercase: true
  },
  
  department: {
    type: String,
    required: [true, "Department is required for staff"],
    enum: ["support", "moderation", "safety", "technical", "management", "hr", "finance", "marketing", "development"]
  },
  
  jobTitle: {
    type: String,
    trim: true,
    default: ""
  },
  
  hireDate: {
    type: Date,
    default: Date.now
  },
  
  reportsTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BaseUser'
  },
  
  // ========== STAFF PERMISSIONS ==========
  permissions: [{
    resource: {
      type: String,
      required: true,
      enum: ['users', 'content', 'reports', 'analytics', 'settings', 'system', 'billing', 'support']
    },
    actions: [{
      type: String,
      enum: ['create', 'read', 'update', 'delete', 'approve', 'reject', 'export', 'import']
    }],
    conditions: mongoose.Schema.Types.Mixed,
    grantedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BaseUser'
    },
    grantedAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: Date
  }],
  
  // ========== STAFF WORK MANAGEMENT ==========
  managedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BaseUser'
  }],
  
  managedTeams: [{
    name: String,
    members: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BaseUser'
    }],
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  assignedCases: [{
    caseId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'assignedCases.caseModel'
    },
    caseModel: {
      type: String,
      enum: ['Report', 'SupportTicket', 'ContentFlag', 'UserAppeal']
    },
    assignedAt: Date,
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'resolved', 'escalated']
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical']
    }
  }],
  
  // ========== FIXED STAFF SETTINGS ==========
  staffNotificationSettings: {
    userReports: { 
      type: mongoose.Schema.Types.Mixed,  // Changed from String to Mixed
      validate: {
        validator: function(value) {
          // Accept boolean OR string enum values
          if (value === true || value === false) return true;
          if (typeof value === 'string') {
            const validValues = ['all', 'high_priority', 'assigned', 'none'];
            return validValues.includes(value.toLowerCase());
          }
          return false;
        },
        message: 'userReports must be true, false, or one of: all, high_priority, assigned, none'
      },
      default: 'assigned',
      set: function(value) {
        // Automatically convert boolean to string when setting
        if (value === true) return 'all';
        if (value === false) return 'none';
        return value;
      }
    },
    systemAlerts: { type: Boolean, default: true },
    adminAnnouncements: { type: Boolean, default: true },
    shiftReminders: { type: Boolean, default: true },
    caseUpdates: { type: Boolean, default: true },
    teamMessages: { type: Boolean, default: true }
  },
  
  workHours: {
    startTime: { type: String, default: '09:00' },
    endTime: { type: String, default: '17:00' },
    timezone: { type: String, default: 'UTC' },
    workDays: {
      type: [String],
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
    }
  },
  
  // ========== STAFF WORK STATS ==========
  workStats: {
    casesResolved: { type: Number, default: 0 },
    casesEscalated: { type: Number, default: 0 },
    averageResolutionTime: { type: Number, default: 0 },
    responseTime: { type: Number, default: 0 },
    lastActiveShift: Date,
    totalShiftHours: { type: Number, default: 0 },
    performanceScore: { type: Number, min: 0, max: 100, default: 0 }
  },
  
  // ========== STAFF SECURITY ==========
  lastSecurityTraining: Date,
  requiresSecurityRetraining: {
    type: Boolean,
    default: false
  },
  
  accessLevel: {
    type: String,
    enum: ['basic', 'elevated', 'admin', 'system'],
    default: 'basic'
  },
  
  // ========== STAFF ACTIVITY LOG ==========
  recentActivity: [{
    action: String,
    details: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }]
});

// ========== STAFF SPECIFIC VIRTUAL PROPERTIES ==========
staffUserSchema.virtual("isOnShift").get(function() {
  if (!this.workStats?.lastActiveShift) return false;
  
  const lastShift = new Date(this.workStats.lastActiveShift);
  const now = new Date();
  const hoursSinceLastShift = (now - lastShift) / (1000 * 60 * 60);
  
  return hoursSinceLastShift < 4;
});

staffUserSchema.virtual("totalManagedUsers").get(function() {
  return this.managedUsers?.length || 0;
});

staffUserSchema.virtual("activeCases").get(function() {
  if (!this.assignedCases) return 0;
  return this.assignedCases.filter(caseItem => 
    caseItem.status === 'pending' || caseItem.status === 'in_progress'
  ).length;
});

staffUserSchema.virtual("isSeniorStaff").get(function() {
  return ['admin', 'super_admin'].includes(this.role) || 
         this.department === 'management' || 
         this.accessLevel === 'admin';
});

// ========== STAFF SPECIFIC METHODS ==========
staffUserSchema.methods.getStaffProfile = function (requestingUser = null) {
  const isSelf = requestingUser && requestingUser._id.equals(this._id);
  const isSenior = requestingUser && (
    requestingUser.role === 'super_admin' || 
    (requestingUser.role === 'admin' && this.role !== 'super_admin') ||
    requestingUser.reportsTo?.equals(this._id)
  );
  
  const profile = {
    id: this._id,
    employeeId: this.employeeId,
    department: this.department,
    jobTitle: this.jobTitle,
    role: this.role,
    workStats: {
      casesResolved: this.workStats?.casesResolved || 0,
      performanceScore: this.workStats?.performanceScore || 0,
      activeCases: this.activeCases
    }
  };
  
  if (isSelf || isSenior) {
    profile.hireDate = this.hireDate;
    profile.reportsTo = this.reportsTo;
    profile.accessLevel = this.accessLevel;
    profile.totalManagedUsers = this.totalManagedUsers;
    profile.isOnShift = this.isOnShift;
    
    if (isSelf) {
      profile.staffNotificationSettings = this.staffNotificationSettings;
      profile.workHours = this.workHours;
      profile.assignedCases = this.assignedCases?.map(caseItem => ({
        caseId: caseItem.caseId,
        caseModel: caseItem.caseModel,
        status: caseItem.status,
        priority: caseItem.priority,
        assignedAt: caseItem.assignedAt
      })) || [];
    }
  }
  
  return profile;
};

staffUserSchema.methods.logStaffAction = async function(action, details = {}, options = {}) {
  const session = options.session;
  
  this.lastAdminAction = {
    action,
    performedBy: this._id,
    performedAt: new Date(),
    targetUser: details.targetUser,
    notes: details.notes
  };
  
  this.recentActivity = this.recentActivity || [];
  this.recentActivity.push({
    action,
    details,
    ipAddress: options.ipAddress || 'unknown',
    userAgent: options.userAgent || 'unknown',
    timestamp: new Date()
  });
  
  if (this.recentActivity.length > 100) {
    this.recentActivity = this.recentActivity.slice(-100);
  }
  
  const saveOptions = { validateBeforeSave: false };
  if (session) saveOptions.session = session;
  
  return await this.save(saveOptions);
};

staffUserSchema.methods.canManageStaff = function(targetStaff) {
  if (this.role === 'super_admin') return true;
  
  if (this.role === 'admin') {
    return !['admin', 'super_admin'].includes(targetStaff.role);
  }
  
  if (this.role === 'moderator') {
    return false;
  }
  
  if (this.department === 'management' && this.department === targetStaff.department) {
    return targetStaff.role === 'moderator' || targetStaff.role === 'user';
  }
  
  return false;
};

staffUserSchema.methods.assignCase = async function(caseId, caseModel, priority = 'medium') {
  this.assignedCases = this.assignedCases || [];
  
  const existingCase = this.assignedCases.find(c => 
    c.caseId.equals(caseId) && c.caseModel === caseModel
  );
  
  if (!existingCase) {
    this.assignedCases.push({
      caseId,
      caseModel,
      assignedAt: new Date(),
      status: 'pending',
      priority
    });
    
    await this.logStaffAction('case_assigned', {
      caseId,
      caseModel,
      priority
    });
    
    return await this.save({ validateBeforeSave: false });
  }
  
  return this;
};

staffUserSchema.methods.updateCaseStatus = async function(caseId, caseModel, newStatus, notes = null) {
  if (!this.assignedCases) return this;
  
  const caseIndex = this.assignedCases.findIndex(c => 
    c.caseId.equals(caseId) && c.caseModel === caseModel
  );
  
  if (caseIndex !== -1) {
    const oldStatus = this.assignedCases[caseIndex].status;
    this.assignedCases[caseIndex].status = newStatus;
    
    if (newStatus === 'resolved' && oldStatus !== 'resolved') {
      this.workStats.casesResolved = (this.workStats.casesResolved || 0) + 1;
      
      const assignedAt = this.assignedCases[caseIndex].assignedAt;
      const resolvedAt = new Date();
      const resolutionTime = (resolvedAt - assignedAt) / (1000 * 60);
      
      const currentAvg = this.workStats.averageResolutionTime || 0;
      const totalCases = this.workStats.casesResolved;
      this.workStats.averageResolutionTime = 
        ((currentAvg * (totalCases - 1)) + resolutionTime) / totalCases;
    }
    
    await this.logStaffAction('case_status_updated', {
      caseId,
      caseModel,
      oldStatus,
      newStatus,
      notes
    });
    
    return await this.save({ validateBeforeSave: false });
  }
  
  return this;
};

staffUserSchema.methods.recordShiftActivity = async function() {
  this.workStats.lastActiveShift = new Date();
  this.workStats.totalShiftHours = (this.workStats.totalShiftHours || 0) + 1;
  
  return await this.save({ validateBeforeSave: false });
};

staffUserSchema.methods.hasPermission = function(resource, action) {
  if (this.role === 'super_admin') return true;
  
  if (this.permissions) {
    const resourcePermissions = this.permissions.filter(p => p.resource === resource);
    
    for (const perm of resourcePermissions) {
      if (perm.expiresAt && new Date(perm.expiresAt) < new Date()) {
        continue;
      }
      
      if (perm.actions.includes(action) || perm.actions.includes('all')) {
        return true;
      }
    }
  }
  
  return this.baseHasPermission?.(`${resource}:${action}`) || false;
};

staffUserSchema.methods.grantPermission = async function(resource, actions, grantedBy, expiresAt = null, conditions = null) {
  this.permissions = this.permissions || [];
  
  this.permissions = this.permissions.filter(p => 
    !(p.resource === resource && p.grantedBy?.equals(grantedBy._id))
  );
  
  this.permissions.push({
    resource,
    actions: Array.isArray(actions) ? actions : [actions],
    conditions,
    grantedBy: grantedBy._id,
    grantedAt: new Date(),
    expiresAt
  });
  
  await this.logStaffAction('permission_granted', {
    resource,
    actions,
    grantedBy: grantedBy._id,
    expiresAt,
    conditions
  });
  
  return await this.save({ validateBeforeSave: false });
};

staffUserSchema.methods.revokePermission = async function(resource, grantedBy) {
  const initialLength = this.permissions?.length || 0;
  
  this.permissions = (this.permissions || []).filter(p => 
    !(p.resource === resource && p.grantedBy?.equals(grantedBy._id))
  );
  
  if (this.permissions.length < initialLength) {
    await this.logStaffAction('permission_revoked', {
      resource,
      grantedBy: grantedBy._id
    });
    
    return await this.save({ validateBeforeSave: false });
  }
  
  return this;
};

// ========== STAFF SPECIFIC STATIC METHODS ==========
staffUserSchema.statics.findByDepartment = function(department, options = {}) {
  const query = { 
    department,
    accountStatus: options.accountStatus || 'active'
  };
  
  if (options.role) {
    query.role = options.role;
  }
  
  return this.find(query)
    .select('firstName lastName email role employeeId department workStats.lastActiveShift workStats.performanceScore')
    .sort(options.sort || { 'workStats.performanceScore': -1 })
    .limit(options.limit || 50)
    .skip(options.skip || 0);
};

staffUserSchema.statics.findAvailableStaff = function(department = null, minPerformanceScore = 60) {
  const query = {
    accountStatus: 'active',
    'workStats.performanceScore': { $gte: minPerformanceScore }
  };
  
  if (department) {
    query.department = department;
  }
  
  return this.aggregate([
    { $match: query },
    {
      $addFields: {
        activeCasesCount: {
          $size: {
            $filter: {
              input: "$assignedCases",
              as: "case",
              cond: { $in: ["$$case.status", ["pending", "in_progress"]] }
            }
          }
        }
      }
    },
    { $sort: { activeCasesCount: 1, 'workStats.performanceScore': -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 1,
        firstName: 1,
        lastName: 1,
        employeeId: 1,
        department: 1,
        role: 1,
        activeCasesCount: 1,
        performanceScore: "$workStats.performanceScore"
      }
    }
  ]);
};

staffUserSchema.statics.getDepartmentStats = function() {
  return this.aggregate([
    { 
      $match: { 
        accountStatus: 'active',
        role: { $in: ['moderator', 'admin', 'super_admin'] }
      } 
    },
    {
      $group: {
        _id: "$department",
        totalStaff: { $sum: 1 },
        totalCasesResolved: { $sum: "$workStats.casesResolved" },
        avgPerformanceScore: { $avg: "$workStats.performanceScore" },
        activeStaff: {
          $sum: {
            $cond: [
              {
                $and: [
                  "$workStats.lastActiveShift",
                  { 
                    $gte: [
                      { $subtract: [new Date(), "$workStats.lastActiveShift"] },
                      4 * 60 * 60 * 1000
                    ]
                  }
                ]
              },
              1,
              0
            ]
          }
        }
      }
    },
    { $sort: { totalStaff: -1 } }
  ]);
};

module.exports = staffUserSchema;