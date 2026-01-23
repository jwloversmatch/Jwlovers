const Joi = require('joi');

const messageSchemas = {
  sendMessage: Joi.object({
    receiverId: Joi.string().required(),
    content: Joi.string().min(1).max(5000).required(),
    type: Joi.string().valid('text', 'image', 'video', 'file', 'audio').default('text'),
    mediaUrl: Joi.string().uri().optional(),
    conversationId: Joi.string().optional()
  }),
  
  editMessage: Joi.object({
    content: Joi.string().min(1).max(5000).required()
  }),
  
  markMessagesRead: Joi.object({
    messageIds: Joi.array().items(Joi.string()).min(1).required()
  }),
  
  deleteMessagesBulk: Joi.object({
    messageIds: Joi.array().items(Joi.string()).min(1).required()
  }),
  
  addReaction: Joi.object({
    reaction: Joi.string().min(1).max(10).required()
  })
};

const validateMessage = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, {
    abortEarly: false,
    allowUnknown: false
  });
  
  if (error) {
    const errors = error.details.map(detail => detail.message);
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors
    });
  }
  
  next();
};

module.exports = {
  messageSchemas,
  validateMessage
};