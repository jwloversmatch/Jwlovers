// config/rate-limits.js
module.exports = {
  // Production defaults - uses .env values
  production: {
    api: {
      windowMs: parseInt(process.env.RATE_LIMIT_API_WINDOW_MS) || 900000, // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_API_MAX) || 100
    },
    auth: {
      windowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS) || 3600000, // 1 hour
      max: parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 10,
      blockDuration: parseInt(process.env.RATE_LIMIT_AUTH_BLOCK_DURATION_MS) || 1800000 // 30 minutes
    },
    messages: {
      windowMs: parseInt(process.env.RATE_LIMIT_MESSAGES_WINDOW_MS) || 60000, // 1 minute
      max: parseInt(process.env.RATE_LIMIT_MESSAGES_MAX) || 60,
      blockDuration: parseInt(process.env.RATE_LIMIT_MESSAGES_BLOCK_DURATION_MS) || 300000 // 5 minutes
    },
    registration: {
      windowMs: parseInt(process.env.RATE_LIMIT_REGISTRATION_WINDOW_MS) || 86400000, // 24 hours
      max: parseInt(process.env.RATE_LIMIT_REGISTRATION_MAX) || 5,
      blockDuration: parseInt(process.env.RATE_LIMIT_REGISTRATION_BLOCK_DURATION_MS) || 86400000 // 24 hours
    },
    socket: {
      windowMs: 60000, // 1 minute
      max: parseInt(process.env.RATE_LIMIT_SOCKET_MAX) || 120
    }
  },
  
  // Development defaults - 10x higher limits
  development: {
    api: {
      windowMs: parseInt(process.env.RATE_LIMIT_API_WINDOW_MS) || 900000,
      max: (parseInt(process.env.RATE_LIMIT_API_MAX) || 100) * 10
    },
    auth: {
      windowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS) || 3600000,
      max: (parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 10) * 10,
      blockDuration: parseInt(process.env.RATE_LIMIT_AUTH_BLOCK_DURATION_MS) || 1800000
    },
    messages: {
      windowMs: parseInt(process.env.RATE_LIMIT_MESSAGES_WINDOW_MS) || 60000,
      max: (parseInt(process.env.RATE_LIMIT_MESSAGES_MAX) || 60) * 10,
      blockDuration: parseInt(process.env.RATE_LIMIT_MESSAGES_BLOCK_DURATION_MS) || 300000
    },
    registration: {
      windowMs: parseInt(process.env.RATE_LIMIT_REGISTRATION_WINDOW_MS) || 86400000,
      max: (parseInt(process.env.RATE_LIMIT_REGISTRATION_MAX) || 5) * 10,
      blockDuration: parseInt(process.env.RATE_LIMIT_REGISTRATION_BLOCK_DURATION_MS) || 86400000
    },
    socket: {
      windowMs: 60000,
      max: (parseInt(process.env.RATE_LIMIT_SOCKET_MAX) || 120) * 10
    }
  },
  
  // Test defaults - very permissive
  test: {
    api: {
      windowMs: 900000,
      max: 5000
    },
    auth: {
      windowMs: 3600000,
      max: 500
    },
    messages: {
      windowMs: 60000,
      max: 3000
    },
    registration: {
      windowMs: 86400000,
      max: 100
    },
    socket: {
      windowMs: 60000,
      max: 5000
    }
  }
};