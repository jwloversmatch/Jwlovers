const Joi = require('joi');

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

module.exports = {
  "join_conversation": Joi.object({
    conversationId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid conversation ID format',
      'any.required': 'conversationId is required'
    })
  }),
  
  "message:send": Joi.object({
    receiverId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid receiver ID format',
      'any.required': 'receiverId is required'
    }),
    content: Joi.string().required().max(5000).messages({
      'string.max': 'Message content cannot exceed 5000 characters',
      'any.required': 'content is required'
    }),
    conversationId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid conversation ID format'
    }),
    messageId: Joi.string().optional(),
    mediaUrl: Joi.string().uri().optional().messages({
      'string.uri': 'Invalid media URL format'
    }),
    type: Joi.string().valid('text', 'image', 'video', 'file', 'audio').default('text').messages({
      'any.only': 'Message type must be one of: text, image, video, file, audio'
    })
  }),
  
  "typing:start": Joi.object({
    conversationId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid conversation ID format'
    }),
    receiverId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid receiver ID format'
    })
  }).or('conversationId', 'receiverId').messages({
    'object.missing': 'Either conversationId or receiverId is required'
  }),
  
  "typing:stop": Joi.object({
    conversationId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid conversation ID format'
    }),
    receiverId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid receiver ID format'
    })
  }).or('conversationId', 'receiverId').messages({
    'object.missing': 'Either conversationId or receiverId is required'
  }),
  
  "messages:viewed": Joi.object({
    conversationId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid conversation ID format'
    }),
    receiverId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid receiver ID format'
    }),
    messageIds: Joi.array().items(Joi.string().regex(objectIdRegex)).min(1).required().messages({
      'array.min': 'At least one message ID is required',
      'array.includes': 'Invalid message ID format'
    })
  }),
  
  "presence:update-status": Joi.object({
    status: Joi.string().valid('online', 'away', 'busy', 'offline', 'dnd').default('online').messages({
      'any.only': 'Status must be one of: online, away, busy, offline, dnd'
    }),
    customStatus: Joi.string().max(100).default('').messages({
      'string.max': 'Custom status cannot exceed 100 characters'
    })
  }),
  
  "presence:get-user-status": Joi.object({
    userIds: Joi.array().items(Joi.string().regex(objectIdRegex)).min(1).max(100).required().messages({
      'array.min': 'At least one user ID is required',
      'array.max': 'Maximum 100 user IDs allowed',
      'array.includes': 'Invalid user ID format'
    })
  }),
  
  "presence:batch-status": Joi.object({
    userIds: Joi.array().items(Joi.string().regex(objectIdRegex)).min(1).max(100).required().messages({
      'array.min': 'At least one user ID is required',
      'array.max': 'Maximum 100 user IDs allowed',
      'array.includes': 'Invalid user ID format'
    })
  }),
  
  "leave_conversation": Joi.object({
    conversationId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid conversation ID format',
      'any.required': 'conversationId is required'
    })
  })
};