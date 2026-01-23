const mongoose = require("mongoose");
const CONFIG = require("./constants");
const logger = require("../utils/logger");

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/jwlovers";
    
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: CONFIG.DATABASE.SERVER_SELECTION_TIMEOUT_MS,
      maxPoolSize: CONFIG.DATABASE.MAX_POOL_SIZE,
      minPoolSize: CONFIG.DATABASE.MIN_POOL_SIZE,
      socketTimeoutMS: CONFIG.DATABASE.SOCKET_TIMEOUT_MS,
      connectTimeoutMS: 10000,
      retryWrites: true,
      retryReads: true
    });
    
    logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
    logger.info(`📊 Database: ${conn.connection.name}`);
    
    await ensureDatabaseIndexes();
    
    mongoose.connection.on("error", (err) =>
      logger.error("❌ MongoDB connection error:", err.message)
    );
    mongoose.connection.on("disconnected", () => logger.warn("⚠️ MongoDB disconnected"));
    mongoose.connection.on("reconnected", () => logger.info("✅ MongoDB reconnected"));
    
    return conn;
  } catch (error) {
    logger.error("❌ MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

const ensureDatabaseIndexes = async () => {
  try {
    logger.info("🔄 Ensuring database indexes...");
    
    // Import models
    const Conversation = require("@models/Conversation");
    const Message = require("@models/Message");
    
    // Conversation indexes
    await Conversation.collection.createIndex({ participants: 1 });
    await Conversation.collection.createIndex({ participants: 1, lastMessageAt: -1 });
    await Conversation.collection.createIndex({ lastMessageAt: -1 });
    
    // Message indexes
    await Message.collection.createIndex({ conversationId: 1, createdAt: -1 });
    await Message.collection.createIndex({ senderId: 1, receiverId: 1 });
    await Message.collection.createIndex({ readBy: 1 });
    await Message.collection.createIndex({ createdAt: -1 });
    await Message.collection.createIndex({ 
      senderId: 1, 
      receiverId: 1, 
      createdAt: -1 
    });
    
    logger.info("✅ Database indexes ensured");
  } catch (error) {
    logger.error("❌ Failed to ensure database indexes:", error);
  }
};

module.exports = { connectDB, ensureDatabaseIndexes };