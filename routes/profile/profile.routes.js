// routes/v1/profile.routes.js
const express = require("express");
const router = express.Router();
const { body, param, validationResult, query } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const profileController = require("@controllers/profile/profile.controller");
const { protect, authorize } = require("@middleware/authmiddleware");

// Import enhanced rate limiter middleware
const {
  apiLimiter,
  createDynamicRateLimiter,
  rateLimitInfoMiddleware
} = require("@middleware/rateLimit");

// ============ FILE UPLOAD CONFIGURATION ============
const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'],
  UPLOAD_DIR: 'uploads/profile/',
  TEMP_DIR: 'uploads/temp/'
};

// Ensure upload directories exist
[UPLOAD_CONFIG.UPLOAD_DIR, UPLOAD_CONFIG.TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_CONFIG.TEMP_DIR);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.id || 'anonymous';
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${userId}-${timestamp}-${random}${ext}`);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  if (UPLOAD_CONFIG.ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and GIF images are allowed.'));
  }
};

// Create multer instance
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: UPLOAD_CONFIG.MAX_FILE_SIZE
  }
});

// ============ CUSTOM PROFILE RATE LIMITERS ============
const profileUpdateLimiter = createDynamicRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `profile:update:user:${req.user?.id}`,
  message: 'Too many profile updates. Please wait before making more changes.',
  skip: (req) => req.method === 'GET'
});

const profilePhotoLimiter = createDynamicRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `profile:photos:user:${req.user?.id}`,
  message: 'Too many photo updates. Please wait before uploading more photos.'
});

const publicProfileViewLimiter = createDynamicRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => {
    const targetId = req.params?.userId || req.query?.userId;
    return `profile:view:${req.ip}:${targetId || 'list'}`;
  },
  message: 'Too many profile views. Please slow down.'
});

const profileCreationLimiter = createDynamicRateLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => `profile:create:user:${req.user?.id}`,
  message: 'Too many profile creations. Please wait 24 hours before creating another profile.'
});

const verificationLimiter = createDynamicRateLimiter({
  windowMs: 7 * 24 * 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => `profile:verify:user:${req.user?.id}`,
  message: 'Too many verification requests. You can only request verification 3 times per week.'
});

const completionCheckLimiter = createDynamicRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => `profile:completion:user:${req.user?.id}`,
  message: 'Too many profile completion checks. Please cache the result.'
});

const profileDeletionLimiter = createDynamicRateLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: 1,
  keyGenerator: (req) => `profile:delete:user:${req.user?.id}`,
  message: 'You can only delete your profile once per day. Please confirm this action.'
});

const profileExportLimiter = createDynamicRateLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => `profile:export:user:${req.user?.id}`,
  message: 'Too many profile export requests. Please wait 24 hours.'
});

// ============ HELPER FUNCTIONS ============
const validateRequest = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));
    
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }
    
    const errorMessages = errors.array().map(err => ({
      field: err.path,
      message: err.msg,
      value: err.value
    }));
    
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      errors: errorMessages,
      code: 'VALIDATION_ERROR',
      timestamp: new Date().toISOString()
    });
  };
};

const sanitizeInput = (req, res, next) => {
  // Basic XSS protection for string fields
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str
      .replace(/[<>]/g, '') // Remove < and >
      .trim();
  };
  
  // Recursively sanitize object
  const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    
    if (Array.isArray(obj)) {
      return obj.map(item => sanitizeObject(item));
    }
    
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        sanitized[key] = sanitizeString(value);
      } else if (typeof value === 'object') {
        sanitized[key] = sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  };
  
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  
  next();
};

const cacheControl = (duration) => {
  return (req, res, next) => {
    res.set('Cache-Control', `public, max-age=${duration}, stale-while-revalidate=300`);
    next();
  };
};

// ============ MIDDLEWARE ORDER ============
// Security headers
router.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Request timing
router.use((req, res, next) => {
  req.startTime = Date.now();
  req.requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  next();
});

// Rate limiting
router.use(rateLimitInfoMiddleware);
router.use(apiLimiter);

// ============ PUBLIC ROUTES ============
router.get("/health", (req, res) => {
  res.json({
    success: true,
    service: 'profile-api',
    version: '1.0.0',
    status: 'operational',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    endpoints: {
      public: ['/options', '/defaults', '/public/:userId', '/search', '/health'],
      protected: ['/create', '/me', '/update', '/upload', '/photos', '/match-preferences', '/verification', '/stats', '/completion', '/export', '/delete']
    }
  });
});

// Static data with caching
router.get("/options",
  cacheControl(86400), // 24 hours
  createDynamicRateLimiter({
    windowMs: 60 * 1000,
    max: 100,
    message: 'Too many options requests. Please cache the results.'
  }),
  profileController.getProfileOptions
);

router.get("/defaults",
  cacheControl(86400), // 24 hours
  createDynamicRateLimiter({
    windowMs: 60 * 1000,
    max: 100,
    message: 'Too many defaults requests. Please cache the results.'
  }),
  profileController.getDefaultProfileValues
);

// Public profile view
router.get("/public/:userId",
  publicProfileViewLimiter,
  validateRequest([
    param('userId')
      .isMongoId()
      .withMessage('Valid user ID is required')
  ]),
  profileController.getPublicProfile
);

// Profile search (public)
router.get("/search",
  createDynamicRateLimiter({
    windowMs: 30 * 1000,
    max: 60,
    message: 'Too many search requests. Please slow down.'
  }),
  validateRequest([
    query('q').optional().isString().trim().isLength({ max: 100 }),
    query('gender').optional().isIn(['male', 'female', 'non-binary', 'other']),
    query('minAge').optional().isInt({ min: 18, max: 100 }).toInt(),
    query('maxAge').optional().isInt({ min: 18, max: 100 }).toInt(),
    query('location').optional().isString().trim().isLength({ max: 100 }),
    query('religion').optional().isString().trim(),
    query('page').optional().isInt({ min: 1 }).toInt().default(1),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt().default(20),
    query('sort').optional().isIn(['recent', 'popular', 'distance', 'match']),
    query('online').optional().isBoolean().toBoolean()
  ]),
  async (req, res) => {
    // Forward to controller or implement search logic
    try {
      // This would typically call a searchProfiles method
      // For now, return mock response
      res.json({
        success: true,
        data: {
          results: [],
          pagination: {
            page: req.query.page || 1,
            limit: req.query.limit || 20,
            total: 0,
            pages: 0
          },
          filters: req.query
        },
        timestamp: new Date().toISOString(),
        requestId: req.requestId
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Search failed',
        code: 'SEARCH_ERROR'
      });
    }
  }
);

// ============ PROTECTED ROUTES ============
router.use(protect);

// Profile creation
router.post("/create",
  profileCreationLimiter,
  sanitizeInput,
  validateRequest([
    body('userName')
      .isString()
      .trim()
      .isLength({ min: 3, max: 30 })
      .matches(/^[a-zA-Z0-9_.]+$/)
      .withMessage('Username must be 3-30 alphanumeric characters (letters, numbers, underscore, period)'),
    body('bio')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Bio must be less than 500 characters'),
    body('dateOfBirth')
      .optional()
      .isISO8601()
      .withMessage('Valid date of birth is required (YYYY-MM-DD)')
      .custom((value) => {
        const birthDate = new Date(value);
        const age = Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        return age >= 18;
      })
      .withMessage('Must be at least 18 years old'),
    body('gender')
      .optional()
      .isString()
      .isIn(['male', 'female', 'non-binary', 'other', 'prefer-not-to-say'])
      .withMessage('Valid gender is required'),
    body('lookingFor')
      .optional()
      .isArray()
      .withMessage('Looking for must be an array'),
    body('lookingFor.*')
      .isIn(['male', 'female', 'non-binary', 'other'])
      .withMessage('Valid looking for option required'),
    body('currentLocation')
      .optional()
      .isObject()
      .withMessage('Current location must be an object'),
    body('currentLocation.city')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 })
      .withMessage('City must be less than 100 characters'),
    body('currentLocation.country')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Country must be less than 100 characters')
  ]),
  profileController.createProfile
);

// Get own complete profile
router.get("/me",
  createDynamicRateLimiter({
    windowMs: 10 * 1000,
    max: 20,
    message: 'Too many profile requests. Please cache your profile data.'
  }),
  cacheControl(60), // 1 minute cache for personal profile
  profileController.getCompleteProfile
);

// Update profile
router.put("/update",
  profileUpdateLimiter,
  sanitizeInput,
  validateRequest([
    body('userName')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 3, max: 30 })
      .matches(/^[a-zA-Z0-9_.]+$/),
    body('bio')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 }),
    body('dateOfBirth')
      .optional()
      .isISO8601()
      .custom((value) => {
        const birthDate = new Date(value);
        const age = Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        return age >= 18;
      }),
    body('gender')
      .optional()
      .isString()
      .isIn(['male', 'female', 'non-binary', 'other', 'prefer-not-to-say']),
    body('currentLocation')
      .optional()
      .isObject(),
    body('currentLocation.city')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 }),
    body('currentLocation.country')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 }),
    body('religion')
      .optional()
      .isString()
      .trim(),
    body('relationshipStatus')
      .optional()
      .isString()
      .trim(),
    body('education')
      .optional()
      .isString()
      .trim(),
    body('occupation')
      .optional()
      .isString()
      .trim(),
    body('income')
      .optional()
      .isString()
      .trim(),
    body('height')
      .optional()
      .isInt({ min: 100, max: 250 }),
    body('lookingFor')
      .optional()
      .isArray(),
    body('lookingFor.*')
      .isIn(['male', 'female', 'non-binary', 'other']),
    body('interests')
      .optional()
      .isArray(),
    body('interests.*')
      .isString()
      .trim()
      .isLength({ max: 50 })
  ]),
  profileController.updateProfile
);

// Upload profile picture
router.post("/upload",
  profilePhotoLimiter,
  upload.single('photo'),
  validateRequest([
    body('isPrimary').optional().isBoolean(),
    body('caption').optional().isString().trim().isLength({ max: 100 })
  ]),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded',
          code: 'NO_FILE'
        });
      }
      
      // Process the uploaded file
      // In a real implementation, you would:
      // 1. Validate image dimensions
      // 2. Compress/resize if needed
      // 3. Move to permanent storage
      // 4. Save to database
      // 5. Update profile
      
      const fileInfo = {
        originalName: req.file.originalname,
        fileName: req.file.filename,
        path: req.file.path,
        size: req.file.size,
        mimetype: req.file.mimetype,
        uploadedAt: new Date()
      };
      
      // Call controller method to handle profile picture update
      // For now, return success with file info
      res.json({
        success: true,
        data: {
          file: fileInfo,
          message: 'File uploaded successfully. Processing...'
        },
        timestamp: new Date().toISOString(),
        requestId: req.requestId
      });
    } catch (error) {
      // Clean up uploaded file on error
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, () => {});
      }
      
      res.status(500).json({
        success: false,
        error: error.message || 'Upload failed',
        code: 'UPLOAD_ERROR'
      });
    }
  }
);

// Update profile picture via URL
router.put("/profile-picture",
  profilePhotoLimiter,
  validateRequest([
    body('url')
      .isURL()
      .withMessage('Valid photo URL is required'),
    body('isVerified')
      .optional()
      .isBoolean()
      .withMessage('isVerified must be a boolean')
  ]),
  profileController.updateProfilePicture
);

// Update photos
router.put("/photos",
  profilePhotoLimiter,
  sanitizeInput,
  validateRequest([
    body('photos')
      .isArray()
      .withMessage('Photos must be an array')
      .isLength({ min: 1, max: 10 })
      .withMessage('You can upload between 1 and 10 photos'),
    body('photos.*.url')
      .isURL()
      .withMessage('Valid photo URL is required'),
    body('photos.*.isPrimary')
      .optional()
      .isBoolean()
      .withMessage('isPrimary must be a boolean'),
    body('photos.*.caption')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Caption must be less than 100 characters'),
    body('photos.*.order')
      .optional()
      .isInt({ min: 0, max: 9 })
      .withMessage('Order must be between 0 and 9')
  ]),
  profileController.updatePhotos
);

// Update match preferences
router.put("/match-preferences",
  profileUpdateLimiter,
  sanitizeInput,
  validateRequest([
    body('ageRange')
      .optional()
      .isObject()
      .withMessage('Age range must be an object'),
    body('ageRange.min')
      .optional()
      .isInt({ min: 18, max: 100 })
      .withMessage('Minimum age must be 18-100'),
    body('ageRange.max')
      .optional()
      .isInt({ min: 18, max: 100 })
      .withMessage('Maximum age must be 18-100'),
    body('distance')
      .optional()
      .isInt({ min: 1, max: 10000 })
      .withMessage('Distance must be 1-10000 km'),
    body('gender')
      .optional()
      .isString()
      .isIn(['male', 'female', 'non-binary', 'other', 'any'])
      .withMessage('Valid gender option required'),
    body('religion')
      .optional()
      .isString()
      .trim()
      .withMessage('Religion must be a string'),
    body('educationLevel')
      .optional()
      .isString()
      .trim()
      .withMessage('Education level must be a string'),
    body('wantsChildren')
      .optional()
      .isString()
      .trim()
      .withMessage('Wants children must be a string')
  ]),
  profileController.updateMatchPreferences
);

// Add verification badge
router.post("/verification",
  verificationLimiter,
  validateRequest([
    body('badgeType')
      .isIn(['email', 'phone', 'photo', 'document', 'social', 'video'])
      .withMessage('Valid badge type is required'),
    body('documentUrl')
      .optional()
      .isURL()
      .withMessage('Valid document URL is required'),
    body('verificationData')
      .optional()
      .isObject()
      .withMessage('Verification data must be an object')
  ]),
  profileController.addVerificationBadge
);

// Get profile stats
router.get("/stats",
  createDynamicRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too many stats requests. Please cache the results.'
  }),
  profileController.getProfileStats
);

// Get profile completion
router.get("/completion",
  completionCheckLimiter,
  profileController.getProfileCompletion
);

// Export profile data (GDPR compliance)
router.get("/export",
  profileExportLimiter,
  async (req, res) => {
    try {
      // In a real implementation, this would:
      // 1. Generate comprehensive profile data
      // 2. Format as JSON/PDF
      // 3. Send email or provide download link
      
      res.json({
        success: true,
        data: {
          message: 'Profile export requested. You will receive an email with your data within 24 hours.',
          requestId: `export_${Date.now()}`,
          estimatedDelivery: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          format: 'JSON'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Export failed',
        code: 'EXPORT_ERROR'
      });
    }
  }
);

// Delete profile
router.delete("/delete",
  profileDeletionLimiter,
  validateRequest([
    body('confirmation')
      .equals('DELETE MY PROFILE')
      .withMessage('Confirmation text is required'),
    body('reason')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Reason must be less than 500 characters')
  ]),
  async (req, res) => {
    try {
      // This would call profileController.deleteProfile
      // For now, return confirmation
      res.json({
        success: true,
        data: {
          message: 'Profile deletion requested. Your data will be permanently deleted within 30 days.',
          confirmationId: `del_${Date.now()}`,
          scheduledFor: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          note: 'You can cancel this request within 24 hours.'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Deletion request failed',
        code: 'DELETION_ERROR'
      });
    }
  }
);

// Rate limit status
router.get("/rate-limit/status",
  createDynamicRateLimiter({
    windowMs: 30 * 1000,
    max: 10,
    message: 'Too many rate limit status requests.'
  }),
  (req, res) => {
    const response = {
      success: true,
      service: 'profile-api',
      version: '1.0.0',
      user: req.user ? {
        id: req.user.id,
        hasProfile: !!req.user.profileId,
        role: req.user.role
      } : null,
      rateLimiting: {
        enabled: true,
        limits: {
          general: { limit: 100, window: "15 minutes" },
          updates: { limit: 20, window: "15 minutes" },
          photos: { limit: 10, window: "1 hour" },
          views: { limit: 60, window: "1 minute" },
          creation: { limit: 3, window: "24 hours" },
          verification: { limit: 3, window: "7 days" },
          completion: { limit: 30, window: "5 minutes" },
          deletion: { limit: 1, window: "24 hours" },
          export: { limit: 3, window: "24 hours" }
        }
      },
      performance: {
        cacheEnabled: true,
        compression: true,
        cdn: process.env.NODE_ENV === 'production'
      },
      security: {
        fileUploads: true,
        xssProtection: true,
        rateLimiting: true,
        validation: true
      },
      currentRequest: {
        id: req.requestId,
        ip: req.ip,
        timestamp: new Date().toISOString(),
        duration: req.startTime ? `${Date.now() - req.startTime}ms` : 'N/A'
      }
    };

    res.json(response);
  }
);

// ============ ADMIN ROUTES ============
router.use("/admin", authorize('admin'));

// Admin endpoints would go here
router.get("/admin/profiles",
  createDynamicRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    keyGenerator: (req) => `admin:profiles:${req.user?.id}`
  }),
  async (req, res) => {
    // Admin profile listing
    res.json({
      success: true,
      data: [],
      meta: {
        total: 0,
        page: 1,
        limit: 20
      }
    });
  }
);

// ============ BACKWARD COMPATIBILITY ============
router.get("/:userId",
  publicProfileViewLimiter,
  validateRequest([
    param('userId')
      .isMongoId()
      .withMessage('Valid user ID is required')
  ]),
  profileController.getPublicProfile
);

// ============ ERROR HANDLING ============
router.use((err, req, res, next) => {
  const duration = req.startTime ? Date.now() - req.startTime : 0;
  
  console.error('Profile route error:', {
    requestId: req.requestId,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    ip: req.ip,
    duration: `${duration}ms`,
    error: err.message,
    code: err.code,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  // Multer file upload error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'File too large. Maximum size is 10MB.',
      code: 'FILE_TOO_LARGE',
      maxSize: '10MB',
      requestId: req.requestId
    });
  }

  if (err.message?.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      error: err.message,
      code: 'INVALID_FILE_TYPE',
      allowedTypes: UPLOAD_CONFIG.ALLOWED_TYPES,
      requestId: req.requestId
    });
  }

  // Rate limiting error
  if (err.name === 'RateLimitError') {
    return res.status(429).json({
      success: false,
      error: err.message,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(err.msBeforeNext / 1000),
      recommendation: 'Consider caching data or reducing request frequency',
      requestId: req.requestId
    });
  }

  // Validation error
  if (err.name === 'ValidationError' || err.errors) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err.errors || err.message,
      code: 'VALIDATION_ERROR',
      requestId: req.requestId
    });
  }

  // Authentication error
  if (err.name === 'JsonWebTokenError' || err.message?.includes('jwt') || err.message?.includes('token')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication failed',
      code: 'AUTH_ERROR',
      requestId: req.requestId
    });
  }

  // Authorization error
  if (err.message?.includes('not authorized') || err.message?.includes('permission')) {
    return res.status(403).json({
      success: false,
      error: 'Not authorized',
      code: 'FORBIDDEN',
      requestId: req.requestId
    });
  }

  // Age restriction error
  if (err.message?.includes('18 years') || err.message?.includes('age restriction')) {
    return res.status(403).json({
      success: false,
      error: 'Age restriction: Must be 18 years or older',
      code: 'AGE_RESTRICTION',
      requestId: req.requestId
    });
  }

  // Profile not found
  if (err.message?.includes('not found') || err.code === 'NOT_FOUND') {
    return res.status(404).json({
      success: false,
      error: err.message || 'Resource not found',
      code: 'NOT_FOUND',
      requestId: req.requestId
    });
  }

  // Duplicate key error (MongoDB)
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'unknown';
    return res.status(409).json({
      success: false,
      error: `${field} already exists`,
      code: 'DUPLICATE_KEY',
      field,
      requestId: req.requestId
    });
  }

  // Default error
  const statusCode = err.statusCode || err.status || 500;
  const errorMessage = process.env.NODE_ENV === 'production' && statusCode === 500
    ? 'Internal server error'
    : err.message;

  res.status(statusCode).json({
    success: false,
    error: errorMessage,
    code: err.code || 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
router.use((req, res) => {
  const duration = req.startTime ? Date.now() - req.startTime : 0;
  
  console.warn('Profile route not found:', {
    requestId: req.requestId,
    path: req.originalUrl,
    method: req.method,
    userId: req.user?.id,
    duration: `${duration}ms`
  });

  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.originalUrl} not found`,
    code: 'ROUTE_NOT_FOUND',
    service: 'profile-api',
    version: '1.0.0',
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
    documentation: {
      publicRoutes: [
        'GET  /health - API health check',
        'GET  /options - Profile field options',
        'GET  /defaults - Default profile values',
        'GET  /public/:userId - Public profile view',
        'GET  /search - Search profiles',
        'GET  /:userId - Legacy profile view'
      ],
      protectedRoutes: [
        'POST /create - Create profile',
        'GET  /me - Get complete profile',
        'PUT  /update - Update profile',
        'POST /upload - Upload photo',
        'PUT  /profile-picture - Update profile picture',
        'PUT  /photos - Update photos',
        'PUT  /match-preferences - Update match preferences',
        'POST /verification - Request verification',
        'GET  /stats - Get profile stats',
        'GET  /completion - Get profile completion',
        'GET  /export - Export profile data',
        'DELETE /delete - Delete profile',
        'GET  /rate-limit/status - Rate limit status'
      ],
      authentication: {
        method: 'Bearer token',
        header: 'Authorization: Bearer <token>'
      }
    }
  });
});

module.exports = router;