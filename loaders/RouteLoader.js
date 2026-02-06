// routes/loaders/RouteLoader.js
const express = require("express");
const fs = require("fs");
const path = require("path");

// Register module aliases at the TOP before any imports
require("module-alias/register");

// Optional: Programmatic alias configuration for extra safety
try {
  const moduleAlias = require('module-alias');
  const projectRoot = path.join(__dirname, '..');
  
  moduleAlias.addAliases({
    '@middleware': path.join(projectRoot, 'middleware'),
    '@controllers': path.join(projectRoot, 'controllers'),
    '@models': path.join(projectRoot, 'models'),
    '@services': path.join(projectRoot, 'services'),
    '@utils': path.join(projectRoot, 'utils'),
    '@config': path.join(projectRoot, 'config')
  });
} catch (error) {
  console.warn('⚠️ Module alias configuration warning:', error.message);
}

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
    console.log(`\n🚀 [LOAD ROUTE START] ${routeName}`);
    console.log(`   Path: ${routePath}`);
    console.log(`   File: ${routerPath}`);
    console.log(`   Dependencies: ${Object.keys(dependencies).join(', ')}`);
    
    this.routeMetrics.total++;
    
    try {
      const fullPath = path.join(process.cwd(), routerPath);
      console.log(`   Full path: ${fullPath}`);
      console.log(`   File exists? ${fs.existsSync(fullPath)}`);
      
      // Check if route file exists
      if (!fs.existsSync(fullPath)) {
        this.routeMetrics.warnings++;
        this.logger.warn(`⚠️ ${routeName} route file not found: ${fullPath}`);
        
        // Try alternative paths
        const alternativePaths = [
          path.join(__dirname, '..', routerPath),
          path.join(process.cwd(), 'server', routerPath),
          path.join(process.cwd(), routerPath)
        ];
        
        for (const altPath of alternativePaths) {
          if (fs.existsSync(altPath)) {
            console.log(`   Found alternative path: ${altPath}`);
            fullPath = altPath;
            break;
          }
        }
        
        if (!fs.existsSync(fullPath)) {
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
      }

      // Clear require cache for hot reload in development
      this.clearModuleCache(fullPath);

      // Load the module with detailed error handling
      console.log(`   Attempting to require module...`);
      let routeModule;
      try {
        routeModule = require(fullPath);
        console.log(`   ✅ Module loaded successfully`);
        console.log(`   Module type: ${typeof routeModule}`);
      } catch (requireError) {
        console.error(`   ❌ Module require failed: ${requireError.message}`);
        
        // Special handling for module not found errors
        if (requireError.code === 'MODULE_NOT_FOUND') {
          const missingModule = requireError.message.split("'")[1] || 'unknown';
          console.error(`   Missing module: ${missingModule}`);
          console.error(`   Require stack:`);
          if (requireError.requireStack) {
            requireError.requireStack.forEach((stackLine, i) => {
              console.error(`     ${i + 1}. ${stackLine}`);
            });
          }
        }
        
        throw requireError;
      }

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
      console.log(`   ✅ ${routeName} mounted with ${routeCount} endpoints\n`);
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
      
      // Detailed error logging
      console.error(`\n❌❌❌ ${routeName} ROUTE LOADING FAILED ❌❌❌`);
      console.error(`File: ${routerPath}`);
      console.error(`Error: ${error.message}`);
      console.error(`Error code: ${error.code || 'N/A'}`);
      console.error(`Stack trace:`);
      console.error(error.stack);
      
      this.logger.error(`❌ ${routeName} routes failed: ${error.message}`);
      
      // Create error router as fallback
      const errorRouter = this.createErrorRouter(routeName, error);
      this.app.use(routePath, errorRouter);
      
      this.loadedRoutes[routeName] = { 
        success: false, 
        error: error.message,
        errorCode: error.code,
        stack: error.stack?.split('\n')[0],
        path: routePath,
        timestamp: new Date().toISOString()
      };
      
      return false;
    }
  }

  extractRouterWithDeps(module, dependencies, filePath, routeName) {
    console.log(`\n🔍 [DEBUG] Processing ${routeName}`);
    console.log(`📁 File: ${filePath}`);
    console.log(`📦 Module type: ${typeof module}`);
    
    // Log all properties to understand what we have
    if (module) {
      console.log(`🔧 Module properties (first 10):`);
      const properties = Object.getOwnPropertyNames(module).slice(0, 10);
      properties.forEach(prop => {
        const value = module[prop];
        console.log(`   ${prop}: ${typeof value} ${value instanceof Function ? '[Function]' : ''}`);
      });
      
      if (Object.getOwnPropertyNames(module).length > 10) {
        console.log(`   ... and ${Object.getOwnPropertyNames(module).length - 10} more properties`);
      }
      
      // Check for router specific properties
      console.log(`🎯 Router checks:`);
      console.log(`   has 'use' method? ${typeof module.use === 'function'}`);
      console.log(`   has 'get' method? ${typeof module.get === 'function'}`);
      console.log(`   has 'post' method? ${typeof module.post === 'function'}`);
      console.log(`   has 'stack' property? ${module.stack !== undefined}`);
      console.log(`   stack is array? ${Array.isArray(module.stack)}`);
    }
    
    // Extractors in priority order
    const extractors = [
      // 1. Direct Express Router (function with router properties)
      (m) => {
        if (m && typeof m === "function") {
          const hasRouterMethods = 
            typeof m.use === "function" &&
            typeof m.get === "function" &&
            typeof m.post === "function";
          
          if (hasRouterMethods && m.stack) {
            console.log(`✅ ${routeName}: Direct Express router`);
            return m;
          }
        }
        return null;
      },
      
      // 2. Router object (object with use method)
      (m) => {
        if (m && typeof m === "object" && typeof m.use === "function") {
          console.log(`✅ ${routeName}: Router object`);
          return m;
        }
        return null;
      },
      
      // 3. Factory function
      (m) => {
        if (typeof m === "function") {
          console.log(`🔄 ${routeName}: Trying as factory function`);
          try {
            const result = m(dependencies);
            console.log(`   Factory returned: ${typeof result}`);
            
            // If factory returned a router
            if (result && typeof result.use === "function") {
              console.log(`✅ ${routeName}: Factory returned router`);
              return result;
            }
            
            // If factory returned another function
            if (typeof result === "function") {
              console.log(`🔄 ${routeName}: Factory returned function, trying nested call`);
              const nestedResult = result(dependencies);
              if (nestedResult && typeof nestedResult.use === "function") {
                console.log(`✅ ${routeName}: Nested factory returned router`);
                return nestedResult;
              }
            }
          } catch (error) {
            console.error(`❌ ${routeName}: Factory error: ${error.message}`);
          }
        }
        return null;
      },
      
      // 4. ES Module default export
      (m) => {
        if (m && m.default) {
          console.log(`🔄 ${routeName}: ES module, checking default export`);
          return this.extractRouterWithDeps(m.default, dependencies, filePath, routeName);
        }
        return null;
      },
      
      // 5. Module with .router property
      (m) => {
        if (m && m.router && typeof m.router.use === "function") {
          console.log(`✅ ${routeName}: Loaded via .router property`);
          return m.router;
        }
        return null;
      }
    ];
    
    for (let i = 0; i < extractors.length; i++) {
      const extractor = extractors[i];
      try {
        const result = extractor(module);
        if (result && typeof result.use === "function") {
          console.log(`🎉 ${routeName}: Successfully extracted router (extractor ${i + 1})\n`);
          return result;
        }
      } catch (error) {
        console.error(`⚠️ ${routeName}: Extractor ${i + 1} error: ${error.message}`);
      }
    }
    
    console.log(`❌ ${routeName}: No router found, creating minimal router\n`);
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
      
      // Also clear based on path pattern for aliases
      Object.keys(require.cache).forEach(cacheKey => {
        if (cacheKey.includes(modulePath) || cacheKey.includes(path.basename(modulePath))) {
          delete require.cache[cacheKey];
        }
      });
    } catch (error) {
      console.warn(`⚠️ Cache clearing warning for ${modulePath}: ${error.message}`);
    }
  }

  validateRouter(router, routeName) {
    if (!router || typeof router.use !== "function") {
      this.logger.error(`❌ ${routeName}: Invalid router - missing use() method`);
      console.error(`❌ ${routeName} validation: Not a valid router`);
      return false;
    }

    if (!router.stack || !Array.isArray(router.stack)) {
      this.logger.warn(`⚠️ ${routeName}: Router has empty stack`);
      console.warn(`⚠️ ${routeName} validation: Empty router stack`);
      return false;
    }

    console.log(`✅ ${routeName}: Router validation passed`);
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
        timestamp: new Date().toISOString(),
        help: "Check if the route file exists and has proper exports"
      });
    });
    
    router.all("*", (req, res) => {
      res.status(404).json({
        success: false,
        service: routeName,
        message: "Endpoint not available",
        path: req.path,
        method: req.method,
        status: "route_file_missing"
      });
    });
    
    return router;
  }

  createErrorRouter(routeName, error) {
    const router = express.Router();
    
    router.use((req, res, next) => {
      const errorResponse = {
        success: false,
        service: routeName,
        error: "Route loading failed",
        message: `${routeName} API temporarily unavailable`,
        details: error.message,
        errorCode: error.code,
        timestamp: new Date().toISOString(),
        path: req.path
      };
      
      // Include stack trace in development
      if (process.env.NODE_ENV === 'development') {
        errorResponse.stack = error.stack?.split('\n').slice(0, 5);
      }
      
      res.status(503).json(errorResponse);
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
        timestamp: new Date().toISOString(),
        status: "minimal_router"
      });
    });
    
    router.get("/health", (req, res) => {
      res.json({
        success: true,
        service: routeName,
        status: "operational",
        mode: "minimal",
        timestamp: new Date().toISOString()
      });
    });
    
    router.all("*", (req, res) => {
      res.status(501).json({
        success: false,
        service: routeName,
        message: "Endpoint not implemented",
        path: req.path,
        method: req.method,
        note: "This route is running in minimal mode due to loading issues"
      });
    });
    
    return router;
  }

  loadAllRoutes(routeDefinitions, globalDependencies = {}) {
    console.log(`\n📦 [ROUTE LOADER] Starting to load ${routeDefinitions.length} routes...`);
    this.logger.info("📦 Loading application routes...");
    
    const results = routeDefinitions.map(({ path, file, name, deps = {} }) => {
      console.log(`\n📋 [ROUTE DEFINITION] ${name}`);
      console.log(`   Mount path: ${path}`);
      console.log(`   File: ${file}`);
      console.log(`   Dependencies: ${Object.keys(deps).join(', ')}`);
      
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
    
    // Also console log summary for immediate visibility
    this.consoleLogRouteSummary(results);
    
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
        const routeInfo = this.loadedRoutes[route.name];
        const errorDetails = routeInfo?.error || 'Unknown error';
        this.logger.warn(`   - ${route.name}: ${route.path} (${route.file}) - ${errorDetails}`);
      });
    }
    
    this.logger.info("=".repeat(60));
  }

  consoleLogRouteSummary(results) {
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📊 [ROUTE LOADER SUMMARY]`);
    console.log(`${'='.repeat(70)}`);
    console.log(`✅ Successful: ${successful}/${results.length}`);
    
    if (failed > 0) {
      console.log(`❌ Failed: ${failed}/${results.length}`);
      results.filter(r => !r.success).forEach(route => {
        const routeInfo = this.loadedRoutes[route.name];
        const errorDetails = routeInfo?.error || 'Unknown error';
        const errorCode = routeInfo?.errorCode || 'NO_CODE';
        console.log(`   - ${route.name}:`);
        console.log(`       Path: ${route.path}`);
        console.log(`       File: ${route.file}`);
        console.log(`       Error: ${errorDetails}`);
        console.log(`       Code: ${errorCode}`);
      });
    }
    
    console.log(`${'='.repeat(70)}\n`);
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
        environment: process.env.NODE_ENV,
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
          error: `Route '${req.params.name}' not found`,
          availableRoutes: Object.keys(this.loadedRoutes)
        });
      }
    });
    
    router.get("/routes/:name/debug", (req, res) => {
      const routeInfo = this.getRouteInfo(req.params.name);
      if (routeInfo) {
        // Try to get more debug info
        const filePath = path.join(process.cwd(), routeInfo.file || '');
        const exists = fs.existsSync(filePath);
        
        res.json({
          success: true,
          route: routeInfo,
          debug: {
            fileExists: exists,
            filePath: filePath,
            currentDir: process.cwd(),
            moduleAliases: require('module-alias')._aliases
          }
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

  // Helper method to test individual route loading
  testRouteLoad(routerPath, routeName, dependencies = {}) {
    console.log(`\n🧪 [ROUTE TEST] Testing ${routeName}`);
    console.log(`   File: ${routerPath}`);
    
    const fullPath = path.join(process.cwd(), routerPath);
    
    if (!fs.existsSync(fullPath)) {
      console.log(`   ❌ File not found: ${fullPath}`);
      return { success: false, error: 'File not found' };
    }
    
    try {
      // Test module resolution
      console.log(`   Testing module resolution...`);
      const resolved = require.resolve(fullPath);
      console.log(`   ✅ Module resolved: ${resolved}`);
      
      // Test require
      console.log(`   Testing require...`);
      const module = require(fullPath);
      console.log(`   ✅ Module loaded, type: ${typeof module}`);
      
      // Test router extraction
      console.log(`   Testing router extraction...`);
      const router = this.extractRouterWithDeps(module, dependencies, fullPath, routeName);
      
      if (router && typeof router.use === 'function') {
        console.log(`   ✅ Router extracted successfully`);
        return { success: true, router, module };
      } else {
        console.log(`   ❌ Failed to extract router`);
        return { success: false, error: 'No router extracted' };
      }
    } catch (error) {
      console.log(`   ❌ Test failed: ${error.message}`);
      return { success: false, error: error.message, stack: error.stack };
    }
  }
}

module.exports = RouteLoader;