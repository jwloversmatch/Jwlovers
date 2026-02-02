// config/database.js - UPDATED
const mongoose = require("mongoose");

class DatabaseService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.indexCreationPromise = null;
  }

  async connect() {
    try {
      const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/jwlovers";
      
      // PERF OPTIMIZATION: Faster connection options
      const conn = await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5000, // Reduced from default
        maxPoolSize: 50, // Increased for better concurrency
        minPoolSize: 10,
        socketTimeoutMS: 30000, // Reduced from potentially longer
        connectTimeoutMS: 10000,
        retryWrites: true,
        retryReads: true,
        // Performance optimizations
        family: 4, // Use IPv4 only (faster)
        autoIndex: false, // CRITICAL: Disable auto-indexing
        bufferCommands: false, // Disable command buffering
        autoCreate: false, // Disable auto-creation of collections
      });
      
      this.logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
      this.logger.info(`📊 Database: ${conn.connection.name}`);
      
      // PERF OPTIMIZATION: Non-blocking index creation
      this.ensureIndexesAsync().catch(error => {
        this.logger.error("Index creation error (non-critical):", error.message);
      });
      
      this.setupEventListeners();
      
      return conn;
    } catch (error) {
      this.logger.error("❌ MongoDB connection failed:", error.message);
      throw error;
    }
  }

  // PERF OPTIMIZATION: Make index creation non-blocking and optional
  async ensureIndexesAsync() {
    // Only run index creation once per server instance
    if (this.indexCreationPromise) {
      return this.indexCreationPromise;
    }
    
    this.indexCreationPromise = (async () => {
      try {
        this.logger.info("🔄 Starting background index creation...");
        
        // Check if indexes already exist (fast check)
        const Conversation = require("@models/Conversation");
        const existingIndexes = await Conversation.collection.indexes();
        
        if (existingIndexes.length <= 1) { // Only has _id index
          this.logger.info("Creating initial indexes...");
          
          // Create indexes in background, non-blocking
          const indexesToCreate = [
            // Conversation indexes
            Conversation.collection.createIndex({ participants: 1 }, { background: true }),
            Conversation.collection.createIndex({ participants: 1, lastMessageAt: -1 }, { background: true }),
            Conversation.collection.createIndex({ "participants.userId": 1 }, { background: true }),
            Conversation.collection.createIndex({ lastMessageAt: -1 }, { background: true }),
            
            // Message indexes (if model exists)
            this.createMessageIndexes()
          ];
          
          await Promise.all(indexesToCreate);
          this.logger.info("✅ Background index creation completed");
        } else {
          this.logger.info("✅ Indexes already exist, skipping creation");
        }
      } catch (error) {
        this.logger.warn("⚠️ Non-critical index creation error:", error.message);
      }
    })();
    
    return this.indexCreationPromise;
  }

  async createMessageIndexes() {
    try {
      const Message = require("@models/Message");
      
      // Create indexes with background: true for non-blocking
      const messageIndexPromises = [
        Message.collection.createIndex({ conversationId: 1, createdAt: -1 }, { background: true }),
        Message.collection.createIndex({ senderId: 1, receiverId: 1 }, { background: true }),
        Message.collection.createIndex({ readBy: 1 }, { background: true }),
        Message.collection.createIndex({ createdAt: -1 }, { background: true }),
        Message.collection.createIndex({ 
          senderId: 1, 
          receiverId: 1, 
          createdAt: -1 
        }, { background: true }),
      ];
      
      return Promise.all(messageIndexPromises);
    } catch (error) {
      this.logger.warn("Message model/indexes not available:", error.message);
      return Promise.resolve();
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
  }

  // Quick health check
  async healthCheck() {
    try {
      await mongoose.connection.db.command({ ping: 1 });
      return { healthy: true, latency: Date.now() };
    } catch (error) {
      return { healthy: false, error: error.message };
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