const socketIo = require('socket.io');
const logger = require('@utils/logger');

class WebSocketService {
  constructor(config, services, socketSchemas, logger, redisService) {
    this.config = config;
    this.services = services;
    this.socketSchemas = socketSchemas;
    this.logger = logger || console;
    this.redisService = redisService;
    this.io = null;
    this.presenceService = null;
    this.socketAuth = null;
    
    // Multi-device tracking
    this.connectedUsers = new Map(); // userId -> Set of socketIds
    this.typingDebounce = new Map(); // For broadcast storm protection
    this.heartbeatTimeouts = new Map(); // socketId -> timeout
    
    // Rate limiting for events
    this.eventRateLimits = new Map(); // socketId -> { event: count }
    this.rateLimitConfig = {
      'message:send': { max: 30, windowMs: 60000 }, // 30 messages per minute
      'typing:start': { max: 60, windowMs: 60000 }, // 60 typing events per minute
      'presence:heartbeat': { max: 120, windowMs: 60000 } // 120 heartbeats per minute
    };
    
    this.logger.info('WebSocket service initialized');
  }
  
  async setup(server, corsOrigins) {
    try {
      const corsOptions = {
        origin: corsOrigins || process.env.FRONTEND_URL || '*',
        methods: ['GET', 'POST'],
        credentials: true,
        allowedHeaders: [
          'Content-Type', 
          'Authorization', 
          'X-Requested-With', 
          'Accept', 
          'Origin'
        ]
      };
      
      this.io = socketIo(server, {
        cors: corsOptions,
        pingTimeout: 60000,
        pingInterval: 25000,
        connectionStateRecovery: {
          maxDisconnectionDuration: 2 * 60 * 1000,
          skipMiddlewares: true
        },
        transports: ['websocket', 'polling'],
        allowEIO3: true,
        maxHttpBufferSize: 1e7 // 10MB max message size
      });
      
      this.logger.info('✅ WebSocket server setup completed');
      return this.io;
    } catch (error) {
      this.logger.error('❌ Failed to setup WebSocket:', error);
      throw error;
    }
  }
  
  setupMiddleware() {
    if (!this.io) return;
    
    // Import SocketAuthMiddleware dynamically to avoid circular dependency
    const SocketAuthMiddleware = require('@middleware/socket.auth');
    this.socketAuth = new SocketAuthMiddleware(this.redisService);
    
    // Apply authentication middleware
    this.io.use((socket, next) => {
      this.socketAuth.authenticateSocket(socket, next);
    });
    
    // Apply rate limiting middleware for all events
    this.io.use((socket, next) => {
      this.setupRateLimiting(socket);
      next();
    });
    
    this.logger.info('✅ WebSocket middleware setup with enhanced auth');
  }
  
  setupRateLimiting(socket) {
    socket.rateLimits = new Map();
    
    // Clear rate limits on disconnect
    socket.on('disconnect', () => {
      socket.rateLimits.clear();
    });
    
    // Override emit to check rate limits
    const originalEmit = socket.emit.bind(socket);
    socket.emit = (event, ...args) => {
      // Skip rate limiting for certain events
      if (['presence:info', 'message:sent', 'message:error'].includes(event)) {
        return originalEmit(event, ...args);
      }
      return originalEmit(event, ...args);
    };
  }
  
  checkRateLimit(socket, event) {
    if (!this.rateLimitConfig[event]) return true;
    
    const now = Date.now();
    const limitConfig = this.rateLimitConfig[event];
    const key = `${socket.id}:${event}`;
    
    if (!socket.rateLimits) {
      socket.rateLimits = new Map();
    }
    
    const rateLimit = socket.rateLimits.get(key) || { count: 0, resetTime: now + limitConfig.windowMs };
    
    // Reset if window has passed
    if (now > rateLimit.resetTime) {
      rateLimit.count = 0;
      rateLimit.resetTime = now + limitConfig.windowMs;
    }
    
    // Check if limit exceeded
    if (rateLimit.count >= limitConfig.max) {
      this.logger.warn(`Rate limit exceeded for event ${event}`, {
        socketId: socket.id,
        userId: socket.userId,
        count: rateLimit.count,
        max: limitConfig.max
      });
      
      socket.emit('error:rate-limit', {
        event,
        message: 'Rate limit exceeded',
        resetIn: Math.ceil((rateLimit.resetTime - now) / 1000)
      });
      
      return false;
    }
    
    // Increment count
    rateLimit.count++;
    socket.rateLimits.set(key, rateLimit);
    
    return true;
  }
  
  setupEventHandlers() {
    if (!this.io) return;
    
    this.io.on('connection', (socket) => {
      const userId = socket.userId;
      const socketId = socket.id;
      const user = socket.user;
      
      if (!userId || !user) {
        this.logger.warn('Socket connected without user data, disconnecting');
        socket.disconnect();
        return;
      }
      
      this.logger.info(`Socket connected: ${socketId} for user: ${userId} (${user.userType})`);
      
      // Track connected sockets for this user
      if (!this.connectedUsers.has(userId)) {
        this.connectedUsers.set(userId, new Set());
      }
      this.connectedUsers.get(userId).add(socketId);
      
      // Join user's personal room
      socket.join(`user:${userId}`);
      
      // Track presence if service is available
      if (this.presenceService) {
        // Only track presence if this is the first socket for this user
        const userSockets = this.connectedUsers.get(userId);
        if (userSockets.size === 1) {
          this.presenceService.userConnected(userId, socketId, {
            userName: user.name || user.userName,
            avatar: user.avatar,
            userType: user.userType
          }).catch(err => {
            this.logger.error('Error in userConnected:', err);
          });
        } else {
          // User already has other sockets, just add this socket
          if (this.presenceService.addSocketToUser) {
            this.presenceService.addSocketToUser(userId, socketId)
              .catch(err => {
                this.logger.error('Error adding socket:', err);
              });
          }
        }
      }
      
      // Setup heartbeat enforcement
      this.setupHeartbeat(socketId, userId);
      
      // User joined a chat room
      socket.on('join:chat', (data) => {
        if (!this.checkRateLimit(socket, 'join:chat')) return;
        
        const { chatId } = data;
        if (!chatId) {
          socket.emit('error', { message: 'Chat ID is required' });
          return;
        }
        
        socket.join(`chat:${chatId}`);
        this.logger.debug(`User ${userId} joined chat ${chatId}`);
        
        // Notify others in chat
        socket.to(`chat:${chatId}`).emit('user:joined', {
          userId,
          userName: user.name || user.userName,
          timestamp: new Date().toISOString()
        });
      });
      
      // User left a chat room
      socket.on('leave:chat', (data) => {
        const { chatId } = data;
        if (!chatId) return;
        
        socket.leave(`chat:${chatId}`);
        this.logger.debug(`User ${userId} left chat ${chatId}`);
      });
      
      // Typing indicator with debounce and rate limiting
      socket.on('typing:start', (data) => {
        if (!this.checkRateLimit(socket, 'typing:start')) return;
        
        const { chatId } = data;
        if (!chatId) return;
        
        const typingKey = `typing:${userId}:${chatId}`;
        
        if (this.typingDebounce.has(typingKey)) return;
        
        this.typingDebounce.set(typingKey, true);
        setTimeout(() => {
          this.typingDebounce.delete(typingKey);
        }, 1000);
        
        socket.to(`chat:${chatId}`).emit('typing:start', {
          userId,
          userName: user.name || user.userName,
          timestamp: new Date().toISOString()
        });
      });
      
      socket.on('typing:stop', (data) => {
        const { chatId } = data;
        if (!chatId) return;
        
        socket.to(`chat:${chatId}`).emit('typing:stop', { 
          userId,
          timestamp: new Date().toISOString()
        });
      });
      
      // Heartbeat from client with rate limiting
      socket.on('presence:heartbeat', () => {
        if (!this.checkRateLimit(socket, 'presence:heartbeat')) return;
        
        this.resetHeartbeat(socketId, userId);
        if (this.presenceService?.refreshUserHeartbeat) {
          this.presenceService.refreshUserHeartbeat(userId).catch(() => {});
        }
      });
      
      // Get user's presence info
      socket.on('presence:get', async (targetUserId) => {
        if (!targetUserId) {
          socket.emit('error', { message: 'User ID is required' });
          return;
        }
        
        if (this.presenceService && this.presenceService.areUsersOnline) {
          const isOnline = await this.presenceService.areUsersOnline([targetUserId]);
          socket.emit('presence:info', {
            userId: targetUserId,
            online: isOnline[targetUserId],
            timestamp: new Date().toISOString()
          });
        }
      });
      
      // Message sending with validation and rate limiting
      socket.on('message:send', async (data) => {
        if (!this.checkRateLimit(socket, 'message:send')) return;
        
        try {
          const { chatId, content, type = 'text' } = data;
          
          // Validate message
          if (!chatId || !content) {
            socket.emit('message:error', { 
              error: 'Chat ID and content are required',
              code: 'VALIDATION_ERROR'
            });
            return;
          }
          
          if (content.trim().length === 0) {
            socket.emit('message:error', { 
              error: 'Message cannot be empty',
              code: 'EMPTY_MESSAGE'
            });
            return;
          }
          
          if (content.length > 5000) {
            socket.emit('message:error', { 
              error: 'Message too long (max 5000 characters)',
              code: 'MESSAGE_TOO_LONG'
            });
            return;
          }
          
          // Check if user can message (for dating app)
          if (user.userType === 'DatingUser' && this.socketAuth?.canMessage) {
            const canMessage = await this.socketAuth.canMessage(userId, data.receiverId);
            if (!canMessage) {
              socket.emit('message:error', { 
                error: 'You cannot message this user',
                code: 'MESSAGING_DISABLED'
              });
              return;
            }
          }
          
          // Save message to database
          if (this.services.chatService) {
            const message = await this.services.chatService.sendMessage({
              senderId: userId,
              chatId,
              content: content.trim(),
              type,
              metadata: data.metadata || {}
            });
            
            // Broadcast to chat room
            this.sendToChat(chatId, 'message:received', {
              ...message,
              senderName: user.name || user.userName,
              senderAvatar: user.avatar
            });
            
            // Notify sender
            socket.emit('message:sent', message);
            
            this.logger.debug(`Message sent by ${userId} in chat ${chatId}`);
          } else {
            throw new Error('Chat service not available');
          }
        } catch (error) {
          this.logger.error('Message send error:', error);
          socket.emit('message:error', { 
            error: 'Failed to send message',
            code: 'SEND_FAILED',
            details: error.message
          });
        }
      });
      
      // Read receipt
      socket.on('message:read', async (data) => {
        const { messageId, chatId } = data;
        if (!messageId || !chatId) return;
        
        try {
          if (this.services.chatService?.markAsRead) {
            await this.services.chatService.markAsRead(messageId, userId);
            
            // Notify sender that message was read
            this.sendToUser(userId, 'message:read:confirmed', { messageId });
            
            // Broadcast to chat room
            socket.to(`chat:${chatId}`).emit('message:read', {
              messageId,
              readerId: userId,
              readerName: user.name || user.userName,
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          this.logger.error('Message read error:', error);
        }
      });
      
      // Get online status
      socket.on('online:status', async (data) => {
        const { userIds } = data;
        if (!Array.isArray(userIds) || userIds.length === 0) {
          socket.emit('error', { message: 'User IDs array is required' });
          return;
        }
        
        if (userIds.length > 100) {
          socket.emit('error', { message: 'Too many user IDs (max 100)' });
          return;
        }
        
        if (this.presenceService && this.presenceService.areUsersOnline) {
          const onlineStatus = await this.presenceService.areUsersOnline(userIds);
          socket.emit('online:status:response', {
            statuses: onlineStatus,
            timestamp: new Date().toISOString()
          });
        }
      });
      
      // Subscribe to user presence updates
      socket.on('presence:subscribe', (data) => {
        const { userIds } = data;
        if (!Array.isArray(userIds)) return;
        
        // Limit subscription to 50 users
        const limitedIds = userIds.slice(0, 50);
        
        limitedIds.forEach(targetUserId => {
          socket.join(`presence:${targetUserId}`);
        });
        
        this.logger.debug(`User ${userId} subscribed to presence of ${limitedIds.length} users`);
      });
      
      // Unsubscribe from user presence updates
      socket.on('presence:unsubscribe', (data) => {
        const { userIds } = data;
        if (!Array.isArray(userIds)) return;
        
        userIds.forEach(targetUserId => {
          socket.leave(`presence:${targetUserId}`);
        });
      });
      
      // Error handling
      socket.on('error', (error) => {
        this.logger.error(`Socket error for user ${userId}:`, error);
      });
      
      // Custom disconnect reason
      socket.on('disconnect:manual', (reason) => {
        this.logger.info(`Manual disconnect for user ${userId}: ${reason}`);
        socket.disconnect(true);
      });
      
      // Disconnect handler
      socket.on('disconnect', async (reason) => {
        this.logger.info(`Socket disconnected: ${socketId} for user: ${userId}, reason: ${reason}`);
        
        // Clear heartbeat timeout
        this.clearHeartbeat(socketId);
        
        // Remove socket from tracking
        const userSockets = this.connectedUsers.get(userId);
        if (userSockets) {
          userSockets.delete(socketId);
          if (userSockets.size === 0) {
            this.connectedUsers.delete(userId);
            // User has no more sockets, update presence
            if (this.presenceService) {
              await this.presenceService.userDisconnected(userId, socketId)
                .catch(err => {
                  this.logger.error('Error in userDisconnected:', err);
                });
            }
          } else {
            // User still has other sockets, just remove this one
            if (this.presenceService?.removeSocketFromUser) {
              await this.presenceService.removeSocketFromUser(userId, socketId)
                .catch(err => {
                  this.logger.error('Error removing socket:', err);
                });
            }
          }
        }
        
        // Clean up typing debounce entries for this user
        for (const [key] of this.typingDebounce.entries()) {
          if (key.startsWith(`typing:${userId}:`)) {
            this.typingDebounce.delete(key);
          }
        }
      });
    });
    
    this.logger.info('✅ WebSocket event handlers setup');
  }
  
  // Setup heartbeat enforcement
  setupHeartbeat(socketId, userId) {
    this.resetHeartbeat(socketId, userId);
  }
  
  resetHeartbeat(socketId, userId) {
    // Clear existing timeout
    this.clearHeartbeat(socketId);
    
    // Set new timeout (disconnect after 70 seconds of inactivity)
    const timeout = setTimeout(() => {
      this.logger.warn(`Heartbeat timeout for socket ${socketId}, user ${userId}`);
      const socket = this.io?.sockets?.sockets?.get(socketId);
      if (socket) {
        socket.emit('heartbeat:timeout', {
          message: 'Connection timeout due to inactivity',
          reconnect: true
        });
        socket.disconnect(true);
      }
    }, 70000); // 70 seconds (allows for network delays)
    
    this.heartbeatTimeouts.set(socketId, timeout);
  }
  
  clearHeartbeat(socketId) {
    if (this.heartbeatTimeouts.has(socketId)) {
      clearTimeout(this.heartbeatTimeouts.get(socketId));
      this.heartbeatTimeouts.delete(socketId);
    }
  }
  
  // Inject PresenceService
  setPresenceService(presenceService) {
    this.presenceService = presenceService;
    this.logger.info('✅ PresenceService injected into WebSocketService');
  }
  
  // Send message to user
  sendToUser(userId, event, data) {
    if (this.io) {
      this.io.to(`user:${userId}`).emit(event, data);
    }
  }
  
  // Send message to specific socket
  sendToSocket(socketId, event, data) {
    if (this.io) {
      this.io.to(socketId).emit(event, data);
    }
  }
  
  // Send message to chat
  sendToChat(chatId, event, data) {
    if (this.io) {
      this.io.to(`chat:${chatId}`).emit(event, data);
    }
  }
  
  // Send message to presence subscribers
  sendToPresenceSubscribers(userId, event, data) {
    if (this.io) {
      this.io.to(`presence:${userId}`).emit(event, data);
    }
  }
  
  // Send message to all users of a specific type
  sendToUserType(userType, event, data) {
    if (this.io) {
      this.io.to(`userType:${userType}`).emit(event, data);
    }
  }
  
  // Send message to all users with a specific role
  sendToRole(role, event, data) {
    if (this.io) {
      this.io.to(`role:${role}`).emit(event, data);
    }
  }
  
  // Broadcast to all connected clients
  broadcast(event, data, excludeSocketId = null) {
    if (!this.io) return;
    
    if (excludeSocketId) {
      this.io.except(excludeSocketId).emit(event, data);
    } else {
      this.io.emit(event, data);
    }
  }
  
  // Get online users
  async getOnlineUsers(limit = 100, userType = 'all') {
    if (this.presenceService && this.presenceService.getOnlineUsers) {
      return await this.presenceService.getOnlineUsers(limit, 0, userType);
    }
    return [];
  }
  
  // Get nearby online users (for dating app)
  async getNearbyOnlineUsers(userId, radiusKm = 10, limit = 50) {
    if (this.presenceService && this.presenceService.getNearbyOnlineUsers) {
      return await this.presenceService.getNearbyOnlineUsers(userId, radiusKm, limit);
    }
    return [];
  }
  
  // Check if user is online
  async isUserOnline(userId) {
    if (this.presenceService && this.presenceService.areUsersOnline) {
      const results = await this.presenceService.areUsersOnline([userId]);
      return results[userId] || false;
    }
    return false;
  }
  
  // Update user status
  async updateUserStatus(userId, status, customStatus = '') {
    if (this.presenceService && this.presenceService.updateUserStatus) {
      return await this.presenceService.updateUserStatus(userId, status, customStatus);
    }
    return false;
  }
  
  // Get user connections
  getUserConnections(userId) {
    if (this.connectedUsers.has(userId)) {
      return Array.from(this.connectedUsers.get(userId));
    }
    return [];
  }
  
  // Check if user is connected to this instance
  isUserConnected(userId) {
    return this.connectedUsers.has(userId) && this.connectedUsers.get(userId).size > 0;
  }
  
  // Get user by socket ID
  getUserBySocketId(socketId) {
    for (const [userId, sockets] of this.connectedUsers.entries()) {
      if (sockets.has(socketId)) {
        const socket = this.io?.sockets?.sockets?.get(socketId);
        return {
          userId,
          user: socket?.user,
          socket
        };
      }
    }
    return null;
  }
  
  // Disconnect user from all sockets
  disconnectUser(userId, reason = 'admin_action') {
    const sockets = this.connectedUsers.get(userId);
    if (!sockets) return 0;
    
    let disconnected = 0;
    sockets.forEach(socketId => {
      const socket = this.io?.sockets?.sockets?.get(socketId);
      if (socket) {
        socket.emit('force:disconnect', { reason });
        socket.disconnect(true);
        disconnected++;
      }
    });
    
    this.connectedUsers.delete(userId);
    return disconnected;
  }
  
  // Get IO instance
  getIo() {
    return this.io;
  }
  
  // Get SocketAuth instance
  getSocketAuth() {
    return this.socketAuth;
  }
  
  // Get stats
  getStats() {
    if (!this.io) return {};
    
    let totalConnections = 0;
    const userTypeCounts = {};
    
    for (const [userId, sockets] of this.connectedUsers.entries()) {
      totalConnections += sockets.size;
      
      // Try to get user type from socket data
      const socketId = Array.from(sockets)[0];
      const socket = this.io?.sockets?.sockets?.get(socketId);
      if (socket?.user?.userType) {
        const userType = socket.user.userType;
        userTypeCounts[userType] = (userTypeCounts[userType] || 0) + 1;
      }
    }
    
    return {
      connectedClients: this.io.engine.clientsCount || 0,
      activeConnections: Object.keys(this.io.sockets.sockets || {}).length,
      uniqueUsers: this.connectedUsers.size,
      totalConnections,
      userTypeCounts,
      heartbeatTimeouts: this.heartbeatTimeouts.size,
      typingDebounce: this.typingDebounce.size,
      timestamp: new Date().toISOString(),
      authMetrics: this.socketAuth?.getMetrics?.() || {}
    };
  }
  
  // Cleanup
  async cleanup() {
    // Clear all timeouts
    for (const timeout of this.heartbeatTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.heartbeatTimeouts.clear();
    
    // Clear rate limits
    this.eventRateLimits.clear();
    
    // Clear typing debounce
    this.typingDebounce.clear();
    
    // Close WebSocket server
    if (this.io) {
      this.io.close();
      this.logger.info('WebSocket server closed');
    }
    
    // Cleanup PresenceService if available
    if (this.presenceService?.cleanup) {
      await this.presenceService.cleanup();
    }
  }
}

module.exports = WebSocketService;