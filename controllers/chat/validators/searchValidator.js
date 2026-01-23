const Joi = require('joi');

const searchSchemas = {
  searchConversations: Joi.object({
    query: Joi.string().min(2).max(100).required(),
    limit: Joi.number().integer().min(1).max(50).default(20),
    offset: Joi.number().integer().min(0).default(0)
  }),
  
  searchMessages: Joi.object({
    query: Joi.string().min(1).max(100).required(),
    userId: Joi.string().optional(),
    limit: Joi.number().integer().min(1).max(100).default(20),
    offset: Joi.number().integer().min(0).default(0),
    sort: Joi.string().valid('createdAt', 'updatedAt').default('createdAt'),
    order: Joi.string().valid('asc', 'desc').default('desc')
  })
};

const validateSearch = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.query, {
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
  searchSchemas,
  validateSearch
};