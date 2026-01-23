const logger = require('@utils/logger');

class BaseController {
  constructor() {
    this.handleError = this.handleError.bind(this);
    this.successResponse = this.successResponse.bind(this);
    this.errorResponse = this.errorResponse.bind(this);
  }

  async handleError(error, req, res) {
    logger.error(`${this.constructor.name} error:`, {
      message: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method,
      userId: req.userId,
    });

    // Validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return this.errorResponse(res, 400, errors.join(", "));
    }

    // Duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      const message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
      return this.errorResponse(res, 400, message);
    }

    // JWT errors
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return this.errorResponse(res, 401, "Invalid or expired token");
    }

    // Default error
    const message = process.env.NODE_ENV === "production"
      ? "An error occurred. Please try again."
      : error.message;

    return this.errorResponse(res, 500, message);
  }

  successResponse(res, statusCode, data = {}, message = "Success") {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  }

  errorResponse(res, statusCode, error, details = {}) {
    return res.status(statusCode).json({
      success: false,
      error,
      ...details,
    });
  }
}

module.exports = BaseController;