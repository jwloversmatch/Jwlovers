const express = require('express');
const router = express.Router();

module.exports = (deps = {}) => {
  const { databaseService, redisService, webSocketService } = deps;
  
  router.get('/', async (req, res) => {
    try {
      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {}
      };
      
      // Check MongoDB
      if (databaseService && databaseService.isConnected) {
        healthStatus.services.mongodb = 'connected';
      } else {
        healthStatus.services.mongodb = 'disconnected';
        healthStatus.status = 'degraded';
      }
      
      // Check Redis
      if (redisService && redisService.isReady) {
        healthStatus.services.redis = 'ready';
      } else {
        healthStatus.services.redis = 'not_ready';
        healthStatus.status = 'degraded';
      }
      
      // Check WebSocket
      if (webSocketService) {
        const io = webSocketService.getIo?.();
        healthStatus.services.websocket = {
          status: io ? 'active' : 'inactive',
          connections: io?.engine?.clientsCount || 0
        };
      } else {
        healthStatus.services.websocket = 'not_available';
      }
      
      res.status(healthStatus.status === 'healthy' ? 200 : 503).json(healthStatus);
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });
  
  return router;
};