const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const logger = require('@utils/logger');

// ========== CLOUDINARY CONFIGURATION ==========
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ========== CONFIGURATION ==========
const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB (Cloudinary handles compression on its end)
  ALLOWED_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.webp'],
};

// ========== STORAGE: PROFILE PICTURE ==========
// Always saves as "profile" inside the user's folder → auto-overwrites old one
const profileStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => ({
    folder:         `profiles/${req.user?.id}`,
    public_id:      'profile',
    overwrite:      true,
    resource_type:  'image',
    transformation: [
      { width: 800, height: 800, crop: 'fill', gravity: 'face' }, // smart face crop
      { quality: 'auto', fetch_format: 'auto' }                    // auto compress + format
    ]
  })
});

// ========== STORAGE: GALLERY PHOTO ==========
// Each gallery photo gets a unique timestamped ID
const galleryStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => ({
    folder:         `profiles/${req.user?.id}/gallery`,
    public_id:      `gallery_${Date.now()}`,
    overwrite:      false,
    resource_type:  'image',
    transformation: [
      { width: 1200, height: 1200, crop: 'limit' },  // shrink if larger, never upscale
      { quality: 'auto', fetch_format: 'auto' }
    ]
  })
});

// ========== FILE FILTER (shared) ==========
const fileFilter = (req, file, cb) => {
  const ext     = require('path').extname(file.originalname).toLowerCase();
  const mimetype = file.mimetype.toLowerCase();

  if (!UPLOAD_CONFIG.ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(
      new Error(`Invalid file type. Allowed: ${UPLOAD_CONFIG.ALLOWED_EXTENSIONS.join(', ')}`),
      false
    );
  }

  if (!UPLOAD_CONFIG.ALLOWED_TYPES.includes(mimetype)) {
    return cb(
      new Error(`Invalid mimetype. Allowed: ${UPLOAD_CONFIG.ALLOWED_TYPES.join(', ')}`),
      false
    );
  }

  cb(null, true);
};

// ========== MULTER INSTANCES ==========
const profileUpload = multer({
  storage: profileStorage,
  limits:  { fileSize: UPLOAD_CONFIG.MAX_FILE_SIZE, files: 1 },
  fileFilter
});

const galleryUpload = multer({
  storage: galleryStorage,
  limits:  { fileSize: UPLOAD_CONFIG.MAX_FILE_SIZE, files: 1 },
  fileFilter
});

// ========== ERROR HANDLER (shared) ==========
// Kept identical to your original so nothing else needs to change
const handleUploadError = (err, fieldName, res, next) => {
  if (err instanceof multer.MulterError) {
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
  }

  if (err) {
    logger.error('Upload error:', err);
    return res.status(400).json({
      success: false,
      error: err.message,
      code: 'UPLOAD_ERROR'
    });
  }

  next();
};

// ========== MIDDLEWARE WRAPPERS ==========
// Same calling convention as your original uploadSingle()

/**
 * For profile picture uploads
 * Usage: router.post('/upload/profile', uploadProfilePic(), controller.uploadPhoto)
 * After upload: req.file.path = Cloudinary URL, req.file.filename = public_id
 */
const uploadProfilePic = (fieldName = 'photo') => {
  return (req, res, next) => {
    profileUpload.single(fieldName)(req, res, (err) => {
      if (err) return handleUploadError(err, fieldName, res, next);
      if (!req.file) logger.debug('No file uploaded in request');
      next();
    });
  };
};

/**
 * For gallery photo uploads
 * Usage: router.post('/upload/gallery', uploadGalleryPhoto(), controller.uploadPhoto)
 */
const uploadGalleryPhoto = (fieldName = 'photo') => {
  return (req, res, next) => {
    galleryUpload.single(fieldName)(req, res, (err) => {
      if (err) return handleUploadError(err, fieldName, res, next);
      if (!req.file) logger.debug('No file uploaded in request');
      next();
    });
  };
};

/**
 * Utility: delete a photo from Cloudinary by public_id
 * Call this from your controller when user deletes a photo
 */
const destroyCloudinaryPhoto = async (cloudinaryId) => {
  try {
    const result = await cloudinary.uploader.destroy(cloudinaryId);
    logger.info(`Deleted Cloudinary photo: ${cloudinaryId}`, result);
    return result;
  } catch (err) {
    logger.error(`Failed to delete Cloudinary photo: ${cloudinaryId}`, err);
    throw err;
  }
};

// ========== EXPORT ==========
// uploadSingle kept as alias so any existing route using it still works
module.exports = {
  uploadProfilePic,
  uploadGalleryPhoto,
  destroyCloudinaryPhoto,
  uploadSingle: uploadProfilePic, // ← backward-compatible alias
  cloudinary,                     // ← export instance if needed elsewhere
  UPLOAD_CONFIG
};