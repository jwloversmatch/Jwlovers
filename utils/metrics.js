// utils/metrics.js
const client = require('prom-client');

// Clear any existing metrics
client.register.clear();

// Create custom metrics
const activeConnections = new client.Gauge({
  name: 'socket_active_connections',
  help: 'Number of active WebSocket connections'
});

const totalConnections = new client.Counter({
  name: 'socket_total_connections',
  help: 'Total number of WebSocket connections'
});

const messagesSent = new client.Counter({
  name: 'messages_sent_total',
  help: 'Total number of messages sent',
  labelNames: ['type']
});

const messageSize = new client.Histogram({
  name: 'message_size_bytes',
  help: 'Size of messages in bytes',
  buckets: [100, 500, 1000, 5000, 10000]
});

const socketErrors = new client.Counter({
  name: 'socket_errors_total',
  help: 'Total number of socket errors'
});

const messageDeliveryLatency = new client.Histogram({
  name: 'message_delivery_latency_ms',
  help: 'Time taken to deliver messages',
  buckets: [10, 50, 100, 500, 1000, 5000]
});

module.exports = {
  activeConnections,
  totalConnections,
  messagesSent,
  messageSize,
  socketErrors,
  messageDeliveryLatency,
  
  async getMetrics() {
    return client.register.metrics();
  }
};