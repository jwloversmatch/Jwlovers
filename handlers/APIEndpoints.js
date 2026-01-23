// handlers/APIEndpoints.js
const crypto = require("crypto");
const os = require("os");

class APIEndpoints {
  constructor(app, config, services, logger) {
    this.app = app;
    this.config = config;
    this.services = services;
    this.logger = logger;
    this.loadedRoutes = {};
  }

  setLoadedRoutes(routes) {
    this.loadedRoutes = routes;
  }

  setupAllEndpoints(rateLimitConfig, getRateLimitMetrics, redisCircuitBreaker, RATE_LIMIT_CONFIG) {
    this.setupRootEndpoint(rateLimitConfig);
    this.setupHealthEndpoint();
    this.setupMetricsEndpoint();
    this.setupRateLimitMetricsEndpoint(getRateLimitMetrics, redisCircuitBreaker, RATE_LIMIT_CONFIG);
    this.setupErrorHandlers();
  }

  setupRootEndpoint(rateLimitConfig) {
    this.app.get("/api", (req, res) => {
      const availableRoutes = Object.entries(this.loadedRoutes)
        .filter(([name, loaded]) => loaded)
        .map(([name]) => `/api/${name}`)
        .concat([
          "/health",
          "/metrics",
          "/api/rate-limit/metrics",
          "/api/websocket/health",
        ]);

      let wsConnections = 0;
      if (this.services.webSocketService?.getIo) {
        const io = this.services.webSocketService.getIo();
        if (io) wsConnections = io.engine.clientsCount || 0;
      }

      res.json({
        success: true,
        message: this.config.app.name,
        version: this.config.app.version,
        timestamp: new Date().toISOString(),
        environment: this.config.app.environment,
        endpoints: availableRoutes,
        features: {
          encryption: {
            enabled: true,
            algorithm: this.config.encryption.algorithm,
            e2ee: this.config.features.e2ee,
            serverSide: true,
          },
          rateLimiting: rateLimitConfig,
          webSocket: {
            enabled: this.config.features.webSocket,
            connections: wsConnections,
            stats: "/api/websocket/stats",
            health: "/api/websocket/health",
          },
          moderation: this.config.features.contentModeration,
          safety: this.config.features.safetyTips,
          ageVerification: this.config.features.ageVerification,
        },
        links: {
          terms: this.config.urls.terms,
          privacy: this.config.urls.privacy,
          support: `mailto:${this.config.urls.support}`,
          health: "/health",
          metrics: "/metrics",
          rateLimitMetrics: "/api/rate-limit/metrics",
          websocketHealth: "/api/websocket/health",
          websocketStats: "/api/websocket/stats",
        },
      });
    });
  }

  setupHealthEndpoint() {
    this.app.get("/health", async (req, res) => {
      try {
        const dbState = this.services.databaseService.getReadyState();
        let redisHealthy = false;
        let redisMetrics = {};

        if (this.services.redisService.isReady()) {
          try {
            redisHealthy = (await this.services.redisService.getClient().ping()) === "PONG";
            redisMetrics = this.services.redisService.getMetrics();
          } catch (error) {
            this.logger.error("Redis health check failed:", error);
          }
        }

        let wsConnections = 0;
        let wsStats = {};
        if (this.services.webSocketService) {
          if (this.services.webSocketService.getStats) {
            wsStats = this.services.webSocketService.getStats();
          }
          if (this.services.webSocketService.getIo) {
            const io = this.services.webSocketService.getIo();
            if (io) wsConnections = io.engine.clientsCount;
          }
        }

        const healthData = {
          status: "OK",
          service: this.config.app.name,
          version: this.config.app.version,
          timestamp: new Date().toISOString(),
          environment: this.config.app.environment,
          uptime: process.uptime(),
          memory: {
            rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
            heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`,
            heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
            external: `${(process.memoryUsage().external / 1024 / 1024).toFixed(2)} MB`,
          },
          database: {
            status: dbState.status,
            readyState: dbState.readyState,
            connected: this.services.databaseService.isConnected(),
          },
          redis: {
            ready: this.services.redisService.isReady(),
            healthy: redisHealthy,
            ...redisMetrics,
          },
          encryption: {
            enabled: true,
            algorithm: this.config.encryption.algorithm,
            e2ee: this.config.features.e2ee,
            keyVersion: this.config.encryption.keyVersion,
          },
          webSocket: {
            enabled: this.config.features.webSocket,
            connections: wsConnections,
            ...wsStats,
          },
          process: {
            pid: process.pid,
            version: process.version,
            platform: process.platform,
            arch: process.arch,
            cpus: os.cpus().length,
          },
        };

        const criticalServices = [
          this.services.databaseService.isConnected(),
          this.services.redisService.isReady() && redisHealthy,
          !!this.services.encryptionService,
        ];

        const allHealthy = criticalServices.every((service) => service === true);

        if (!allHealthy) {
          healthData.status = "DEGRADED";
          healthData.warning = "Some services are not healthy";
        }

        res.json(healthData);
      } catch (error) {
        this.logger.error("Health check error:", error);
        res.status(500).json({
          status: "ERROR",
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  setupMetricsEndpoint() {
    this.app.get("/metrics", (req, res) => {
      try {
        let wsMetrics = {};
        if (this.services.webSocketService?.getStats) {
          wsMetrics = this.services.webSocketService.getStats();
        }

        const metrics = {
          redis: this.services.redisService.getMetrics(),
          webSocket: wsMetrics,
          socketRateLimiter: this.services.webSocketService.getSocketRateLimiter()
            ? this.services.webSocketService.getSocketRateLimiter().getMetrics()
            : [],
          process: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
            loadavg: os.loadavg(),
          },
          database: {
            connected: this.services.databaseService.isConnected(),
            readyState: this.services.databaseService.getReadyState().readyState,
          },
          timestamp: new Date().toISOString(),
        };

        res.json({ success: true, data: metrics });
      } catch (error) {
        this.logger.error("Metrics error:", error);
        res.status(500).json({
          success: false,
          error: "Failed to get metrics",
          details: this.config.app.environment === "development" ? error.message : undefined,
        });
      }
    });
  }

  setupRateLimitMetricsEndpoint(getRateLimitMetrics, redisCircuitBreaker, RATE_LIMIT_CONFIG) {
    this.app.get("/api/rate-limit/metrics", (req, res) => {
      try {
        let socketRateLimiterMetrics = [];
        if (this.services.webSocketService?.getSocketRateLimiter) {
          const rateLimiter = this.services.webSocketService.getSocketRateLimiter();
          if (rateLimiter?.getMetrics) {
            socketRateLimiterMetrics = rateLimiter.getMetrics();
          }
        }

        const metrics = {
          rateLimiting: getRateLimitMetrics(),
          circuitBreaker: redisCircuitBreaker ? redisCircuitBreaker.getStats() : null,
          redis: this.services.redisService.getMetrics(),
          socket: socketRateLimiterMetrics,
          process: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
          },
          config: RATE_LIMIT_CONFIG,
          environment: this.config.app.environment,
          timestamp: new Date().toISOString(),
        };

        res.json({ success: true, data: metrics });
      } catch (error) {
        this.logger.error("Rate limit metrics error:", error);
        res.status(500).json({
          success: false,
          error: "Failed to get rate limit metrics",
          details: this.config.app.environment === "development" ? error.message : undefined,
        });
      }
    });
  }

  setupErrorHandlers() {
    // 404 handler
    this.app.use((req, res) => {
      const availableEndpoints = [
        "/api",
        "/health",
        "/metrics",
        "/api/rate-limit/metrics",
        "/api/websocket/health",
        ...Object.entries(this.loadedRoutes)
          .filter(([name, loaded]) => loaded)
          .map(([name]) => `/api/${name}`),
      ];

      res.status(404).json({
        success: false,
        error: "Route not found",
        path: req.path,
        method: req.method,
        requestId: req.requestId,
        availableEndpoints,
        documentation: this.config.urls.apiDocs,
      });
    });

    // Global error handler
    this.app.use((err, req, res, next) => {
      const errorId = crypto.randomBytes(4).toString("hex");

      this.logger.error(`[${errorId}] Unhandled error:`, {
        error: err.message,
        stack: err.stack,
        requestId: req.requestId,
        path: req.path,
        method: req.method,
        userId: req.user?.id,
        ip: req.ip,
      });

      // Rate limit errors
      if (err.name === "RateLimitError") {
        return res.status(429).json({
          success: false,
          error: err.message || "Rate limit exceeded",
          code: "RATE_LIMIT_EXCEEDED",
          requestId: req.requestId,
          errorId,
          retryAfter: err.retryAfter || 60,
          documentation: this.config.urls.apiDocs + "/rate-limiting",
        });
      }

      // Validation errors
      if (err.name === "ValidationError") {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          requestId: req.requestId,
          errorId,
          details: err.errors || err.message,
        });
      }

      // JWT errors
      if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          error: "Authentication failed",
          code: "AUTHENTICATION_ERROR",
          requestId: req.requestId,
          errorId,
        });
      }

      const errorMessage = this.config.app.environment === "production"
        ? "Internal server error"
        : err.message;

      res.status(err.statusCode || 500).json({
        success: false,
        error: errorMessage,
        code: err.code || "INTERNAL_SERVER_ERROR",
        requestId: req.requestId,
        errorId,
        ...(this.config.app.environment === "development" && {
          stack: err.stack,
          details: err.message,
        }),
      });
    });
  }
}

module.exports = APIEndpoints;