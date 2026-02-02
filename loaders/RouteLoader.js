const express = require("express");
const fs = require("fs");
const path = require("path");

class RouteLoader {
  constructor(app, logger) {
    this.app = app;
    this.logger = logger;
    this.loadedRoutes = {};
    this.routeMetrics = {
      total: 0,
      successful: 0,
      failed: 0,
      warnings: 0
    };
  }

  loadRoute(routePath, routerPath, routeName, dependencies = {}) {
    this.routeMetrics.total++;
    
    try {
      const fullPath = path.join(process.cwd(), routerPath);

      // Check if route file exists
      if (!fs.existsSync(fullPath)) {
        this.routeMetrics.warnings++;
        this.logger.warn(`⚠️ ${routeName} route file not found: ${fullPath}`);
        
        // Create a placeholder route for missing route files
        const placeholderRouter = this.createPlaceholderRoute(routeName, routerPath);
        this.app.use(routePath, placeholderRouter);
        this.loadedRoutes[routeName] = { 
          success: false, 
          error: 'File not found',
          path: routePath 
        };
        return false;
      }

      // Clear require cache for hot reload in development
      this.clearModuleCache(fullPath);

      // Load the module
      const routeModule = require(fullPath);

      // Extract router with dependency injection
      const router = this.extractRouterWithDeps(routeModule, dependencies, fullPath, routeName);

      // Validate the router
      if (!this.validateRouter(router, routeName)) {
        throw new Error(`Invalid router returned from ${routeName}`);
      }

      // Mount the router
      this.app.use(routePath, router);
      
      // Log route details
      const routeCount = this.countRoutes(router);
      this.logger.info(`✅ ${routeName} routes mounted at ${routePath} (${routeCount} endpoints)`);
      
      this.loadedRoutes[routeName] = { 
        success: true, 
        path: routePath, 
        file: routerPath,
        endpoints: routeCount,
        timestamp: new Date().toISOString()
      };
      
      this.routeMetrics.successful++;
      return true;

    } catch (error) {
      this.routeMetrics.failed++;
      this.logger.error(`❌ ${routeName} routes failed:`, error.message);
      
      // Create error router as fallback
      const errorRouter = this.createErrorRouter(routeName, error);
      this.app.use(routePath, errorRouter);
      
      this.loadedRoutes[routeName] = { 
        success: false, 
        error: error.message,
        path: routePath,
        timestamp: new Date().toISOString()
      };
      
      return false;
    }
  }

  extractRouterWithDeps(module, dependencies, filePath, routeName) {
    const extractors = [
      // 1. Function returning router (with dependencies)
      (m) => {
        if (typeof m === "function") {
          try {
            const result = m(dependencies);
            if (result && typeof result.use === "function") {
              this.logger.debug(`✓ ${routeName}: Loaded as function with dependencies`);
              return result;
            }
          } catch (error) {
            this.logger.warn(`⚠️ ${routeName}: Function call failed, trying other methods: ${error.message}`);
          }
        }
        return null;
      },

      // 2. Express router instance (direct export)
      (m) => {
        if (m && typeof m === "function" && m.stack && typeof m.use === "function") {
          this.logger.debug(`✓ ${routeName}: Loaded as direct router export`);
          return m;
        }
        return null;
      },

      // 3. ES module default export
      (m) => {
        if (m?.default) {
          this.logger.debug(`✓ ${routeName}: Loaded as ES module default export`);
          return this.extractRouterWithDeps(m.default, dependencies, filePath, routeName);
        }
        return null;
      },

      // 4. Module with .router property
      (m) => {
        if (m?.router && typeof m.router.use === "function") {
          this.logger.debug(`✓ ${routeName}: Loaded via .router property`);
          return m.router;
        }
        return null;
      },

      // 5. Module with .getRouter() method
      (m) => {
        if (typeof m?.getRouter === "function") {
          try {
            const router = m.getRouter(dependencies);
            if (router && typeof router.use === "function") {
              this.logger.debug(`✓ ${routeName}: Loaded via getRouter() method`);
              return router;
            }
          } catch (error) {
            // Continue to next extractor
          }
        }
        return null;
      },

      // 6. Object with routes property
      (m) => {
        if (m?.routes && typeof m.routes.use === "function") {
          this.logger.debug(`✓ ${routeName}: Loaded via .routes property`);
          return m.routes;
        }
        return null;
      }
    ];

    for (const extractor of extractors) {
      try {
        const result = extractor(module);
        if (result && typeof result.use === "function") {
          return result;
        }
      } catch (extractorError) {
        // Continue to next extractor
        this.logger.debug(`Extractor failed: ${extractorError.message}`);
      }
    }

    // If no router found, create a minimal one
    this.logger.warn(`⚠️ ${routeName}: No valid router found, creating minimal router`);
    return this.createMinimalRouter(routeName, filePath);
  }

  clearModuleCache(modulePath) {
    try {
      const resolvedPath = require.resolve(modulePath);
      
      // Clear the specific module and its children from cache
      const clearCacheForModule = (moduleId) => {
        const module = require.cache[moduleId];
        if (module) {
          // Clear children recursively
          if (module.children) {
            module.children.forEach(child => {
              clearCacheForModule(child.id);
            });
          }
          delete require.cache[moduleId];
        }
      };
      
      clearCacheForModule(resolvedPath);
    } catch (error) {
      // Ignore cache clearing errors
    }
  }

  validateRouter(router, routeName) {
    if (!router || typeof router.use !== "function") {
      this.logger.error(`❌ ${routeName}: Invalid router - missing use() method`);
      return false;
    }

    if (!router.stack || !Array.isArray(router.stack)) {
      this.logger.warn(`⚠️ ${routeName}: Router has empty stack`);
      return false;
    }

    return true;
  }

  countRoutes(router) {
    if (!router || !router.stack) return 0;
    
    let count = 0;
    const countRoutesRecursive = (layer) => {
      if (layer.route) {
        count++;
      } else if (layer.name === 'router' || layer.name === 'bound dispatch') {
        // This is a sub-router
        if (layer.handle && layer.handle.stack) {
          layer.handle.stack.forEach(countRoutesRecursive);
        }
      }
    };
    
    router.stack.forEach(countRoutesRecursive);
    return count;
  }

  createPlaceholderRoute(routeName, filePath) {
    const router = express.Router();
    
    router.get("/", (req, res) => {
      res.status(503).json({
        success: false,
        service: routeName,
        message: `${routeName} service is temporarily unavailable`,
        error: "Route file not found",
        file: path.basename(filePath),
        timestamp: new Date().toISOString()
      });
    });
    
    router.all("*", (req, res) => {
      res.status(404).json({
        success: false,
        service: routeName,
        message: "Endpoint not available",
        path: req.path,
        method: req.method
      });
    });
    
    return router;
  }

  createErrorRouter(routeName, error) {
    const router = express.Router();
    
    router.use((req, res, next) => {
      res.status(503).json({
        success: false,
        service: routeName,
        error: "Route loading failed",
        message: `${routeName} API temporarily unavailable`,
        details: error.message,
        timestamp: new Date().toISOString(),
        path: req.path
      });
    });
    
    return router;
  }

  createMinimalRouter(routeName, filePath) {
    const router = express.Router();
    
    router.get("/", (req, res) => {
      res.json({
        success: true,
        service: routeName,
        message: `${routeName} API is running`,
        note: "Route loaded with minimal configuration",
        file: path.basename(filePath),
        timestamp: new Date().toISOString()
      });
    });
    
    router.all("*", (req, res) => {
      res.status(501).json({
        success: false,
        service: routeName,
        message: "Endpoint not implemented",
        path: req.path,
        method: req.method
      });
    });
    
    return router;
  }

  loadAllRoutes(routeDefinitions, globalDependencies = {}) {
    this.logger.info("📦 Loading application routes...");
    
    const results = routeDefinitions.map(({ path, file, name, deps = {} }) => {
      // Merge global dependencies with route-specific dependencies
      const routeDependencies = { ...globalDependencies, ...deps };
      
      const success = this.loadRoute(path, file, name, routeDependencies);
      
      return {
        name,
        path,
        file,
        success,
        dependencies: Object.keys(routeDependencies)
      };
    });
    
    // Log summary
    this.logRouteSummary(results);
    
    return this.loadedRoutes;
  }

  logRouteSummary(results) {
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    this.logger.info("=".repeat(60));
    this.logger.info("📊 Route Loading Summary:");
    this.logger.info(`✅ Successful: ${successful}/${results.length}`);
    
    if (failed > 0) {
      this.logger.warn(`❌ Failed: ${failed}/${results.length}`);
      results.filter(r => !r.success).forEach(route => {
        this.logger.warn(`   - ${route.name}: ${route.path} (${route.file})`);
      });
    }
    
    this.logger.info("=".repeat(60));
  }

  getRouteMetrics() {
    return {
      ...this.routeMetrics,
      loadedRoutes: Object.keys(this.loadedRoutes).length,
      details: this.loadedRoutes
    };
  }

  getRouteInfo(routeName) {
    return this.loadedRoutes[routeName] || null;
  }

  getAllRoutes() {
    return Object.entries(this.loadedRoutes).map(([name, info]) => ({
      name,
      ...info
    }));
  }

  // Method to expose route information via API
  createDiagnosticRouter() {
    const router = express.Router();
    
    router.get("/routes", (req, res) => {
      res.json({
        success: true,
        metrics: this.getRouteMetrics(),
        routes: this.getAllRoutes(),
        timestamp: new Date().toISOString()
      });
    });
    
    router.get("/routes/:name", (req, res) => {
      const routeInfo = this.getRouteInfo(req.params.name);
      if (routeInfo) {
        res.json({
          success: true,
          route: routeInfo
        });
      } else {
        res.status(404).json({
          success: false,
          error: `Route '${req.params.name}' not found`
        });
      }
    });
    
    return router;
  }
}

module.exports = RouteLoader;