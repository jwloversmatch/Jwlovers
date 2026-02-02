const BaseController = require('../BaseController');
const UserProfileService = require('./UserProfileService');
const UserSettingsService = require('./UserSettingsService');
const UserAdminService = require('./UserAdminService');
const UserRateLimitService = require('./UserRateLimitService');
const logger = require('@utils/logger');

class UserController extends BaseController {
  constructor() {
    super();
    
    // Initialize services
    this.rateLimitService = new UserRateLimitService();
    this.profileService = new UserProfileService(this.rateLimitService);
    this.settingsService = new UserSettingsService();
    this.adminService = new UserAdminService();
    
    // Auto-bind methods
    this.getMe = this.getMe.bind(this);
    this.getUserById = this.getUserById.bind(this);
    this.updatePrivateInfo = this.updatePrivateInfo.bind(this);
    this.updateProfile = this.updateProfile.bind(this);
    this.updateEmail = this.updateEmail.bind(this);
    this.deleteAccount = this.deleteAccount.bind(this);
    this.getSettings = this.getSettings.bind(this);
    this.updateSettings = this.updateSettings.bind(this);
    this.getUsers = this.getUsers.bind(this);
    this.changeUserRole = this.changeUserRole.bind(this);
  }

  // ========== PUBLIC PROFILE METHODS ==========

  async getMe(req, res) {
    try {
      return await this.profileService.getMe(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async getUserById(req, res) {
    try {
      return await this.profileService.getUserById(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== PRIVATE INFO METHODS ==========

  async updatePrivateInfo(req, res) {
    try {
      return await this.profileService.updatePrivateInfo(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async updateEmail(req, res) {
    try {
      return await this.profileService.updateEmail(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== PROFILE METHODS ==========

  async updateProfile(req, res) {
    try {
      return await this.profileService.updateProfile(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== SETTINGS METHODS ==========

  async getSettings(req, res) {
    try {
      return await this.settingsService.getSettings(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async updateSettings(req, res) {
    try {
      return await this.settingsService.updateSettings(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== ACCOUNT MANAGEMENT ==========

  async deleteAccount(req, res) {
    try {
      return await this.profileService.deleteAccount(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== ADMIN METHODS ==========

  async changeUserRole(req, res) {
    try {
      return await this.adminService.changeUserRole(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  async getUsers(req, res) {
    try {
      return await this.adminService.getUsers(req, res, this);
    } catch (error) {
      return this.handleError(error, req, res);
    }
  }

  // ========== ERROR HANDLING ==========

  handleError(error, req, res) {
    logger.error('UserController error:', {
      error: error.message,
      stack: error.stack,
      userId: req.userId || req.user?.id,
      path: req.path,
      method: req.method,
      requestId: req.requestId,
      ip: req.ip
    });

    // Handle specific error types
    if (error.name === 'ValidationError') {
      return this.errorResponse(res, 400, error.message, {
        code: "VALIDATION_ERROR",
        requestId: req.requestId
      });
    }

    if (error.code === 11000) {
      return this.errorResponse(res, 409, "A user with this information already exists", {
        code: "DUPLICATE_KEY",
        requestId: req.requestId
      });
    }

    if (error.name === 'CastError') {
      return this.errorResponse(res, 400, "Invalid user ID format", {
        code: "INVALID_ID",
        requestId: req.requestId
      });
    }

    if (error.message.includes('Unauthorized') || error.message.includes('Insufficient permissions')) {
      return this.errorResponse(res, 403, error.message, {
        code: "PERMISSION_DENIED",
        requestId: req.requestId
      });
    }

    if (error.message.includes('Too many')) {
      return this.errorResponse(res, 429, error.message, {
        code: "RATE_LIMITED",
        requestId: req.requestId
      });
    }

    return this.errorResponse(res, 500, "An error occurred while processing your request", {
      code: "INTERNAL_ERROR",
      requestId: req.requestId
    });
  }
}

module.exports = UserController;