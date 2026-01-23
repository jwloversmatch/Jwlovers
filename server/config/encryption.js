const crypto = require("crypto");
const CONFIG = require("./constants");
const logger = require("../utils/logger");

// ========== ENCRYPTION KEY SETUP ==========
const ENCRYPTION_KEY_RAW = process.env.MESSAGE_ENCRYPTION_KEY;

if (!ENCRYPTION_KEY_RAW) {
  logger.error("❌ FATAL: MESSAGE_ENCRYPTION_KEY environment variable is required");
  process.exit(1);
}

// Store salt in env or generate new one
const encryptionSalt = process.env.ENCRYPTION_SALT || CONFIG.ENCRYPTION.SALT;
logger.info(`🔐 Encryption salt: ${encryptionSalt.substring(0, 8)}...`);

const ENCRYPTION_KEY = crypto.pbkdf2Sync(
  ENCRYPTION_KEY_RAW,
  encryptionSalt,
  CONFIG.ENCRYPTION.KEY_ITERATIONS,
  CONFIG.ENCRYPTION.KEY_LENGTH,
  'sha256'
);

module.exports = { ENCRYPTION_KEY, encryptionSalt };