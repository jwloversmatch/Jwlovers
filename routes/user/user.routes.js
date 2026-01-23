const express = require("express");
const router = express.Router();
const { body, validationResult, query } = require('express-validator');
const responseTime = require('response-time');

// Import enhanced rate limiter middleware
const {
  apiLimiter,
  createDynamicRateLimiter,
  rateLimitInfoMiddleware,
  shouldSkipRateLimit,
  profileUpdateLimiter
} = require("@middleware/rateLimit");

// Import UserController
const UserController = require("@controllers/user/UserController");
const userController = new UserController();

const { protect } = require("@middleware/authmiddleware");

// ============ CUSTOM USER RATE LIMITERS ============

// Private info update limiter (very sensitive operations)
const privateInfoLimiter = createDynamicRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 private info updates per hour
  keyGenerator: (req) => {
    const userId = req.user?.id || req.userId;
    return userId ? `user:private:user:${userId}` : `user:private:ip:${req.ip}`;
  },
  message: 'Too many private information updates. Please wait before making changes.'
});

// Account deletion limiter (very strict)
const accountDeletionLimiter = createDynamicRateLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 1, // 1 deletion request per day
  keyGenerator: (req) => {
    const userId = req.user?.id || req.userId;
    return userId ? `user:delete:user:${userId}` : `user:delete:ip:${req.ip}`;
  },
  message: 'Account deletion already requested. Please wait 24 hours or contact support.',
  blockDuration: 24 * 60 * 60 * 1000 // Block for 24 hours after reaching limit
});

// Settings update limiter
const settingsUpdateLimiter = createDynamicRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 settings updates per 15 minutes
  keyGenerator: (req) => {
    const userId = req.user?.id || req.userId;
    return userId ? `user:settings:user:${userId}` : `user:settings:ip:${req.ip}`;
  },
  message: 'Too many settings updates. Please slow down.'
});

// User profile data retrieval limiter
const profileRetrievalLimiter = createDynamicRateLimiter({
  windowMs: 10 * 1000, // 10 seconds
  max: 30, // 30 profile retrievals per 10 seconds
  keyGenerator: (req) => {
    const userId = req.user?.id || req.userId;
    return userId ? `user:retrieve:user:${userId}` : `user:retrieve:ip:${req.ip}`;
  },
  message: 'Too many profile data requests. Please cache the data.'
});

// ============ SECURITY MIDDLEWARE ============

// Request ID tracking for debugging
const addRequestId = (req, res, next) => {
  req.requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  res.setHeader('X-Request-ID', req.requestId);
  next();
};

// Security headers
const securityHeaders = (req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions policy
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Prevent caching of sensitive user data
  if (['/me', '/settings'].includes(req.path)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  next();
};

// Audit logging for sensitive operations
const auditLogger = (req, res, next) => {
  const sensitivePaths = ['/update', '/delete', '/export'];
  if (sensitivePaths.some(path => req.path.includes(path))) {
    const logData = {
      timestamp: new Date().toISOString(),
      userId: req.userId || req.user?.id,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 100),
      method: req.method,
      path: req.path,
      requestId: req.requestId
    };
    
    // Don't log sensitive body data, just note that it occurred
    if (req.body && Object.keys(req.body).length > 0) {
      logData.hasBody = true;
      logData.bodyKeys = Object.keys(req.body);
    }
    
    console.log(`[AUDIT] ${req.method} ${req.path}`, logData);
  }
  next();
};

// ============ MIDDLEWARE ORDER ============
// Apply security middleware first
router.use(addRequestId);
router.use(responseTime()); // Using the response-time package
router.use(securityHeaders);

// All routes require authentication
router.use(protect);

// Apply rate limit info middleware after auth
router.use(rateLimitInfoMiddleware);

// Apply general API rate limiting to all user routes
router.use(apiLimiter);

// Apply audit logging to sensitive routes
router.use(['/update', '/delete', '/export'], auditLogger);

// ============ USER API HEALTH CHECK ============
router.get("/health", (req, res) => {
  const healthData = {
    success: true,
    service: 'user-api',
    status: 'operational',
    timestamp: new Date().toISOString(),
    user: {
      id: req.userId || req.user?.id,
      email: req.user?.email,
      hasProfile: req.user?.profile ? true : false
    },
    rateLimiting: {
      enabled: true,
      limits: {
        general: '100 requests/15 minutes',
        privateInfo: '5 updates/hour',
        profile: '20 updates/15 minutes',
        deletion: '1 request/24 hours',
        settings: '20 updates/15 minutes',
        retrieval: '30 requests/10 seconds'
      }
    },
    endpoints: {
      current: {
        me: 'GET    /me - Get current user data',
        update: 'PUT    /update - Update private information',
        profile: 'PUT    /profile - Update public profile',
        delete: 'DELETE /delete - Delete account',
        settings: 'GET    /settings - Get user settings',
        settingsUpdate: 'PUT    /settings - Update settings',
        health: 'GET    /health - Health check',
        rateLimit: 'GET    /rate-limit/status - Rate limit status'
      },
      security: {
        note: 'All endpoints require authentication',
        sensitive: ['/update', '/delete'],
        encrypted: 'Private information is encrypted at rest'
      }
    },
    requestInfo: {
      requestId: req.requestId,
      ip: req.ip,
      timestamp: new Date().toISOString()
    }
  };

  res.json(healthData);
});

// ============ PROTECTED USER ROUTES ============

// Get current user data
router.get("/me", 
  profileRetrievalLimiter,
  userController.getMe.bind(userController)
);

// Update private information (firstName, lastName, phoneNumber)
router.put("/update", 
  privateInfoLimiter,
  [
    body('firstName')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('First name must be 1-50 characters'),
    body('lastName')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Last name must be 1-50 characters'),
    body('phoneNumber')
      .optional()
      .isMobilePhone()
      .withMessage('Valid phone number is required'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }
      
      // Validate that at least one field is provided
      const { firstName, lastName, phoneNumber } = req.body;
      if (!firstName && !lastName && !phoneNumber) {
        return res.status(400).json({
          success: false,
          error: 'At least one field (firstName, lastName, or phoneNumber) is required'
        });
      }
      
      next();
    }
  ],
  userController.updatePrivateInfo.bind(userController)
);

// Update public profile information
router.put("/profile", 
  profileUpdateLimiter,
  [
    body('username')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 3, max: 30 })
      .matches(/^[a-zA-Z0-9_.-]+$/)
      .withMessage('Username must be 3-30 characters and can only contain letters, numbers, dots, dashes, and underscores'),
    body('bio')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Bio must be less than 500 characters'),
    body('avatar')
      .optional()
      .isString()
      .withMessage('Avatar must be a string (URL)'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }
      
      // Validate that at least one field is provided
      const { username, bio, avatar } = req.body;
      if (!username && !bio && !avatar) {
        return res.status(400).json({
          success: false,
          error: 'At least one field (username, bio, or avatar) is required'
        });
      }
      
      next();
    }
  ],
  userController.updateProfile.bind(userController)
);

// Delete account (GDPR compliance)
router.delete("/delete", 
  accountDeletionLimiter,
  [
    body('password')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Password is required for account deletion'),
    body('confirmation')
      .equals('DELETE')
      .withMessage('Confirmation phrase must exactly match: DELETE'),
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
  userController.deleteAccount.bind(userController)
);

// Get user settings
router.get("/settings", 
  profileRetrievalLimiter,
  userController.getSettings.bind(userController)
);

// Update user settings
router.put("/settings", 
  settingsUpdateLimiter,
  [
    body('notificationSettings')
      .optional()
      .isObject()
      .withMessage('Notification settings must be an object'),
    body('privacySettings')
      .optional()
      .isObject()
      .withMessage('Privacy settings must be an object'),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }
      
      // Validate that at least one field is provided
      const { notificationSettings, privacySettings } = req.body;
      if (!notificationSettings && !privacySettings) {
        return res.status(400).json({
          success: false,
          error: 'At least one field (notificationSettings or privacySettings) is required'
        });
      }
      
      next();
    }
  ],
  userController.updateSettings.bind(userController)
);

// ============ RATE LIMIT STATUS ============
router.get("/rate-limit/status", (req, res) => {
  const response = {
    success: true,
    service: 'user-api',
    user: {
      id: req.userId || req.user?.id,
      email: req.user?.email
    },
    rateLimiting: {
      general: {
        limit: 100,
        window: "15 minutes",
        description: "General API requests"
      },
      privateInfo: {
        limit: 5,
        window: "1 hour",
        description: "Private information updates (sensitive)"
      },
      profile: {
        limit: 20,
        window: "15 minutes",
        description: "Public profile updates"
      },
      deletion: {
        limit: 1,
        window: "24 hours",
        description: "Account deletion (very sensitive)",
        note: "Requires password confirmation and confirmation phrase"
      },
      settings: {
        limit: 20,
        window: "15 minutes",
        description: "Settings updates"
      },
      retrieval: {
        limit: 30,
        window: "10 seconds",
        description: "Profile data retrieval"
      }
    },
    security: {
      authentication: "Bearer token required",
      encryption: "Private data encrypted at rest",
      confirmation: "Sensitive operations require additional confirmation",
      audit: "All sensitive operations are logged"
    },
    recommendations: [
      "Cache user data on the client side",
      "Use WebSocket for real-time updates",
      "Batch settings updates when possible",
      "Confirm sensitive operations with email verification",
      "Export your data regularly (GDPR compliance)"
    ],
    currentIp: req.ip,
    requestId: req.requestId,
    headers: {
      'X-RateLimit-Limit': res.getHeader('X-RateLimit-Limit') || 'N/A',
      'X-RateLimit-Remaining': res.getHeader('X-RateLimit-Remaining') || 'N/A',
      'X-RateLimit-Reset': res.getHeader('X-RateLimit-Reset') || 'N/A',
      'X-Request-ID': req.requestId
    }
  };

  res.json(response);
});

// ============ USER DATA EXPORT (GDPR) ============
router.get("/export",
  createDynamicRateLimiter({
    windowMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    max: 1, // 1 export per week
    message: 'Data export already requested this week. Please wait 7 days.',
    keyGenerator: (req) => `user:export:user:${req.userId || req.user?.id}`
  }),
  [
    query('format')
      .optional()
      .isIn(['json', 'csv', 'pdf'])
      .withMessage('Format must be json, csv, or pdf'),
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
    res.json({
      success: true,
      message: 'Data export requested. You will receive an email when it is ready.',
      exportId: `exp_${Date.now()}_${req.userId || req.user?.id}`,
      estimatedTime: '24 hours',
      format: req.query.format || 'json',
      includes: [
        'Profile information',
        'Account settings',
        'Messages (last 30 days)',
        'Activity history',
        'Payment history',
        'Support tickets'
      ],
      note: 'Exports are limited to once per week for security reasons',
      requestId: req.requestId
    });
  }
);

// ============ AUDIT LOG ============
router.get("/audit-logs",
  createDynamicRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 audit log requests per minute
    message: 'Too many audit log requests. Please wait.',
    keyGenerator: (req) => `user:audit:user:${req.userId || req.user?.id}`
  }),
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('type')
      .optional()
      .isIn(['all', 'login', 'profile', 'settings', 'security'])
      .withMessage('Type must be all, login, profile, settings, or security'),
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
    res.json({
      success: true,
      logs: [],
      total: 0,
      message: 'Audit log endpoint (placeholder)',
      note: 'Real audit logs would show security events and changes',
      requestId: req.requestId,
      filters: {
        limit: req.query.limit || 50,
        type: req.query.type || 'all'
      }
    });
  }
);

// ============ METRICS ENDPOINT ============
router.get("/metrics", (req, res) => {
  res.json({
    success: true,
    metrics: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      nodeVersion: process.version,
      platform: process.platform,
      timestamp: new Date().toISOString()
    },
    user: {
      id: req.userId || req.user?.id,
      authenticated: true
    },
    requestId: req.requestId
  });
});

// ============ ERROR HANDLING ============
router.use((err, req, res, next) => {
  console.error('User route error:', {
    requestId: req.requestId,
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
      recommendation: 'Sensitive operations have stricter rate limits. Please wait.',
      requestId: req.requestId
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err.errors || err.message,
      requestId: req.requestId
    });
  }

  // Account deletion specific errors
  if (err.message && (err.message.includes('account') || err.message.includes('delete'))) {
    return res.status(403).json({
      success: false,
      error: 'Account deletion requires additional confirmation',
      code: 'DELETION_CONFIRMATION_REQUIRED',
      requestId: req.requestId
    });
  }

  // Authentication/authorization errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      code: 'AUTHENTICATION_REQUIRED',
      requestId: req.requestId
    });
  }

  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
    code: err.code || 'INTERNAL_SERVER_ERROR',
    service: 'user-api',
    requestId: req.requestId
  });
});

// 404 handler for user routes
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `User route ${req.method} ${req.originalUrl} not found`,
    code: 'USER_ENDPOINT_NOT_FOUND',
    requestId: req.requestId,
    availableEndpoints: [
      'GET    /me',
      'PUT    /update',
      'PUT    /profile',
      'DELETE /delete',
      'GET    /settings',
      'PUT    /settings',
      'GET    /health',
      'GET    /rate-limit/status',
      'GET    /export',
      'GET    /audit-logs',
      'GET    /metrics'
    ],
    authentication: {
      required: true,
      method: 'Bearer token'
    },
    security: {
      note: 'All endpoints are protected and rate limited',
      sensitive: ['/update', '/delete', '/export']
    }
  });
});

module.exports = router;