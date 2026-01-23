// config/database.js
const mongoose = require("mongoose");

class DatabaseService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async connect() {
    try {
      const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/jwlovers";
      const conn = await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: this.config.SERVER_SELECTION_TIMEOUT_MS,
        maxPoolSize: this.config.MAX_POOL_SIZE,
        minPoolSize: this.config.MIN_POOL_SIZE,
        socketTimeoutMS: this.config.SOCKET_TIMEOUT_MS,
        connectTimeoutMS: 10000,
        retryWrites: true,
        retryReads: true
      });
      
      this.logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
      this.logger.info(`📊 Database: ${conn.connection.name}`);
      
      // Ensure indexes
      await this.ensureIndexes();
      
      // Setup event listeners
      this.setupEventListeners();
      
      return conn;
    } catch (error) {
      this.logger.error("❌ MongoDB connection failed:", error.message);
      throw error;
    }
  }

  async ensureIndexes() {
    try {
      this.logger.info("🔄 Ensuring database indexes...");
      
      const Conversation = require("@models/Conversation");
      const Message = require("@models/Message");
      
      // Conversation indexes
      await Conversation.collection.createIndex({ participants: 1 });
      await Conversation.collection.createIndex({ participants: 1, lastMessageAt: -1 });
      await Conversation.collection.createIndex({ "participants.userId": 1 });
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
      
      this.logger.info("✅ Database indexes ensured");
    } catch (error) {
      this.logger.error("❌ Failed to ensure database indexes:", error);
      throw error;
    }
  }

  setupEventListeners() {
    mongoose.connection.on("error", (err) =>
      this.logger.error("❌ MongoDB connection error:", err.message)
    );
    
    mongoose.connection.on("disconnected", () => 
      this.logger.warn("⚠️ MongoDB disconnected")
    );
    
    mongoose.connection.on("reconnected", () => 
      this.logger.info("✅ MongoDB reconnected")
    );
    
    mongoose.connection.on("close", () => 
      this.logger.info("🔒 MongoDB connection closed")
    );
  }

  async close() {
    try {
      await mongoose.connection.close(false);
      this.logger.info("✅ MongoDB connection closed");
    } catch (error) {
      this.logger.error("⚠️ Error closing MongoDB:", error.message);
      throw error;
    }
  }

  getConnection() {
    return mongoose.connection;
  }

  isConnected() {
    return mongoose.connection.readyState === 1;
  }

  getReadyState() {
    const states = ["disconnected", "connected", "connecting", "disconnecting"];
    return {
      state: states[mongoose.connection.readyState],
      code: mongoose.connection.readyState,
      healthy: mongoose.connection.readyState === 1
    };
  }
}

module.exports = DatabaseService;