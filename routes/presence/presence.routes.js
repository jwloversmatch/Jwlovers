const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, param, validationResult, query } = require('express-validator');

// Import middleware
const { protect, adminOnly, optionalAuth } = require('@middleware/authmiddleware');
const presenceController = require('@controllers/presence.controller');

// Import enhanced rate limiter middleware
const {
  apiLimiter,
  createDynamicRateLimiter,
  rateLimitInfoMiddleware
} = require('@middleware/rateLimit');

// Import logger
const logger = require('@utils/logger');

// ========== CUSTOM PRESENCE RATE LIMITERS ==========

// Heartbeat rate limiter (frequent updates)
const heartbeatLimiter = createDynamicRateLimiter({
  windowMs: 30 * 1000,
  max: 10,
  keyGenerator: (req) => {
    const userId = req.userId || req.user?.id;
    return userId ? `presence:heartbeat:user:${userId}` : `presence:heartbeat:ip:${req.ip}`;
  },
  message: 'Too many heartbeat updates. Please slow down.'
});

// Status update limiter
const statusUpdateLimiter = createDynamicRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => {
    const userId = req.userId || req.user?.id;
    return userId ? `presence:status:user:${userId}` : `presence:status:ip:${req.ip}`;
  },
  message: 'Too many status updates. Please wait before changing status again.'
});

// Bulk operations limiter
const bulkPresenceLimiter = createDynamicRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const userId = req.userId || req.user?.id;
    return userId ? `presence:bulk:user:${userId}` : `presence:bulk:ip:${req.ip}`;
  },
  message: 'Too many bulk presence operations. Please slow down.'
});

// Online users query limiter
const onlineQueryLimiter = createDynamicRateLimiter({
  windowMs: 10 * 1000,
  max: 30,
  keyGenerator: (req) => {
    const userId = req.userId || req.user?.id;
    return userId ? `presence:online:user:${userId}` : `presence:online:ip:${req.ip}`;
  },
  message: 'Too many online user queries. Please reduce polling frequency.'
});

// User presence lookup limiter
const userPresenceLimiter = createDynamicRateLimiter({
  windowMs: 30 * 1000,
  max: 50,
  keyGenerator: (req) => {
    const userId = req.userId || req.user?.id;
    const targetUserId = req.params?.userId;
    
    if (userId && targetUserId) {
      return `presence:lookup:user:${userId}:target:${targetUserId}`;
    }
    return userId ? `presence:lookup:user:${userId}` : `presence:lookup:ip:${req.ip}`;
  },
  message: 'Too many user presence lookups. Please cache results.'
});

// ========== MIDDLEWARE ORDER ==========
router.use(rateLimitInfoMiddleware);
router.use(apiLimiter);

// Request ID middleware (if not already added globally)
router.use((req, res, next) => {
  if (!req.requestId) {
    req.requestId = req.headers['x-request-id'] || `presence-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  next();
});

// Logging middleware for presence API
router.use((req, res, next) => {
  const start = Date.now();
  
  // Log request (except health checks)
  if (req.path !== '/health') {
    logger.debug(`Presence API: ${req.method} ${req.path}`, {
      requestId: req.requestId,
      userId: req.userId || req.user?.id,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
  }
  
  // Add response logging
  const originalSend = res.send;
  const originalJson = res.json;
  
  res.send = function(body) {
    const duration = Date.now() - start;
    
    if (req.path !== '/health') {
      logger.debug(`Presence API Response: ${req.method} ${req.path} ${res.statusCode} ${duration}ms`, {
        requestId: req.requestId,
        statusCode: res.statusCode,
        duration,
        userId: req.userId || req.user?.id
      });
    }
    
    return originalSend.call(this, body);
  };
  
  res.json = function(body) {
    const duration = Date.now() - start;
    
    if (req.path !== '/health') {
      logger.debug(`Presence API Response: ${req.method} ${req.path} ${res.statusCode} ${duration}ms`, {
        requestId: req.requestId,
        statusCode: res.statusCode,
        duration,
        userId: req.userId || req.user?.id
      });
    }
    
    return originalJson.call(this, body);
  };
  
  next();
});

// ========== VALIDATION MIDDLEWARE ==========
const validateObjectId = (req, res, next) => {
  const { userId } = req.params;
  
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID format',
      code: 'INVALID_USER_ID',
      providedId: userId
    });
  }
  
  next();
};

// ========== PRESENCE HEALTH CHECK (PUBLIC) ==========
router.get('/health', 
  createDynamicRateLimiter({
    windowMs: 30 * 1000,
    max: 10,
    message: 'Too many health checks.'
  }),
  presenceController.healthCheck
);

// ========== PROTECTED ROUTES (Require Authentication) ==========
// NOTE: All routes below this point require authentication

// Apply protect middleware to all following routes
router.use(protect);

// ========== BATCH OPERATIONS ==========
router.post('/batch',
  bulkPresenceLimiter,
  [
    body('userIds')
      .isArray()
      .withMessage('userIds must be an array')
      .isLength({ min: 1, max: 100 })
      .withMessage('Must request between 1 and 100 user IDs'),
    body('userIds.*')
      .isMongoId()
      .withMessage('Each userId must be a valid MongoDB ID'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
          code: 'VALIDATION_ERROR'
        });
      }
      next();
    }
  ],
  presenceController.getOnlineStatus
);

// ========== USER LISTS ==========
router.get('/recent',
  onlineQueryLimiter,
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
      .toInt(),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be a positive integer')
      .toInt(),
    query('status')
      .optional()
      .isIn(['online', 'offline', 'all'])
      .withMessage('Status must be online, offline, or all'),
    query('userType')
      .optional()
      .isIn(['all', 'dating', 'staff', 'moderator', 'admin', 'superadmin'])
      .withMessage('Invalid user type'),
    query('sort')
      .optional()
      .isIn(['lastSeen', 'online', 'name'])
      .withMessage('Sort must be lastSeen, online, or name'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
          code: 'VALIDATION_ERROR'
        });
      }
      next();
    }
  ],
  presenceController.getActiveUsers
);

// Get online users only
router.get('/online',
  onlineQueryLimiter,
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
      .toInt(),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be a positive integer')
      .toInt(),
    query('userType')
      .optional()
      .isIn(['all', 'dating', 'staff'])
      .withMessage('Invalid user type'),
    query('nearby')
      .optional()
      .isBoolean()
      .withMessage('Nearby must be true or false')
      .toBoolean(),
    query('radius')
      .optional()
      .isFloat({ min: 1, max: 100 })
      .withMessage('Radius must be between 1 and 100 km')
      .toFloat(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
          code: 'VALIDATION_ERROR'
        });
      }
      next();
    }
  ],
  async (req, res) => {
    try {
      // Set status filter to 'online' for this endpoint
      req.query.status = 'online';
      await presenceController.getActiveUsers(req, res);
    } catch (error) {
      logger.error('Error in /online endpoint:', {
        error: error.message,
        requestId: req.requestId,
        userId: req.userId
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to get online users',
        error: error.message,
        code: 'ONLINE_USERS_ERROR',
        requestId: req.requestId
      });
    }
  }
);

// Get nearby online users (for dating app)
router.get('/nearby',
  onlineQueryLimiter,
  protect,
  [
    query('radius')
      .optional()
      .isFloat({ min: 1, max: 50 })
      .withMessage('Radius must be between 1 and 50 km')
      .toFloat(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage('Limit must be between 1 and 50')
      .toInt(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
          code: 'VALIDATION_ERROR'
        });
      }
      next();
    }
  ],
  async (req, res) => {
    try {
      const userId = req.userId || req.user?.id;
      const radius = parseFloat(req.query.radius) || 10;
      const limit = parseInt(req.query.limit) || 25;
      
      // Call controller method for nearby users
      if (presenceController.getNearbyOnlineUsers) {
        await presenceController.getNearbyOnlineUsers(req, res);
      } else {
        // Fallback implementation
        const onlineUsers = await presenceController.getOnlineUsers(limit, 0, 'dating');
        
        // Filter by location if user has location data
        // This is a simplified version - you'd need real geospatial logic
        res.json({
          success: true,
          count: onlineUsers.length,
          radius,
          limit,
          users: onlineUsers,
          timestamp: new Date().toISOString(),
          requestId: req.requestId
        });
      }
    } catch (error) {
      logger.error('Error in /nearby endpoint:', {
        error: error.message,
        requestId: req.requestId,
        userId: req.userId
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to get nearby online users',
        code: 'NEARBY_USERS_ERROR',
        requestId: req.requestId
      });
    }
  }
);

// ========== STATISTICS ==========
router.get('/stats',
  createDynamicRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too many stats requests. Please cache results.'
  }),
  presenceController.getPresenceStats
);

// ========== CURRENT USER PRESENCE ==========
router.get('/me',
  createDynamicRateLimiter({
    windowMs: 10 * 1000,
    max: 20,
    message: 'Too many self-presence requests.'
  }),
  presenceController.getCurrentUserPresence
);

router.put('/me/status',
  statusUpdateLimiter,
  [
    body('status')
      .optional()
      .isIn(['online', 'away', 'busy', 'offline', 'dnd', 'invisible'])
      .withMessage('Status must be one of: online, away, busy, offline, dnd, invisible'),
    body('customStatus')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Custom status must be less than 100 characters'),
    body('expiresAt')
      .optional()
      .isISO8601()
      .withMessage('Expires at must be a valid ISO date')
      .custom((value) => {
        const expiry = new Date(value);
        const now = new Date();
        const maxExpiry = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)); // 1 week max
        return expiry > now && expiry <= maxExpiry;
      })
      .withMessage('Expiry must be between now and 1 week from now'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
          code: 'VALIDATION_ERROR'
        });
      }
      next();
    }
  ],
  presenceController.updateStatus
);

router.patch('/me/heartbeat',
  heartbeatLimiter,
  presenceController.updateLastSeen
);

router.patch('/me/offline',
  createDynamicRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: 'Too many offline status updates.'
  }),
  [
    body('force')
      .optional()
      .isBoolean()
      .withMessage('Force must be a boolean')
      .toBoolean(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
          code: 'VALIDATION_ERROR'
        });
      }
      next();
    }
  ],
  async (req, res) => {
    try {
      // Call updateStatus with offline status
      req.body = { status: 'offline', ...req.body };
      await presenceController.updateStatus(req, res);
    } catch (error) {
      logger.error('Error in /me/offline endpoint:', {
        error: error.message,
        requestId: req.requestId,
        userId: req.userId
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to set offline status',
        code: 'OFFLINE_ERROR',
        requestId: req.requestId
      });
    }
  }
);

// ========== BULK OPERATIONS ==========
// Mark multiple users offline (admin/staff)
router.post('/bulk-offline',
  bulkPresenceLimiter,
  protect,
  adminOnly,
  [
    body('userIds')
      .isArray()
      .withMessage('userIds must be an array')
      .isLength({ min: 1, max: 50 })
      .withMessage('Must mark between 1 and 50 users offline'),
    body('userIds.*')
      .isMongoId()
      .withMessage('Each userId must be a valid MongoDB ID'),
    body('reason')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 200 })
      .withMessage('Reason must be less than 200 characters'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
          code: 'VALIDATION_ERROR'
        });
      }
      next();
    }
  ],
  async (req, res) => {
    try {
      const { userIds, reason } = req.body;
      
      // If controller has method, use it
      if (presenceController.markMultipleUsersOffline) {
        return await presenceController.markMultipleUsersOffline(req, res);
      }
      
      // Otherwise handle manually
      const results = [];
      const errors = [];
      
      for (const userId of userIds) {
        try {
          // You'd need to call your presence service here
          // This is a placeholder implementation
          results.push({
            userId,
            success: true,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          errors.push({
            userId,
            error: error.message
          });
        }
      }
      
      res.json({
        success: true,
        processed: userIds.length,
        succeeded: results.length,
        failed: errors.length,
        results,
        errors: errors.length > 0 ? errors : undefined,
        reason,
        timestamp: new Date().toISOString(),
        requestId: req.requestId
      });
    } catch (error) {
      logger.error('Error in /bulk-offline endpoint:', {
        error: error.message,
        requestId: req.requestId,
        userId: req.userId
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to mark users offline',
        code: 'BULK_OFFLINE_ERROR',
        requestId: req.requestId
      });
    }
  }
);

// ========== ADMIN ROUTES ==========
router.delete('/cache',
  createDynamicRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 3,
    message: 'Too many cache clear requests. Please wait.'
  }),
  adminOnly,
  [
    query('userId')
      .optional()
      .isMongoId()
      .withMessage('userId must be a valid MongoDB ID'),
    query('scope')
      .optional()
      .isIn(['user', 'all', 'stale'])
      .withMessage('Scope must be user, all, or stale'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
          code: 'VALIDATION_ERROR'
        });
      }
      next();
    }
  ],
  presenceController.clearPresenceCache
);

router.post('/admin/cleanup',
  createDynamicRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 2,
    message: 'Too many cleanup requests. Please wait.'
  }),
  adminOnly,
  [
    query('thresholdMinutes')
      .optional()
      .isInt({ min: 1, max: 1440 })
      .withMessage('Threshold must be between 1 and 1440 minutes')
      .toInt(),
    query('dryRun')
      .optional()
      .isBoolean()
      .withMessage('Dry run must be a boolean')
      .toBoolean(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
          code: 'VALIDATION_ERROR'
        });
      }
      next();
    }
  ],
  presenceController.cleanupStalePresence
);

router.get('/admin/metrics',
  createDynamicRateLimiter({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Too many metrics requests.'
  }),
  adminOnly,
  presenceController.getPresenceMetrics
);

router.get('/admin/connections',
  createDynamicRateLimiter({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Too many connection stats requests.'
  }),
  adminOnly,
  presenceController.getConnectionStats
);

// ========== USER-SPECIFIC ROUTES ==========
router.get('/user/:userId',
  userPresenceLimiter,
  validateObjectId,
  [
    param('userId')
      .isMongoId()
      .withMessage('Valid user ID is required'),
    query('detailed')
      .optional()
      .isBoolean()
      .withMessage('Detailed must be true or false')
      .toBoolean(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
          code: 'VALIDATION_ERROR'
        });
      }
      next();
    }
  ],
  presenceController.getUserPresence
);

// Last seen endpoint
router.get('/user/:userId/last-seen',
  userPresenceLimiter,
  validateObjectId,
  [
    param('userId')
      .isMongoId()
      .withMessage('Valid user ID is required'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
          code: 'VALIDATION_ERROR'
        });
      }
      next();
    }
  ],
  async (req, res) => {
    try {
      // Call getUserPresence but return only lastSeen info
      await presenceController.getUserPresence(req, res);
      
      // Modify response to only include lastSeen
      if (res.headersSent) return;
      
      const originalJson = res.json;
      res.json = function(data) {
        if (data.success && data.data) {
          const { lastSeen, isOnline, status } = data.data;
          const modifiedData = {
            success: true,
            data: {
              userId: req.params.userId,
              lastSeen,
              isOnline,
              status,
              timestamp: new Date().toISOString()
            },
            requestId: data.requestId || req.requestId
          };
          return originalJson.call(this, modifiedData);
        }
        return originalJson.call(this, data);
      };
    } catch (error) {
      logger.error('Error in /user/:userId/last-seen endpoint:', {
        error: error.message,
        requestId: req.requestId,
        userId: req.userId,
        targetUserId: req.params.userId
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to get last seen time',
        code: 'LAST_SEEN_ERROR',
        requestId: req.requestId
      });
    }
  }
);

// ========== INFORMATION ENDPOINTS ==========
router.get('/rate-limit/status', 
  createDynamicRateLimiter({
    windowMs: 30 * 1000,
    max: 10,
    message: 'Too many rate limit status requests.'
  }),
  (req, res) => {
    // Get rate limit headers
    const getHeader = (header) => {
      const value = res.getHeader(header);
      return value !== undefined ? value.toString() : 'N/A';
    };
    
    res.json({
      success: true,
      service: 'presence-api',
      user: {
        id: req.userId || req.user?.id,
        authenticated: true
      },
      rateLimiting: {
        general: {
          limit: 100,
          window: "15 minutes",
          description: "General API requests"
        },
        heartbeat: {
          limit: 10,
          window: "30 seconds",
          description: "Heartbeat updates (frequent)"
        },
        status: {
          limit: 20,
          window: "1 minute",
          description: "Status updates"
        },
        bulk: {
          limit: 5,
          window: "1 minute",
          description: "Bulk presence operations"
        },
        online: {
          limit: 30,
          window: "10 seconds",
          description: "Online user queries (high frequency)"
        },
        lookup: {
          limit: 50,
          window: "30 seconds",
          description: "User presence lookups"
        }
      },
      recommendations: [
        "Use WebSocket for real-time presence updates",
        "Cache presence results for frequently queried users",
        "Use batch endpoints for multiple user presence checks",
        "Implement client-side polling with exponential backoff",
        "For dating apps: Use /nearby endpoint for location-based queries"
      ],
      currentIp: req.ip,
      requestId: req.requestId,
      headers: {
        'X-RateLimit-Limit': getHeader('X-RateLimit-Limit'),
        'X-RateLimit-Remaining': getHeader('X-RateLimit-Remaining'),
        'X-RateLimit-Reset': getHeader('X-RateLimit-Reset')
      }
    });
  }
);

// ========== PRESENCE WEBSOCKET INFO ==========
router.get('/ws-info',
  createDynamicRateLimiter({
    windowMs: 60 * 1000,
    max: 20,
    message: 'Too many WebSocket info requests.'
  }),
  (req, res) => {
    const wsEnabled = process.env.WS_ENABLED === 'true';
    const wsPath = process.env.WS_PATH || '/socket.io';
    const wsUrl = `${req.protocol === 'https' ? 'wss' : 'ws'}://${req.headers.host}${wsPath}`;
    
    res.json({
      success: true,
      webSocket: {
        enabled: wsEnabled,
        endpoint: wsPath,
        fullUrl: wsUrl,
        events: {
          'presence:update': 'User presence status changed',
          'user:online': 'User came online',
          'user:offline': 'User went offline',
          'presence:heartbeat': 'Heartbeat acknowledgment',
          'typing:start': 'User started typing',
          'typing:stop': 'User stopped typing',
          'message:received': 'New message received'
        },
        authentication: 'Bearer token in handshake',
        rateLimiting: 'Socket-level rate limiting applied'
      },
      httpFallback: {
        recommendedPollingInterval: 30000,
        maxPollingInterval: 60000,
        backoffStrategy: 'exponential with jitter',
        endpoints: {
          heartbeat: 'PATCH /api/presence/me/heartbeat',
          status: 'PUT /api/presence/me/status',
          onlineUsers: 'GET /api/presence/online',
          batchCheck: 'POST /api/presence/batch'
        }
      },
      clientImplementation: {
        javascript: {
          socketIo: 'Use socket.io-client with auth token',
          example: `import { io } from 'socket.io-client';\nconst socket = io('${wsUrl}', {\n  auth: { token: 'YOUR_JWT_TOKEN' }\n});`
        },
        reactNative: 'Use socket.io-client with appropriate transport',
        flutter: 'Use socket_io_client package'
      }
    });
  }
);

// ========== DEBUG ENDPOINT (Development only) ==========
if (process.env.NODE_ENV === 'development') {
  router.get('/debug/auth-test',
    createDynamicRateLimiter({
      windowMs: 30 * 1000,
      max: 5,
      message: 'Too many debug requests.'
    }),
    (req, res) => {
      logger.debug('Debug auth test request', {
        requestId: req.requestId,
        userId: req.userId,
        user: req.user,
        ip: req.ip
      });
      
      res.json({
        success: true,
        authentication: {
          userId: req.userId,
          user: req.user,
          authenticated: !!req.userId,
          userType: req.user?.userType,
          role: req.user?.role
        },
        headers: {
          authorization: req.headers.authorization ? 'Present' : 'Missing',
          contentType: req.headers['content-type'],
          userAgent: req.headers['user-agent']
        },
        ip: req.ip,
        requestId: req.requestId,
        environment: process.env.NODE_ENV,
        service: 'presence-api'
      });
    }
  );
}

// ========== ERROR HANDLING ==========
router.use((err, req, res, next) => {
  const requestId = req.requestId;
  
  logger.error('Presence route error:', {
    requestId,
    path: req.path,
    method: req.method,
    userId: req.userId || req.user?.id,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  if (err.name === 'RateLimitError') {
    return res.status(429).json({
      success: false,
      error: err.message,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(err.msBeforeNext / 1000),
      recommendation: 'Consider using WebSocket for real-time presence updates',
      requestId
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err.errors || err.message,
      code: 'VALIDATION_ERROR',
      requestId
    });
  }

  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    return res.status(400).json({
      success: false,
      error: 'Invalid user ID format',
      code: 'INVALID_USER_ID',
      requestId
    });
  }

  // Authentication errors
  if (err.message && (err.message.includes('Authentication') || err.message.includes('Unauthorized')) || err.code === 'AUTH_REQUIRED') {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
      requestId
    });
  }

  // Authorization errors
  if (err.message && err.message.includes('permission') || err.code === 'FORBIDDEN') {
    return res.status(403).json({
      success: false,
      error: 'Insufficient permissions',
      code: 'FORBIDDEN',
      requestId
    });
  }

  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
    code: err.code || 'INTERNAL_SERVER_ERROR',
    service: 'presence-api',
    requestId,
    timestamp: new Date().toISOString()
  });
});

// 404 handler for presence routes
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Presence route ${req.method} ${req.originalUrl} not found`,
    code: 'PRESENCE_ENDPOINT_NOT_FOUND',
    requestId: req.requestId,
    availableEndpoints: [
      'GET    /health',
      'POST   /batch',
      'GET    /recent',
      'GET    /online',
      'GET    /nearby',
      'GET    /stats',
      'GET    /me',
      'PUT    /me/status',
      'PATCH  /me/heartbeat',
      'PATCH  /me/offline',
      'POST   /bulk-offline',
      'GET    /user/:userId',
      'GET    /user/:userId/last-seen',
      'GET    /rate-limit/status',
      'GET    /ws-info',
      'DELETE /cache (admin)',
      'POST   /admin/cleanup (admin)',
      'GET    /admin/metrics (admin)',
      'GET    /admin/connections (admin)'
    ].concat(process.env.NODE_ENV === 'development' ? ['GET    /debug/auth-test'] : []),
    authentication: {
      note: 'All endpoints except /health require authentication',
      method: 'Bearer token in Authorization header'
    },
    adminEndpoints: {
      note: 'Endpoints marked with (admin) require admin privileges'
    },
    documentation: 'See /ws-info for WebSocket integration details'
  });
});

module.exports = router;