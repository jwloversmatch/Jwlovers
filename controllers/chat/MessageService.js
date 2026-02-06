const mongoose = require("mongoose");
const crypto = require("crypto");
const Message = require("@models/Message");
const Conversation = require("@models/Conversation");
const User = require("@models/User");
const Block = require("@models/Block.model");
const notificationService = require("@services/notification.service");
const logger = require("@utils/logger");

// ========== CONFIGURATION ==========
const CONFIG = {
  // Timing
  EDIT_TIME_LIMIT: 15 * 60 * 1000, // 15 minutes
  DUPLICATE_CHECK_WINDOW: 10000, // 10 seconds

  // Limits
  MAX_MESSAGE_LENGTH: 10000,
  MAX_MESSAGES_PER_MINUTE: 20,
  MAX_MESSAGES_PER_HOUR: 100,

  // Status values
  VALID_STATUSES: ["pending", "sent", "delivered", "read", "failed", "pending_moderation"],
  VALID_TYPES: ["text", "image", "video", "file", "audio", "system"],

  // Safety thresholds
  HARASSMENT_SCORE_THRESHOLD: 0.7,
  AUTO_MODERATION_THRESHOLD: 0.8,

  // Retry
  MAX_RETRY_ATTEMPTS: 3,
};

class MessageService {
  constructor() {
    this.redisClient = null;
    this.safetyService = null;
    this.initServices();
  }

  async initServices() {
  try {
    // Lazy load Redis service
    const RedisService = require('@services/redis.service');
    const logger = require('@utils/logger');
    
    // Create RedisService instance with config
    this.redisService = new RedisService({
      USER_PREFIX: 'user:',
      ONLINE_SET_KEY: 'online_users',
      CONNECTION_PREFIX: 'connections:',
      PRESENCE_TTL: 1800, // 30 minutes
      OFFLINE_PREFIX: 'offline_messages:',
      OFFLINE_TTL: 86400, // 24 hours
      DUPLICATE_PREFIX: 'duplicate:',
      LOCK_TTL: 30,
      BLOCK_PREFIX: 'blocked:'
    }, logger);
    
    // Initialize Redis service
    await this.redisService.init();
    this.redisClient = this.redisService.getClient();
    
    // Lazy load Safety service if needed
    try {
      const SafetyService = require('@services/safety.service');
      this.safetyService = new SafetyService();
    } catch (safetyError) {
      logger.warn('Safety service not available, continuing without it:', safetyError.message);
      this.safetyService = null;
    }
    
    logger.info('MessageService services initialized');
  } catch (error) {
    logger.error('Failed to initialize MessageService services:', error);
    // Continue without Redis - will use fallbacks
    this.redisClient = null;
    this.redisService = null;
    this.safetyService = null;
  }
}

  // ========== RATE LIMITING METHODS ==========

 async checkRateLimit(senderId, receiverId) {
  // Skip rate limiting if Redis is not available
  if (!this.redisClient || !this.redisService || !this.redisService.isReady()) {
    logger.warn('Redis not available, skipping rate limiting');
    return true;
  }

  const now = Date.now();
  const minuteWindow = 60 * 1000;
  const hourWindow = 60 * 60 * 1000;

  // Per-conversation minute limit
  const convMinuteKey = `ratelimit:conv:${senderId}:${receiverId}:minute`;
  const convCount = await this.redisService.safeOperation(
    async () => await this.redisClient.get(convMinuteKey) || 0,
    0,
    'checkRateLimit-convMinute'
  );
  
  if (convCount >= CONFIG.MAX_MESSAGES_PER_MINUTE) {
    throw new Error('Too many messages to this user. Please slow down.');
  }

  // Global user hour limit
  const userHourKey = `ratelimit:user:${senderId}:hour`;
  const userCount = await this.redisService.safeOperation(
    async () => await this.redisClient.get(userHourKey) || 0,
    0,
    'checkRateLimit-userHour'
  );
  
  if (userCount >= CONFIG.MAX_MESSAGES_PER_HOUR) {
    throw new Error('Message rate limit exceeded. Please wait before sending more messages.');
  }

  // Update counters
  await this.redisService.safeOperation(
    async () => {
      await this.redisClient.multi()
        .incr(convMinuteKey)
        .expire(convMinuteKey, 60)
        .incr(userHourKey)
        .expire(userHourKey, 3600)
        .exec();
    },
    null,
    'checkRateLimit-updateCounters'
  );

  return true;
}

  // ========== SAFETY VALIDATION METHODS ==========

  async validateMessageSafety(senderId, receiverId, content, type) {
    if (type !== 'text' || !content) return true;

    // 1. Check if user is blocked
    const isBlocked = await Block.exists({
      blocker: receiverId,
      blocked: senderId,
      active: true
    });

    if (isBlocked) {
      throw new Error('Cannot send message to this user');
    }

    // 2. Check for harassment patterns (basic)
    const harassmentPatterns = [
      /send.*(nude|pic|photo|body|private)/i,
      /(where.*live|address|home|location|city)/i,
      /(phone.*number|call.*me|whatsapp|telegram|signal)/i,
      /(social.*media|instagram|facebook|snapchat|tiktok)/i,
      /(meet.*up|meet.*me|meet.*tonight|hook.?up)/i,
      /(send.*money|bank.*details|payment)/i,
    ];

    let safetyScore = 1.0;
    const matchedPatterns = [];

    for (const pattern of harassmentPatterns) {
      if (pattern.test(content)) {
        matchedPatterns.push(pattern.source);
        safetyScore -= 0.2; // Deduct for each pattern
      }
    }

    // 3. Check message length for new conversations
    const isFirstMessage = await this.isFirstMessage(senderId, receiverId);
    if (isFirstMessage) {
      // Prevent links in first messages
      if (/(http|https|www\.|\.com|\.org|\.net|\.io)/i.test(content)) {
        throw new Error('Links are not allowed in first messages');
      }

      // Prevent very short messages
      if (content.length < 5) {
        throw new Error('Please send a more meaningful first message');
      }

      // Prevent very long messages
      if (content.length > 500) {
        throw new Error('First messages should be concise (max 500 characters)');
      }
    }

    // 4. Use safety service if available
    if (this.safetyService) {
      try {
        const safetyCheck = await this.safetyService.checkMessage({
          content,
          senderId,
          receiverId
        });

        if (safetyCheck.flagged && safetyCheck.score > CONFIG.AUTO_MODERATION_THRESHOLD) {
          throw new Error('Message blocked for safety reasons');
        }

        safetyScore = Math.min(safetyScore, safetyCheck.score || 1.0);
      } catch (error) {
        logger.warn('Safety service unavailable:', error.message);
      }
    }

    // 5. Check for spam patterns
    const spamPatterns = [
      /(http|www\.)/gi,
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, // Email
      /\b\d{10,}\b/g, // Long numbers
    ];

    let spamScore = 0;
    for (const pattern of spamPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        spamScore += matches.length * 0.1;
      }
    }

    if (spamScore > 0.5) {
      throw new Error('Message appears to contain spam content');
    }

    return {
      safe: safetyScore > CONFIG.HARASSMENT_SCORE_THRESHOLD,
      score: safetyScore,
      matchedPatterns,
      requiresModeration: safetyScore < 0.8
    };
  }

  async isFirstMessage(senderId, receiverId) {
    const existingMessages = await Message.countDocuments({
      $or: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId }
      ]
    });
    
    return existingMessages === 0;
  }

  // ========== DEDUPLICATION METHODS ==========

  async checkDuplicate(senderId, receiverId, content, clientMessageId) {
  // Use Redis service if available
  if (this.redisClient && this.redisService && this.redisService.isReady()) {
    const now = Date.now();
    
    // Check by clientMessageId first (most reliable)
    if (clientMessageId) {
      const existingKey = `msg:client:${clientMessageId}`;
      const existing = await this.redisService.safeOperation(
        async () => await this.redisClient.get(existingKey),
        null,
        'checkDuplicate-clientId'
      );
      
      if (existing) {
        logger.info('Duplicate detected by clientMessageId', { clientMessageId });
        return JSON.parse(existing);
      }
    }

    // Content-based deduplication with hash
    const contentHash = crypto
      .createHash('sha256')
      .update(content || '')
      .digest('hex')
      .substring(0, 32);

    const dupKey = `msg:dup:${senderId}:${receiverId}:${contentHash}`;
    const duplicate = await this.redisService.safeOperation(
      async () => await this.redisClient.get(dupKey),
      null,
      'checkDuplicate-contentHash'
    );
    
    if (duplicate) {
      logger.info('Duplicate detected by content hash', { 
        senderId, 
        receiverId, 
        contentHash: contentHash.substring(0, 8) 
      });
      return JSON.parse(duplicate);
    }

    // Set temporary duplicate prevention keys
    if (clientMessageId) {
      await this.redisService.safeOperation(
        async () => {
          await this.redisClient.setex(
            `msg:client:${clientMessageId}`,
            60, // 60 second TTL
            JSON.stringify({ senderId, receiverId, timestamp: now })
          );
        },
        null,
        'checkDuplicate-setClientId'
      );
    }

    await this.redisService.safeOperation(
      async () => {
        await this.redisClient.setex(
          dupKey,
          CONFIG.DUPLICATE_CHECK_WINDOW / 1000,
          JSON.stringify({ senderId, receiverId, timestamp: now })
        );
      },
      null,
      'checkDuplicate-setContentHash'
    );

    return null;
  }
  
  // Fallback to in-memory if Redis not available
  return await this.checkDuplicateInMemory(senderId, receiverId, content, clientMessageId);
}

  async checkDuplicateInMemory(senderId, receiverId, content, clientMessageId) {
    // Simple in-memory fallback (not recommended for production)
    const key = clientMessageId || `${senderId}:${receiverId}:${crypto.createHash('md5').update(content || '').digest('hex')}`;
    
    // This would need proper in-memory cache implementation
    return null;
  }

  // ========== NEW STATISTICS METHODS ==========

  async getTotalUnreadCount(userId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return 0;
      }

      // Use conversation unread counts for better performance
      const conversations = await Conversation.find({
        participants: userId,
      }).select('unreadCount').lean();

      let totalUnread = 0;
      const userIdStr = userId.toString();
      
      conversations.forEach(conv => {
        totalUnread += conv.unreadCount?.[userIdStr] || 0;
      });

      return totalUnread;
    } catch (error) {
      logger.error('Error in getTotalUnreadCount:', error);
      return 0;
    }
  }

  async getUnreadCount(conversationId, userId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(conversationId) || 
          !mongoose.Types.ObjectId.isValid(userId)) {
        return 0;
      }

      const conversation = await Conversation.findById(conversationId)
        .select('unreadCount participants')
        .lean();

      if (!conversation) {
        return 0;
      }

      // Verify user is participant
      const isParticipant = conversation.participants.some(
        p => p.toString() === userId.toString()
      );

      if (!isParticipant) {
        return 0;
      }

      return conversation.unreadCount?.[userId.toString()] || 0;
    } catch (error) {
      logger.error('Error in getUnreadCount:', error);
      return 0;
    }
  }

  async getUserChatStats(userId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return this.getDefaultStats();
      }

      const [conversationStats, messageStats] = await Promise.all([
        // Conversation stats
        Conversation.aggregate([
          { $match: { participants: userId } },
          {
            $group: {
              _id: null,
              totalConversations: { $sum: 1 },
              activeConversations: {
                $sum: {
                  $cond: [
                    { 
                      $and: [
                        { $gte: ["$lastMessageAt", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)] },
                        { $ne: ["$lastMessageAt", null] }
                      ]
                    },
                    1,
                    0
                  ]
                }
              }
            }
          }
        ]),
        
        // Message stats
        Message.aggregate([
          {
            $facet: {
              sent: [
                { $match: { senderId: userId, deletedFor: { $ne: userId } } },
                { $count: "count" }
              ],
              received: [
                { $match: { receiverId: userId, deletedFor: { $ne: userId } } },
                { $count: "count" }
              ]
            }
          }
        ])
      ]);

      const stats = this.getDefaultStats();
      
      if (conversationStats.length > 0) {
        stats.totalConversations = conversationStats[0].totalConversations;
        stats.activeConversations = conversationStats[0].activeConversations;
      }
      
      if (messageStats.length > 0) {
        stats.totalSent = messageStats[0].sent[0]?.count || 0;
        stats.totalReceived = messageStats[0].received[0]?.count || 0;
        stats.totalMessages = stats.totalSent + stats.totalReceived;
      }
      
      stats.totalUnread = await this.getTotalUnreadCount(userId);
      
      // Get last message timestamp
      const lastMessage = await Message.findOne({
        $or: [{ senderId: userId }, { receiverId: userId }],
        deletedFor: { $ne: userId }
      })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean();
      
      stats.lastMessageAt = lastMessage?.createdAt || null;

      return stats;
    } catch (error) {
      logger.error('Error in getUserChatStats:', error);
      return this.getDefaultStats();
    }
  }

  getDefaultStats() {
    return {
      totalMessages: 0,
      totalUnread: 0,
      totalConversations: 0,
      activeConversations: 0,
      lastMessageAt: null,
      totalSent: 0,
      totalReceived: 0,
    };
  }

  // ========== CORE MESSAGE METHODS ==========

  async sendMessage(data) {
    const startTime = Date.now();
    let conversation = null;
    
    try {
      const {
        senderId,
        receiverId,
        content,
        type = "text",
        mediaUrl,
        conversationId,
        clientMessageId,
        source = "socket",
        isEncrypted = true,
        encryptionType = "server-side",
      } = data;

      logger.info('Processing message', {
        senderId: senderId?.toString().substring(0, 8),
        receiverId: receiverId?.toString().substring(0, 8),
        type,
        source,
        contentLength: content?.length || 0
      });

      // ========== VALIDATION ==========
      if (!senderId || !receiverId || !type) {
        throw new Error("senderId, receiverId, and type are required");
      }

      // Validate ObjectId format
      const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
      if (!isValidObjectId(senderId) || !isValidObjectId(receiverId)) {
        throw new Error("Invalid user ID format");
      }

      if (conversationId && !isValidObjectId(conversationId)) {
        throw new Error("Invalid conversation ID format");
      }

      // Validate type
      if (!CONFIG.VALID_TYPES.includes(type)) {
        throw new Error(
          `Invalid message type. Must be one of: ${CONFIG.VALID_TYPES.join(", ")}`
        );
      }

      // Validate content
      if (content && content.length > CONFIG.MAX_MESSAGE_LENGTH) {
        throw new Error(
          `Message too long (max ${CONFIG.MAX_MESSAGE_LENGTH} characters)`
        );
      }

      if (type === "text" && (!content || content.trim().length === 0)) {
        throw new Error("Content is required for text messages");
      }

      // ========== CHECK RECEIVER ==========
      const receiver = await User.findById(receiverId)
        .select("_id settings accountStatus messagingPreferences")
        .lean();

      if (!receiver) {
        throw new Error("Receiver not found");
      }

      if (!["active", "verified"].includes(receiver.accountStatus || "active")) {
        throw new Error(`Receiver account is ${receiver.accountStatus}`);
      }

      // Check receiver messaging preferences
      if (receiver.messagingPreferences === "matches_only") {
        // You'd need to check if users are matched
        // Implement match check logic here
      }

      // ========== SAFETY VALIDATION ==========
      if (type === "text") {
        const safetyCheck = await this.validateMessageSafety(
          senderId, 
          receiverId, 
          content, 
          type
        );
        
        if (!safetyCheck.safe) {
          // Log for moderation
          await this.logSafetyViolation({
            senderId,
            receiverId,
            content: content.substring(0, 200),
            score: safetyCheck.score,
            matchedPatterns: safetyCheck.matchedPatterns,
            timestamp: new Date()
          });
          
          if (safetyCheck.score < CONFIG.HARASSMENT_SCORE_THRESHOLD) {
            throw new Error("Message blocked for safety reasons");
          }
        }
      }

      // ========== RATE LIMITING ==========
      await this.checkRateLimit(senderId, receiverId);

      // ========== DEDUPLICATION ==========
      const duplicate = await this.checkDuplicate(
        senderId, 
        receiverId, 
        content, 
        clientMessageId
      );
      
      if (duplicate) {
        // Try to find existing message
        const existingMessage = await Message.findOne({
          clientMessageId,
          senderId,
          receiverId,
        })
        .populate({
          path: "senderId",
          select: "firstName lastName avatar email userName",
        })
        .lean();

        if (existingMessage) {
          logger.info("Returning existing duplicate message", {
            existingId: existingMessage._id
          });
          
          return {
            ...existingMessage,
            duplicate: true,
            conversationId: conversation?._id
          };
        }
      }

      // ========== TRANSACTION START ==========
      const session = await mongoose.startSession();

      try {
        session.startTransaction();

        // ========== FIND OR CREATE CONVERSATION ==========
        if (conversationId && isValidObjectId(conversationId)) {
          conversation = await Conversation.findById(conversationId).session(session);
          if (!conversation) {
            throw new Error("Conversation not found");
          }

          // Verify user is participant
          const isParticipant = conversation.participants.some(
            participant => participant.toString() === senderId.toString()
          );

          if (!isParticipant) {
            throw new Error("User is not a participant in this conversation");
          }
        } else {
          // Find existing conversation
          conversation = await Conversation.findOne({
            participants: { $all: [senderId, receiverId] },
          }).session(session);

          // Create new conversation if doesn't exist
          if (!conversation) {
            conversation = new Conversation({
              participants: [senderId, receiverId],
              createdAt: new Date(),
              lastMessageAt: new Date(),
            });

            await conversation.save({ session });
          }
        }

        const conversationIdString = conversation._id.toString();

        // ========== CREATE MESSAGE ==========
        const messageData = {
          senderId,
          receiverId,
          content: content || "",
          type,
          mediaUrl: mediaUrl || null,
          conversationId: conversationIdString,
          status: "sent",
          clientMessageId:
            clientMessageId ||
            `msg_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
          source: source,
          encryption: {
            version: "v2",
            keyId: "default",
            isEncrypted: !!isEncrypted,
            algorithm: encryptionType === "server-side" ? "AES-256-GCM" : "none",
          },
          metadata: {
            contentLength: content?.length || 0,
            requiresModeration: false,
            safetyScore: 1.0
          }
        };

        const message = await Message.create([messageData], { session });
        const savedMessage = message[0];

        // ========== UPDATE CONVERSATION ==========
        conversation.lastMessage = savedMessage._id;
        conversation.lastMessageAt = new Date();
        conversation.lastMessageSender = senderId;

        // Initialize or increment unread count for receiver
        if (!conversation.unreadCount) {
          conversation.unreadCount = {};
        }

        const receiverIdStr = receiverId.toString();
        conversation.unreadCount[receiverIdStr] =
          (conversation.unreadCount[receiverIdStr] || 0) + 1;

        await conversation.save({ session });

        await session.commitTransaction();

        logger.info('Message created successfully', {
          messageId: savedMessage._id,
          conversationId: conversationIdString,
          duration: Date.now() - startTime,
          receiverId: receiverId.toString().substring(0, 8)
        });

        // ========== POST-SAVE ACTIONS ==========
        // Get populated message
        const populatedMessage = await Message.findById(savedMessage._id)
          .populate({
            path: "senderId",
            select: "firstName lastName avatar email userName",
          })
          .lean();

        const result = {
          ...populatedMessage,
          conversationId: conversation._id,
          conversationIdString: conversationIdString,
          duplicate: false,
        };

        // Send notification (async)
        if (receiver.settings?.notifications?.messages !== false) {
          this.sendNotificationAsync(
            receiverId,
            senderId,
            content,
            savedMessage._id
          ).catch(err => logger.error('Notification error:', err));
        }

        return result;

      } catch (error) {
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }

    } catch (error) {
      logger.error('Error in sendMessage', {
        error: error.message,
        code: error.code,
        senderId: data.senderId?.toString().substring(0, 8),
        receiverId: data.receiverId?.toString().substring(0, 8),
        duration: Date.now() - startTime,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });

      if (error.code === 11000) {
        // MongoDB duplicate key error
        logger.warn('MongoDB duplicate key error, attempting recovery');
        
        try {
          const existingMessage = await Message.findOne({
            clientMessageId: data.clientMessageId,
            senderId: data.senderId,
            receiverId: data.receiverId,
          })
          .populate({
            path: "senderId",
            select: "firstName lastName avatar email userName",
          })
          .lean();

          if (existingMessage && conversation) {
            logger.info('Recovered existing message after duplicate error');
            return {
              ...existingMessage,
              conversationId: conversation._id,
              conversationIdString: conversation?._id?.toString(),
              duplicate: true,
            };
          }
        } catch (recoveryError) {
          logger.error('Failed to recover from duplicate error:', recoveryError);
        }

        throw new Error("Message already sent. Please check your connection.");
      }

      throw error;
    }
  }

  async sendNotificationAsync(receiverId, senderId, content, messageId) {
    try {
      await notificationService.sendNewMessageNotification(
        receiverId,
        senderId,
        content,
        messageId
      );
    } catch (error) {
      logger.error('Failed to send notification:', error);
    }
  }

  async logSafetyViolation(data) {
    // Implement logging to a separate safety collection
    const SafetyLog = require('@models/SafetyLog');
    
    try {
      await SafetyLog.create({
        ...data,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Failed to log safety violation:', error);
    }
  }

  async markMessageAsRead(userId, messageId) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const message = await Message.findById(messageId).session(session);
      
      if (!message) {
        throw new Error("Message not found");
      }

      // Check authorization
      const isAuthorized =
        message.receiverId.toString() === userId.toString() ||
        message.senderId.toString() === userId.toString();

      if (!isAuthorized) {
        throw new Error("Not authorized to mark this message as read");
      }

      if (message.status === "read") {
        await session.commitTransaction();
        return message;
      }

      // Update message
      message.status = "read";
      message.readAt = new Date();
      message.readBy = message.readBy || [];
      if (!message.readBy.includes(userId)) {
        message.readBy.push(userId);
      }
      
      await message.save({ session });

      // Update conversation unread count
      if (message.conversationId) {
        await Conversation.findByIdAndUpdate(
          message.conversationId,
          {
            $inc: { [`unreadCount.${userId}`]: -1 },
          },
          { session }
        );
      }

      await session.commitTransaction();

      logger.debug("Message marked as read", {
        messageId: messageId.toString().substring(0, 8),
        userId: userId.toString().substring(0, 8),
      });

      return message;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async markMessagesAsRead(messageIds, userId) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      // Validate message IDs
      const invalidIds = messageIds.filter(
        (id) => !mongoose.Types.ObjectId.isValid(id)
      );
      
      if (invalidIds.length > 0) {
        throw new Error(
          `Invalid message IDs: ${invalidIds.slice(0, 5).join(", ")}`
        );
      }

      // Find messages and verify authorization
      const messages = await Message.find({
        _id: { $in: messageIds },
        $or: [{ receiverId: userId }, { senderId: userId }],
      }).session(session);

      if (messages.length !== messageIds.length) {
        throw new Error("Not authorized to mark some messages as read");
      }

      // Update messages
      const updateResult = await Message.updateMany(
        {
          _id: { $in: messageIds },
          status: { $in: ["sent", "delivered"] },
        },
        {
          $addToSet: { readBy: userId },
          $set: {
            status: "read",
            readAt: new Date(),
          },
        },
        { session }
      );

      // Update conversation unread counts
      const conversationUpdates = new Map();

      messages.forEach((msg) => {
        if (msg.conversationId && msg.receiverId.toString() === userId.toString()) {
          const convId = msg.conversationId.toString();
          conversationUpdates.set(convId, (conversationUpdates.get(convId) || 0) - 1);
        }
      });

      const updatePromises = Array.from(conversationUpdates.entries()).map(
        ([conversationId, count]) => {
          return Conversation.findByIdAndUpdate(
            conversationId,
            { $inc: { [`unreadCount.${userId}`]: count } },
            { session }
          );
        }
      );

      await Promise.all(updatePromises);
      await session.commitTransaction();

      logger.debug("Messages marked as read in bulk", {
        count: updateResult.modifiedCount,
        userId: userId.toString().substring(0, 8),
      });

      return messageIds;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async getMessageById(messageId) {
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      throw new Error("Invalid message ID format");
    }

    return Message.findById(messageId)
      .populate({
        path: "senderId",
        select: "firstName lastName avatar email userName",
      })
      .lean();
  }

  async deleteMessage(userId, messageId) {
    const message = await Message.findById(messageId);

    if (!message) {
      throw new Error("Message not found");
    }

    // Check authorization
    const isAuthorized =
      message.senderId.toString() === userId.toString() ||
      message.receiverId.toString() === userId.toString();

    if (!isAuthorized) {
      throw new Error("Not authorized to delete this message");
    }

    // Soft delete by adding user to deletedFor array
    const result = await Message.findByIdAndUpdate(
      messageId,
      {
        $addToSet: { deletedFor: userId },
      },
      { new: true }
    );

    logger.debug("Message soft deleted", {
      messageId: messageId.toString().substring(0, 8),
      userId: userId.toString().substring(0, 8),
    });

    return { deleted: true, messageId: result._id };
  }

  async deleteMessagesBulk(userId, messageIds) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      throw new Error("messageIds must be a non-empty array");
    }

    // Validate all message IDs
    const invalidIds = messageIds.filter(
      (id) => !mongoose.Types.ObjectId.isValid(id)
    );
    
    if (invalidIds.length > 0) {
      throw new Error(
        `Invalid message IDs: ${invalidIds.slice(0, 5).join(", ")}`
      );
    }

    // Verify authorization for all messages
    const authorizedCount = await Message.countDocuments({
      _id: { $in: messageIds },
      $or: [{ senderId: userId }, { receiverId: userId }],
    });

    if (authorizedCount !== messageIds.length) {
      throw new Error("Not authorized to delete some messages");
    }

    const result = await Message.updateMany(
      { _id: { $in: messageIds } },
      {
        $addToSet: { deletedFor: userId },
      }
    );

    logger.debug("Messages bulk soft deleted", {
      count: result.modifiedCount,
      userId: userId.toString().substring(0, 8),
    });

    return { deletedCount: result.modifiedCount };
  }

  async editMessage(userId, messageId, content) {
    if (!content || content.trim().length === 0) {
      throw new Error("Message content is required");
    }

    if (content.length > CONFIG.MAX_MESSAGE_LENGTH) {
      throw new Error(
        `Message too long (max ${CONFIG.MAX_MESSAGE_LENGTH} characters)`
      );
    }

    const message = await Message.findById(messageId);

    if (!message) {
      throw new Error("Message not found");
    }

    if (message.senderId.toString() !== userId.toString()) {
      throw new Error("Not authorized to edit this message");
    }

    // Check edit time limit
    const timeSinceCreation =
      Date.now() - new Date(message.createdAt).getTime();
    const canEdit = timeSinceCreation < CONFIG.EDIT_TIME_LIMIT;

    if (!canEdit) {
      throw new Error(
        `Message can only be edited within ${CONFIG.EDIT_TIME_LIMIT / 60000} minutes of sending`
      );
    }

    // Safety check for edited content
    if (message.type === 'text') {
      const safetyCheck = await this.validateMessageSafety(
        userId,
        message.receiverId,
        content,
        message.type
      );
      
      if (!safetyCheck.safe) {
        throw new Error("Edited content violates safety guidelines");
      }
    }

    message.content = content.trim();
    message.editedAt = new Date();
    message.isEdited = true;

    await message.save();

    logger.debug("Message edited", {
      messageId: messageId.toString().substring(0, 8),
      userId: userId.toString().substring(0, 8),
    });

    // Return populated message
    return Message.findById(messageId)
      .populate({
        path: "senderId",
        select: "firstName lastName avatar email userName",
      })
      .lean();
  }

  async getConversationMessages(conversationId, options = {}) {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      throw new Error("Invalid conversation ID format");
    }

    const { limit = 50, before = null, after = null, offset = 0 } = options;

    // Validate limit
    const finalLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const finalOffset = Math.max(parseInt(offset) || 0, 0);

    const query = { conversationId };

    // Pagination by ID
    if (before && mongoose.Types.ObjectId.isValid(before)) {
      query._id = { $lt: new mongoose.Types.ObjectId(before) };
    }

    if (after && mongoose.Types.ObjectId.isValid(after)) {
      query._id = { $gt: new mongoose.Types.ObjectId(after) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .skip(finalOffset)
      .limit(finalLimit)
      .populate({
        path: "senderId",
        select: "firstName lastName avatar email userName",
      })
      .populate({
        path: "receiverId",
        select: "firstName lastName avatar email userName",
      })
      .lean();

    logger.debug("Conversation messages fetched", {
      conversationId: conversationId.toString().substring(0, 8),
      count: messages.length,
      limit: finalLimit,
      offset: finalOffset,
    });

    return messages;
  }

  async clearConversationMessages(conversationId, userId) {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      throw new Error("Invalid conversation ID format");
    }

    // Verify user is participant
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    const isParticipant = conversation.participants.some(
      p => p.toString() === userId.toString()
    );

    if (!isParticipant) {
      throw new Error("Not authorized to clear this conversation");
    }

    // Soft delete all messages for this user
    const result = await Message.updateMany(
      {
        conversationId,
        deletedFor: { $ne: userId }
      },
      {
        $addToSet: { deletedFor: userId }
      }
    );

    // Reset conversation unread count for this user
    await Conversation.findByIdAndUpdate(
      conversationId,
      {
        $set: {
          [`unreadCount.${userId}`]: 0
        }
      }
    );

    logger.debug("Conversation cleared for user", {
      conversationId: conversationId.toString().substring(0, 8),
      userId: userId.toString().substring(0, 8),
      messagesCleared: result.modifiedCount,
    });

    return { clearedCount: result.modifiedCount };
  }

  // Cleanup method for service shutdown
  cleanup() {
    // Close Redis connection if exists
    if (this.redisClient && this.redisClient.quit) {
      this.redisClient.quit().catch(err => {
        logger.error('Error closing Redis connection:', err);
      });
    }
  }
}

// Create singleton instance
const messageService = new MessageService();

// Handle graceful shutdown
process.on("SIGTERM", () => {
  logger.info("Cleaning up MessageService...");
  messageService.cleanup();
});

process.on("SIGINT", () => {
  logger.info("Cleaning up MessageService...");
  messageService.cleanup();
});

module.exports = messageService;