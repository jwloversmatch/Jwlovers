const express = require("express");

const router = express.Router();
const {
  protect,
  adminOnly,
  superAdminOnly,
  requireMinimumRole,
  canViewAdminDashboard,
  canModerateContent,
  staffOnly,
  authorizeUserType,
  ROLES,
} = require("@middleware/authmiddleware");

console.log('=== DEBUG ADMIN ROUTES ===');
console.log('requireMinimumRole type:', typeof requireMinimumRole);
console.log('requireMinimumRole:', requireMinimumRole);
console.log('ROLES:', ROLES);
console.log('ROLES.ADMIN:', ROLES?.ADMIN);

// Import enhanced rate limiter middleware
const {
  apiLimiter,
  createDynamicRateLimiter,
  rateLimitInfoMiddleware,
  shouldSkipRateLimit,
} = require("@middleware/rateLimit");

// Import validation middleware
const { body, param, validationResult } = require("express-validator");

// Import actual AdminController
const adminController = require("@controllers/admin/admin.controller");

// ============ IMPORT INVITE CODES ROUTES ============
const inviteCodesRoutes = require("./inviteCodes.routes");

// ============ CUSTOM ADMIN RATE LIMITERS ============

// Admin option management limiter (sensitive operations)
const adminOptionsLimiter = createDynamicRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 operations per minute
  keyGenerator: (req) => {
    const userId = req.user?.id;
    const operation = req.method.toLowerCase();
    return userId
      ? `admin:options:${operation}:user:${userId}`
      : `admin:options:${operation}:ip:${req.ip}`;
  },
  message: "Too many option management operations. Please slow down.",
});

// Security questions limiter (very sensitive operations)
const securityQuestionsLimiter = createDynamicRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // 20 operations per 5 minutes
  keyGenerator: (req) => {
    const userId = req.user?.id;
    const operation = req.method.toLowerCase();
    return userId
      ? `admin:security:${operation}:user:${userId}`
      : `admin:security:${operation}:ip:${req.ip}`;
  },
  message: "Too many security question operations. This is a sensitive area.",
});

// Import/Export operations limiter (heavy operations)
const importExportLimiter = createDynamicRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10, // 10 import/export operations per 10 minutes
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId
      ? `admin:importExport:user:${userId}`
      : `admin:importExport:ip:${req.ip}`;
  },
  message:
    "Too many import/export operations. Please wait before trying again.",
});

// Admin bulk operations limiter
const bulkOperationsLimiter = createDynamicRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 bulk operations per 15 minutes
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `admin:bulk:user:${userId}` : `admin:bulk:ip:${req.ip}`;
  },
  message: "Too many bulk operations. These are resource-intensive.",
});

// ============ MIDDLEWARE ORDER ============
// Apply rate limit info middleware first (if it's a function)
if (typeof rateLimitInfoMiddleware === "function") {
  router.use(rateLimitInfoMiddleware);
}

// Apply general API rate limiting to all admin routes
router.use(apiLimiter);

// All routes require authentication and staff access
router.use(protect);
router.use(staffOnly);

// ============ MOUNT INVITE CODES ROUTES ============
router.use("/invite-codes", inviteCodesRoutes);

// ============ ADMIN HEALTH CHECK (Public) ============
router.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "admin-api",
    status: "operational",
    timestamp: new Date().toISOString(),
    authentication: {
      required: true,
      userRole: req.user?.role || "none",
      userType: req.user?.userType || "none",
      userId: req.user?.id,
    },
    mountedRoutes: ["/invite-codes", "/invite-codes/stats/overview"],
    rateLimiting: {
      enabled: true,
      limits: {
        general: "100 requests/15 minutes",
        options: "30 operations/minute",
        security: "20 operations/5 minutes",
        importExport: "10 operations/10 minutes",
        bulk: "5 operations/15 minutes",
      },
    },
    roleHierarchy: ROLES,
  });
});

// ============ ADMIN DASHBOARD ACCESS ============
// Only admins and super admins can access the dashboard
router.get(
  "/dashboard",
  requireMinimumRole(ROLES.ADMIN),
  (req, res, next) => {
    // Simple rate limiter for dashboard
    const userId = req.user?.id;
    const ip = req.ip;
    const key = `dashboard:${userId || ip}`;
    const limit = 10;
    const windowMs = 60 * 1000;

    // Simple in-memory rate limiting (replace with Redis in production)
    const now = Date.now();
    if (!global.rateLimitStore) global.rateLimitStore = new Map();

    const userData = global.rateLimitStore.get(key) || {
      count: 0,
      resetTime: now + windowMs,
    };

    if (now > userData.resetTime) {
      userData.count = 0;
      userData.resetTime = now + windowMs;
    }

    if (userData.count >= limit) {
      return res.status(429).json({
        success: false,
        error: "Too many dashboard requests. Please wait.",
        retryAfter: Math.ceil((userData.resetTime - now) / 1000),
      });
    }

    userData.count++;
    global.rateLimitStore.set(key, userData);
    next();
  },
  adminController.getAdminDashboard,
);

// Dashboard metrics - Admin+ only
router.get(
  "/dashboard/metrics",
  requireMinimumRole(ROLES.ADMIN),
  adminController.getDashboardMetrics,
);

router.get(
  "/profiles",
  requireMinimumRole(ROLES.ADMIN),
  adminController.getAllProfiles,
);

// Get profile by ID - Admin+ only
router.get(
  "/profiles/:id",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid profile ID is required")
      .trim()
      .escape(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.getProfileById,
);

// Update profile visibility - Admin+ only
router.patch(
  "/profiles/:id/visibility",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid profile ID is required")
      .trim()
      .escape(),
    body("isVisible")
      .optional()
      .isBoolean()
      .withMessage("isVisible must be a boolean"),
    body("isPaused")
      .optional()
      .isBoolean()
      .withMessage("isPaused must be a boolean"),
    body("reason")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage("Reason must be 5-500 characters"),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.updateProfileVisibility,
);

// ============ DATING PROFILE MANAGEMENT ============
// Get all dating profiles - Admin+ only
router.get(
  "/dating-profiles",
  requireMinimumRole(ROLES.ADMIN),
  adminController.getAllDatingProfiles,
);

// Get dating profile by user ID - Admin+ only
router.get(
  "/dating-profiles/:userId",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("userId")
      .isMongoId()
      .withMessage("Valid user ID is required")
      .trim()
      .escape(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  async (req, res) => {
    try {
      const { DatingUser } = require("@models/User/datingUserSchema");
      const datingUser = await DatingUser.findById(req.params.userId)
        .populate("profile")
        .lean();

      if (!datingUser) {
        return res.status(404).json({
          success: false,
          error: "Dating profile not found",
          code: "DATING_PROFILE_NOT_FOUND",
        });
      }

      res.json({
        success: true,
        data: datingUser,
      });
    } catch (error) {
      logger.error("Get dating profile error:", error);
      res.status(500).json({
        success: false,
        error: "Unable to retrieve dating profile",
      });
    }
  },
);

// Update dating profile - Admin+ only
router.put(
  "/dating-profiles/:id",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid dating profile ID is required")
      .trim()
      .escape(),
    body("updates").isObject().withMessage("Updates object is required"),
    body("reason")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage("Reason must be 5-500 characters"),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.updateDatingProfile,
);

// Toggle premium status - Admin+ only
router.patch(
  "/dating-profiles/:id/premium",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid dating profile ID is required")
      .trim()
      .escape(),
    body("isPremium").isBoolean().withMessage("isPremium must be a boolean"),
    body("durationDays")
      .optional()
      .isInt({ min: 1, max: 365 })
      .withMessage("Duration must be 1-365 days"),
    body("reason")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage("Reason must be 5-500 characters"),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.togglePremiumStatus,
);

// ============ USER MANAGEMENT ============
// GET all users - Admin+ only
router.get(
  "/users",
  requireMinimumRole(ROLES.ADMIN),
  adminController.getAllUsers,
);

// GET users by type - Admin+ only
router.get(
  "/users/type/:userType",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("userType")
      .isIn(["DatingUser", "Moderator", "Admin", "SuperAdmin"])
      .withMessage("Valid user type is required"),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.getUsersByType,
);

// GET user by ID - Admin+ only (with proper permissions check)
router.get(
  "/users/:id",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid user ID is required")
      .trim()
      .escape(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.getUserById,
);

// Update user role - Super admin only (most sensitive operation)
router.patch(
  "/users/:id/role",
  superAdminOnly,
  [
    param("id")
      .isMongoId()
      .withMessage("Valid user ID is required")
      .trim()
      .escape(),
    body("role")
      .isIn([ROLES.USER, ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN])
      .withMessage("Valid role is required"),
    body("reason")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage("Reason must be 5-500 characters"),
    body("employeeId")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 3, max: 50 })
      .withMessage("Employee ID must be 3-50 characters")
      .custom((value, { req }) => {
        if (req.body.role !== ROLES.USER && !value) {
          throw new Error("Employee ID is required for staff roles");
        }
        return true;
      }),
    body("department")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage("Department must be 2-50 characters")
      .custom((value, { req }) => {
        if (req.body.role !== ROLES.USER && !value) {
          throw new Error("Department is required for staff roles");
        }
        return true;
      }),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.updateUserRole,
);

// Update user status - Admin+ only
router.patch(
  "/users/:id/status",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid user ID is required")
      .trim()
      .escape(),
    body("status")
      .isIn(["active", "suspended", "deactivated", "banned"])
      .withMessage("Valid status is required"),
    body("reason")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage("Reason must be 5-500 characters"),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.updateUserStatus,
);

// Search users - Admin+ only
router.get(
  "/users/search",
  requireMinimumRole(ROLES.ADMIN),
  adminController.searchUsers,
);

// ============ MODERATION TOOLS ============
// Get reports - Moderator+ only
router.get(
  "/reports",
  requireMinimumRole(ROLES.MODERATOR),
  adminController.getReports,
);

// Take action on report - Moderator+ only
router.post(
  "/reports/:id/action",
  requireMinimumRole(ROLES.MODERATOR),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid report ID is required")
      .trim()
      .escape(),
    body("action")
      .isIn(["dismiss", "warn_user", "suspend_user", "remove_content"])
      .withMessage("Valid action is required"),
    body("notes")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 1000 })
      .withMessage("Notes must be less than 1000 characters"),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.takeReportAction,
);

// Content moderation - Moderator+ only
router.delete(
  "/content/:id",
  requireMinimumRole(ROLES.MODERATOR),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid content ID is required")
      .trim()
      .escape(),
    body("reason")
      .isString()
      .trim()
      .isLength({ min: 5, max: 500 })
      .withMessage("Reason must be 5-500 characters"),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.removeContent,
);

// ============ OPTION MANAGEMENT ============
// Get all options - Admin+ only
router.get(
  "/options",
  requireMinimumRole(ROLES.ADMIN),
  adminController.getOptions,
);

router.get(
  "/options/categories",
  requireMinimumRole(ROLES.ADMIN),
  adminController.getCategories,
);

router.get(
  "/options/:id",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid option ID is required")
      .trim()
      .escape(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.getOptionById,
);

// Create option - Admin+ only
router.post(
  "/options",
  requireMinimumRole(ROLES.ADMIN),
  [
    body("key")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Option key is required")
      .isLength({ min: 2, max: 50 })
      .withMessage("Option key must be 2-50 characters"),
    body("value").notEmpty().withMessage("Option value is required"),
    body("category")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 50 })
      .withMessage("Category must be less than 50 characters"),
    body("description")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 255 })
      .withMessage("Description must be less than 255 characters"),
    body("isActive")
      .optional()
      .isBoolean()
      .withMessage("isActive must be a boolean"),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.createOption,
);

// Update option - Admin+ only
router.put(
  "/options/:id",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid option ID is required")
      .trim()
      .escape(),
    body("key")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage("Option key must be 2-50 characters"),
    body("value")
      .optional()
      .notEmpty()
      .withMessage("Option value cannot be empty"),
    body("category")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 50 })
      .withMessage("Category must be less than 50 characters"),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.updateOption,
);

// Delete option - Admin+ only
router.delete(
  "/options/:id",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid option ID is required")
      .trim()
      .escape(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.deleteOption,
);

// ============ SECURITY QUESTIONS MANAGEMENT ============
// GET all security questions - Admin+ only
router.get(
  "/security-questions",
  requireMinimumRole(ROLES.ADMIN),
  adminController.getSecurityQuestions,
);

// GET statistics - Admin+ only
router.get(
  "/security-questions/stats",
  requireMinimumRole(ROLES.ADMIN),
  adminController.getSecurityQuestionStats,
);

// Export questions - Admin+ only
router.get(
  "/security-questions/export",
  requireMinimumRole(ROLES.ADMIN),
  adminController.exportSecurityQuestions,
);

// Bulk import questions - Admin+ only
router.post(
  "/security-questions/import",
  requireMinimumRole(ROLES.ADMIN),
  [
    body("questions")
      .isArray()
      .withMessage("Questions must be an array")
      .isLength({ min: 1, max: 100 })
      .withMessage("Must import between 1 and 100 questions"),
    body("questions.*.question")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Question text is required")
      .isLength({ min: 10, max: 255 })
      .withMessage("Question must be 10-255 characters"),
    body("questions.*.category")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 50 })
      .withMessage("Category must be less than 50 characters"),
    body("questions.*.isActive")
      .optional()
      .isBoolean()
      .withMessage("isActive must be a boolean"),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.bulkImportSecurityQuestions,
);

// GET single question by ID - Admin+ only
router.get(
  "/security-questions/:id",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid security question ID is required")
      .trim()
      .escape(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.getSecurityQuestionById,
);

// Create new question - Admin+ only
router.post(
  "/security-questions",
  requireMinimumRole(ROLES.ADMIN),
  [
    body("question")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Question text is required")
      .isLength({ min: 10, max: 255 })
      .withMessage("Question must be 10-255 characters"),
    body("category")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 50 })
      .withMessage("Category must be less than 50 characters"),
    body("isActive")
      .optional()
      .isBoolean()
      .withMessage("isActive must be a boolean")
      .default(true),
    body("difficulty")
      .optional()
      .isIn(["easy", "medium", "hard"])
      .withMessage("Difficulty must be easy, medium, or hard"),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.createSecurityQuestion,
);

// Update question - Admin+ only
router.put(
  "/security-questions/:id",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid security question ID is required")
      .trim()
      .escape(),
    body("question")
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Question text cannot be empty")
      .isLength({ min: 10, max: 255 })
      .withMessage("Question must be 10-255 characters"),
    body("category")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 50 })
      .withMessage("Category must be less than 50 characters"),
    body("isActive")
      .optional()
      .isBoolean()
      .withMessage("isActive must be a boolean"),
    body("difficulty")
      .optional()
      .isIn(["easy", "medium", "hard"])
      .withMessage("Difficulty must be easy, medium, or hard"),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.updateSecurityQuestion,
);

// Toggle active status - Admin+ only
router.patch(
  "/security-questions/:id/toggle",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid security question ID is required")
      .trim()
      .escape(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.toggleSecurityQuestionStatus,
);

// Delete question - Admin+ only
router.delete(
  "/security-questions/:id",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("id")
      .isMongoId()
      .withMessage("Valid security question ID is required")
      .trim()
      .escape(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.deleteSecurityQuestion,
);

// ============ SYSTEM MANAGEMENT ============
// System configuration - Super admin only
router.get("/system/config", superAdminOnly, adminController.getSystemConfig);

router.get(
  "/system/health",
  requireMinimumRole(ROLES.ADMIN),
  adminController.getSystemHealth,
);

// Update system configuration - Super admin only
router.put(
  "/system/config",
  superAdminOnly,
  [
    body("config").isObject().withMessage("Configuration object is required"),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.updateSystemConfig,
);

// Database operations - Super admin only
router.get(
  "/system/database/backup",
  superAdminOnly,
  adminController.createDatabaseBackup,
);

// Clear cache - Admin+ only
router.post(
  "/system/cache/clear",
  requireMinimumRole(ROLES.ADMIN),
  adminController.clearSystemCache,
);

// ============ AUDIT LOGS ============
// Get audit logs - Admin+ only
router.get(
  "/audit-logs",
  requireMinimumRole(ROLES.ADMIN),
  adminController.getAuditLogs,
);

// Get admin activity logs - Admin+ only
router.get(
  "/admin-activity",
  requireMinimumRole(ROLES.ADMIN),
  adminController.getAdminActivity,
);

// ============ RATE LIMIT STATUS FOR ADMINS ============
router.get(
  "/rate-limit/status",
  requireMinimumRole(ROLES.MODERATOR), // Moderators can check their own limits
  (req, res) => {
    res.json({
      success: true,
      admin: req.user.role !== ROLES.USER,
      userType: req.user.userType,
      userId: req.user.id,
      email: req.user.email,
      role: req.user.role,
      rateLimiting: {
        general: {
          limit: 100,
          window: "15 minutes",
          description: "General API requests",
        },
        options: {
          limit: 30,
          window: "1 minute",
          description: "Option management operations",
        },
        security: {
          limit: 20,
          window: "5 minutes",
          description: "Security question operations (sensitive)",
        },
        importExport: {
          limit: 10,
          window: "10 minutes",
          description: "Import/export operations (resource-intensive)",
        },
        bulk: {
          limit: 5,
          window: "15 minutes",
          description: "Bulk operations",
        },
      },
      currentIp: req.ip,
    });
  },
);

// ============ ROLE-BASED FEATURES ============
// Get role hierarchy and permissions - Admin+ only
router.get("/roles/hierarchy", requireMinimumRole(ROLES.ADMIN), (req, res) => {
  res.json({
    success: true,
    hierarchy: ROLES,
    userTypes: {
      DatingUser: "Regular dating app user",
      Moderator: "Content moderation staff",
      Admin: "Administrative staff",
      SuperAdmin: "System administrator",
    },
    permissions: {
      [ROLES.USER]: "Basic user features",
      [ROLES.MODERATOR]: "Content moderation, reports",
      [ROLES.ADMIN]: "User management, system options",
      [ROLES.SUPER_ADMIN]: "Full system access, role management",
    },
    yourRole: req.user.role,
    yourUserType: req.user.userType,
  });
});

// Get users by role - Admin+ only
router.get(
  "/roles/:role/users",
  requireMinimumRole(ROLES.ADMIN),
  [
    param("role")
      .isIn([ROLES.USER, ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN])
      .withMessage("Valid role is required"),
    (req, res, next) => {
      // Can't view super_admin users unless you're super_admin
      if (
        req.params.role === ROLES.SUPER_ADMIN &&
        req.user.role !== ROLES.SUPER_ADMIN
      ) {
        return res.status(403).json({
          success: false,
          error: "Cannot view super admin users",
        });
      }

      // Can't view admin users unless you're at least admin
      if (
        req.params.role === ROLES.ADMIN &&
        req.user.role !== ROLES.ADMIN &&
        req.user.role !== ROLES.SUPER_ADMIN
      ) {
        return res.status(403).json({
          success: false,
          error: "Cannot view admin users",
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }
      next();
    },
  ],
  adminController.getUsersByRole,
);

// ============ USER TYPE MANAGEMENT ============
// Get user type information - Admin+ only
router.get("/user-types/info", requireMinimumRole(ROLES.ADMIN), (req, res) => {
  res.json({
    success: true,
    userTypes: {
      DatingUser: {
        description: "Regular dating app user",
        requires: ["dateOfBirth", "ageVerified"],
        hasProfile: true,
        hasPreferences: true,
        hasMessaging: true,
        features: ["matching", "messaging", "likes", "profile"],
      },
      Moderator: {
        description: "Content moderation staff",
        requires: ["employeeId", "department"],
        hasProfile: false,
        hasPreferences: false,
        hasMessaging: false,
        features: ["moderation", "reports", "content_removal"],
      },
      Admin: {
        description: "Administrative staff",
        requires: ["employeeId", "department"],
        hasProfile: false,
        hasPreferences: false,
        hasMessaging: false,
        features: ["user_management", "options", "system_config"],
      },
      SuperAdmin: {
        description: "System administrator",
        requires: ["employeeId", "department"],
        hasProfile: false,
        hasPreferences: false,
        hasMessaging: false,
        features: ["full_system_access", "role_management", "database"],
      },
    },
    currentUserType: req.user.userType,
    canChangeUserTypes: req.user.role === ROLES.SUPER_ADMIN,
  });
});

// ============ STAFF MANAGEMENT ============
// Get staff overview - Admin+ only
router.get(
  "/staff/overview",
  requireMinimumRole(ROLES.ADMIN),
  async (req, res) => {
    try {
      const { BaseUser } = require("@models/User");

      // Get staff statistics
      const [totalStaff, activeStaff, moderators, admins, superAdmins] =
        await Promise.all([
          BaseUser.countDocuments({
            userType: { $in: ["Moderator", "Admin", "SuperAdmin"] },
          }),
          BaseUser.countDocuments({
            userType: { $in: ["Moderator", "Admin", "SuperAdmin"] },
            accountStatus: "active",
          }),
          BaseUser.countDocuments({ userType: "Moderator" }),
          BaseUser.countDocuments({ userType: "Admin" }),
          BaseUser.countDocuments({ userType: "SuperAdmin" }),
        ]);

      // Get recent staff activity
      const recentActivity = await BaseUser.find({
        userType: { $in: ["Moderator", "Admin", "SuperAdmin"] },
      })
        .sort({ "presence.lastSeen": -1 })
        .limit(10)
        .select(
          "firstName lastName email userType role presence.lastSeen department",
        );

      res.json({
        success: true,
        stats: {
          totalStaff,
          activeStaff,
          inactiveStaff: totalStaff - activeStaff,
          byType: {
            moderators,
            admins,
            superAdmins,
          },
        },
        recentActivity,
        departments: await BaseUser.aggregate([
          {
            $match: {
              userType: { $in: ["Moderator", "Admin", "SuperAdmin"] },
              department: { $exists: true, $ne: "" },
            },
          },
          { $group: { _id: "$department", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
      });
    } catch (error) {
      console.error("Staff overview error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch staff overview",
      });
    }
  },
);

// ============ ERROR HANDLING ============
router.use((err, req, res, next) => {
  console.error("Admin route error:", {
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    userRole: req.user?.role,
    userType: req.user?.userType,
    error: err.message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });

  if (err.name === "RateLimitError") {
    return res.status(429).json({
      success: false,
      error: err.message,
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: Math.ceil(err.msBeforeNext / 1000),
      userRole: req.user?.role,
      userType: req.user?.userType,
    });
  }

  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      error: "Validation failed",
      details: err.errors || err.message,
      userRole: req.user?.role,
      userType: req.user?.userType,
    });
  }

  if (err.name === "UnauthorizedError") {
    return res.status(403).json({
      success: false,
      error: "Insufficient permissions",
      code: "INSUFFICIENT_PERMISSIONS",
      requiredRole: err.requiredRole,
      userRole: req.user?.role,
      userType: req.user?.userType,
    });
  }

  // Role-specific errors
  if (err.message?.includes("role") || err.message?.includes("admin")) {
    return res.status(403).json({
      success: false,
      error: err.message,
      code: "ROLE_VIOLATION",
      userRole: req.user?.role,
      userType: req.user?.userType,
    });
  }

  // User type specific errors
  if (
    err.message?.includes("user type") ||
    err.message?.includes("DatingUser") ||
    err.message?.includes("staff")
  ) {
    return res.status(403).json({
      success: false,
      error: err.message,
      code: "USER_TYPE_VIOLATION",
      userRole: req.user?.role,
      userType: req.user?.userType,
    });
  }

  res.status(err.status || 500).json({
    success: false,
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
    code: err.code || "INTERNAL_SERVER_ERROR",
    userRole: req.user?.role,
    userType: req.user?.userType,
  });
});

// 404 handler for admin routes
router.use((req, res) => {
  const availableEndpoints = [];

  // Show different endpoints based on user role
  if (req.user?.role === ROLES.SUPER_ADMIN) {
    availableEndpoints.push(
      "/dashboard",
      "/dashboard/metrics",
      "/users",
      "/users/type/:userType",
      "/users/:id/role",
      "/users/:id/status",
      "/users/search",
      "/profiles",
      "/profiles/:id",
      "/profiles/:id/visibility",
      "/dating-profiles",
      "/dating-profiles/:userId",
      "/dating-profiles/:id",
      "/dating-profiles/:id/premium",
      "/reports",
      "/content/:id",
      "/options",
      "/security-questions",
      "/system/config",
      "/system/health",
      "/system/database/backup",
      "/system/cache/clear",
      "/audit-logs",
      "/admin-activity",
      "/rate-limit/status",
      "/roles/hierarchy",
      "/roles/:role/users",
      "/user-types/info",
      "/staff/overview",
      "/invite-codes",
      "/invite-codes/:id",
      "/invite-codes/stats/overview",
      "/health",
    );
  } else if (req.user?.role === ROLES.ADMIN) {
    availableEndpoints.push(
      "/dashboard",
      "/dashboard/metrics",
      "/users",
      "/users/type/:userType",
      "/users/:id/status",
      "/users/search",
      "/profiles",
      "/profiles/:id",
      "/profiles/:id/visibility",
      "/dating-profiles",
      "/dating-profiles/:userId",
      "/dating-profiles/:id",
      "/dating-profiles/:id/premium",
      "/reports",
      "/content/:id",
      "/options",
      "/security-questions",
      "/system/health",
      "/system/cache/clear",
      "/audit-logs",
      "/rate-limit/status",
      "/roles/hierarchy",
      "/user-types/info",
      "/staff/overview",
      "/invite-codes",
      "/invite-codes/:id",
      "/invite-codes/stats/overview",
      "/health",
    );
  } else if (req.user?.role === ROLES.MODERATOR) {
    availableEndpoints.push(
      "/reports",
      "/content/:id",
      "/rate-limit/status",
      "/health",
    );
  } else {
    availableEndpoints.push("/health");
  }

  res.status(404).json({
    success: false,
    error: `Admin route ${req.method} ${req.originalUrl} not found`,
    code: "ADMIN_ENDPOINT_NOT_FOUND",
    userRole: req.user?.role || "none",
    userType: req.user?.userType || "none",
    availableEndpoints,
    note: "Available endpoints vary based on your role and user type",
  });
});

module.exports = router;