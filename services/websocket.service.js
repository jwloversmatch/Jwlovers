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
    
    // REMOVED: Connected users tracking (now handled by PresenceService)
    // REMOVED: this.connectedUsers = new Map();
    
    // Keep only local tracking needed for WebSocket features
    this.typingDebounce = new Map(); // For broadcast storm protection
    this.heartbeatTimeouts = new Map(); // socketId -> timeout (5 minutes)
    this.socketUserMap = new Map(); // socketId -> userId (for quick lookups)
    
    // Rate limiting for events (WebSocket-specific)
    this.rateLimitConfig = {
      'message:send': { max: 30, windowMs: 60000 }, // 30 messages per minute
      'typing:start': { max: 60, windowMs: 60000 }, // 60 typing events per minute
      'presence:heartbeat': { max: 120, windowMs: 60000 }, // 120 heartbeats per minute
      'join:chat': { max: 30, windowMs: 60000 } // 30 chat joins per minute
    };
    
    this.logger.info('WebSocket service initialized');
  }
  
  async setup(server, corsOrigins) {
    try {
      const corsOptions = {
        origin: corsOrigins || process.env.FRONTEND_URL || '*',
        methods: ['GET', 'POST'],
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
      };
      
      this.io = socketIo(server, {
        cors: corsOptions,
        pingTimeout: 300000, // 5 minutes to match presence timeout
        pingInterval: 25000,
        connectionStateRecovery: {
          maxDisconnectionDuration: 2 * 60 * 1000,
          skipMiddlewares: true
        },
        transports: ['websocket', 'polling'],
        maxHttpBufferSize: 1e7 // 10MB
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
    
    try {
      const SocketAuthMiddleware = require('@middleware/socket.auth');
      this.socketAuth = new SocketAuthMiddleware(this.redisService);
      
      this.io.use((socket, next) => {
        this.socketAuth.authenticateSocket(socket, next);
      });
      
      this.logger.info('✅ WebSocket middleware setup');
    } catch (error) {
      this.logger.error('Failed to setup WebSocket middleware:', error);
    }
  }
  
  checkRateLimit(socket, event) {
    if (!this.rateLimitConfig[event]) return true;
    
    const now = Date.now();
    const limitConfig = this.rateLimitConfig[event];
    const key = `${socket.id}:${event}`;
    
    if (!socket.rateLimits) {
      socket.rateLimits = new Map();
    }
    
    const rateLimit = socket.rateLimits.get(key) || { 
      count: 0, 
      resetTime: now + limitConfig.windowMs 
    };
    
    if (now > rateLimit.resetTime) {
      rateLimit.count = 0;
      rateLimit.resetTime = now + limitConfig.windowMs;
    }
    
    if (rateLimit.count >= limitConfig.max) {
      this.logger.warn(`Rate limit exceeded for event ${event}`, {
        socketId: socket.id,
        userId: socket.userId
      });
      
      socket.emit('error:rate-limit', {
        event,
        message: 'Rate limit exceeded',
        resetIn: Math.ceil((rateLimit.resetTime - now) / 1000)
      });
      
      return false;
    }
    
    rateLimit.count++;
    socket.rateLimits.set(key, rateLimit);
    return true;
  }
  
  // Helper to extract user display info from socket.user
  getUserDisplayInfo(user) {
    if (!user) return null;
    
    return {
      userId: user.id || user._id?.toString(),
      userName: user.profile?.userName || user.userName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown User',
      avatar: user.profile?.profilePicture?.url || null,
      userType: user.userType || 'User',
      role: user.role || 'user'
    };
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
      
      // Get user display info
      const userInfo = this.getUserDisplayInfo(user);
      
      this.logger.info(`Socket connected: ${socketId} for user: ${userId} (${userInfo.userType})`);
      
      // Store socketId -> userId mapping
      this.socketUserMap.set(socketId, userId);
      
      // Join user's personal room
      socket.join(`user:${userId}`);
      
      // Track presence through PresenceService ONLY
      if (this.presenceService) {
        this.presenceService.userConnected(userId, socketId, {
          userName: userInfo.userName,
          avatar: userInfo.avatar,
          userType: userInfo.userType,
          role: userInfo.role
        }).catch(err => {
          this.logger.error('Error in userConnected:', err);
        });
      }
      
      // Setup heartbeat enforcement (5 minutes timeout)
      this.setupHeartbeat(socketId, userId);
      
      // === EVENT HANDLERS ===
      
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
        
        socket.to(`chat:${chatId}`).emit('user:joined', {
          userId,
          userName: userInfo.userName,
          avatar: userInfo.avatar,
          timestamp: new Date().toISOString()
        });
      });
      
      // User left a chat room
      socket.on('leave:chat', (data) => {
        const { chatId } = data;
        if (chatId) {
          socket.leave(`chat:${chatId}`);
          
          socket.to(`chat:${chatId}`).emit('user:left', {
            userId,
            userName: userInfo.userName,
            timestamp: new Date().toISOString()
          });
        }
      });
      
      // Typing indicator with debounce
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
          userName: userInfo.userName,
          timestamp: new Date().toISOString()
        });
      });
      
      socket.on('typing:stop', (data) => {
        const { chatId } = data;
        if (chatId) {
          socket.to(`chat:${chatId}`).emit('typing:stop', { 
            userId,
            timestamp: new Date().toISOString()
          });
        }
      });
      
      // Heartbeat from client
      socket.on('presence:heartbeat', () => {
        if (!this.checkRateLimit(socket, 'presence:heartbeat')) return;
        
        this.resetHeartbeat(socketId, userId);
        if (this.presenceService?.refreshUserHeartbeat) {
          this.presenceService.refreshUserHeartbeat(userId).catch(() => {});
        }
        
        socket.emit('heartbeat:ack', {
          timestamp: new Date().toISOString()
        });
      });
      
      // Get user's presence info
      socket.on('presence:get', async (targetUserId) => {
        if (!targetUserId) {
          socket.emit('error', { message: 'User ID is required' });
          return;
        }
        
        if (this.presenceService?.areUsersOnline) {
          const isOnline = await this.presenceService.areUsersOnline([targetUserId]);
          socket.emit('presence:info', {
            userId: targetUserId,
            isOnline: isOnline[targetUserId],
            timestamp: new Date().toISOString()
          });
        }
      });
      
      // Get batch online status
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
        
        if (this.presenceService?.areUsersOnline) {
          const onlineStatus = await this.presenceService.areUsersOnline(userIds);
          socket.emit('online:status:response', {
            statuses: onlineStatus,
            timestamp: new Date().toISOString()
          });
        }
      });
      
      // Message sending
      socket.on('message:send', async (data) => {
        if (!this.checkRateLimit(socket, 'message:send')) return;
        
        try {
          const { chatId, content, type = 'text' } = data;
          
          if (!chatId || !content || content.trim().length === 0) {
            socket.emit('message:error', { 
              error: 'Chat ID and content are required',
              code: 'VALIDATION_ERROR'
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
          
          // Save message to database if chat service exists
          if (this.services.chatService) {
            const message = await this.services.chatService.sendMessage({
              senderId: userId,
              chatId,
              content: content.trim(),
              type,
              metadata: data.metadata || {}
            });
            
            // Broadcast to chat room
            this.io.to(`chat:${chatId}`).emit('message:received', {
              ...message,
              senderName: userInfo.userName,
              senderAvatar: userInfo.avatar
            });
            
            socket.emit('message:sent', message);
          }
        } catch (error) {
          this.logger.error('Message send error:', error);
          socket.emit('message:error', { 
            error: 'Failed to send message',
            code: 'SEND_FAILED'
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
            
            this.io.to(`chat:${chatId}`).emit('message:read', {
              messageId,
              readerId: userId,
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          this.logger.error('Message read error:', error);
        }
      });
      
      // Subscribe to user presence updates
      socket.on('presence:subscribe', (data) => {
        const { userIds } = data;
        if (!Array.isArray(userIds)) return;
        
        const limitedIds = userIds.slice(0, 50);
        limitedIds.forEach(targetUserId => {
          socket.join(`presence:${targetUserId}`);
        });
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
      
      // Manual disconnect
      socket.on('disconnect:manual', (reason) => {
        this.logger.info(`Manual disconnect for user ${userId}: ${reason}`);
        socket.disconnect(true);
      });
      
      // Disconnect handler
      socket.on('disconnect', async (reason) => {
        this.logger.info(`Socket disconnected: ${socketId} for user: ${userId}, reason: ${reason}`);
        
        // Clear heartbeat timeout
        this.clearHeartbeat(socketId);
        
        // Remove socket mapping
        this.socketUserMap.delete(socketId);
        
        // Clean up typing debounce entries
        for (const [key] of this.typingDebounce.entries()) {
          if (key.startsWith(`typing:${userId}:`)) {
            this.typingDebounce.delete(key);
          }
        }
        
        // Update presence through PresenceService ONLY
        if (this.presenceService) {
          await this.presenceService.userDisconnected(userId, socketId)
            .catch(err => {
              this.logger.error('Error in userDisconnected:', err);
            });
        }
      });
    });
    
    this.logger.info('✅ WebSocket event handlers setup');
  }
  
  // Setup heartbeat enforcement (5 minutes to match PresenceController)
  setupHeartbeat(socketId, userId) {
    this.resetHeartbeat(socketId, userId);
  }
  
  resetHeartbeat(socketId, userId) {
    this.clearHeartbeat(socketId);
    
    // 5 minutes + 30 second buffer = 330000ms
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
    }, 330000); // 5.5 minutes (matches 5 minute presence threshold + buffer)
    
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
  
  // Get user ID from socket ID
  getUserIdFromSocket(socketId) {
    return this.socketUserMap.get(socketId);
  }
  
  // Check if user is connected (via PresenceService)
  async isUserOnline(userId) {
    if (this.presenceService?.areUsersOnline) {
      const results = await this.presenceService.areUsersOnline([userId]);
      return results[userId] || false;
    }
    return false;
  }
  
  // Send message to specific user
  sendToUser(userId, event, data) {
    if (!this.io) return false;
    this.io.to(`user:${userId}`).emit(event, data);
    return true;
  }
  
  // Broadcast to all connected users
  broadcast(event, data, excludeUserId = null) {
    if (!this.io) return false;
    
    if (excludeUserId) {
      this.io.except(`user:${excludeUserId}`).emit(event, data);
    } else {
      this.io.emit(event, data);
    }
    
    return true;
  }
  
  // Disconnect a specific user
  async disconnectUser(userId, reason = 'admin_disconnect') {
    if (!this.io) return 0;
    
    let disconnectedCount = 0;
    const socketsInUserRoom = await this.io.in(`user:${userId}`).fetchSockets();
    
    for (const socket of socketsInUserRoom) {
      socket.emit('force:disconnect', {
        reason,
        message: 'You have been disconnected by an administrator'
      });
      socket.disconnect(true);
      disconnectedCount++;
    }
    
    return disconnectedCount;
  }
  
  // Get IO instance
  getIo() {
    return this.io;
  }
  
  // Get stats
  getStats() {
    if (!this.io) return {};
    
    return {
      connectedSockets: Object.keys(this.io.sockets.sockets || {}).length,
      uniqueSocketUsers: this.socketUserMap.size,
      heartbeatTimeouts: this.heartbeatTimeouts.size,
      typingDebounce: this.typingDebounce.size,
      timestamp: new Date().toISOString(),
      presenceServiceStats: this.presenceService?.getMetrics?.() || {},
      authMetrics: this.socketAuth?.getMetrics?.() || {}
    };
  }
  
  // Cleanup
  async cleanup() {
    for (const timeout of this.heartbeatTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.heartbeatTimeouts.clear();
    this.socketUserMap.clear();
    this.typingDebounce.clear();
    
    if (this.io) {
      this.io.close();
      this.logger.info('WebSocket server closed');
    }
  }
}

module.exports = WebSocketService;