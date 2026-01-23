// utils/AuthHelpers.js
const { ROLES } = require("@models/User");

class AuthHelpers {
  formatUserResponse(user) {
    if (!user) return null;

    if (user._id && typeof user._id === "object" && !user.email) {
      return { id: user._id.toString() };
    }

    const isAdmin = user.role === ROLES.ADMIN;
    const isSuperAdmin = user.role === ROLES.SUPER_ADMIN;
    const isStaff = user.role !== ROLES.USER;
    const isActive = ["active", "pending_verification"].includes(user.accountStatus);

    const baseData = {
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      userName: user.userName,
      role: user.role,
      userType: user.userType,
      emailVerified: user.emailVerified,
      accountStatus: user.accountStatus,
      presence: user.presence || {},
      isStaff,
      isAdmin,
      isSuperAdmin,
      isActive,
      fullName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    // Compute age if dateOfBirth exists
    if (user.dateOfBirth) {
      const today = new Date();
      const birthDate = new Date(user.dateOfBirth);
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      baseData.age = age;
    } else {
      baseData.age = null;
    }

    // Add role-specific data
    let finalData;

    if (user.userType === "DatingUser") {
      finalData = {
        ...baseData,
        avatar: user.avatar,
        preferences: user.preferences,
        location: user.location ? { city: user.location.city, country: user.location.country } : null,
        phoneVerified: user.phoneVerified,
      };
    } else if (["Moderator", "Admin", "SuperAdmin"].includes(user.userType)) {
      finalData = {
        ...baseData,
        employeeId: user.employeeId,
        department: user.department,
        jobTitle: user.jobTitle || "",
        workStats: user.workStats || {
          casesResolved: 0,
          casesEscalated: 0,
          averageResolutionTime: 0,
          responseTime: 0,
          lastActiveShift: null,
          totalShiftHours: 0,
          performanceScore: 0,
        },
        hireDate: user.hireDate,
        accessLevel: user.accessLevel,
        managedUsers: user.managedUsers || [],
        isOnShift: user.isOnShift || false,
        totalManagedUsers: user.totalManagedUsers || 0,
        activeCases: user.activeCases || 0,
        isSeniorStaff: user.isSeniorStaff || false,
      };
    } else {
      finalData = baseData;
    }

    // Remove legacy fields
    delete finalData.isAdminUser;
    delete finalData.isSuperAdminUser;

    return finalData;
  }

  getRolePermissions(role) {
    const permissions = {
      [ROLES.USER]: ["read_own_profile", "update_own_profile", "view_matches", "send_messages", "like_profiles", "update_own_settings"],
      [ROLES.MODERATOR]: ["view_all_profiles", "suspend_users", "review_reports", "remove_content", "manage_user_content"],
      [ROLES.ADMIN]: ["create_moderators", "manage_all_users", "view_analytics", "configure_system", "manage_user_roles"],
      [ROLES.SUPER_ADMIN]: ["create_admins", "manage_admins", "system_configuration", "database_operations", "view_audit_logs", "full_system_access"],
    };

    return permissions[role] || [];
  }

  getRoleFeatures(role) {
    const features = {
      [ROLES.USER]: ["dating_profile", "matching", "messaging", "likes", "profile_customization"],
      [ROLES.MODERATOR]: ["moderation_dashboard", "report_management", "content_moderation", "user_suspension", "moderation_tools"],
      [ROLES.ADMIN]: ["admin_dashboard", "user_management", "system_settings", "analytics", "role_management", "option_management"],
      [ROLES.SUPER_ADMIN]: ["full_system_access", "database_management", "security_settings", "audit_logs", "admin_management", "system_backup"],
    };

    return features[role] || [];
  }

  getWelcomeMessage(user) {
    const messages = {
      [ROLES.USER]: user.emailVerified ? "Login successful" : "Login successful. Please verify your email.",
      [ROLES.MODERATOR]: "Welcome back, Moderator!",
      [ROLES.ADMIN]: "Welcome back, Administrator!",
      [ROLES.SUPER_ADMIN]: "Welcome back, Super Administrator!",
    };

    return messages[user.role] || "Login successful";
  }

  setAuthCookies(res, accessToken, refreshToken) {
    const isProduction = process.env.NODE_ENV === "production";

    const commonOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "strict" : "lax",
      path: "/",
    };

    res.cookie("accessToken", accessToken, { ...commonOptions, maxAge: 15 * 60 * 1000 });
    res.cookie("refreshToken", refreshToken, { ...commonOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
  }

  clearAuthCookies(res) {
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
  }

  async logSecurityEvent(userId, eventType, metadata = {}) {
    try {
      const logEntry = {
        userId,
        eventType,
        timestamp: new Date(),
        ip: metadata.ip || "unknown",
        userAgent: metadata.userAgent || "unknown",
        metadata,
      };

      console.info(`[SECURITY] ${eventType} for user ${userId}`, logEntry);
      return true;
    } catch (error) {
      console.error("Failed to log security event:", error);
      return false;
    }
  }
}

module.exports = new AuthHelpers();