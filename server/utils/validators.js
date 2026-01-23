const Joi = require("joi");

const validationSchemas = {
  message: Joi.object({
    receiverId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    content: Joi.string().min(1).max(10000).required(),
    conversationId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
    type: Joi.string().valid("text", "image", "file", "audio", "video").default("text"),
    mediaUrl: Joi.string().uri().optional(),
    clientMessageId: Joi.string().optional()
  }),
  
  conversationQuery: Joi.object({
    limit: Joi.number().integer().min(1).max(100).default(20),
    offset: Joi.number().integer().min(0).default(0),
    unread: Joi.boolean().default(false),
    archived: Joi.boolean().default(false),
    muted: Joi.boolean().default(false),
    sort: Joi.string().valid("lastMessageAt", "createdAt", "unreadCount").default("lastMessageAt"),
    order: Joi.string().valid("asc", "desc").default("desc")
  }),
  
  userIdParam: Joi.object({
    userId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required()
  })
};

module.exports = validationSchemas;