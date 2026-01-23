require("module-alias/register");
require("dotenv").config();

const logger = require("./utils/logger");
const BackendBridge = require("./bridge");

const startServer = async () => {
  try {
    logger.info("=".repeat(60));
    logger.info("🚀 Starting JW Lovers Chat Server with Backend Bridge");
    logger.info("=".repeat(60));
    
    // Initialize Redis
    logger.info("🔄 Step 1: Initializing Redis...");
    const { initRedis } = require("./services/RedisService");
    const redisService = await initRedis();
    
    // Connect to MongoDB
    logger.info("🔄 Step 2: Connecting to MongoDB...");
    const { connectDB } = require("./config/database");
    await connectDB();

    // Create Express app
    logger.info("🔄 Step 3: Creating Express app...");
    const { createApp } = require("./app");
    const app = createApp();
    
    // Create HTTP server
    logger.info("🔄 Step 4: Creating HTTP server...");
    const { createServer } = require("./server");
    const { httpServer } = createServer(app);
    
    // Setup WebSocket
    logger.info("🔄 Step 5: Setting up WebSocket...");
    const { setupWebSocket } = require("./socket");
    const io = await setupWebSocket(httpServer, redisService);
    
    // Create backend bridge
    logger.info("🔄 Step 6: Creating backend bridge...");
    const backendBridge = new BackendBridge(app, io, redisService);
    
    // Load existing routes from your original backend
    logger.info("🔄 Step 7: Loading existing backend routes...");
    backendBridge.loadExistingRoutes();
    
    // Make bridge available to app
    app.set("backendBridge", backendBridge);
    
    // Start listening
    const PORT = process.env.PORT || 5000;
    httpServer.listen(PORT, () => {
      logger.info("=".repeat(60));
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
      logger.info(`🔌 WebSocket: ws://localhost:${PORT}`);
      logger.info(`📡 Environment: ${process.env.NODE_ENV || "development"}`);
      logger.info(`🌉 Backend Bridge: Active ✅`);
      logger.info("=".repeat(60));
    });

    return { app, httpServer, io, redisService, backendBridge };
  } catch (error) {
    logger.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`\n🔄 Received ${signal}, shutting down gracefully...`);
  
  const { io, redisService } = global.server || {};
  
  if (io) {
    io.close();
    logger.info("✅ WebSocket server closed");
  }
  
  if (redisService) {
    await redisService.shutdown();
    logger.info("✅ Redis connections closed");
  }
  
  await require("mongoose").connection.close();
  logger.info("✅ MongoDB connection closed");
  
  process.exit(0);
};

// Process event handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason, promise) => {
  logger.error("❌ Unhandled Rejection at:", { promise, reason });
});

process.on("uncaughtException", (error) => {
  logger.error("❌ Uncaught Exception:", error);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

// Start the server
if (require.main === module) {
  startServer().then((server) => {
    global.server = server;
  });
}

module.exports = { startServer };