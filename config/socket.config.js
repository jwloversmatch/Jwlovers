const socketConstants = require('@utils/socket-constants');

module.exports = {
  SOCKET: {
    PING_TIMEOUT: process.env.SOCKET_PING_TIMEOUT || socketConstants.SOCKET_CONFIG.PING_TIMEOUT,
    PING_INTERVAL: process.env.SOCKET_PING_INTERVAL || socketConstants.SOCKET_CONFIG.PING_INTERVAL,
    UPGRADE_TIMEOUT: process.env.SOCKET_UPGRADE_TIMEOUT || socketConstants.SOCKET_CONFIG.UPGRADE_TIMEOUT,
    MAX_HTTP_BUFFER_SIZE: process.env.SOCKET_MAX_HTTP_BUFFER_SIZE || socketConstants.SOCKET_CONFIG.MAX_HTTP_BUFFER_SIZE,
    CONNECT_TIMEOUT: process.env.SOCKET_CONNECT_TIMEOUT || socketConstants.SOCKET_CONFIG.CONNECT_TIMEOUT
  },
  
  RATE_LIMITS: {
    MAX_CONNECTIONS_PER_USER: process.env.MAX_CONNECTIONS_PER_USER || socketConstants.RATE_LIMITS.MAX_CONNECTIONS_PER_USER,
    MESSAGES_PER_MINUTE: process.env.MESSAGES_PER_MINUTE || socketConstants.RATE_LIMITS.MESSAGES_PER_MINUTE,
    TYPING_EVENTS_PER_MINUTE: process.env.TYPING_EVENTS_PER_MINUTE || socketConstants.RATE_LIMITS.TYPING_EVENTS_PER_MINUTE,
    WINDOW_MS: socketConstants.RATE_LIMITS.WINDOW_MS
  },
  
  MESSAGE_MAX_LENGTH: process.env.MESSAGE_MAX_LENGTH || 5000,
  
  CORS_ORIGINS: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000'
  ]
};