// config/ServerConfig.js
const winston = require("winston");
const path = require("path");

class ServerConfig {
  constructor() {
    this.logger = this.initializeLogger();
    this.config = this.loadConfiguration();
  }

  initializeLogger() {
    return winston.createLogger({
      level: process.env.LOG_LEVEL || "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      transports: [
        new winston.transports.File({
          filename: path.join(process.env.LOG_DIR || "./logs", "error.log"),
          level: "error",
          maxsize: parseInt(process.env.LOG_MAX_SIZE) || 10485760,
          maxFiles: parseInt(process.env.LOG_MAX_FILES) || 14,
          zippedArchive: process.env.LOG_COMPRESS === "true",
        }),
        new winston.transports.File({
          filename: path.join(process.env.LOG_DIR || "./logs", "combined.log"),
          maxsize: parseInt(process.env.LOG_MAX_SIZE) || 10485760,
          maxFiles: parseInt(process.env.LOG_MAX_FILES) || 14,
          zippedArchive: process.env.LOG_COMPRESS === "true",
        }),
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
          ),
        }),
      ],
    });
  }

  loadConfiguration() {
    const config = {
      app: {
        name: process.env.APP_NAME || "JW Lovers Match",
        version: process.env.APP_VERSION || "1.0.0",
        environment: process.env.NODE_ENV || "development",
        port: parseInt(process.env.PORT) || 5000,
        host: process.env.HOST || "0.0.0.0",
      },
      
      cors: {
        origins: process.env.CORS_ORIGIN 
          ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
          : ["http://localhost:3000"],
        allowAll: process.env.ALLOW_CORS_ALL === "true",
      },

      security: {
        headersEnabled: process.env.SECURITY_HEADERS_ENABLED === "true",
        helmetEnabled: process.env.HELMET_ENABLED !== "false",
        trustProxy: parseInt(process.env.TRUST_PROXY) || 1,
        cookieSecret: process.env.COOKIE_SECRET,
      },

      features: {
        compression: process.env.COMPRESSION_ENABLED === "true",
        requestLogging: process.env.ENABLE_REQUEST_LOGGING === "true",
        performanceLogging: process.env.ENABLE_PERFORMANCE_LOGGING === "true",
        webSocket: process.env.WS_ENABLED === "true",
        rateLimiting: process.env.DISABLE_RATE_LIMITING !== "true",
        e2ee: process.env.ENABLE_END_TO_END_ENCRYPTION === "true",
        contentModeration: process.env.CONTENT_MODERATION_ENABLED === "true",
        ageVerification: process.env.AGE_VERIFICATION_REQUIRED === "true",
        mockData: process.env.ENABLE_MOCK_DATA === "true",
      },

      encryption: {
        key: process.env.MESSAGE_ENCRYPTION_KEY,
        salt: process.env.ENCRYPTION_SALT,
        algorithm: process.env.MESSAGE_ENCRYPTION_ALGORITHM || "AES-256-GCM",
        keyVersion: process.env.ENCRYPTION_KEY_VERSION || "1",
      },

      limits: {
        bodyParserLimit: process.env.BODY_PARSER_LIMIT || "10mb",
        shutdownTimeout: parseInt(process.env.SHUTDOWN_TIMEOUT) || 10000,
      },

      urls: {
        client: process.env.CLIENT_URL,
        terms: process.env.TERMS_URL,
        privacy: process.env.PRIVACY_POLICY_URL,
        apiDocs: process.env.API_DOCS_URL || "https://jwloversmatch.com/docs",
        support: process.env.SUPPORT_EMAIL,
      },

      rateLimiting: this.getRateLimitConfig(),
    };

    return config;
  }

  getRateLimitConfig() {
    const env = process.env.NODE_ENV || "development";
    const isDisabled = 
      process.env.DISABLE_RATE_LIMITING === "true" ||
      (env === "development" && process.env.DISABLE_RATE_LIMITING_DEV === "true");

    return {
      enabled: !isDisabled,
      environment: env,
      storage: "Redis with memory fallback",
      circuitBreaker: process.env.RATE_LIMIT_CIRCUIT_BREAKER_ENABLED === "true",
      developmentMode: env === "development",
      limits: {
        api: parseInt(process.env.RATE_LIMIT_API_MAX) || 100,
        auth: parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 10,
        messages: parseInt(process.env.RATE_LIMIT_MESSAGES_MAX) || 60,
        registration: parseInt(process.env.RATE_LIMIT_REGISTRATION_MAX) || 5,
        socket: parseInt(process.env.RATE_LIMIT_SOCKET_MAX) || 120,
        search: parseInt(process.env.RATE_LIMIT_SEARCH_MAX) || 30,
        upload: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX) || 50,
        profileViews: parseInt(process.env.RATE_LIMIT_PROFILE_VIEWS_MAX) || 60,
      },
      windows: {
        api: parseInt(process.env.RATE_LIMIT_API_WINDOW_MS) || 900000,
        auth: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS) || 3600000,
        messages: parseInt(process.env.RATE_LIMIT_MESSAGES_WINDOW_MS) || 60000,
        registration: parseInt(process.env.RATE_LIMIT_REGISTRATION_WINDOW_MS) || 86400000,
      },
    };
  }

  logConfiguration() {
    const { logger } = this;
    const { app, rateLimiting } = this.config;

    logger.info("=".repeat(60));
    logger.info(`🚀 Starting ${app.name} Server`);
    logger.info(`📦 Version: ${app.version}`);
    logger.info(`🌐 Environment: ${app.environment}`);
    logger.info("=".repeat(60));

    this.logRateLimitConfig();
  }

  logRateLimitConfig() {
    const { logger } = this;
    const { rateLimiting } = this.config;

    logger.info("=".repeat(50));
    logger.info("📊 Rate Limiting System");
    logger.info("=".repeat(50));

    if (!rateLimiting.enabled) {
      logger.warn("⚠️  RATE LIMITING IS DISABLED - NOT RECOMMENDED FOR PRODUCTION");
      logger.warn("   Set DISABLE_RATE_LIMITING=false to enable rate limiting");
      return;
    }

    logger.info(`✅ Rate limiting ENABLED for ${rateLimiting.environment} environment`);
    logger.info(`🔧 Storage: ${rateLimiting.storage}`);
    logger.info(`⚡ Circuit Breaker: ${rateLimiting.circuitBreaker ? "Enabled" : "Disabled"}`);
    logger.info(`📈 Limits:`);
    logger.info(`   - API: ${rateLimiting.limits.api} requests/${rateLimiting.windows.api / 60000} minutes`);
    logger.info(`   - Auth: ${rateLimiting.limits.auth} requests/${rateLimiting.windows.auth / 3600000} hours`);
    logger.info(`   - Messages: ${rateLimiting.limits.messages} messages/minute`);
    logger.info(`   - Registration: ${rateLimiting.limits.registration} registrations/24 hours`);
    logger.info(`   - Socket: ${rateLimiting.limits.socket} events/minute`);
    logger.info(`   - Search: ${rateLimiting.limits.search} searches/minute`);
    logger.info(`   - Upload: ${rateLimiting.limits.upload} uploads/hour`);
    logger.info(`   - Profile Views: ${rateLimiting.limits.profileViews} views/minute`);

    if (rateLimiting.developmentMode) {
      logger.info("💡 Development mode: Limits are 10x higher");
      logger.info("💡 Localhost requests are exempt from rate limiting");
    }

    logger.info("=".repeat(50));
  }

  getConfig() {
    return this.config;
  }

  getLogger() {
    return this.logger;
  }

  validateEncryptionKey() {
    if (!this.config.encryption.key) {
      this.logger.error("❌ FATAL: MESSAGE_ENCRYPTION_KEY environment variable is required");
      process.exit(1);
    }
  }
}

module.exports = new ServerConfig();