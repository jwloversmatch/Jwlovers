const resourceOwner = require('./resource-owner');
const chatPermissions = require('./chat-permissions');

module.exports = {
  requireOwnership: resourceOwner.requireOwnership,
  canSendMessages: chatPermissions.canSendMessages,
  canReceiveFrom: chatPermissions.canReceiveFrom,
  profileCompleted: chatPermissions.profileCompleted,
};