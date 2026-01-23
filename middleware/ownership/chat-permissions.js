const User = require("@models/User/User.model");
const logger = require("@utils/logger");

class ChatPermissionsMiddleware {
  async canSendMessages(req, res, next) {
    try {
      if (!req.userId) {
        return this.unauthorized(res, "Authentication required.");
      }

      const user = await User.findById(req.userId).select(
        "status settings.canSendMessages"
      );

      if (!user) {
        return this.notFound(res, "User not found.");
      }

      if (user.status !== "active") {
        return this.forbidden(
          res,
          "Your account is not active. Please contact support."
        );
      }

      if (user.settings?.canSendMessages === false) {
        return this.forbidden(
          res,
          "Your messaging privileges have been restricted."
        );
      }

      next();
    } catch (error) {
      logger.error("Can send messages check error:", error);
      return this.serverError(res, "Failed to check messaging privileges.");
    }
  }

  async canReceiveFrom(req, res, next) {
    try {
      const { receiverId } = req.body;
      const senderId = req.userId;

      if (!receiverId) {
        return this.badRequest(res, "Receiver ID is required.");
      }

      const receiver = await User.findById(receiverId).select(
        "status settings.blockedUsers"
      );

      if (!receiver) {
        return this.notFound(res, "Receiver not found.");
      }

      if (receiver.status !== "active") {
        return this.forbidden(res, "Cannot send message to this user.");
      }

      const blockedUsers = receiver.settings?.blockedUsers || [];
      if (blockedUsers.includes(senderId.toString())) {
        return this.forbidden(res, "You are blocked by this user.");
      }

      next();
    } catch (error) {
      logger.error("Can receive from check error:", error);
      return this.serverError(res, "Failed to check messaging permissions.");
    }
  }

  async profileCompleted(req, res, next) {
    try {
      if (!req.userId) {
        return this.unauthorized(res, "Authentication required.");
      }

      const user = await User.findById(req.userId).select(
        "name avatar emailVerified"
      );

      if (!user) {
        return this.notFound(res, "User not found.");
      }

      const completionScore = this.calculateProfileScore(user);

      if (completionScore < 70) {
        return this.forbidden(
          res,
          "Please complete your profile to access this feature.",
          {
            profileCompletion: completionScore,
            missingFields: this.getMissingFields(user),
          }
        );
      }

      next();
    } catch (error) {
      logger.error("Profile check error:", error);
      return this.serverError(res, "Failed to check profile status.");
    }
  }

  // Helper methods
  calculateProfileScore(user) {
    let score = 0;
    if (user.name && user.name.trim().length > 0) score += 40;
    if (user.avatar) score += 30;
    if (user.emailVerified) score += 30;
    return score;
  }

  getMissingFields(user) {
    const missing = [];
    if (!user.name || user.name.trim().length === 0) missing.push("name");
    if (!user.avatar) missing.push("avatar");
    if (!user.emailVerified) missing.push("email verification");
    return missing;
  }

  unauthorized(res, message) {
    return res.status(401).json({ success: false, error: message });
  }

  badRequest(res, message) {
    return res.status(400).json({ success: false, error: message });
  }

  notFound(res, message) {
    return res.status(404).json({ success: false, error: message });
  }

  forbidden(res, message, details = {}) {
    return res.status(403).json({
      success: false,
      error: message,
      ...details,
    });
  }

  serverError(res, message) {
    return res.status(500).json({ success: false, error: message });
  }
}

module.exports = new ChatPermissionsMiddleware();
