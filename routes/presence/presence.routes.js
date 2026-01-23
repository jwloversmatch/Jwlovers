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
  presenceController.healthCheck  // Use the controller method
);

// ========== PROTECTED ROUTES (Require Authentication) ==========
// NOTE: All routes below this point require authentication

// Apply protect middleware to all following routes
router.use(protect);

// ========== STATIC ROUTES ==========
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
          errors: errors.array()
        });
      }
      next();
    }
  ],
  presenceController.getOnlineStatus
);

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
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
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
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
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
      console.error('Error in /online endpoint:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get online users',
        error: error.message,
        code: 'ONLINE_USERS_ERROR'
      });
    }
  }
);

router.get('/stats',
  createDynamicRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too many stats requests. Please cache results.'
  }),
  presenceController.getPresenceStats
);

router.get('/me',
  createDynamicRateLimiter({
    windowMs: 10 * 1000,
    max: 20,
    message: 'Too many self-presence requests.'
  }),
  presenceController.getCurrentUserPresence
);

// FIXED: Using the correct controller method (updateStatus instead of updatePresenceStatus)
router.put('/me/status',
  statusUpdateLimiter,
  [
    body('status')
      .optional()
      .isIn(['online', 'away', 'busy', 'offline', 'dnd'])
      .withMessage('Status must be one of: online, away, busy, offline, dnd'),
    body('online')
      .optional()
      .isBoolean()
      .withMessage('Online must be a boolean'),
    body('customStatus')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Custom status must be less than 100 characters'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }
      next();
    }
  ],
  presenceController.updateStatus  // Updated to use updateStatus instead of updatePresenceStatus
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
  presenceController.markOffline
);

router.post('/bulk-offline',
  bulkPresenceLimiter,
  [
    body('userIds')
      .isArray()
      .withMessage('userIds must be an array')
      .isLength({ min: 1, max: 50 })
      .withMessage('Must mark between 1 and 50 users offline'),
    body('userIds.*')
      .isMongoId()
      .withMessage('Each userId must be a valid MongoDB ID'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }
      next();
    }
  ],
  // Note: You need to add batchUpdatePresence method which handles bulk operations
  presenceController.batchUpdatePresence  // Using batchUpdatePresence which handles bulk operations
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
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
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
          errors: errors.array()
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

// ========== DYNAMIC ROUTES ==========
router.get('/user/:userId',
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
          errors: errors.array()
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
          errors: errors.array()
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
            requestId: data.requestId
          };
          return originalJson.call(this, modifiedData);
        }
        return originalJson.call(this, data);
      };
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get last seen time',
        error: error.message,
        code: 'LAST_SEEN_ERROR'
      });
    }
  }
);

// ========== PRESENCE RATE LIMIT STATUS ==========
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
        "Implement client-side polling with exponential backoff"
      ],
      currentIp: req.ip,
      requestId: req.requestId || req.headers['x-request-id'],
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
    
    res.json({
      success: true,
      webSocket: {
        enabled: wsEnabled,
        endpoint: wsPath,
        events: {
          'user:status-update': 'User presence status changed',
          'user:online': 'User came online',
          'user:offline': 'User went offline',
          'presence:personal-update': 'Your own presence update',
          'user:typing': 'User typing indicator'
        },
        authentication: 'Bearer token required',
        rateLimiting: 'Socket-level rate limiting applied'
      },
      polling: {
        recommendedInterval: 30000,
        maxInterval: 60000,
        backoffMultiplier: 1.5,
        note: 'Consider using WebSocket for better performance'
      },
      clientImplementation: {
        javascript: {
          socketIo: 'Use socket.io-client with auth token',
          nativeWebSocket: 'Use WebSocket API with Bearer token in query'
        }
      },
      connection: {
        host: req.headers.host,
        protocol: req.protocol === 'https' ? 'wss' : 'ws',
        fullUrl: `${req.protocol === 'https' ? 'wss' : 'ws'}://${req.headers.host}${wsPath}`
      }
    });
  }
);

// ========== DEBUG ENDPOINT ==========
router.get('/debug/auth-test',
  createDynamicRateLimiter({
    windowMs: 30 * 1000,
    max: 5,
    message: 'Too many debug requests.'
  }),
  (req, res) => {
    console.log('=== DEBUG AUTH TEST ===');
    console.log('Headers:', req.headers);
    console.log('User ID:', req.userId);
    console.log('User:', req.user);
    
    res.json({
      success: true,
      authentication: {
        userId: req.userId,
        user: req.user,
        authenticated: !!req.userId
      },
      headers: {
        authorization: req.headers.authorization ? 'Present' : 'Missing',
        contentType: req.headers['content-type'],
        userAgent: req.headers['user-agent']
      },
      ip: req.ip,
      requestId: req.requestId || req.headers['x-request-id']
    });
  }
);

// ========== ERROR HANDLING ==========
router.use((err, req, res, next) => {
  const requestId = req.requestId || req.headers['x-request-id'];
  
  console.error('Presence route error:', {
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
  if (err.message && err.message.includes('Authentication') || err.code === 'AUTH_REQUIRED') {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
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
    requestId
  });
});

// 404 handler for presence routes
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Presence route ${req.method} ${req.originalUrl} not found`,
    code: 'PRESENCE_ENDPOINT_NOT_FOUND',
    requestId: req.requestId || req.headers['x-request-id'],
    availableEndpoints: [
      '/health',
      '/batch',
      '/recent',
      '/online',
      '/stats',
      '/me',
      '/me/status',
      '/me/heartbeat',
      '/me/offline',
      '/bulk-offline',
      '/user/:userId',
      '/user/:userId/last-seen',
      '/rate-limit/status',
      '/ws-info',
      '/debug/auth-test',
      '/admin/cleanup',
      '/admin/metrics',
      '/admin/connections'
    ],
    authentication: {
      note: 'All endpoints except /health require authentication',
      method: 'Bearer token in Authorization header'
    },
    adminEndpoints: {
      note: 'Endpoints marked with /admin/ require admin privileges'
    }
  });
});

module.exports = router;