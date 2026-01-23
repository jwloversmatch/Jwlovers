// routes/admin.routes.js
const express = require('express');
const router = express.Router();
const adminController = require('@controllers/admin.controller');
const { protect, authorize } = require('@middleware/authmiddleware');

// All routes require admin authorization
router.use(protect);
router.use(authorize('admin'));

// ============ OPTION MANAGEMENT ============
router.get('/options', adminController.getOptions);
router.get('/options/categories', adminController.getCategories);
router.get('/options/:id', adminController.getOptionById);
router.post('/options', adminController.createOption);
router.put('/options/:id', adminController.updateOption);
router.delete('/options/:id', adminController.deleteOption);

// ============ SECURITY QUESTIONS MANAGEMENT ============
// GET /api/admin/security-questions - Get all security questions
router.get('/security-questions', adminController.getSecurityQuestions);

// GET /api/admin/security-questions/stats - Get statistics
router.get('/security-questions/stats', adminController.getSecurityQuestionStats);

// GET /api/admin/security-questions/export - Export questions
router.get('/security-questions/export', adminController.exportSecurityQuestions);

// POST /api/admin/security-questions/import - Bulk import questions
router.post('/security-questions/import', adminController.bulkImportSecurityQuestions);

// GET /api/admin/security-questions/:id - Get single question by ID
router.get('/security-questions/:id', adminController.getSecurityQuestionById);

// POST /api/admin/security-questions - Create new question
router.post('/security-questions', adminController.createSecurityQuestion);

// PUT /api/admin/security-questions/:id - Update question
router.put('/security-questions/:id', adminController.updateSecurityQuestion);

// PATCH /api/admin/security-questions/:id/toggle - Toggle active status
router.patch('/security-questions/:id/toggle', adminController.toggleSecurityQuestionStatus);

// DELETE /api/admin/security-questions/:id - Delete question
router.delete('/security-questions/:id', adminController.deleteSecurityQuestion);

module.exports = router;