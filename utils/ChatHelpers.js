// utils/ChatHelpers.js
const logger = require("@utils/logger") || console;

class ChatHelpers {
  constructor() {
    // Cache for duplicate prevention
    this.duplicateCheckCache = new Map();
    this.cleanupInterval = setInterval(() => this.cleanupCache(), 60000);
  }

  cleanupCache() {
    const now = Date.now();
    for (const [key, timestamp] of this.duplicateCheckCache.entries()) {
      if (now - timestamp > 30000) {
        this.duplicateCheckCache.delete(key);
      }
    }
  }

  getSocketHelpers(req) {
    let helpers = req?.app?.get('socketHelpers') || null;
    
    if (!helpers || !helpers.encryptMessageForStorage) {
      const encryptionService = req?.app?.get('EncryptionService');
      
      if (encryptionService) {
        helpers = {
          ...helpers,
          encryptMessageForStorage: (content) => {
            return encryptionService.encryptMessageForStorage(content);
          },
          decryptForFrontend: (content, encryptionType) => {
            return encryptionService.decryptForFrontend(content, encryptionType);
          }
        };
      }
    }
    
    return helpers;
  }

  getRedisHelper(req) {
    return req?.app?.get("RedisHelper") || null;
  }

  safeToString(id) {
    if (!id) return "";
    if (typeof id === "string") return id;
    if (id.toString) return id.toString();
    if (id._id?.toString) return id._id.toString();
    return String(id);
  }

  isUserAuthorized(message, currentUserId) {
    try {
      const senderId = this.safeToString(message.senderId);
      const receiverId = this.safeToString(message.receiverId);
      const userId = this.safeToString(currentUserId);

      return senderId === userId || receiverId === userId;
    } catch (error) {
      logger.error("Authorization check failed:", error);
      return false;
    }
  }

  getSenderName(sender) {
    if (!sender) return "Unknown User";
    if (typeof sender === "string") return `User-${sender.substring(0, 8)}`;
    if (sender.firstName) {
      return `${sender.firstName} ${sender.lastName || ""}`.trim();
    }
    
    return (
      sender.userName ||
      sender.name ||
      sender.email?.split("@")[0] ||
      `User-${sender._id?.substring(0, 8) || "unknown"}`
    );
  }

  extractSenderId(user) {
    if (user._id) {
      if (typeof user._id === "object") {
        if (user._id.$oid) return user._id.$oid;
        if (user._id.toString) return user._id.toString();
        return JSON.stringify(user._id);
      }
      return user._id;
    }
    
    return user.id || user.userId || user.sub;
  }

  validateMongoId(id) {
    return /^[0-9a-fA-F]{24}$/.test(id);
  }

  createCacheKey(senderId, receiverId, messageId, content) {
    return `${senderId}:${receiverId}:${messageId || content?.substring(0, 50)}`;
  }

  checkDuplicate(cacheKey) {
    if (this.duplicateCheckCache.has(cacheKey)) {
      return true;
    }
    this.duplicateCheckCache.set(cacheKey, Date.now());
    return false;
  }

  clearCache(cacheKey) {
    if (cacheKey) {
      this.duplicateCheckCache.delete(cacheKey);
    }
  }

  logMessageEvent(event, data, level = "info") {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      userId: data.userId,
      messageId: data.messageId,
      conversationId: data.conversationId,
      ...data,
    };

    logger[level](logEntry);
  }

  cleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

module.exports = new ChatHelpers();