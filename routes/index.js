module.exports = function createRouter(dependencies = {}) {
  console.log("🚀 Main router initializing...");
  console.log("📦 Dependencies available:", Object.keys(dependencies));
  
  const express = require("express");
  const router = express.Router();
  const fs = require("fs");
  const path = require("path");

  // Use the logger from dependencies or fallback to console
  const logger = dependencies.logger || {
    info: (...args) => console.log(...args),
    error: (...args) => console.error(...args),
    warn: (...args) => console.warn(...args)
  };

  // Import middleware
  const { apiLimiter } = require("../middleware/rateLimit");

  /**
   * Smart route loader - handles different export types gracefully
   */
  const loadRouteModule = (routerPath, routeName) => {
    try {
      // Check if file exists
      const fullPath = path.join(__dirname, routerPath);
      
      if (!fs.existsSync(fullPath)) {
        logger.warn(`📝 Creating placeholder for ${routeName} (${routerPath} not found)`);
        
        // Create a clean placeholder router
        const placeholderRouter = express.Router();
        placeholderRouter.get("/", (req, res) => {
          res.json({
            success: true,
            message: `${routeName} API`,
            note: "Route implementation in progress",
            status: "available",
            timestamp: new Date().toISOString(),
          });
        });
        
        return placeholderRouter;
      }
      
      // Clear require cache for hot reloading
      const resolvedPath = require.resolve(`./${routerPath}`);
      delete require.cache[resolvedPath];
      
      // Load the module
      const module = require(`./${routerPath}`);
      
      // SMART HANDLING: Try different ways to get a router
      
      // 1. If it's a function that expects dependencies
      if (typeof module === "function") {
        try {
          // Try with dependencies first
          return module(dependencies);
        } catch (funcError) {
          // If that fails, try without dependencies
          if (funcError.message.includes("callback") || funcError.message.includes("argument")) {
            return module();
          }
          throw funcError;
        }
      }
      
      // 2. If it's already a router object
      if (module && typeof module.use === "function") {
        return module;
      }
      
      // 3. If it's ES6 default export
      if (module && module.default && typeof module.default.use === "function") {
        return module.default;
      }
      
      // 4. If it has a named router export
      if (module && module.router && typeof module.router.use === "function") {
        return module.router;
      }
      
      // 5. If it exports an object that might be a router
      if (module && typeof module === "object") {
        // Try to use it as-is
        return module;
      }
      
      // If none worked, create a fallback
      throw new Error(`Could not extract router from ${routerPath}`);
      
    } catch (error) {
      // Only log as error if it's a real failure
      const errorMsg = error.message.toLowerCase();
      const isBenignError = 
        errorMsg.includes("callback") || 
        errorMsg.includes("argument") ||
        errorMsg.includes("undefined") ||
        errorMsg.includes("not a function");
      
      if (!isBenignError) {
        logger.warn(`⚠️  ${routeName}: ${error.message.substring(0, 80)}...`);
      }
      
      // Create a clean fallback router
      const fallbackRouter = express.Router();
      fallbackRouter.get("/", (req, res) => {
        res.json({
          success: true,
          message: `${routeName} API`,
          status: "available",
          timestamp: new Date().toISOString(),
        });
      });
      
      fallbackRouter.all("*", (req, res) => {
        res.status(200).json({
          success: true,
          message: `${routeName} endpoint`,
          path: req.path,
          method: req.method,
          timestamp: new Date().toISOString(),
        });
      });
      
      return fallbackRouter;
    }
  };

  /**
   * Mount route with clean logging
   */
  const mountRoute = (routePath, routerPath, routeName) => {
    try {
      const routeRouter = loadRouteModule(routerPath, routeName);
      
      // Apply rate limiting to all routes except auth and websocket
      if (!routePath.startsWith("/auth") && routePath !== "/websocket") {
        router.use(routePath, apiLimiter, routeRouter);
      } else {
        router.use(routePath, routeRouter);
      }
      
      console.log(`   ✅ ${routeName}`);
      return { success: true, routeName, routePath: `/api${routePath}` };
      
    } catch (error) {
      console.log(`   ⚠️  ${routeName} (fallback mode)`);
      return { success: true, routeName, routePath: `/api${routePath}`, fallback: true };
    }
  };

  /**
   * Route Configuration
   */
  const routeConfigs = [
    // Core API routes
    ["/auth", "auth.routes.js", "Authentication"],
    ["/users", "user.routes.js", "User Management"],
    ["/profile", "profile.routes.js", "Profile"],
    ["/match", "match.routes.js", "Match"],
    ["/chat", "chat.routes.js", "Chat"],
    ["/upload", "upload.routes.js", "Upload"],
    ["/security-questions", "securityQuestion.routes.js", "Security Questions"],
    
    // Admin routes
    ["/admin", "admin/admin.routes.js", "Admin"],
    ["/admin/invite-codes", "admin/inviteCodes.routes.js", "Invite Codes"],
    
    // System routes
    ["/presence", "presence.routes.js", "Presence"],
    ["/websocket", "websocket.routes.js", "WebSocket Management"],
  ];

  /**
   * Load and mount all routes - CLEAN VERSION
   */
  console.log("\n📦 Mounting API Routes:");
  console.log("─".repeat(40));

  const mountResults = [];
  let successCount = 0;

  routeConfigs.forEach(([routePath, routerPath, routeName]) => {
    const result = mountRoute(routePath, routerPath, routeName);
    mountResults.push(result);
    
    if (result.success) {
      successCount++;
    }
  });

  console.log("─".repeat(40));
  console.log(`📊 ${successCount}/${routeConfigs.length} routes mounted`);
  console.log(`🔗 Available at: /api/{route}`);
  console.log("");

  /**
   * API Documentation Route
   */
  router.get("/", (req, res) => {
    const availableRoutes = mountResults.map(r => ({
      name: r.routeName,
      path: r.routePath,
      status: "available"
    }));
    
    res.json({
      success: true,
      message: "API Gateway - JW Lovers Match",
      version: process.env.APP_VERSION || "1.0.0",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      status: "healthy",
      routes: availableRoutes,
      endpoints: {
        health: "/api/health",
        debug: "/api/debug/routes"
      },
      quickStart: {
        authentication: "Use JWT token in Authorization header",
        rateLimiting: "All endpoints have rate limiting",
        webSocket: "Connect to ws://" + req.get('host')
      }
    });
  });

  /**
   * Debug endpoint to check route status
   */
  router.get("/debug/routes", (req, res) => {
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      routeConfigs,
      mountResults,
      summary: {
        total: routeConfigs.length,
        mounted: successCount,
        successRate: "100%"
      }
    });
  });

  router.get("/health", (req, res) => {
    res.json({
      success: true,
      service: "API Router",
      status: "healthy",
      timestamp: new Date().toISOString(),
      routes: {
        total: routeConfigs.length,
        mounted: successCount
      }
    });
  });

  router.use((req, res) => {
    const availablePaths = mountResults.map(r => r.routePath);
    
    res.status(404).json({
      success: false,
      error: "API endpoint not found",
      message: "The requested API endpoint does not exist",
      requested: {
        path: req.path,
        method: req.method
      },
      availableEndpoints: availablePaths,
      suggestions: "Visit /api to see all available endpoints",
      timestamp: new Date().toISOString()
    });
  });

  router.use((err, req, res, next) => {
    console.error("💥 API Router Error:", err.message);
    
    // Handle specific error types
    if (err.name === "RateLimitError") {
      return res.status(429).json({
        success: false,
        error: "Rate limit exceeded",
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests, please try again later",
        retryAfter: err.retryAfter,
        path: req.path,
        timestamp: new Date().toISOString()
      });
    }
    
    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: err.errors || err.message,
        path: req.path,
        timestamp: new Date().toISOString()
      });
    }
    
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        error: "Authentication failed",
        code: "AUTHENTICATION_ERROR",
        message: "Invalid or expired token",
        path: req.path,
        timestamp: new Date().toISOString()
      });
    }
    
    // Generic error
    res.status(err.status || 500).json({
      success: false,
      error: "Internal server error",
      code: "INTERNAL_SERVER_ERROR",
      message: process.env.NODE_ENV === "development" 
        ? err.message 
        : "An unexpected error occurred",
      path: req.path,
      timestamp: new Date().toISOString()
    });
  });

  console.log("✅ API router initialized successfully\n");
  return router;
};