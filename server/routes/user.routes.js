const express = require("express");
const router = express.Router();

const { 
  getMe,
  updatePrivateInfo,
  updateProfile,
  getSettings,
  updateSettings,
  deleteAccount
} = require("@controllers");

const { protect } = require("@middleware/authmiddleware");

// Protected user routes
router.get("/me", protect, getMe);
router.put("/update", protect, updatePrivateInfo);  
router.put("/profile", protect, updateProfile);    
router.delete("/delete", protect, deleteAccount);
router.get("/settings", protect, getSettings);
router.put("/settings", protect, updateSettings);

module.exports = router;