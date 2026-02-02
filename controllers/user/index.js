const UserController = require('./UserController');
const UserProfileService = require('./UserProfileService');
const UserSettingsService = require('./UserSettingsService');
const UserAdminService = require('./UserAdminService');
const UserRateLimitService = require('./UserRateLimitService');
const UserValidationService = require('./UserValidationService');
const UserFormatterService = require('./UserFormatterService');

module.exports = {
  UserController,
  UserProfileService,
  UserSettingsService,
  UserAdminService,
  UserRateLimitService,
  UserValidationService,
  UserFormatterService
};

// For backwards compatibility
module.exports.default = UserController;
module.exports.UserController = UserController;