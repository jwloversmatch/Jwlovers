const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const logger = require("./utils/logger");
const requestLogger = require("./middleware/requestLogger");
const errorHandler = require("./middleware/errorHandler");
const { setupRoutes } = require("./routes");

const createApp = () => {
  const app = express();

  // Security middleware
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }));

  // Compression
  app.use(compression());

  // Body parsers
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(cookieParser());

  // CORS
  const corsOrigins = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(",").map((origin) => origin.trim())
    : ["http://localhost:3000"];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin && process.env.NODE_ENV === "development") {
          return callback(null, true);
        }
        if (corsOrigins.includes(origin) || process.env.NODE_ENV === "development") {
          return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS"), false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"]
    })
  );

  // Request logging
  app.use(requestLogger);

  // Rate limiting
  if (process.env.DISABLE_RATE_LIMITING !== "true") {
    const globalLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 1000,
      message: {
        success: false,
        error: "Too many requests, please try again later"
      },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.path === "/health" || req.path === "/api"
    });
    app.use("/api/", globalLimiter);
    logger.info("✅ Rate limiting enabled");
  }

  // Setup routes
  setupRoutes(app);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: "Route not found",
      path: req.path,
      method: req.method,
      requestId: req.requestId
    });
  });

  // Global error handler
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };