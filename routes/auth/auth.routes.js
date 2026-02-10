// routes/auth.routes.js - FIXED WITH CORRECT IMPORTS AND RATE LIMITS
const express = require("express");
const router = express.Router();
const {
  apiLimiter,
  createDynamicRateLimiter,
  rateLimitInfoMiddleware,
  shouldSkipRateLimit,
  ipKeyGenerator,
} = require("@middleware/rateLimit");

const RATE_LIMIT_DISABLED = process.env.DISABLE_RATE_LIMITING === "true";

const AuthController = require("@controllers/auth/AuthController");
const authController = new AuthController();
const UserController = require("@controllers/user/UserController");
const userController = new UserController(); 

const securityController = require("@controllers/securityquestion.controller");

const {
  protect,
  authorize,
  optionalAuth,
  staffOnly,
  authorizeUserType,
  ROLES,
} = require("@middleware/authmiddleware");

// FIX 1: Use correct profile controller path
const profileController = require("@controllers/profile/profile.controller");

const createDevelopmentLimiter = (options) => {
  if (RATE_LIMIT_DISABLED) {
    return (req, res, next) => next();
  }

  const isDevelopment = process.env.NODE_ENV === "development";
  const devMultiplier = 10;

  return createDynamicRateLimiter({
    ...options,
    max: isDevelopment ? options.max * devMultiplier : options.max,
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req);
      const isLocalhost =
        ip === "127.0.0.1" || ip === "::1" || ip.includes("localhost");

      if (isDevelopment && isLocalhost) {
        return `${options.keyPrefix || "dev"}:localhost`;
      }

      return options.keyGenerator ? options.keyGenerator(req) : req.ip;
    },
    skip: (req) => {
      if (
        isDevelopment &&
        req.headers["x-development-token"] ===
          process.env.DEVELOPMENT_BYPASS_TOKEN
      ) {
        return true;
      }

      return shouldSkipRateLimit(req) || (options.skip && options.skip(req));
    },
  });
};

// Rate limits for auth routes only - COMPLETE WITH ALL DEFINITIONS
const rateLimits = {
  registration: createDevelopmentLimiter({
    windowMs:
      parseInt(process.env.RATE_LIMIT_REGISTRATION_WINDOW_MS) || 86400000,
    max: parseInt(process.env.RATE_LIMIT_REGISTRATION_MAX) || 5,
    message: "Too many registration attempts. Please try again tomorrow.",
    keyPrefix: "reg",
  }),

  login: createDevelopmentLimiter({
    windowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS) || 3600000,
    max: parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 10,
    message: "Too many login attempts. Please wait before trying again.",
    skipSuccessfulRequests: true,
    keyPrefix: "login",
  }),

  forgotPassword: createDevelopmentLimiter({
    windowMs: 3600000,
    max: 5,
    message:
      "Too many password reset requests. Please wait before trying again.",
    keyPrefix: "forgot_password",
  }),

  passwordChange: createDevelopmentLimiter({
    windowMs: 3600000,
    max: 10,
    message:
      "Too many password change attempts. Please wait before trying again.",
    keyPrefix: "password_change",
  }),

  resendVerification: createDevelopmentLimiter({
    windowMs: 3600000,
    max: 3,
    message:
      "Too many verification email requests. Please wait before trying again.",
    keyPrefix: "resend_verify",
  }),

  // ====== ADDED MISSING RATE LIMIT DEFINITIONS ======
  securityQuestion: createDevelopmentLimiter({
    windowMs: 900000, // 15 minutes
    max: 50,
    message:
      "Too many security question requests. Please wait before trying again.",
    keyPrefix: "security_q",
  }),

  staffRegistration: createDevelopmentLimiter({
    windowMs: 86400000, // 24 hours
    max: 3,
    message: "Too many staff registration attempts. Please try again tomorrow.",
    keyPrefix: "staff_reg",
  }),

  adminResetPassword: createDevelopmentLimiter({
    windowMs: 3600000,
    max: 5,
    message:
      "Too many admin password reset attempts. Please wait before trying again.",
    keyPrefix: "admin_reset_password",
  }),

  adminUnlockAccount: createDevelopmentLimiter({
    windowMs: 3600000,
    max: 10,
    message:
      "Too many account unlock attempts. Please wait before trying again.",
    keyPrefix: "unlock_account",
  }),

  deleteAccount: createDevelopmentLimiter({
    windowMs: 86400000,
    max: 3,
    message: "Too many account deletion requests. Please wait 24 hours.",
    keyPrefix: "delete_account",
  }),
  // ================================================
};

// ========== HEALTH CHECK (PUBLIC) ==========
router.get("/health", async (req, res) => {
  try {
    if (typeof authController.healthCheck === "function") {
      return authController.healthCheck(req, res);
    }
    
    res.json({
      success: true,
      status: "healthy",
      service: "auth",
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || "1.0.0",
      relatedServices: {
        profile: "Available at /api/v1/profile",
        dating: "Coming soon"
      }
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: "unhealthy",
      error: error.message,
      service: "auth",
      timestamp: new Date().toISOString(),
    });
  }
});

// ========== SECURITY QUESTION ENDPOINTS (PUBLIC) ==========
router.get(
  "/security-question",
  rateLimits.securityQuestion,
  securityController.getQuestion,
);

router.post(
  "/validate-answer",
  rateLimits.securityQuestion,
  securityController.validateAnswer,
);

// ========== SINGLE REGISTRATION ENDPOINT (PUBLIC) ==========
router.post("/register", rateLimits.registration, (req, res) => {
  console.log("📝 /register endpoint called with body:", req.body);
  
  const { sessionId, inviteCode, role = 'user' } = req.body;
  
  const normalizedRole = role.toString().toLowerCase();
  console.log(`👤 Registration role: ${normalizedRole}`);
  
  let registrationType;
  const isStaffRole = ['moderator', 'admin', 'super_admin'].includes(normalizedRole);
  
  if (inviteCode && isStaffRole) {
    registrationType = 'staff';
    console.log("👔 Staff registration detected");
    
    const { employeeId, department, jobTitle } = req.body;
    if (!employeeId || !department || !jobTitle) {
      return res.status(400).json({
        success: false,
        error: "Staff registration requires employee information",
        missingFields: {
          employeeId: !employeeId,
          department: !department, 
          jobTitle: !jobTitle
        },
        requiredForStaff: ["inviteCode", "employeeId", "department", "jobTitle"],
        example: {
          firstName: "John",
          lastName: "Doe",
          email: "john.doe@company.com",
          password: "SecurePass123!",
          role: "admin",
          inviteCode: "ABC123DEF456",
          employeeId: "EMP001",
          department: "Engineering",
          jobTitle: "Senior Developer"
        }
      });
    }
  } else {
    registrationType = 'dating';
    console.log("💑 Dating registration detected");
    
    if (!sessionId) {
      return res.status(403).json({
        success: false,
        error: "Security verification required for dating user registration",
        role: normalizedRole,
        required: "sessionId",
        howToGetSessionId: {
          step1: "GET /api/auth/security-question",
          step2: "POST /api/auth/validate-answer with {questionId, answer}",
          step3: "Use returned sessionId in registration"
        },
        note: "After registration, create profile at /api/v1/profile/create"
      });
    }
  }
  
  req.body.role = normalizedRole;
  req.registrationType = registrationType;
  
  return authController.register(req, res);
});

// ========== LEGACY STAFF REGISTRATION (PUBLIC) ==========
router.post("/register/staff", rateLimits.staffRegistration, (req, res) => {
  console.log("👔 /register/staff (legacy) route called");
  
  req.registrationType = 'staff';
  
  if (!req.body.role) {
    req.body.role = 'moderator';
  }
  
  return authController.register(req, res);
});

// ========== AUTHENTICATION ENDPOINTS (PUBLIC) ==========
router.post("/login", rateLimits.login, (req, res) => {
  return authController.login(req, res);
});

router.post("/logout", optionalAuth, (req, res) => {
  return authController.logout(req, res);
});

router.post("/refresh-token", apiLimiter, (req, res) => {
  return authController.refreshToken(req, res);
});

// ========== EMAIL VERIFICATION ENDPOINTS (PUBLIC) ==========
router.get("/verify-email/:token", apiLimiter, (req, res) => {
  return authController.verifyEmail(req, res);
});

router.post("/resend-verification-email", rateLimits.resendVerification, (req, res) => {
  if (typeof authController.resendVerificationEmail === "function") {
    return authController.resendVerificationEmail(req, res);
  }
  return res.status(501).json({
    success: false,
    error: "Resend verification email not implemented",
  });
});

// ========== PASSWORD MANAGEMENT ENDPOINTS (PUBLIC) ==========
router.post("/forgot-password", rateLimits.forgotPassword, (req, res) => {
  return authController.forgotPassword(req, res);
});

router.post("/reset-password", apiLimiter, (req, res) => {
  return authController.resetPassword(req, res);
});

// ========== GET CURRENT USER ENDPOINT (PROTECTED) ==========
router.get("/me", apiLimiter, protect, (req, res) => {
  return authController.getCurrentUser(req, res);
});

// ========== PASSWORD CHANGE (PROTECTED) ==========
router.put("/change-password", rateLimits.passwordChange, protect, (req, res) => {
  return authController.changePassword(req, res);
});

// ========== SIMPLE PROFILE CREATION REDIRECT (PROTECTED) ==========
// NOTE: Full profile management is in /api/v1/profile routes
router.post("/profile", protect, (req, res) => {
  // Redirect to profile service
  return res.status(307).json({
    success: true,
    message: "Profile creation has moved",
    redirect: {
      url: "/api/v1/profile/create",
      method: "POST",
      note: "Please use the dedicated profile service for all profile operations"
    },
    availableEndpoints: {
      createProfile: "POST /api/v1/profile/create",
      getProfile: "GET /api/v1/profile/me",
      updateProfile: "PUT /api/v1/profile/update"
    }
  });
});

// ========== APPLY PROTECT MIDDLEWARE FOR ROUTES BELOW ==========
router.use(protect);
router.use(rateLimitInfoMiddleware);

// ========== USER MANAGEMENT ENDPOINTS (PROTECTED) ==========
router.get("/user/:id", apiLimiter, (req, res) => {
  if (!userController || typeof userController.getUserById !== "function") {
    return res.status(500).json({
      success: false,
      error: "User controller not properly loaded",
    });
  }
  return userController.getUserById(req, res);
});

router.get("/users", apiLimiter, (req, res) => {
  if (!userController || typeof userController.getUsers !== "function") {
    return res.status(500).json({
      success: false,
      error: "User controller not properly loaded",
    });
  }
  return userController.getUsers(req, res);
});

router.put("/profile/private", apiLimiter, (req, res) => {
  if (userController && typeof userController.updatePrivateInfo === "function") {
    return userController.updatePrivateInfo(req, res);
  }
  return res.status(500).json({
    success: false,
    error: "User controller not properly loaded",
  });
});

router.get("/settings", apiLimiter, (req, res) => {
  if (!userController || typeof userController.getSettings !== "function") {
    return res.status(500).json({
      success: false,
      error: "User controller not properly loaded",
    });
  }
  return userController.getSettings(req, res);
});

router.put("/settings", apiLimiter, (req, res) => {
  if (!userController || typeof userController.updateSettings !== "function") {
    return res.status(500).json({
      success: false,
      error: "User controller not properly loaded",
    });
  }
  return userController.updateSettings(req, res);
});

router.put("/presence", apiLimiter, (req, res) => {
  if (userController && typeof userController.updatePresence === "function") {
    return userController.updatePresence(req, res);
  }
  return res.status(501).json({
    success: false,
    error: "Presence update not implemented",
  });
});

router.delete("/account", apiLimiter, protect, (req, res) => {
  // Log the request for debugging
  console.log('DELETE /account request:', {
    body: req.body,
    user: req.user?.id,
    method: req.method
  });
  
  if (!userController || typeof userController.deleteAccount !== "function") {
    return res.status(500).json({
      success: false,
      error: "User controller not properly loaded",
    });
  }
  
  // If no body, prompt for password
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({
      success: false,
      error: "Password verification required",
      instructions: "Send DELETE request with JSON body: {\"password\": \"your-password\"}",
      example: "curl -X DELETE -H 'Content-Type: application/json' -d '{\"password\":\"your-password\"}' http://localhost:3000/api/auth/account"
    });
  }
  
  return userController.deleteAccount(req, res);
});

router.get("/export-data", apiLimiter, (req, res) => {
  if (!userController || typeof userController.exportData !== "function") {
    return res.status(500).json({
      success: false,
      error: "User controller not properly loaded",
    });
  }
  return userController.exportData(req, res);
});

// ========== USER TYPE SPECIFIC ENDPOINTS (PROTECTED) ==========
router.get(
  "/dating/profile",
  authorizeUserType("DatingUser"),
  apiLimiter,
  async (req, res) => {
    res.json({
      success: true,
      userType: req.user.userType,
      features: {
        datingProfile: true,
        matching: true,
        messaging: true,
        preferences: true,
      },
      note: "Use /api/dating endpoints for dating-specific features",
    });
  },
);

router.get("/staff/info", staffOnly, apiLimiter, async (req, res) => {
  res.json({
    success: true,
    userType: req.user.userType,
    role: req.user.role,
    features: {
      moderation: req.user.role === ROLES.MODERATOR,
      userManagement:
        req.user.role === ROLES.ADMIN || req.user.role === ROLES.SUPER_ADMIN,
      systemConfig: req.user.role === ROLES.SUPER_ADMIN,
      reports:
        req.user.role === ROLES.MODERATOR ||
        req.user.role === ROLES.ADMIN ||
        req.user.role === ROLES.SUPER_ADMIN,
    },
  });
});

// ========== ADMIN ENDPOINTS (PROTECTED + AUTHORIZED) ==========
router.post(
  "/admin/reset-password",
  authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  rateLimits.adminResetPassword,
  (req, res) => {
    if (userController && typeof userController.adminResetPassword === "function") {
      return userController.adminResetPassword(req, res);
    } else if (authController && typeof authController.adminResetPassword === "function") {
      return authController.adminResetPassword(req, res);
    }
    return res.status(501).json({
      success: false,
      error: "Admin password reset not implemented",
    });
  },
);

router.post(
  "/admin/unlock-account",
  authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  rateLimits.adminUnlockAccount,
  (req, res) => {
    if (userController && typeof userController.adminUnlockAccount === "function") {
      return userController.adminUnlockAccount(req, res);
    } else if (authController && typeof authController.adminUnlockAccount === "function") {
      return authController.adminUnlockAccount(req, res);
    }
    return res.status(501).json({
      success: false,
      error: "Admin account unlock not implemented",
    });
  },
);

// ========== ADMIN REACTIVATION ENDPOINTS ==========

// Get list of deactivated users
router.get(
  "/admin/deactivated-users",
  authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  apiLimiter,
  (req, res) => {
    if (!userController || typeof userController.adminGetDeactivatedUsers !== "function") {
      return res.status(500).json({
        success: false,
        error: "User controller not properly loaded",
      });
    }
    return userController.adminGetDeactivatedUsers(req, res);
  }
);

// Reactivate a deactivated account
router.post(
  "/admin/reactivate-account",
  authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  apiLimiter,
  (req, res) => {
    if (!userController || typeof userController.adminReactivateAccount !== "function") {
      return res.status(500).json({
        success: false,
        error: "User controller not properly loaded",
      });
    }
    return userController.adminReactivateAccount(req, res);
  }
);

// Get reactivation history for a user
router.get(
  "/admin/reactivation-history/:targetUserId",
  authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  apiLimiter,
  (req, res) => {
    if (!userController || typeof userController.adminGetReactivationHistory !== "function") {
      return res.status(500).json({
        success: false,
        error: "User controller not properly loaded",
      });
    }
    return userController.adminGetReactivationHistory(req, res);
  }
);

// ========== 404 HANDLER ==========
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Auth endpoint not found",
    path: req.path,
    method: req.method,
    availableEndpoints: {
      public: [
        "GET /api/auth/security-question",
        "POST /api/auth/validate-answer",
        "POST /api/auth/register",
        "POST /api/auth/register/staff",
        "POST /api/auth/login",
        "POST /api/auth/logout",
        "POST /api/auth/forgot-password",
        "POST /api/auth/reset-password",
        "POST /api/auth/refresh-token",
        "GET /api/auth/verify-email/:token",
        "POST /api/auth/resend-verification-email",
        "GET /api/auth/health",
      ],
      protected: [
        "GET /api/auth/me",
        "PUT /api/auth/change-password",
        "GET /api/auth/user/:id",
        "GET /api/auth/users",
        "PUT /api/auth/profile/private",
        "GET /api/auth/settings",
        "PUT /api/auth/settings",
        "PUT /api/auth/presence",
        "DELETE /api/auth/account",
        "GET /api/auth/export-data",
        "GET /api/auth/dating/profile",
        "GET /api/auth/staff/info",
      ],
      admin: [
        "POST /api/auth/admin/reset-password",
        "POST /api/auth/admin/unlock-account",
      ],
    },
    profileEndpoints: "Use /api/v1/profile for all profile operations",
    registrationInstructions: {
      flow: [
        "1. GET /api/auth/security-question",
        "2. POST /api/auth/validate-answer",
        "3. POST /api/auth/register (creates BaseUser)",
        "4. POST /api/v1/profile/create (creates Profile)",
        "5. Use /api/v1/profile for all profile management"
      ]
    },
    timestamp: new Date().toISOString(),
  });
});

// ========== ERROR HANDLER ==========
router.use((err, req, res, next) => {
  console.error("❌ Auth route error:", err);

  if (err.type === "RateLimitError") {
    return res.status(429).json({
      success: false,
      error: "Rate limit exceeded",
      code: "RATE_LIMIT_EXCEEDED",
      message: err.message,
      path: req.path,
      retryAfter: err.retryAfter,
      userType: req.user?.userType,
      timestamp: new Date().toISOString(),
    });
  }

  // Handle body parsing errors
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      error: "Invalid JSON in request body",
    });
  }

  res.status(err.status || 500).json({
    success: false,
    error:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal server error",
    path: req.path,
    userType: req.user?.userType,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;