<<<<<<< HEAD
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

// ============ DISABLE RATE LIMITING FOR TESTING ============
const RATE_LIMIT_DISABLED = process.env.DISABLE_RATE_LIMITING === 'true';

// ============ CONTROLLER IMPORTS ============
const {
  register,
  registerSecure, 
  login,
  logout,
  refreshToken,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyEmail,
  verifyPhone,
  resendVerificationEmail,
  getMe,
  updateProfile,
  updateSettings
} = require("@controllers");

// ============ SECURITY QUESTION IMPORTS ============
const securityController = require("../controllers/securityquestion.controller");
const securityMiddleware = require("../middleware/securityMiddleware");

// ============ MIDDLEWARE IMPORTS ============
const { protect } = require("@middleware/authmiddleware");

// ============ HELPER FUNCTIONS ============
const createLimiter = (windowMs, max, message, endpoint = '') => {
  if (RATE_LIMIT_DISABLED) {
    return (req, res, next) => next();
  }

  const isDevelopment = process.env.NODE_ENV === 'development';

  return rateLimit({
    windowMs,
    max: isDevelopment ? max * 10 : max, // Higher multiplier for development
    message: {
      success: false,
      error: message,
      limitInfo: `Rate limit exceeded. Max ${isDevelopment ? max * 10 : max} requests per ${windowMs / (60 * 1000)} minutes`,
      endpoint: endpoint,
      timestamp: new Date().toISOString()
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => {
      // Use only IP address for rate limiting
      let ip = req.ip;
      if (ip && ip.includes('::ffff:')) {
        ip = ip.replace('::ffff:', '');
      }
      // For localhost in development, use a shared key
      if (isDevelopment && (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost')) {
        return 'development-localhost';
      }
      return ip;
    },
    handler: (req, res, next, options) => {
      if (isDevelopment) {
        console.log(`[RATE LIMIT DEBUG] ${req.ip} exceeded limit for ${req.path}`);
        console.log(`  Key: ${options.keyGenerator(req, res)}`);
        console.log(`  Time: ${new Date().toISOString()}`);
      }
      res.status(options.statusCode).json(options.message);
    },
    // Skip health and debug endpoints
    skip: (req) => {
      const skipPaths = ['/api/auth/health', '/api/auth/rate-limit-info', '/api/auth/debug-limits', '/api/auth/test-simple'];
      return skipPaths.some(path => req.path === path);
    }
  });
};

// ============ RATE LIMIT CONFIGURATIONS ============
// Using HIGH limits for development as per your .env
const rateLimits = {
  register: createLimiter(24 * 60 * 60 * 1000, parseInt(process.env.REGISTRATION_RATE_LIMIT_MAX) || 100, "Too many registration attempts. Please try again tomorrow.", 'register'),
  login: createLimiter(60 * 60 * 1000, 50, "Too many login attempts. Please wait before trying again.", 'login'),
  forgotPassword: createLimiter(60 * 60 * 1000, 10, "Too many password reset requests. Please wait before trying again.", 'forgot-password'),
  resetPassword: createLimiter(15 * 60 * 1000, 10, "Too many reset attempts. Please wait 15 minutes.", 'reset-password'),
  refreshToken: createLimiter(5 * 60 * 1000, 50, "Too many token refresh attempts.", 'refresh-token'),
  logout: createLimiter(60 * 1000, 100, "Too many logout requests.", 'logout'),
  profileUpdate: createLimiter(5 * 60 * 1000, 50, "Too many profile updates.", 'profile-update'),
  settingsUpdate: createLimiter(5 * 60 * 1000, 100, "Too many settings updates.", 'settings-update'),
  changePassword: createLimiter(5 * 60 * 1000, 20, "Too many password change attempts.", 'change-password'),
  verifyEmail: createLimiter(60 * 60 * 1000, 20, "Too many verification attempts.", 'verify-email'),
  verifyPhone: createLimiter(10 * 60 * 1000, 10, "Too many phone verification attempts.", 'verify-phone'),
  resendEmail: createLimiter(5 * 60 * 1000, 10, "Too many resend attempts. Please wait 5 minutes.", 'resend-email'),
  // VERY HIGH limits for security endpoints during development
  securityQuestion: createLimiter(15 * 60 * 1000, parseInt(process.env.SECURITY_RATE_LIMIT_MAX) || 500, "Too many security question requests. Please wait before trying again.", 'security-question'),
  validateAnswer: createLimiter(15 * 60 * 1000, 300, "Too many validation attempts. Please wait before trying again.", 'validate-answer')
};

// ============ DEBUG ROUTE ============
router.get("/rate-limit-info", (req, res) => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.json({
    environment: process.env.NODE_ENV || 'development',
    rateLimitingDisabled: RATE_LIMIT_DISABLED,
    currentIp: req.ip,
    normalizedIp: req.ip.replace('::ffff:', ''),
    timestamp: new Date().toISOString(),
    configFromEnv: {
      DISABLE_RATE_LIMITING: process.env.DISABLE_RATE_LIMITING,
      SECURITY_RATE_LIMIT_MAX: process.env.SECURITY_RATE_LIMIT_MAX,
      REGISTRATION_RATE_LIMIT_MAX: process.env.REGISTRATION_RATE_LIMIT_MAX,
      NODE_ENV: process.env.NODE_ENV
    },
    actualLimits: {
      securityQuestion: isDevelopment ? 5000 : 500, // 500 * 10 for development
      validateAnswer: isDevelopment ? 3000 : 300,   // 300 * 10 for development
      note: "Development multiplies limits by 10x"
    },
    note: RATE_LIMIT_DISABLED ? 'All rate limits are disabled' : 'Rate limits are active',
    suggestion: "If seeing rate limit errors, set DISABLE_RATE_LIMITING=true in .env"
  });
});

// ============ PUBLIC ROUTES ============

// Health check - NO RATE LIMIT
router.get("/health", (req, res) => {
  res.json({ 
    success: true,
    status: "ok", 
    timestamp: new Date().toISOString(),
    rateLimiting: RATE_LIMIT_DISABLED ? "DISABLED" : "ENABLED",
    securityQuestionSystem: "ACTIVE",
    endpoints: {
      getQuestion: "GET /api/auth/security-question",
      validateAnswer: "POST /api/auth/validate-answer",
      registerSecure: "POST /api/auth/register-secure",
      testSimple: "GET /api/auth/test-simple"
    }
  });
});

// Simple test endpoint - NO RATE LIMIT
router.get("/test-simple", (req, res) => {
  const sessionId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  res.json({
    success: true,
    message: "Simple test endpoint working",
    sessionId: sessionId,
    question: "What is your mother's maiden name?",
    timestamp: new Date().toISOString(),
    cors: {
      origin: req.headers.origin || 'none',
      allowed: true
    }
  });
});

// Security question routes - WITH HIGH LIMITS
router.get("/security-question", rateLimits.securityQuestion, securityController.getQuestion);
router.post("/validate-answer", rateLimits.validateAnswer, securityController.validateAnswer);

// Authentication
router.post("/register", rateLimits.register, register);
router.post("/register-secure", rateLimits.register, securityMiddleware.verifyRegistration, registerSecure);
router.post("/login", rateLimits.login, login);
router.post("/logout", rateLimits.logout, logout);
router.post("/refresh-token", rateLimits.refreshToken, refreshToken);

// Password management
router.post("/forgot-password", rateLimits.forgotPassword, forgotPassword);
router.post("/reset-password/:token", rateLimits.resetPassword, resetPassword);

// Verification
router.post("/verify-email/:token", rateLimits.verifyEmail, verifyEmail);
router.post("/resend-verification-email", rateLimits.resendEmail, resendVerificationEmail);
router.post("/verify-phone", rateLimits.verifyPhone, verifyPhone);

// ============ PROTECTED ROUTES ============
router.use(protect);

// User management
router.get("/me", getMe);
router.put("/profile", rateLimits.profileUpdate, updateProfile);
router.put("/settings", rateLimits.settingsUpdate, updateSettings);
router.put("/change-password", rateLimits.changePassword, changePassword);

// Debug endpoint to check rate limiting - NO RATE LIMIT
router.get("/debug-limits", (req, res) => {
  res.json({
    success: true,
    debug: {
      ip: req.ip,
      normalizedIp: req.ip.replace('::ffff:', ''),
      user: req.user || 'not authenticated',
      timestamp: new Date().toISOString(),
      headers: {
        origin: req.headers.origin,
        'user-agent': req.headers['user-agent']
      }
    },
    rateLimiting: {
      disabled: RATE_LIMIT_DISABLED,
      environment: process.env.NODE_ENV,
      securityQuestionLimit: process.env.NODE_ENV === 'development' ? 5000 : 500,
      config: {
        DISABLE_RATE_LIMITING: process.env.DISABLE_RATE_LIMITING,
        SECURITY_RATE_LIMIT_MAX: process.env.SECURITY_RATE_LIMIT_MAX
      }
    },
    troubleshooting: [
      "If rate limiting is too strict, set DISABLE_RATE_LIMITING=true in .env",
      "Then restart your server",
      "Clear browser cache or use incognito mode",
      "Test with: GET /api/auth/test-simple"
    ]
  });
});

=======
const express = require('express');
const router = express.Router();
const { securityQuestionLimiter, registrationLimiter } = require('../middleware/rateLimiter');
const jwt = require('jsonwebtoken');

// ========== AUTH ROUTES ==========

// 1. LOGIN ROUTE - Fixed to match frontend format
// 1. LOGIN ROUTE - Return both formats for debugging
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }
  
  // Generate JWT token
  const token = jwt.sign(
    { 
      userId: `user-${Date.now()}`,
      email: email,
      name: email.split('@')[0]
    },
    process.env.JWT_SECRET || 'your-jwt-secret-key-change-this',
    { expiresIn: '24h' }
  );
  
  const userData = {
    id: `user-${Date.now()}`,
    email: email,
    name: email.split('@')[0],
    username: email.split('@')[0]
  };
  
  // Return BOTH formats to see which one works
  res.json({
    // Format 1: What we think frontend wants
    user: userData,
    accessToken: token,
    expiresIn: 86400,
    
    // Format 2: Original format  
    success: true,
    message: 'Login successful',
    data: {
      user: userData,
      token: token
    }
  });
});

// 2. REGISTER ROUTE (regular, not secure) - Fixed to match frontend format
router.post('/register', (req, res) => {
  const { email, password, firstName, lastName, username } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }
  
  // Generate JWT token
  const token = jwt.sign(
    { 
      userId: `user-${Date.now()}`,
      email: email
    },
    process.env.JWT_SECRET || 'your-jwt-secret-key-change-this',
    { expiresIn: '24h' }
  );
  
  // FRONTEND EXPECTS: { user: {...}, accessToken: "..." }
  res.json({
    user: {
      id: `user-${Date.now()}`,
      email: email,
      firstName: firstName || '',
      lastName: lastName || '',
      username: username || email.split('@')[0],
      name: firstName && lastName ? `${firstName} ${lastName}` : email.split('@')[0],
      createdAt: new Date()
    },
    accessToken: token,  // Changed from 'token' to 'accessToken'
    expiresIn: 86400
  });
});

// 3. LOGOUT ROUTE
router.post('/logout', (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// 4. VERIFY TOKEN ROUTE
router.get('/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'No token provided'
    });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-key-change-this');
    
    res.json({
      success: true,
      data: {
        valid: true,
        user: decoded
      }
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: error.message
    });
  }
});

// 5. FORGOT PASSWORD ROUTE
router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required'
    });
  }
  
  res.json({
    success: true,
    message: 'Password reset email sent',
    data: {
      resetToken: `reset-token-${Date.now()}`,
      expiresIn: 3600 // 1 hour
    }
  });
});

// 6. RESET PASSWORD ROUTE
router.post('/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  
  if (!token || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Token and new password are required'
    });
  }
  
  res.json({
    success: true,
    message: 'Password reset successful'
  });
});

// 7. REFRESH TOKEN ROUTE
router.post('/refresh-token', (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      message: 'Refresh token is required'
    });
  }
  
  // Generate new JWT token
  const newToken = jwt.sign(
    { 
      userId: `user-refreshed-${Date.now()}`,
      refreshed: true
    },
    process.env.JWT_SECRET || 'your-jwt-secret-key-change-this',
    { expiresIn: '24h' }
  );
  
  res.json({
    success: true,
    data: {
      token: newToken,
      expiresIn: 86400
    }
  });
});

// ========== SECURITY QUESTION ROUTES ==========

// Security question endpoint
router.get('/security-question', securityQuestionLimiter, (req, res) => {
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  res.json({
    success: true,
    data: {
      sessionId: sessionId,
      question: {
        id: 'basic_001',
        text: "What city were you born in?",
        category: "personal",
        difficulty: "easy"
      },
      expiresIn: 600,
      maxAttempts: 3
    }
  });
});

// Validate answer endpoint
router.post('/validate-answer', securityQuestionLimiter, (req, res) => {
  const { sessionId, questionId, answer } = req.body;
  
  if (!sessionId || !answer) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields'
    });
  }
  
  if (answer.trim().length > 0) {
    res.json({
      success: true,
      data: {
        validationToken: `valid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        isValid: true
      }
    });
  } else {
    res.json({
      success: false,
      message: 'Invalid answer'
    });
  }
});

// Registration endpoint with security questions - Fixed to match frontend format
router.post('/register-secure', registrationLimiter, (req, res) => {
  const { email, password, firstName, lastName, username, sessionId } = req.body;
  
  if (!email || !password || !sessionId) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields'
    });
  }
  
  // FRONTEND EXPECTS: { user: {...}, accessToken: "..." }
  res.json({
    user: {
      id: `user-${Date.now()}`,
      email,
      firstName,
      lastName,
      username,
      name: firstName && lastName ? `${firstName} ${lastName}` : email.split('@')[0]
    },
    accessToken: `jwt-token-${Date.now()}`  // Changed from 'token' to 'accessToken'
  });
});

// ========== ME/GET CURRENT USER ROUTE ==========
router.get('/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'No token provided'
    });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-key-change-this');
    
    res.json({
      user: {
        id: decoded.userId || 'user-123',
        email: decoded.email || 'user@example.com',
        name: decoded.name || 'User',
        username: decoded.email ? decoded.email.split('@')[0] : 'user'
      }
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: error.message
    });
  }
});

>>>>>>> 9e23926 (Adding Messaging system with socket io)
module.exports = router;