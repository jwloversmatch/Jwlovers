const BaseController = require('../BaseController');
const UserProfileService = require('./UserProfileService');
const UserSettingsService = require('./UserSettingsService');
const UserAdminService = require('./UserAdminService');
const UserRateLimitService = require('./UserRateLimitService');
const logger = require('@utils/logger');

class UserController extends BaseController {
  constructor() {
    super();
    
    // Initialize services
    this.rateLimitService = new UserRateLimitService();
    this.profileService = new UserProfileService(this.rateLimitService);
    this.settingsService = new UserSettingsService();
    this.adminService = new UserAdminService();
    
    // Auto-bind methods
    this.getMe = this.getMe.bind(this);
    this.getUserById = this.getUserById.bind(this);
    this.updatePrivateInfo = this.updatePrivateInfo.bind(this);
    this.updateProfile = this.updateProfile.bind(this);
    this.updateEmail = this.updateEmail.bind(this);
    this.deleteAccount = this.deleteAccount.bind(this);
    this.getSettings = this.getSettings.bind(this);
    this.updateSettings = this.updateSettings.bind(this);
    this.getUsers = this.getUsers.bind(this);
    this.changeUserRole = this.changeUserRole.bind(this);
    
    // Newly added methods
    this.exportData = this.exportData.bind(this);
    this.updatePresence = this.updatePresence.bind(this);
    this.adminResetPassword = this.adminResetPassword.bind(this);
    this.adminUnlockAccount = this.adminUnlockAccount.bind(this);
  }

  // ========== PUBLIC PROFILE METHODS ==========

  async getMe(req, res) {
    try {
      return await this.profileService.getMe(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async getUserById(req, res) {
    try {
      return await this.profileService.getUserById(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== PRIVATE INFO METHODS ==========

  async updatePrivateInfo(req, res) {
    try {
      return await this.profileService.updatePrivateInfo(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async updateEmail(req, res) {
    try {
      return await this.profileService.updateEmail(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== PROFILE METHODS ==========

  async updateProfile(req, res) {
    try {
      // Route to ProfileController for profile updates
      const ProfileController = require('@controllers/profile/profile.controller');
      const profileController = new ProfileController();
      return await profileController.updateProfile(req, res);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== SETTINGS METHODS ==========

  async getSettings(req, res) {
    try {
      return await this.settingsService.getSettings(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async updateSettings(req, res) {
    try {
      return await this.settingsService.updateSettings(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== ACCOUNT MANAGEMENT ==========

  async deleteAccount(req, res) {
    try {
      return await this.profileService.deleteAccount(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== DATA EXPORT ==========

  async exportData(req, res) {
    try {
      const userId = req.user.id;
      
      // Get comprehensive user data
      const { BaseUser } = require('@models/User');
      const Profile = require('@models/Profile/Profile.model');
      
      const [user, profile] = await Promise.all([
        BaseUser.findById(userId)
          .select('-password -refreshToken -passwordResetToken -emailVerificationToken -passwordHistory -securityQuestion')
          .lean(),
        Profile.findOne({ userId })
          .select('-userId')
          .lean()
      ]);
      
      const exportData = {
        user: {
          ...user,
          // Additional sensitive data removal
          _id: undefined,
          __v: undefined,
          updatedAt: undefined
        },
        profile: profile ? {
          ...profile,
          _id: undefined,
          __v: undefined,
          updatedAt: undefined
        } : null,
        metadata: {
          exportedAt: new Date().toISOString(),
          format: 'json',
          dataTypes: ['user', 'profile'],
          version: '1.0',
          requestId: req.requestId
        }
      };
      
      // Set headers for file download
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=user-data-export.json');
      
      return this.successResponse(res, 200, exportData, 'Data export successful');
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== PRESENCE MANAGEMENT ==========

  async updatePresence(req, res) {
    try {
      const userId = req.user.id;
      const { status, device, location } = req.body;
      
      const { BaseUser } = require('@models/User');
      
      const update = {
        'presence.status': status || 'online',
        'presence.lastSeen': new Date(),
        'presence.updatedAt': new Date()
      };
      
      if (device) {
        update['presence.device'] = device;
      }
      
      if (location) {
        update['presence.location'] = location;
      }
      
      await BaseUser.findByIdAndUpdate(userId, {
        $set: update
      });
      
      // Emit presence update via WebSocket if available
      try {
        const io = req.app.get('io');
        if (io) {
          io.to(`user:${userId}`).emit('presence:update', {
            userId,
            status: update['presence.status'],
            lastSeen: update['presence.lastSeen']
          });
        }
      } catch (wsError) {
        logger.debug('WebSocket not available for presence update');
      }
      
      return this.successResponse(res, 200, {
        userId,
        status: update['presence.status'],
        lastSeen: update['presence.lastSeen'],
        device: update['presence.device'] || null,
        location: update['presence.location'] || null
      }, 'Presence updated');
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== ADMIN METHODS ==========

  async changeUserRole(req, res) {
    try {
      return await this.adminService.changeUserRole(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async getUsers(req, res) {
    try {
      return await this.adminService.getUsers(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async adminResetPassword(req, res) {
    try {
      // Only admin/super_admin can access this
      if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
        return this.errorResponse(res, 403, 'Insufficient permissions');
      }
      
      const { targetUserId, newPassword } = req.body;
      
      if (!targetUserId || !newPassword) {
        return this.errorResponse(res, 400, 'targetUserId and newPassword are required');
      }
      
      // Validate password strength
      if (newPassword.length < 8) {
        return this.errorResponse(res, 400, 'Password must be at least 8 characters long');
      }
      
      const { BaseUser } = require('@models/User');
      
      // Find target user
      const targetUser = await BaseUser.findById(targetUserId);
      if (!targetUser) {
        return this.errorResponse(res, 404, 'User not found');
      }
      
      // Check permission hierarchy
      const roleHierarchy = {
        'user': 0,
        'moderator': 1,
        'admin': 2,
        'super_admin': 3
      };
      
      const adminLevel = roleHierarchy[req.user.role] || 0;
      const targetLevel = roleHierarchy[targetUser.role] || 0;
      
      if (targetLevel >= adminLevel) {
        return this.errorResponse(res, 403, 'Cannot reset password for user with equal or higher role');
      }
      
      // Reset password
      targetUser.password = newPassword;
      targetUser.passwordChangedAt = new Date();
      targetUser.loginAttempts = 0;
      targetUser.lockUntil = null;
      
      await targetUser.save();
      
      // Log admin action
      logger.info('Admin password reset', {
        adminId: req.user.id,
        adminEmail: req.user.email,
        targetUserId,
        targetEmail: targetUser.email,
        timestamp: new Date().toISOString()
      });
      
      return this.successResponse(res, 200, {
        userId: targetUserId,
        email: targetUser.email,
        message: 'Password reset successfully'
      }, 'Password reset successful');
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async adminUnlockAccount(req, res) {
    try {
      // Only admin/super_admin can access this
      if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
        return this.errorResponse(res, 403, 'Insufficient permissions');
      }
      
      const { targetUserId } = req.body;
      
      if (!targetUserId) {
        return this.errorResponse(res, 400, 'targetUserId is required');
      }
      
      const { BaseUser } = require('@models/User');
      
      // Check permission hierarchy
      const targetUser = await BaseUser.findById(targetUserId);
      if (!targetUser) {
        return this.errorResponse(res, 404, 'User not found');
      }
      
      const roleHierarchy = {
        'user': 0,
        'moderator': 1,
        'admin': 2,
        'super_admin': 3
      };
      
      const adminLevel = roleHierarchy[req.user.role] || 0;
      const targetLevel = roleHierarchy[targetUser.role] || 0;
      
      if (targetLevel >= adminLevel) {
        return this.errorResponse(res, 403, 'Cannot unlock account for user with equal or higher role');
      }
      
      // Unlock account by resetting login attempts
      await BaseUser.findByIdAndUpdate(targetUserId, {
        $set: {
          loginAttempts: 0,
          lockUntil: null,
          accountStatus: 'active'
        },
        $push: {
          accountHistory: {
            action: 'account_unlocked',
            performedBy: req.user.id,
            reason: req.body.reason || 'Admin unlock',
            timestamp: new Date()
          }
        }
      });
      
      // Log admin action
      logger.info('Admin account unlock', {
        adminId: req.user.id,
        adminEmail: req.user.email,
        targetUserId,
        targetEmail: targetUser.email,
        reason: req.body.reason,
        timestamp: new Date().toISOString()
      });
      
      return this.successResponse(res, 200, {
        userId: targetUserId,
        email: targetUser.email,
        accountStatus: 'active',
        message: 'Account unlocked successfully'
      }, 'Account unlocked');
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== ADMIN ACCOUNT REACTIVATION ==========

async adminGetDeactivatedUsers(req, res) {
  try {
    // Only admin/super_admin can access this
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return this.errorResponse(res, 403, 'Insufficient permissions');
    }
    
    const { page = 1, limit = 50, search } = req.query;
    const skip = (page - 1) * limit;
    
    const { BaseUser } = require('@models/User');
    
    // Build query for deactivated users
    const query = {
      accountStatus: 'deactivated'
    };
    
    // Add search functionality
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } }
      ];
    }
    
    const [users, total] = await Promise.all([
      BaseUser.find(query)
        .select('firstName lastName email role userType deactivatedAt deactivatedBy accountStatus createdAt')
        .sort({ deactivatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      BaseUser.countDocuments(query)
    ]);
    
    // Get additional info like who deactivated the account
    const enrichedUsers = await Promise.all(
      users.map(async (user) => {
        const enriched = { ...user };
        
        // Get deactivated by user info if available
        if (user.deactivatedBy) {
          const deactivatedByUser = await BaseUser.findById(user.deactivatedBy)
            .select('firstName lastName email role')
            .lean();
          
          if (deactivatedByUser) {
            enriched.deactivatedByInfo = deactivatedByUser;
          }
        }
        
        // Get dating profile info if applicable
        if (user.userType === 'DatingUser') {
          const DatingUser = require('@models/User/datingUserSchema');
          const datingUser = await DatingUser.findById(user._id)
            .select('profile ageVerified')
            .lean();
          
          if (datingUser) {
            enriched.datingProfile = {
              hasProfile: !!datingUser.profile,
              ageVerified: datingUser.ageVerified || false
            };
          }
        }
        
        return enriched;
      })
    );
    
    return this.successResponse(res, 200, {
      users: enrichedUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
        showing: enrichedUsers.length
      }
    }, 'Deactivated users retrieved');
  } catch (error) {
    return this.handleError(error, req, res);
  }
}

async adminReactivateAccount(req, res) {
  try {
    // Only admin/super_admin can access this
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return this.errorResponse(res, 403, 'Insufficient permissions');
    }
    
    const { targetUserId, reason } = req.body;
    
    if (!targetUserId) {
      return this.errorResponse(res, 400, 'targetUserId is required');
    }
    
    const { BaseUser } = require('@models/User');
    const Profile = require('@models/Profile.model');
    
    // Find deactivated user
    const user = await BaseUser.findOne({
      _id: targetUserId,
      accountStatus: 'deactivated'
    });
    
    if (!user) {
      return this.errorResponse(res, 404, 'Deactivated user not found');
    }
    
    // Check permission hierarchy
    const roleHierarchy = {
      'user': 0,
      'moderator': 1,
      'admin': 2,
      'super_admin': 3
    };
    
    const adminLevel = roleHierarchy[req.user.role] || 0;
    const targetLevel = roleHierarchy[user.role] || 0;
    
    // Regular admins cannot reactivate other admins
    if (req.user.role === 'admin' && targetLevel >= 2) {
      return this.errorResponse(res, 403, 
        'Cannot reactivate admin accounts. Contact super admin.'
      );
    }
    
    // Reactivate the account
    user.accountStatus = 'active';
    user.reactivatedAt = new Date();
    user.reactivatedBy = req.user.id;
    user.loginAttempts = 0;
    user.lockUntil = null;
    
    // Add to reactivation history
    if (!user.reactivationHistory) {
      user.reactivationHistory = [];
    }
    
    user.reactivationHistory.push({
      reactivatedAt: new Date(),
      reactivatedBy: req.user.id,
      reason: reason || 'Admin reactivation',
      adminEmail: req.user.email
    });
    
    await user.save();
    
    // If it's a dating user, also unpause their dating profile
    if (user.userType === 'DatingUser') {
      await Profile.updateOne(
        { userId: targetUserId },
        { 'datingProfile.isPaused': false }
      );
    }
    
    // Log the action
    logger.info('Account reactivated by admin', {
      adminId: req.user.id,
      adminEmail: req.user.email,
      targetUserId,
      targetEmail: user.email,
      targetRole: user.role,
      reason: reason,
      timestamp: new Date().toISOString()
    });
    
    // Send notification email to user
    await this.sendReactivationNotificationEmail(user.email, {
      adminName: req.user.firstName || 'Admin',
      reason: reason,
      reactivatedAt: new Date()
    });
    
    return this.successResponse(res, 200, {
      userId: user._id,
      email: user.email,
      role: user.role,
      userType: user.userType,
      accountStatus: user.accountStatus,
      reactivatedAt: user.reactivatedAt,
      reactivatedBy: req.user.id,
      message: 'Account reactivated successfully'
    }, 'Account reactivated');
  } catch (error) {
    return this.handleError(error, req, res);
  }
}

async adminGetReactivationHistory(req, res) {
  try {
    // Only admin/super_admin can access this
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return this.errorResponse(res, 403, 'Insufficient permissions');
    }
    
    const { targetUserId } = req.params;
    
    if (!targetUserId) {
      return this.errorResponse(res, 400, 'targetUserId is required');
    }
    
    const { BaseUser } = require('@models/User');
    
    const user = await BaseUser.findById(targetUserId)
      .select('reactivationHistory accountStatus deactivatedAt deactivatedBy')
      .lean();
    
    if (!user) {
      return this.errorResponse(res, 404, 'User not found');
    }
    
    // Get admin info for each reactivation
    const enrichedHistory = await Promise.all(
      (user.reactivationHistory || []).map(async (entry) => {
        const admin = await BaseUser.findById(entry.reactivatedBy)
          .select('firstName lastName email role')
          .lean();
        
        return {
          ...entry,
          adminInfo: admin || null
        };
      })
    );
    
    return this.successResponse(res, 200, {
      userId: targetUserId,
      currentStatus: user.accountStatus,
      deactivatedAt: user.deactivatedAt,
      deactivatedBy: user.deactivatedBy,
      reactivationHistory: enrichedHistory,
      totalReactivations: enrichedHistory.length
    }, 'Reactivation history retrieved');
  } catch (error) {
    return this.handleError(error, req, res);
  }
}

// ========== EMAIL HELPER METHODS ==========

async sendReactivationNotificationEmail(email, data) {
  try {
    // Implement your email service here
    // This is a placeholder implementation
    const nodemailer = require('nodemailer');
    
    const transporter = nodemailer.createTransport({
      // Your email configuration
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Your Account Has Been Reactivated',
      html: `
        <h2>Account Reactivated</h2>
        <p>Your account has been reactivated by an administrator.</p>
        <p><strong>Details:</strong></p>
        <ul>
          <li>Reactivated by: ${data.adminName}</li>
          <li>Date: ${new Date(data.reactivatedAt).toLocaleString()}</li>
          ${data.reason ? `<li>Reason: ${data.reason}</li>` : ''}
        </ul>
        <p>You can now log in to your account as usual.</p>
        <p>If you did not request this reactivation, please contact support immediately.</p>
        <br>
        <p>Best regards,<br>The JWLovers Team</p>
      `
    };
    
    await transporter.sendMail(mailOptions);
    logger.info('Reactivation notification email sent', { email });
    
  } catch (error) {
    logger.error('Failed to send reactivation email:', error);
    // Don't throw error - email failure shouldn't block reactivation
  }
}

  // ========== ERROR HANDLING ==========

  handleError(error, req, res) {
    logger.error('UserController error:', {
      error: error.message,
      stack: error.stack,
      userId: req.userId || req.user?.id,
      path: req.path,
      method: req.method,
      requestId: req.requestId,
      ip: req.ip
    });

    // Handle schema migration errors
    if (error.message.includes('profile') || error.message.includes('schema') || error.message.includes('Profile not found')) {
      return this.errorResponse(res, 400, error.message, {
        code: "SCHEMA_MIGRATION",
        requestId: req.requestId,
        note: "This may be due to recent schema changes. Please recreate your profile."
      });
    }

    if (error.name === 'ValidationError') {
      return this.errorResponse(res, 400, error.message, {
        code: "VALIDATION_ERROR",
        requestId: req.requestId
      });
    }

    if (error.code === 11000) {
      return this.errorResponse(res, 409, "A user with this information already exists", {
        code: "DUPLICATE_KEY",
        requestId: req.requestId
      });
    }

    if (error.name === 'CastError') {
      return this.errorResponse(res, 400, "Invalid user ID format", {
        code: "INVALID_ID",
        requestId: req.requestId
      });
    }

    if (error.message.includes('Unauthorized') || error.message.includes('Insufficient permissions')) {
      return this.errorResponse(res, 403, error.message, {
        code: "PERMISSION_DENIED",
        requestId: req.requestId
      });
    }

    if (error.message.includes('Too many')) {
      return this.errorResponse(res, 429, error.message, {
        code: "RATE_LIMITED",
        requestId: req.requestId
      });
    }

    return this.errorResponse(res, 500, "An error occurred while processing your request", {
      code: "INTERNAL_ERROR",
      requestId: req.requestId
    });
  }
}

module.exports = UserController;