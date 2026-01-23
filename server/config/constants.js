const crypto = require("crypto");

const CONFIG = {
  ENCRYPTION: {
    ALGORITHM: "aes-256-gcm",
    IV_LENGTH: 16,
    AUTH_TAG_LENGTH: 16,
    KEY_ITERATIONS: 100000,
    KEY_LENGTH: 32,
    SALT: crypto.randomBytes(16).toString("hex")
  },
  REDIS: {
    OFFLINE_TTL: 604800, // 7 days
    PRESENCE_TTL: 7200, // 2 hours
    LOCK_TTL: 30,
    ONLINE_SET_KEY: "online_users",
    OFFLINE_PREFIX: "offline_messages:",
    USER_PREFIX: "user:",
    DUPLICATE_PREFIX: "msg_dedup:",
    BLOCK_PREFIX: "user_blocked:",
    CONNECTION_PREFIX: "user_connections:"
  },
  RATE_LIMITS: {
    MESSAGES_PER_MINUTE: 60,
    TYPING_EVENTS_PER_MINUTE: 120,
    WINDOW_MS: 60000,
    MAX_CONNECTIONS_PER_USER: 5
  },
  VALIDATION: {
    MAX_MESSAGE_LENGTH: 10000,
    MIN_MESSAGE_LENGTH: 1,
    MAX_USERNAME_LENGTH: 50
  },
  DATABASE: {
    MAX_POOL_SIZE: 50,
    MIN_POOL_SIZE: 10,
    SOCKET_TIMEOUT_MS: 45000,
    SERVER_SELECTION_TIMEOUT_MS: 5000
  },
  SOCKET: {
    PING_TIMEOUT: 60000,
    PING_INTERVAL: 25000,
    UPGRADE_TIMEOUT: 30000,
    MAX_HTTP_BUFFER_SIZE: 1e6,
    CONNECT_TIMEOUT: 45000
  }
};

module.exports = CONFIG;