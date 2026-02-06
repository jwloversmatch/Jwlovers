// services/UserSettingsService.js - UPDATED for multi-schema
const { BaseUser, DatingUser } = require('@models/User');
const logger = require('@utils/logger');
const UserValidationService = require('./UserValidationService');

class UserSettingsService {
  constructor() {
    this.validationService = new UserValidationService();
  }

  async getSettings(req, res, controller) {
    const userId = req.userId || req.user?.id;
    
    if (!userId) {
      return controller.errorResponse(res, 401, "Authentication required", {
        code: "AUTH_REQUIRED",
        requestId: req.requestId
      });
    }

    // Get base user settings
    const user = await BaseUser.findById(userId)
      .select('notificationSettings privacySettings messagingPreferences role userType');
    
    if (!user) {
      return controller.errorResponse(res, 404, "User not found", {
        code: "USER_NOT_FOUND",
        requestId: req.requestId
      });
    }

    const settings = {
      general: {
        notificationSettings: user.notificationSettings || {},
        privacySettings: user.privacySettings || {},
        messagingPreferences: user.messagingPreferences || 'everyone'
      }
    };

    // Get dating settings if user has dating profile
    if (user.userType === 'DatingUser' || user.role === 'user') {
      const datingUser = await DatingUser.findById(userId)
        .select('datingNotificationSettings datingPrivacySettings datingPreferences');
      
      if (datingUser) {
        settings.dating = {
          notificationSettings: datingUser.datingNotificationSettings || {},
          privacySettings: datingUser.datingPrivacySettings || {},
          preferences: datingUser.datingPreferences || {}
        };
      }
    }

    // Get staff settings for staff users
    if (['moderator', 'admin', 'super_admin'].includes(user.role)) {
      settings.staff = {
        notificationSettings: user.staffNotificationSettings || {},
        workSettings: user.workSettings || {}
      };
    }

    return controller.successResponse(res, 200, settings, null, {
      requestId: req.requestId
    });
  }

  async updateSettings(req, res, controller) {
    const { 
      // General settings
      notificationSettings, 
      privacySettings,
      messagingPreferences,
      
      // Dating settings
      datingNotificationSettings,
      datingPrivacySettings,
      datingPreferences,
      
      // Staff settings
      staffNotificationSettings,
      workSettings
    } = req.body;
    
    const userId = req.userId || req.user?.id;
    
    if (!userId) {
      return controller.errorResponse(res, 401, "Authentication required", {
        code: "AUTH_REQUIRED",
        requestId: req.requestId
      });
    }
    
    // Check permissions - users can only update their own settings
    if (userId !== req.user?._id?.toString()) {
      return controller.errorResponse(res, 403, "Can only update your own settings", {
        code: "PERMISSION_DENIED",
        requestId: req.requestId
      });
    }

    // Get user to check type
    const user = await BaseUser.findById(userId);
    if (!user) {
      return controller.errorResponse(res, 404, "User not found", {
        code: "USER_NOT_FOUND",
        requestId: req.requestId
      });
    }

    // Track what was updated
    const updatedSections = [];
    const baseUpdates = {};
    const datingUpdates = {};

    // ========== GENERAL SETTINGS (BaseUser) ==========
    if (notificationSettings && typeof notificationSettings === 'object') {
      if (!this.validationService.validateNotificationSettings(notificationSettings)) {
        return controller.errorResponse(res, 400, "Invalid notification settings structure", {
          code: "INVALID_NOTIFICATION_SETTINGS",
          requestId: req.requestId
        });
      }
      baseUpdates.notificationSettings = this.mergeSettings(
        user.notificationSettings || {}, 
        notificationSettings
      );
      updatedSections.push('notificationSettings');
    }
    
    if (privacySettings && typeof privacySettings === 'object') {
      if (!this.validationService.validatePrivacySettings(privacySettings)) {
        return controller.errorResponse(res, 400, "Invalid privacy settings structure", {
          code: "INVALID_PRIVACY_SETTINGS",
          requestId: req.requestId
        });
      }
      baseUpdates.privacySettings = this.mergeSettings(
        user.privacySettings || {}, 
        privacySettings
      );
      updatedSections.push('privacySettings');
    }

    if (messagingPreferences && ['everyone', 'matches', 'friends', 'nobody'].includes(messagingPreferences)) {
      baseUpdates.messagingPreferences = messagingPreferences;
      updatedSections.push('messagingPreferences');
    }

    // ========== DATING SETTINGS (DatingUser) ==========
    if (user.userType === 'DatingUser' || user.role === 'user') {
      if (datingNotificationSettings && typeof datingNotificationSettings === 'object') {
        if (!this.validationService.validateDatingNotificationSettings(datingNotificationSettings)) {
          return controller.errorResponse(res, 400, "Invalid dating notification settings", {
            code: "INVALID_DATING_NOTIFICATION_SETTINGS",
            requestId: req.requestId
          });
        }
        datingUpdates.datingNotificationSettings = this.mergeSettings(
          {}, // Start fresh since DatingUser might not exist yet
          datingNotificationSettings
        );
        updatedSections.push('datingNotificationSettings');
      }
      
      if (datingPrivacySettings && typeof datingPrivacySettings === 'object') {
        if (!this.validationService.validateDatingPrivacySettings(datingPrivacySettings)) {
          return controller.errorResponse(res, 400, "Invalid dating privacy settings", {
            code: "INVALID_DATING_PRIVACY_SETTINGS",
            requestId: req.requestId
          });
        }
        datingUpdates.datingPrivacySettings = this.mergeSettings(
          {},
          datingPrivacySettings
        );
        updatedSections.push('datingPrivacySettings');
      }
      
      if (datingPreferences && typeof datingPreferences === 'object') {
        if (!this.validationService.validateDatingPreferences(datingPreferences)) {
          return controller.errorResponse(res, 400, "Invalid dating preferences", {
            code: "INVALID_DATING_PREFERENCES",
            requestId: req.requestId
          });
        }
        datingUpdates.datingPreferences = this.mergeSettings(
          {},
          datingPreferences
        );
        updatedSections.push('datingPreferences');
      }
    }

    // ========== STAFF SETTINGS (BaseUser for staff) ==========
    if (['moderator', 'admin', 'super_admin'].includes(user.role)) {
      if (staffNotificationSettings && typeof staffNotificationSettings === 'object') {
        if (!this.validationService.validateStaffNotificationSettings(staffNotificationSettings)) {
          return controller.errorResponse(res, 400, "Invalid staff notification settings", {
            code: "INVALID_STAFF_NOTIFICATION_SETTINGS",
            requestId: req.requestId
          });
        }
        baseUpdates.staffNotificationSettings = this.mergeSettings(
          user.staffNotificationSettings || {}, 
          staffNotificationSettings
        );
        updatedSections.push('staffNotificationSettings');
      }

      if (workSettings && typeof workSettings === 'object') {
        baseUpdates.workSettings = this.mergeSettings(
          user.workSettings || {},
          workSettings
        );
        updatedSections.push('workSettings');
      }
    }

    // Check if any updates were provided
    if (updatedSections.length === 0) {
      return controller.errorResponse(res, 400, "No settings provided to update", {
        code: "NO_SETTINGS_PROVIDED",
        requestId: req.requestId
      });
    }

    // ========== APPLY UPDATES ==========
    try {
      // Update BaseUser
      if (Object.keys(baseUpdates).length > 0) {
        await BaseUser.findByIdAndUpdate(
          userId,
          { $set: baseUpdates },
          { new: true }
        );
      }

      // Update DatingUser if updates exist and user is dating type
      if (Object.keys(datingUpdates).length > 0) {
        if (user.userType === 'DatingUser' || user.role === 'user') {
          await DatingUser.findOneAndUpdate(
            { _id: userId },
            { $set: datingUpdates },
            { upsert: true, new: true } // Create if doesn't exist
          );
        }
      }

      // Get updated settings
      const updatedSettings = await this.getUpdatedSettings(userId);

      // Log the update
      logger.info('User settings updated', {
        userId: userId.toString(),
        userType: user.userType,
        role: user.role,
        updatedSections,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId
      });

      return controller.successResponse(res, 200, updatedSettings, "Settings updated successfully", {
        requestId: req.requestId,
        updatedSections
      });

    } catch (error) {
      logger.error('Failed to update settings:', {
        userId,
        error: error.message,
        updatedSections,
        requestId: req.requestId
      });

      throw error;
    }
  }

  // Helper method to merge settings
  mergeSettings(existing, updates) {
    return {
      ...existing,
      ...updates
    };
  }

  // Helper method to get updated settings
  async getUpdatedSettings(userId) {
    const user = await BaseUser.findById(userId)
      .select('notificationSettings privacySettings messagingPreferences role userType staffNotificationSettings workSettings');

    const settings = {
      general: {
        notificationSettings: user.notificationSettings || {},
        privacySettings: user.privacySettings || {},
        messagingPreferences: user.messagingPreferences || 'everyone'
      }
    };

    // Get dating settings if applicable
    if (user.userType === 'DatingUser' || user.role === 'user') {
      const datingUser = await DatingUser.findById(userId)
        .select('datingNotificationSettings datingPrivacySettings datingPreferences');
      
      if (datingUser) {
        settings.dating = {
          notificationSettings: datingUser.datingNotificationSettings || {},
          privacySettings: datingUser.datingPrivacySettings || {},
          preferences: datingUser.datingPreferences || {}
        };
      }
    }

    // Get staff settings if applicable
    if (['moderator', 'admin', 'super_admin'].includes(user.role)) {
      settings.staff = {
        notificationSettings: user.staffNotificationSettings || {},
        workSettings: user.workSettings || {}
      };
    }

    return settings;
  }

  // You'll need to add these validation methods or update UserValidationService
  validateDatingPreferences(preferences) {
    // Basic validation for dating preferences
    const allowedFields = ['ageRange', 'distance', 'notificationRadius', 'dealBreakers'];
    return Object.keys(preferences).every(key => allowedFields.includes(key));
  }
}

module.exports = UserSettingsService;