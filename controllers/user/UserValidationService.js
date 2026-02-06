// services/UserValidationService.js - UPDATED for multi-schema
const validator = require('validator');
const { ROLES } = require('@models/User');

class UserValidationService {
  // ========== PROFILE VALIDATION ==========
  
  validateProfileUpdates(updates) {
    const errors = [];
    
    // Validate username if provided
    if (updates.userName !== undefined) {
      const username = updates.userName.trim();
      if (username.length < 3) {
        errors.push("Username must be at least 3 characters long");
      }
      if (username.length > 20) {
        errors.push("Username cannot exceed 20 characters");
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        errors.push("Username can only contain letters, numbers, underscores and hyphens");
      }
    }

    // Validate avatar URL if provided
    if (updates.avatar !== undefined && updates.avatar !== null) {
      if (!validator.isURL(updates.avatar, { 
        protocols: ['http', 'https'], 
        require_protocol: true 
      })) {
        errors.push("Please provide a valid avatar URL");
      }
    }

    // Validate date of birth if provided
    if (updates.dateOfBirth !== undefined) {
      const dob = new Date(updates.dateOfBirth);
      if (isNaN(dob.getTime())) {
        errors.push("Invalid date of birth");
      } else {
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
          age--;
        }
        
        if (age < 13) {
          errors.push("You must be at least 13 years old");
        }
        if (age > 100) {
          errors.push("You must be under 100 years old");
        }
      }
    }

    // Validate bio length if provided
    if (updates.bio !== undefined) {
      if (updates.bio.length > 500) {
        errors.push("Bio cannot exceed 500 characters");
      }
    }

    // Validate location if provided
    if (updates.location !== undefined) {
      if (!updates.location.coordinates || !Array.isArray(updates.location.coordinates)) {
        errors.push("Location must include coordinates array");
      }
    }

    if (errors.length > 0) {
      return { valid: false, error: errors.join(', ') };
    }

    return { valid: true };
  }

  // ========== SETTINGS VALIDATION ==========

  validateNotificationSettings(settings) {
    const allowedKeys = ['email', 'push'];
    const settingKeys = Object.keys(settings);
    
    return settingKeys.every(key => allowedKeys.includes(key)) &&
           settingKeys.every(key => typeof settings[key] === 'boolean');
  }

  validateDatingNotificationSettings(settings) {
    const allowedKeys = ['newMatches', 'newLikes', 'superLikes', 'profileViews', 'safetyAlerts', 'promotionOffers', 'matchSuggestions', 'eventInvitations'];
    const settingKeys = Object.keys(settings);
    
    return settingKeys.every(key => allowedKeys.includes(key)) &&
           settingKeys.every(key => typeof settings[key] === 'boolean');
  }

  validateStaffNotificationSettings(settings) {
    const allowedKeys = ['userReports', 'systemAlerts', 'adminAnnouncements', 'shiftReminders', 'caseUpdates', 'teamMessages'];
    const settingKeys = Object.keys(settings);
    
    return settingKeys.every(key => allowedKeys.includes(key)) &&
           settingKeys.every(key => typeof settings[key] === 'boolean' || 
                                    (key === 'userReports' && ['assigned', 'all', 'none'].includes(settings[key])));
  }

  validatePrivacySettings(settings) {
    const allowedKeys = ['profileVisibility', 'showOnlineStatus'];
    const settingKeys = Object.keys(settings);
    
    const validKeys = settingKeys.every(key => allowedKeys.includes(key));
    if (!validKeys) return false;
    
    // Validate values
    if (settings.profileVisibility && !['public', 'private', 'friends_only'].includes(settings.profileVisibility)) {
      return false;
    }
    
    if (settings.showOnlineStatus !== undefined && typeof settings.showOnlineStatus !== 'boolean') {
      return false;
    }
    
    return true;
  }

  validateDatingPrivacySettings(settings) {
    const allowedKeys = ['showAge', 'showDistance', 'showInterests', 'showLastActive', 'allowMessagesFrom'];
    const settingKeys = Object.keys(settings);
    
    const validKeys = settingKeys.every(key => allowedKeys.includes(key));
    if (!validKeys) return false;
    
    // Validate values
    if (settings.showAge !== undefined && typeof settings.showAge !== 'boolean') {
      return false;
    }
    
    if (settings.showDistance !== undefined && typeof settings.showDistance !== 'boolean') {
      return false;
    }
    
    if (settings.showInterests !== undefined && typeof settings.showInterests !== 'boolean') {
      return false;
    }
    
    if (settings.showLastActive && !['everyone', 'matches', 'nobody'].includes(settings.showLastActive)) {
      return false;
    }
    
    if (settings.allowMessagesFrom && !['everyone', 'matches', 'friends', 'nobody'].includes(settings.allowMessagesFrom)) {
      return false;
    }
    
    return true;
  }

  validateDatingPreferences(preferences) {
    const allowedKeys = ['ageRange', 'distance', 'notificationRadius', 'dealBreakers', 'preferredMeetingTypes', 'activityLevel'];
    const settingKeys = Object.keys(preferences);
    
    const validKeys = settingKeys.every(key => allowedKeys.includes(key));
    if (!validKeys) return false;
    
    // Validate ageRange
    if (preferences.ageRange) {
      if (preferences.ageRange.min && (preferences.ageRange.min < 18 || preferences.ageRange.min > 100)) {
        return false;
      }
      if (preferences.ageRange.max && (preferences.ageRange.max < 18 || preferences.ageRange.max > 100)) {
        return false;
      }
      if (preferences.ageRange.min && preferences.ageRange.max && preferences.ageRange.min > preferences.ageRange.max) {
        return false;
      }
    }
    
    // Validate distance
    if (preferences.distance !== undefined && (preferences.distance < 1 || preferences.distance > 100)) {
      return false;
    }
    
    // Validate notificationRadius
    if (preferences.notificationRadius !== undefined && (preferences.notificationRadius < 1 || preferences.notificationRadius > 100)) {
      return false;
    }
    
    // Validate activityLevel
    if (preferences.activityLevel && !['low', 'moderate', 'high', 'very_high'].includes(preferences.activityLevel)) {
      return false;
    }
    
    return true;
  }

  // ========== FIELD SPECIFIC VALIDATION ==========

  validateEmail(email) {
    return validator.isEmail(email);
  }

  validatePhoneNumber(phone) {
    return validator.isMobilePhone(phone, 'any', { strictMode: false });
  }

  validatePassword(password) {
    if (password.length < 8) {
      return { valid: false, error: "Password must be at least 8 characters long" };
    }
    if (!/[A-Z]/.test(password)) {
      return { valid: false, error: "Password must contain at least one uppercase letter" };
    }
    if (!/[a-z]/.test(password)) {
      return { valid: false, error: "Password must contain at least one lowercase letter" };
    }
    if (!/\d/.test(password)) {
      return { valid: false, error: "Password must contain at least one number" };
    }
    return { valid: true };
  }

  validateStaffPassword(password) {
    const baseValidation = this.validatePassword(password);
    if (!baseValidation.valid) return baseValidation;
    
    if (password.length < 12) {
      return { valid: false, error: "Staff passwords must be at least 12 characters long" };
    }
    if (!/[@$!%*?&]/.test(password)) {
      return { valid: false, error: "Staff passwords must contain at least one special character (@$!%*?&)" };
    }
    
    return { valid: true };
  }

  // ========== HELPER METHODS ==========

  prepareUserUpdates(updates) {
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
    
    if (updates.email !== undefined) {
      userUpdates.email = updates.email.toLowerCase().trim();
      userUpdates.emailVerified = false;
    }
    
    return userUpdates;
  }

  prepareProfileUpdates(updates) {
    const profileUpdates = {};
    
    const profileFields = [
      'userName', 'bio', 'profilePicture', 'dateOfBirth', 'gender',
      'height', 'countryOfOrigin', 'homeLanguage', 'religion', 'servingAs',
      'relationshipStatus', 'lookingFor', 'haveChildren', 'wantsChildren',
      'education', 'occupation', 'income', 'hobbies', 'languages', 'lifestyle',
      'matchPreferences', 'location', 'datingProfile'
    ];
    
    profileFields.forEach(field => {
      if (updates[field] !== undefined) {
        profileUpdates[field] = updates[field];
      }
    });
    
    if (Object.keys(profileUpdates).length > 0) {
      profileUpdates.lastProfileUpdate = new Date();
    }
    
    return profileUpdates;
  }

  prepareDatingUserUpdates(updates) {
    const datingUpdates = {};
    
    const datingFields = [
      'datingPreferences', 'datingNotificationSettings', 'datingPrivacySettings',
      'incognitoMode', 'travelMode', 'boost'
    ];
    
    datingFields.forEach(field => {
      if (updates[field] !== undefined) {
        datingUpdates[field] = updates[field];
      }
    });
    
    return datingUpdates;
  }

  mergeSettings(existing = {}, updates = {}) {
    // Deep merge for nested objects
    const result = { ...existing };
    
    Object.keys(updates).forEach(key => {
      if (typeof updates[key] === 'object' && updates[key] !== null && !Array.isArray(updates[key])) {
        result[key] = this.mergeSettings(existing[key] || {}, updates[key]);
      } else {
        result[key] = updates[key];
      }
    });
    
    return result;
  }

  // Check if updates contain dating-specific fields
  hasDatingUpdates(updates) {
    const datingFields = [
      'datingPreferences', 'datingNotificationSettings', 'datingPrivacySettings',
      'incognitoMode', 'travelMode', 'boost'
    ];
    
    return Object.keys(updates).some(key => datingFields.includes(key));
  }

  // Check if updates contain profile fields
  hasProfileUpdates(updates) {
    const profileFields = [
      'userName', 'bio', 'profilePicture', 'dateOfBirth', 'gender',
      'height', 'countryOfOrigin', 'homeLanguage', 'religion', 'servingAs',
      'relationshipStatus', 'lookingFor', 'haveChildren', 'wantsChildren',
      'education', 'occupation', 'income', 'hobbies', 'languages', 'lifestyle',
      'matchPreferences', 'location', 'datingProfile'
    ];
    
    return Object.keys(updates).some(key => profileFields.includes(key));
  }

  // Validate location coordinates
  validateLocation(location) {
    if (!location || !location.coordinates || !Array.isArray(location.coordinates)) {
      return false;
    }
    
    const [longitude, latitude] = location.coordinates;
    
    if (typeof longitude !== 'number' || typeof latitude !== 'number') {
      return false;
    }
    
    if (longitude < -180 || longitude > 180) {
      return false;
    }
    
    if (latitude < -90 || latitude > 90) {
      return false;
    }
    
    return true;
  }
}

module.exports = UserValidationService;