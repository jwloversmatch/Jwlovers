// loaders/ServiceInitializer.js
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
    // Order matters - dependencies first
    await this.initializeEncryption();
    await this.initializeRedis();
    await this.initializeDatabase();
    await this.initializeConversationWrapper();
    await this.initializeWebSocket();  // Creates WebSocketService
    await this.initializePresenceService();  // Needs WebSocketService.io
    await this.initializeControllerBridge();
    
    // Final setup after all services are created
    await this.finalizeWebSocketSetup();
    
    return this.services;
  }

  async initializeEncryption() {
    this.logger.info("🔄 Initializing Encryption Service...");

    const encryptionSalt = this.config.encryption.salt || CONFIG.ENCRYPTION.SALT;
    this.logger.info(`🔐 Encryption salt: ${encryptionSalt.substring(0, 8)}...`);

    this.services.encryptionService = new EncryptionService(CONFIG.ENCRYPTION).init(
      this.config.encryption.key,
      encryptionSalt
    );

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
      this.logger.warn("⚠️ Redis not available. Rate limiting will use memory fallback.");
    }
  }

  async initializeDatabase() {
    this.logger.info("🔄 Connecting to MongoDB...");

    this.services.databaseService = new DatabaseService(CONFIG.DATABASE, this.logger);
    await this.services.databaseService.connect();

    this.logger.info("✅ MongoDB connected");
  }

  async initializeConversationWrapper() {
    this.logger.info("🔄 Initializing Conversation Service Wrapper...");

    this.services.conversationServiceWrapper = new ConversationServiceWrapper(this.logger);

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
      this.logger.warn("⚠️ Socket validation schemas not found, using empty schema");
    }

    this.services.socketSchemas = socketSchemas;

    // Create WebSocketService with all currently available services
    // Pass this.services object which will be updated as more services are added
    this.services.webSocketService = new WebSocketService(
      this.config.ws || CONFIG.WEBSOCKET || {},  // Use config.ws if available
      this.services,  // Pass all services (will be updated later)
      socketSchemas,
      this.logger,
      this.services.redisService  // Pass RedisService directly as last param if needed
    );

    // Setup WebSocket server
    const io = await this.services.webSocketService.setup(this.server, this.config.cors.origins);
    this.services.io = io;

    // Setup middleware
    this.services.webSocketService.setupMiddleware();

    // Make globally available
    global.getWebSocketService = () => this.services.webSocketService;
    global.getSocketIO = () => io;
    global.io = io;

    this.logger.info("✅ WebSocket initialized");
  }

  async initializePresenceService() {
    this.logger.info("🔄 Initializing PresenceService...");

    if (!this.services.redisService || typeof this.services.redisService.isReady !== "function") {
      throw new Error("RedisService not properly initialized");
    }

    const PresenceService = require("@services/presence.service");
    this.services.presenceService = new PresenceService(
      this.services.io,
      this.services.redisService
    );

    // Update WebSocketService with PresenceService
    if (this.services.webSocketService && this.services.webSocketService.setPresenceService) {
      this.services.webSocketService.setPresenceService(this.services.presenceService);
      this.logger.info("✅ PresenceService injected into WebSocketService");
    }

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
      this.logger
    );

    this.logger.info("✅ Controller Bridge initialized");
  }

  async finalizeWebSocketSetup() {
    this.logger.info("🔄 Finalizing WebSocket setup...");

    if (this.services.webSocketService) {
      // Setup event handlers (requires all services to be initialized)
      this.services.webSocketService.setupEventHandlers();
      
      // Log WebSocket status
      const io = this.services.io;
      if (io) {
        const connections = io.engine?.clientsCount || 0;
        this.logger.info(`✅ WebSocket ready (${connections} connections)`);
      }
    }

    this.logger.info("✅ WebSocket setup finalized");
  }

  getServices() {
    return this.services;
  }

  exportToApp(app) {
    app.set("io", this.services.io);
    app.set("controllerBridge", this.services.controllerBridge);
    app.set("RedisService", this.services.redisService);
    app.set("EncryptionService", this.services.encryptionService);
    app.set("ConversationServiceWrapper", this.services.conversationServiceWrapper);
    app.set("DatabaseService", this.services.databaseService);
    app.set("WebSocketService", this.services.webSocketService);
    app.set("PresenceService", this.services.presenceService);

    // Also export all services as a single object for convenience
    app.set("services", this.services);

    this.logger.info("✅ Services exported to Express app");
  }
}

module.exports = ServiceInitializer;