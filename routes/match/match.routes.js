const express = require("express");
const router = express.Router();
const matchController = require("@controllers/match/match.controller");
const { protect } = require("@middleware/authmiddleware");

// Rate limiting middleware for match routes
const rateLimit = require("express-rate-limit");

// Different rate limits for different endpoints
const matchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window per user
  message: {
    success: false,
    error: "Too many match requests, please try again later"
  },
  keyGenerator: (req) => {
    return req.user?.id || req.ip; // Use user ID if authenticated, otherwise IP
  }
});

const likeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 likes per 5 minutes
  message: {
    success: false,
    error: "Too many likes, please slow down"
  }
});

const unmatchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20, // 20 unmatches per 10 minutes
  message: {
    success: false,
    error: "Too many unmatch requests, please try again later"
  }
});

// Validation middleware - FIXED: Added proper implementation
const validateLike = (req, res, next) => {
  const { userId } = req.params;
  const mongoose = require("mongoose"); // Import mongoose here
  
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({
      success: false,
      error: "Invalid user ID"
    });
  }
  
  // Prevent liking yourself
  if (req.user?.id && userId === req.user.id.toString()) {
    return res.status(400).json({
      success: false,
      error: "Cannot like yourself"
    });
  }
  
  next();
};

const validateMatchId = (req, res, next) => {
  const { matchId } = req.params;
  const mongoose = require("mongoose");
  
  if (!matchId || !mongoose.Types.ObjectId.isValid(matchId)) {
    return res.status(400).json({
      success: false,
      error: "Invalid match ID"
    });
  }
  
  next();
};

// ========== MATCH DISCOVERY ROUTES ==========

// Find potential matches with various filters
router.get("/find", 
  protect, 
  matchLimiter,
  matchController.findMatches
);

// Get match suggestions based on successful matches
router.get("/suggestions", 
  protect,
  matchLimiter,
  (req, res, next) => {
    // Add algorithm parameter for smart suggestions
    req.query.algorithm = 'smart';
    next();
  },
  matchController.findMatches
);

// Get nearby active users
router.get("/nearby",
  protect,
  matchLimiter,
  (req, res, next) => {
    // Add algorithm parameter for nearby search
    req.query.algorithm = 'nearby';
    next();
  },
  matchController.findMatches
);

// ========== LIKE/PASS ROUTES ==========

// Like a user
router.post("/like/:userId", 
  protect, 
  likeLimiter,
  validateLike,
  matchController.likeUser
);

// Pass/Dislike a user
router.post("/pass/:userId", 
  protect, 
  likeLimiter,
  validateLike,
  matchController.passUser
);

// Super like a user
router.post("/super-like/:userId", 
  protect, 
  rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Only 10 super likes per hour
    message: {
      success: false,
      error: "Super like limit reached for this hour"
    }
  }),
  validateLike,
  (req, res, next) => {
    req.body.isSuperLike = true;
    next();
  },
  matchController.likeUser
);

// Undo last like/pass
router.post("/undo-last-action",
  protect,
  rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5, // Only 5 undo actions per 5 minutes
    message: {
      success: false,
      error: "Too many undo requests"
    }
  }),
  matchController.undoLastAction
);

// ========== MATCH MANAGEMENT ROUTES ==========

// Get user's matches
router.get("/my-matches", 
  protect,
  matchController.getUserMatches
);

// Get mutual likes (users who liked each other but haven't matched yet)
router.get("/mutual-likes", 
  protect,
  matchController.getMutualLikes
);

// Get who liked me
router.get("/who-liked-me", 
  protect,
  matchController.getWhoLikedMe
);

// Get a specific match - FIXED: Removed unimplemented method
router.get("/match/:matchId", 
  protect,
  validateMatchId,
  (req, res) => {
    // Temporarily use getUserMatches with filtering
    req.query.matchId = req.params.matchId;
    matchController.getMatchById(req, res);
  }
);

// Unmatch/Reject a match
router.post("/unmatch/:matchId", 
  protect, 
  unmatchLimiter,
  validateMatchId,
  matchController.unmatchUser
);

// Block a user (extends unmatch functionality)
router.post("/block/:matchId", 
  protect,
  validateMatchId,
  (req, res, next) => {
    req.body.reason = "blocked_by_user";
    next();
  },
  matchController.unmatchUser
);

// Report a match/user
router.post("/report/:matchId", 
  protect,
  validateMatchId,
  matchController.reportMatch
);

// Archive a match (soft delete)
router.post("/archive/:matchId", 
  protect,
  validateMatchId,
  matchController.archiveMatch
);

// ========== STATISTICS & INSIGHTS ROUTES ==========

// Get match statistics
router.get("/stats", 
  protect,
  matchController.getMatchStats
);

// Get match insights and recommendations
router.get("/insights", 
  protect,
  matchController.getMatchInsights
);

// Get compatibility report with a specific user
router.get("/compatibility/:userId", 
  protect,
  validateLike,
  matchController.getCompatibilityReport
);

// ========== MATCH PREFERENCES ROUTES ==========

// Update match preferences
router.put("/preferences", 
  protect,
  matchController.updateMatchPreferences
);

// Get match preferences
router.get("/preferences", 
  protect,
  matchController.getMatchPreferences
);

// Reset match preferences to defaults
router.delete("/preferences/reset", 
  protect,
  matchController.resetMatchPreferences
);

// ========== QUICK ACTIONS ROUTES ==========

// Quick like multiple users
router.post("/quick-like", 
  protect,
  rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3, // Only 3 bulk like actions per 10 minutes
    message: {
      success: false,
      error: "Too many bulk actions"
    }
  }),
  matchController.quickLikeMultiple
);

// Quick pass multiple users
router.post("/quick-pass", 
  protect,
  rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3, // Only 3 bulk pass actions per 10 minutes
    message: {
      success: false,
      error: "Too many bulk actions"
    }
  }),
  matchController.quickPassMultiple
);

// ========== MATCH QUEUE ROUTES ==========

// Get match queue (profiles to review)
router.get("/queue", 
  protect,
  (req, res, next) => {
    req.query.showSeen = 'false';
    next();
  },
  matchController.findMatches
);

// Refresh match queue
router.post("/queue/refresh", 
  protect,
  rateLimit({
    windowMs: 30 * 60 * 1000, // 30 minutes
    max: 5, // Only 5 refreshes per 30 minutes
    message: {
      success: false,
      error: "Queue refresh limit reached"
    }
  }),
  matchController.refreshMatchQueue
);

// Clear seen profiles
router.delete("/queue/clear-seen", 
  protect,
  matchController.clearSeenProfiles
);

// ========== PREMIUM FEATURES ROUTES ==========

// Get premium match suggestions
router.get("/premium/suggestions", 
  protect,
  (req, res, next) => {
    // Check if user has premium
    if (!req.user?.isPremium) {
      return res.status(403).json({
        success: false,
        error: "Premium feature. Upgrade to access."
      });
    }
    req.query.premium = true;
    req.query.algorithm = 'smart';
    next();
  },
  matchController.findMatches
);

// See who liked you (premium feature)
router.get("/premium/who-liked-me", 
  protect,
  (req, res, next) => {
    if (!req.user?.isPremium) {
      return res.status(403).json({
        success: false,
        error: "Premium feature. Upgrade to see who liked you."
      });
    }
    next();
  },
  matchController.getWhoLikedMe
);

// Advanced filters
router.get("/premium/filtered", 
  protect,
  (req, res, next) => {
    if (!req.user?.isPremium) {
      return res.status(403).json({
        success: false,
        error: "Premium feature. Upgrade to use advanced filters."
      });
    }
    req.query.premium = true;
    next();
  },
  matchController.findMatches
);

// ========== WEBHOOKS & NOTIFICATIONS ==========

// Webhook for match notifications (internal use)
router.post("/webhook/notification", 
  // Internal authentication middleware
  (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.MATCH_WEBHOOK_KEY) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized webhook access"
      });
    }
    next();
  },
  matchController.handleMatchWebhook
);

// ========== HEALTH & MONITORING ==========

// Match service health check
router.get("/health", 
  (req, res) => {
    res.json({
      success: true,
      service: "match-service",
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "1.0.0"
    });
  }
);

// Match algorithm diagnostics
router.get("/diagnostics", 
  protect,
  matchController.getDiagnostics
);

// ========== ADMIN ROUTES ==========
// NOTE: These routes require admin middleware. Uncomment when you have it.
/*
const { requireAdmin } = require("@middleware/adminMiddleware");

// Get all matches (admin only)
router.get("/admin/all", 
  protect, 
  requireAdmin,
  matchController.getAllMatches
);

// Get user's match history (admin only)
router.get("/admin/user/:userId/history", 
  protect, 
  requireAdmin,
  matchController.getUserMatchHistory
);

// Force unmatch (admin only)
router.post("/admin/unmatch/:matchId", 
  protect, 
  requireAdmin,
  validateMatchId,
  matchController.forceUnmatch
);

// Reset user's match data (admin only)
router.post("/admin/user/:userId/reset-matches", 
  protect, 
  requireAdmin,
  matchController.resetUserMatches
);

// Get match analytics (admin only)
router.get("/admin/analytics", 
  protect, 
  requireAdmin,
  matchController.getMatchAnalytics
);
*/

// ========== ERROR HANDLING MIDDLEWARE ==========

// 404 handler for match routes
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Match route not found",
    path: req.path,
    method: req.method,
    availableEndpoints: [
      "GET    /find",
      "GET    /suggestions",
      "GET    /nearby",
      "POST   /like/:userId",
      "POST   /pass/:userId",
      "GET    /my-matches",
      "GET    /mutual-likes",
      "GET    /who-liked-me",
      "GET    /stats",
      "GET    /insights",
      "GET    /preferences",
      "PUT    /preferences",
      "GET    /health"
    ]
  });
});

// Error handler for match routes
router.use((err, req, res, next) => {
  console.error("Match route error:", err);
  
  // Rate limit error
  if (err.type === 'RateLimitError') {
    return res.status(429).json({
      success: false,
      error: "Too many requests",
      retryAfter: err.retryAfter,
      timestamp: new Date().toISOString()
    });
  }
  
  // MongoDB validation error
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: Object.values(err.errors).map(e => e.message),
      timestamp: new Date().toISOString()
    });
  }
  
  // MongoDB duplicate key error
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      error: "Duplicate entry",
      field: Object.keys(err.keyPattern)[0],
      timestamp: new Date().toISOString()
    });
  }
  
  // Default error
  res.status(500).json({
    success: false,
    error: "Internal server error",
    requestId: req.requestId,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;