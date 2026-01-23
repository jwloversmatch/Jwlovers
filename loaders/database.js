const mongoose = require('mongoose');
const logger = require('@utils/logger');

class DatabaseLoader {
  constructor() {
    this.connection = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  async connect() {
    try {
      const mongoUri = process.env.MONGODB_URI;
      
      if (!mongoUri) {
        throw new Error('MONGODB_URI is not defined in environment variables');
      }
      
      mongoose.set('strictQuery', true);
      
      // Connection options
      const options = {
        maxPoolSize: process.env.MONGODB_POOL_SIZE || 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      };
      
      // Connect to MongoDB
      await mongoose.connect(mongoUri, options);
      
      this.connection = mongoose.connection;
      
      // Event listeners
      this.connection.on('connected', () => {
        logger.info('MongoDB connected successfully');
        this.reconnectAttempts = 0;
      });
      
      this.connection.on('error', (err) => {
        logger.error('MongoDB connection error:', err);
      });
      
      this.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
        this.handleDisconnect();
      });
      
      this.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected');
      });
      
      logger.info(`MongoDB connected to: ${mongoose.connection.host}`);
      return this.connection;
      
    } catch (error) {
      logger.error('Failed to connect to MongoDB:', error);
      this.handleDisconnect();
      throw error;
    }
  }
  
  handleDisconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      
      logger.info(`Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
      
      setTimeout(() => {
        this.connect().catch(() => {
          // Connection will retry automatically
        });
      }, delay);
    } else {
      logger.error('Max reconnection attempts reached. Please check MongoDB.');
      process.exit(1);
    }
  }
  
  async disconnect() {
    try {
      if (this.connection) {
        await mongoose.disconnect();
        logger.info('MongoDB disconnected gracefully');
      }
    } catch (error) {
      logger.error('Error disconnecting MongoDB:', error);
    }
  }
  
  getConnection() {
    return this.connection;
  }
  
  // Health check
  async healthCheck() {
    try {
      await mongoose.connection.db.admin().ping();
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new DatabaseLoader();