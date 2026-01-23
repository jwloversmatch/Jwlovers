// validators/MessageValidator.js
const mongoose = require("mongoose");

class MessageValidator {
  validateMessageRequest(body) {
    const { receiverId, type, content, mediaUrl } = body;

    if (!receiverId || !type) {
      throw new Error("receiverId and type are required");
    }

    if (!mongoose.Types.ObjectId.isValid(receiverId)) {
      throw new Error("Invalid receiverId format");
    }

    if (type === "text" && (!content || !content.trim())) {
      throw new Error("content is required for text messages");
    }

    if (type !== "text" && !content && !mediaUrl) {
      throw new Error("Either content or mediaUrl is required");
    }

    if (content && content.length > 10000) {
      throw new Error("Message content too long (max 10000 characters)");
    }

    return true;
  }

  validateEditRequest(content) {
    if (!content || content.trim().length === 0) {
      throw new Error("Content is required");
    }

    if (content.length > 10000) {
      throw new Error("Message too long (max 10000 characters)");
    }

    return true;
  }

  validateReactionRequest(reaction) {
    if (!reaction || reaction.trim().length === 0) {
      throw new Error("Reaction is required");
    }

    return true;
  }

  validateSearchQuery(query) {
    if (!query || query.trim().length === 0) {
      throw new Error("Search query is required");
    }

    return true;
  }

  validateBulkRequest(messageIds) {
    if (!messageIds || !Array.isArray(messageIds)) {
      throw new Error("messageIds array is required");
    }

    if (messageIds.length === 0) {
      return false; // Not an error, just skip
    }

    return true;
  }
}

module.exports = new MessageValidator();