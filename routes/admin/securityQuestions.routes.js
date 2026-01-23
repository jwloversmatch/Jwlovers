// routes/admin/securityQuestions.routes.js
const express = require('express');
const router = express.Router();
const securityQuestionsController = require('@controllers/admin/securityQuestions.controller');

// Import auth middleware
const { protect, authorize } = require('@middleware/authmiddleware');
const { ROLES } = require('@models/User');

// Apply authentication and authorization to all admin routes
router.use(protect);
router.use(authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN));

// ========== SECURITY QUESTIONS MANAGEMENT ==========

// GET /api/admin/security-questions
router.get('/', securityQuestionsController.getQuestions);

// GET /api/admin/security-questions/stats
router.get('/stats', securityQuestionsController.getQuestionStats);

// GET /api/admin/security-questions/export
router.get('/export', securityQuestionsController.exportQuestions);

// POST /api/admin/security-questions/import
router.post('/import', securityQuestionsController.bulkImportQuestions);

// GET /api/admin/security-questions/:id
router.get('/:id', securityQuestionsController.getQuestionById);

// POST /api/admin/security-questions
router.post('/', securityQuestionsController.createQuestion);

// PUT /api/admin/security-questions/:id
router.put('/:id', securityQuestionsController.updateQuestion);

// PATCH /api/admin/security-questions/:id/toggle
router.patch('/:id/toggle', securityQuestionsController.toggleQuestionStatus);

// DELETE /api/admin/security-questions/:id
router.delete('/:id', securityQuestionsController.deleteQuestion);

// ========== SECURITY SESSIONS MANAGEMENT ==========

// GET /api/admin/security-questions/sessions/active
router.get('/sessions/active', securityQuestionsController.getActiveSessions);

// GET /api/admin/security-questions/sessions/expired
router.get('/sessions/expired', securityQuestionsController.getExpiredSessions);

// GET /api/admin/security-questions/sessions/:sessionId
router.get('/sessions/:sessionId', securityQuestionsController.getSessionById);

// DELETE /api/admin/security-questions/sessions/:sessionId
router.delete('/sessions/:sessionId', securityQuestionsController.deleteSession);

// POST /api/admin/security-questions/sessions/cleanup
router.post('/sessions/cleanup', securityQuestionsController.cleanupExpiredSessions);

// GET /api/admin/security-questions/sessions/stats
router.get('/sessions/stats', securityQuestionsController.getSessionStats);

module.exports = router;