const express = require("express");
const path = require("path");
const fs = require("fs");
const logger = require("./utils/logger");

class BackendBridge {
  constructor(app, io, redisService) {
    this.app = app;
    this.io = io;
    this.redisService = redisService;
    
    // Share services across the entire backend
    this.setupGlobalServices();
  }
  
  setupGlobalServices() {
    // Make services available to all route files
    this.app.set("socketIO", this.io);
    this.app.set("redisService", this.redisService);
    
    // Share common middleware
    const authMiddleware = require("./middleware/auth");
    this.app.set("authMiddleware", authMiddleware);
    
    // Share utilities
    this.app.set("logger", logger);
    
    logger.info("✅ Global services bridge established");
  }
  
  loadExistingRoutes(basePath = "../routes") {
    try {
      const routesPath = path.join(__dirname, basePath);
      
      if (!fs.existsSync(routesPath)) {
        logger.warn(`Routes directory not found: ${routesPath}`);
        return;
      }
      
      const routeFiles = [
        { name: "auth", file: "auth.routes.js", path: "/api/auth" },
        { name: "users", file: "user.routes.js", path: "/api/users" },
        { name: "presence", file: "presence.routes.js", path: "/api/presence" },
        { name: "match", file: "match.routes.js", path: "/api/match" },
        { name: "profile", file: "profile.routes.js", path: "/api/profile" },
        { name: "notifications", file: "notification.routes.js", path: "/api/notifications" }
      ];
      
      routeFiles.forEach(({ name, file, path: routePath }) => {
        const fullPath = path.join(routesPath, file);
        
        if (fs.existsSync(fullPath)) {
          try {
            // Clear require cache to ensure fresh import
            delete require.cache[require.resolve(fullPath)];
            
            const router = require(fullPath);
            
            // Inject app dependencies if router is a function
            if (typeof router === 'function') {
              // If router expects dependencies, pass them
              const routerInstance = router({
                app: this.app,
                io: this.io,
                redisService: this.redisService,
                logger
              });
              this.app.use(routePath, routerInstance);
            } else {
              this.app.use(routePath, router);
            }
            
            logger.info(`✅ ${name} routes connected at ${routePath}`);
          } catch (error) {
            logger.error(`❌ Failed to load ${name} routes:`, error.message);
          }
        } else {
          logger.warn(`⚠️ ${name} route file not found: ${fullPath}`);
        }
      });
      
      return true;
    } catch (error) {
      logger.error("Failed to load existing routes:", error);
      return false;
    }
  }
  
  // Helper methods for other parts of your backend
  getSocketHelpers() {
    return {
      emitToUser: (userId, event, data) => {
        if (this.io) {
          this.io.to(`user_${userId}`).emit(event, data);
          return true;
        }
        return false;
      },
      
      emitToConversation: (conversationId, event, data) => {
        if (this.io) {
          this.io.to(`conversation_${conversationId}`).emit(event, data);
          return true;
        }
        return false;
      },
      
      broadcast: (event, data) => {
        if (this.io) {
          this.io.emit(event, data);
          return true;
        }
        return false;
      },
      
      isUserOnline: async (userId) => {
        if (this.redisService) {
          const presence = await this.redisService.getUserPresence(userId);
          return !!presence;
        }
        return false;
      }
    };
  }
  
  // Database helpers
  getDatabaseHelpers() {
    const mongoose = require("mongoose");
    const { ConversationServiceWrapper } = require("./services/ConversationService");
    const EncryptionService = require("./services/EncryptionService");
    const MessageService = require("./services/MessageService");
    
    return {
      mongoose,
      models: {
        Conversation: require("@models/Conversation"),
        Message: require("@models/Message"),
        User: require("@models/User/User.model")
      },
      services: {
        ConversationService: ConversationServiceWrapper,
        MessageService,
        EncryptionService
      }
    };
  }
  
  // API for other modules to use chat functionality
  getChatAPI() {
    return {
      sendMessage: async (messageData) => {
        const MessageService = require("./services/MessageService");
        const io = this.app.get("io");
        
        try {
          // Save message
          const savedMessage = await MessageService.sendMessage(messageData);
          
          // Emit via WebSocket if receiver is online
          const redisService = this.app.get("redisService");
          const receiverOnline = await redisService.getUserPresence(messageData.receiverId);
          
          if (receiverOnline) {
            io.to(`user_${messageData.receiverId}`).emit("new_message", {
              ...savedMessage.toObject(),
              _id: savedMessage._id.toString()
            });
          }
          
          return savedMessage;
        } catch (error) {
          logger.error("Chat API sendMessage error:", error);
          throw error;
        }
      },
      
      getConversation: async (userId1, userId2) => {
        const { ConversationServiceWrapper } = require("./services/ConversationService");
        return await ConversationServiceWrapper.getOrCreateConversation(userId1, userId2);
      },
      
      getOnlineUsers: async () => {
        const redisService = this.app.get("redisService");
        return await redisService.getOnlineUsers();
      }
    };
  }
}

module.exports = BackendBridge;