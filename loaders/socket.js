// loaders/socket.js
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
        credentials: true
      },
      transports: ['websocket', 'polling'], // WebSocket first, fallback to polling
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e7, // 10MB for file uploads
      allowEIO3: true // Socket.IO v2 compatibility
    });

    // Redis adapter for horizontal scaling
    const pubClient = redis.getPublisher();
    const subClient = redis.getSubscriber();
    this.io.adapter(createAdapter(pubClient, subClient));
  }

  initialize() {
    // Authentication middleware
    this.io.use(socketAuth);
    
    // Connection handling
    this.io.on('connection', this.handleConnection.bind(this));
    
    // Subscribe to presence updates
    presenceService.subscribeToPresence((update) => {
      this.io.to(`user:${update.userId}`).emit('presence:update', update);
    });
    
    logger.info('Socket.IO server initialized');
    return this.io;
  }

  async handleConnection(socket) {
    const userId = socket.user.id;
    const userRoom = `user:${userId}`;
    
    // Join user's personal room
    await socket.join(userRoom);
    
    // Track presence
    await presenceService.userConnected(
      userId,
      socket.id,
      socket.handshake.headers['user-agent']
    );
    
    metrics.activeConnections.inc();
    metrics.totalConnections.inc();
    
    logger.info(`Socket connected: ${socket.id} for user ${userId}`);
    
    // Heartbeat
    const heartbeatInterval = setInterval(async () => {
      try {
        await presenceService.updateHeartbeat(userId, socket.id);
        socket.emit('heartbeat');
      } catch (error) {
        logger.error('Heartbeat error:', error);
      }
    }, 25000);
    
    // Message events
    socket.on('message:send', async (data, ack) => {
      try {
        const message = await messageService.sendMessage({
          ...data,
          senderId: userId,
          socketId: socket.id
        });
        
        metrics.messagesSent.inc();
        
        // Acknowledge to sender
        if (ack && typeof ack === 'function') {
          ack({ success: true, messageId: message._id });
        }
        
        // Deliver to recipient if online
        await this.deliverMessage(message);
      } catch (error) {
        logger.error('Message send error:', error);
        if (ack && typeof ack === 'function') {
          ack({ success: false, error: error.message });
        }
      }
    });
    
    // Typing indicator
    socket.on('typing:start', async (data) => {
      const { receiverId } = data;
      this.io.to(`user:${receiverId}`).emit('typing:start', {
        senderId: userId,
        conversationId: data.conversationId
      });
    });
    
    socket.on('typing:stop', async (data) => {
      const { receiverId } = data;
      this.io.to(`user:${receiverId}`).emit('typing:stop', {
        senderId: userId,
        conversationId: data.conversationId
      });
    });
    
    // Message read receipt
    socket.on('message:read', async (data) => {
      try {
        const { messageIds } = data;
        await messageService.markMessagesAsRead(userId, messageIds);
        
        // Notify senders
        const messages = await messageService.getMessagesByIds(messageIds);
        messages.forEach(message => {
          this.io.to(`user:${message.senderId}`).emit('message:read', {
            messageId: message._id,
            readBy: userId,
            readAt: new Date()
          });
        });
      } catch (error) {
        logger.error('Read receipt error:', error);
      }
    });
    
    // Disconnect handling
    socket.on('disconnect', async (reason) => {
      clearInterval(heartbeatInterval);
      
      const remainingSessions = await presenceService.userDisconnected(
        userId,
        socket.id
      );
      
      metrics.activeConnections.dec();
      logger.info(`Socket disconnected: ${socket.id}, reason: ${reason}`);
      
      // If this was the last session, notify contacts
      if (remainingSessions === 0) {
        // This will be handled by presence service timeout
      }
    });
    
    // Error handling
    socket.on('error', (error) => {
      logger.error('Socket error:', error);
      metrics.socketErrors.inc();
    });
  }

  async deliverMessage(message) {
    const { receiverId } = message;
    
    // Check if recipient is online
    const isOnline = await presenceService.isUserOnline(receiverId);
    
    if (isOnline) {
      // Deliver immediately via WebSocket
      this.io.to(`user:${receiverId}`).emit('message:receive', {
        ...message.toObject(),
        status: 'delivered'
      });
      
      // Update message status
      await messageService.updateMessageStatus(message._id, 'delivered');
    } else {
      // Queue for push notification
      await this.queuePushNotification(message);
    }
  }

  async queuePushNotification(message) {
    // Implementation for push notifications
    // This would integrate with Firebase Cloud Messaging or APNS
  }
}

module.exports = SocketLoader;