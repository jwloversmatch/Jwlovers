const express = require("express");
const fs = require("fs");
const path = require("path");

class RouteLoader {
  constructor(app, logger) {
    this.app = app;
    this.logger = logger;
    this.loadedRoutes = {};
  }

  loadRoute(routePath, routerPath, routeName, dependencies = {}) {
    try {
      const fullPath = path.join(process.cwd(), routerPath);

      if (!fs.existsSync(fullPath)) {
        this.logger.warn(`⚠️ ${routeName} route file not found: ${fullPath}`);
        this.createPlaceholderRoute?.(routePath, routeName, routerPath);
        return false;
      }

      // Clear require cache
      const resolvedPath = require.resolve(fullPath);
      delete require.cache[resolvedPath];

      // Load the module
      const routeModule = require(fullPath);

      // Extract router safely
      const router = this.safeExtractRouter(
        routeModule,
        dependencies,
        fullPath
      );

      this.app.use(routePath, router);
      this.logger.info(`✅ ${routeName} routes mounted at ${routePath}`);
      this.loadedRoutes[routeName] = true;
      return true;

    } catch (error) {
      this.logger.error(`❌ ${routeName} routes failed:`, error);

      this.loadedRoutes[routeName] = false;

      // Fallback error route (FIXED)
      const errorRouter = express.Router();

      // ✅ Valid wildcard handler
      errorRouter.use((req, res) => {
        res.status(503).json({
          success: false,
          service: routeName,
          error: "Route loading failed",
          message: `${routeName} API temporarily unavailable`
        });
      });

      this.app.use(routePath, errorRouter);
      return false;
    }
  }

  safeExtractRouter(module, dependencies, filePath) {
    const extractors = [
      // 1. Function returning router
      (m) => (typeof m === "function" ? m(dependencies) : null),

      // 2. Express router instance
      (m) =>
        m &&
        typeof m === "function" &&
        m.stack &&
        typeof m.use === "function"
          ? m
          : null,

      // 3. ES module default export
      (m) =>
        m?.default
          ? this.safeExtractRouter(m.default, dependencies, filePath)
          : null,

      // 4. Module with .router
      (m) => (m?.router ? m.router : null)
    ];

    for (const extractor of extractors) {
      try {
        const result = extractor(module);
        if (result && typeof result.use === "function") {
          return result;
        }
      } catch {
        // ignore and continue
      }
    }

    // Absolute last-resort router
    const router = express.Router();
    router.get("/", (req, res) => {
      res.json({
        success: true,
        message: "Fallback route loaded",
        file: path.basename(filePath)
      });
    });

    return router;
  }

  loadAllRoutes(routeDefinitions, dependencies = {}) {
    this.logger.info("📦 Loading routes...");

    routeDefinitions.forEach(({ path, file, name, deps }) => {
      const routeDeps = { ...dependencies, ...deps };
      this.loadRoute(path, file, name, routeDeps);
    });

    return this.loadedRoutes;
  }
}

module.exports = RouteLoader;
