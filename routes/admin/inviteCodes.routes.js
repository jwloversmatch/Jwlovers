// routes/admin/inviteCodes.routes.js - CLEAN VERSION
const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { protect, requireMinimumRole, ROLES } = require('@middleware/authmiddleware');
const inviteCodeController = require('@controllers/admin/inviteCode.controller');

// Middleware to handle validation errors
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// All routes require authentication and admin privileges
router.use(protect);
router.use(requireMinimumRole(ROLES.ADMIN));

// GET /api/admin/invite-codes - List all invite codes
router.get('/', 
  inviteCodeController.getAllInviteCodes.bind(inviteCodeController)
);

// GET /api/admin/invite-codes/stats/overview - Get statistics (must be before /:id)
router.get('/stats/overview', 
  inviteCodeController.getInviteCodeStats.bind(inviteCodeController)
);

// GET /api/admin/invite-codes/:id - Get specific code
router.get('/:id',
  [param('id').isMongoId()],
  validate,
  inviteCodeController.getInviteCodeById.bind(inviteCodeController)
);

// POST /api/admin/invite-codes - Create new invite code
router.post('/',
  [
    body('role').isIn([ROLES.MODERATOR, ROLES.ADMIN, ROLES.SUPER_ADMIN]),
    body('maxUses').optional().isInt({ min: 1, max: 100 }),
    body('expiresAt').optional().isISO8601(),
    body('description').optional().isString().trim().isLength({ max: 500 })
  ],
  validate,
  inviteCodeController.createInviteCode.bind(inviteCodeController)
);

// PATCH /api/admin/invite-codes/:id/toggle - Toggle active status
router.patch('/:id/toggle',
  [param('id').isMongoId()],
  validate,
  inviteCodeController.toggleInviteCode.bind(inviteCodeController)
);

// DELETE /api/admin/invite-codes/:id - Delete invite code
router.delete('/:id',
  [param('id').isMongoId()],
  validate,
  inviteCodeController.deleteInviteCode.bind(inviteCodeController)
);

module.exports = router;