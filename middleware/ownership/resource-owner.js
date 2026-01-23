const logger = require('@utils/logger');

class ResourceOwnerMiddleware {
  requireOwnership(modelName, idParam = 'id', options = {}) {
    return async (req, res, next) => {
      try {
        const Model = require(`@models/${modelName}.model`);
        const resourceId = req.params[idParam];

        if (!resourceId) {
          return this.badRequest(res, 'Resource ID is required.');
        }

        // Special handling for chat models
        if (modelName === 'Message') {
          return await this.checkMessageOwnership(req, res, next, Model, resourceId);
        }

        if (modelName === 'Conversation') {
          return await this.checkConversationAccess(req, res, next, Model, resourceId);
        }

        // Generic resource ownership check
        return await this.checkGenericOwnership(req, res, next, Model, resourceId, options);
      } catch (error) {
        logger.error('Ownership check error:', error);
        return this.serverError(res, 'Failed to verify resource ownership.');
      }
    };
  }

  async checkMessageOwnership(req, res, next, Model, messageId) {
    const message = await Model.findById(messageId).select('senderId receiverId');
    
    if (!message) {
      return this.notFound(res, 'Message not found.');
    }

    const isSender = message.senderId.toString() === req.userId.toString();
    const isReceiver = message.receiverId.toString() === req.userId.toString();

    if (!isSender && !isReceiver && req.user.role !== 'admin') {
      return this.forbidden(res, 'You don\'t have permission to access this message.');
    }

    req.resource = message;
    req.isOwner = isSender;
    next();
  }

  async checkConversationAccess(req, res, next, Model, conversationId) {
    const conversation = await Model.findById(conversationId).select('participants');
    
    if (!conversation) {
      return this.notFound(res, 'Conversation not found.');
    }

    const isParticipant = conversation.participants.some(
      p => p.toString() === req.userId.toString()
    );

    if (!isParticipant && req.user.role !== 'admin') {
      return this.forbidden(res, 'You don\'t have permission to access this conversation.');
    }

    req.resource = conversation;
    next();
  }

  async checkGenericOwnership(req, res, next, Model, resourceId, options) {
    const resource = await Model.findById(resourceId);
    
    if (!resource) {
      return this.notFound(res, 'Resource not found.');
    }

    const ownerField = options.ownerField || 'user';
    let ownerId = resource[ownerField] || resource.userId || resource.createdBy;

    if (!ownerId) {
      return this.serverError(res, 'Resource ownership could not be determined.');
    }

    if (ownerId.toString() !== req.userId.toString() && req.user.role !== 'admin') {
      return this.forbidden(res, 'You don\'t have permission to modify this resource.');
    }

    req.resource = resource;
    next();
  }

  // Helper methods
  badRequest(res, message) {
    return res.status(400).json({ success: false, error: message });
  }

  notFound(res, message) {
    return res.status(404).json({ success: false, error: message });
  }

  forbidden(res, message) {
    return res.status(403).json({ success: false, error: message });
  }

  serverError(res, message) {
    return res.status(500).json({ success: false, error: message });
  }
}

module.exports = new ResourceOwnerMiddleware();