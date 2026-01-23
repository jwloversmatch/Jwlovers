const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");

const setupRoutes = (app) => {
  const chatRoutes = require("./chat.routes");
  app.use("/api/chat", chatRoutes);
  logger.info("✅ Chat routes mounted at /api/chat");

  const healthRoutes = require("./health.routes");
  app.use("/", healthRoutes);
  logger.info("✅ Health routes mounted");

  const routeFiles = [
    { path: "/api/auth", file: "auth.routes.js", name: "Auth" },
    { path: "/api/users", file: "user.routes.js", name: "User" },
    { path: "/api/presence", file: "presence.routes.js", name: "Presence" },
    { path: "/api/match", file: "match.routes.js", name: "Match" },
    { path: "/api/profile", file: "profile.routes.js", name: "Profile" },
    { path: "/api/notifications", file: "notification.routes.js", name: "Notification" }
  ];

  routeFiles.forEach(({ path: routePath, file, name }) => {
    const fullPath = path.join(__dirname, file);
    if (fs.existsSync(fullPath)) {
      try {
        const router = require(`./${file}`);
        app.use(routePath, router);
        logger.info(`✅ ${name} routes mounted at ${routePath}`);
      } catch (error) {
        logger.error(`❌ Failed to load ${name} routes:`, error.message);
      }
    } else {
      logger.warn(`⚠️ ${name} route file not found: ${fullPath}`);
    }
  });

  app.get("/api", (req, res) => {
    res.json({
      success: true,
      message: "JW Lovers API",
      version: "4.0.0",
      timestamp: new Date().toISOString(),
      endpoints: {
        auth: "/api/auth",
        users: "/api/users",
        presence: "/api/presence",
        match: "/api/match",
        profile: "/api/profile",
        chat: "/api/chat",
        notifications: "/api/notifications",
        health: "/health",
        metrics: "/metrics"
      },
      encryption: {
        enabled: true,
        algorithm: "aes-256-gcm",
        keyDerivation: "PBKDF2",
        serverSide: true,
        legacySupport: true,
        migrationEndpoint: "/api/chat/migrate-legacy-messages"
      },
      rateLimiting: {
        http: process.env.DISABLE_RATE_LIMITING !== "true",
        socket: true,
        messagesPerMinute: 60
      }
    });
  });
};

module.exports = { setupRoutes };