const express = require("express");
const router = express.Router();
const matchController = require("@controllers/match.controller");
const { protect } = require("@middleware/authmiddleware");

// Protected routes
router.get("/find", protect, matchController.findMatches);
router.post("/like/:userId", protect, matchController.likeUser);

module.exports = router;