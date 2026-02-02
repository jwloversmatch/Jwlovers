// server.js - FINAL CORRECTED VERSION
require("dotenv").config();
require("module-alias/register");
const express = require("express");
const { validateEnvVars } = require("./config/env-validator");

// Import our modular components
const ServerConfig = require("./config/ServerConfig");
const MiddlewareSetup = require("./config/MiddlewareSetup"); 
const ServiceInitializer = require("./loaders/ServiceInitializer");
const RouteLoader = require("./loaders/RouteLoader");
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
    
    // Export services to Express app
    serviceInitializer.exportToApp(app);

    // Apply global rate limiting
    if (config.rateLimiting.enabled) {
      app.use("/api/", apiLimiter);
      logger.info("✅ Enhanced global rate limiting enabled");
    }

    // Load routes
    const routeLoader = new RouteLoader(app, logger);
    
    // Define all routes with proper dependencies
    const routeDefinitions = [
      { 
        path: "/api/chat", 
        file: "routes/chat/chat.routes.js", 
        name: "Chat",
        deps: { 
          webSocketService: services.webSocketService,
          presenceService: services.presenceService,
          chatService: services.chatService || services.conversationServiceWrapper,
          encryptionService: services.encryptionService,
          redisService: services.redisService
        }
      },
      { 
        path: "/api/auth", 
        file: "routes/auth/auth.routes.js", 
        name: "Auth",
        deps: { 
          authService: services.authService,
          encryptionService: services.encryptionService,
          redisService: services.redisService,
          databaseService: services.databaseService
        }
      },
      { 
        path: "/api/users", 
        file: "routes/user/user.routes.js", 
        name: "User",
        deps: { 
          userService: services.userService,
          databaseService: services.databaseService,
          encryptionService: services.encryptionService
        }
      },
      { 
        path: "/api/presence", 
        file: "routes/presence/presence.routes.js", 
        name: "Presence",
        deps: { 
          presenceService: services.presenceService,
          webSocketService: services.webSocketService,
          redisService: services.redisService
        }
      },
      { 
        path: "/api/match", 
        file: "routes/match/match.routes.js", 
        name: "Match",
        deps: { 
          matchService: services.matchService,
          databaseService: services.databaseService,
          redisService: services.redisService
        }
      },
      { 
        path: "/api/profile", 
        file: "routes/profile/profile.routes.js", 
        name: "Profile",
        deps: { 
          profileService: services.profileService,
          databaseService: services.databaseService,
          encryptionService: services.encryptionService
        }
      },
      { 
        path: "/api/admin", 
        file: "routes/admin/admin.routes.js", 
        name: "Admin",
        deps: { 
          adminService: services.adminService,
          databaseService: services.databaseService,
          redisService: services.redisService
        }
      },
      { 
        path: "/api/websocket", 
        file: "routes/websocket/websocket.routes.js", 
        name: "WebSocket Management",
        deps: { 
          webSocketService: services.webSocketService, 
          presenceService: services.presenceService,
          io: services.io,
          redisService: services.redisService
        }
      },
      { 
        path: "/api/health", 
        file: "routes/health/health.routes.js", 
        name: "Health",
        deps: { 
          databaseService: services.databaseService,
          redisService: services.redisService,
          webSocketService: services.webSocketService
        }
      },
    ];

    const loadedRoutes = routeLoader.loadAllRoutes(routeDefinitions);

    // Add diagnostic endpoint for route information
    app.use("/api/diagnostics", routeLoader.createDiagnosticRouter());

    // Log route metrics
    const routeMetrics = routeLoader.getRouteMetrics();
    logger.info(`📊 Routes loaded: ${routeMetrics.successful}/${routeMetrics.total}`);

    // Load test routes in development
    if (config.app.environment === "development" && config.features.mockData) {
      routeLoader.loadRoute("/api/test", "routes/test.routes.js", "Test", {
        databaseService: services.databaseService,
        redisService: services.redisService
      });
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

    // Add WebSocket health check endpoint (redundant but kept for compatibility)
    app.get('/api/websocket/health', (req, res) => {
      const webSocketService = app.get('WebSocketService');
      const io = webSocketService?.getIo?.() || app.get('io');
      
      res.json({
        status: io ? 'healthy' : 'unhealthy',
        connections: io?.engine?.clientsCount || 0,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        service: webSocketService ? 'available' : 'unavailable',
        environment: config.app.environment
      });
    });

    // Add system status endpoint
    app.get('/api/system/status', (req, res) => {
      const services = app.get('services') || {};
      const routeMetrics = routeLoader.getRouteMetrics();
      
      res.json({
        status: 'running',
        server: {
          uptime: process.uptime(),
          environment: config.app.environment,
          host: config.app.host,
          port: config.app.port
        },
        services: {
          mongodb: services.databaseService?.isConnected?.() ? 'connected' : 'disconnected',
          redis: services.redisService?.isReady?.() ? 'ready' : 'not_ready',
          websocket: services.webSocketService ? 'available' : 'unavailable',
          encryption: services.encryptionService ? 'available' : 'unavailable'
        },
        routes: routeMetrics,
        timestamp: new Date().toISOString()
      });
    });

    // Add connection monitoring interval (development only)
    if (services.webSocketService && config.app.environment === 'development') {
      setInterval(() => {
        try {
          const io = services.webSocketService.getIo();
          if (io) {
            const connections = io.engine?.clientsCount || 0;
            logger.debug(`📊 WebSocket connections: ${connections}`);
            
            // Log memory usage periodically
            if (connections > 0 || Math.random() < 0.1) { // 10% chance or if connections exist
              const memoryUsage = process.memoryUsage();
              logger.debug(`💾 Memory: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB used`);
            }
          }
        } catch (error) {
          // Silently ignore monitoring errors
        }
      }, 60000); // Log every minute
    }

    // Start listening
    server.listen(config.app.port, config.app.host, () => {
      logServerStartup(config, services, logger, routeMetrics);
    });

    // Handle server errors
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        logger.error(`❌ Port ${config.app.port} is already in use`);
        process.exit(1);
      } else {
        logger.error("❌ Server error:", error);
        
        // Attempt to log additional information
        if (services.webSocketService) {
          try {
            const io = services.webSocketService.getIo();
            if (io) {
              logger.error(`WebSocket connections at crash: ${io.engine?.clientsCount || 0}`);
            }
          } catch (wsError) {
            // Ignore WebSocket errors during crash
          }
        }
        
        process.exit(1);
      }
    });

    server.on("close", () => {
      logger.info("Server closed");
      // Cleanup any remaining intervals
      clearAllIntervals();
    });

  } catch (error) {
    logger.error("❌ Failed to start server:", error);
    logger.error("Stack trace:", error.stack);
    
    // Attempt graceful shutdown on startup failure
    try {
      const services = app.get('services') || {};
      if (services.webSocketService?.cleanup) {
        await services.webSocketService.cleanup();
        logger.info("✅ WebSocket service cleaned up after startup failure");
      }
      
      // Cleanup Redis
      if (services.redisService) {
        try {
          if (services.redisService.getClient) {
            const client = services.redisService.getClient();
            if (client) await client.quit();
          }
        } catch (redisError) {
          // Ignore Redis cleanup errors
        }
      }
      
      // Cleanup Database
      if (services.databaseService?.close) {
        try {
          await services.databaseService.close();
        } catch (dbError) {
          // Ignore DB cleanup errors
        }
      }
    } catch (cleanupError) {
      logger.error("Error during startup failure cleanup:", cleanupError);
    }
    
    process.exit(1);
  }
};

// ========== LOGGING HELPER ==========
function logServerStartup(config, services, logger, routeMetrics = null) {
  let wsConnections = 0;
  let wsStatus = "❌ Not available";
  
  const webSocketService = services.webSocketService;
  if (webSocketService?.getIo) {
    const io = webSocketService.getIo();
    if (io) {
      wsConnections = io.engine?.clientsCount || 0;
      wsStatus = `✅ Ready (${wsConnections} connections)`;
    }
  } else if (services.io) {
    wsConnections = services.io.engine?.clientsCount || 0;
    wsStatus = `✅ Ready via io (${wsConnections} connections)`;
  }

  const memoryUsage = process.memoryUsage();
  const usedMemoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
  const totalMemoryMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);

  logger.info("=".repeat(60));
  logger.info(`🚀 Server running on http://${config.app.host}:${config.app.port}`);
  logger.info(`🔗 Health check: http://${config.app.host}:${config.app.port}/health`);
  logger.info(`📊 System status: http://${config.app.host}:${config.app.port}/api/system/status`);
  logger.info(`🔍 Diagnostics: http://${config.app.host}:${config.app.port}/api/diagnostics/routes`);
  logger.info(`📈 Rate limit metrics: http://${config.app.host}:${config.app.port}/api/rate-limit/metrics`);
  logger.info(`🔌 WebSocket Health: http://${config.app.host}:${config.app.port}/api/websocket/health`);
  logger.info(`🔌 WebSocket: ws://${config.app.host}:${config.app.port} ${wsStatus}`);
  logger.info(`📡 Environment: ${config.app.environment}`);
  logger.info(`💾 Memory: ${usedMemoryMB}MB / ${totalMemoryMB}MB`);
  logger.info(`🔐 Encryption: ${config.encryption.algorithm} ${services.encryptionService ? '✅' : '❌'}`);
  logger.info(`🔐 E2EE: ${config.features.e2ee ? "✅ Enabled" : "❌ Disabled"}`);
  logger.info(`⚡ Redis: ${services.redisService?.isReady?.() ? "✅ Ready" : "❌ Not Ready"}`);
  logger.info(`🗄️  MongoDB: ${services.databaseService?.isConnected?.() ? "✅ Connected" : "❌ Not Connected"}`);
  logger.info(`⚡ Rate Limiting: ${config.rateLimiting.enabled ? "✅ Enabled" : "❌ Disabled"}`);
  logger.info(`🔒 Security Headers: ${config.security.headersEnabled ? "✅ Enabled" : "❌ Disabled"}`);
  logger.info(`🛡️  Content Moderation: ${config.features.contentModeration ? "✅ Enabled" : "❌ Disabled"}`);
  logger.info(`🔞 Age Verification: ${config.features.ageVerification ? "✅ Required" : "❌ Not Required"}`);
  logger.info(`🔗 CORS Origins: ${config.cors.allowAll ? 'All (*)' : (config.cors.origins?.length || 0) + ' origins'}`);
  
  if (routeMetrics) {
    logger.info(`📊 Routes: ${routeMetrics.successful}/${routeMetrics.total} loaded`);
  }
  
  logger.info("=".repeat(60));

  if (config.app.environment === "development") {
    logger.info("💡 Development flags:");
    if (process.env.SKIP_AUTH === "true") logger.warn("   ⚠️ SKIP_AUTH is enabled!");
    if (process.env.DISABLE_RATE_LIMITING_DEV === "true") logger.warn("   ⚠️ DISABLE_RATE_LIMITING_DEV is enabled!");
    if (config.cors.allowAll) logger.warn("   ⚠️ ALLOW_CORS_ALL is enabled!");
    logger.info("💡 Debug endpoints available:");
    logger.info(`   http://${config.app.host}:${config.app.port}/api/diagnostics/routes`);
    logger.info(`   http://${config.app.host}:${config.app.port}/api/system/status`);
  }
}

// ========== HELPER FUNCTIONS ==========
const intervals = new Set();

function clearAllIntervals() {
  intervals.forEach(intervalId => clearInterval(intervalId));
  intervals.clear();
}

function safeSetInterval(callback, delay) {
  const intervalId = setInterval(callback, delay);
  intervals.add(intervalId);
  return intervalId;
}

// ========== GRACEFUL SHUTDOWN ==========
const gracefulShutdown = async (signal) => {
  logger.info(`\n🔄 Received ${signal}, shutting down gracefully...`);

  const shutdownStart = Date.now();

  server.close(async () => {
    logger.info("✅ HTTP server closed");

    // Clear all intervals
    clearAllIntervals();

    // Get all services from app
    const services = app.get('services') || {};
    
    // Cleanup WebSocketService
    if (services.webSocketService?.cleanup) {
      try {
        await services.webSocketService.cleanup();
        logger.info("✅ WebSocket service cleaned up");
      } catch (error) {
        logger.error("⚠️ Error cleaning up WebSocketService:", error.message);
      }
    }

    // Cleanup PresenceService
    if (services.presenceService?.cleanup) {
      try {
        await services.presenceService.cleanup();
        logger.info("✅ PresenceService cleaned up");
      } catch (error) {
        logger.error("⚠️ Error cleaning up PresenceService:", error.message);
      }
    }

    // Cleanup Controller Bridge
    if (services.controllerBridge?.cleanup) {
      try {
        await services.controllerBridge.cleanup();
        logger.info("✅ Controller Bridge cleaned up");
      } catch (error) {
        logger.error("⚠️ Error cleaning up Controller Bridge:", error.message);
      }
    }

    // Cleanup Redis connections
    try {
      const redisService = services.redisService || app.get("RedisService");
      if (redisService) {
        if (redisService.getClient) {
          const client = redisService.getClient();
          if (client) await client.quit();
        }
        if (redisService.getSubClient) {
          const subClient = redisService.getSubClient();
          if (subClient) await subClient.quit();
        }
        if (redisService.getPubClient) {
          const pubClient = redisService.getPubClient();
          if (pubClient) await pubClient.quit();
        }
        logger.info("✅ Redis connections closed");
      }
    } catch (error) {
      logger.error("⚠️ Error closing Redis:", error.message);
    }

    // Cleanup Database connections
    try {
      const databaseService = services.databaseService || app.get("DatabaseService");
      if (databaseService?.close) {
        await databaseService.close();
        logger.info("✅ Database connections closed");
      }
    } catch (error) {
      logger.error("⚠️ Error closing MongoDB:", error.message);
    }

    // Cleanup WebSocketEmitter
    try {
      const WebSocketEmitter = require("./emitters/WebSocketEmitter");
      if (WebSocketEmitter.cleanup) {
        WebSocketEmitter.cleanup();
        logger.info("✅ WebSocketEmitter cleaned up");
      }
    } catch (error) {
      // Ignore if WebSocketEmitter doesn't exist
    }

    // Cleanup global references
    const globalRefs = [
      'redisClient', 'redis', 'io', 'getSocketIO', 
      'getWebSocketService', 'presenceService', 'getPresenceService'
    ];
    
    globalRefs.forEach(ref => {
      if (global[ref]) {
        delete global[ref];
      }
    });

    const shutdownDuration = Date.now() - shutdownStart;
    logger.info(`✅ Shutdown complete (${shutdownDuration}ms)`);
    process.exit(0);
  });

  // Force shutdown after timeout
  const forceShutdownTimeout = config.limits.shutdownTimeout || 10000;
  setTimeout(() => {
    logger.error(`❌ Forced shutdown after ${forceShutdownTimeout}ms timeout`);
    
    // Emergency cleanup
    clearAllIntervals();
    
    // Force exit
    process.exit(1);
  }, forceShutdownTimeout);
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
  logger.error("Stack trace:", error.stack);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

// ========== START THE SERVER ==========
startServer();

// ========== EXPORTS ==========
module.exports = {
  app,
  server,
  getServices: () => app.get("services"),
  getRedisService: () => app.get("RedisService"),
  getEncryptionService: () => app.get("EncryptionService"),
  getDatabaseService: () => app.get("DatabaseService"),
  getWebSocketService: () => app.get("WebSocketService"),
  getPresenceService: () => app.get("PresenceService"),
  getControllerBridge: () => app.get("controllerBridge"),
  getIo: () => app.get("io"),
  getLogger: () => logger,
  getConfig: () => config,
  getRouteLoader: () => app.get("routeLoader")
};