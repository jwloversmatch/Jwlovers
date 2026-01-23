// controllers/InviteCodeController.js
const BaseController = require('../BaseController');
const InviteCode = require('@models/InviteCode.model');
const { ROLES } = require('@middleware/authmiddleware');

class InviteCodeController extends BaseController {
  constructor() {
    super();
    this.logger = console;
  }

  // ====== HELPER: Format user data for invite responses ======
  formatUserForInviteResponse(user) {
    if (!user) return null;
    
    const userObj = user.toObject ? user.toObject() : user;
    
    const isAdmin = userObj.role === ROLES.ADMIN;
    const isSuperAdmin = userObj.role === ROLES.SUPER_ADMIN;
    const isStaff = userObj.role !== ROLES.USER;
    
    const formatted = {
      _id: userObj._id,
      email: userObj.email,
      firstName: userObj.firstName,
      lastName: userObj.lastName,
      userType: userObj.userType,
      
      ...(userObj.employeeId && { employeeId: userObj.employeeId }),
      ...(userObj.department && { department: userObj.department }),
      
      isStaff,
      isAdmin,
      isSuperAdmin,
      
      isOnShift: userObj.isOnShift || false,
      totalManagedUsers: userObj.totalManagedUsers || 0,
      activeCases: userObj.activeCases || 0,
      isSeniorStaff: userObj.isSeniorStaff || false,
      fullName: `${userObj.firstName || ''} ${userObj.lastName || ''}`.trim(),
      isActive: ['active', 'pending_verification'].includes(userObj.accountStatus),
      age: userObj.age || null,
      id: userObj._id.toString()
    };
    
    delete formatted.isAdminUser;
    delete formatted.isSuperAdminUser;
    
    return formatted;
  }

  // ====== HELPER: Format invite code ======
  formatInviteCode(code) {
    if (!code) return null;
    
    const codeObj = code.toObject ? code.toObject() : code;
    
    return {
      ...codeObj,
      createdBy: this.formatUserForInviteResponse(codeObj.createdBy),
      usedBy: this.formatUserForInviteResponse(codeObj.usedBy)
    };
  }

  // ====== GET ALL INVITE CODES ======
  async getAllInviteCodes(req, res) {
    try {
      const { page = 1, limit = 20, role, isActive } = req.query;
      
      const filter = {};
      if (role) filter.role = role;
      if (isActive !== undefined) filter.isActive = isActive === 'true';
      
      const codes = await InviteCode.find(filter)
        .populate('createdBy', 'firstName lastName email role userType employeeId department accountStatus')
        .populate('usedBy', 'firstName lastName email role userType employeeId department accountStatus')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));
      
      const total = await InviteCode.countDocuments(filter);
      
      const formattedCodes = codes.map(code => this.formatInviteCode(code));
      
      return this.successResponse(res, 200, formattedCodes, '', {
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      this.logger.error('Error fetching invite codes:', error);
      return this.handleError(error, req, res);
    }
  }

  // ====== GET SINGLE INVITE CODE ======
  async getInviteCodeById(req, res) {
    try {
      const code = await InviteCode.findById(req.params.id)
        .populate('createdBy', 'firstName lastName email role userType employeeId department accountStatus')
        .populate('usedBy', 'firstName lastName email role userType employeeId department accountStatus');
      
      if (!code) {
        return this.errorResponse(res, 404, 'Invite code not found');
      }
      
      return this.successResponse(res, 200, this.formatInviteCode(code));
    } catch (error) {
      this.logger.error('Error fetching invite code:', error);
      return this.handleError(error, req, res);
    }
  }

  // ====== CREATE INVITE CODE ======
  async createInviteCode(req, res) {
    try {
      const { role, maxUses = 1, expiresAt, description } = req.body;
      
      this.logger.info(`Creating invite code: role=${role}, maxUses=${maxUses}, user=${req.user.email}`);
      
      // Super admin can create any role, admin can only create moderator
      if (req.user.role === ROLES.ADMIN && role !== ROLES.MODERATOR) {
        return this.errorResponse(res, 403, 'Admin can only create moderator invite codes');
      }
      
      const code = await InviteCode.generate({
        role,
        createdBy: req.user.id,
        maxUses,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        description
      });
      
      this.logger.info(`✅ Invite code created: ${code.code}`);
      
      return this.successResponse(
        res, 
        201, 
        code, 
        'Invite code created successfully'
      );
    } catch (error) {
      this.logger.error('Error creating invite code:', error);
      return this.handleError(error, req, res);
    }
  }

  // ====== TOGGLE INVITE CODE STATUS ======
  async toggleInviteCode(req, res) {
    try {
      const code = await InviteCode.findById(req.params.id);
      
      if (!code) {
        return this.errorResponse(res, 404, 'Invite code not found');
      }
      
      code.isActive = !code.isActive;
      await code.save();
      
      return this.successResponse(
        res,
        200,
        {
          id: code._id,
          code: code.code,
          isActive: code.isActive
        },
        `Invite code ${code.isActive ? 'activated' : 'deactivated'}`
      );
    } catch (error) {
      this.logger.error('Error toggling invite code:', error);
      return this.handleError(error, req, res);
    }
  }

  // ====== DELETE INVITE CODE ======
  async deleteInviteCode(req, res) {
    try {
      const code = await InviteCode.findByIdAndDelete(req.params.id);
      
      if (!code) {
        return this.errorResponse(res, 404, 'Invite code not found');
      }
      
      return this.successResponse(
        res,
        200,
        null,
        'Invite code deleted successfully'
      );
    } catch (error) {
      this.logger.error('Error deleting invite code:', error);
      return this.handleError(error, req, res);
    }
  }

  // ====== GET STATISTICS ======
  async getInviteCodeStats(req, res) {
    try {
      const stats = await InviteCode.aggregate([
        {
          $group: {
            _id: '$role',
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
            used: { $sum: { $cond: [{ $gt: ['$uses', 0] }, 1, 0] } },
            totalUses: { $sum: '$uses' }
          }
        },
        {
          $project: {
            role: '$_id',
            total: 1,
            active: 1,
            used: 1,
            totalUses: 1,
            unused: { $subtract: ['$total', '$used'] }
          }
        },
        { $sort: { role: 1 } }
      ]);
      
      return this.successResponse(res, 200, stats);
    } catch (error) {
      this.logger.error('Error fetching invite code stats:', error);
      return this.handleError(error, req, res);
    }
  }
}

module.exports = new InviteCodeController();