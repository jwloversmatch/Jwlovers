const multer = require('multer');
const path = require('path');
const fs = require('fs');
const logger = require('@utils/logger');

// ========== CONFIGURATION ==========
const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.webp'],
  UPLOAD_DIR: 'uploads/profiles'
};

// ========== ENSURE UPLOAD DIRECTORY EXISTS ==========
const uploadDir = path.join(process.cwd(), UPLOAD_CONFIG.UPLOAD_DIR);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  logger.info(`Created upload directory: ${uploadDir}`);
}

// ========== STORAGE CONFIGURATION ==========
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: userId_timestamp_random.ext
    const userId = req.user?.id || 'unknown';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${userId}_${timestamp}_${random}${ext}`;
    cb(null, filename);
  }
});

// ========== FILE FILTER ==========
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimetype = file.mimetype.toLowerCase();

  // Check file extension
  if (!UPLOAD_CONFIG.ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(
      new Error(`Invalid file type. Allowed types: ${UPLOAD_CONFIG.ALLOWED_EXTENSIONS.join(', ')}`),
      false
    );
  }

  // Check mimetype
  if (!UPLOAD_CONFIG.ALLOWED_TYPES.includes(mimetype)) {
    return cb(
      new Error(`Invalid file mimetype. Allowed types: ${UPLOAD_CONFIG.ALLOWED_TYPES.join(', ')}`),
      false
    );
  }

  cb(null, true);
};

// ========== MULTER INSTANCE ==========
const upload = multer({
  storage: storage,
  limits: {
    fileSize: UPLOAD_CONFIG.MAX_FILE_SIZE,
    files: 1 // Only allow 1 file per upload
  },
  fileFilter: fileFilter
});

// ========== MIDDLEWARE WRAPPER WITH ERROR HANDLING ==========
const uploadSingle = (fieldName = 'photo') => {
  return (req, res, next) => {
    const uploadHandler = upload.single(fieldName);

    uploadHandler(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        // Multer-specific errors
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            error: `File too large. Maximum size is ${UPLOAD_CONFIG.MAX_FILE_SIZE / (1024 * 1024)}MB`,
            code: 'FILE_TOO_LARGE'
          });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            success: false,
            error: 'Too many files. Only 1 file allowed per upload',
            code: 'TOO_MANY_FILES'
          });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            success: false,
            error: `Unexpected field. Expected field name: "${fieldName}"`,
            code: 'UNEXPECTED_FIELD'
          });
        }
        
        return res.status(400).json({
          success: false,
          error: err.message,
          code: 'UPLOAD_ERROR'
        });
      } else if (err) {
        // Custom errors (from fileFilter)
        logger.error('Upload error:', err);
        return res.status(400).json({
          success: false,
          error: err.message,
          code: 'UPLOAD_ERROR'
        });
      }

      // No file uploaded (optional upload)
      if (!req.file) {
        logger.debug('No file uploaded in request');
      }

      next();
    });
  };
};

// ========== EXPORT ==========
module.exports = {
  uploadSingle,
  UPLOAD_CONFIG
};