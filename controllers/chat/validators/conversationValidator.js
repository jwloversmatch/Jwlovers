const Joi = require('joi');

const conversationSchemas = {
  createConversation: Joi.object({
    participantId: Joi.string().required().messages({
      'string.empty': 'Participant ID is required',
      'any.required':  'Participant ID is required',
    }),
  }),

  updateConversation: Joi.object({
    // FIX #5: accept both 'archive' (canonical) and 'archived' (old frontend name)
    archive:  Joi.boolean().optional(),
    archived: Joi.boolean().optional(),
    // FIX #6: accept both 'mute' (canonical) and 'muted' (old frontend name)
    mute:     Joi.boolean().optional(),
    muted:    Joi.boolean().optional(),
    duration: Joi.number().min(1).max(24 * 7).optional(), // hours, max 1 week
  }),

  getConversations: Joi.object({
    limit:    Joi.number().integer().min(1).max(100).default(20),
    offset:   Joi.number().integer().min(0).default(0),
    unread:   Joi.string().valid('true', 'false').optional(),
    archived: Joi.string().valid('true', 'false').optional(),
    muted:    Joi.string().valid('true', 'false').optional(),
    sort:     Joi.string().valid('lastMessageAt', 'createdAt', 'updatedAt').default('lastMessageAt'),
    order:    Joi.string().valid('asc', 'desc').default('desc'),
  }),

  getConversation: Joi.object({
    limit:  Joi.number().integer().min(1).max(200).default(50),
    offset: Joi.number().integer().min(0).default(0),
    before: Joi.date().iso().optional(),
    after:  Joi.date().iso().optional(),
  }),
};

// FIX #9: For GET requests req.body = {} which is truthy, so 'req.body || req.query'
// always resolves to {} instead of the actual query params.
// Explicitly pick the right source by HTTP method.
const validateConversation = (schema) => (req, res, next) => {
  const source = req.method === 'GET' ? req.query : req.body;

  const { error } = schema.validate(source, {
    abortEarly: false,
    allowUnknown: false,
  });

  if (error) {
    const errors = error.details.map(detail => detail.message);
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors,
    });
  }

  next();
};

module.exports = {
  conversationSchemas,
  validateConversation,
};