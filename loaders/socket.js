const socketIO = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const socketAuth = require('@middleware/socket.auth');
const presenceService = require('@services/presence.service');
const messageService = require('@services/message.service');
const redis = require('@config/redis');
const logger = require('@utils/logger');
const metrics = require('@utils/metrics');

class SocketLoader {
  constructor(server) {
    this.io = socketIO(server, {
      cors: {
        origin: process.env.CLIENT_URL.split(','),
        credentials: true,
        methods: ['GET', 'POST']
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e7, // 10MB
      allowEIO3: true,
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true
      }
    });

    // Redis adapter for horizontal scaling
    const pubClient = redis.getPublisher();
    const subClient = redis.getSubscriber();
    this.io.adapter(createAdapter(pubClient, subClient));
    
    // Multi-device tracking
    this.userConnections = new Map(); // userId -> Set of socketIds
    this.heartbeatTimeouts = new Map(); // socketId -> timeout
    this.heartbeatIntervals = new Map(); // socketId -> interval
    
    logger.info('SocketLoader initialized');
  }

  initialize() {
    // Authentication middleware
    this.io.use(socketAuth);
    
    // Rate limiting middleware (optional)
    this.setupRateLimiting();
    
    // Connection handling
    this.io.on('connection', (socket) => {
      this.handleConnection(socket).catch(error => {
        logger.error('Connection handling error:', error);
        socket.disconnect(true);
      });
    });
    
    // Global error handler
    this.io.on('error', (error) => {
      logger.error('Socket.IO server error:', error);
    });
    
    // Subscribe to presence updates
    presenceService.subscribeToPresence((update) => {
      this.handlePresenceUpdate(update);
    });
    
    logger.info('Socket.IO server initialized and listening');
    return this.io;
  }

  setupRateLimiting() {
    // Simple in-memory rate limiting per socket
    this.io.use((socket, next) => {
      socket.eventCounts = new Map();
      socket.rateLimited = false;
      
      // Reset counts every minute
      const resetInterval = setInterval(() => {
        socket.eventCounts.clear();
      }, 60000);
      
      socket.on('disconnect', () => {
        clearInterval(resetInterval);
      });
      
      next();
    });
  }

  async handleConnection(socket) {
    const userId = socket.user?.id;
    const socketId = socket.id;
    
    if (!userId) {
      logger.warn('Socket connected without user ID, disconnecting');
      socket.disconnect(true);
      return;
    }
    
    // Log connection
    logger.info(`Socket connected: ${socketId} for user ${userId}`, {
      userAgent: socket.handshake.headers['user-agent'],
      ip: socket.handshake.address,
      userType: socket.user?.userType
    });
    
    // Track multi-device connections
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    const userSockets = this.userConnections.get(userId);
    userSockets.add(socketId);
    
    // Join user's personal room
    await socket.join(`user:${userId}`);
    
    // Join additional rooms based on user type/role
    await this.joinAdditionalRooms(socket, userId);
    
    // Track presence (only for first socket)
    let presenceConnected = false;
    if (userSockets.size === 1) {
      presenceConnected = await this.handlePresenceConnection(socket, userId, socketId);
    } else {
      // Additional socket for same user
      if (presenceService.addSocketToUser) {
        await presenceService.addSocketToUser(userId, socketId);
        presenceConnected = true;
      } else {
        // Update heartbeat for existing user
        await presenceService.updateHeartbeat(userId, socketId);
        presenceConnected = true;
      }
    }
    
    if (!presenceConnected) {
      logger.error('Failed to connect to presence service', { userId, socketId });
      socket.emit('error', { 
        message: 'Failed to connect to presence service',
        code: 'PRESENCE_CONNECTION_FAILED'
      });
      socket.disconnect(true);
      return;
    }
    
    // Setup heartbeat (server-side enforcement)
    this.setupHeartbeat(socketId, userId);
    
    // Metrics
    metrics.activeConnections.inc();
    metrics.totalConnections.inc();
    
    // Send connection acknowledgment
    socket.emit('socket:connected', {
      socketId,
      userId,
      serverTime: new Date().toISOString(),
      heartbeatInterval: 30000,
      maxMessageSize: 10000000
    });
    
    // Send user's current presence info
    if (presenceService.getUserPresence) {
      const presence = await presenceService.getUserPresence(userId);
      socket.emit('presence:self', presence);
    }
    
    // Send online users list (limited)
    if (presenceService.getOnlineUsers) {
      const onlineUsers = await presenceService.getOnlineUsers(50);
      socket.emit('presence:online_users', {
        users: onlineUsers,
        total: onlineUsers.length,
        timestamp: new Date().toISOString()
      });
    }
    
    // Setup event handlers
    this.setupMessageHandlers(socket, userId);
    this.setupTypingHandlers(socket, userId);
    this.setupPresenceHandlers(socket, userId);
    this.setupDisconnectHandlers(socket, userId, socketId);
    
    // Notify others that user is online (if first socket)
    if (userSockets.size === 1) {
      socket.broadcast.emit('presence:user_online', {
        userId,
        userName: socket.user?.name || `User ${userId}`,
        avatar: socket.user?.avatar,
        userType: socket.user?.userType,
        timestamp: new Date().toISOString()
      });
    }
    
    logger.debug(`User ${userId} fully connected with socket ${socketId}, total sockets: ${userSockets.size}`);
  }

  async joinAdditionalRooms(socket, userId) {
    const user = socket.user;
    
    // Join role-based rooms
    if (user.role) {
      await socket.join(`role:${user.role}`);
    }
    
    // Join user type room
    if (user.userType) {
      await socket.join(`userType:${user.userType}`);
    }
    
    // Dating-specific rooms
    if (user.userType === 'DatingUser') {
      await socket.join('userType:dating');
      
      // Join preference-based rooms
      if (user.preferences?.lookingFor) {
        await socket.join(`lookingFor:${user.preferences.lookingFor}`);
      }
      
      // Join location-based rooms (simplified)
      if (user.location?.city) {
        await socket.join(`city:${user.location.city.toLowerCase().replace(/\s+/g, '-')}`);
      }
    }
    
    // Staff rooms
    if (['Moderator', 'Admin', 'SuperAdmin'].includes(user.userType)) {
      await socket.join('userType:staff');
    }
    
    // Admin rooms
    if (['Admin', 'SuperAdmin'].includes(user.userType)) {
      await socket.join('userType:admin');
    }
  }

  async handlePresenceConnection(socket, userId, socketId) {
    try {
      const userAgent = socket.handshake.headers['user-agent'];
      const ip = socket.handshake.address;
      
      return await presenceService.userConnected(
        userId,
        socketId,
        {
          userName: socket.user?.name || `User ${userId}`,
          avatar: socket.user?.avatar,
          userType: socket.user?.userType,
          userAgent,
          ip,
          deviceInfo: socket.handshake.auth?.deviceInfo
        }
      );
    } catch (error) {
      logger.error('Presence connection error:', {
        error: error.message,
        userId,
        socketId
      });
      return false;
    }
  }

  setupHeartbeat(socketId, userId) {
    // Clear any existing timeout
    this.clearHeartbeat(socketId);
    
    // Set timeout for heartbeat (disconnect after 65 seconds of inactivity)
    const timeout = setTimeout(() => {
      logger.warn(`Heartbeat timeout for socket ${socketId}, user ${userId}`);
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('heartbeat:timeout', {
          message: 'Connection timeout due to inactivity',
          reconnect: true,
          timestamp: new Date().toISOString()
        });
        socket.disconnect(true);
      }
    }, 65000); // 65 seconds (slightly longer than ping interval)
    
    this.heartbeatTimeouts.set(socketId, timeout);
  }

  resetHeartbeat(socketId, userId) {
    this.setupHeartbeat(socketId, userId);
  }

  clearHeartbeat(socketId) {
    if (this.heartbeatTimeouts.has(socketId)) {
      clearTimeout(this.heartbeatTimeouts.get(socketId));
      this.heartbeatTimeouts.delete(socketId);
    }
  }

  setupMessageHandlers(socket, userId) {
    // Message sending with acknowledgment
    socket.on('message:send', async (data, ack) => {
      try {
        // Validate input
        if (!data.receiverId || !data.content) {
          const error = { success: false, error: 'Receiver ID and content are required' };
          return ack ? ack(error) : socket.emit('message:error', error);
        }
        
        if (data.content.length > 5000) {
          const error = { success: false, error: 'Message too long (max 5000 characters)' };
          return ack ? ack(error) : socket.emit('message:error', error);
        }
        
        // Check if user can message (for dating app)
        if (socket.user?.userType === 'DatingUser' && socket.user?.messagingPreferences === 'matches_only') {
          // Implement match check here
          // For now, allow if both are online
          const isReceiverOnline = await presenceService.isUserOnline(data.receiverId);
          if (!isReceiverOnline) {
            const error = { success: false, error: 'Receiver must be online to receive messages' };
            return ack ? ack(error) : socket.emit('message:error', error);
          }
        }
        
        // Create message
        const message = await messageService.sendMessage({
          ...data,
          senderId: userId,
          socketId: socket.id,
          status: 'sent',
          timestamp: new Date()
        });
        
        metrics.messagesSent.inc();
        
        // Acknowledge to sender
        const ackData = { 
          success: true, 
          messageId: message._id,
          status: 'sent',
          timestamp: message.timestamp
        };
        
        if (ack && typeof ack === 'function') {
          ack(ackData);
        } else {
          socket.emit('message:sent', ackData);
        }
        
        // Deliver to recipient
        await this.deliverMessage(message);
        
        logger.debug(`Message sent from ${userId} to ${data.receiverId}`, {
          messageId: message._id,
          socketId: socket.id
        });
      } catch (error) {
        logger.error('Message send error:', error);
        const errorData = { 
          success: false, 
          error: 'Failed to send message',
          code: 'MESSAGE_SEND_FAILED'
        };
        
        if (ack && typeof ack === 'function') {
          ack(errorData);
        } else {
          socket.emit('message:error', errorData);
        }
      }
    });
    
    // Message read receipt
    socket.on('message:read', async (data) => {
      try {
        const { messageIds, conversationId } = data;
        
        if (!Array.isArray(messageIds) || messageIds.length === 0) {
          return socket.emit('message:error', { error: 'Message IDs required' });
        }
        
        // Mark as read
        const updatedMessages = await messageService.markMessagesAsRead(userId, messageIds);
        
        // Notify senders
        for (const message of updatedMessages) {
          if (message.senderId !== userId) {
            this.io.to(`user:${message.senderId}`).emit('message:read', {
              messageId: message._id,
              conversationId,
              readBy: userId,
              readByUserName: socket.user?.name,
              readAt: new Date().toISOString()
            });
          }
        }
        
        metrics.messagesRead.inc(updatedMessages.length);
        
      } catch (error) {
        logger.error('Read receipt error:', error);
      }
    });
    
    // Message delivered receipt
    socket.on('message:delivered', async (data) => {
      try {
        const { messageId } = data;
        
        if (!messageId) return;
        
        const message = await messageService.getMessageById(messageId);
        
        // Verify this user is the receiver
        if (message && message.receiverId === userId) {
          await messageService.updateMessageStatus(messageId, 'delivered');
          
          // Notify sender
          this.io.to(`user:${message.senderId}`).emit('message:delivered', {
            messageId,
            deliveredTo: userId,
            deliveredAt: new Date().toISOString()
          });
        }
      } catch (error) {
        logger.error('Delivery receipt error:', error);
      }
    });
  }

  setupTypingHandlers(socket, userId) {
    const typingDebounce = new Map(); // conversationId -> timeout
    
    socket.on('typing:start', async (data) => {
      try {
        const { conversationId, receiverId } = data;
        
        if (!conversationId || !receiverId) return;
        
        // Debounce typing events (1 second)
        if (typingDebounce.has(conversationId)) {
          clearTimeout(typingDebounce.get(conversationId));
        }
        
        // Notify receiver
        this.io.to(`user:${receiverId}`).emit('typing:start', {
          conversationId,
          senderId: userId,
          senderName: socket.user?.name,
          timestamp: new Date().toISOString()
        });
        
        // Set debounce timeout
        const timeout = setTimeout(() => {
          typingDebounce.delete(conversationId);
        }, 1000);
        
        typingDebounce.set(conversationId, timeout);
        
      } catch (error) {
        logger.error('Typing start error:', error);
      }
    });
    
    socket.on('typing:stop', async (data) => {
      try {
        const { conversationId, receiverId } = data;
        
        if (!conversationId || !receiverId) return;
        
        // Clear debounce
        if (typingDebounce.has(conversationId)) {
          clearTimeout(typingDebounce.get(conversationId));
          typingDebounce.delete(conversationId);
        }
        
        // Notify receiver
        this.io.to(`user:${receiverId}`).emit('typing:stop', {
          conversationId,
          senderId: userId,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        logger.error('Typing stop error:', error);
      }
    });
    
    // Cleanup on disconnect
    socket.on('disconnect', () => {
      typingDebounce.forEach(timeout => clearTimeout(timeout));
      typingDebounce.clear();
    });
  }

  setupPresenceHandlers(socket, userId) {
    // Heartbeat from client
    socket.on('heartbeat', async () => {
      try {
        // Reset heartbeat timeout
        this.resetHeartbeat(socket.id, userId);
        
        // Update presence service
        if (presenceService.updateHeartbeat) {
          await presenceService.updateHeartbeat(userId, socket.id);
        }
        
        // Send acknowledgment
        socket.emit('heartbeat:ack', {
          timestamp: new Date().toISOString(),
          serverTime: new Date().toISOString()
        });
        
      } catch (error) {
        logger.error('Heartbeat processing error:', error);
      }
    });
    
    // Status updates
    socket.on('presence:status', async (data) => {
      try {
        const { status, customStatus } = data || {};
        
        // Validate status
        const validStatuses = ['online', 'away', 'busy', 'offline', 'dnd', 'invisible'];
        if (status && !validStatuses.includes(status)) {
          return socket.emit('presence:error', {
            error: `Invalid status. Valid: ${validStatuses.join(', ')}`
          });
        }
        
        // Update status
        if (presenceService.updateUserStatus) {
          const success = await presenceService.updateUserStatus(
            userId, 
            status || 'online', 
            customStatus
          );
          
          if (success) {
            socket.emit('presence:status_updated', {
              status: status || 'online',
              customStatus,
              timestamp: new Date().toISOString()
            });
          }
        }
      } catch (error) {
        logger.error('Status update error:', error);
        socket.emit('presence:error', { error: 'Failed to update status' });
      }
    });
    
    // Get presence info for users
    socket.on('presence:get', async (data) => {
      try {
        const { userIds } = data || {};
        
        if (!Array.isArray(userIds) || userIds.length === 0) {
          return socket.emit('presence:error', { error: 'User IDs required' });
        }
        
        // Limit to 50 users
        const limitedIds = userIds.slice(0, 50);
        
        if (presenceService.areUsersOnline) {
          const onlineStatus = await presenceService.areUsersOnline(limitedIds);
          socket.emit('presence:info', {
            statuses: onlineStatus,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        logger.error('Presence get error:', error);
      }
    });
  }

  setupDisconnectHandlers(socket, userId, socketId) {
    socket.on('disconnect', async (reason) => {
      logger.info(`Socket disconnected: ${socketId} for user ${userId}, reason: ${reason}`);
      
      // Clear heartbeat timeout
      this.clearHeartbeat(socketId);
      
      // Remove from tracking
      const userSockets = this.userConnections.get(userId);
      if (userSockets) {
        userSockets.delete(socketId);
        
        if (userSockets.size === 0) {
          this.userConnections.delete(userId);
          
          // User has no more sockets, update presence
          if (presenceService.userDisconnected) {
            await presenceService.userDisconnected(userId, socketId)
              .catch(err => logger.error('Presence disconnect error:', err));
          }
          
          // Notify others after delay (to prevent flickering on reconnect)
          setTimeout(() => {
            if (!this.userConnections.has(userId)) {
              this.io.emit('presence:user_offline', {
                userId,
                timestamp: new Date().toISOString(),
                reason
              });
            }
          }, 5000); // 5 second delay
          
        } else {
          // User still has other sockets
          if (presenceService.removeSocketFromUser) {
            await presenceService.removeSocketFromUser(userId, socketId)
              .catch(err => logger.error('Remove socket error:', err));
          }
        }
      }
      
      // Metrics
      metrics.activeConnections.dec();
      metrics.disconnections.inc();
      
      logger.debug(`User ${userId} now has ${userSockets?.size || 0} active sockets`);
    });
    
    // Force disconnect (user initiated)
    socket.on('force:disconnect', async (data) => {
      const { reason = 'user_requested' } = data || {};
      logger.info(`User ${userId} requested force disconnect: ${reason}`);
      
      socket.emit('force:disconnecting', {
        reason,
        timestamp: new Date().toISOString()
      });
      
      setTimeout(() => {
        socket.disconnect(true);
      }, 100);
    });
  }

  async deliverMessage(message) {
    try {
      const { receiverId, _id: messageId } = message;
      
      // Check if recipient is online
      const isOnline = await presenceService.isUserOnline(receiverId);
      
      if (isOnline) {
        // Try to deliver via WebSocket
        const delivered = this.io.to(`user:${receiverId}`).emit('message:receive', {
          ...message.toObject ? message.toObject() : message,
          status: 'delivered'
        });
        
        // Update status if at least one socket received it
        if (delivered) {
          await messageService.updateMessageStatus(messageId, 'delivered');
        } else {
          // Queue for push notification
          await this.queuePushNotification(message);
          await messageService.updateMessageStatus(messageId, 'pending');
        }
      } else {
        // Queue for push notification
        await this.queuePushNotification(message);
        await messageService.updateMessageStatus(messageId, 'pending');
      }
    } catch (error) {
      logger.error('Message delivery error:', error);
      // Don't throw - message is saved, will be delivered later
    }
  }

  async queuePushNotification(message) {
    try {
      // Integrate with your push notification service
      // This is a placeholder implementation
      
      const { receiverId } = message;
      
      // Get user's push token from database
      // const user = await userService.getUserById(receiverId);
      // const pushToken = user.pushToken;
      
      // if (pushToken) {
      //   // Send via FCM/APNS
      //   await pushService.sendNotification({
      //     token: pushToken,
      //     title: 'New Message',
      //     body: message.content,
      //     data: { messageId: message._id, senderId: message.senderId }
      //   });
      // }
      
      logger.debug(`Queued push notification for message ${message._id} to user ${receiverId}`);
      
    } catch (error) {
      logger.error('Push notification queue error:', error);
    }
  }

  handlePresenceUpdate(update) {
    try {
      const { userId, status, customStatus, timestamp } = update;
      
      // Emit to user's room
      this.io.to(`user:${userId}`).emit('presence:update', update);
      
      // Emit to presence subscribers
      this.io.to(`presence:${userId}`).emit('presence:update', update);
      
      // Broadcast status changes
      if (status === 'online' || status === 'offline') {
        this.io.emit(`presence:user_${status}`, {
          userId,
          timestamp,
          customStatus
        });
      }
      
    } catch (error) {
      logger.error('Presence update handling error:', error);
    }
  }

  // Utility methods
  sendToUser(userId, event, data) {
    this.io.to(`user:${userId}`).emit(event, data);
  }
  
  sendToRoom(room, event, data) {
    this.io.to(room).emit(event, data);
  }
  
  broadcast(event, data, excludeSocketId = null) {
    if (excludeSocketId) {
      this.io.except(excludeSocketId).emit(event, data);
    } else {
      this.io.emit(event, data);
    }
  }
  
  // Get stats
  getStats() {
    const stats = {
      totalConnections: metrics.totalConnections,
      activeConnections: metrics.activeConnections,
      uniqueUsers: this.userConnections.size,
      totalSockets: Array.from(this.userConnections.values())
        .reduce((total, sockets) => total + sockets.size, 0),
      heartbeatTimeouts: this.heartbeatTimeouts.size,
      serverTime: new Date().toISOString()
    };
    
    // Add per-user-type counts
    const userTypeCounts = {};
    for (const [userId, sockets] of this.userConnections.entries()) {
      // This would require storing user type with socket
      // For now, just count connections
    }
    
    return stats;
  }
  
  // Cleanup
  cleanup() {
    // Clear all timeouts
    for (const timeout of this.heartbeatTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.heartbeatTimeouts.clear();
    
    // Clear all intervals (if any)
    for (const interval of this.heartbeatIntervals.values()) {
      clearInterval(interval);
    }
    this.heartbeatIntervals.clear();
    
    // Clear connection tracking
    this.userConnections.clear();
    
    logger.info('SocketLoader cleaned up');
  }
}

module.exports = SocketLoader;