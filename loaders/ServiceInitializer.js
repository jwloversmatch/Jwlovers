// loaders/ServiceInitializer.js
const EncryptionService = require("@services/encryption.service");
const RedisService = require("@services/redis.service");
const DatabaseService = require("../config/database");
const WebSocketService = require("@services/websocket.service");
const ConversationServiceWrapper = require("@services/conversation-wrapper.service");
const ControllerBridgeService = require("@services/controller-bridge.service");
const CONFIG = require("../config/constant");

class ServiceInitializer {
  constructor(server, config, logger) {
    this.server = server;
    this.config = config;
    this.logger = logger;
    this.services = {};
  }

  async initializeAll() {
    await this.initializeEncryption();
    await this.initializeRedis();
    await this.initializeDatabase();
    await this.initializeConversationWrapper();
    await this.initializeWebSocket();
    await this.initializePresenceService();
    await this.initializeControllerBridge();

    return this.services;
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

  async initializeConversationWrapper() {
    this.logger.info("🔄 Initializing Conversation Service Wrapper...");

    this.services.conversationServiceWrapper = new ConversationServiceWrapper(
      this.logger,
    );

    this.logger.info("✅ Conversation Service Wrapper initialized");
  }

  async initializeWebSocket() {
    this.logger.info("🔄 Setting up WebSocket...");

    // Load validation schemas
    let socketSchemas = {};
    try {
      socketSchemas = require("../validators/socket.schemas");
      this.logger.info("✅ Socket validation schemas loaded");
    } catch (error) {
      this.logger.warn(
        "⚠️ Socket validation schemas not found, using empty schema",
      );
    }

    this.services.socketSchemas = socketSchemas;

    this.services.webSocketService = new WebSocketService(
      CONFIG,
      {
        redisService: this.services.redisService,
        encryptionService: this.services.encryptionService,
        conversationServiceWrapper: this.services.conversationServiceWrapper,
      },
      socketSchemas,
      this.logger,
      false,
    );

    const io = await this.services.webSocketService.setup(
      this.server,
      this.config.cors.origins,
    );

    // Make globally available
    global.getWebSocketService = () => this.services.webSocketService;
    global.getSocketIO = () => io;
    global.io = io;

    this.services.io = io;

    this.logger.info("✅ WebSocket initialized");
  }

  async initializePresenceService() {
    this.logger.info("🔄 Initializing PresenceService...");

    if (
      !this.services.redisService ||
      typeof this.services.redisService.isReady !== "function"
    ) {
      throw new Error("RedisService not properly initialized");
    }

    const PresenceService = require("@services/presence.service");
    this.services.presenceService = new PresenceService(
      this.services.io,
      this.services.redisService,
    );

    // Make globally available
    global.presenceService = this.services.presenceService;
    global.getPresenceService = () => this.services.presenceService;

    this.logger.info("✅ PresenceService initialized");
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

  getServices() {
    return this.services;
  }

  exportToApp(app) {
    app.set("io", this.services.io);
    app.set("controllerBridge", this.services.controllerBridge);
    app.set("RedisService", this.services.redisService);
    app.set("EncryptionService", this.services.encryptionService);
    app.set(
      "ConversationServiceWrapper",
      this.services.conversationServiceWrapper,
    );
    app.set("DatabaseService", this.services.databaseService);
    app.set("WebSocketService", this.services.webSocketService);
    app.set("PresenceService", this.services.presenceService);

    this.logger.info("✅ Services exported to Express app");
  }
}

module.exports = ServiceInitializer;
