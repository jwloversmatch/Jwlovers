const jwt = require("jsonwebtoken");
const logger = require("../utils/logger");

const authMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ 
        success: false,
        error: "Authentication required" 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    logger.warn("Authentication failed:", error.message);
    return res.status(401).json({ 
      success: false,
      error: "Invalid token" 
    });
  }
};

module.exports = authMiddleware;