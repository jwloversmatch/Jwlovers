const express = require("express");
const mongoose = require("mongoose");

const logger = require("../utils/logger");
const { ConversationServiceWrapper } = require("../services/ConversationService");

const router = express.Router();

router.get("/health", async (req, res) => {
  try {
    const dbState = mongoose.connection.readyState;
    const dbStates = ["disconnected", "connected", "connecting", "disconnecting"];

    let redisHealthy = false;
    let redisService = null;
    
    try {
      redisService = req.app.get("redisService");
      if (redisService && redisService.redisReady) {
        redisHealthy = await redisService.pubClient.ping() === "PONG";
      }
    } catch (error) {
      logger.error("Redis health check failed:", error);
    }

    const metrics = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      database: {
        state: dbStates[dbState],
        healthy: dbState === 1,
        connections: mongoose.connection.readyState === 1 ? 
          mongoose.connection.db.serverConfig.connections().length : 0
      },
      redis: {
        ready: redisService ? redisService.redisReady : false,
        healthy: redisHealthy,
        metrics: redisService ? redisService.getMetrics() : {},
        onlineUsers: redisService && redisService.redisReady ? 
          await redisService.pubClient.scard("online_users").catch(() => 0) : 0
      },
      encryption: {
        enabled: true,
        algorithm: "aes-256-gcm",
        keyDerivation: "PBKDF2",
        legacySupport: true
      },
      socket: {
        connections: req.app.get("io") ? req.app.get("io").engine.clientsCount : 0
      },
      process: {
        pid: process.pid,
        version: process.version,
        platform: process.platform,
        arch: process.arch
      }
    };

    res.json({
      status: "OK",
      service: "JW Lovers Chat API",
      version: "4.0.0",
      timestamp: new Date().toISOString(),
      ...metrics
    });
  } catch (error) {
    logger.error("Health check error:", error);
    res.status(500).json({
      status: "ERROR",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.get("/metrics", authMiddleware, async (req, res) => {
  try {
    const redisService = req.app.get("redisService");
    
    const metrics = {
      redis: redisService ? redisService.getMetrics() : {},
      process: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      },
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error("Metrics error:", error);
    res.status(500).json({ success: false, error: "Failed to get metrics" });
  }
});

const authMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ 
        success: false,
        error: "Authentication required" 
      });
    }

    const decoded = require("jsonwebtoken").verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ 
      success: false,
      error: "Invalid token" 
    });
  }
};

module.exports = router;