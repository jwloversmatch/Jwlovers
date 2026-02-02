const { BaseUser, UserQuery, ROLES } = require('@models/User');
const logger = require('@utils/logger');
const UserFormatterService = require('./UserFormatterService');

class UserAdminService {
  constructor() {
    this.formatterService = new UserFormatterService();
  }

  async changeUserRole(req, res, controller) {
    const { userId, newRole } = req.body;
    const adminUser = req.user;

    if (!adminUser) {
      return controller.errorResponse(res, 401, "Authentication required", {
        code: "AUTH_REQUIRED",
        requestId: req.requestId
      });
    }

    // Only admins can change roles
    if (!adminUser.isAdminUser) {
      return controller.errorResponse(res, 403, "Insufficient permissions to change user roles", {
        code: "PERMISSION_DENIED",
        requestId: req.requestId
      });
    }

    if (!userId || !newRole) {
      return controller.errorResponse(res, 400, "User ID and new role are required", {
        code: "MISSING_FIELDS",
        requestId: req.requestId
      });
    }

    // Validate role
    const validRoles = Object.values(ROLES);
    if (!validRoles.includes(newRole)) {
      return controller.errorResponse(res, 400, `Role must be one of: ${validRoles.join(', ')}`, {
        code: "INVALID_ROLE",
        requestId: req.requestId
      });
    }

    // Cannot change own role
    if (userId === adminUser._id.toString()) {
      return controller.errorResponse(res, 400, "Cannot change your own role", {
        code: "SELF_ROLE_CHANGE",
        requestId: req.requestId
      });
    }

    // Get target user
    const targetUser = await BaseUser.findById(userId);
    if (!targetUser) {
      return controller.errorResponse(res, 404, "User not found", {
        code: "USER_NOT_FOUND",
        requestId: req.requestId
      });
    }

    const oldRole = targetUser.role;
    const oldUserType = targetUser.userType;

    logger.warn('User role change requested', {
      targetUserId: userId,
      oldRole,
      newRole,
      changedBy: adminUser._id,
      changedByEmail: adminUser.email,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId
    });

    return controller.successResponse(res, 200, {
      userId,
      oldRole,
      newRole,
      note: "Role change logged. Actual role change implementation pending."
    }, "Role change request logged", {
      requestId: req.requestId
    });
  }

  async getUsers(req, res, controller) {
    const requestingUser = req.user;
    
    if (!requestingUser) {
      return controller.errorResponse(res, 401, "Authentication required", {
        code: "AUTH_REQUIRED",
        requestId: req.requestId
      });
    }

    const { 
      role, 
      page = 1, 
      limit = 20, 
      search,
      accountStatus,
      department 
    } = req.query;

    // Check permissions based on role
    if (role && role !== ROLES.USER && !requestingUser.isAdminUser) {
      return controller.errorResponse(res, 403, "Insufficient permissions to view staff", {
        code: "PERMISSION_DENIED",
        requestId: req.requestId
      });
    }

    let users;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    if (role === ROLES.USER) {
      // Get dating users
      users = await UserQuery.findDatingUsers({
        limit: parseInt(limit),
        skip,
        search
      });
    } else if (role && [ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(role)) {
      // Get staff users (admins only)
      if (!requestingUser.isAdminUser) {
        return controller.errorResponse(res, 403, "Insufficient permissions", {
          code: "PERMISSION_DENIED",
          requestId: req.requestId
        });
      }
      
      users = await UserQuery.findStaff({
        role,
        limit: parseInt(limit),
        skip,
        department,
        accountStatus
      });
    } else {
      // Get all users (admins only with proper filtering)
      if (!requestingUser.isAdminUser) {
        return controller.errorResponse(res, 403, "Insufficient permissions", {
          code: "PERMISSION_DENIED",
          requestId: req.requestId
        });
      }

      const query = {};
      if (search) {
        query.$or = [
          { email: { $regex: search, $options: 'i' } },
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
          { userName: { $regex: search, $options: 'i' } }
        ];
      }

      if (accountStatus) {
        query.accountStatus = accountStatus;
      }

      users = await BaseUser.find(query)
        .select('firstName lastName email userName role userType accountStatus createdAt lastActive department employeeId')
        .limit(parseInt(limit))
        .skip(skip)
        .sort({ createdAt: -1 });
    }

    return controller.successResponse(res, 200, {
      users: users.map(user => this.formatterService.formatUserListData(user)),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: users.length === parseInt(limit)
      }
    }, null, {
      requestId: req.requestId
    });
  }
}

module.exports = UserAdminService;