const crypto = require('crypto');

function isValidEncryptedContent(content) {
  if (typeof content !== 'string') {
    return false;
  }
  
  // Must not be empty
  if (!content.trim()) {
    return false;
  }
  
  // Check if it's valid base64
  try {
    // Base64 regex pattern
    const base64Regex = /^[A-Za-z0-9+/]+={0,3}$/;
    
    if (!base64Regex.test(content)) {
      return false;
    }
    
    // Decode to check length (optional, removes padding)
    const decoded = Buffer.from(content, 'base64');
    
    // AES encrypted content typically has specific characteristics:
    // 1. Minimum length for AES (16 bytes for block, plus IV, etc.)
    // 2. Should not contain common plaintext patterns
    if (decoded.length < 16) {
      return false;
    }
    
    // Check for common plaintext that shouldn't be encrypted
    // (e.g., if someone tries to send "hello" as base64, it would be "aGVsbG8=")
    const potentialPlaintext = decoded.toString('utf8', 0, Math.min(50, decoded.length));
    
    // Common patterns that indicate it's NOT encrypted
    const plaintextIndicators = [
      /^[\x20-\x7E]+$/, // Mostly printable ASCII
      /\s/, // Contains whitespace
      /[a-z][A-Z]/, // Mixed case letters
      /\.com|\.org|\.net|http/i, // URLs
      /@/, // Email addresses
      /(\bthe\b|\band\b|\bto\b|\bof\b)/i, // Common English words
    ];
    
    // If it looks like plaintext, it's probably not encrypted
    for (const pattern of plaintextIndicators) {
      if (pattern.test(potentialPlaintext)) {
        return false;
      }
    }
    
    return true;
    
  } catch (error) {
    return false;
  }
}

// Allow specific known plaintext messages (for backward compatibility)
const ALLOWED_PLAINTEXT_MESSAGES = [
  'Sent an image',
  'Sent a video',
  'Sent a file',
  'Sent an audio',
  '[Empty message]'
];

const validateMessageEncryption = (req, res, next) => {
  // Skip validation if DISABLE_ENCRYPTION_VALIDATION is true
  if (process.env.DISABLE_ENCRYPTION_VALIDATION === 'true') {
    console.warn('⚠️ Encryption validation is DISABLED. Accepting unencrypted messages.');
    return next();
  }
  
  // Skip validation in development if SKIP_ENCRYPTION_VALIDATION is true
  if (process.env.NODE_ENV === 'development' && 
      process.env.SKIP_ENCRYPTION_VALIDATION === 'true') {
    console.warn('⚠️ Skipping encryption validation in development mode');
    return next();
  }
  
  // Skip validation for non-text messages
  if (req.body.type !== 'text' || !req.body.content) {
    return next();
  }
  
  const content = req.body.content.trim();
  
  // Check if it's an allowed plaintext message
  if (ALLOWED_PLAINTEXT_MESSAGES.some(msg => content.includes(msg))) {
    return next();
  }
  
  // Validate encryption
  if (!isValidEncryptedContent(content)) {
    console.warn('🚨 Unencrypted message rejected:', {
      userId: req.user?._id,
      contentPreview: content.substring(0, 50),
      length: content.length,
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
    
    // Different responses based on environment
    const response = {
      success: false,
      error: 'Message security violation',
      code: 'ENCRYPTION_REQUIRED'
    };
    
    if (process.env.NODE_ENV === 'development') {
      response.debug = {
        message: 'Enable SKIP_ENCRYPTION_VALIDATION=true in .env to bypass during development',
        contentSample: content.substring(0, 100),
        validationFailed: true
      };
      response.message = 'All text messages must be encrypted. Set SKIP_ENCRYPTION_VALIDATION=true in development.';
    } else {
      response.message = 'All text messages must be end-to-end encrypted. Please update your client.';
    }
    
    return res.status(400).json(response);
  }
  
  // Log successful encrypted message (optional, for debugging)
  if (process.env.LOG_ENCRYPTED_MESSAGES === 'true') {
    console.log('✅ Encrypted message accepted:', {
      userId: req.user?._id,
      contentLength: content.length,
      isEncrypted: true
    });
  }
  
  next();
};

// Middleware to decrypt messages for debugging/admin purposes (optional)
const decryptMessageForLogging = (encryptedContent) => {
  // NOTE: In true E2EE, the server should NEVER decrypt messages
  // This is only for debugging/logging in development
  
  // Only allow in development with explicit permission
  if (process.env.NODE_ENV !== 'development' || 
      process.env.ALLOW_MESSAGE_DECRYPTION !== 'true') {
    return '[ENCRYPTED]';
  }
  
  try {
    // This would require the server to have the decryption key
    // Which breaks true E2EE - only use for debugging
    const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
    if (!ENCRYPTION_KEY) {
      return '[ENCRYPTED - NO KEY]';
    }
    
    // Decryption logic (similar to client)
    // Implementation depends on your encryption library
    // Example with crypto-js style:
    // const bytes = crypto.AES.decrypt(encryptedContent, ENCRYPTION_KEY);
    // const decrypted = bytes.toString(crypto.enc.Utf8);
    
    return '[ENCRYPTED - DECRYPTED IN DEV]';
  } catch (error) {
    return '[ENCRYPTED - DECRYPTION FAILED]';
  }
};

// Optional: Middleware to enforce encryption only in production
const enforceEncryptionInProduction = (req, res, next) => {
  if (process.env.NODE_ENV === 'production' && 
      process.env.FORCE_ENCRYPTION_IN_PROD !== 'false') {
    return validateMessageEncryption(req, res, next);
  }
  next();
};

// Optional: Gradual rollout middleware
const gradualEncryptionEnforcement = (req, res, next) => {
  const rolloutPercentage = parseInt(process.env.ENCRYPTION_ROLLOUT_PERCENT || '100');
  
  // Generate a consistent hash of user ID to determine if they're in the rollout
  const userId = req.user?._id?.toString() || '';
  const hash = crypto.createHash('md5').update(userId).digest('hex');
  const hashValue = parseInt(hash.substring(0, 8), 16);
  const userPercentage = (hashValue % 100) + 1;
  
  if (userPercentage <= rolloutPercentage) {
    // User is in rollout group - enforce encryption
    return validateMessageEncryption(req, res, next);
  } else {
    // User is not in rollout group - allow plaintext
    console.log(`User ${userId.substring(0, 8)} not in encryption rollout (${userPercentage} > ${rolloutPercentage})`);
    return next();
  }
};

module.exports = {
  validateMessageEncryption,
  isValidEncryptedContent,
  decryptMessageForLogging,
  enforceEncryptionInProduction,
  gradualEncryptionEnforcement
};