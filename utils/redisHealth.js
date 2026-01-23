// utils/redisHealth.js
const redis = require('@config/redis');

const checkRedisHealth = async () => {
  try {
    const client = redis.getClient();
    
    if (!client || !client.isReady) {
      return {
        healthy: false,
        status: 'Redis client not ready',
        timestamp: new Date().toISOString()
      };
    }
    
    // Test connection with PING
    const pingResponse = await client.ping();
    const isHealthy = pingResponse === 'PONG';
    
    // Get Redis info
    const info = await client.info();
    const infoLines = info.split('\n');
    const redisInfo = {};
    
    infoLines.forEach(line => {
      const [key, value] = line.split(':');
      if (key && value) {
        redisInfo[key.trim()] = value.trim();
      }
    });
    
    return {
      healthy: isHealthy,
      status: isHealthy ? 'Connected' : 'Connection failed',
      responseTime: Date.now(),
      info: {
        version: redisInfo.redis_version,
        mode: redisInfo.redis_mode,
        uptime: redisInfo.uptime_in_seconds,
        memory: redisInfo.used_memory_human,
        connections: redisInfo.connected_clients,
        commands: redisInfo.total_commands_processed
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      healthy: false,
      status: `Error: ${error.message}`,
      timestamp: new Date().toISOString()
    };
  }
};

const getRedisMetrics = () => {
  try {
    const client = redis.getClient();
    
    if (!client || !client.isReady) {
      return { error: 'Redis not available' };
    }
    
    return {
      connected: client.isReady,
      url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

module.exports = {
  checkRedisHealth,
  getRedisMetrics
};