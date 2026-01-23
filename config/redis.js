// config/redis.js
const redis = require('redis');

let redisClient = null;
let subClient = null;

// Redis configuration from environment variables
const redisConfig = {
  url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    tls: process.env.REDIS_TLS === 'true',
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('Redis connection failed after 10 retries');
        return new Error('Redis connection failed');
      }
      return Math.min(retries * 100, 3000);
    }
  },
  password: process.env.REDIS_PASSWORD || undefined,
  database: parseInt(process.env.REDIS_DB) || 0
};

// Create Redis client
const createRedisClient = async () => {
  try {
    const client = redis.createClient(redisConfig);
    
    client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
    
    client.on('connect', () => {
      console.log('✅ Redis connected successfully');
    });
    
    client.on('ready', () => {
      console.log('✅ Redis client ready');
    });
    
    client.on('reconnecting', () => {
      console.log('🔄 Redis reconnecting...');
    });
    
    await client.connect();
    
    // Test connection
    await client.ping();
    
    return client;
  } catch (error) {
    console.error('Failed to create Redis client:', error);
    throw error;
  }
};

// Initialize Redis clients
const initRedis = async () => {
  try {
    redisClient = await createRedisClient();
    
    // Create subscription client if needed for pub/sub
    subClient = redisClient.duplicate();
    await subClient.connect();
    
    console.log('✅ Redis clients initialized successfully');
    return { redisClient, subClient };
  } catch (error) {
    console.error('Failed to initialize Redis:', error);
    
    // Return null clients but don't crash - rate limiter will use memory fallback
    console.warn('⚠️ Redis not available. Rate limiting will use memory fallback.');
    return { redisClient: null, subClient: null };
  }
};

// Get Redis client
const getClient = () => redisClient;

// Get subscription client
const getSubClient = () => subClient;

// Check if Redis is ready
const isReady = () => {
  return redisClient && redisClient.isReady;
};

// Close Redis connections
const closeRedis = async () => {
  try {
    if (redisClient) {
      await redisClient.quit();
    }
    if (subClient) {
      await subClient.quit();
    }
    console.log('✅ Redis connections closed');
  } catch (error) {
    console.error('Error closing Redis connections:', error);
  }
};

module.exports = {
  initRedis,
  getClient,
  getSubClient,
  isReady,
  closeRedis,
  redisConfig
};