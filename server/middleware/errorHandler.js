const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  logger.error("Unhandled error:", {
    error: err.message,
    stack: err.stack,
    requestId: req.requestId,
    path: req.path,
    method: req.method
  });

  const errorMessage = process.env.NODE_ENV === "production" 
    ? "Internal server error" 
    : err.message;

  res.status(err.statusCode || 500).json({
    success: false,
    error: errorMessage,
    requestId: req.requestId,
    ...(process.env.NODE_ENV === "development" && { 
      stack: err.stack,
      details: err.message 
    })
  });
};

module.exports = errorHandler;