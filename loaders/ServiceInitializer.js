// loaders/ServiceInitializer.js - COMPLETE FIXED VERSION
const EncryptionService = require("@services/encryption.service");
const RedisService = require("@services/redis.service");
const DatabaseService = require("@config/database");
const WebSocketService = require("@services/websocket.service");
const ConversationServiceWrapper = require("@services/conversation-wrapper.service");
const ControllerBridgeService = require("@services/controller-bridge.service");
const CONFIG = require("@config/constant");

const ChatService = require("@services/chatService");

class ServiceInitializer {
  constructor(server, config, logger) {
    this.server = server;
    this.config = config;
    this.logger = logger;
    this.services = {};
  }

  async initializeAll() {
    this.logger.info("🚀 Starting service initialization...");

    try {
      // PHASE 1: Core Infrastructure
      await this.initializeEncryption();
      await this.initializeRedis();
      await this.initializeDatabase();

      // PHASE 2: Business Logic Services
      await this.initializeChatService();
      await this.initializeConversationWrapper();

      // PHASE 3: WebSocket Infrastructure (creates io)
      await this.initializeWebSocket();

      // PHASE 4: Real-time Services (needs io from Phase 3)
      await this.initializePresenceService();

      // PHASE 5: Controller Bridge
      await this.initializeControllerBridge();

      // PHASE 6: Service Injection
      await this.injectServices();

      // PHASE 7: Final Setup
      await this.finalizeWebSocketSetup();

      this.logger.info("🎉 All services initialized successfully");
      return this.services;
    } catch (error) {
      this.logger.error(`❌ Service initialization failed: ${error.message}`);
      this.logger.error(error.stack);
      await this.cleanupServices();
      throw error;
    }
  }

  async initializeEncryption() {
    this.logger.info("🔄 Initializing Encryption Service...");

    const encryptionSalt = this.config.encryption.salt || CONFIG.ENCRYPTION.SALT;
    
    if (!encryptionSalt || encryptionSalt.length < 16) {
      throw new Error(
        "ENCRYPTION_SALT must be at least 16 characters. " +
        "Generate with: openssl rand -hex 32"
      );
    }
    
    this.logger.info(`🔐 Encryption salt: ${encryptionSalt.substring(0, 8)}...`);

    // FIXED: await the async init() method
    this.services.encryptionService = await new EncryptionService(CONFIG.ENCRYPTION)
      .init(this.config.encryption.key, encryptionSalt);

    this.logger.info("✅ Encryption Service initialized");
  }

  async initializeRedis() {
    this.logger.info("🔄 Initializing Redis...");

    this.services.redisService = new RedisService(CONFIG.REDIS, this.logger);
    await this.services.redisService.init();

    if (this.services.redisService.isReady()) {
      try {
        const ping = await this.services.redisService.getClient().ping();
        this.logger.info(`✅ Redis connected: ${ping}`);

        global.redisClient = this.services.redisService.getClient();
        global.redis = this.services.redisService.getClient();
        this.logger.info("✅ Redis client made globally available");
      } catch (error) {
        this.logger.error(`❌ Redis connection test failed: ${error.message}`);
      }
    } else {
      this.logger.warn("⚠️ Redis not available. Rate limiting will use memory fallback.");
    }
  }

  async initializeDatabase() {
    this.logger.info("🔄 Connecting to MongoDB...");

    this.services.databaseService = new DatabaseService(CONFIG.DATABASE, this.logger);
    await this.services.databaseService.connect();

    this.logger.info("✅ MongoDB connected");
  }

  async initializeChatService() {
    this.logger.info("🔄 Initializing Chat Service...");
    this.services.chatService = ChatService;
    this.logger.info("✅ Chat Service initialized");
  }

  async initializeConversationWrapper() {
    this.logger.info("🔄 Initializing Conversation Service Wrapper...");

    this.services.conversationServiceWrapper = new ConversationServiceWrapper(
      this.services.chatService,
      this.logger,
    );
    this.logger.info("✅ Conversation Service Wrapper initialized");
  }

  async initializeWebSocket() {
    this.logger.info("🔄 Setting up WebSocket...");

    let socketSchemas = {};
    try {
      socketSchemas = require("@validations/socket.schemas");
      this.logger.info("✅ Socket validation schemas loaded");
    } catch (error) {
      this.logger.warn("⚠️ Socket validation schemas not found, using empty schema");
    }

    this.services.socketSchemas = socketSchemas;

    this.services.webSocketService = new WebSocketService(
      this.config.ws || CONFIG.WEBSOCKET || {},
      {
        encryptionService: this.services.encryptionService,
        redisService: this.services.redisService,
        databaseService: this.services.databaseService,
        chatService: this.services.chatService,
        conversationServiceWrapper: this.services.conversationServiceWrapper,
        profileService: this.services.profileService,
      },
      socketSchemas,
      this.logger,
      this.services.redisService, // ← Pass as 5th argument
    );

    const io = await this.services.webSocketService.setup(
      this.server,
      this.config.cors.origins,
    );
    this.services.io = io;

    this.services.webSocketService.setupMiddleware();

    global.getWebSocketService = () => this.services.webSocketService;
    global.getSocketIO = () => io;
    global.io = io;

    this.logger.info("✅ WebSocket initialized");
  }

  async initializePresenceService() {
    this.logger.info("🔄 Initializing Presence Service...");

    const PresenceService = require("@services/presence.service");
    this.services.presenceService = new PresenceService(
      this.services.redisService,
      this.logger,
      this.services.io
    );

    if (this.services.presenceService.setIo) {
      this.services.presenceService.setIo(this.services.io);
    }

    this.logger.info("✅ Presence Service initialized");
  }

  async initializeControllerBridge() {
    this.logger.info("🔄 Setting up Controller Bridge...");

    this.services.controllerBridge = new ControllerBridgeService(
      this.services.io,
      this.services.encryptionService,
      this.services.redisService,
      this.services.socketSchemas,
      this.logger,
    );
    this.logger.info("✅ Controller Bridge initialized");
  }

  async injectServices() {
    this.logger.info("🔄 Injecting services into controllers...");

    // Inject WebSocketService into ChatController
    try {
      const chatController = require("@controllers/chat/chat.controller");
      
      if (!chatController) {
        this.logger.error("❌ ChatController module not found");
      } else if (!chatController.setWebSocketService) {
        this.logger.error("❌ ChatController.setWebSocketService method not found");
        this.logger.error(`   Available methods: ${Object.keys(chatController).filter(k => typeof chatController[k] === 'function').join(", ")}`);
      } else if (!this.services.webSocketService) {
        this.logger.error("❌ WebSocketService not available");
      } else {
        chatController.setWebSocketService(this.services.webSocketService);
        this.logger.info("✅ WebSocketService injected into ChatController");
      }
    } catch (error) {
      this.logger.error("❌ Failed to inject WebSocketService into ChatController:");
      this.logger.error(`   ${error.message}`);
      if (error.stack) this.logger.error(`   ${error.stack}`);
    }

    // Get MessageService instance
    let messageService;
    try {
      messageService = require("@controllers/chat/MessageService");
      
      if (!messageService) {
        this.logger.error("❌ MessageService module not found");
        return;
      }
    } catch (error) {
      this.logger.error("❌ Failed to load MessageService:");
      this.logger.error(`   ${error.message}`);
      return;
    }

    // Inject RedisService into MessageService
    try {
      if (!messageService.setRedisService) {
        this.logger.warn("⚠️  MessageService.setRedisService method not found");
      } else if (!this.services.redisService) {
        this.logger.warn("⚠️  RedisService not available (Redis may be down)");
      } else {
        messageService.setRedisService(this.services.redisService);
        this.logger.info("✅ RedisService injected into MessageService");
      }
    } catch (error) {
      this.logger.error("❌ Failed to inject RedisService into MessageService:");
      this.logger.error(`   ${error.message}`);
    }

    // 🔥 CRITICAL: Inject EncryptionService into MessageService
    try {
      if (!messageService.setEncryptionService) {
        this.logger.error("❌ MessageService.setEncryptionService method not found!");
        this.logger.error("   Messages will NOT be encrypted - this is a CRITICAL security issue!");
        this.logger.error("   Add setEncryptionService(encryptionService) method to MessageService");
      } else if (!this.services.encryptionService) {
        this.logger.error("❌ EncryptionService not available!");
      } else {
        messageService.setEncryptionService(this.services.encryptionService);
        this.logger.info("✅ EncryptionService injected into MessageService");
      }
    } catch (error) {
      this.logger.error("❌ Failed to inject EncryptionService into MessageService:");
      this.logger.error(`   ${error.message}`);
    }

    this.logger.info("✅ Service injection completed");
  }

  async finalizeWebSocketSetup() {
    this.logger.info("🔄 Finalizing WebSocket setup...");

    if (this.services.webSocketService) {
      this.services.webSocketService.setupEventHandlers();

      // 🔥 CRITICAL FIX: Inject PresenceService into WebSocketService
      if (
        this.services.presenceService &&
        this.services.webSocketService.setPresenceService
      ) {
        this.services.webSocketService.setPresenceService(this.services.presenceService);
        this.logger.info("✅ PresenceService injected into WebSocketService");
      }

      // 🔥 CRITICAL FIX: Inject EncryptionService into WebSocketService
      if (
        this.services.encryptionService &&
        this.services.webSocketService.setEncryptionService
      ) {
        this.services.webSocketService.setEncryptionService(this.services.encryptionService);
        this.logger.info("✅ EncryptionService injected into WebSocketService");
      } else if (!this.services.webSocketService.setEncryptionService) {
        this.logger.error("❌ WebSocketService.setEncryptionService method not found!");
        this.logger.error("   Socket messages will NOT be decrypted - users will see encrypted JSON!");
      } else if (!this.services.encryptionService) {
        this.logger.error("❌ EncryptionService not available for WebSocketService!");
      }

      const io = this.services.io;
      if (io) {
        const connections = io.engine?.clientsCount || 0;
        this.logger.info(`✅ WebSocket ready (${connections} connections)`);
      }
    }

    this.logger.info("✅ WebSocket setup finalized");
  }

  async cleanupServices() {
    this.logger.info("🔄 Cleaning up services after initialization failure...");

    const cleanupOrder = [
      "controllerBridge",
      "webSocketService",
      "presenceService",
      "conversationServiceWrapper",
      "redisService",
      "databaseService",
    ];

    for (const serviceName of cleanupOrder) {
      const service = this.services[serviceName];
      if (service && typeof service.cleanup === "function") {
        try {
          await service.cleanup();
          this.logger.info(`✅ ${serviceName} cleaned up`);
        } catch (error) {
          this.logger.warn(`⚠️ Failed to cleanup ${serviceName}: ${error.message}`);
        }
      }
    }
  }

  getServices() {
    return this.services;
  }

  exportToApp(app) {
    app.set("io", this.services.io);
    app.set("controllerBridge", this.services.controllerBridge);
    app.set("RedisService", this.services.redisService);
    app.set("EncryptionService", this.services.encryptionService);
    app.set("EmailService", this.services.emailService);
    app.set("ProfileService", this.services.profileService);
    app.set("PresenceService", this.services.presenceService);
    app.set("ChatService", this.services.chatService);
    app.set("ConversationServiceWrapper", this.services.conversationServiceWrapper);
    app.set("DatabaseService", this.services.databaseService);
    app.set("WebSocketService", this.services.webSocketService);
    app.set("services", this.services);

    this.logger.info("✅ All services exported to Express app");
  }
}

module.exports = ServiceInitializer;