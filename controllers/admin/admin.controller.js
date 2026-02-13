const { BaseUser, DatingUser } = require('@models/User');
const Profile = require('@models/Profile/Profile.model');
const Option = require('@models/Option.model');
const SecurityQuestion = require('@models/SecurityQuestion');
const optionService = require('@services/option.service');
const logger = require('@utils/logger');

class AdminController {
  
  // ============ DASHBOARD & METRICS ============
  
  async getAdminDashboard(req, res) {
    try {
      // Get statistics with multi-schema consideration
      const [
        totalUsers,
        datingUsers,
        staffUsers,
        activeUsers,
        newUsersToday,
        totalProfiles,
        totalOptions,
        totalQuestions
      ] = await Promise.all([
        BaseUser.countDocuments(),
        BaseUser.countDocuments({ userType: 'DatingUser' }),
        BaseUser.countDocuments({ 
          role: { $in: ['moderator', 'admin', 'super_admin'] } 
        }),
        BaseUser.countDocuments({ accountStatus: 'active' }),
        BaseUser.countDocuments({
          createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        }),
        Profile.countDocuments(),
        Option.countDocuments({ isActive: true }),
        SecurityQuestion.countDocuments({ isActive: true })
      ]);

      // Get dating-specific stats
      const datingStats = {
        total: await DatingUser.countDocuments(),
        ageVerified: await DatingUser.countDocuments({ ageVerified: true }),
        isPremium: await DatingUser.countDocuments({ isPremium: true }),
        activeProfiles: await Profile.countDocuments({ 
          'datingProfile.isVisible': true,
          'datingProfile.isPaused': false 
        })
      };

      // Get recent users with their types
      const recentUsers = await BaseUser.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select('firstName lastName email role userType createdAt accountStatus')
        .lean();

      // Get recent dating profiles
      const recentDatingProfiles = await DatingUser.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('profile', 'userName profilePicture profileCompletion')
        .lean();

      // Get recent activity
      const recentActivity = await BaseUser.find({
        'presence.lastSeen': { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      })
        .sort({ 'presence.lastSeen': -1 })
        .limit(10)
        .select('firstName lastName email role userType presence.lastSeen')
        .lean();

      res.json({
        success: true,
        message: 'Admin dashboard retrieved successfully',
        user: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
          userType: req.user.userType
        },
        timestamp: new Date().toISOString(),
        stats: {
          users: {
            total: totalUsers,
            byType: {
              dating: datingUsers,
              staff: staffUsers,
              breakdown: {
                moderators: await BaseUser.countDocuments({ role: 'moderator' }),
                admins: await BaseUser.countDocuments({ role: 'admin' }),
                superAdmins: await BaseUser.countDocuments({ role: 'super_admin' })
              }
            },
            active: activeUsers,
            newToday: newUsersToday,
            status: {
              active: activeUsers,
              pending: await BaseUser.countDocuments({ accountStatus: 'pending_verification' }),
              suspended: await BaseUser.countDocuments({ accountStatus: 'suspended' }),
              deactivated: await BaseUser.countDocuments({ accountStatus: 'deactivated' })
            }
          },
          dating: datingStats,
          profiles: {
            total: totalProfiles,
            completed: await Profile.countDocuments({ profileCompletion: { $gte: 70 } }),
            averageCompletion: await Profile.aggregate([
              { $group: { _id: null, average: { $avg: '$profileCompletion' } } }
            ]).then(result => Math.round(result[0]?.average || 0))
          },
          system: {
            options: totalOptions,
            securityQuestions: totalQuestions,
            health: 'operational'
          }
        },
        recent: {
          users: recentUsers,
          datingProfiles: recentDatingProfiles,
          activity: recentActivity
        }
      });
    } catch (error) {
      logger.error('Dashboard error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to load dashboard data',
        code: 'DASHBOARD_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async getDashboardMetrics(req, res) {
    try {
      // Get dashboard statistics
      const [
        totalUsers,
        activeUsers,
        totalProfiles,
        datingUsers,
        staffUsers
      ] = await Promise.all([
        BaseUser.countDocuments(),
        BaseUser.countDocuments({ accountStatus: 'active' }),
        Profile.countDocuments(),
        DatingUser.countDocuments(),
        BaseUser.countDocuments({ 
          role: { $in: ['moderator', 'admin', 'super_admin'] } 
        })
      ]);

      // Get daily new users (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const dailyNewUsers = await BaseUser.aggregate([
        {
          $match: {
            createdAt: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            count: { $sum: 1 }
          }
        },
        {
          $sort: { '_id.year': -1, '_id.month': -1, '_id.day': -1 }
        },
        {
          $limit: 7
        }
      ]);

      // Get user activity (last 24 hours)
      const active24Hours = await BaseUser.countDocuments({
        'presence.lastSeen': { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      });

      // Get dating profile statistics
      const datingStats = {
        premium: await DatingUser.countDocuments({ isPremium: true }),
        ageVerified: await DatingUser.countDocuments({ ageVerified: true }),
        active: await Profile.countDocuments({ 
          'datingProfile.isVisible': true,
          'datingProfile.isPaused': false 
        })
      };

      res.json({
        success: true,
        message: 'Dashboard metrics retrieved successfully',
        timestamp: new Date().toISOString(),
        metrics: {
          users: {
            total: totalUsers,
            active: activeUsers,
            active24h: active24Hours,
            dating: datingUsers,
            staff: staffUsers,
            dailyGrowth: dailyNewUsers
          },
          profiles: {
            total: totalProfiles,
            dating: datingStats,
            averageCompletion: await Profile.aggregate([
              { $group: { _id: null, average: { $avg: '$profileCompletion' } } }
            ]).then(result => Math.round(result[0]?.average || 0))
          },
          system: {
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            nodeVersion: process.version
          }
        }
      });
    } catch (error) {
      logger.error('Dashboard metrics error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to load dashboard metrics',
        code: 'DASHBOARD_METRICS_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  // ============ USER MANAGEMENT ============
  
  async getAllUsers(req, res) {
    try {
      const { 
        page = 1, 
        limit = 50, 
        role, 
        userType, 
        status, 
        hasProfile,
        hasDatingProfile 
      } = req.query;
      
      const query = {};
      
      // Filter by role
      if (role) query.role = role;
      
      // Filter by user type
      if (userType) query.userType = userType;
      
      // Filter by account status
      if (status) query.accountStatus = status;
      
      // Security: Regular admins cannot see other admins/super_admins
      if (req.user.role === 'admin') {
        query.role = { $in: ['user', 'moderator'] };
      }
      
      const skip = (page - 1) * limit;
      const [users, total] = await Promise.all([
        BaseUser.find(query)
          .select('firstName lastName email role userType accountStatus createdAt lastLogin presence.updatedAt')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        BaseUser.countDocuments(query)
      ]);
      
      // Enrich users with profile information
      const enrichedUsers = await Promise.all(
        users.map(async (user) => {
          const userObj = { ...user };
          
          // Get profile info
          const profile = await Profile.findOne({ userId: user._id })
            .select('userName profilePicture profileCompletion isVerified verificationBadges')
            .lean();
          
          if (profile) {
            userObj.profile = {
              hasProfile: true,
              userName: profile.userName,
              profileCompletion: profile.profileCompletion || 0,
              isVerified: profile.isVerified || false,
              verificationBadges: profile.verificationBadges?.length || 0
            };
          }
          
          // Get dating profile info if applicable
          if (user.userType === 'DatingUser') {
            const datingUser = await DatingUser.findById(user._id)
              .select('ageVerified isPremium premiumExpiresAt incognitoMode travelMode.enabled')
              .lean();
            
            if (datingUser) {
              userObj.dating = {
                hasDatingProfile: true,
                ageVerified: datingUser.ageVerified,
                isPremium: datingUser.isPremium,
                isPremiumActive: datingUser.isPremium && 
                  (!datingUser.premiumExpiresAt || new Date(datingUser.premiumExpiresAt) > new Date()),
                incognitoMode: datingUser.incognitoMode,
                travelMode: datingUser.travelMode?.enabled || false
              };
            }
          }
          
          // Add staff info if applicable
          if (['moderator', 'admin', 'super_admin'].includes(user.role)) {
            const staffUser = await BaseUser.findById(user._id)
              .select('employeeId department permissions workStats')
              .lean();
            
            if (staffUser) {
              userObj.staff = {
                employeeId: staffUser.employeeId,
                department: staffUser.department,
                permissions: staffUser.permissions || [],
                workStats: staffUser.workStats || {}
              };
            }
          }
          
          return userObj;
        })
      );
      
      // Filter by profile existence if requested
      let filteredUsers = enrichedUsers;
      if (hasProfile === 'true') {
        filteredUsers = enrichedUsers.filter(user => user.profile?.hasProfile);
      } else if (hasProfile === 'false') {
        filteredUsers = enrichedUsers.filter(user => !user.profile?.hasProfile);
      }
      
      if (hasDatingProfile === 'true') {
        filteredUsers = filteredUsers.filter(user => user.dating?.hasDatingProfile);
      } else if (hasDatingProfile === 'false') {
        filteredUsers = filteredUsers.filter(user => !user.dating?.hasDatingProfile);
      }
      
      res.json({
        success: true,
        data: {
          users: filteredUsers,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
            showing: filteredUsers.length
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get all users error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve users',
        code: 'USER_RETRIEVAL_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async getUsersByType(req, res) {
    try {
      const { userType } = req.params;
      const { page = 1, limit = 50 } = req.query;
      
      if (!['DatingUser', 'Moderator', 'Admin', 'SuperAdmin'].includes(userType)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user type',
          timestamp: new Date().toISOString()
        });
      }
      
      const query = { userType };
      
      // Security check for admin users
      if (userType === 'Admin' || userType === 'SuperAdmin') {
        if (req.user.role !== 'super_admin') {
          return res.status(403).json({
            success: false,
            error: 'Insufficient permissions to view admin users',
            timestamp: new Date().toISOString()
          });
        }
      }
      
      const skip = (page - 1) * limit;
      const [users, total] = await Promise.all([
        BaseUser.find(query)
          .select('firstName lastName email role userType accountStatus createdAt lastLogin')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        BaseUser.countDocuments(query)
      ]);
      
      res.json({
        success: true,
        data: {
          users,
          userType,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
            showing: users.length
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get users by type error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve users by type',
        code: 'USERS_BY_TYPE_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async getUsersByRole(req, res) {
    try {
      const { role } = req.params;
      const { page = 1, limit = 50 } = req.query;
      
      if (!['user', 'moderator', 'admin', 'super_admin'].includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid role',
          timestamp: new Date().toISOString()
        });
      }
      
      const query = { role };
      
      // Security check
      if (role === 'admin' || role === 'super_admin') {
        if (req.user.role !== 'super_admin') {
          return res.status(403).json({
            success: false,
            error: 'Insufficient permissions to view admin roles',
            timestamp: new Date().toISOString()
          });
        }
      }
      
      const skip = (page - 1) * limit;
      const [users, total] = await Promise.all([
        BaseUser.find(query)
          .select('firstName lastName email role userType accountStatus createdAt lastLogin')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        BaseUser.countDocuments(query)
      ]);
      
      res.json({
        success: true,
        data: {
          users,
          role,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
            showing: users.length
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get users by role error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve users by role',
        code: 'USERS_BY_ROLE_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async getUserById(req, res) {
    try {
      const userId = req.params.id;
      
      // Get base user
      const user = await BaseUser.findById(userId)
        .select('-password -refreshToken -passwordHistory -refreshTokens -emailVerificationToken -emailVerificationExpires -passwordResetToken -passwordResetExpires')
        .lean();
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
          timestamp: new Date().toISOString()
        });
      }
      
      // Security check
      if (req.user.role === 'admin' && 
          (user.role === 'admin' || user.role === 'super_admin') &&
          !user._id.equals(req.user._id)) {
        return res.status(403).json({
          success: false,
          error: 'Cannot view other admin profiles',
          code: 'ADMIN_ACCESS_DENIED',
          timestamp: new Date().toISOString()
        });
      }
      
      // Get profile
      const profile = await Profile.findOne({ userId })
        .select('-userId')
        .lean();
      
      // Get dating profile if applicable
      let datingUser = null;
      if (user.userType === 'DatingUser') {
        datingUser = await DatingUser.findById(userId)
          .populate('profile')
          .lean();
      }
      
      // Format response
      const response = {
        success: true,
        data: {
          base: user,
          profile: profile || null,
          dating: datingUser || null
        },
        timestamp: new Date().toISOString()
      };
      
      res.json(response);
    } catch (error) {
      logger.error('Get user by ID error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve user',
        code: 'USER_DETAIL_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async updateUserRole(req, res) {
    try {
      const userId = req.params.id;
      const { role, reason, employeeId, department } = req.body;
      
      // Cannot modify your own role
      if (userId === req.user.id) {
        return res.status(400).json({
          success: false,
          error: 'Cannot modify your own role',
          code: 'SELF_MODIFICATION',
          timestamp: new Date().toISOString()
        });
      }
      
      const user = await BaseUser.findById(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
          timestamp: new Date().toISOString()
        });
      }
      
      // Permission checks
      const roleHierarchy = {
        'user': 0,
        'moderator': 1,
        'admin': 2,
        'super_admin': 3
      };
      
      const userLevel = roleHierarchy[req.user.role] || 0;
      const targetLevel = roleHierarchy[role] || 0;
      const currentLevel = roleHierarchy[user.role] || 0;
      
      // Cannot modify users with higher or equal role
      if (currentLevel >= userLevel) {
        return res.status(403).json({
          success: false,
          error: 'Cannot modify users with equal or higher role',
          code: 'INSUFFICIENT_PERMISSIONS',
          timestamp: new Date().toISOString()
        });
      }
      
      // Cannot assign role higher than your own
      if (targetLevel >= userLevel) {
        return res.status(403).json({
          success: false,
          error: 'Cannot assign role equal to or higher than your own',
          code: 'ROLE_ASSIGNMENT_DENIED',
          timestamp: new Date().toISOString()
        });
      }
      
      const oldRole = user.role;
      const oldUserType = user.userType;
      
      // Determine new user type
      let newUserType = oldUserType;
      if (role === 'user') {
        newUserType = 'DatingUser';
      } else if (role === 'moderator') {
        newUserType = 'Moderator';
      } else if (role === 'admin' || role === 'super_admin') {
        newUserType = 'Admin';
      }
      
      // Update user
      user.role = role;
      user.userType = newUserType;
      
      // Add staff-specific fields if promoting to staff
      if (role !== 'user') {
        if (employeeId) user.employeeId = employeeId;
        if (department) user.department = department;
        
        // Initialize staff fields if not present
        if (!user.permissions) user.permissions = [];
        if (!user.staffNotificationSettings) {
          user.staffNotificationSettings = {
            userReports: 'assigned',
            systemAlerts: true,
            adminAnnouncements: true,
            shiftReminders: true,
            caseUpdates: true,
            teamMessages: true
          };
        }
        if (!user.workStats) {
          user.workStats = {
            casesResolved: 0,
            casesEscalated: 0,
            averageResolutionTime: 0,
            responseTime: 0,
            lastActiveShift: null,
            totalShiftHours: 0,
            performanceScore: 0
          };
        }
      }
      
      await user.save();
      
      // Handle DatingUser creation/deletion based on role change
      if (oldUserType === 'DatingUser' && newUserType !== 'DatingUser') {
        // User is no longer a dating user, remove dating profile
        await DatingUser.findByIdAndDelete(userId);
      } else if (oldUserType !== 'DatingUser' && newUserType === 'DatingUser') {
        // User is now a dating user, create dating profile if profile exists
        const profile = await Profile.findOne({ userId });
        if (profile) {
          await DatingUser.create({
            _id: userId,
            profile: profile._id,
            ageVerified: false,
            datingPreferences: {
              ageRange: { min: 18, max: 100 },
              distance: 50,
              notificationRadius: 10
            },
            datingNotificationSettings: {
              newMatches: true,
              newLikes: true,
              superLikes: true,
              profileViews: true,
              safetyAlerts: true,
              promotionOffers: false
            },
            datingPrivacySettings: {
              showAge: true,
              showDistance: true,
              showInterests: true,
              showLastActive: 'matches',
              allowMessagesFrom: 'everyone'
            },
            datingStats: {
              totalLikes: 0,
              totalMatches: 0,
              totalMessagesSent: 0,
              totalMessagesReceived: 0,
              profileViews: 0,
              lastActiveDate: new Date()
            },
            isPremium: false,
            premiumExpiresAt: null,
            incognitoMode: false
          });
        }
      }
      
      // Log the action
      logger.info('User role updated', {
        adminId: req.user.id,
        adminEmail: req.user.email,
        targetUserId: userId,
        oldRole,
        newRole: role,
        oldUserType,
        newUserType,
        reason
      });
      
      res.json({
        success: true,
        message: `User role updated from ${oldRole} to ${role}`,
        data: {
          userId: user._id,
          email: user.email,
          role: user.role,
          userType: user.userType,
          employeeId: user.employeeId,
          department: user.department
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Update user role error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to update user role',
        code: 'ROLE_UPDATE_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async updateUserStatus(req, res) {
    try {
      const userId = req.params.id;
      const { status, reason } = req.body;
      
      const user = await BaseUser.findById(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
          timestamp: new Date().toISOString()
        });
      }
      
      // Permission checks
      const roleHierarchy = {
        'user': 0,
        'moderator': 1,
        'admin': 2,
        'super_admin': 3
      };
      
      const userLevel = roleHierarchy[req.user.role] || 0;
      const targetLevel = roleHierarchy[user.role] || 0;
      
      // Cannot modify users with higher or equal role
      if (targetLevel >= userLevel) {
        return res.status(403).json({
          success: false,
          error: 'Cannot modify users with equal or higher role',
          code: 'INSUFFICIENT_PERMISSIONS',
          timestamp: new Date().toISOString()
        });
      }
      
      // Cannot modify your own status (except to active)
      if (userId === req.user.id && status !== 'active') {
        return res.status(400).json({
          success: false,
          error: 'Cannot deactivate/suspend your own account',
          code: 'SELF_MODIFICATION',
          timestamp: new Date().toISOString()
        });
      }
      
      const oldStatus = user.accountStatus;
      user.accountStatus = status;
      
      // Add to status history
      if (!user.statusChangeHistory) {
        user.statusChangeHistory = [];
      }
      
      user.statusChangeHistory.push({
        from: oldStatus,
        to: status,
        changedBy: req.user._id,
        reason,
        timestamp: new Date()
      });
      
      await user.save();
      
      // If suspending/deactivating a dating user, also pause their dating profile
      if ((status === 'suspended' || status === 'deactivated') && user.userType === 'DatingUser') {
        await Profile.updateOne(
          { userId },
          { 'datingProfile.isPaused': true }
        );
      }
      
      // If reactivating, unpause dating profile
      if (status === 'active' && user.userType === 'DatingUser') {
        await Profile.updateOne(
          { userId },
          { 'datingProfile.isPaused': false }
        );
      }
      
      logger.info('User status updated', {
        adminId: req.user.id,
        adminEmail: req.user.email,
        targetUserId: userId,
        oldStatus,
        newStatus: status,
        reason
      });
      
      res.json({
        success: true,
        message: `User status updated from ${oldStatus} to ${status}`,
        data: {
          userId: user._id,
          email: user.email,
          role: user.role,
          userType: user.userType,
          accountStatus: user.accountStatus
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Update user status error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to update user status',
        code: 'STATUS_UPDATE_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async searchUsers(req, res) {
    try {
      const { query, role, userType, status, page = 1, limit = 20 } = req.query;
      
      const searchFilter = {};
      
      // Text search
      if (query) {
        searchFilter.$or = [
          { email: { $regex: query, $options: 'i' } },
          { firstName: { $regex: query, $options: 'i' } },
          { lastName: { $regex: query, $options: 'i' } },
          { employeeId: { $regex: query, $options: 'i' } }
        ];
      }
      
      // Role filter
      if (role) searchFilter.role = role;
      
      // User type filter
      if (userType) searchFilter.userType = userType;
      
      // Status filter
      if (status) searchFilter.accountStatus = status;
      
      // Security: Regular admins cannot see other admins/super_admins
      if (req.user.role === 'admin') {
        searchFilter.role = { $in: ['user', 'moderator'] };
      }
      
      const [users, total] = await Promise.all([
        BaseUser.find(searchFilter)
          .select('firstName lastName email role userType accountStatus createdAt lastLogin')
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(parseInt(limit))
          .lean(),
        BaseUser.countDocuments(searchFilter)
      ]);
      
      res.json({
        success: true,
        data: {
          users,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
            showing: users.length
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Search users error:', error);
      res.status(500).json({
        success: false,
        error: 'Search failed',
        code: 'USER_SEARCH_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  // ============ PROFILE MANAGEMENT ============
  
  async getAllProfiles(req, res) {
    try {
      const { 
        page = 1, 
        limit = 50, 
        minCompletion, 
        maxCompletion,
        isVerified,
        hasDatingProfile 
      } = req.query;
      
      const query = {};
      
      // Filter by profile completion
      if (minCompletion || maxCompletion) {
        query.profileCompletion = {};
        if (minCompletion) query.profileCompletion.$gte = parseInt(minCompletion);
        if (maxCompletion) query.profileCompletion.$lte = parseInt(maxCompletion);
      }
      
      // Filter by verification status
      if (isVerified !== undefined) {
        query.isVerified = isVerified === 'true';
      }
      
      // Filter by dating profile visibility
      if (hasDatingProfile === 'true') {
        query['datingProfile.isVisible'] = true;
        query['datingProfile.isPaused'] = false;
      } else if (hasDatingProfile === 'false') {
        query.$or = [
          { 'datingProfile.isVisible': false },
          { 'datingProfile.isPaused': true },
          { datingProfile: { $exists: false } }
        ];
      }
      
      const [profiles, total] = await Promise.all([
        Profile.find(query)
          .select('userId userName profilePicture bio age gender location profileCompletion isVerified verificationBadges datingProfile')
          .sort({ profileCompletion: -1, updatedAt: -1 })
          .skip((page - 1) * limit)
          .limit(parseInt(limit))
          .populate('userId', 'firstName lastName email role userType accountStatus')
          .lean(),
        Profile.countDocuments(query)
      ]);
      
      res.json({
        success: true,
        data: {
          profiles,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
            showing: profiles.length
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get all profiles error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve profiles',
        code: 'PROFILE_RETRIEVAL_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async getProfileById(req, res) {
    try {
      const profile = await Profile.findById(req.params.id)
        .populate('userId', 'firstName lastName email role userType accountStatus createdAt')
        .lean();
      
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'Profile not found',
          code: 'PROFILE_NOT_FOUND',
          timestamp: new Date().toISOString()
        });
      }
      
      // Get dating profile if exists
      let datingUser = null;
      if (profile.userId.userType === 'DatingUser') {
        datingUser = await DatingUser.findById(profile.userId._id).lean();
      }
      
      res.json({
        success: true,
        data: {
          profile,
          dating: datingUser
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get profile by ID error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve profile',
        code: 'PROFILE_DETAIL_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async updateProfileVisibility(req, res) {
    try {
      const profileId = req.params.id;
      const { isVisible, isPaused, reason } = req.body;
      
      const profile = await Profile.findById(profileId);
      
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: 'Profile not found',
          code: 'PROFILE_NOT_FOUND',
          timestamp: new Date().toISOString()
        });
      }
      
      const updates = {};
      if (isVisible !== undefined) {
        updates['datingProfile.isVisible'] = isVisible;
      }
      if (isPaused !== undefined) {
        updates['datingProfile.isPaused'] = isPaused;
      }
      
      const updatedProfile = await Profile.findByIdAndUpdate(
        profileId,
        { $set: updates },
        { new: true }
      );
      
      logger.info('Profile visibility updated', {
        adminId: req.user.id,
        adminEmail: req.user.email,
        profileId,
        userId: profile.userId,
        updates,
        reason
      });
      
      res.json({
        success: true,
        message: 'Profile visibility updated',
        data: {
          profileId: updatedProfile._id,
          isVisible: updatedProfile.datingProfile?.isVisible,
          isPaused: updatedProfile.datingProfile?.isPaused
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Update profile visibility error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to update profile visibility',
        code: 'VISIBILITY_UPDATE_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  // ============ DATING PROFILE MANAGEMENT ============
  
  async getAllDatingProfiles(req, res) {
    try {
      const { 
        page = 1, 
        limit = 50,
        ageVerified,
        isPremium,
        incognitoMode,
        hasActiveBoost 
      } = req.query;
      
      const query = {};
      
      // Apply filters
      if (ageVerified !== undefined) {
        query.ageVerified = ageVerified === 'true';
      }
      if (isPremium !== undefined) {
        query.isPremium = isPremium === 'true';
      }
      if (incognitoMode !== undefined) {
        query.incognitoMode = incognitoMode === 'true';
      }
      if (hasActiveBoost === 'true') {
        query['boost.isActive'] = true;
        query['boost.expiresAt'] = { $gt: new Date() };
      } else if (hasActiveBoost === 'false') {
        query.$or = [
          { 'boost.isActive': false },
          { 'boost.expiresAt': { $lt: new Date() } },
          { boost: { $exists: false } }
        ];
      }
      
      const [datingUsers, total] = await Promise.all([
        DatingUser.find(query)
          .populate({
            path: 'profile',
            select: 'userName profilePicture bio age gender location profileCompletion isVerified'
          })
          .populate({
            path: '_id',
            select: 'firstName lastName email role accountStatus createdAt',
            model: 'BaseUser'
          })
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(parseInt(limit))
          .lean(),
        DatingUser.countDocuments(query)
      ]);
      
      res.json({
        success: true,
        data: {
          datingUsers: datingUsers.map(du => ({
            ...du,
            user: du._id, // BaseUser info
            profile: du.profile
          })),
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
            showing: datingUsers.length
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get all dating profiles error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve dating profiles',
        code: 'DATING_PROFILE_RETRIEVAL_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async updateDatingProfile(req, res) {
    try {
      const datingUserId = req.params.id;
      const updates = req.body;
      
      const datingUser = await DatingUser.findByIdAndUpdate(
        datingUserId,
        updates,
        { new: true, runValidators: true }
      );
      
      if (!datingUser) {
        return res.status(404).json({
          success: false,
          error: 'Dating profile not found',
          code: 'DATING_PROFILE_NOT_FOUND',
          timestamp: new Date().toISOString()
        });
      }
      
      logger.info('Dating profile updated', {
        adminId: req.user.id,
        adminEmail: req.user.email,
        datingUserId,
        updates: Object.keys(updates)
      });
      
      res.json({
        success: true,
        message: 'Dating profile updated successfully',
        data: datingUser,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Update dating profile error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to update dating profile',
        code: 'DATING_PROFILE_UPDATE_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async togglePremiumStatus(req, res) {
    try {
      const datingUserId = req.params.id;
      const { isPremium, durationDays, reason } = req.body;
      
      const datingUser = await DatingUser.findById(datingUserId);
      
      if (!datingUser) {
        return res.status(404).json({
          success: false,
          error: 'Dating profile not found',
          code: 'DATING_PROFILE_NOT_FOUND',
          timestamp: new Date().toISOString()
        });
      }
      
      const oldStatus = datingUser.isPremium;
      datingUser.isPremium = isPremium;
      
      if (isPremium && durationDays) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + parseInt(durationDays));
        datingUser.premiumExpiresAt = expiresAt;
      } else if (!isPremium) {
        datingUser.premiumExpiresAt = null;
      }
      
      await datingUser.save();
      
      logger.info('Premium status updated', {
        adminId: req.user.id,
        adminEmail: req.user.email,
        datingUserId,
        oldStatus,
        newStatus: isPremium,
        durationDays,
        reason
      });
      
      res.json({
        success: true,
        message: `Premium status ${isPremium ? 'activated' : 'deactivated'}`,
        data: {
          isPremium: datingUser.isPremium,
          premiumExpiresAt: datingUser.premiumExpiresAt
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Toggle premium status error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to update premium status',
        code: 'PREMIUM_UPDATE_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  // ============ MODERATION TOOLS ============
  
  async getReports(req, res) {
    try {
      // Placeholder for reports functionality
      // In a real implementation, you would fetch reports from a Report model
      
      res.json({
        success: true,
        message: 'Reports endpoint',
        data: {
          reports: [],
          stats: {
            pending: 0,
            resolved: 0,
            escalated: 0
          }
        },
        timestamp: new Date().toISOString(),
        note: 'Reports functionality not yet implemented'
      });
    } catch (error) {
      logger.error('Get reports error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve reports',
        code: 'REPORTS_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async takeReportAction(req, res) {
    try {
      const { id } = req.params;
      const { action, notes } = req.body;
      
      // Placeholder for report action functionality
      
      res.json({
        success: true,
        message: `Report action ${action} taken`,
        data: {
          reportId: id,
          action,
          notes,
          resolvedBy: req.user.id,
          resolvedAt: new Date()
        },
        timestamp: new Date().toISOString(),
        note: 'Report action functionality not yet implemented'
      });
    } catch (error) {
      logger.error('Take report action error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to take report action',
        code: 'REPORT_ACTION_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async removeContent(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      
      // Placeholder for content removal functionality
      
      res.json({
        success: true,
        message: 'Content removed',
        data: {
          contentId: id,
          reason,
          removedBy: req.user.id,
          removedAt: new Date()
        },
        timestamp: new Date().toISOString(),
        note: 'Content removal functionality not yet implemented'
      });
    } catch (error) {
      logger.error('Remove content error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to remove content',
        code: 'CONTENT_REMOVAL_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  // ============ SYSTEM MANAGEMENT ============
  
  async getSystemConfig(req, res) {
    try {
      // Placeholder for system configuration
      const config = {
        app: {
          name: 'JWLovers',
          version: '1.0.0',
          environment: process.env.NODE_ENV || 'development'
        },
        features: {
          registration: true,
          emailVerification: true,
          ageVerification: true,
          contentModeration: true,
          premiumFeatures: true
        },
        limits: {
          maxFileSize: '10MB',
          maxProfilePhotos: 6,
          dailyMatches: 20,
          messageLength: 1000
        },
        security: {
          require2FA: false,
          sessionTimeout: '24h',
          maxLoginAttempts: 5
        }
      };
      
      res.json({
        success: true,
        message: 'System configuration retrieved',
        data: config,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get system config error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve system configuration',
        code: 'SYSTEM_CONFIG_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async getSystemHealth(req, res) {
    try {
      // Check database connections
      const [baseUserCount, profileCount, datingUserCount, optionCount] = await Promise.all([
        BaseUser.countDocuments().catch(() => 0),
        Profile.countDocuments().catch(() => 0),
        DatingUser.countDocuments().catch(() => 0),
        Option.countDocuments().catch(() => 0)
      ]);
      
      // Get active users in last 24 hours
      const activeUsers = await BaseUser.countDocuments({
        'presence.lastSeen': { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }).catch(() => 0);
      
      // Get memory usage
      const memoryUsage = process.memoryUsage();
      
      res.json({
        success: true,
        data: {
          status: 'operational',
          components: {
            database: {
              status: 'connected',
              collections: {
                baseUsers: baseUserCount,
                profiles: profileCount,
                datingUsers: datingUserCount,
                options: optionCount
              }
            },
            api: {
              status: 'operational',
              uptime: process.uptime()
            },
            cache: {
              status: 'operational'
            }
          },
          metrics: {
            totalUsers: baseUserCount,
            activeUsers,
            profiles: profileCount,
            datingProfiles: datingUserCount,
            uptime: process.uptime(),
            memory: {
              heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
              heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
              external: Math.round(memoryUsage.external / 1024 / 1024)
            }
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get system health error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to get system health',
        code: 'SYSTEM_HEALTH_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async updateSystemConfig(req, res) {
    try {
      const { config } = req.body;
      
      // Placeholder for system configuration update
      // In a real implementation, you would save to database or config file
      
      logger.info('System configuration updated', {
        adminId: req.user.id,
        adminEmail: req.user.email,
        config: Object.keys(config)
      });
      
      res.json({
        success: true,
        message: 'System configuration updated',
        data: config,
        timestamp: new Date().toISOString(),
        note: 'Configuration changes are not persisted in this implementation'
      });
    } catch (error) {
      logger.error('Update system config error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to update system configuration',
        code: 'SYSTEM_CONFIG_UPDATE_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async createDatabaseBackup(req, res) {
    try {
      // Placeholder for database backup functionality
      
      const backupInfo = {
        id: `backup_${Date.now()}`,
        timestamp: new Date().toISOString(),
        createdBy: req.user.id,
        status: 'completed',
        size: '0MB',
        collections: ['users', 'profiles', 'dating_profiles', 'options']
      };
      
      logger.info('Database backup created', {
        adminId: req.user.id,
        adminEmail: req.user.email,
        backupId: backupInfo.id
      });
      
      res.json({
        success: true,
        message: 'Database backup created',
        data: backupInfo,
        timestamp: new Date().toISOString(),
        note: 'Database backup functionality not yet implemented'
      });
    } catch (error) {
      logger.error('Create database backup error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to create database backup',
        code: 'DATABASE_BACKUP_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async clearSystemCache(req, res) {
    try {
      // Clear option service cache if available
      if (optionService && optionService.clearCache) {
        optionService.clearCache();
      }
      
      // Clear other caches as needed
      
      logger.info('System cache cleared', {
        adminId: req.user.id,
        adminEmail: req.user.email
      });
      
      res.json({
        success: true,
        message: 'System cache cleared',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Clear system cache error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to clear system cache',
        code: 'CACHE_CLEAR_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  // ============ AUDIT LOGS ============
  
  async getAuditLogs(req, res) {
    try {
      const { page = 1, limit = 50, action, userId, startDate, endDate } = req.query;
      
      // Placeholder for audit logs
      // In a real implementation, you would query an AuditLog model
      
      const logs = [];
      const total = 0;
      
      res.json({
        success: true,
        data: {
          logs,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
            showing: logs.length
          }
        },
        timestamp: new Date().toISOString(),
        note: 'Audit logs functionality not yet implemented'
      });
    } catch (error) {
      logger.error('Get audit logs error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve audit logs',
        code: 'AUDIT_LOGS_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  async getAdminActivity(req, res) {
    try {
      const { page = 1, limit = 50 } = req.query;
      
      // Get recent admin actions from BaseUser activity or separate audit log
      const recentActivity = await BaseUser.find({
        role: { $in: ['moderator', 'admin', 'super_admin'] },
        'presence.lastSeen': { $exists: true }
      })
        .sort({ 'presence.lastSeen': -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .select('firstName lastName email role userType presence.lastSeen department')
        .lean();
      
      // Get staff statistics
      const totalStaff = await BaseUser.countDocuments({
        role: { $in: ['moderator', 'admin', 'super_admin'] }
      });
      
      const activeStaff = await BaseUser.countDocuments({
        role: { $in: ['moderator', 'admin', 'super_admin'] },
        'presence.lastSeen': { $gte: new Date(Date.now() - 15 * 60 * 1000) } // Last 15 minutes
      });
      
      res.json({
        success: true,
        data: {
          recentActivity,
          stats: {
            totalStaff,
            activeStaff,
            inactiveStaff: totalStaff - activeStaff
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get admin activity error:', error);
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve admin activity',
        code: 'ADMIN_ACTIVITY_ERROR',
        timestamp: new Date().toISOString()
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
  
}

module.exports = new AdminController();