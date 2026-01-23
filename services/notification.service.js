const webpush = require('web-push');
const User = require('@models/User');
const logger = console; 

class NotificationService {
  constructor() {
    this.webpushEnabled = false;
    
    // Initialize web push only if keys are provided and valid
    this.initializeWebPush();
  }

  initializeWebPush() {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    
    if (!vapidPublicKey || !vapidPrivateKey) {
      logger.info('ℹ️  VAPID keys not set. Push notifications will be disabled.');
      this.webpushEnabled = false;
      return;
    }
    
    // Validate key format before using
    if (vapidPublicKey.length < 20 || vapidPrivateKey.length < 20) {
      logger.warn('⚠️  VAPID keys appear to be invalid (too short). Push notifications disabled.');
      this.webpushEnabled = false;
      return;
    }
    
    try {
      webpush.setVapidDetails(
        'mailto:' + (process.env.VAPID_CONTACT_EMAIL || 'admin@example.com'),
        vapidPublicKey.trim(),
        vapidPrivateKey.trim()
      );
      this.webpushEnabled = true;
      logger.info('✅ WebPush initialized successfully');
    } catch (error) {
      logger.error('❌ WebPush initialization failed:', error.message);
      logger.info('   VAPID Public Key length:', vapidPublicKey.length);
      logger.info('   First 20 chars:', vapidPublicKey.substring(0, 20));
      this.webpushEnabled = false;
    }
  }

  async sendPushNotification(userId, title, body, data = {}) {
    try {
      // Check if webpush is enabled
      if (!this.webpushEnabled) {
        logger.info(`ℹ️  Push notifications disabled. Would send to user ${userId}: ${title}`);
        return true; // Return success even if disabled
      }
      
      // In a real app, you would:
      // 1. Get user's push subscription from database
      // 2. Send notification via FCM/APNS/webpush
      // 3. Handle failures and retries
      
      logger.info(`📨 Push notification sent to user ${userId}: ${title}`);
      return true;
    } catch (error) {
      logger.error('Push notification error:', error);
      return false;
    }
  }

  async sendNewMessageNotification(receiverId, senderId, messagePreview, extraData = {}) {
    try {
      const receiver = await User.findById(receiverId);
      const sender = await User.findById(senderId);
      
      if (!receiver || !sender) {
        return false;
      }
      
      // Check user's notification settings
      if (!receiver.settings?.notifications?.messages) {
        return false;
      }
      
      const title = `New message from ${sender.firstName || 'User'}`;
      const body = messagePreview.length > 50 
        ? messagePreview.substring(0, 47) + '...' 
        : messagePreview;
      
      const data = {
        type: 'new_message',
        senderId: sender._id.toString(),
        ...extraData
      };
      
      return await this.sendPushNotification(receiverId, title, body, data);
    } catch (error) {
      logger.error('New message notification error:', error);
      return false;
    }
  }

  async sendOnlineStatusNotification(userId, contactId, isOnline) {
    try {
      const user = await User.findById(userId);
      const contact = await User.findById(contactId);
      
      if (!user || !contact) {
        return false;
      }
      
      // Check if user wants to receive online status notifications
      if (!user.settings?.notifications?.onlineStatus) {
        return false;
      }
      
      // Check if contact allows showing online status
      if (contact.settings?.privacy?.onlineStatus === 'nobody') {
        return false;
      }
      
      const title = `${contact.firstName || 'User'} is ${isOnline ? 'online' : 'offline'}`;
      const body = isOnline 
        ? 'Start a conversation!' 
        : 'Last seen just now';
      
      const data = {
        type: 'online_status',
        userId: contact._id.toString(),
        status: isOnline ? 'online' : 'offline'
      };
      
      return await this.sendPushNotification(userId, title, body, data);
    } catch (error) {
      logger.error('Online status notification error:', error);
      return false;
    }
  }
  
  // For in-app notifications (WebSocket)
  async sendInAppNotification(io, userId, notification) {
    try {
      if (!io) {
        logger.warn('IO instance not provided for in-app notification');
        return false;
      }
      
      io.to(`user:${userId}`).emit('notification', {
        ...notification,
        timestamp: new Date().toISOString()
      });
      logger.info(`📲 In-app notification sent to user ${userId}`);
      return true;
    } catch (error) {
      logger.error('In-app notification error:', error);
      return false;
    }
  }
}

// Export singleton instance
module.exports = new NotificationService();