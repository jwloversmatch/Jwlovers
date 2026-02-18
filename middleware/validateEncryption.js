// middleware/encrypt.middleware.js
//
// ══════════════════════════════════════════════════════════════════════════════
// ARCHITECTURE NOTE
// ══════════════════════════════════════════════════════════════════════════════
// This app uses SERVER-SIDE AES-256-GCM encryption (EncryptionService).
// The frontend sends PLAINTEXT. The backend encrypts before saving and
// decrypts before returning. This is NOT a client-encrypts (E2EE) model.
//
// The original validateMessageEncryption middleware expected the CLIENT to
// encrypt before sending, which is the wrong model for this architecture.
// It has been replaced with:
//   1. sanitizeIncoming  — sanitize plaintext from frontend before processing
//   2. decryptOutgoing   — decrypt message content before sending to frontend
//
// The validateMessageEncryption export is kept as a no-op for backward
// compatibility if it's referenced in other route files, but it should be
// REMOVED from chat.routes.js.
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

// ── Incoming: sanitize plaintext message from frontend ─────────────────────
// Rejects obviously malicious content and enforces basic length rules.
// Encryption itself is handled by ChatController → messageEncryptionHandler.
const sanitizeIncoming = (req, res, next) => {
  if (req.body.type !== 'text' || !req.body.content) {
    return next();
  }

  const content = req.body.content;

  if (typeof content !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      message: 'Message content must be a string',
    });
  }

  const trimmed = content.trim();

  if (trimmed.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      message: 'Message content cannot be empty',
    });
  }

  if (trimmed.length > 10000) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      message: 'Message content exceeds maximum length (10000 characters)',
    });
  }

  // Normalise: trim whitespace
  req.body.content = trimmed;
  next();
};

// ── Outgoing: decrypt a single message object in place ─────────────────────
// Checks if content looks like our encrypted JSON format {iv, authTag, content}
// and decrypts it using the app-level EncryptionService.
// Used by MessageFormatter for individual messages.
const decryptMessageContent = (req, messageContent, encryptionType) => {
  if (!messageContent || encryptionType !== 'server-side') {
    return messageContent;
  }

  try {
    const parsed = JSON.parse(messageContent);
    if (parsed.iv && parsed.authTag && parsed.content) {
      // It's our encrypted format — decrypt it
      const encryptionService = req.app?.get?.('EncryptionService');
      if (encryptionService?.decryptForFrontend) {
        return encryptionService.decryptForFrontend(messageContent, encryptionType);
      }
      // EncryptionService not available — return placeholder
      return '🔒 [Encrypted message]';
    }
  } catch {
    // Not JSON — content is already plaintext (stored before encryption was enabled)
  }

  return messageContent;
};

// ── Kept for backward compat but is a no-op ────────────────────────────────
// REMOVE from chat.routes.js — do not add to new routes.
const validateMessageEncryption = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    // Silently pass in dev — server encrypts after this point
    return next();
  }
  // In production: also pass — server handles encryption
  return next();
};

// ── Legacy no-ops kept for any existing imports ─────────────────────────────
const enforceEncryptionInProduction = (req, res, next) => next();
const gradualEncryptionEnforcement  = (req, res, next) => next();

const isValidEncryptedContent = (content) => {
  // In server-side architecture, content sent by client is always plaintext
  return typeof content === 'string' && content.trim().length > 0;
};

const decryptMessageForLogging = (encryptedContent) => {
  if (process.env.NODE_ENV !== 'development') return '[ENCRYPTED]';
  try {
    const parsed = JSON.parse(encryptedContent);
    if (parsed.iv && parsed.authTag && parsed.content) {
      return `[ENCRYPTED — iv:${parsed.iv.substring(0, 8)}...]`;
    }
  } catch { /* not JSON */ }
  return encryptedContent;
};

module.exports = {
  // ✅ USE THESE
  sanitizeIncoming,
  decryptMessageContent,
  // ⚠️  LEGACY — no-ops, remove from routes
  validateMessageEncryption,
  enforceEncryptionInProduction,
  gradualEncryptionEnforcement,
  isValidEncryptedContent,
  decryptMessageForLogging,
};