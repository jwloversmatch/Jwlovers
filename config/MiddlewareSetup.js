// config/MiddlewareSetup.js
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const compression = require("compression");
const crypto = require("crypto");

class MiddlewareSetup {
  constructor(app, config, logger) {
    this.app = app;
    this.config = config;
    this.logger = logger;
  }

  setupAll() {
    this.setupSecurity();
    this.setupCompression();
    this.setupBodyParsers();
    this.setupCORS();
    this.setupRequestLogging();
    this.setupPerformanceMonitoring();
  }

  setupSecurity() {
    const { security } = this.config;

    if (security.headersEnabled && security.helmetEnabled) {
      this.app.use(
        helmet({
          crossOriginResourcePolicy: { policy: "cross-origin" },
          contentSecurityPolicy: this.config.app.environment === "production" ? undefined : false,
          hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
          },
        })
      );
      this.logger.info("✅ Security headers enabled");
    }

    if (security.trustProxy) {
      this.app.set("trust proxy", security.trustProxy);
      this.logger.info(`✅ Trust proxy configured: ${security.trustProxy}`);
    }
  }

  setupCompression() {
    if (this.config.features.compression) {
      this.app.use(compression());
      this.logger.info("✅ Compression enabled");
    }
  }

  setupBodyParsers() {
    this.app.use(
      express.json({
        limit: this.config.limits.bodyParserLimit,
        verify: (req, res, buf) => {
          req.rawBody = buf.toString();
        },
      })
    );

    this.app.use(
      express.urlencoded({
        extended: true,
        limit: this.config.limits.bodyParserLimit,
      })
    );

    this.app.use(cookieParser(this.config.security.cookieSecret));
  }

  setupCORS() {
    const { cors: corsConfig, app: appConfig } = this.config;

    const corsOptions = {
      origin: (origin, callback) => {
        // Allow requests with no origin in development
        if (!origin && appConfig.environment === "development") {
          return callback(null, true);
        }

        // Check against allowed origins
        if (corsConfig.origins.includes(origin) || appConfig.environment === "development") {
          return callback(null, true);
        }

        // Allow all if configured (not recommended)
        if (corsConfig.allowAll) {
          this.logger.warn("⚠️ ALLOW_CORS_ALL is true - allowing all origins");
          return callback(null, true);
        }

        this.logger.warn(`CORS blocked: ${origin} not in allowed list`);
        return callback(new Error("Not allowed by CORS"), false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Accept",
        "Origin",
        "X-API-Key",
        "X-Emergency-Token",
      ],
      exposedHeaders: [
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "Retry-After",
      ],
      maxAge: 86400,
    };

    this.app.use(cors(corsOptions));
    this.logger.info(`✅ CORS configured for origins: ${corsConfig.origins.join(", ")}`);
  }

  setupRequestLogging() {
    if (!this.config.features.requestLogging) return;

    this.app.use((req, res, next) => {
      const start = Date.now();
      const requestId = crypto.randomBytes(8).toString("hex");

      req.requestId = requestId;

      if (process.env.LOG_LEVEL === "debug") {
        this.logger.debug(`[${requestId}] ${req.method} ${req.url}`, {
          ip: req.ip,
          userAgent: req.get("User-Agent"),
          contentType: req.get("Content-Type"),
          contentLength: req.get("Content-Length"),
        });
      }

      res.on("finish", () => {
        const duration = Date.now() - start;
        const logLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

        this.logger[logLevel](
          `[${requestId}] ${req.method} ${req.url} ${res.statusCode} ${duration}ms`,
          {
            duration,
            status: res.statusCode,
            contentType: res.get("Content-Type"),
            contentLength: res.get("Content-Length"),
          }
        );
      });

      next();
    });

    this.logger.info("✅ Request logging enabled");
  }

  setupPerformanceMonitoring() {
    if (!this.config.features.performanceLogging) return;

    this.app.use((req, res, next) => {
      req._startTime = Date.now();
      next();
    });

    this.logger.info("✅ Performance logging enabled");
  }

  setupRateLimitInfo(rateLimitInfoMiddleware) {
    this.app.use(rateLimitInfoMiddleware);
  }
}

module.exports = MiddlewareSetup;