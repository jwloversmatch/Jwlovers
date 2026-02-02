const validator = require('validator');
const { ROLES } = require('@models/User');

class UserValidationService {
  validateDatingProfileUpdates(updates) {
    // Validate username if provided
    if (updates.userName !== undefined) {
      const username = updates.userName.trim();
      if (username.length < 3) {
        return { valid: false, error: "Username must be at least 3 characters long" };
      }
      if (username.length > 20) {
        return { valid: false, error: "Username cannot exceed 20 characters" };
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return { valid: false, error: "Username can only contain letters, numbers, underscores and hyphens" };
      }
    }

    // Validate avatar URL if provided
    if (updates.avatar !== undefined && updates.avatar !== null) {
      if (!validator.isURL(updates.avatar, { 
        protocols: ['http', 'https'], 
        require_protocol: true 
      })) {
        return { valid: false, error: "Please provide a valid avatar URL" };
      }
    }

    // Validate date of birth if provided
    if (updates.dateOfBirth !== undefined) {
      const dob = new Date(updates.dateOfBirth);
      if (isNaN(dob.getTime())) {
        return { valid: false, error: "Invalid date of birth" };
      }
      
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
      }
      
      if (age < 18) {
        return { valid: false, error: "You must be at least 18 years old" };
      }
      if (age > 100) {
        return { valid: false, error: "You must be under 100 years old" };
      }
    }

    // Validate messagingPreferences if provided
    if (updates.messagingPreferences !== undefined) {
      const validOptions = ['everyone', 'matches_only', 'friends_only', 'disabled'];
      if (!validOptions.includes(updates.messagingPreferences)) {
        return { 
          valid: false, 
          error: `messagingPreferences must be one of: ${validOptions.join(', ')}` 
        };
      }
    }

    return { valid: true };
  }

  validateStaffProfileUpdates(updates) {
    // Staff can only update limited fields
    const allowedFields = ['firstName', 'lastName', 'avatar', 'phoneNumber'];
    const providedFields = Object.keys(updates);
    
    const invalidFields = providedFields.filter(field => !allowedFields.includes(field));
    if (invalidFields.length > 0) {
      return { 
        valid: false, 
        error: `Cannot update fields: ${invalidFields.join(', ')} for staff accounts` 
      };
    }

    // Validate avatar URL if provided
    if (updates.avatar !== undefined && updates.avatar !== null) {
      if (!validator.isURL(updates.avatar, { 
        protocols: ['http', 'https'], 
        require_protocol: true 
      })) {
        return { valid: false, error: "Please provide a valid avatar URL" };
      }
    }

    // Validate phone number if provided
    if (updates.phoneNumber !== undefined) {
      const trimmed = updates.phoneNumber.trim();
      if (trimmed && !validator.isMobilePhone(trimmed, 'any', { strictMode: false })) {
        return { 
          valid: false, 
          error: "Please provide a valid phone number" 
        };
      }
    }

    return { valid: true };
  }

  validateNotificationSettings(settings) {
    const allowedKeys = ['email', 'push'];
    const settingKeys = Object.keys(settings);
    
    return settingKeys.every(key => allowedKeys.includes(key)) &&
           settingKeys.every(key => typeof settings[key] === 'boolean');
  }

  validateDatingNotificationSettings(settings) {
    const allowedKeys = ['messages', 'matches', 'likes', 'safetyAlerts'];
    const settingKeys = Object.keys(settings);
    
    return settingKeys.every(key => allowedKeys.includes(key)) &&
           settingKeys.every(key => typeof settings[key] === 'boolean');
  }

  validateStaffNotificationSettings(settings) {
    const allowedKeys = ['userReports', 'systemAlerts', 'adminAnnouncements'];
    const settingKeys = Object.keys(settings);
    
    return settingKeys.every(key => allowedKeys.includes(key)) &&
           settingKeys.every(key => typeof settings[key] === 'boolean');
  }

  validatePrivacySettings(settings) {
    const allowedKeys = ['profileVisibility', 'showOnlineStatus'];
    const settingKeys = Object.keys(settings);
    
    return settingKeys.every(key => allowedKeys.includes(key));
  }

  validateDatingPrivacySettings(settings) {
    const allowedKeys = ['showLastSeen', 'allowMessagesFrom'];
    const settingKeys = Object.keys(settings);
    
    return settingKeys.every(key => allowedKeys.includes(key));
  }

  prepareUserUpdates(updates, role) {
    const userUpdates = {};
    
    if (updates.firstName !== undefined) {
      userUpdates.firstName = updates.firstName.trim();
    }
    
    if (updates.lastName !== undefined) {
      userUpdates.lastName = updates.lastName.trim();
    }
    
    if (updates.phoneNumber !== undefined) {
      userUpdates.phoneNumber = updates.phoneNumber ? updates.phoneNumber.trim() : null;
      userUpdates.phoneVerified = false;
    }
    
    if (updates.avatar !== undefined) {
      userUpdates.avatar = updates.avatar;
    }
    
    if (updates.userName !== undefined && role === ROLES.USER) {
      userUpdates.userName = updates.userName.trim().toLowerCase();
    }
    
    if (updates.dateOfBirth !== undefined && role === ROLES.USER) {
      userUpdates.dateOfBirth = new Date(updates.dateOfBirth);
    }
    
    if (updates.messagingPreferences !== undefined && role === ROLES.USER) {
      userUpdates.messagingPreferences = updates.messagingPreferences;
    }

    return userUpdates;
  }

  prepareProfileUpdates(updates) {
    const profileUpdates = {};
    
    if (updates.bio !== undefined) {
      profileUpdates.bio = updates.bio.trim();
    }
    
    if (updates.profilePicture !== undefined) {
      profileUpdates.profilePicture = updates.profilePicture;
    }

    if (Object.keys(profileUpdates).length > 0) {
      profileUpdates.lastUpdated = new Date();
    }

    return profileUpdates;
  }

  hasDatingProfileUpdates(updates) {
    return updates.bio !== undefined || updates.profilePicture !== undefined;
  }

  mergeSettings(existing = {}, updates = {}) {
    return { ...existing, ...updates };
  }
}

module.exports = UserValidationService;