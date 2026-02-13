// routes/v1/profile.routes.js
const express = require("express");
const router = express.Router();
const { body, param, validationResult, query } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ============ CONTROLLER IMPORTS ============
const profileController = require("@controllers/profile/profile.controller");
const { protect, authorize, requireDatingProfile } = require("@middleware/authmiddleware");
const { apiLimiter, createDynamicRateLimiter, rateLimitInfoMiddleware } = require("@middleware/rateLimit");

// ============ FILE UPLOAD CONFIG ============
const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  UPLOAD_DIR: 'uploads/profiles/',
  TEMP_DIR: 'uploads/temp/'
};

// Ensure directories exist
[UPLOAD_CONFIG.UPLOAD_DIR, UPLOAD_CONFIG.TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_CONFIG.TEMP_DIR),
  filename: (req, file, cb) => {
    const userId = req.user?.id || 'anonymous';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${userId}-${timestamp}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (UPLOAD_CONFIG.ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: UPLOAD_CONFIG.MAX_FILE_SIZE }
});

// ============ RATE LIMITERS ============
const limiters = {
  general: apiLimiter,
  update: createDynamicRateLimiter({ windowMs: 15 * 60 * 1000, max: 30, keyGenerator: (req) => `profile:update:${req.user?.id}` }),
  photos: createDynamicRateLimiter({ windowMs: 60 * 60 * 1000, max: 15, keyGenerator: (req) => `profile:photos:${req.user?.id}` }),
  view: createDynamicRateLimiter({ windowMs: 60 * 1000, max: 100, keyGenerator: (req) => `profile:view:${req.ip}` }),
  create: createDynamicRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 1, keyGenerator: (req) => `profile:create:${req.user?.id}` }),
  badge: createDynamicRateLimiter({ windowMs: 7 * 24 * 60 * 60 * 1000, max: 5, keyGenerator: (req) => `profile:badge:${req.user?.id}` }),
  search: createDynamicRateLimiter({ windowMs: 60 * 1000, max: 30, keyGenerator: (req) => `profile:search:${req.ip}` })
};

// ============ HELPER FUNCTIONS ============
const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(v => v.run(req)));
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg, value: e.value })),
      code: 'VALIDATION_ERROR',
      timestamp: new Date().toISOString()
    });
  };
};

const sanitize = (req, res, next) => {
  const clean = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(clean);
    
    return Object.keys(obj).reduce((acc, key) => {
      const val = obj[key];
      if (typeof val === 'string') {
        acc[key] = val.replace(/[<>]/g, '').trim();
      } else if (typeof val === 'object') {
        acc[key] = clean(val);
      } else {
        acc[key] = val;
      }
      return acc;
    }, {});
  };
  
  if (req.body) req.body = clean(req.body);
  next();
};

const cache = (seconds) => (req, res, next) => {
  res.set('Cache-Control', `public, max-age=${seconds}`);
  next();
};

// ============ REQUEST TRACKING ============
router.use((req, res, next) => {
  req.startTime = Date.now();
  req.requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  next();
});

// Security headers
router.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Rate limiting
router.use(rateLimitInfoMiddleware);
router.use(limiters.general);

// ============ PUBLIC ROUTES ============
router.get("/health", (req, res) => {
  res.json({
    success: true,
    service: 'profile-api',
    version: '1.0.0',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

// Static data - cached 24h
router.get("/options", cache(86400), limiters.search, profileController.getOptions);

// Public profile view
router.get("/public/:userId",
  limiters.view,
  validate([param('userId').isMongoId().withMessage('Valid user ID required')]),
  profileController.getPublicProfile
);

// ============ PROTECTED ROUTES ============
router.use(protect);

// ===== GET PROFILE =====
router.get("/me",
  createDynamicRateLimiter({ windowMs: 10 * 1000, max: 20 }),
  cache(60),
  profileController.getMyProfile
);

// ===== CREATE PROFILE =====
router.post("/",
  limiters.create,
  sanitize,
  validate([
    body('basic.userName')
      .optional()
      .isString().trim()
      .isLength({ min: 3, max: 20 })
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('Username: 3-20 letters, numbers, underscore, hyphen'),
    
    body('basic.bio')
      .optional()
      .isString().trim()
      .isLength({ max: 500 }),
    
    body('basic.dateOfBirth')
      .optional()
      .isISO8601()
      .withMessage('Valid date required (YYYY-MM-DD)'),
    
    body('basic.gender')
      .optional()
      .isIn(['male', 'female', 'non-binary', 'other', 'prefer-not-to-say']),
    
    body('basic.height')
      .optional()
      .isInt({ min: 100, max: 250 }),
    
    body('location.city')
      .optional()
      .isString().trim()
      .isLength({ max: 100 }),
    
    body('location.country')
      .optional()
      .isString().trim()
      .isLength({ max: 100 }),
    
    body('countryOfOrigin')
      .optional()
      .isString().trim()
      .isLength({ max: 100 }),
    
    body('homeLanguage')
      .optional()
      .isString().trim()
      .isLength({ max: 50 })
  ]),
  profileController.createProfile
);

// ===== UPDATE FULL PROFILE =====
router.put("/",
  limiters.update,
  sanitize,
  profileController.updateProfile
);

// ===== SECTION UPDATES =====
router.put("/basic",
  limiters.update,
  sanitize,
  validate([
    body('basic.userName').optional().isString().trim().isLength({ min: 3, max: 20 }),
    body('basic.bio').optional().isString().trim().isLength({ max: 500 }),
    body('basic.dateOfBirth').optional().isISO8601(),
    body('basic.gender').optional().isIn(['male', 'female', 'non-binary', 'other', 'prefer-not-to-say']),
    body('basic.height').optional().isInt({ min: 100, max: 250 })
  ]),
  profileController.updateBasicInfo
);

router.put("/faith",
  limiters.update,
  sanitize,
  validate([
    body('faith.baptismDate').optional().isISO8601(),
    body('faith.servingAs').optional().isIn(['elder', 'ministerial_servant', 'regular_pioneer', 'auxiliary_pioneer', 'special_pioneer', 'regular_publisher', 'other', null]),
    body('faith.pioneerHours').optional().isIn(['30', '50', '70', '100', null]),
    body('faith.congregation.name').optional().isString().trim().isLength({ max: 100 }),
    body('faith.congregation.circuit').optional().isString().trim().isLength({ max: 50 }),
    body('faith.congregation.language').optional().isString().trim().isLength({ max: 50 }),
    body('faith.missionary.served').optional().isBoolean(),
    body('faith.bethel.served').optional().isBoolean()
  ]),
  profileController.updateFaithInfo
);

router.put("/relationship",
  limiters.update,
  sanitize,
  validate([
    body('relationship.status').optional().isIn(['single', 'dating', 'engaged', 'married', 'divorced', 'widowed', 'separated', null]),
    body('relationship.lookingFor').optional().isArray(),
    body('relationship.lookingFor.*').optional().isIn(['friendship', 'pen_pals', 'dating', 'serious_relationship', 'marriage']),
    body('relationship.children.have').optional().isIn(['yes', 'no', 'prefer_not_to_say', null]),
    body('relationship.children.want').optional().isIn(['yes', 'no', 'maybe', 'open_to_adoption', 'prefer_not_to_say', null]),
    body('relationship.livingSituation').optional().isIn(['alone', 'with_family', 'with_roommates', 'with_children', 'other', null])
  ]),
  profileController.updateRelationshipInfo
);

router.put("/career",
  limiters.update,
  sanitize,
  validate([
    body('career.education.level').optional().isIn(['high_school', 'some_college', 'associates', 'bachelors', 'masters', 'phd', 'trade_school', 'other', null]),
    body('career.education.field').optional().isString().trim().isLength({ max: 100 }),
    body('career.work.occupation').optional().isString().trim().isLength({ max: 100 }),
    body('career.work.industry').optional().isString().trim().isLength({ max: 100 }),
    body('career.work.schedule').optional().isIn(['9to5', 'flexible', 'nights', 'weekends', 'shift_work', 'stay_at_home', 'retired', 'student', null]),
    body('career.work.income').optional().isIn(['under_30k', '30k_60k', '60k_100k', '100k_150k', '150k_plus', 'prefer_not_to_say', null])
  ]),
  profileController.updateCareerInfo
);

router.put("/lifestyle",
  limiters.update,
  sanitize,
  validate([
    body('lifestyle.hobbies').optional().isArray(),
    body('lifestyle.hobbies.*').optional().isString().trim().isLength({ max: 50 }),
    
    body('lifestyle.languages').optional().isArray(),
    body('lifestyle.languages.*.language').optional().isString().trim().isLength({ max: 50 }),
    body('lifestyle.languages.*.proficiency').optional().isIn(['basic', 'conversational', 'fluent', 'native']),
    
    body('lifestyle.pets').optional().isArray(),
    body('lifestyle.pets.*').optional().isIn(['dog', 'cat', 'bird', 'fish', 'reptile', 'small_furry', 'horse', 'other', 'none']),
    
    body('lifestyle.diet').optional().isIn(['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'kosher', 'halal', 'other', null]),
    body('lifestyle.exercise.frequency').optional().isIn(['never', 'occasionally', '1-2_times_week', '3-4_times_week', 'daily', null]),
    body('lifestyle.exercise.activities').optional().isArray(),
    body('lifestyle.smoking').optional().isIn(['never', 'socially', 'occasionally', 'regularly', 'trying_to_quit', null]),
    body('lifestyle.drinking').optional().isIn(['never', 'socially', 'occasionally', 'regularly', null])
  ]),
  profileController.updateLifestyle
);

router.put("/personality",
  limiters.update,
  sanitize,
  validate([
    body('personality.introvertExtrovert').optional().isIn(['introvert', 'ambivert', 'extrovert', null]),
    body('personality.loveLanguage').optional().isArray(),
    body('personality.loveLanguage.*').optional().isIn(['words_of_affirmation', 'acts_of_service', 'receiving_gifts', 'quality_time', 'physical_touch']),
    body('personality.communicationStyle').optional().isIn(['texter', 'caller', 'video_chat', 'mixed', null]),
    body('personality.spiritualGoals').optional().isArray(),
    body('personality.meetingAttendance').optional().isIn(['every_meeting', 'most_meetings', 'occasionally', 'currently_inactive', null])
  ]),
  profileController.updatePersonality
);

router.put("/preferences",
  limiters.update,
  sanitize,
  validate([
    body('preferences.basic.gender').optional().isArray(),
    body('preferences.basic.gender.*').optional().isIn(['male', 'female', 'any']),
    body('preferences.basic.ageRange.min').optional().isInt({ min: 18, max: 100 }),
    body('preferences.basic.ageRange.max').optional().isInt({ min: 18, max: 100 }),
    body('preferences.basic.distance').optional().isInt({ min: 1, max: 500 }),
    
    body('preferences.faith.mustBeJW').optional().isBoolean(),
    body('preferences.faith.servingAs').optional().isArray(),
    body('preferences.faith.pioneerPreferred').optional().isBoolean(),
    body('preferences.faith.missionaryPreferred').optional().isBoolean(),
    body('preferences.faith.bethelPreferred').optional().isBoolean(),
    
    body('preferences.relationship.goals').optional().isArray(),
    body('preferences.relationship.goals.*').optional().isIn(['friendship', 'pen_pals', 'dating', 'serious_relationship', 'marriage']),
    body('preferences.relationship.children.accept').optional().isBoolean(),
    
    body('preferences.dealbreakers.mustHaves').optional().isArray(),
    body('preferences.dealbreakers.dealBreakers').optional().isArray()
  ]),
  profileController.updatePreferences
);

router.put("/settings",
  limiters.update,
  sanitize,
  validate([
    body('settings.isVisible').optional().isBoolean(),
    body('settings.isPaused').optional().isBoolean(),
    body('settings.tags').optional().isArray(),
    body('settings.tags.*').optional().isString().trim().isLength({ max: 30 }),
    body('settings.privacy.showAge').optional().isBoolean(),
    body('settings.privacy.showDistance').optional().isBoolean(),
    body('settings.privacy.showLastActive').optional().isIn(['everyone', 'matches', 'nobody']),
    body('settings.privacy.showCongregation').optional().isBoolean()
  ]),
  profileController.updateSettings
);

// ===== PHOTO MANAGEMENT =====
router.put("/photos/profile",
  limiters.photos,
  sanitize,
  validate([
    body('url').isURL().withMessage('Valid photo URL required')
  ]),
  profileController.updateProfilePicture
);

router.put("/photos/gallery",
  limiters.photos,
  sanitize,
  validate([
    body('photos').isArray().isLength({ min: 1, max: 9 }),
    body('photos.*.url').isURL(),
    body('photos.*.caption').optional().isString().trim().isLength({ max: 100 }),
    body('photos.*.order').optional().isInt({ min: 0, max: 8 })
  ]),
  profileController.updateGallery
);

// Upload endpoint for direct file upload
router.post("/photos/upload",
  limiters.photos,
  upload.single('photo'),
  async (req, res) => {
    try {
      if (!req.file) throw new Error('No file uploaded');
      
      // In production, upload to cloud storage and get URL
      const fileUrl = `${req.protocol}://${req.get('host')}/uploads/profiles/${req.file.filename}`;
      
      // Move from temp to permanent
      fs.renameSync(req.file.path, `uploads/profiles/${req.file.filename}`);
      
      res.json({
        success: true,
        data: { url: fileUrl, filename: req.file.filename },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      res.status(400).json({
        success: false,
        error: error.message,
        code: 'UPLOAD_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }
);

// ===== BADGES =====
router.post("/badges",
  limiters.badge,
  validate([
    body('badge').isIn(['email', 'phone', 'photo', 'identity', 'premium', 'baptized', 'pioneer', 'missionary', 'bethel'])
  ]),
  profileController.addBadge
);

// ===== STATS & PROGRESS =====
router.get("/stats",
  createDynamicRateLimiter({ windowMs: 60 * 1000, max: 30 }),
  profileController.getStats
);

router.get("/completion",
  createDynamicRateLimiter({ windowMs: 5 * 60 * 1000, max: 20 }),
  profileController.getCompletion
);

// ===== DATING PROFILE ROUTES =====
router.use("/dating", requireDatingProfile);

router.get("/dating/profile",
  createDynamicRateLimiter({ windowMs: 10 * 1000, max: 20 }),
  async (req, res) => {
    try {
      const profile = await Profile.findOne({ userId: req.user.id })
        .select('settings.preferences.faith badges stats.lastActive');
      
      res.json({
        success: true,
        data: {
          isVisible: profile?.settings?.isVisible ?? true,
          isPaused: profile?.settings?.isPaused ?? false,
          preferences: profile?.preferences?.faith ?? {},
          badges: profile?.badges ?? [],
          lastActive: profile?.stats?.lastActive ?? new Date()
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ===== LEGACY/COMPATIBILITY =====
router.get("/:userId",
  limiters.view,
  validate([param('userId').isMongoId()]),
  profileController.getPublicProfile
);

// ===== RATE LIMIT STATUS =====
router.get("/debug/rate-limits",
  createDynamicRateLimiter({ windowMs: 30 * 1000, max: 5 }),
  (req, res) => {
    res.json({
      success: true,
      user: req.user?.id,
      limits: {
        update: '30 per 15m',
        photos: '15 per hour',
        create: '1 per day',
        badge: '5 per week',
        search: '30 per minute',
        view: '100 per minute'
      },
      requestId: req.requestId
    });
  }
);

// ============ ERROR HANDLERS ============
router.use((err, req, res, next) => {
  console.error('Profile route error:', {
    path: req.path,
    userId: req.user?.id,
    error: err.message,
    code: err.code
  });

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'File too large. Maximum size is 10MB.',
      code: 'FILE_TOO_LARGE',
      timestamp: new Date().toISOString()
    });
  }

  if (err.message?.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      error: err.message,
      code: 'INVALID_FILE_TYPE',
      timestamp: new Date().toISOString()
    });
  }

  // Default error
  res.status(err.statusCode || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' && err.statusCode === 500 
      ? 'Internal server error' 
      : err.message,
    code: err.code || 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
    requestId: req.requestId
  });
});

// 404 handler
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.originalUrl} not found`,
    code: 'ROUTE_NOT_FOUND',
    service: 'profile-api',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;