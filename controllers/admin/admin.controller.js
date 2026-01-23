const Option = require('@models/Option.model');
const SecurityQuestion = require('@models/SecurityQuestion');
const { 
  BaseUser, 
  DatingUser, 
  Moderator, 
  Admin, 
  SuperAdmin,
  UserService,
  UserQuery,
  ROLES 
} = require('@models/User');
const optionService = require('@services/option.service');

class AdminController {
  // ============ DASHBOARD & METRICS ============
  
  async getAdminDashboard(req, res) {
    try {
      // Get real statistics with user type consideration
      const [
        totalUsers,
        datingUsers,
        staffUsers,
        activeUsers,
        newUsersToday,
        totalReports,
        totalOptions,
        totalQuestions
      ] = await Promise.all([
        BaseUser.countDocuments(),
        BaseUser.countDocuments({ userType: 'DatingUser' }),
        BaseUser.countDocuments({ 
          userType: { $in: ['Moderator', 'Admin', 'SuperAdmin'] } 
        }),
        BaseUser.countDocuments({ accountStatus: 'active' }),
        BaseUser.countDocuments({
          createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        }),
        // Report count would come from Report model
        Promise.resolve(0),
        Option.countDocuments({ isActive: true }),
        SecurityQuestion.countDocuments({ isActive: true })
      ]);
      
      // Get recent activity with user type
      const recentUsers = await BaseUser.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select('firstName lastName email role userType createdAt');
      
      const recentActivity = await BaseUser.find({
        'presence.lastSeen': { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      })
        .sort({ 'presence.lastSeen': -1 })
        .limit(10)
        .select('firstName lastName email role userType presence.lastSeen');
      
      res.json({
        success: true,
        message: 'Admin dashboard',
        user: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
          userType: req.user.userType
        },
        timestamp: new Date().toISOString(),
        stats: {
          totalUsers,
          byType: {
            datingUsers,
            staffUsers: {
              total: staffUsers,
              moderators: await BaseUser.countDocuments({ userType: 'Moderator' }),
              admins: await BaseUser.countDocuments({ userType: 'Admin' }),
              superAdmins: await BaseUser.countDocuments({ userType: 'SuperAdmin' })
            }
          },
          activeUsers,
          newUsersToday,
          totalReports,
          totalOptions,
          totalSecurityQuestions: totalQuestions,
          systemHealth: 'operational'
        },
        recentUsers,
        recentActivity
      });
    } catch (error) {
      console.error('Dashboard error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to load dashboard data'
      });
    }
  }
  
  async getDashboardMetrics(req, res) {
    try {
      const [
        totalUsers,
        datingUsers,
        staffUsers,
        activeUsers,
        newUsersToday,
        totalOptions,
        totalQuestions
      ] = await Promise.all([
        BaseUser.countDocuments(),
        BaseUser.countDocuments({ userType: 'DatingUser' }),
        BaseUser.countDocuments({ 
          userType: { $in: ['Moderator', 'Admin', 'SuperAdmin'] } 
        }),
        BaseUser.countDocuments({ accountStatus: 'active' }),
        BaseUser.countDocuments({
          createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        }),
        Option.countDocuments({ isActive: true }),
        SecurityQuestion.countDocuments({ isActive: true })
      ]);
      
      res.json({
        success: true,
        metrics: {
          totalUsers,
          datingUsers,
          staffUsers,
          activeUsers,
          newUsersToday,
          totalOptions,
          totalSecurityQuestions: totalQuestions,
          systemHealth: 'operational'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Metrics error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to load metrics'
      });
    }
  }
  
  // ============ USER MANAGEMENT ============
  
  async getAllUsers(req, res) {
    try {
      const { page = 1, limit = 50, role, userType, status } = req.query;
      
      const query = {};
      if (role) query.role = role;
      if (userType) query.userType = userType;
      if (status) query.accountStatus = status;
      
      // Security: Regular admins cannot see other admins/super_admins
      if (req.user.role === ROLES.ADMIN) {
        query.role = { $in: [ROLES.USER, ROLES.MODERATOR] };
        query.userType = { $in: ['DatingUser', 'Moderator'] };
      }
      
      const users = await BaseUser.find(query)
        .select('firstName lastName email userName avatar role userType accountStatus createdAt lastActive')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));
      
      const total = await BaseUser.countDocuments(query);
      
      res.json({
        success: true,
        count: users.length,
        total,
        users: users.map(user => this.formatAdminUserList(user)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get all users error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve users'
      });
    }
  }
  
  async getUserById(req, res) {
    try {
      const user = await BaseUser.findById(req.params.id)
        .select('-password -refreshToken -passwordHistory -failedLoginAttempts -accountLockedUntil');
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      // Security: Check permissions
      if (req.user.role === ROLES.ADMIN && 
          (user.role === ROLES.ADMIN || user.role === ROLES.SUPER_ADMIN) &&
          !user._id.equals(req.user._id)) {
        return res.status(403).json({
          success: false,
          error: 'Cannot view other admin profiles'
        });
      }
      
      res.json({
        success: true,
        user: this.formatAdminUserDetail(user)
      });
    } catch (error) {
      console.error('Get user by ID error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve user'
      });
    }
  }
  
  async updateUserRole(req, res) {
    try {
      const { role, reason, employeeId, department } = req.body;
      const userId = req.params.id;
      
      // Cannot modify your own role
      if (userId === req.user.id) {
        return res.status(400).json({
          success: false,
          error: 'Cannot modify your own role'
        });
      }
      
      const user = await BaseUser.findById(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      // Cannot modify super_admin unless you're super_admin
      if (user.role === ROLES.SUPER_ADMIN && req.user.role !== ROLES.SUPER_ADMIN) {
        return res.status(403).json({
          success: false,
          error: 'Cannot modify super admin role'
        });
      }
      
      // Cannot modify admin unless you're super_admin
      if (user.role === ROLES.ADMIN && req.user.role !== ROLES.SUPER_ADMIN) {
        return res.status(403).json({
          success: false,
          error: 'Only super admin can modify admin roles'
        });
      }
      
      // Cannot assign role higher than your own
      const roleHierarchy = BaseUser.getRoleHierarchy ? BaseUser.getRoleHierarchy() : {
        [ROLES.USER]: 0,
        [ROLES.MODERATOR]: 1,
        [ROLES.ADMIN]: 2,
        [ROLES.SUPER_ADMIN]: 3
      };
      
      const userLevel = roleHierarchy[req.user.role] || 0;
      const targetLevel = roleHierarchy[role] || 0;
      
      if (targetLevel >= userLevel) {
        return res.status(403).json({
          success: false,
          error: 'Cannot assign role equal to or higher than your own'
        });
      }

      const oldRole = user.role;
      
      // Handle role promotion/demotion with document type change
      if (role !== oldRole) {
        await this.changeUserRole(user, role, { employeeId, department });
      } else {
        // Update within same role
        if (role !== ROLES.USER && employeeId) {
          user.employeeId = employeeId;
        }
        if (role !== ROLES.USER && department) {
          user.department = department;
        }
        await user.save();
      }
      
      // Log admin action
      if (typeof user.logAdminAction === 'function') {
        await user.logAdminAction(`role_change:${oldRole}_to_${role}`, req.user, reason);
      }
      
      res.json({
        success: true,
        message: `User role updated from ${oldRole} to ${role}`,
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          userType: user.userType,
          accountStatus: user.accountStatus
        }
      });
    } catch (error) {
      console.error('Update user role error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to update user role'
      });
    }
  }

  // Helper method to change user role (with document type change)
  async changeUserRole(user, newRole, staffData = {}) {
    const oldUserType = user.userType;
    const oldModel = this.getUserModelByType(oldUserType);
    
    // Determine new user type
    let newUserType;
    switch(newRole) {
      case ROLES.USER:
        newUserType = 'DatingUser';
        break;
      case ROLES.MODERATOR:
        newUserType = 'Moderator';
        break;
      case ROLES.ADMIN:
        newUserType = 'Admin';
        break;
      case ROLES.SUPER_ADMIN:
        newUserType = 'SuperAdmin';
        break;
      default:
        throw new Error(`Invalid role: ${newRole}`);
    }

    // If changing to staff role, require employee data
    if (newRole !== ROLES.USER && (!staffData.employeeId || !staffData.department)) {
      throw new Error('Employee ID and department are required for staff roles');
    }

    // Delete old document
    await oldModel.findByIdAndDelete(user._id);

    // Create new document with appropriate model
    const commonData = user.toObject();
    delete commonData._id;
    delete commonData.__v;
    delete commonData.userType;

    const newUserData = {
      ...commonData,
      _id: user._id,
      role: newRole,
      userType: newUserType
    };

    // Add role-specific data
    if (newRole === ROLES.USER) {
      // Add dating user defaults if missing
      newUserData.preferences = user.preferences || {
        lookingFor: ["dating"],
        ageRange: { min: 18, max: 100 },
        distance: 50,
        interests: []
      };
      newUserData.messagingPreferences = user.messagingPreferences || 'everyone';
    } else {
      // Add staff user data
      newUserData.employeeId = staffData.employeeId;
      newUserData.department = staffData.department;
      newUserData.permissions = staffData.permissions || [];
      newUserData.staffNotificationSettings = user.staffNotificationSettings || {
        userReports: 'assigned',
        systemAlerts: true,
        adminAnnouncements: true,
        shiftReminders: true,
        caseUpdates: true,
        teamMessages: true
      };
      // Add complete work stats
      newUserData.workStats = {
        casesResolved: 0,
        casesEscalated: 0,
        averageResolutionTime: 0,
        responseTime: 0,
        lastActiveShift: null,
        totalShiftHours: 0,
        performanceScore: 0
      };
    }

    const NewModel = this.getUserModelByType(newUserType);
    await NewModel.create(newUserData);
  }

  // Helper to get model by user type
  getUserModelByType(userType) {
    switch(userType) {
      case 'DatingUser':
        return DatingUser;
      case 'Moderator':
        return Moderator;
      case 'Admin':
        return Admin;
      case 'SuperAdmin':
        return SuperAdmin;
      default:
        return BaseUser;
    }
  }
  
  async updateUserStatus(req, res) {
    try {
      const { status, reason } = req.body;
      const userId = req.params.id;
      
      const user = await BaseUser.findById(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      // Check permissions based on target user's role
      if (user.role === ROLES.SUPER_ADMIN && req.user.role !== ROLES.SUPER_ADMIN) {
        return res.status(403).json({
          success: false,
          error: 'Cannot modify super admin status'
        });
      }
      
      if (user.role === ROLES.ADMIN && req.user.role !== ROLES.SUPER_ADMIN) {
        return res.status(403).json({
          success: false,
          error: 'Only super admin can modify admin status'
        });
      }
      
      // Cannot modify your own status
      if (userId === req.user.id && status !== 'active') {
        return res.status(400).json({
          success: false,
          error: 'Cannot deactivate/suspend your own account'
        });
      }
      
      const oldStatus = user.accountStatus;
      
      // Use changeStatus method if available
      if (typeof user.changeStatus === 'function') {
        await user.changeStatus(status, req.user, reason);
      } else {
        // Fallback: update directly
        user.accountStatus = status;
        
        // Add to history if field exists
        if (user.statusChangeHistory) {
          user.statusChangeHistory.push({
            from: oldStatus,
            to: status,
            changedBy: req.user._id,
            reason,
            timestamp: new Date()
          });
        }
        
        await user.save();
      }
      
      res.json({
        success: true,
        message: `User status updated from ${oldStatus} to ${status}`,
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          userType: user.userType,
          accountStatus: user.accountStatus
        }
      });
    } catch (error) {
      console.error('Update user status error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to update user status'
      });
    }
  }
  
  async searchUsers(req, res) {
    try {
      const { query, role, userType, status, page = 1, limit = 20 } = req.query;
      
      const searchFilter = {};
      
      if (query) {
        searchFilter.$or = [
          { email: { $regex: query, $options: 'i' } },
          { firstName: { $regex: query, $options: 'i' } },
          { lastName: { $regex: query, $options: 'i' } },
          { userName: { $regex: query, $options: 'i' } },
          { employeeId: role !== ROLES.USER ? { $regex: query, $options: 'i' } : undefined }
        ].filter(condition => condition);
      }
      
      if (role) searchFilter.role = role;
      if (userType) searchFilter.userType = userType;
      if (status) searchFilter.accountStatus = status;
      
      // Security: Regular admins cannot see other admins/super_admins
      if (req.user.role === ROLES.ADMIN) {
        searchFilter.role = { $in: [ROLES.USER, ROLES.MODERATOR] };
        searchFilter.userType = { $in: ['DatingUser', 'Moderator'] };
      }
      
      const users = await BaseUser.find(searchFilter)
        .select('firstName lastName email userName avatar role userType accountStatus createdAt lastActive')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));
      
      const total = await BaseUser.countDocuments(searchFilter);
      
      res.json({
        success: true,
        count: users.length,
        total,
        users: users.map(user => this.formatAdminUserList(user)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Search users error:', error);
      res.status(500).json({
        success: false,
        error: 'Search failed'
      });
    }
  }
  
  async getUsersByRole(req, res) {
    try {
      const { role } = req.params;
      const { page = 1, limit = 50, status } = req.query;
      
      const query = { role };
      if (status) query.accountStatus = status;
      
      // Determine user type based on role
      let userType;
      switch(role) {
        case ROLES.USER:
          userType = 'DatingUser';
          break;
        case ROLES.MODERATOR:
          userType = 'Moderator';
          break;
        case ROLES.ADMIN:
          userType = 'Admin';
          break;
        case ROLES.SUPER_ADMIN:
          userType = 'SuperAdmin';
          break;
      }
      
      if (userType) {
        query.userType = userType;
      }
      
      const users = await BaseUser.find(query)
        .select('firstName lastName email userName avatar accountStatus createdAt lastActive')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));
      
      const total = await BaseUser.countDocuments(query);
      
      res.json({
        success: true,
        role,
        userType,
        count: users.length,
        total,
        users: users.map(user => this.formatAdminUserList(user)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get users by role error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to fetch users by role'
      });
    }
  }

  async getUsersByType(req, res) {
    try {
      const { userType } = req.params;
      const { page = 1, limit = 50, status } = req.query;
      
      const query = { userType };
      if (status) query.accountStatus = status;
      
      const users = await BaseUser.find(query)
        .select('firstName lastName email userName avatar role accountStatus createdAt lastActive')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));
      
      const total = await BaseUser.countDocuments(query);
      
      res.json({
        success: true,
        userType,
        count: users.length,
        total,
        users: users.map(user => this.formatAdminUserList(user)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get users by type error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to fetch users by type'
      });
    }
  }
  
  // ============ MODERATION TOOLS ============
  
  async getReports(req, res) {
    try {
      // This would typically fetch from a Report model
      res.json({
        success: true,
        reports: [],
        total: 0,
        message: 'Reports functionality not yet implemented'
      });
    } catch (error) {
      console.error('Get reports error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve reports'
      });
    }
  }
  
  async takeReportAction(req, res) {
    try {
      const { action, notes } = req.body;
      
      // This would typically update a Report model
      res.json({
        success: true,
        message: `Report ${req.params.id} action taken: ${action}`,
        action,
        notes
      });
    } catch (error) {
      console.error('Take report action error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to process report action'
      });
    }
  }
  
  async removeContent(req, res) {
    try {
      const { reason } = req.body;
      
      // This would typically remove content from appropriate model
      res.json({
        success: true,
        message: `Content ${req.params.id} removed`,
        reason,
        removedBy: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
          userType: req.user.userType
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Remove content error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to remove content'
      });
    }
  }
  
  // ============ OPTION MANAGEMENT ============
  
  async getOptions(req, res) {
    try {
      const { category, page = 1, limit = 50, search } = req.query;
      
      const query = { isActive: true };
      
      if (category) {
        query.category = category;
      }
      
      if (search) {
        query.$or = [
          { value: { $regex: search, $options: 'i' } },
          { label: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }
      
      const options = await Option.find(query)
        .sort({ category: 1, order: 1, label: 1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .populate('createdBy', 'firstName lastName email')
        .populate('updatedBy', 'firstName lastName email');
      
      const total = await Option.countDocuments(query);
      
      res.json({
        success: true,
        data: options,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get options error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve options'
      });
    }
  }
  
  async getOptionById(req, res) {
    try {
      const option = await Option.findById(req.params.id)
        .populate('createdBy', 'firstName lastName email')
        .populate('updatedBy', 'firstName lastName email');
      
      if (!option) {
        return res.status(404).json({
          success: false,
          error: 'Option not found'
        });
      }
      
      res.json({
        success: true,
        data: option
      });
    } catch (error) {
      console.error('Get option by ID error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve option'
      });
    }
  }
  
  async createOption(req, res) {
    try {
      // Add user info
      req.body.createdBy = req.userId;
      req.body.updatedBy = req.userId;
      
      const option = await Option.create(req.body);
      
      // Clear cache
      if (optionService && optionService.clearCache) {
        optionService.clearCache();
      }
      
      res.status(201).json({
        success: true,
        message: 'Option created successfully',
        data: option
      });
    } catch (error) {
      console.error('Create option error:', error);
      
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          error: 'Option with this value already exists in this category'
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Unable to create option'
      });
    }
  }
  
  async updateOption(req, res) {
    try {
      const { id } = req.params;
      
      // Add updatedBy
      req.body.updatedBy = req.userId;
      req.body.updatedAt = new Date();
      
      const option = await Option.findByIdAndUpdate(
        id,
        req.body,
        { new: true, runValidators: true }
      ).populate('updatedBy', 'firstName lastName email');
      
      if (!option) {
        return res.status(404).json({
          success: false,
          error: 'Option not found'
        });
      }
      
      // Clear cache
      if (optionService && optionService.clearCache) {
        optionService.clearCache();
      }
      
      res.json({
        success: true,
        message: 'Option updated successfully',
        data: option
      });
    } catch (error) {
      console.error('Update option error:', error);
      
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          error: 'Option with this value already exists in this category'
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Unable to update option'
      });
    }
  }
  
  async deleteOption(req, res) {
    try {
      const { id } = req.params;
      
      const option = await Option.findByIdAndUpdate(
        id,
        { 
          isActive: false,
          updatedBy: req.userId,
          updatedAt: new Date()
        },
        { new: true }
      );
      
      if (!option) {
        return res.status(404).json({
          success: false,
          error: 'Option not found'
        });
      }
      
      // Clear cache
      if (optionService && optionService.clearCache) {
        optionService.clearCache();
      }
      
      res.json({
        success: true,
        message: 'Option deleted successfully'
      });
    } catch (error) {
      console.error('Delete option error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to delete option'
      });
    }
  }
  
  async getCategories(req, res) {
    try {
      const categories = await Option.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]);
      
      const categoryInfo = {
        gender: 'Gender identity options',
        religion: 'Religious affiliation',
        servingAs: 'Church service role',
        relationshipStatus: 'Current relationship status',
        lookingFor: 'What user is looking for',
        haveChildren: 'Parental status',
        education: 'Educational background',
        income: 'Income range',
        matchGender: 'Gender preference for matches',
        matchReligion: 'Religion preference for matches',
        matchEducationLevel: 'Education preference for matches',
        matchWantsChildren: 'Children preference for matches',
        verificationBadge: 'Types of verification badges'
      };
      
      const result = categories.map(cat => ({
        name: cat._id,
        count: cat.count,
        description: categoryInfo[cat._id] || 'No description available'
      }));
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Get categories error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve categories'
      });
    }
  }
  
  // ============ SECURITY QUESTIONS MANAGEMENT ============
  
  async getSecurityQuestions(req, res) {
    try {
      const { category, difficulty, isActive, page = 1, limit = 20 } = req.query;
      
      const filter = {};
      if (category) filter.category = category;
      if (difficulty) filter.difficulty = difficulty;
      if (isActive !== undefined) filter.isActive = isActive === 'true';
      
      const questions = await SecurityQuestion.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .select('-hashedAnswer -salt');
      
      const total = await SecurityQuestion.countDocuments(filter);
      
      res.json({
        success: true,
        data: questions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch security questions'
      });
    }
  }
  
  async getSecurityQuestionById(req, res) {
    try {
      const question = await SecurityQuestion.findById(req.params.id)
        .select('-hashedAnswer -salt');
      
      if (!question) {
        return res.status(404).json({
          success: false,
          error: 'Security question not found'
        });
      }
      
      res.json({
        success: true,
        data: question
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch security question'
      });
    }
  }
  
  async createSecurityQuestion(req, res) {
    try {
      const { question, answer, category, difficulty, isActive = true } = req.body;
      
      if (!question || !category) {
        return res.status(400).json({
          success: false,
          error: 'Question text and category are required'
        });
      }
      
      const questionId = `${category}_${Date.now()}`;
      
      const securityQuestion = new SecurityQuestion({
        questionId,
        questionText: question,
        answer: answer || '', // Optional answer for admin reference
        category,
        difficulty: difficulty || 'easy',
        isActive
      });
      
      await securityQuestion.save();
      
      // Return safe data
      const safeQuestion = securityQuestion.toObject();
      delete safeQuestion.hashedAnswer;
      delete safeQuestion.salt;
      
      res.status(201).json({
        success: true,
        data: safeQuestion,
        message: 'Security question created successfully'
      });
    } catch (error) {
      console.error('Create security question error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create security question'
      });
    }
  }
  
  async updateSecurityQuestion(req, res) {
    try {
      const { question, answer, category, difficulty, isActive } = req.body;
      
      const securityQuestion = await SecurityQuestion.findById(req.params.id);
      
      if (!securityQuestion) {
        return res.status(404).json({
          success: false,
          error: 'Security question not found'
        });
      }
      
      // Update fields
      if (question !== undefined) securityQuestion.questionText = question;
      if (category !== undefined) securityQuestion.category = category;
      if (difficulty !== undefined) securityQuestion.difficulty = difficulty;
      if (isActive !== undefined) securityQuestion.isActive = isActive;
      
      // If answer is being updated
      if (answer !== undefined) {
        securityQuestion.answer = answer;
      }
      
      await securityQuestion.save();
      
      // Return safe data
      const safeQuestion = securityQuestion.toObject();
      delete safeQuestion.hashedAnswer;
      delete safeQuestion.salt;
      
      res.json({
        success: true,
        data: safeQuestion,
        message: 'Security question updated successfully'
      });
    } catch (error) {
      console.error('Update security question error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update security question'
      });
    }
  }
  
  async toggleSecurityQuestionStatus(req, res) {
    try {
      const question = await SecurityQuestion.findById(req.params.id);
      
      if (!question) {
        return res.status(404).json({
          success: false,
          error: 'Security question not found'
        });
      }
      
      question.isActive = !question.isActive;
      await question.save();
      
      res.json({
        success: true,
        data: {
          id: question._id,
          isActive: question.isActive
        },
        message: `Question ${question.isActive ? 'activated' : 'deactivated'} successfully`
      });
    } catch (error) {
      console.error('Toggle security question status error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to toggle question status'
      });
    }
  }
  
  async deleteSecurityQuestion(req, res) {
    try {
      const question = await SecurityQuestion.findByIdAndDelete(req.params.id);
      
      if (!question) {
        return res.status(404).json({
          success: false,
          error: 'Security question not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Security question deleted successfully'
      });
    } catch (error) {
      console.error('Delete security question error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete security question'
      });
    }
  }
  
  async getSecurityQuestionStats(req, res) {
    try {
      const total = await SecurityQuestion.countDocuments();
      const active = await SecurityQuestion.countDocuments({ isActive: true });
      
      // Get category breakdown
      const categories = await SecurityQuestion.aggregate([
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } }
          }
        },
        { $sort: { _id: 1 } }
      ]);
      
      res.json({
        success: true,
        data: {
          total,
          active,
          inactive: total - active,
          categories
        }
      });
    } catch (error) {
      console.error('Get security question stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch security question statistics'
      });
    }
  }
  
  async bulkImportSecurityQuestions(req, res) {
    try {
      const { questions } = req.body;
      
      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Questions array is required'
        });
      }
      
      const imported = [];
      const errors = [];
      
      for (const [index, q] of questions.entries()) {
        try {
          const questionId = `${q.category}_${Date.now()}_${index}`;
          
          const question = new SecurityQuestion({
            questionId,
            questionText: q.question,
            answer: q.answer || '',
            category: q.category || 'general',
            difficulty: q.difficulty || 'easy',
            isActive: q.isActive !== undefined ? q.isActive : true
          });
          
          await question.save();
          imported.push(question.questionId);
        } catch (error) {
          errors.push({
            index,
            question: q.question,
            error: error.message
          });
        }
      }
      
      res.json({
        success: true,
        data: {
          imported: imported.length,
          errors: errors.length,
          importedQuestions: imported,
          errorDetails: errors
        },
        message: `Imported ${imported.length} security questions successfully`
      });
    } catch (error) {
      console.error('Bulk import security questions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to import security questions'
      });
    }
  }
  
  async exportSecurityQuestions(req, res) {
    try {
      const questions = await SecurityQuestion.find()
        .select('questionId questionText category difficulty isActive usageCount lastUsed createdAt updatedAt')
        .sort({ createdAt: -1 });
      
      // Set headers for file download
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=security-questions-export.json');
      
      res.json({
        success: true,
        data: questions,
        exportedAt: new Date().toISOString(),
        count: questions.length
      });
    } catch (error) {
      console.error('Export security questions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to export security questions'
      });
    }
  }
  
  // ============ SYSTEM MANAGEMENT ============
  
  async getSystemConfig(req, res) {
    try {
      res.json({
        success: true,
        config: {
          environment: process.env.NODE_ENV || 'development',
          version: process.env.APP_VERSION || '1.0.0',
          maintenance: false,
          userTypes: ['DatingUser', 'Moderator', 'Admin', 'SuperAdmin'],
          features: {
            registration: true,
            messaging: true,
            matching: true,
            verification: true,
            staffManagement: true
          },
          limits: {
            maxFileSize: process.env.MAX_FILE_SIZE || '5MB',
            maxProfileImages: 10,
            messageLength: 1000
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get system config error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve system configuration'
      });
    }
  }
  
  async updateSystemConfig(req, res) {
    try {
      const { config } = req.body;
      
      // In a real implementation, this would save to a database
      res.json({
        success: true,
        message: 'System configuration updated',
        config,
        updatedBy: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
          userType: req.user.userType
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Update system config error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to update system configuration'
      });
    }
  }
  
  async createDatabaseBackup(req, res) {
    try {
      // This would create an actual database backup
      res.json({
        success: true,
        message: 'Database backup created (placeholder)',
        backupId: `backup_${Date.now()}`,
        timestamp: new Date().toISOString(),
        size: '0MB',
        location: '/backups/placeholder'
      });
    } catch (error) {
      console.error('Create database backup error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to create database backup'
      });
    }
  }
  
  async clearSystemCache(req, res) {
    try {
      // Clear any in-memory caches
      if (global.redisClient) {
        await global.redisClient.flushall();
      }
      
      // Clear rate limit store
      if (global.rateLimitStore) {
        global.rateLimitStore.clear();
      }
      
      res.json({
        success: true,
        message: 'System cache cleared',
        clearedAt: new Date().toISOString(),
        clearedItems: ['redis', 'rateLimitStore']
      });
    } catch (error) {
      console.error('Clear system cache error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to clear system cache'
      });
    }
  }
  
  // ============ AUDIT LOGS ============
  
  async getAuditLogs(req, res) {
    try {
      // This would typically fetch from an AuditLog model
      res.json({
        success: true,
        logs: [],
        total: 0,
        message: 'Audit logs functionality not yet implemented'
      });
    } catch (error) {
      console.error('Get audit logs error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve audit logs'
      });
    }
  }
  
  async getAdminActivity(req, res) {
    try {
      // Get recent admin actions from users
      const adminUsers = await BaseUser.find({
        role: { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] }
      })
        .select('firstName lastName email role userType lastAdminAction statusChangeHistory')
        .sort({ 'lastAdminAction.performedAt': -1 })
        .limit(20);
      
      const activities = adminUsers
        .filter(user => user.lastAdminAction)
        .map(user => ({
          admin: {
            id: user._id,
            name: `${user.firstName} ${user.lastName}`,
            email: user.email,
            role: user.role,
            userType: user.userType
          },
          action: user.lastAdminAction.action,
          timestamp: user.lastAdminAction.performedAt,
          reason: user.lastAdminAction.reason
        }));
      
      res.json({
        success: true,
        activities,
        total: activities.length,
        message: 'Recent admin activities retrieved'
      });
    } catch (error) {
      console.error('Get admin activity error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve admin activities'
      });
    }
  }

  // ============ HELPER METHODS ============

  formatAdminUserList(user) {
    const baseData = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      userName: user.userName,
      avatar: user.avatar,
      role: user.role,
      userType: user.userType,
      accountStatus: user.accountStatus,
      createdAt: user.createdAt,
      lastActive: user.lastActive || user.presence?.lastActive
    };

    // Add role-specific data
    if (user.userType === 'DatingUser') {
      baseData.age = user.age;
    } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
      baseData.employeeId = user.employeeId;
      baseData.department = user.department;
    }

    return baseData;
  }

  formatAdminUserDetail(user) {
    const baseData = user.toObject ? user.toObject() : { ...user };
    
    // Remove sensitive fields
    delete baseData.password;
    delete baseData.refreshToken;
    delete baseData.passwordHistory;
    delete baseData.failedLoginAttempts;
    delete baseData.accountLockedUntil;
    delete baseData.emailVerificationToken;
    delete baseData.emailVerificationExpires;
    delete baseData.passwordResetToken;
    delete baseData.passwordResetExpires;
    
    // Add role-specific details
    if (user.userType === 'DatingUser') {
      baseData.age = user.age;
      baseData.dateOfBirth = user.dateOfBirth;
      baseData.preferences = user.preferences;
      baseData.location = user.location;
      baseData.messagingPreferences = user.messagingPreferences;
      baseData.sharePhone = user.sharePhone;
      baseData.phoneNumber = user.phoneNumber;
      baseData.phoneVerified = user.phoneVerified;
    } else if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
      baseData.employeeId = user.employeeId;
      baseData.department = user.department;
      baseData.permissions = user.permissions || [];
      baseData.managedUsers = user.managedUsers || [];
      baseData.staffNotificationSettings = user.staffNotificationSettings || {};
      baseData.workStats = user.workStats || {};
    }

    return baseData;
  }
}

module.exports = new AdminController();