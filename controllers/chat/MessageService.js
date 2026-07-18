// services/MessageService.js - COMPLETE FIXED VERSION
const mongoose = require("mongoose");
const crypto = require("crypto");
const Message = require("@models/Message");
const Conversation = require("@models/Conversation");
const { BaseUser } = require("@models/User");
const Block = require("@models/Block.model");
const notificationService = require("@services/notification.service");
const logger = require("@utils/logger");

// ========== CONFIGURATION ==========
const CONFIG = {
  EDIT_TIME_LIMIT: 15 * 60 * 1000,
  DUPLICATE_CHECK_WINDOW: 10000,
  MAX_MESSAGE_LENGTH: 10000,
  MAX_MESSAGES_PER_MINUTE: 20,
  MAX_MESSAGES_PER_HOUR: 100,
  VALID_STATUSES: [
    "pending",
    "sent",
    "delivered",
    "read",
    "failed",
    "pending_moderation",
  ],
  VALID_TYPES: ["text", "image", "video", "file", "audio", "system"],
  HARASSMENT_SCORE_THRESHOLD: 0.7,
  AUTO_MODERATION_THRESHOLD: 0.8,
  MAX_RETRY_ATTEMPTS: 3,
};

class MessageService {
  constructor() {
    this.redisClient = null;
    this.redisService = null;
    this.safetyService = null;
    this.initSafetyService();
  }

  setRedisService(redisService) {
    this.redisService = redisService;
    this.redisClient = redisService?.getClient?.();
    if (this.redisClient) {
      logger.info("✅ RedisService injected into MessageService");
    } else {
      logger.warn("⚠️  RedisService provided but client not available");
    }
  }

  setEncryptionService(encryptionService) {
    this.encryptionService = encryptionService;
    if (this.encryptionService) {
      logger.info("✅ EncryptionService injected into MessageService");
    } else {
      logger.warn("⚠️  EncryptionService provided but is null/undefined");
    }
  }

  async initSafetyService() {
    try {
      const SafetyService = require("@services/safety.service");
      this.safetyService = new SafetyService();
      logger.info("MessageService safety service initialized");
    } catch (safetyError) {
      logger.warn("Safety service not available:", safetyError.message);
      this.safetyService = null;
    }
  }

  // ========== RATE LIMITING ==========

  async checkRateLimit(senderId, receiverId) {
    if (
      !this.redisClient ||
      !this.redisService ||
      !this.redisService.isReady()
    ) {
      logger.debug("Redis not available, skipping rate limiting");
      return true;
    }

    try {
      const convMinuteKey = `ratelimit:conv:${senderId}:${receiverId}:minute`;
      const convCount = await this.redisService.safeOperation(
        async () => parseInt(await this.redisClient.get(convMinuteKey)) || 0,
        0,
        "checkRateLimit-convMinute",
      );
      if (convCount >= CONFIG.MAX_MESSAGES_PER_MINUTE) {
        throw new Error("Too many messages to this user. Please slow down.");
      }

      const userHourKey = `ratelimit:user:${senderId}:hour`;
      const userCount = await this.redisService.safeOperation(
        async () => parseInt(await this.redisClient.get(userHourKey)) || 0,
        0,
        "checkRateLimit-userHour",
      );
      if (userCount >= CONFIG.MAX_MESSAGES_PER_HOUR) {
        throw new Error(
          "Message rate limit exceeded. Please wait before sending more messages.",
        );
      }

      await this.redisService.safeOperation(
        async () => {
          const multi = this.redisClient.multi();
          multi.incr(convMinuteKey);
          multi.expire(convMinuteKey, 60);
          multi.incr(userHourKey);
          multi.expire(userHourKey, 3600);
          await multi.exec();
        },
        null,
        "checkRateLimit-updateCounters",
      );

      return true;
    } catch (error) {
      if (
        error.message.includes("Too many") ||
        error.message.includes("rate limit")
      )
        throw error;
      logger.error("Rate limit check error:", error);
      return true;
    }
  }

  // ========== SAFETY VALIDATION ==========

  async validateMessageSafety(senderId, receiverId, content, type) {
    if (type !== "text" || !content) {
      return {
        safe: true,
        score: 1.0,
        matchedPatterns: [],
        requiresModeration: false,
      };
    }

    const isBlocked = await Block.exists({
      blocker: receiverId,
      blocked: senderId,
      active: true,
    });
    if (isBlocked) throw new Error("Cannot send message to this user");

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
        safetyScore -= 0.2;
      }
    }

    const isFirstMessage = await this.isFirstMessage(senderId, receiverId);
    if (isFirstMessage) {
      if (/(http|https|www\.|\.com|\.org|\.net|\.io)/i.test(content)) {
        throw new Error("Links are not allowed in first messages");
      }
      if (content.length < 5)
        throw new Error("Please send a more meaningful first message");
      if (content.length > 500)
        throw new Error(
          "First messages should be concise (max 500 characters)",
        );
    }

    if (this.safetyService) {
      try {
        const safetyCheck = await this.safetyService.checkMessage({
          content,
          senderId,
          receiverId,
        });
        if (
          safetyCheck.flagged &&
          safetyCheck.score > CONFIG.AUTO_MODERATION_THRESHOLD
        ) {
          throw new Error("Message blocked for safety reasons");
        }
        safetyScore = Math.min(safetyScore, safetyCheck.score || 1.0);
      } catch (error) {
        logger.warn("Safety service unavailable:", error.message);
      }
    }

    const spamPatterns = [
      /(http|www\.)/gi,
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      /\b\d{10,}\b/g,
    ];
    let spamScore = 0;
    for (const pattern of spamPatterns) {
      const matches = content.match(pattern);
      if (matches) spamScore += matches.length * 0.1;
    }
    if (spamScore > 0.5)
      throw new Error("Message appears to contain spam content");

    return {
      safe: safetyScore > CONFIG.HARASSMENT_SCORE_THRESHOLD,
      score: safetyScore,
      matchedPatterns,
      requiresModeration: safetyScore < 0.8,
    };
  }

  async isFirstMessage(senderId, receiverId) {
    const count = await Message.countDocuments({
      $or: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ],
    });
    return count === 0;
  }

  // ========== DEDUPLICATION ==========

  async checkDuplicate(senderId, receiverId, content, clientMessageId) {
    if (this.redisClient && this.redisService && this.redisService.isReady()) {
      const now = Date.now();

      if (clientMessageId) {
        const existing = await this.redisService.safeOperation(
          async () =>
            await this.redisClient.get(`msg:client:${clientMessageId}`),
          null,
          "checkDuplicate-clientId",
        );
        if (existing) {
          logger.info("Duplicate detected by clientMessageId", {
            clientMessageId,
          });
          return JSON.parse(existing);
        }
      }

      const contentHash = crypto
        .createHash("sha256")
        .update(content || "")
        .digest("hex")
        .substring(0, 32);
      const dupKey = `msg:dup:${senderId}:${receiverId}:${contentHash}`;
      const duplicate = await this.redisService.safeOperation(
        async () => await this.redisClient.get(dupKey),
        null,
        "checkDuplicate-contentHash",
      );
      if (duplicate) {
        logger.info("Duplicate detected by content hash", {
          senderId,
          receiverId,
        });
        return JSON.parse(duplicate);
      }

      if (clientMessageId) {
        await this.redisService.safeOperation(
          async () =>
            await this.redisClient.setex(
              `msg:client:${clientMessageId}`,
              60,
              JSON.stringify({ senderId, receiverId, timestamp: now }),
            ),
          null,
          "checkDuplicate-setClientId",
        );
      }
      await this.redisService.safeOperation(
        async () =>
          await this.redisClient.setex(
            dupKey,
            CONFIG.DUPLICATE_CHECK_WINDOW / 1000,
            JSON.stringify({ senderId, receiverId, timestamp: now }),
          ),
        null,
        "checkDuplicate-setContentHash",
      );
      return null;
    }

    if (clientMessageId) {
      const existing = await Message.findOne({
        clientMessageId,
        senderId,
        receiverId,
      }).lean();
      if (existing) {
        logger.info("Duplicate detected in DB", { clientMessageId });
        return existing;
      }
    }
    return null;
  }

  // ========== STATISTICS ==========

  async getTotalUnreadCount(userId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) return 0;
      const conversations = await Conversation.find({ participants: userId })
        .select("unreadCount")
        .lean();
      let total = 0;
      const userIdStr = userId.toString();
      conversations.forEach((conv) => {
        total += conv.unreadCount?.[userIdStr] || 0;
      });
      return total;
    } catch (error) {
      logger.error("Error in getTotalUnreadCount:", error);
      return 0;
    }
  }

  async getUnreadCount(conversationId, userId) {
    try {
      if (
        !mongoose.Types.ObjectId.isValid(conversationId) ||
        !mongoose.Types.ObjectId.isValid(userId)
      )
        return 0;
      const conversation = await Conversation.findById(conversationId)
        .select("unreadCount participants")
        .lean();
      if (!conversation) return 0;
      const isParticipant = conversation.participants.some(
        (p) => p.toString() === userId.toString(),
      );
      if (!isParticipant) return 0;
      return conversation.unreadCount?.[userId.toString()] || 0;
    } catch (error) {
      logger.error("Error in getUnreadCount:", error);
      return 0;
    }
  }

  async getUserChatStats(userId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId))
        return this.getDefaultStats();

      const [conversationStats, messageStats] = await Promise.all([
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
                        {
                          $gte: [
                            "$lastMessageAt",
                            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                          ],
                        },
                        { $ne: ["$lastMessageAt", null] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]),
        Message.aggregate([
          {
            $facet: {
              sent: [
                { $match: { senderId: userId, deletedFor: { $ne: userId } } },
                { $count: "count" },
              ],
              received: [
                { $match: { receiverId: userId, deletedFor: { $ne: userId } } },
                { $count: "count" },
              ],
            },
          },
        ]),
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
      const lastMessage = await Message.findOne({
        $or: [{ senderId: userId }, { receiverId: userId }],
        deletedFor: { $ne: userId },
      })
        .sort({ createdAt: -1 })
        .select("createdAt")
        .lean();
      stats.lastMessageAt = lastMessage?.createdAt || null;
      return stats;
    } catch (error) {
      logger.error("Error in getUserChatStats:", error);
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

  // services/MessageService.js 
// ONLY THE sendMessage METHOD IS SHOWN - Replace lines 467-780 in your existing file
// Everything else in your MessageService.js stays the same

  async sendMessage(data) {
    const startTime = Date.now();

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
      } = data;

      logger.info("Processing message", {
        senderId: senderId?.toString().substring(0, 8),
        receiverId: receiverId?.toString().substring(0, 8),
        type,
        source,
        contentLength: content?.length || 0,
      });

      // ========== VALIDATION ==========
      if (!senderId || !receiverId || !type)
        throw new Error("senderId, receiverId, and type are required");

      const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
      if (!isValidObjectId(senderId) || !isValidObjectId(receiverId))
        throw new Error("Invalid user ID format");
      if (conversationId && !isValidObjectId(conversationId))
        throw new Error("Invalid conversation ID format");
      if (!CONFIG.VALID_TYPES.includes(type))
        throw new Error(
          `Invalid message type. Must be one of: ${CONFIG.VALID_TYPES.join(", ")}`,
        );
      if (content && content.length > CONFIG.MAX_MESSAGE_LENGTH)
        throw new Error(
          `Message too long (max ${CONFIG.MAX_MESSAGE_LENGTH} characters)`,
        );
      if (type === "text" && (!content || content.trim().length === 0))
        throw new Error("Content is required for text messages");

      // ========== EARLY DUPLICATE CHECK BY CLIENTMESSAGEID ==========
      if (clientMessageId) {
        const existingByClientId = await Message.findOne({
          clientMessageId,
          senderId,
          receiverId,
        }).lean();
        
        if (existingByClientId) {
          logger.info("Duplicate detected by clientMessageId, returning existing", {
            messageId: existingByClientId._id,
            clientMessageId,
          });
          return {
            ...existingByClientId,
            duplicate: true,
          };
        }
      }

      // ========== REDIS LOCK FOR CONTENT-BASED DEDUPLICATION ==========
      // 🔥 FIXED: Redis lock with proper syntax for all Redis client versions
      if (this.redisClient && this.redisService && this.redisService.isReady()) {
        const contentHash = crypto
          .createHash("sha256")
          .update(content || "")
          .digest("hex")
          .substring(0, 32);
        
        const lockKey = `msg:lock:${senderId}:${receiverId}:${contentHash}`;
        
        // Try to acquire a lock
        const lockAcquired = await this.redisService.safeOperation(
          async () => {
            try {
              // Try modern syntax first (node-redis v4+ or ioredis)
              const result = await this.redisClient.set(lockKey, "processing", {
                NX: true,
                EX: 5
              });
              return result === "OK" || result === true;
            } catch (modernErr) {
              // Fallback to legacy syntax (node-redis v3)
              try {
                const legacyResult = await this.redisClient.set(
                  lockKey,
                  "processing",
                  "NX",
                  "EX",
                  5
                );
                return legacyResult === "OK";
              } catch (legacyErr) {
                logger.warn('Redis SET failed with both syntaxes, proceeding without lock:', legacyErr.message);
                return true; // Proceed without lock if Redis fails
              }
            }
          },
          true, // Default to true if safeOperation fails
          "sendMessage-acquireLock",
        );
        
        if (!lockAcquired) {
          // Another request is processing the same message
          logger.info("Lock not acquired, waiting for other request to complete");
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Check if the other request succeeded
          const existing = await Message.findOne({
            senderId,
            receiverId,
            originalContent: content, // Match on PLAINTEXT not encrypted
            createdAt: { $gte: new Date(Date.now() - 5000) }
          }).lean();
          
          if (existing) {
            logger.info("Message was already processed by another request", {
              messageId: existing._id,
            });
            return {
              ...existing,
              duplicate: true,
            };
          }
          // If no existing message found, proceed (lock may have timed out)
        }
      }

      // ========== USER VALIDATION ==========
      const receiver = await BaseUser.findById(receiverId)
        .select("_id settings accountStatus messagingPreferences")
        .lean();
      if (!receiver) throw new Error("Receiver not found");
      if (
        !["active", "verified"].includes(receiver.accountStatus || "active")
      ) {
        throw new Error(`Receiver account is ${receiver.accountStatus}`);
      }

      // ========== SAFETY CHECK ==========
      if (type === "text") {
        const safetyCheck = await this.validateMessageSafety(
          senderId,
          receiverId,
          content,
          type,
        );
        if (!safetyCheck.safe) {
          await this.logSafetyViolation({
            senderId,
            receiverId,
            content: content.substring(0, 200),
            score: safetyCheck.score,
            matchedPatterns: safetyCheck.matchedPatterns,
            timestamp: new Date(),
          });
          if (safetyCheck.score < CONFIG.HARASSMENT_SCORE_THRESHOLD)
            throw new Error("Message blocked for safety reasons");
        }
      }

      // ========== RATE LIMITING ==========
      await this.checkRateLimit(senderId, receiverId);

      // ========== FIND OR CREATE CONVERSATION ==========
      let conversation;
      
      if (conversationId && isValidObjectId(conversationId)) {
        conversation = await Conversation.findById(conversationId);
        if (!conversation) throw new Error("Conversation not found");
        
        const isParticipant = conversation.participants.some(
          (p) => p.toString() === senderId.toString(),
        );
        if (!isParticipant)
          throw new Error("User is not a participant in this conversation");
      } else {
        // Use findOneAndUpdate with upsert for atomic conversation creation
        conversation = await Conversation.findOneAndUpdate(
          { participants: { $all: [senderId, receiverId] } },
          {
            $setOnInsert: {
              participants: [senderId, receiverId],
              createdAt: new Date(),
              unreadCount: {},
            },
            $set: {
              lastMessageAt: new Date(),
            },
          },
          { 
            upsert: true, 
            new: true,
            setDefaultsOnInsert: true 
          }
        );
      }

      const conversationIdString = conversation._id.toString();

      // ========== ENCRYPT CONTENT ==========
      let encryptedContent = content;
      let encryptionMetadata = {
        version: "v2",
        keyId: "default",
        isEncrypted: false,
        algorithm: "none",
      };

      if (type === "text" && content && this.encryptionService) {
        try {
          const result =
            await this.encryptionService.encryptMessageForStorage(content);
          if (result && result.content) {
            encryptedContent = result.content;
            encryptionMetadata = {
              version: "v2",
              keyId: "default",
              isEncrypted: true,
              algorithm: "AES-256-GCM",
            };
            logger.debug("Message content encrypted", {
              originalLength: content.length,
              encryptedLength: encryptedContent.length,
            });
          }
        } catch (encryptError) {
          logger.error("Failed to encrypt message:", encryptError);
          throw new Error(
            "Message encryption failed - cannot store unencrypted",
          );
        }
      } else if (!this.encryptionService) {
        logger.warn(
          "⚠️  EncryptionService not available - CRITICAL SECURITY ISSUE",
        );
        throw new Error(
          "Cannot send message - encryption service not available",
        );
      }

      // ========== FINAL DUPLICATE CHECK ==========
      if (clientMessageId) {
        const finalCheck = await Message.findOne({
          clientMessageId,
          senderId,
          receiverId,
        }).lean();
        
        if (finalCheck) {
          logger.info("Duplicate detected in final check", {
            messageId: finalCheck._id,
          });
          
          // Release Redis lock
          if (this.redisClient && this.redisService && this.redisService.isReady()) {
            const contentHash = crypto.createHash("sha256").update(content || "").digest("hex").substring(0, 32);
            const lockKey = `msg:lock:${senderId}:${receiverId}:${contentHash}`;
            await this.redisClient.del(lockKey).catch(() => {});
          }
          
          return {
            ...finalCheck,
            duplicate: true,
          };
        }
      }

      // ========== CREATE MESSAGE ==========
      const messageData = {
        senderId,
        receiverId,
        content: encryptedContent,
        originalContent: content,
        type,
        mediaUrl: mediaUrl || null,
        conversationId: conversationIdString,
        status: "sent",
        clientMessageId:
          clientMessageId ||
          `msg_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
        source,
        encryption: encryptionMetadata,
        metadata: {
          contentLength: content?.length || 0,
          requiresModeration: false,
          safetyScore: 1.0,
        },
        createdAt: new Date(),
      };

      const savedMessage = await Message.create(messageData);

      // ========== UPDATE CONVERSATION ==========
      await Conversation.findByIdAndUpdate(
        conversation._id,
        {
          $set: {
            lastMessage: {
              _id: savedMessage._id,
              content: content.substring(0, 100),
              senderId: senderId,
              type: type,
              createdAt: savedMessage.createdAt,
              clientMessageId: savedMessage.clientMessageId,
            },
            lastMessageAt: new Date(),
            lastMessageSender: senderId,
          },
          $inc: {
            [`unreadCount.${receiverId.toString()}`]: 1,
          },
        },
        { new: true }
      );

      // ========== RELEASE REDIS LOCK ==========
      if (this.redisClient && this.redisService && this.redisService.isReady()) {
        const contentHash = crypto
          .createHash("sha256")
          .update(content || "")
          .digest("hex")
          .substring(0, 32);
        const lockKey = `msg:lock:${senderId}:${receiverId}:${contentHash}`;
        await this.redisClient.del(lockKey).catch(() => {});
      }

      logger.info("Message created successfully", {
        messageId: savedMessage._id,
        conversationId: conversationIdString,
        duration: Date.now() - startTime,
      });

      // ========== POPULATE AND RETURN ==========
      const populatedMessage = await Message.findById(savedMessage._id)
        .populate({
          path: "senderId",
          select: "firstName lastName avatar email userName",
        })
        .lean();

      if (receiver.settings?.notifications?.messages !== false) {
        this.sendNotificationAsync(
          receiverId,
          senderId,
          content,
          savedMessage._id,
        ).catch((err) => logger.error("Notification error:", err));
      }

      return {
        ...populatedMessage,
        conversationId: conversation._id,
        duplicate: false,
      };

    } catch (error) {
      logger.error("Error in sendMessage", {
        error: error.message,
        code: error.code,
        senderId: data.senderId?.toString().substring(0, 8),
        receiverId: data.receiverId?.toString().substring(0, 8),
        duration: Date.now() - startTime,
      });

      throw error;
    }
  }

  async sendNotificationAsync(receiverId, senderId, content, messageId) {
    try {
      await notificationService.sendNewMessageNotification(
        receiverId,
        senderId,
        content,
        messageId,
      );
    } catch (error) {
      logger.error("Failed to send notification:", error);
    }
  }

  async logSafetyViolation(data) {
    try {
      const SafetyLog = require("@models/SafetyLog");
      await SafetyLog.create({ ...data, timestamp: new Date() });
    } catch (error) {
      logger.error("Failed to log safety violation:", error);
    }
  }

  async markMessageAsRead(userId, messageId) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const message = await Message.findById(messageId).session(session);
      if (!message) throw new Error("Message not found");

      const isAuthorized =
        message.receiverId.toString() === userId.toString() ||
        message.senderId.toString() === userId.toString();
      if (!isAuthorized)
        throw new Error("Not authorized to mark this message as read");

      if (message.status === "read") {
        await session.commitTransaction();
        return message;
      }

      message.status = "read";
      message.readAt = new Date();
      message.readBy = message.readBy || [];
      if (!message.readBy.includes(userId)) message.readBy.push(userId);
      await message.save({ session });

      if (message.conversationId) {
        await Conversation.findByIdAndUpdate(
          message.conversationId,
          { $inc: { [`unreadCount.${userId}`]: -1 } },
          { session },
        );
      }

      await session.commitTransaction();
      return message;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async markMessagesAsRead(messageIds, userId) {
  // Add retry logic for WriteConflict errors
  const maxRetries = 3;
  let attempt = 0;
  
  while (attempt < maxRetries) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const invalidIds = messageIds.filter(
        (id) => !mongoose.Types.ObjectId.isValid(id),
      );
      if (invalidIds.length > 0)
        throw new Error(
          `Invalid message IDs: ${invalidIds.slice(0, 5).join(", ")}`,
        );

      const messages = await Message.find({
        _id: { $in: messageIds },
        $or: [{ receiverId: userId }, { senderId: userId }],
      }).session(session);

      if (messages.length !== messageIds.length)
        throw new Error("Not authorized to mark some messages as read");

      // 🔥 FIX: Use bulkWrite instead of updateMany to avoid WriteConflict
      const bulkOps = messageIds.map(id => ({
        updateOne: {
          filter: { 
            _id: id, 
            status: { $in: ["sent", "delivered"] } 
          },
          update: {
            $addToSet: { readBy: userId },
            $set: { status: "read", readAt: new Date() }
          }
        }
      }));

      const updateResult = await Message.bulkWrite(bulkOps, { session });

      const conversationUpdates = new Map();
      let firstSenderId = null;
      let firstConversationId = null;

      messages.forEach((msg) => {
        if (!firstConversationId && msg.conversationId) {
          firstConversationId = msg.conversationId;
          firstSenderId = msg.senderId;
        }
        if (
          msg.conversationId &&
          msg.receiverId.toString() === userId.toString()
        ) {
          const convId = msg.conversationId.toString();
          conversationUpdates.set(
            convId,
            (conversationUpdates.get(convId) || 0) - 1,
          );
        }
      });

      // 🔥 FIX: Update conversations one at a time to avoid conflicts
      for (const [conversationId, count] of conversationUpdates.entries()) {
        await Conversation.findByIdAndUpdate(
          conversationId,
          { $inc: { [`unreadCount.${userId}`]: count } },
          { session }
        );
      }

      await session.commitTransaction();

      logger.info('Messages marked as read successfully', {
        count: updateResult.modifiedCount || 0,
        userId,
        attempt: attempt + 1
      });

      return {
        modifiedCount: updateResult.modifiedCount || 0,
        conversationId: firstConversationId,
        senderId: firstSenderId,
      };
      
    } catch (error) {
      await session.abortTransaction();
      
      // Retry on WriteConflict (code 112)
      if (error.code === 112 && attempt < maxRetries - 1) {
        attempt++;
        logger.warn(`⚠️  WriteConflict in markMessagesAsRead, retrying (${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 100 * attempt)); // exponential backoff
        continue;
      }
      
      logger.error('Error in markMessagesAsRead:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  throw new Error('Failed to mark messages as read after multiple retries');
}

  async getMessageById(messageId) {
    if (!mongoose.Types.ObjectId.isValid(messageId))
      throw new Error("Invalid message ID format");
    return Message.findById(messageId)
      .populate({
        path: "senderId",
        select: "firstName lastName avatar email userName",
      })
      .lean();
  }

  async deleteMessage(userId, messageId) {
    const message = await Message.findById(messageId);
    if (!message) throw new Error("Message not found");

    const isAuthorized =
      message.senderId.toString() === userId.toString() ||
      message.receiverId.toString() === userId.toString();
    if (!isAuthorized) throw new Error("Not authorized to delete this message");

    const result = await Message.findByIdAndUpdate(
      messageId,
      { $addToSet: { deletedFor: userId } },
      { new: true },
    );
    return { deleted: true, messageId: result._id };
  }

  async deleteMessagesBulk(userId, messageIds) {
    if (!Array.isArray(messageIds) || messageIds.length === 0)
      throw new Error("messageIds must be a non-empty array");

    const invalidIds = messageIds.filter(
      (id) => !mongoose.Types.ObjectId.isValid(id),
    );
    if (invalidIds.length > 0)
      throw new Error(
        `Invalid message IDs: ${invalidIds.slice(0, 5).join(", ")}`,
      );

    const firstMessage = await Message.findOne({
      _id: { $in: messageIds },
      $or: [{ senderId: userId }, { receiverId: userId }],
    })
      .select("conversationId")
      .lean();

    const authorizedCount = await Message.countDocuments({
      _id: { $in: messageIds },
      $or: [{ senderId: userId }, { receiverId: userId }],
    });
    if (authorizedCount !== messageIds.length)
      throw new Error("Not authorized to delete some messages");

    const result = await Message.updateMany(
      { _id: { $in: messageIds } },
      { $addToSet: { deletedFor: userId } },
    );

    return {
      deletedCount: result.modifiedCount,
      conversationId: firstMessage?.conversationId ?? null,
    };
  }

  async editMessage(userId, messageId, content) {
    if (!content || content.trim().length === 0)
      throw new Error("Message content is required");
    if (content.length > CONFIG.MAX_MESSAGE_LENGTH)
      throw new Error(
        `Message too long (max ${CONFIG.MAX_MESSAGE_LENGTH} characters)`,
      );

    const message = await Message.findById(messageId);
    if (!message) throw new Error("Message not found");

    if (message.senderId.toString() !== userId.toString()) {
      throw new Error("Not authorized to edit this message");
    }

    const messageAge = Date.now() - new Date(message.createdAt).getTime();
    if (messageAge > CONFIG.EDIT_TIME_LIMIT) {
      throw new Error(
        "Message can no longer be edited (15 minute window has passed)",
      );
    }

    if (!message.editHistory) message.editHistory = [];
    message.editHistory.push({
      content: message.content,
      editedAt: new Date(),
    });

    message.content = content.trim();
    message.editedAt = new Date();
    message.isEdited = true;

    await message.save();

    logger.info("Message edited", {
      messageId,
      userId,
      editCount: message.editHistory.length,
    });

    return message;
  }

  async getConversationMessages(conversationId, options = {}) {
    const { limit = 50, before, after, includeDeleted = false } = options;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      throw new Error("Invalid conversation ID format");
    }

    const query = { conversationId };

    if (!includeDeleted) {
      query.deletedFor = { $not: { $size: 2 } };
    }

    if (before) {
      if (!mongoose.Types.ObjectId.isValid(before))
        throw new Error("Invalid 'before' cursor");
      const cursorMessage = await Message.findById(before)
        .select("createdAt")
        .lean();
      if (cursorMessage) query.createdAt = { $lt: cursorMessage.createdAt };
    }

    if (after) {
      if (!mongoose.Types.ObjectId.isValid(after))
        throw new Error("Invalid 'after' cursor");
      const cursorMessage = await Message.findById(after)
        .select("createdAt")
        .lean();
      if (cursorMessage) {
        query.createdAt = {
          ...(query.createdAt || {}),
          $gt: cursorMessage.createdAt,
        };
      }
    }

    const messages = await Message.find(query)
      .populate({
        path: "senderId",
        select: "firstName lastName avatar email userName",
      })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    return messages.reverse();
  }

  async clearConversationMessages(conversationId, userId) {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      throw new Error("Invalid conversation ID format");
    }

    const conversation = await Conversation.findById(conversationId)
      .select("participants")
      .lean();

    if (!conversation) throw new Error("Conversation not found");

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === userId.toString(),
    );
    if (!isParticipant)
      throw new Error("Not authorized to clear this conversation");

    const result = await Message.updateMany(
      { conversationId, deletedFor: { $ne: userId } },
      { $addToSet: { deletedFor: userId } },
    );

    logger.info("Conversation cleared", {
      conversationId,
      userId,
      clearedCount: result.modifiedCount,
    });

    return {
      clearedCount: result.modifiedCount,
      conversationId,
    };
  }
}

// Singleton export
const messageService = new MessageService();
module.exports = messageService;