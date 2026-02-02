const { 
  BaseUser, 
  DatingUser, 
  Moderator, 
  Admin, 
  SuperAdmin,
  ROLES 
} = require('@models/User');
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

    const user = await BaseUser.findById(userId)
      .select('notificationSettings privacySettings role userType');
    
    if (!user) {
      return controller.errorResponse(res, 404, "User not found", {
        code: "USER_NOT_FOUND",
        requestId: req.requestId
      });
    }

    const settings = {
      notificationSettings: user.notificationSettings || {},
      privacySettings: user.privacySettings || {}
    };

    // Add role-specific settings
    if (user.role === ROLES.USER) {
      const datingUser = await DatingUser.findById(userId)
        .select('datingNotificationSettings datingPrivacySettings messagingPreferences');
      
      if (datingUser) {
        settings.datingNotificationSettings = datingUser.datingNotificationSettings || {};
        settings.datingPrivacySettings = datingUser.datingPrivacySettings || {};
        settings.messagingPreferences = datingUser.messagingPreferences || 'everyone';
      }
    } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
      let staffUser;
      switch(user.userType) {
        case 'Moderator':
          staffUser = await Moderator.findById(userId)
            .select('staffNotificationSettings');
          break;
        case 'Admin':
          staffUser = await Admin.findById(userId)
            .select('staffNotificationSettings');
          break;
        case 'SuperAdmin':
          staffUser = await SuperAdmin.findById(userId)
            .select('staffNotificationSettings');
          break;
        default:
          staffUser = await BaseUser.findById(userId)
            .select('staffNotificationSettings');
      }
      
      if (staffUser) {
        settings.staffNotificationSettings = staffUser.staffNotificationSettings || {};
      }
    }

    return controller.successResponse(res, 200, settings, null, {
      requestId: req.requestId
    });
  }

  async updateSettings(req, res, controller) {
    const { 
      notificationSettings, 
      privacySettings,
      datingNotificationSettings,
      datingPrivacySettings,
      messagingPreferences,
      staffNotificationSettings
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

    // Prepare updates based on user type
    const updateData = {};
    
    // Common settings for all users
    if (notificationSettings && typeof notificationSettings === 'object') {
      if (!this.validationService.validateNotificationSettings(notificationSettings)) {
        return controller.errorResponse(res, 400, "Invalid notification settings structure", {
          code: "INVALID_NOTIFICATION_SETTINGS",
          requestId: req.requestId
        });
      }
      updateData.notificationSettings = this.validationService.mergeSettings(
        user.notificationSettings || {}, 
        notificationSettings
      );
    }
    
    if (privacySettings && typeof privacySettings === 'object') {
      if (!this.validationService.validatePrivacySettings(privacySettings)) {
        return controller.errorResponse(res, 400, "Invalid privacy settings structure", {
          code: "INVALID_PRIVACY_SETTINGS",
          requestId: req.requestId
        });
      }
      updateData.privacySettings = this.validationService.mergeSettings(
        user.privacySettings || {}, 
        privacySettings
      );
    }

    // Role-specific settings
    if (user.role === ROLES.USER) {
      // Dating user specific settings
      const datingUpdates = {};
      
      if (datingNotificationSettings && typeof datingNotificationSettings === 'object') {
        if (!this.validationService.validateDatingNotificationSettings(datingNotificationSettings)) {
          return controller.errorResponse(res, 400, "Invalid dating notification settings", {
            code: "INVALID_DATING_NOTIFICATION_SETTINGS",
            requestId: req.requestId
          });
        }
        datingUpdates.datingNotificationSettings = this.validationService.mergeSettings(
          user.datingNotificationSettings || {}, 
          datingNotificationSettings
        );
      }
      
      if (datingPrivacySettings && typeof datingPrivacySettings === 'object') {
        if (!this.validationService.validateDatingPrivacySettings(datingPrivacySettings)) {
          return controller.errorResponse(res, 400, "Invalid dating privacy settings", {
            code: "INVALID_DATING_PRIVACY_SETTINGS",
            requestId: req.requestId
          });
        }
        datingUpdates.datingPrivacySettings = this.validationService.mergeSettings(
          user.datingPrivacySettings || {}, 
          datingPrivacySettings
        );
      }
      
      if (messagingPreferences && ['everyone', 'matches_only', 'friends_only', 'disabled'].includes(messagingPreferences)) {
        datingUpdates.messagingPreferences = messagingPreferences;
      }

      // Apply dating updates if any
      if (Object.keys(datingUpdates).length > 0) {
        await DatingUser.findByIdAndUpdate(userId, datingUpdates);
      }
      
    } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
      // Staff specific settings
      if (staffNotificationSettings && typeof staffNotificationSettings === 'object') {
        if (!this.validationService.validateStaffNotificationSettings(staffNotificationSettings)) {
          return controller.errorResponse(res, 400, "Invalid staff notification settings", {
            code: "INVALID_STAFF_NOTIFICATION_SETTINGS",
            requestId: req.requestId
          });
        }
        updateData.staffNotificationSettings = this.validationService.mergeSettings(
          user.staffNotificationSettings || {}, 
          staffNotificationSettings
        );
      }
    }

    if (Object.keys(updateData).length === 0 && 
        Object.keys(req.body).filter(k => !['notificationSettings', 'privacySettings'].includes(k)).length === 0) {
      return controller.errorResponse(res, 400, "No settings provided to update", {
        code: "NO_SETTINGS_PROVIDED",
        requestId: req.requestId
      });
    }

    // Update common settings
    if (Object.keys(updateData).length > 0) {
      await BaseUser.findByIdAndUpdate(
        userId,
        { $set: updateData }
      );
    }

    // Get updated settings (call our own method)
    const getSettingsResponse = await this.getSettings(req, res, controller);
    
    // Log the update for audit purposes
    logger.info('User settings updated', {
      userId: userId.toString(),
      userType: user.userType,
      role: user.role,
      updatedSettings: Object.keys(req.body),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId
    });

    return getSettingsResponse;
  }
}

module.exports = UserSettingsService;