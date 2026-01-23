const { BaseUser, DatingUser, UserQuery, ROLES } = require("@models/User");
const logger = require("@utils/logger");

class AuthorizationMiddleware {
  // Role-based authorization
  authorize(...allowedRoles) {
    return (req, res, next) => {
      if (!req.user) {
        return this.unauthorized(res, "Authentication required.");
      }

      if (!req.user.role) {
        return this.forbidden(res, "User role not defined.");
      }

      if (!allowedRoles.includes(req.user.role)) {
        this.logUnauthorizedAccess(req, allowedRoles);
        return this.forbidden(
          res,
          `Access denied. ${req.user.role} role cannot perform this action.`,
          { 
            requiredRoles: allowedRoles, 
            userRole: req.user.role,
            userType: req.user.userType 
          }
        );
      }

      next();
    };
  }

  // User type-based authorization
  authorizeUserType(...allowedUserTypes) {
    return (req, res, next) => {
      if (!req.user) {
        return this.unauthorized(res, "Authentication required.");
      }

      if (!req.user.userType) {
        return this.forbidden(res, "User type not defined.");
      }

      if (!allowedUserTypes.includes(req.user.userType)) {
        this.logUnauthorizedAccess(req, allowedUserTypes, 'userType');
        return this.forbidden(
          res,
          `Access denied. ${req.user.userType} users cannot perform this action.`,
          { 
            requiredUserTypes: allowedUserTypes, 
            userType: req.user.userType,
            userRole: req.user.role 
          }
        );
      }

      next();
    };
  }

  // Admin only (Admin or SuperAdmin)
  adminOnly(req, res, next) {
    return this.authorizeUserType("Admin", "SuperAdmin")(req, res, next);
  }

  // Staff only (Moderator, Admin, SuperAdmin)
  staffOnly(req, res, next) {
    return this.authorizeUserType("Moderator", "Admin", "SuperAdmin")(req, res, next);
  }

  // Dating users only
  datingUsersOnly(req, res, next) {
    return this.authorizeUserType("DatingUser")(req, res, next);
  }

  // Moderator only
  moderatorOnly(req, res, next) {
    return this.authorizeUserType("Moderator")(req, res, next);
  }

  // Super Admin only
  superAdminOnly(req, res, next) {
    return this.authorizeUserType("SuperAdmin")(req, res, next);
  }

  // Verified users only (email verification)
  async verifiedOnly(req, res, next) {
    try {
      if (!req.user) {
        return this.unauthorized(res, "Authentication required.");
      }

      if (!req.user.emailVerified) {
        return this.forbidden(
          res,
          "Account verification required. Please verify your email."
        );
      }

      next();
    } catch (error) {
      logger.error("VerifiedOnly middleware error:", error);
      return this.serverError(res, "Verification check failed.");
    }
  }

  // Age verified for dating users
  async ageVerified(req, res, next) {
    try {
      if (!req.user) {
        return this.unauthorized(res, "Authentication required.");
      }

      if (req.user.userType !== 'DatingUser') {
        return next(); // Age verification only applies to dating users
      }

      if (!req.user.ageVerified || !req.user.dateOfBirth) {
        return this.forbidden(
          res,
          "Age verification required. Please update your profile with your date of birth."
        );
      }

      // Calculate age
      const age = this.calculateAge(new Date(req.user.dateOfBirth));
      if (age < 18) {
        return this.forbidden(
          res,
          "You must be 18 years or older to access this feature."
        );
      }

      next();
    } catch (error) {
      logger.error("AgeVerified middleware error:", error);
      return this.serverError(res, "Age verification check failed.");
    }
  }

  // Active account check
  async activeAccount(req, res, next) {
    try {
      if (!req.user) {
        return this.unauthorized(res, "Authentication required.");
      }

      if (req.user.accountStatus !== 'active') {
        return this.forbidden(
          res,
          `Your account is ${req.user.accountStatus}. Please contact support.`,
          { accountStatus: req.user.accountStatus }
        );
      }

      next();
    } catch (error) {
      logger.error("ActiveAccount middleware error:", error);
      return this.serverError(res, "Account status check failed.");
    }
  }

  // Permission-based authorization
  requirePermission(...requiredPermissions) {
    return async (req, res, next) => {
      try {
        if (!req.user) {
          return this.unauthorized(res, "Authentication required.");
        }

        // Only staff users have permissions
        if (!['Moderator', 'Admin', 'SuperAdmin'].includes(req.user.userType)) {
          return this.forbidden(
            res,
            "Permissions are only available for staff users."
          );
        }

        // Fetch user with permissions if not already in req.user
        if (!req.user.permissions) {
          const user = await UserQuery.getUserById(req.user.id);
          if (!user) {
            return this.forbidden(res, "User not found.");
          }
          req.user.permissions = user.permissions || [];
        }

        const hasAllPermissions = requiredPermissions.every(permission =>
          req.user.permissions.includes(permission)
        );

        if (!hasAllPermissions) {
          this.logUnauthorizedAccess(req, requiredPermissions, 'permissions');
          return this.forbidden(
            res,
            "Insufficient permissions to perform this action.",
            { 
              requiredPermissions,
              userPermissions: req.user.permissions 
            }
          );
        }

        next();
      } catch (error) {
        logger.error("RequirePermission middleware error:", error);
        return this.serverError(res, "Permission check failed.");
      }
    };
  }

  // Department-based authorization
  requireDepartment(...allowedDepartments) {
    return async (req, res, next) => {
      try {
        if (!req.user) {
          return this.unauthorized(res, "Authentication required.");
        }

        // Only staff users have departments
        if (!['Moderator', 'Admin', 'SuperAdmin'].includes(req.user.userType)) {
          return this.forbidden(
            res,
            "Department checks are only for staff users."
          );
        }

        // Fetch user with department if not already in req.user
        if (!req.user.department) {
          const user = await UserQuery.getUserById(req.user.id);
          if (!user) {
            return this.forbidden(res, "User not found.");
          }
          req.user.department = user.department;
        }

        if (!allowedDepartments.includes(req.user.department)) {
          this.logUnauthorizedAccess(req, allowedDepartments, 'department');
          return this.forbidden(
            res,
            "Access denied. Your department cannot perform this action.",
            { 
              allowedDepartments,
              userDepartment: req.user.department 
            }
          );
        }

        next();
      } catch (error) {
        logger.error("RequireDepartment middleware error:", error);
        return this.serverError(res, "Department check failed.");
      }
    };
  }

  // Check if user can access another user's data
  canAccessUserData(targetUserIdField = 'userId') {
    return (req, res, next) => {
      if (!req.user) {
        return this.unauthorized(res, "Authentication required.");
      }

      const targetUserId = req.params[targetUserIdField] || req.body[targetUserIdField];
      
      if (!targetUserId) {
        return this.forbidden(res, "Target user ID not specified.");
      }

      // Users can always access their own data
      if (req.user.id === targetUserId) {
        return next();
      }

      // Admins and SuperAdmins can access any user data
      if (req.user.userType === 'Admin' || req.user.userType === 'SuperAdmin') {
        return next();
      }

      // Moderators can access dating user data
      if (req.user.userType === 'Moderator') {
        // Check if target user is a dating user
        // In production, you'd fetch the target user to check their type
        // For now, assume dating users for /users/:userId routes
        if (req.path.includes('/users/') || req.path.includes('/profiles/')) {
          return next();
        }
      }

      // Dating users cannot access other users' data
      return this.forbidden(
        res,
        "Access denied. You can only access your own data."
      );
    };
  }

  // Check if dating user can message another user
  async canMessageUser(targetUserIdField = 'receiverId') {
    return async (req, res, next) => {
      try {
        if (!req.user) {
          return this.unauthorized(res, "Authentication required.");
        }

        if (req.user.userType !== 'DatingUser') {
          return this.forbidden(
            res,
            "Only dating users can send messages."
          );
        }

        const targetUserId = req.params[targetUserIdField] || req.body[targetUserIdField];
        
        if (!targetUserId) {
          return this.forbidden(res, "Target user ID not specified.");
        }

        // Users can't message themselves
        if (req.user.id === targetUserId) {
          return this.forbidden(res, "Cannot send messages to yourself.");
        }

        // Check if target user exists and is a dating user
        const targetUser = await UserQuery.getUserById(targetUserId);
        if (!targetUser) {
          return this.forbidden(res, "Target user not found.");
        }

        if (targetUser.userType !== 'DatingUser') {
          return this.forbidden(
            res,
            "Cannot send messages to staff users."
          );
        }

        // Check messaging preferences
        if (req.user.messagingPreferences === 'disabled') {
          return this.forbidden(
            res,
            "Your messaging is disabled."
          );
        }

        if (req.user.messagingPreferences === 'matches_only') {
          // Check if users are matched (you'd need to implement this check)
          const areMatched = await this.checkIfUsersAreMatched(req.user.id, targetUserId);
          if (!areMatched) {
            return this.forbidden(
              res,
              "You can only message users you've matched with."
            );
          }
        }

        if (req.user.messagingPreferences === 'friends_only') {
          // Check if users are contacts (you'd need to implement this check)
          const areContacts = await this.checkIfUsersAreContacts(req.user.id, targetUserId);
          if (!areContacts) {
            return this.forbidden(
              res,
              "You can only message users in your contacts."
            );
          }
        }

        next();
      } catch (error) {
        logger.error("CanMessageUser middleware error:", error);
        return this.serverError(res, "Message permission check failed.");
      }
    };
  }

  // Helper methods
  calculateAge(birthDate) {
    if (!birthDate) return 0;
    
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  }

  async checkIfUsersAreMatched(userId1, userId2) {
    // Implement match checking logic
    // This would query your Match model
    return false; // Placeholder
  }

  async checkIfUsersAreContacts(userId1, userId2) {
    // Implement contact checking logic
    // This would query your UserContact model
    return false; // Placeholder
  }

  unauthorized(res, message) {
    return res.status(401).json({
      success: false,
      error: message,
      code: "UNAUTHORIZED",
      timestamp: new Date().toISOString()
    });
  }

  forbidden(res, message, details = {}) {
    return res.status(403).json({
      success: false,
      error: message,
      code: "FORBIDDEN",
      ...details,
      timestamp: new Date().toISOString()
    });
  }

  serverError(res, message) {
    return res.status(500).json({
      success: false,
      error: message,
      code: "INTERNAL_ERROR",
      timestamp: new Date().toISOString()
    });
  }

  logUnauthorizedAccess(req, allowedItems, type = 'role') {
    const logData = {
      userId: req.user.id,
      userRole: req.user.role,
      userType: req.user.userType,
      path: req.path,
      method: req.method,
      ip: req.ip
    };

    if (type === 'role') {
      logData.requiredRoles = allowedItems;
      logData.userRole = req.user.role;
    } else if (type === 'userType') {
      logData.requiredUserTypes = allowedItems;
      logData.userType = req.user.userType;
    } else if (type === 'permissions') {
      logData.requiredPermissions = allowedItems;
      logData.userPermissions = req.user.permissions;
    } else if (type === 'department') {
      logData.allowedDepartments = allowedItems;
      logData.userDepartment = req.user.department;
    }

    logger.warn("Unauthorized access attempt", logData);
  }
}

module.exports = new AuthorizationMiddleware();