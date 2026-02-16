const express = require("express");
const router = express.Router();
const matchController = require("@controllers/match/match.controller");
const { protect } = require("@middleware/authmiddleware");
const rateLimit = require("express-rate-limit");

// ─────────────────────────────────────────────────────────────────────────────
// Rate limit key generator
//
// express-rate-limit v7 throws ERR_ERL_KEY_GEN_IPV6 if a custom keyGenerator
// references req.ip at all — even indirectly. All match routes sit behind the
// protect middleware so req.user.id is always available. Using the user ID is
// also more accurate than IP (multiple users on the same network won't share
// a bucket, and users behind CGNAT won't be under-limited).
// ─────────────────────────────────────────────────────────────────────────────
const userIdKey = (req) => req.user?.id?.toString() ?? 'anonymous';

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiters
// ─────────────────────────────────────────────────────────────────────────────

const matchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  keyGenerator: userIdKey,
  message: { success: false, error: "Too many match requests, please try again later" }
});

const likeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50,
  keyGenerator: userIdKey,
  message: { success: false, error: "Too many likes, please slow down" }
});

const unmatchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,
  keyGenerator: userIdKey,
  message: { success: false, error: "Too many unmatch requests, please try again later" }
});

const superLikeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  keyGenerator: userIdKey,
  message: { success: false, error: "Super like limit reached for this hour" }
});

const undoLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  keyGenerator: userIdKey,
  message: { success: false, error: "Too many undo requests" }
});

const bulkActionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 3,
  keyGenerator: userIdKey,
  message: { success: false, error: "Too many bulk actions" }
});

const queueRefreshLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 5,
  keyGenerator: userIdKey,
  message: { success: false, error: "Queue refresh limit reached" }
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation middleware
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require("mongoose");

const validateLike = (req, res, next) => {
  const { userId } = req.params;

  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ success: false, error: "Invalid user ID" });
  }

  if (req.user?.id && userId === req.user.id.toString()) {
    return res.status(400).json({ success: false, error: "Cannot like yourself" });
  }

  next();
};

const validateMatchId = (req, res, next) => {
  const { matchId } = req.params;

  if (!matchId || !mongoose.Types.ObjectId.isValid(matchId)) {
    return res.status(400).json({ success: false, error: "Invalid match ID" });
  }

  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// MATCH DISCOVERY
// ─────────────────────────────────────────────────────────────────────────────

router.get("/find",
  protect,
  matchLimiter,
  matchController.findMatches
);

router.get("/suggestions",
  protect,
  matchLimiter,
  (req, res, next) => { req.query.algorithm = 'smart'; next(); },
  matchController.findMatches
);

router.get("/nearby",
  protect,
  matchLimiter,
  (req, res, next) => { req.query.algorithm = 'nearby'; next(); },
  matchController.findMatches
);

// ─────────────────────────────────────────────────────────────────────────────
// LIKE / PASS
// ─────────────────────────────────────────────────────────────────────────────

router.post("/like/:userId",
  protect,
  likeLimiter,
  validateLike,
  matchController.likeUser
);

router.post("/pass/:userId",
  protect,
  likeLimiter,
  validateLike,
  matchController.passUser
);

router.post("/super-like/:userId",
  protect,
  superLikeLimiter,
  validateLike,
  (req, res, next) => { req.body.isSuperLike = true; next(); },
  matchController.likeUser
);

router.post("/undo-last-action",
  protect,
  undoLimiter,
  matchController.undoLastAction
);

// ─────────────────────────────────────────────────────────────────────────────
// MATCH MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

router.get("/my-matches",
  protect,
  matchController.getUserMatches
);

router.get("/mutual-likes",
  protect,
  matchController.getMutualLikes
);

router.get("/my-liked-user-ids",
  protect,
  matchController.getMyLikedUserIds
);

router.get("/who-liked-me",
  protect,
  matchController.getWhoLikedMe
);

router.get("/match/:matchId",
  protect,
  validateMatchId,
  matchController.getMatchById
);

router.post("/unmatch/:matchId",
  protect,
  unmatchLimiter,
  validateMatchId,
  matchController.unmatchUser
);

router.post("/block/:matchId",
  protect,
  validateMatchId,
  (req, res, next) => { req.body.reason = "blocked_by_user"; next(); },
  matchController.unmatchUser
);

router.post("/report/:matchId",
  protect,
  validateMatchId,
  matchController.reportMatch
);

router.post("/archive/:matchId",
  protect,
  validateMatchId,
  matchController.archiveMatch
);

// ─────────────────────────────────────────────────────────────────────────────
// STATISTICS & INSIGHTS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/stats",
  protect,
  matchController.getMatchStats
);

router.get("/insights",
  protect,
  matchController.getMatchInsights
);

router.get("/compatibility/:userId",
  protect,
  validateLike,
  matchController.getCompatibilityReport
);

// ─────────────────────────────────────────────────────────────────────────────
// MATCH PREFERENCES
// ─────────────────────────────────────────────────────────────────────────────

router.put("/preferences",
  protect,
  matchController.updateMatchPreferences
);

router.get("/preferences",
  protect,
  matchController.getMatchPreferences
);

// FIX: was DELETE — reset is a POST action (creates new default state, not a deletion)
router.post("/preferences/reset",
  protect,
  matchController.resetMatchPreferences
);

// ─────────────────────────────────────────────────────────────────────────────
// QUICK ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

router.post("/quick-like",
  protect,
  bulkActionLimiter,
  matchController.quickLikeMultiple
);

router.post("/quick-pass",
  protect,
  bulkActionLimiter,
  matchController.quickPassMultiple
);

// ─────────────────────────────────────────────────────────────────────────────
// MATCH QUEUE
// ─────────────────────────────────────────────────────────────────────────────

router.get("/queue",
  protect,
  (req, res, next) => { req.query.showSeen = 'false'; next(); },
  matchController.findMatches
);

router.post("/queue/refresh",
  protect,
  queueRefreshLimiter,
  matchController.refreshMatchQueue
);

router.delete("/queue/clear-seen",
  protect,
  matchController.clearSeenProfiles
);

// ─────────────────────────────────────────────────────────────────────────────
// PREMIUM FEATURES
// ─────────────────────────────────────────────────────────────────────────────

router.get("/premium/suggestions",
  protect,
  (req, res, next) => {
    if (!req.user?.isPremium) {
      return res.status(403).json({ success: false, error: "Premium feature. Upgrade to access." });
    }
    req.query.premium = true;
    req.query.algorithm = 'smart';
    next();
  },
  matchController.findMatches
);

router.get("/premium/who-liked-me",
  protect,
  (req, res, next) => {
    if (!req.user?.isPremium) {
      return res.status(403).json({ success: false, error: "Premium feature. Upgrade to see who liked you." });
    }
    next();
  },
  matchController.getWhoLikedMe
);

router.get("/premium/filtered",
  protect,
  (req, res, next) => {
    if (!req.user?.isPremium) {
      return res.status(403).json({ success: false, error: "Premium feature. Upgrade to use advanced filters." });
    }
    req.query.premium = true;
    next();
  },
  matchController.findMatches
);

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOKS & NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

router.post("/webhook/notification",
  (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.MATCH_WEBHOOK_KEY) {
      return res.status(401).json({ success: false, error: "Unauthorized webhook access" });
    }
    next();
  },
  matchController.handleMatchWebhook
);

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH & DIAGNOSTICS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "match-service",
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0"
  });
});

router.get("/diagnostics",
  protect,
  matchController.getDiagnostics
);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES (uncomment when admin middleware is ready)
// ─────────────────────────────────────────────────────────────────────────────
/*
const { requireAdmin } = require("@middleware/adminMiddleware");

router.get("/admin/all",            protect, requireAdmin, matchController.getAllMatches);
router.get("/admin/user/:userId/history", protect, requireAdmin, matchController.getUserMatchHistory);
router.post("/admin/unmatch/:matchId", protect, requireAdmin, validateMatchId, matchController.forceUnmatch);
router.post("/admin/user/:userId/reset-matches", protect, requireAdmin, matchController.resetUserMatches);
router.get("/admin/analytics",      protect, requireAdmin, matchController.getMatchAnalytics);
*/

// ─────────────────────────────────────────────────────────────────────────────
// ERROR HANDLING
// ─────────────────────────────────────────────────────────────────────────────

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

router.use((err, req, res, next) => {
  console.error("Match route error:", err);

  if (err.type === 'RateLimitError') {
    return res.status(429).json({
      success: false,
      error: "Too many requests",
      retryAfter: err.retryAfter,
      timestamp: new Date().toISOString()
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: "Validation error",
      details: Object.values(err.errors).map(e => e.message),
      timestamp: new Date().toISOString()
    });
  }

  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      error: "Duplicate entry",
      field: Object.keys(err.keyPattern)[0],
      timestamp: new Date().toISOString()
    });
  }

  res.status(500).json({
    success: false,
    error: "Internal server error",
    requestId: req.requestId,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;