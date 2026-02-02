// routes/auth.routes.js - COMPLETE WITH ALL ENDPOINTS
const express = require("express");
const router = express.Router();
const {
  apiLimiter,
  authLimiter,
  registrationLimiter,
  passwordResetLimiter,
  emailResendLimiter,
  profileUpdateLimiter,
  createDynamicRateLimiter,
  rateLimitInfoMiddleware,
  shouldSkipRateLimit,
  ipKeyGenerator,
} = require("@middleware/rateLimit");

const RATE_LIMIT_DISABLED = process.env.DISABLE_RATE_LIMITING === "true";

const AuthController = require("@controllers/auth/AuthController");
const authController = new AuthController();
const userController = require("@controllers/user/UserController");

const securityController = require("@controllers/securityquestion.controller");
const securityMiddleware = require("@middleware/securityMiddleware");

const {
  protect,
  authorize,
  optionalAuth,
  staffOnly,
  authorizeUserType,
  ROLES,
} = require("@middleware/authmiddleware");

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

  resendVerification: createDevelopmentLimiter({
    windowMs: 3600000,
    max: 3,
    message:
      "Too many verification email requests. Please wait before trying again.",
    keyPrefix: "resend_verify",
  }),

  phoneVerification: createDevelopmentLimiter({
    windowMs: 600000,
    max: 5,
    message:
      "Too many phone verification attempts. Please wait before trying again.",
    keyPrefix: "verify_phone",
  }),

  securityQuestion: createDevelopmentLimiter({
    windowMs: 900000,
    max: 50,
    message:
      "Too many security question requests. Please wait before trying again.",
    keyPrefix: "security_q",
  }),

  deleteAccount: createDevelopmentLimiter({
    windowMs: 86400000,
    max: 3,
    message: "Too many account deletion requests. Please wait 24 hours.",
    keyPrefix: "delete_account",
  }),

  staffRegistration: createDevelopmentLimiter({
    windowMs: 86400000,
    max: 3,
    message: "Too many staff registration attempts. Please try again tomorrow.",
    keyPrefix: "staff_reg",
  }),
};

// ========== DEBUG & INFO ENDPOINTS ==========
router.get("/debug-controller", (req, res) => {
  res.json({
    authController: {
      exists: !!authController,
      type: typeof authController,
      constructor: authController?.constructor?.name,
      methods: authController ? Object.keys(authController) : [],
      hasRegister: typeof authController?.register === "function",
      hasLogin: typeof authController?.login === "function",
      hasVerifyEmail: typeof authController?.verifyEmail === "function",
      hasGetCurrentUser: typeof authController?.getCurrentUser === "function",
      hasAdminResetPassword:
        typeof authController?.adminResetPassword === "function",
      hasAdminUnlockAccount:
        typeof authController?.adminUnlockAccount === "function",
      hasRegisterStaff: typeof authController?.registerStaff === "function",
      hasRefreshToken: typeof authController?.refreshToken === "function",
    },
    userController: {
      exists: !!userController,
      type: typeof userController,
      constructor: userController?.constructor?.name,
      methods: userController ? Object.keys(userController) : [],
    },
    middleware: {
      protect: typeof protect,
      optionalAuth: typeof optionalAuth,
      authorize: typeof authorize,
      staffOnly: typeof staffOnly,
      authorizeUserType: typeof authorizeUserType,
    },
    userTypes: {
      DatingUser: "Regular dating user",
      Moderator: "Moderation staff",
      Admin: "Administrative staff",
      SuperAdmin: "System administrator",
    },
  });
});

router.get("/rate-limit-info", (req, res) => {
  const info = {
    environment: process.env.NODE_ENV || "development",
    rateLimiting: {
      disabled: RATE_LIMIT_DISABLED,
      enabled: !RATE_LIMIT_DISABLED,
      config: {
        DISABLE_RATE_LIMITING: process.env.DISABLE_RATE_LIMITING,
        RATE_LIMIT_REGISTRATION_MAX: process.env.RATE_LIMIT_REGISTRATION_MAX,
        RATE_LIMIT_AUTH_MAX: process.env.RATE_LIMIT_AUTH_MAX,
        NODE_ENV: process.env.NODE_ENV,
      },
    },
    client: {
      ip: req.ip,
      forwardedFor: req.headers["x-forwarded-for"],
      userAgent: req.headers["user-agent"]?.substring(0, 100),
      timestamp: new Date().toISOString(),
    },
    limits: {
      registration: parseInt(process.env.RATE_LIMIT_REGISTRATION_MAX) || 5,
      staffRegistration: 3,
      login: parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 10,
      passwordChange: 10,
      adminResetPassword: 5,
      adminUnlockAccount: 10,
      developmentMultiplier: process.env.NODE_ENV === "development" ? 10 : 1,
    },
    userTypes: {
      DatingUser: "Regular user registration",
      Staff: "Moderator/Admin registration (requires invite)",
      All: ["DatingUser", "Moderator", "Admin", "SuperAdmin"],
    },
    endpoints: {
      health: "/api/auth/health",
      test: "/api/auth/test",
      securityQuestion: "/api/auth/security-question",
      register: "/api/auth/register",
      registerStaff: "/api/auth/register/staff",
      adminPasswordReset: "/api/auth/admin/reset-password",
      adminUnlockAccount: "/api/auth/admin/unlock-account",
    },
    troubleshooting: RATE_LIMIT_DISABLED
      ? "Rate limiting is disabled. Enable it in production."
      : "If experiencing rate limits, adjust limits in .env file.",
  };

  res.json(info);
});

router.get("/health", async (req, res) => {
  try {
    // Use the authController's health check method if it exists
    if (typeof authController.healthCheck === "function") {
      return authController.healthCheck(req, res);
    }
    
    // Fallback health check
    res.json({
      success: true,
      status: "healthy",
      service: "auth",
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || "1.0.0",
      rateLimiting: RATE_LIMIT_DISABLED ? "disabled" : "enabled",
      userTypes: {
        supported: ["DatingUser", "Moderator", "Admin", "SuperAdmin"],
        default: "DatingUser",
        staffTypes: ["Moderator", "Admin", "SuperAdmin"],
      },
      security: {
        questionsEnabled: process.env.SECURITY_QUESTIONS_ENABLED === "true",
        encryptionEnabled: process.env.ENABLE_END_TO_END_ENCRYPTION === "true",
        ageVerification: process.env.AGE_VERIFICATION_REQUIRED === "true",
        passwordResetEnabled: true,
        adminResetEnabled: true,
        accountUnlockEnabled: true,
        staffInviteRequired: true,
      },
      registrationFlow: {
        datingUsers: "Requires security question verification",
        staffUsers: "Requires invite code",
        steps: {
          dating: [
            "1. GET /api/auth/security-question",
            "2. POST /api/auth/validate-answer",
            "3. POST /api/auth/register with sessionId"
          ],
          staff: [
            "1. Obtain invite code",
            "2. POST /api/auth/register with inviteCode"
          ]
        }
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

router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Auth API is working",
    timestamp: new Date().toISOString(),
    cors: {
      origin: req.headers.origin || "none",
      allowed: true,
    },
    features: {
      registration: {
        datingUsers: true,
        staffUsers: true,
        inviteRequiredForStaff: true,
        securityQuestionRequiredForDating: true,
      },
      login: true,
      passwordManagement: {
        changePassword: true,
        forgotPassword: true,
        resetPassword: true,
        adminResetPassword: true,
        adminUnlockAccount: true,
      },
      securityQuestions: process.env.SECURITY_QUESTIONS_ENABLED === "true",
      encryption: process.env.ENABLE_END_TO_END_ENCRYPTION === "true",
      userTypes: {
        DatingUser: "Dating app user (requires security verification)",
        Staff: "Staff member (Moderator/Admin - requires invite)",
      },
    },
  });
});

// ========== SECURITY QUESTION ENDPOINTS ==========
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

// ========== SINGLE REGISTRATION ENDPOINT (UPDATED) ==========
router.post("/register", rateLimits.registration, (req, res) => {
  console.log("📝 /register endpoint called with body:", req.body);
  
  const { sessionId, inviteCode, role = 'user' } = req.body;
  
  // Normalize role to lowercase for consistent checking
  const normalizedRole = role.toString().toLowerCase();
  console.log(`👤 Registration role: ${normalizedRole} (defaulted if not provided)`);
  
  // Determine registration type
  let registrationType;
  
  // STAFF: Must have inviteCode AND staff role (moderator/admin/super_admin)
  const isStaffRole = ['moderator', 'admin', 'super_admin'].includes(normalizedRole);
  
  if (inviteCode && isStaffRole) {
    registrationType = 'staff';
    console.log("👔 Staff registration detected");
    
    // Validate staff fields
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
  }
  // DATING: Everyone else (including default 'user' role)
  else {
    registrationType = 'dating';
    console.log("💑 Dating registration detected");
    
    // All dating users require sessionId
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
        example: {
          validateAnswer: {
            questionId: "math_001",
            answer: "8"
          },
          register: {
            sessionId: "received-from-step2",
            email: "user@example.com",
            password: "SecurePass123!",
            firstName: "John",
            lastName: "Doe",
            dateOfBirth: "1990-01-01",
            userName: "johndoe" // optional
          }
        },
        note: "All dating users must answer a security question before registration"
      });
    }
  }
  
  // Ensure role is set in request body
  req.body.role = normalizedRole;
  
  // Pass registration type to controller
  req.registrationType = registrationType;
  
  // Call the controller
  return authController.register(req, res);
});

// ========== LEGACY STAFF REGISTRATION (BACKWARD COMPATIBILITY) ==========
router.post("/register/staff", rateLimits.staffRegistration, (req, res) => {
  console.log("👔 /register/staff (legacy) route called");
  
  // Mark as staff registration
  req.registrationType = 'staff';
  
  // Ensure role is set if not provided
  if (!req.body.role) {
    req.body.role = 'moderator'; // Default staff role
  }
  
  return authController.register(req, res);
});

// ========== AUTHENTICATION ENDPOINTS ==========
router.post("/login", rateLimits.login, (req, res) => {
  return authController.login(req, res);
});

router.post("/logout", optionalAuth, (req, res) => {
  return authController.logout(req, res);
});

router.post("/refresh-token", apiLimiter, (req, res) => {
  return authController.refreshToken(req, res);
});

// ========== EMAIL VERIFICATION ENDPOINTS ==========
router.get("/verify-email/:token", apiLimiter, (req, res) => {
  return authController.verifyEmail(req, res);
});

// ========== PASSWORD MANAGEMENT ENDPOINTS ==========
router.post("/forgot-password", rateLimits.forgotPassword, (req, res) => {
  return authController.forgotPassword(req, res);
});

router.post("/reset-password", apiLimiter, (req, res) => {
  return authController.resetPassword(req, res);
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

// ========== GET CURRENT USER ENDPOINT ==========
router.get("/me", apiLimiter, protect, (req, res) => {
  return authController.getCurrentUser(req, res);
});

// ========== PROTECTED ENDPOINTS (REQUIRE AUTHENTICATION) ==========
router.use(protect);
router.use(rateLimitInfoMiddleware);

// Get user by ID (with permission checks)
router.get("/user/:id", apiLimiter, (req, res) => {
  if (!userController || typeof userController.getUserById !== "function") {
    return res.status(500).json({
      success: false,
      error: "User controller not properly loaded",
    });
  }
  return userController.getUserById(req, res);
});

// Get users list (with filtering)
router.get("/users", apiLimiter, (req, res) => {
  if (!userController || typeof userController.getUsers !== "function") {
    return res.status(500).json({
      success: false,
      error: "User controller not properly loaded",
    });
  }
  return userController.getUsers(req, res);
});

router.put("/profile", profileUpdateLimiter, (req, res) => {
  if (!userController || typeof userController.updateProfile !== "function") {
    return res.status(500).json({
      success: false,
      error: "User controller not properly loaded",
    });
  }
  return userController.updateProfile(req, res);
});

// Update private info (first name, last name, phone)
router.put("/profile/private", profileUpdateLimiter, (req, res) => {
  if (
    !userController ||
    typeof userController.updatePrivateInfo !== "function"
  ) {
    return res.status(500).json({
      success: false,
      error: "User controller not properly loaded",
    });
  }
  return userController.updatePrivateInfo(req, res);
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

// ========== PASSWORD CHANGE (USER INITIATED) ==========
router.put("/change-password", rateLimits.passwordChange, (req, res) => {
  return authController.changePassword(req, res);
});

router.put("/presence", apiLimiter, (req, res) => {
  if (userController && typeof userController.updatePresence === "function") {
    return userController.updatePresence(req, res);
  } else if (
    authController &&
    typeof authController.updatePresence === "function"
  ) {
    return authController.updatePresence(req, res);
  }
  return res.status(501).json({
    success: false,
    error: "Presence update not implemented",
  });
});

router.delete("/account", rateLimits.deleteAccount, (req, res) => {
  if (!userController || typeof userController.deleteAccount !== "function") {
    return res.status(500).json({
      success: false,
      error: "User controller not properly loaded",
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

// ========== ADMIN ENDPOINTS ==========

// Admin password reset (no token needed)
router.post(
  "/admin/reset-password",
  authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  rateLimits.adminResetPassword,
  (req, res) => {
    if (
      !authController ||
      typeof authController.adminResetPassword !== "function"
    ) {
      return res.status(501).json({
        success: false,
        error: "Admin password reset not implemented",
      });
    }
    return authController.adminResetPassword(req, res);
  },
);

// Admin account unlock
router.post(
  "/admin/unlock-account",
  authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  rateLimits.adminUnlockAccount,
  (req, res) => {
    if (
      !authController ||
      typeof authController.adminUnlockAccount !== "function"
    ) {
      return res.status(501).json({
        success: false,
        error: "Admin account unlock not implemented",
      });
    }
    return authController.adminUnlockAccount(req, res);
  },
);

// Staff management endpoints
router.get(
  "/admin/users",
  authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MODERATOR),
  apiLimiter,
  async (req, res) => {
    res.json({
      success: true,
      message:
        "Admin user list endpoint - Use /api/admin/users for full admin features",
      endpoints: {
        adminResetPassword: "POST /api/auth/admin/reset-password",
        adminUnlockAccount: "POST /api/auth/admin/unlock-account",
        listUsers: "GET /api/admin/users",
        userManagement: "GET /api/admin/users/:id",
      },
      note: "For full user management, use the admin routes at /api/admin",
    });
  },
);

// ========== USER TYPE SPECIFIC ENDPOINTS ==========

// Dating user specific endpoints
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
      note: "Dating user specific endpoint",
    });
  },
);

// Staff user specific endpoints
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
    access: {
      adminDashboard:
        req.user.role === ROLES.ADMIN || req.user.role === ROLES.SUPER_ADMIN,
      moderationTools:
        req.user.role === ROLES.MODERATOR ||
        req.user.role === ROLES.ADMIN ||
        req.user.role === ROLES.SUPER_ADMIN,
      systemManagement: req.user.role === ROLES.SUPER_ADMIN,
    },
  });
});

// ========== DEVELOPMENT ENDPOINTS ==========
if (process.env.NODE_ENV === "development") {
  router.get("/debug/auth", (req, res) => {
    res.json({
      success: true,
      user: req.user || null,
      auth: req.auth || null,
      headers: {
        origin: req.headers.origin,
        authorization: req.headers.authorization ? "Present" : "Missing",
        "user-agent": req.headers["user-agent"]?.substring(0, 100),
      },
      cookies: Object.keys(req.cookies || {}),
      rateLimit: req.rateLimit || null,
      timestamp: new Date().toISOString(),
    });
  });

  router.get(
    "/test/rate-limit",
    createDevelopmentLimiter({
      windowMs: 60000,
      max: 5,
      message: "Test rate limit hit",
      keyPrefix: "test_limit",
    }),
    (req, res) => {
      res.json({
        success: true,
        message: "Rate limit test passed",
        remaining: req.rateLimit?.remaining || "unknown",
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });
    },
  );

  // Development endpoint to test security question flow
  router.post("/test/security-flow", apiLimiter, async (req, res) => {
    try {
      const { email, firstName, lastName, password, dateOfBirth } = req.body;
      
      // Step 1: Get security question
      const questionRes = await securityController.getQuestion(req, res);
      if (!questionRes.success) {
        return res.status(400).json({
          success: false,
          error: "Failed to get security question"
        });
      }
      
      const { sessionId, question } = questionRes.data;
      
      // Step 2: Simulate answer (for testing, use correct answer)
      const testAnswer = "8"; // For math_001 question
      const validateRes = await securityController.validateAnswer({
        body: { sessionId, questionId: question.id, answer: testAnswer }
      }, res);
      
      if (!validateRes.success) {
        return res.status(400).json({
          success: false,
          error: "Failed to validate answer"
        });
      }
      
      const validatedSessionId = validateRes.data.sessionId;
      
      // Step 3: Test registration with sessionId
      const testReq = {
        body: {
          email: email || "test@example.com",
          password: password || "TestPass123!",
          firstName: firstName || "Test",
          lastName: lastName || "User",
          dateOfBirth: dateOfBirth || "1990-01-01",
          sessionId: validatedSessionId
        }
      };
      
      return authController.register(testReq, res);
      
    } catch (error) {
      res.status(500).json({ success: false, error: error.message, testMode: true });
    }
  });

  // Development endpoint to test staff registration
  router.post("/test/staff-registration", apiLimiter, async (req, res) => {
    try {
      const { email, firstName, lastName, password, inviteCode } = req.body;
      
      const testReq = {
        body: {
          email: email || "staff@company.com",
          password: password || "StaffPass123!",
          firstName: firstName || "Staff",
          lastName: lastName || "Member",
          role: "admin",
          inviteCode: inviteCode || "TEST_INVITE_123",
          employeeId: "DEV001",
          department: "Development",
          jobTitle: "Developer"
        }
      };
      
      testReq.registrationType = 'staff';
      
      return authController.register(testReq, res);
      
    } catch (error) {
      res.status(500).json({ success: false, error: error.message, testMode: true });
    }
  });
}

// ========== 404 HANDLER ==========
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Auth endpoint not found",
    path: req.path,
    method: req.method,
    userType: req.user?.userType,
    availableEndpoints: {
      public: [
        "GET /api/auth/security-question (for dating users)",
        "POST /api/auth/validate-answer (for dating users)",
        "POST /api/auth/register (for all users)",
        "POST /api/auth/register/staff (legacy staff registration)",
        "POST /api/auth/login",
        "POST /api/auth/logout",
        "POST /api/auth/forgot-password",
        "POST /api/auth/reset-password",
        "POST /api/auth/refresh-token",
        "GET /api/auth/verify-email/:token",
        "POST /api/auth/resend-verification-email",
        "GET /api/auth/health",
        "GET /api/auth/test",
        "GET /api/auth/rate-limit-info",
        "GET /api/auth/debug-controller",
      ],
      protected: [
        "GET /api/auth/me",
        "GET /api/auth/user/:id",
        "GET /api/auth/users",
        "PUT /api/auth/profile",
        "PUT /api/auth/profile/private",
        "GET /api/auth/settings",
        "PUT /api/auth/settings",
        "PUT /api/auth/change-password",
        "PUT /api/auth/presence",
        "DELETE /api/auth/account",
        "GET /api/auth/export-data",
        "GET /api/auth/dating/profile (DatingUser only)",
        "GET /api/auth/staff/info (Staff only)",
      ],
      admin: [
        "POST /api/auth/admin/reset-password",
        "POST /api/auth/admin/unlock-account",
        "GET /api/auth/admin/users",
      ],
    },
    registrationInstructions: {
      datingUsers: [
        "1. GET /api/auth/security-question",
        "2. POST /api/auth/validate-answer with {questionId, answer}",
        "3. POST /api/auth/register with returned sessionId"
      ],
      staffUsers: [
        "1. Obtain invite code from administrator",
        "2. POST /api/auth/register with inviteCode and staff role"
      ]
    },
    timestamp: new Date().toISOString(),
  });
});

// ========== ERROR HANDLER ==========
router.use((err, req, res, next) => {
  console.error("❌ Route error:", err);

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

  // Handle user type errors
  if (
    err.message?.includes("user type") ||
    err.message?.includes("staff") ||
    err.message?.includes("dating")
  ) {
    return res.status(403).json({
      success: false,
      error: err.message,
      code: "USER_TYPE_ERROR",
      userType: req.user?.userType,
      timestamp: new Date().toISOString(),
    });
  }

  // Handle security session errors
  if (err.message?.includes("session") || err.message?.includes("security")) {
    return res.status(403).json({
      success: false,
      error: err.message,
      code: "SECURITY_ERROR",
      timestamp: new Date().toISOString(),
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