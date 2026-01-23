const crypto = require("crypto");
const logger = require("../utils/logger");

const requestLogger = (req, res, next) => {
  const start = Date.now();
  const requestId = crypto.randomBytes(8).toString('hex');
  
  req.requestId = requestId;
  logger.debug(`[${requestId}] ${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info(`[${requestId}] ${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
  });
  next();
};

module.exports = requestLogger;