const axios = require('axios');
const logger = require('@utils/logger');

class Monitor {
  constructor(baseUrl = 'http://localhost:5000') {
    this.baseUrl = baseUrl;
    this.healthCheckInterval = 60000; // 1 minute
  }

  async checkHealth() {
    try {
      const response = await axios.get(`${this.baseUrl}/health`);
      const data = response.data;
      
      logger.info('Health check:', {
        status: data.status,
        uptime: data.uptime,
        memory: data.memory,
        timestamp: data.timestamp
      });
      
      return data.status === 'OK';
    } catch (error) {
      logger.error('Health check failed:', error.message);
      return false;
    }
  }

  async checkMetrics() {
    try {
      const response = await axios.get(`${this.baseUrl}/metrics`);
      const metrics = response.data;
      
      // Parse and log key metrics
      const lines = metrics.split('\n');
      const activeConnections = lines.find(l => l.startsWith('socket_active_connections'));
      const totalMessages = lines.find(l => l.startsWith('messages_sent_total'));
      
      logger.info('Metrics:', {
        activeConnections: activeConnections?.split(' ')[1] || 'N/A',
        totalMessages: totalMessages?.split(' ')[1] || 'N/A'
      });
      
      return true;
    } catch (error) {
      logger.error('Metrics check failed:', error.message);
      return false;
    }
  }

  async checkDatabase() {
    try {
      const response = await axios.get(`${this.baseUrl}/health`);
      return response.data.status === 'OK';
    } catch (error) {
      return false;
    }
  }

  startMonitoring() {
    logger.info('Starting monitoring...');
    
    // Initial checks
    this.checkHealth();
    this.checkMetrics();
    
    // Schedule regular checks
    setInterval(() => {
      this.checkHealth();
    }, this.healthCheckInterval);
    
    setInterval(() => {
      this.checkMetrics();
    }, this.healthCheckInterval * 5); // Every 5 minutes
    
    logger.info('Monitoring started');
  }
}

// Start monitoring if run directly
if (require.main === module) {
  const monitor = new Monitor();
  monitor.startMonitoring();
}

module.exports = Monitor;