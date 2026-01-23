const socketIo = require('socket.io');
const logger = require('@utils/logger');

class WebSocketService {
  constructor(config, services, socketSchemas, logger) {
    this.config = config;
    this.services = services;
    this.socketSchemas = socketSchemas;
    this.logger = logger || console;
    this.io = null;
    this.socketRateLimiter = null;
    
    // DO NOT create PresenceService here - it will be injected later
    this.presenceService = null;
    
    this.logger.info('WebSocket service initialized (without PresenceService)');
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
          maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
          skipMiddlewares: true
        },
        transports: ['websocket', 'polling'],
        allowEIO3: true
      });
      
      this.logger.info('✅ WebSocket server setup completed');
      return this.io;
    } catch (error) {
      this.logger.error('❌ Failed to setup WebSocket:', error);
      throw error;
    }
  }
  
  setupMiddleware(io) {
    if (!io) return;
    
    // Authentication middleware - if not already applied
    io.use(async (socket, next) => {
      try {
        // If socket already has userId (from socketAuth middleware), skip
        if (socket.userId) {
          return next();
        }
        
        const token = socket.handshake.auth.token || 
                     socket.handshake.headers.authorization?.replace('Bearer ', '') ||
                     socket.handshake.query.token;
        
        if (!token) {
          return next(new Error('Authentication required'));
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.userId;
        socket.user = decoded;
        
        next();
      } catch (error) {
        this.logger.error('Socket auth error:', error);
        next(new Error('Authentication failed'));
      }
    });
    
    this.logger.info('✅ WebSocket middleware setup');
  }
  
  setupEventHandlers(io, presenceService = null) {
    if (!io) return;
    
    this.presenceService = presenceService;
    
    io.on('connection', (socket) => {
      const userId = socket.userId;
      const socketId = socket.id;
      
      this.logger.info(`Socket connected: ${socketId} for user: ${userId}`);
      
      if (!userId) {
        this.logger.warn('Socket connected without userId, disconnecting');
        socket.disconnect();
        return;
      }
      
      // Join user's personal room
      socket.join(`user:${userId}`);
      
      // Track presence if service is available
      if (this.presenceService) {
        this.presenceService.userConnected(userId, socketId, {
          userName: socket.user?.name || 'User',
          avatar: socket.user?.avatar
        }).catch(err => {
          this.logger.error('Error in userConnected:', err);
        });
      }
      
      // User joined a chat room
      socket.on('join:chat', (chatId) => {
        socket.join(`chat:${chatId}`);
        this.logger.debug(`User ${userId} joined chat ${chatId}`);
      });
      
      // User left a chat room
      socket.on('leave:chat', (chatId) => {
        socket.leave(`chat:${chatId}`);
        this.logger.debug(`User ${userId} left chat ${chatId}`);
      });
      
      // Typing indicator
      socket.on('typing:start', (data) => {
        const { chatId } = data;
        socket.to(`chat:${chatId}`).emit('typing:start', {
          userId,
          userName: socket.user?.name || 'User'
        });
      });
      
      socket.on('typing:stop', (data) => {
        const { chatId } = data;
        socket.to(`chat:${chatId}`).emit('typing:stop', { userId });
      });
      
      // Heartbeat
      socket.on('presence:heartbeat', () => {
        if (this.presenceService && this.presenceService.refreshUserHeartbeat) {
          this.presenceService.refreshUserHeartbeat(userId).catch(() => {});
        }
      });
      
      // Get user's presence info
      socket.on('presence:get', async (targetUserId) => {
        if (this.presenceService && this.presenceService.areUsersOnline) {
          const isOnline = await this.presenceService.areUsersOnline([
            targetUserId || userId,
          ]);
          socket.emit('presence:info', {
            userId: targetUserId || userId,
            online: isOnline[targetUserId || userId],
          });
        }
      });
      
      // Disconnect handler
      socket.on('disconnect', async (reason) => {
        this.logger.info(`Socket disconnected: ${socketId} for user: ${userId}, reason: ${reason}`);
        
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
  
  // Inject PresenceService after creation
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
  
  // Send message to chat
  sendToChat(chatId, event, data) {
    if (this.io) {
      this.io.to(`chat:${chatId}`).emit(event, data);
    }
  }
  
  // Get online users
  async getOnlineUsers(limit = 100) {
    if (this.presenceService && this.presenceService.getOnlineUsers) {
      return await this.presenceService.getOnlineUsers(limit);
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
  
  // Get IO instance
  getIo() {
    return this.io;
  }
  
  // Get socket rate limiter
  getSocketRateLimiter() {
    return this.socketRateLimiter;
  }
  
  // Get stats
  getStats() {
    if (!this.io) return {};
    
    return {
      connectedClients: this.io.engine.clientsCount || 0,
      activeConnections: Object.keys(this.io.sockets.sockets || {}).length,
      timestamp: new Date().toISOString()
    };
  }
  
  // Cleanup
  async cleanup() {
    if (this.io) {
      this.io.close();
      this.logger.info('WebSocket server closed');
    }
  }
}

module.exports = WebSocketService;