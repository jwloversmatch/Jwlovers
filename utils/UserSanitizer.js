// utils/UserSanitizer.js
const { ROLES } = require("@models/User");

class UserSanitizer {
  sanitizeUser(user) {
    if (!user) return null;
    
    const sanitized = {
      _id: user._id,
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      userName: user.userName,
      avatar: user.avatar,
      role: user.role || 'user',
      userType: user.userType || 'user',
      accountStatus: user.accountStatus || 'active',
      emailVerified: user.emailVerified || false,
      phoneVerified: user.phoneVerified || false,
      lastSeen: user.presence?.lastSeen,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      privacySettings: user.privacySettings || {
        profileVisibility: 'public',
        showOnlineStatus: true
      },
      isStaff: user.role !== ROLES.USER,
      isAdmin: user.role === ROLES.ADMIN || user.role === ROLES.SUPER_ADMIN,
      isSuperAdmin: user.role === ROLES.SUPER_ADMIN
    };
    
    // Add role-specific data
    if (user.userType === 'DatingUser') {
      sanitized.ageVerified = user.ageVerified || false;
      sanitized.age = user.age;
      sanitized.datingPrivacySettings = user.datingPrivacySettings || {
        showLastSeen: 'everyone',
        allowMessagesFrom: 'everyone'
      };
      sanitized.messagingPreferences = user.messagingPreferences || 'everyone';
    } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
      sanitized.employeeId = user.employeeId;
      sanitized.department = user.department;
      sanitized.staffNotificationSettings = user.staffNotificationSettings || {};
    }
    
    // Apply privacy settings
    if (sanitized.privacySettings && !sanitized.privacySettings.showOnlineStatus) {
      delete sanitized.lastSeen;
      delete sanitized.lastLogin;
    }
    
    return sanitized;
  }
}

module.exports = new UserSanitizer();