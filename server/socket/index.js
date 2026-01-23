const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");

const CONFIG = require("../config/constants");
const logger = require("../utils/logger");
const socketAuth = require("./middleware/socketAuth");
const { setupSocketHandlers } = require("./handlers");
const SocketRateLimiter = require("./rateLimiter");

const setupWebSocket = async (httpServer, redisService) => {
  try {
    logger.info("🔄 Setting up WebSocket...");
    
    const socketRateLimiter = new SocketRateLimiter();
    
    const io = new Server(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL 
          ? process.env.FRONTEND_URL.split(",").map(origin => origin.trim())
          : ["http://localhost:3000"],
        credentials: true,
        methods: ["GET", "POST"]
      },
      transports: ["websocket", "polling"],
      pingTimeout: CONFIG.SOCKET.PING_TIMEOUT,
      pingInterval: CONFIG.SOCKET.PING_INTERVAL,
      upgradeTimeout: CONFIG.SOCKET.UPGRADE_TIMEOUT,
      maxHttpBufferSize: CONFIG.SOCKET.MAX_HTTP_BUFFER_SIZE,
      connectTimeout: CONFIG.SOCKET.CONNECT_TIMEOUT
    });

    if (redisService.redisReady) {
      io.adapter(createAdapter(redisService.pubClient, redisService.subClient));
      logger.info("✅ Redis adapter attached for horizontal scaling");
    }

    io.use(socketAuth(redisService));

    io.on("connection", async (socket) => {
      logger.info(`✅ WebSocket connected: ${socket.user?.name || socket.userId} - Socket: ${socket.id}`);
      
      setupSocketHandlers(io, socket, redisService, socketRateLimiter);
    });

    logger.info("✅ WebSocket setup complete");
    return io;
  } catch (error) {
    logger.error("❌ WebSocket setup failed:", error);
    throw error;
  }
};

module.exports = { setupWebSocket };