// middleware/chatValidators.js
const { body, param, query } = require('express-validator');
const validate = require('./validation');

// All validators return functions wrapped with validate()
const validateConversationId = validate([
  param('conversationId')
    .isMongoId()
    .withMessage('Invalid conversation ID format')
]);

const validateMessageId = validate([
  param('messageId')
    .isMongoId()
    .withMessage('Invalid message ID format')
]);

const validateUserId = validate([
  param('userId')
    .isMongoId()
    .withMessage('Invalid user ID format')
]);

const validatePagination = validate([
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
    .toInt(),
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be a positive integer')
    .toInt(),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be at least 1')
    .toInt()
]);

const validateMessageContent = validate([
  body('content')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 5000 })
    .withMessage('Message content must be between 1 and 5000 characters'),
  body('type')
    .isIn(['text', 'image', 'video', 'audio', 'file', 'location'])
    .withMessage('Invalid message type'),
  body('receiverId')
    .optional()
    .isMongoId()
    .withMessage('Invalid receiver ID'),
  body('conversationId')
    .optional()
    .isMongoId()
    .withMessage('Invalid conversation ID'),
  body('mediaUrl')
    .optional()
    .isURL()
    .withMessage('Invalid media URL')
]);

const validateSearchQuery = validate([
  query('q')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Search query must be between 1 and 100 characters'),
  query('type')
    .optional()
    .isIn(['messages', 'conversations', 'all'])
    .withMessage('Invalid search type')
]);

const validateMessageIdsArray = validate([
  body('messageIds')
    .isArray()
    .withMessage('messageIds must be an array')
    .notEmpty()
    .withMessage('messageIds cannot be empty'),
  body('messageIds.*')
    .optional()
    .isMongoId()
    .withMessage('Each message ID must be valid')
]);

module.exports = {
  validateConversationId,
  validateMessageId,
  validateUserId,
  validatePagination,
  validateMessageContent,
  validateSearchQuery,
  validateMessageIdsArray
};