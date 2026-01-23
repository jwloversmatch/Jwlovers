// server.js - REFACTORED
require("dotenv").config();
require("module-alias/register");
const express = require("express");
const { validateEnvVars } = require("./config/env-validator");

// Import our modular components
const ServerConfig = require("./config/ServerConfig");
const MiddlewareSetup = require("./config/MiddlewareSetup");
const ServiceInitializer = require("./loaders/ServiceInitializer");
const RouteLoader = require("./loaders/RouteLoader");
const WebSocketHandler = require("./handlers/WebSocketHandler");
const APIEndpoints = require("./handlers/APIEndpoints");

// Import rate limiting
const {
  apiLimiter,
  socketRateLimit,
  rateLimitInfoMiddleware,
  getRateLimitMetrics,
  redisCircuitBreaker,
  RATE_LIMIT_CONFIG,
} = require("@middleware/rateLimit");

// ========== INITIALIZATION ==========
validateEnvVars();

const app = express();
const server = require("http").createServer(app);

const config = ServerConfig.getConfig();
const logger = ServerConfig.getLogger();

// Validate encryption key
ServerConfig.validateEncryptionKey();

// ========== SETUP MIDDLEWARE ==========
const middlewareSetup = new MiddlewareSetup(app, config, logger);
middlewareSetup.setupAll();
middlewareSetup.setupRateLimitInfo(rateLimitInfoMiddleware);

// ========== SERVER STARTUP ==========
const startServer = async () => {
  try {
    ServerConfig.logConfiguration();

    // Initialize all services
    const serviceInitializer = new ServiceInitializer(server, config, logger);
    const services = await serviceInitializer.initializeAll();
    serviceInitializer.exportToApp(app);

    // Setup WebSocket authentication and handlers
    const wsHandler = new WebSocketHandler(services.io, services.presenceService, logger);
    wsHandler.setupAuthentication();
    wsHandler.setupPresenceHandlers();

    if (config.rateLimiting.enabled && config.features.webSocket) {
      wsHandler.setupRateLimiting(socketRateLimit);
    }

    // Inject PresenceService into controller
    const PresenceController = require("@controllers/presence.controller");
    PresenceController.presenceService = services.presenceService;
    logger.info("✅ PresenceService injected into PresenceController");

    // Apply global rate limiting
    if (config.rateLimiting.enabled) {
      app.use("/api/", apiLimiter);
      logger.info("✅ Enhanced global rate limiting enabled");
    }

    // Load routes
    const routeLoader = new RouteLoader(app, logger);
    
    // Define all routes
    const routeDefinitions = [
      { path: "/api/chat", file: "routes/chat/chat.routes.js", name: "Chat" },
      { path: "/api/auth", file: "routes/auth/auth.routes.js", name: "Auth" },
      { path: "/api/users", file: "routes/user/user.routes.js", name: "User" },
      { path: "/api/presence", file: "routes/presence/presence.routes.js", name: "Presence" },
      { path: "/api/match", file: "routes/match/match.routes.js", name: "Match" },
      { path: "/api/profile", file: "routes/profile/profile.routes.js", name: "Profile" },
      { path: "/api/admin", file: "routes/admin/admin.routes.js", name: "Admin" },
      { 
        path: "/api/websocket", 
        file: "routes/websocket/websocket.routes.js", 
        name: "WebSocket Management",
        deps: { 
          webSocketService: services.webSocketService, 
          presenceService: services.presenceService 
        }
      },
    ];

    const loadedRoutes = routeLoader.loadAllRoutes(routeDefinitions);

    // Load test routes in development
    if (config.app.environment === "development" && config.features.mockData) {
      routeLoader.loadRoute("/api/test", "routes/test.routes.js", "Test");
    }

    // Setup API endpoints
    const apiEndpoints = new APIEndpoints(app, config, services, logger);
    apiEndpoints.setLoadedRoutes(loadedRoutes);
    apiEndpoints.setupAllEndpoints(
      config.rateLimiting,
      getRateLimitMetrics,
      redisCircuitBreaker,
      RATE_LIMIT_CONFIG
    );

    // Start listening
    server.listen(config.app.port, config.app.host, () => {
      logServerStartup(config, services, logger);
    });

    // Handle server errors
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        logger.error(`❌ Port ${config.app.port} is already in use`);
        process.exit(1);
      } else {
        logger.error("❌ Server error:", error);
        process.exit(1);
      }
    });

    server.on("close", () => logger.info("Server closed"));

  } catch (error) {
    logger.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// ========== LOGGING HELPER ==========
function logServerStartup(config, services, logger) {
  let wsConnections = 0;
  if (services.webSocketService?.getIo) {
    const io = services.webSocketService.getIo();
    if (io) wsConnections = io.engine.clientsCount || 0;
  }

  logger.info("=".repeat(60));
  logger.info(`🚀 Server running on http://${config.app.host}:${config.app.port}`);
  logger.info(`🔗 Health check: http://${config.app.host}:${config.app.port}/health`);
  logger.info(`📊 Rate limit metrics: http://${config.app.host}:${config.app.port}/api/rate-limit/metrics`);
  logger.info(`🔌 WebSocket Health: http://${config.app.host}:${config.app.port}/api/websocket/health`);
  logger.info(`🔌 WebSocket: ws://${config.app.host}:${config.app.port} (${wsConnections} connections)`);
  logger.info(`📡 Environment: ${config.app.environment}`);
  logger.info(`🔐 Encryption: ${config.encryption.algorithm} ✅`);
  logger.info(`🔐 E2EE: ${config.features.e2ee ? "✅ Enabled" : "❌ Disabled"}`);
  logger.info(`⚡ Redis: ${services.redisService.isReady() ? "✅ Ready" : "❌ Not Ready"}`);
  logger.info(`🗄️  MongoDB: ${services.databaseService.isConnected() ? "✅ Connected" : "❌ Not Connected"}`);
  logger.info(`⚡ Rate Limiting: ${config.rateLimiting.enabled ? "✅ Enabled" : "❌ Disabled"}`);
  logger.info(`🔒 Security Headers: ${config.security.headersEnabled ? "✅ Enabled" : "❌ Disabled"}`);
  logger.info(`🛡️  Content Moderation: ${config.features.contentModeration ? "✅ Enabled" : "❌ Disabled"}`);
  logger.info(`🔞 Age Verification: ${config.features.ageVerification ? "✅ Required" : "❌ Not Required"}`);
  logger.info("=".repeat(60));

  if (config.app.environment === "development") {
    logger.info("💡 Development flags:");
    if (process.env.SKIP_AUTH === "true") logger.warn("   ⚠️ SKIP_AUTH is enabled!");
    if (process.env.DISABLE_RATE_LIMITING_DEV === "true") logger.warn("   ⚠️ DISABLE_RATE_LIMITING_DEV is enabled!");
    if (config.cors.allowAll) logger.warn("   ⚠️ ALLOW_CORS_ALL is enabled!");
  }
}

// ========== GRACEFUL SHUTDOWN ==========
const gracefulShutdown = async (signal) => {
  logger.info(`\n🔄 Received ${signal}, shutting down gracefully...`);

  const shutdownStart = Date.now();

  server.close(async () => {
    logger.info("✅ HTTP server closed");

    const webSocketService = app.get("WebSocketService");
    if (webSocketService?.cleanup) {
      await webSocketService.cleanup();
      logger.info("✅ WebSocket service cleaned up");
    }

    try {
      const redisService = app.get("RedisService");
      if (redisService?.getClient()) await redisService.getClient().quit();
      if (redisService?.getSubClient()) await redisService.getSubClient().quit();
      logger.info("✅ Redis connections closed");
    } catch (error) {
      logger.error("⚠️ Error closing Redis:", error.message);
    }

    try {
      const databaseService = app.get("DatabaseService");
      if (databaseService) await databaseService.close();
    } catch (error) {
      logger.error("⚠️ Error closing MongoDB:", error.message);
    }

    const presenceService = app.get("PresenceService");
    if (presenceService?.cleanup) {
      await presenceService.cleanup();
      logger.info("✅ PresenceService cleaned up");
    }

    const shutdownDuration = Date.now() - shutdownStart;
    logger.info(`✅ Shutdown complete (${shutdownDuration}ms)`);
    process.exit(0);
  });

  setTimeout(() => {
    logger.error(`❌ Forced shutdown after ${config.limits.shutdownTimeout}ms timeout`);
    process.exit(1);
  }, config.limits.shutdownTimeout);
};

// ========== PROCESS EVENT HANDLERS ==========
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason, promise) => {
  logger.error("❌ Unhandled Rejection at:", {
    promise,
    reason: reason.message || reason,
    stack: reason.stack,
  });
});

process.on("uncaughtException", (error) => {
  logger.error("❌ Uncaught Exception:", error);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

// ========== START THE SERVER ==========
startServer();

// ========== EXPORTS ==========
module.exports = {
  app,
  server,
  getRedisService: () => app.get("RedisService"),
  getEncryptionService: () => app.get("EncryptionService"),
  getDatabaseService: () => app.get("DatabaseService"),
  getWebSocketService: () => app.get("WebSocketService"),
  getPresenceService: () => app.get("PresenceService"),
};