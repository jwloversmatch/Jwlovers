// middleware/validation.js
// express-validator middleware — used on routes that don't use the Joi validators.
// Note: The Joi-based validators (message.validator.js, conversation.validator.js)
// are a separate system and are applied directly as route middleware.
const { validationResult } = require('express-validator');

const validate = (validations) => {
  return async (req, res, next) => {
    // Handle non-array cases gracefully
    if (!validations || !Array.isArray(validations) || validations.length === 0) {
      return next();
    }

    try {
      // Run all validations
      await Promise.all(validations.map(validation => validation.run(req)));

      // Check for validation errors
      const errors = validationResult(req);
      if (errors.isEmpty()) {
        return next();
      }

      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    } catch (error) {
      console.error('Validation middleware error:', error);
      return next();
    }
  };
};

module.exports = validate;