const logger = require("@utils/logger") || console;
const EventEmitter = require('events');

class WebSocketEmitter extends EventEmitter {
  constructor() {
    super();
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
    this.pendingEmits = new Map(); // For tracking pending emits
  }

  // ========== MESSAGE EMITTERS ==========
  
  async emitMessage(socketHelpers, messageData, options = {}) {
    const {
      conversationId,
      receiverId,
      excludeSender = true,
      requireOnline = true,
      retry = true
    } = options;

    if (!socketHelpers?.io) {
      logger.warn("⚠️ Cannot emit message: Socket.IO not available");
      return { success: false, error: 'Socket.IO not available' };
    }

    try {
      const messageId = messageData._id || messageData.id || `msg_${Date.now()}`;
      const senderId = messageData.senderId;
      
      // Prepare message payload
      const payload = {
        ...messageData,
        _id: messageId,
        emittedAt: new Date().toISOString(),
        type: messageData.type || 'text'
      };

      let results = {
        success: false,
        deliveredTo: [],
        queuedFor: [],
        failedFor: [],
        messageId
      };

      // Emit to conversation room if conversationId provided
      if (conversationId) {
        const roomResult = await this.emitToConversationRoom(
          socketHelpers,
          payload,
          conversationId,
          senderId,
          excludeSender
        );
        Object.assign(results, roomResult);
      }

      // Emit directly to receiver if receiverId provided
      if (receiverId) {
        const userResult = await this.emitToUser(
          socketHelpers,
          payload,
          receiverId,
          requireOnline,
          options.redisHelper
        );
        
        // Merge results
        results.deliveredTo.push(...userResult.deliveredTo);
        results.queuedFor.push(...userResult.queuedFor);
        results.failedFor.push(...userResult.failedFor);
        results.success = results.success || userResult.success;
      }

      // If no specific targets, broadcast to all
      if (!conversationId && !receiverId) {
        logger.warn("⚠️ No target specified for message emit");
      }

      // Emit event for monitoring
      this.emit('message:emitted', {
        messageId,
        results,
        timestamp: new Date().toISOString()
      });

      logger.debug(`📡 Message ${messageId} emitted`, {
        delivered: results.deliveredTo.length,
        queued: results.queuedFor.length,
        failed: results.failedFor.length
      });

      return results;

    } catch (error) {
      logger.error("❌ Failed to emit message:", error);
      
      // Retry logic
      if (retry) {
        return await this.retryEmit(() => 
          this.emitMessage(socketHelpers, messageData, { ...options, retry: false })
        );
      }
      
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async emitToConversationRoom(socketHelpers, messageData, conversationId, senderId, excludeSender = true) {
    const conversationRoom = `conversation:${conversationId}`;
    const results = {
      success: false,
      deliveredTo: [],
      queuedFor: [],
      failedFor: []
    };

    try {
      // Get sockets in conversation room
      const sockets = await socketHelpers.io.in(conversationRoom).fetchSockets();
      
      // Filter out sender if needed
      const targetSockets = excludeSender 
        ? sockets.filter(s => s.userId !== senderId)
        : sockets;

      if (targetSockets.length === 0) {
        logger.debug(`No recipients in conversation room: ${conversationRoom}`);
        return results;
      }

      // Emit to each socket
      for (const socket of targetSockets) {
        const socketEmit = socket.emit('message:new', messageData);
        
        if (socketEmit) {
          results.deliveredTo.push({
            userId: socket.userId,
            socketId: socket.id,
            deliveredAt: new Date().toISOString()
          });
        } else {
          results.failedFor.push({
            userId: socket.userId,
            socketId: socket.id,
            reason: 'Emit failed'
          });
        }
      }

      results.success = results.deliveredTo.length > 0;
      
      // Also emit to room for any late joiners
      socketHelpers.io.to(conversationRoom).emit('message:new', messageData);

      logger.debug(`📡 Emitted to ${results.deliveredTo.length} user(s) in conversation ${conversationId}`);
      
    } catch (error) {
      logger.error(`Failed to emit to conversation ${conversationId}:`, error);
      results.error = error.message;
    }

    return results;
  }

  async emitToUser(socketHelpers, messageData, receiverId, requireOnline = true, redisHelper = null) {
    const results = {
      success: false,
      deliveredTo: [],
      queuedFor: [],
      failedFor: []
    };

    try {
      // Check if user is online
      const isOnline = socketHelpers.isUserOnline 
        ? await socketHelpers.isUserOnline(receiverId)
        : false;

      if (isOnline) {
        // Emit to user's personal room
        const userRoom = `user:${receiverId}`;
        const emitResult = socketHelpers.io.to(userRoom).emit('message:new', messageData);
        
        if (emitResult) {
          results.deliveredTo.push({
            userId: receiverId,
            deliveredAt: new Date().toISOString(),
            via: 'websocket'
          });
          results.success = true;
        } else {
          results.failedFor.push({
            userId: receiverId,
            reason: 'Emit returned false'
          });
        }
      } else if (!requireOnline && redisHelper) {
        // Queue for offline delivery
        if (redisHelper.queueOfflineMessage) {
          await redisHelper.queueOfflineMessage(receiverId, messageData);
          results.queuedFor.push({
            userId: receiverId,
            queuedAt: new Date().toISOString(),
            via: 'redis'
          });
          results.success = true;
        } else {
          results.failedFor.push({
            userId: receiverId,
            reason: 'Redis helper not available'
          });
        }
      } else if (!requireOnline) {
        // User offline and no queueing available
        results.failedFor.push({
          userId: receiverId,
          reason: 'User offline and no queueing available'
        });
      } else {
        // User must be online but isn't
        results.failedFor.push({
          userId: receiverId,
          reason: 'User not online'
        });
      }

    } catch (error) {
      logger.error(`Failed to emit to user ${receiverId}:`, error);
      results.error = error.message;
    }

    return results;
  }

  // ========== READ RECEIPTS ==========
  
  async emitReadReceipt(socketHelpers, messageIds, readerId, options = {}) {
    const {
      conversationId,
      receiverId,
      senderId,
      notifySender = true
    } = options;

    if (!socketHelpers?.io) {
      return { success: false, error: 'Socket.IO not available' };
    }

    try {
      const receiptData = {
        messageIds: Array.isArray(messageIds) ? messageIds : [messageIds],
        readerId,
        readAt: new Date().toISOString(),
        conversationId,
        timestamp: new Date().toISOString()
      };

      let results = {
        success: false,
        notified: [],
        failed: []
      };

      // Notify sender if specified
      if (notifySender && senderId) {
        const senderNotified = await this.emitToUser(
          socketHelpers,
          { type: 'messages:read', data: receiptData },
          senderId,
          false // Don't require online
        );
        
        if (senderNotified.success) {
          results.notified.push({
            userId: senderId,
            type: 'sender',
            timestamp: new Date().toISOString()
          });
        } else {
          results.failed.push({
            userId: senderId,
            reason: 'Failed to notify sender'
          });
        }
      }

      // Emit to conversation room
      if (conversationId) {
        const conversationRoom = `conversation:${conversationId}`;
        const emitResult = socketHelpers.io.to(conversationRoom).emit('messages:read', receiptData);
        
        if (emitResult) {
          results.notified.push({
            type: 'conversation',
            conversationId,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Direct emit to receiver (for 1:1 chats)
      if (receiverId && receiverId !== readerId) {
        const receiverNotified = await this.emitToUser(
          socketHelpers,
          { type: 'messages:read:ack', data: receiptData },
          receiverId,
          false
        );
        
        if (receiverNotified.success) {
          results.notified.push({
            userId: receiverId,
            type: 'receiver',
            timestamp: new Date().toISOString()
          });
        }
      }

      results.success = results.notified.length > 0;
      
      logger.debug(`👁️ Read receipt emitted for ${receiptData.messageIds.length} message(s)`);
      
      return results;

    } catch (error) {
      logger.error("❌ Failed to emit read receipt:", error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // ========== MESSAGE UPDATES ==========
  
  async emitMessageDeleted(socketHelpers, messageId, deletedBy, options = {}) {
    const {
      conversationId,
      receiverId,
      senderId,
      reason = 'user_deleted'
    } = options;

    if (!socketHelpers?.io) {
      return { success: false, error: 'Socket.IO not available' };
    }

    try {
      const deleteData = {
        messageId,
        deletedBy,
        reason,
        timestamp: new Date().toISOString(),
        conversationId
      };

      let results = {
        success: false,
        notified: []
      };

      // Notify other user in conversation
      if (conversationId) {
        const conversationRoom = `conversation:${conversationId}`;
        socketHelpers.io.to(conversationRoom).emit('message:deleted', deleteData);
        results.notified.push({
          type: 'conversation',
          conversationId
        });
      }

      // Direct notify specific users
      const usersToNotify = [receiverId, senderId].filter(Boolean);
      for (const userId of usersToNotify) {
        if (userId !== deletedBy) {
          const userRoom = `user:${userId}`;
          socketHelpers.io.to(userRoom).emit('message:deleted', deleteData);
          results.notified.push({
            type: 'user',
            userId
          });
        }
      }

      results.success = results.notified.length > 0;
      
      logger.debug(`🗑️ Message ${messageId} deleted event emitted`);
      
      return results;

    } catch (error) {
      logger.error("❌ Failed to emit delete event:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async emitMessageEdited(socketHelpers, messageId, content, editedBy, options = {}) {
    const {
      conversationId,
      receiverId,
      editedAt = new Date().toISOString()
    } = options;

    if (!socketHelpers?.io) {
      return { success: false, error: 'Socket.IO not available' };
    }

    try {
      const editData = {
        messageId,
        content,
        editedBy,
        editedAt,
        timestamp: new Date().toISOString(),
        conversationId
      };

      let results = {
        success: false,
        notified: []
      };

      // Emit to conversation
      if (conversationId) {
        const conversationRoom = `conversation:${conversationId}`;
        socketHelpers.io.to(conversationRoom).emit('message:edited', editData);
        results.notified.push({
          type: 'conversation',
          conversationId
        });
      }

      // Direct notify receiver
      if (receiverId && receiverId !== editedBy) {
        const userRoom = `user:${receiverId}`;
        socketHelpers.io.to(userRoom).emit('message:edited', editData);
        results.notified.push({
          type: 'user',
          userId: receiverId
        });
      }

      results.success = results.notified.length > 0;
      
      logger.debug(`✏️ Message ${messageId} edit event emitted`);
      
      return results;

    } catch (error) {
      logger.error("❌ Failed to emit edit event:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ========== REACTIONS ==========
  
  async emitReaction(socketHelpers, messageId, userId, reaction, action = 'add', options = {}) {
    const {
      conversationId,
      receiverId,
      messageSenderId
    } = options;

    if (!socketHelpers?.io) {
      return { success: false, error: 'Socket.IO not available' };
    }

    try {
      const reactionData = {
        messageId,
        userId,
        reaction,
        action,
        timestamp: new Date().toISOString(),
        conversationId
      };

      let results = {
        success: false,
        notified: []
      };

      // Emit to conversation
      if (conversationId) {
        const conversationRoom = `conversation:${conversationId}`;
        socketHelpers.io.to(conversationRoom).emit('message:reaction', reactionData);
        results.notified.push({
          type: 'conversation',
          conversationId
        });
      }

      // Notify message sender about reaction (if different user)
      if (messageSenderId && messageSenderId !== userId) {
        const senderRoom = `user:${messageSenderId}`;
        socketHelpers.io.to(senderRoom).emit('message:reaction', reactionData);
        results.notified.push({
          type: 'user',
          userId: messageSenderId,
          reason: 'message_sender'
        });
      }

      // Notify receiver (for 1:1)
      if (receiverId && receiverId !== userId) {
        const receiverRoom = `user:${receiverId}`;
        socketHelpers.io.to(receiverRoom).emit('message:reaction', reactionData);
        results.notified.push({
          type: 'user',
          userId: receiverId
        });
      }

      results.success = results.notified.length > 0;
      
      logger.debug(`😊 Reaction ${action} emitted for message ${messageId}`);
      
      return results;

    } catch (error) {
      logger.error("❌ Failed to emit reaction:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ========== DATING APP SPECIFIC EMITTERS ==========
  
  async emitMatchNotification(socketHelpers, matchData, options = {}) {
    const { user1Id, user2Id, matchedAt, matchType = 'mutual' } = matchData;
    
    if (!socketHelpers?.io) {
      return { success: false, error: 'Socket.IO not available' };
    }

    try {
      const notificationData = {
        type: 'match',
        matchId: matchData.matchId || `match_${Date.now()}`,
        user1Id,
        user2Id,
        matchedAt: matchedAt || new Date().toISOString(),
        matchType,
        timestamp: new Date().toISOString()
      };

      let results = {
        success: false,
        notified: []
      };

      // Notify both users
      const users = [user1Id, user2Id];
      for (const userId of users) {
        const userRoom = `user:${userId}`;
        const emitResult = socketHelpers.io.to(userRoom).emit('dating:match', notificationData);
        
        if (emitResult) {
          results.notified.push({
            userId,
            type: 'match_notification'
          });
        }
      }

      results.success = results.notified.length === users.length;
      
      logger.debug(`❤️ Match notification emitted for ${user1Id} and ${user2Id}`);
      
      return results;

    } catch (error) {
      logger.error("❌ Failed to emit match notification:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async emitLikeNotification(socketHelpers, likeData, options = {}) {
    const { senderId, receiverId, likeType = 'like', isSuperLike = false } = likeData;
    
    if (!socketHelpers?.io) {
      return { success: false, error: 'Socket.IO not available' };
    }

    try {
      const notificationData = {
        type: 'like',
        likeId: likeData.likeId || `like_${Date.now()}`,
        senderId,
        receiverId,
        likeType,
        isSuperLike,
        timestamp: new Date().toISOString(),
        ...options.metadata
      };

      // Notify receiver
      const receiverRoom = `user:${receiverId}`;
      const emitResult = socketHelpers.io.to(receiverRoom).emit('dating:like', notificationData);
      
      const results = {
        success: !!emitResult,
        notified: emitResult ? [{ userId: receiverId, type: 'like_notification' }] : [],
        timestamp: new Date().toISOString()
      };
      
      logger.debug(`👍 ${isSuperLike ? 'Super ' : ''}Like notification emitted to ${receiverId}`);
      
      return results;

    } catch (error) {
      logger.error("❌ Failed to emit like notification:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async emitIcebreakerNotification(socketHelpers, icebreakerData, options = {}) {
    const { senderId, receiverId, icebreakerId, question, answer } = icebreakerData;
    
    if (!socketHelpers?.io) {
      return { success: false, error: 'Socket.IO not available' };
    }

    try {
      const notificationData = {
        type: 'icebreaker',
        icebreakerId: icebreakerData.icebreakerId || `icebreaker_${Date.now()}`,
        senderId,
        receiverId,
        question,
        answer,
        timestamp: new Date().toISOString()
      };

      // Notify receiver
      const receiverRoom = `user:${receiverId}`;
      const emitResult = socketHelpers.io.to(receiverRoom).emit('dating:icebreaker', notificationData);
      
      const results = {
        success: !!emitResult,
        notified: emitResult ? [{ userId: receiverId, type: 'icebreaker_notification' }] : [],
        timestamp: new Date().toISOString()
      };
      
      logger.debug(`❄️ Icebreaker notification emitted to ${receiverId}`);
      
      return results;

    } catch (error) {
      logger.error("❌ Failed to emit icebreaker notification:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async emitProfileViewNotification(socketHelpers, viewData, options = {}) {
    const { viewerId, viewedUserId, isAnonymous = false } = viewData;
    
    if (!socketHelpers?.io) {
      return { success: false, error: 'Socket.IO not available' };
    }

    try {
      const notificationData = {
        type: 'profile_view',
        viewId: viewData.viewId || `view_${Date.now()}`,
        viewerId: isAnonymous ? null : viewerId,
        viewedUserId,
        isAnonymous,
        viewedAt: new Date().toISOString(),
        timestamp: new Date().toISOString()
      };

      // Notify viewed user (unless anonymous)
      if (!isAnonymous) {
        const viewedUserRoom = `user:${viewedUserId}`;
        const emitResult = socketHelpers.io.to(viewedUserRoom).emit('dating:profile_view', notificationData);
        
        const results = {
          success: !!emitResult,
          notified: emitResult ? [{ userId: viewedUserId, type: 'profile_view_notification' }] : [],
          timestamp: new Date().toISOString()
        };
        
        logger.debug(`👀 Profile view notification emitted to ${viewedUserId}`);
        
        return results;
      }
      
      return {
        success: true,
        notified: [],
        anonymous: true,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error("❌ Failed to emit profile view notification:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ========== PRESENCE EMITTERS ==========
  
  async emitPresenceUpdate(socketHelpers, userId, status, options = {}) {
    const {
      customStatus = '',
      userType = 'user',
      broadcast = true
    } = options;

    if (!socketHelpers?.io) {
      return { success: false, error: 'Socket.IO not available' };
    }

    try {
      const presenceData = {
        userId,
        status,
        customStatus,
        userType,
        timestamp: new Date().toISOString(),
        lastSeen: status === 'offline' ? new Date().toISOString() : undefined
      };

      let results = {
        success: false,
        notified: []
      };

      // Update user's own presence
      const userRoom = `user:${userId}`;
      socketHelpers.io.to(userRoom).emit('presence:update', presenceData);
      results.notified.push({
        type: 'self',
        userId
      });

      // Notify presence subscribers
      const presenceSubscribersRoom = `presence:${userId}`;
      socketHelpers.io.to(presenceSubscribersRoom).emit('presence:update', presenceData);
      results.notified.push({
        type: 'subscribers',
        room: presenceSubscribersRoom
      });

      // Broadcast to all if specified
      if (broadcast && (status === 'online' || status === 'offline')) {
        const broadcastEvent = status === 'online' ? 'presence:user_online' : 'presence:user_offline';
        socketHelpers.io.emit(broadcastEvent, presenceData);
        results.notified.push({
          type: 'broadcast',
          event: broadcastEvent
        });
      }

      results.success = true;
      
      logger.debug(`🟢 Presence update emitted for ${userId}: ${status}`);
      
      return results;

    } catch (error) {
      logger.error("❌ Failed to emit presence update:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ========== UTILITY METHODS ==========
  
  async retryEmit(emitFunction, maxRetries = this.maxRetries, delay = this.retryDelay) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await emitFunction();
        if (result.success) {
          logger.debug(`✅ Emit succeeded on attempt ${attempt}`);
          return result;
        }
        
        if (attempt < maxRetries) {
          logger.warn(`⚠️ Emit failed on attempt ${attempt}, retrying in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          // Exponential backoff
          delay *= 2;
        }
      } catch (error) {
        logger.error(`❌ Emit error on attempt ${attempt}:`, error);
        if (attempt === maxRetries) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
    
    return {
      success: false,
      error: `Failed after ${maxRetries} attempts`,
      timestamp: new Date().toISOString()
    };
  }

  async emitToRoom(socketHelpers, room, event, data, options = {}) {
    const { excludeSocketId, requireAck = false } = options;
    
    if (!socketHelpers?.io) {
      return { success: false, error: 'Socket.IO not available' };
    }

    try {
      let emitResult;
      
      if (excludeSocketId) {
        emitResult = socketHelpers.io.to(room).except(excludeSocketId).emit(event, data);
      } else {
        emitResult = socketHelpers.io.to(room).emit(event, data);
      }

      const results = {
        success: !!emitResult,
        event,
        room,
        timestamp: new Date().toISOString(),
        dataSize: JSON.stringify(data).length
      };

      if (requireAck) {
        // Implement acknowledgment logic if needed
        results.acknowledged = false;
        results.ackTimeout = setTimeout(() => {
          results.acknowledged = false;
        }, 5000);
      }

      logger.debug(`📡 Emitted ${event} to room ${room}`);
      
      return results;

    } catch (error) {
      logger.error(`❌ Failed to emit to room ${room}:`, error);
      return {
        success: false,
        error: error.message,
        event,
        room
      };
    }
  }

  // ========== BATCH OPERATIONS ==========
  
  async emitBatch(socketHelpers, emits, options = {}) {
    const { parallel = true, maxConcurrent = 10 } = options;
    
    if (!socketHelpers?.io) {
      return { success: false, error: 'Socket.IO not available' };
    }

    try {
      const results = [];
      
      if (parallel) {
        // Emit in parallel with concurrency limit
        const batches = [];
        for (let i = 0; i < emits.length; i += maxConcurrent) {
          batches.push(emits.slice(i, i + maxConcurrent));
        }
        
        for (const batch of batches) {
          const batchResults = await Promise.all(
            batch.map(async (emitConfig) => {
              const { type, ...config } = emitConfig;
              switch (type) {
                case 'message':
                  return await this.emitMessage(socketHelpers, config.data, config.options);
                case 'presence':
                  return await this.emitPresenceUpdate(socketHelpers, config.userId, config.status, config.options);
                case 'notification':
                  return await this.emitMatchNotification(socketHelpers, config.data, config.options);
                default:
                  return { success: false, error: `Unknown emit type: ${type}` };
              }
            })
          );
          results.push(...batchResults);
        }
      } else {
        // Emit sequentially
        for (const emitConfig of emits) {
          const { type, ...config } = emitConfig;
          let result;
          
          switch (type) {
            case 'message':
              result = await this.emitMessage(socketHelpers, config.data, config.options);
              break;
            case 'presence':
              result = await this.emitPresenceUpdate(socketHelpers, config.userId, config.status, config.options);
              break;
            case 'notification':
              result = await this.emitMatchNotification(socketHelpers, config.data, config.options);
              break;
            default:
              result = { success: false, error: `Unknown emit type: ${type}` };
          }
          
          results.push(result);
        }
      }
      
      const summary = {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
        timestamp: new Date().toISOString()
      };
      
      logger.debug(`📦 Batch emit completed: ${summary.successful}/${summary.total} successful`);
      
      return summary;

    } catch (error) {
      logger.error("❌ Batch emit failed:", error);
      return {
        success: false,
        error: error.message,
        total: emits.length,
        successful: 0,
        failed: emits.length
      };
    }
  }

  // Cleanup
  cleanup() {
    // Clear any pending timeouts
    for (const timeout of this.pendingEmits.values()) {
      clearTimeout(timeout);
    }
    this.pendingEmits.clear();
    
    // Remove all listeners
    this.removeAllListeners();
    
    logger.debug('WebSocketEmitter cleaned up');
  }
}

// Export singleton instance
module.exports = new WebSocketEmitter();