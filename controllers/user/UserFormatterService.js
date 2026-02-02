class UserFormatterService {
  formatUserData(user) {
    const baseData = {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      avatar: user.avatar,
      accountStatus: user.accountStatus,
      role: user.role,
      userType: user.userType,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      lastLogin: user.lastLogin,
      lastSeen: user.presence?.lastSeen,
      presence: user.presence,
      notificationSettings: user.notificationSettings || {},
      privacySettings: user.privacySettings || {},
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt
    };

    // Add role-specific data
    if (user.role === 'USER') {
      baseData.age = user.age;
      baseData.userName = user.userName;
      baseData.dateOfBirth = user.dateOfBirth;
      baseData.preferences = user.preferences;
      baseData.location = user.location ? {
        city: user.location.city,
        country: user.location.country
      } : null;
      baseData.sharePhone = user.sharePhone;
      baseData.messagingPreferences = user.messagingPreferences;
    } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
      baseData.employeeId = user.employeeId;
      baseData.department = user.department;
      baseData.staffNotificationSettings = user.staffNotificationSettings || {};
    }

    return baseData;
  }

  formatUserListData(user) {
    const baseData = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      userType: user.userType,
      accountStatus: user.accountStatus,
      createdAt: user.createdAt,
      lastActive: user.lastActive || user.presence?.lastActive
    };

    if (user.role === 'USER') {
      baseData.userName = user.userName;
      baseData.age = user.age;
      baseData.avatar = user.avatar;
    } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
      baseData.employeeId = user.employeeId;
      baseData.department = user.department;
    }

    return baseData;
  }

  formatProfileData(profile) {
    return {
      id: profile._id,
      userId: profile.userId,
      profilePicture: profile.profilePicture,
      bio: profile.bio,
      profileCompletion: profile.profileCompletion || 0,
      isVerified: profile.isVerified || false,
      isActive: profile.isActive !== false,
      lastUpdated: profile.lastUpdated,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    };
  }
}

module.exports = UserFormatterService;