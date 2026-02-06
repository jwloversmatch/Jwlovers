// loaders/ServiceInitializer.js - REAL SERVICES ONLY (NO MOCKS)
const EncryptionService = require("@services/encryption.service");
const RedisService = require("@services/redis.service");
const DatabaseService = require("@config/database");
const WebSocketService = require("@services/websocket.service");
const ConversationServiceWrapper = require("@services/conversation-wrapper.service");
const ControllerBridgeService = require("@services/controller-bridge.service");
const CONFIG = require("@config/constant");

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
      // Order matters - core infrastructure first
      await this.initializeEncryption();
      await this.initializeRedis();
      await this.initializeDatabase();
      // await this.initializeEmailService();

      // Business logic services
      // await this.initializeAuthService();
      // await this.initializeUserService();
      // await this.initializeProfileService();
      await this.initializePresenceService();
      // await this.initializeMatchService();
      // await this.initializeChatService();
      // await this.initializeAdminService();

      // WebSocket related services
      await this.initializeConversationWrapper();
      await this.initializeWebSocket();
      await this.initializeControllerBridge();

      // Final setup after all services are created
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

    const encryptionSalt =
      this.config.encryption.salt || CONFIG.ENCRYPTION.SALT;
    this.logger.info(
      `🔐 Encryption salt: ${encryptionSalt.substring(0, 8)}...`,
    );

    this.services.encryptionService = new EncryptionService(
      CONFIG.ENCRYPTION,
    ).init(this.config.encryption.key, encryptionSalt);

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

        // Make globally available
        global.redisClient = this.services.redisService.getClient();
        global.redis = this.services.redisService.getClient();
        this.logger.info("✅ Redis client made globally available");
      } catch (error) {
        this.logger.error(`❌ Redis connection test failed: ${error.message}`);
      }
    } else {
      this.logger.warn(
        "⚠️ Redis not available. Rate limiting will use memory fallback.",
      );
    }
  }

  async initializeDatabase() {
    this.logger.info("🔄 Connecting to MongoDB...");

    this.services.databaseService = new DatabaseService(
      CONFIG.DATABASE,
      this.logger,
    );
    await this.services.databaseService.connect();

    this.logger.info("✅ MongoDB connected");
  }

  async initializeEmailService() {
    this.logger.info("🔄 Initializing Email Service...");

    const EmailService = require("@services/email");
    this.services.emailService = new EmailService(
      this.config.email || CONFIG.EMAIL,
      this.logger,
    );
    this.logger.info("✅ Email Service initialized");
  }

  // async initializeAuthService() {
  //   this.logger.info("🔄 Initializing Auth Service...");

  //   const AuthService = require("@services/AuthService");
  //   this.services.authService = new AuthService(
  //     this.services.databaseService,
  //     this.services.redisService,
  //     this.services.encryptionService,
  //     this.services.emailService,
  //     this.logger
  //   );
  //   this.logger.info("✅ Auth Service initialized");
  // }

  // async initializeUserService() {
  //   this.logger.info("🔄 Initializing User Service...");

  //   const UserService = require("@services/user.service");
  //   this.services.userService = new UserService(
  //     this.services.databaseService,
  //     this.services.redisService,
  //     this.services.encryptionService,
  //     this.logger
  //   );
  //   this.logger.info("✅ User Service initialized");
  // }

  async initializeProfileService() {
    this.logger.info("🔄 Initializing Profile Service...");

    const ProfileService = require("@services/profile.service");
    this.services.profileService = new ProfileService(
      this.services.databaseService,
      this.services.redisService,
      this.logger,
    );
    this.logger.info("✅ Profile Service initialized");
  }

  async initializePresenceService() {
    this.logger.info("🔄 Initializing Presence Service...");

    const PresenceService = require("@services/presence.service");
    this.services.presenceService = new PresenceService(
      this.services.redisService,
      this.logger,
    );
    this.logger.info("✅ Presence Service initialized");
  }

  // async initializeMatchService() {
  //   this.logger.info("🔄 Initializing Match Service...");

  //   const MatchService = require("@services/match.service");
  //   this.services.matchService = new MatchService(
  //     this.services.databaseService,
  //     this.services.redisService,
  //     this.services.profileService,
  //     this.logger
  //   );
  //   this.logger.info("✅ Match Service initialized");
  // }

  // async initializeChatService() {
  //   this.logger.info("🔄 Initializing Chat Service...");

  //   const ChatService = require("@services/chat.service");
  //   this.services.chatService = new ChatService(
  //     this.services.databaseService,
  //     this.services.redisService,
  //     this.services.encryptionService,
  //     this.logger
  //   );
  //   this.logger.info("✅ Chat Service initialized");
  // }

  // async initializeAdminService() {
  //   this.logger.info("🔄 Initializing Admin Service...");

  //   const AdminService = require("@services/admin.service");
  //   this.services.adminService = new AdminService(
  //     this.services.databaseService,
  //     this.services.redisService,
  //     this.logger
  //   );
  //   this.logger.info("✅ Admin Service initialized");
  // }

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

    // Load validation schemas
    let socketSchemas = {};
    try {
      socketSchemas = require("@validations/socket.schemas");
      this.logger.info("✅ Socket validation schemas loaded");
    } catch (error) {
      this.logger.warn(
        "⚠️ Socket validation schemas not found, using empty schema",
      );
    }

    this.services.socketSchemas = socketSchemas;

    // Create WebSocketService with all available services
    this.services.webSocketService = new WebSocketService(
      this.config.ws || CONFIG.WEBSOCKET || {},
      {
        encryptionService: this.services.encryptionService,
        redisService: this.services.redisService,
        databaseService: this.services.databaseService,
        presenceService: this.services.presenceService,
        // chatService: this.services.chatService,
        conversationServiceWrapper: this.services.conversationServiceWrapper,
        // authService: this.services.authService,
        // userService: this.services.userService,
        profileService: this.services.profileService,
        // matchService: this.services.matchService
      },
      socketSchemas,
      this.logger,
    );

    // Setup WebSocket server
    const io = await this.services.webSocketService.setup(
      this.server,
      this.config.cors.origins,
    );
    this.services.io = io;

    // Setup middleware
    this.services.webSocketService.setupMiddleware();

    // Update presence service with io instance
    if (this.services.presenceService && this.services.presenceService.setIo) {
      this.services.presenceService.setIo(io);
    }

    // Make globally available
    global.getWebSocketService = () => this.services.webSocketService;
    global.getSocketIO = () => io;
    global.io = io;

    this.logger.info("✅ WebSocket initialized");
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

  async finalizeWebSocketSetup() {
    this.logger.info("🔄 Finalizing WebSocket setup...");

    if (this.services.webSocketService) {
      // Setup event handlers (requires all services to be initialized)
      this.services.webSocketService.setupEventHandlers();

      // Update WebSocketService with PresenceService if not already done
      if (
        this.services.presenceService &&
        this.services.webSocketService.setPresenceService
      ) {
        this.services.webSocketService.setPresenceService(
          this.services.presenceService,
        );
        this.logger.info("✅ PresenceService injected into WebSocketService");
      }

      // Log WebSocket status
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
          this.logger.warn(
            `⚠️ Failed to cleanup ${serviceName}: ${error.message}`,
          );
        }
      }
    }
  }

  getServices() {
    return this.services;
  }

  exportToApp(app) {
    // Export all individual services
    app.set("io", this.services.io);
    app.set("controllerBridge", this.services.controllerBridge);
    app.set("RedisService", this.services.redisService);
    app.set("EncryptionService", this.services.encryptionService);
    app.set("EmailService", this.services.emailService);
    // app.set("AuthService", this.services.authService);
    // app.set("UserService", this.services.userService);
    app.set("ProfileService", this.services.profileService);
    app.set("PresenceService", this.services.presenceService);
    // app.set("MatchService", this.services.matchService);
    // app.set("ChatService", this.services.chatService);
    // app.set("AdminService", this.services.adminService);
    app.set(
      "ConversationServiceWrapper",
      this.services.conversationServiceWrapper,
    );
    app.set("DatabaseService", this.services.databaseService);
    app.set("WebSocketService", this.services.webSocketService);

    // Export all services as a single object for convenience
    app.set("services", this.services);

    this.logger.info("✅ All services exported to Express app");
  }
}

module.exports = ServiceInitializer;
