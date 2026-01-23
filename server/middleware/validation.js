const logger = require("../utils/logger");

const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error } = schema.validate(req[property]);
    if (error) {
      logger.warn(`Validation error for ${req.method} ${req.url}:`, error.details);
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }
    next();
  };
};

module.exports = validate;