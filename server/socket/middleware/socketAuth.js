const jwt = require("jsonwebtoken");
const logger = require("../../utils/logger");

const socketAuth = (redisService) => {
  return async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        logger.warn(`No token provided for socket connection: ${socket.id}`);
        return next(new Error("Authentication required"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      const canConnect = await redisService.canUserConnect(decoded.userId);
      if (!canConnect) {
        logger.warn(`User ${decoded.userId} has too many connections`);
        return next(new Error("Too many connections"));
      }
      
      const isBlocked = await redisService.isUserBlocked(decoded.userId);
      if (isBlocked) {
        logger.warn(`Blocked user ${decoded.userId} tried to connect`);
        return next(new Error("User is blocked"));
      }

      socket.userId = decoded.userId;
      socket.user = decoded;
      socket.requestId = require("crypto").randomBytes(8).toString('hex');
      
      next();
    } catch (error) {
      logger.error("Socket auth error:", error.message);
      next(new Error("Authentication error"));
    }
  };
};

module.exports = socketAuth;