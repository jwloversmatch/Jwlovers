// routes/v1/profile.routes.js
const express = require("express");
const router = express.Router();
const profileController = require("@controllers/profile.controller");
const { protect } = require("@middleware/authmiddleware");

// Public routes
router.get("/options", profileController.getProfileOptions);
router.get("/defaults", profileController.getDefaultProfileValues);
router.get("/public/:userId", profileController.getPublicProfile);

// Protected routes
router.use(protect);
router.post("/create", profileController.createProfile);
router.get("/me", profileController.getCompleteProfile);
router.put("/update", profileController.updateProfile);
router.put("/profile-picture", profileController.updateProfilePicture);
router.put("/photos", profileController.updatePhotos);
router.put("/match-preferences", profileController.updateMatchPreferences);
router.post("/verification-badge", profileController.addVerificationBadge);
router.get("/stats", profileController.getProfileStats);
router.get("/completion", profileController.getProfileCompletion);

// Backward compatibility
router.get("/:userId", profileController.getPublicProfile);

module.exports = router;