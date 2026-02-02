const Joi = require('joi');

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const urlRegex = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
const imageMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const videoMimeTypes = ['video/mp4', 'video/webm', 'video/ogg'];
const audioMimeTypes = ['audio/mpeg', 'audio/ogg', 'audio/wav'];

module.exports = {
  // ========== CONVERSATION SCHEMAS ==========
  "join_conversation": Joi.object({
    conversationId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid conversation ID format',
      'any.required': 'conversationId is required'
    })
  }),
  
  "leave_conversation": Joi.object({
    conversationId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid conversation ID format',
      'any.required': 'conversationId is required'
    })
  }),
  
  // ========== MESSAGE SCHEMAS ==========
  "message:send": Joi.object({
    receiverId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid receiver ID format',
      'any.required': 'receiverId is required'
    }),
    content: Joi.when('type', {
      is: 'text',
      then: Joi.string().required().max(5000).messages({
        'string.max': 'Message content cannot exceed 5000 characters',
        'string.empty': 'Message content cannot be empty',
        'any.required': 'Content is required for text messages'
      }),
      otherwise: Joi.string().max(500).optional().messages({
        'string.max': 'Caption cannot exceed 500 characters'
      })
    }),
    conversationId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid conversation ID format'
    }),
    messageId: Joi.string().max(100).optional().messages({
      'string.max': 'Message ID too long'
    }),
    
    // Media validation for dating app
    mediaUrl: Joi.string().pattern(urlRegex).optional().messages({
      'string.pattern.base': 'Invalid media URL format'
    }),
    
    mediaData: Joi.object({
      url: Joi.string().pattern(urlRegex).required(),
      type: Joi.string().valid('image', 'video', 'audio', 'file').required(),
      mimeType: Joi.string().optional(),
      size: Joi.number().max(50 * 1024 * 1024).optional().messages({ // 50MB max
        'number.max': 'File size cannot exceed 50MB'
      }),
      dimensions: Joi.object({
        width: Joi.number().max(5000).optional(),
        height: Joi.number().max(5000).optional()
      }).optional(),
      duration: Joi.number().max(300).optional().messages({ // 5 minutes max
        'number.max': 'Video/audio duration cannot exceed 5 minutes'
      })
    }).optional(),
    
    type: Joi.string().valid('text', 'image', 'video', 'audio', 'file', 'location', 'icebreaker').default('text').messages({
      'any.only': 'Message type must be one of: text, image, video, audio, file, location, icebreaker'
    }),
    
    // Dating app specific fields
    metadata: Joi.object({
      isIcebreaker: Joi.boolean().default(false),
      icebreakerId: Joi.string().regex(objectIdRegex).optional(),
      location: Joi.object({
        lat: Joi.number().min(-90).max(90).optional(),
        lng: Joi.number().min(-180).max(180).optional(),
        name: Joi.string().max(200).optional()
      }).optional(),
      sharedProfile: Joi.boolean().default(false),
      requiresAgeVerification: Joi.boolean().default(false)
    }).optional(),
    
    // Anti-spam/abuse fields
    clientTimestamp: Joi.number().optional(),
    clientId: Joi.string().max(100).optional()
  }).custom((value, helpers) => {
    // Cross-field validation for dating app
    const { type, content, mediaUrl, mediaData } = value;
    
    // Validate media requirements
    if (['image', 'video', 'audio', 'file'].includes(type)) {
      if (!mediaUrl && !mediaData?.url) {
        return helpers.error('any.required', {
          message: 'Media URL or mediaData is required for media messages'
        });
      }
      
      // Validate media type matches
      if (mediaData) {
        if (type === 'image' && !imageMimeTypes.some(mime => mediaData.mimeType?.includes(mime))) {
          return helpers.error('any.invalid', {
            message: `Invalid image format. Allowed: ${imageMimeTypes.join(', ')}`
          });
        }
        
        if (type === 'video' && !videoMimeTypes.some(mime => mediaData.mimeType?.includes(mime))) {
          return helpers.error('any.invalid', {
            message: `Invalid video format. Allowed: ${videoMimeTypes.join(', ')}`
          });
        }
        
        if (type === 'audio' && !audioMimeTypes.some(mime => mediaData.mimeType?.includes(mime))) {
          return helpers.error('any.invalid', {
            message: `Invalid audio format. Allowed: ${audioMimeTypes.join(', ')}`
          });
        }
      }
    }
    
    // Validate location messages
    if (type === 'location' && (!value.metadata?.location || !value.metadata.location.lat || !value.metadata.location.lng)) {
      return helpers.error('any.required', {
        message: 'Location coordinates are required for location messages'
      });
    }
    
    // Validate icebreaker messages
    if (type === 'icebreaker') {
      if (!value.metadata?.icebreakerId) {
        return helpers.error('any.required', {
          message: 'Icebreaker ID is required for icebreaker messages'
        });
      }
      if (!content || content.trim().length === 0) {
        return helpers.error('any.required', {
          message: 'Content is required for icebreaker messages'
        });
      }
    }
    
    return value;
  }),
  
  "message:edit": Joi.object({
    messageId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid message ID format',
      'any.required': 'messageId is required'
    }),
    content: Joi.string().required().max(5000).messages({
      'string.max': 'Message content cannot exceed 5000 characters',
      'any.required': 'content is required'
    }),
    editedAt: Joi.date().timestamp().optional()
  }),
  
  "message:delete": Joi.object({
    messageId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid message ID format',
      'any.required': 'messageId is required'
    }),
    deleteForEveryone: Joi.boolean().default(false),
    reason: Joi.string().max(200).optional()
  }),
  
  // ========== TYPING INDICATORS ==========
  "typing:start": Joi.object({
    conversationId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid conversation ID format'
    }),
    receiverId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid receiver ID format'
    })
  }).or('conversationId', 'receiverId').messages({
    'object.missing': 'Either conversationId or receiverId is required'
  }),
  
  "typing:stop": Joi.object({
    conversationId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid conversation ID format'
    }),
    receiverId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid receiver ID format'
    })
  }).or('conversationId', 'receiverId').messages({
    'object.missing': 'Either conversationId or receiverId is required'
  }),
  
  // ========== READ RECEIPTS ==========
  "messages:viewed": Joi.object({
    conversationId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid conversation ID format'
    }),
    receiverId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid receiver ID format'
    }),
    messageIds: Joi.array().items(Joi.string().regex(objectIdRegex)).min(1).max(100).required().messages({
      'array.min': 'At least one message ID is required',
      'array.max': 'Maximum 100 message IDs allowed',
      'array.includes': 'Invalid message ID format'
    }),
    viewedAt: Joi.date().timestamp().optional()
  }),
  
  "messages:delivered": Joi.object({
    conversationId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid conversation ID format'
    }),
    receiverId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid receiver ID format'
    }),
    messageIds: Joi.array().items(Joi.string().regex(objectIdRegex)).min(1).max(100).required().messages({
      'array.min': 'At least one message ID is required',
      'array.max': 'Maximum 100 message IDs allowed',
      'array.includes': 'Invalid message ID format'
    }),
    deliveredAt: Joi.date().timestamp().optional()
  }),
  
  // ========== PRESENCE SCHEMAS ==========
  "presence:update-status": Joi.object({
    status: Joi.string().valid('online', 'away', 'busy', 'offline', 'dnd', 'invisible').default('online').messages({
      'any.only': 'Status must be one of: online, away, busy, offline, dnd, invisible'
    }),
    customStatus: Joi.string().max(100).default('').messages({
      'string.max': 'Custom status cannot exceed 100 characters'
    }),
    expiresAt: Joi.date().greater('now').optional().messages({
      'date.greater': 'Expiry time must be in the future'
    }),
    deviceInfo: Joi.object({
      platform: Joi.string().valid('web', 'ios', 'android', 'desktop').optional(),
      version: Joi.string().optional(),
      model: Joi.string().optional()
    }).optional()
  }),
  
  "presence:get-user-status": Joi.object({
    userIds: Joi.array().items(Joi.string().regex(objectIdRegex)).min(1).max(100).required().messages({
      'array.min': 'At least one user ID is required',
      'array.max': 'Maximum 100 user IDs allowed',
      'array.includes': 'Invalid user ID format'
    }),
    includeLastSeen: Joi.boolean().default(true),
    includeCustomStatus: Joi.boolean().default(true)
  }),
  
  "presence:batch-status": Joi.object({
    userIds: Joi.array().items(Joi.string().regex(objectIdRegex)).min(1).max(100).required().messages({
      'array.min': 'At least one user ID is required',
      'array.max': 'Maximum 100 user IDs allowed',
      'array.includes': 'Invalid user ID format'
    })
  }),
  
  "presence:heartbeat": Joi.object({
    timestamp: Joi.number().optional(),
    deviceId: Joi.string().max(100).optional()
  }),
  
  // ========== DATING APP SPECIFIC SCHEMAS ==========
  "dating:send_icebreaker": Joi.object({
    receiverId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid receiver ID format',
      'any.required': 'receiverId is required'
    }),
    icebreakerId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid icebreaker ID format',
      'any.required': 'icebreakerId is required'
    }),
    answer: Joi.string().required().max(500).messages({
      'string.max': 'Icebreaker answer cannot exceed 500 characters',
      'any.required': 'Answer is required'
    })
  }),
  
  "dating:share_profile": Joi.object({
    receiverId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid receiver ID format',
      'any.required': 'receiverId is required'
    }),
    profileData: Joi.object({
      sharePhotos: Joi.boolean().default(true),
      shareLocation: Joi.boolean().default(false),
      shareAge: Joi.boolean().default(true),
      shareBio: Joi.boolean().default(true),
      shareInterests: Joi.boolean().default(true),
      expiresIn: Joi.number().min(300).max(604800).default(86400).messages({ // 5 min to 7 days, default 1 day
        'number.min': 'Share expiration must be at least 5 minutes',
        'number.max': 'Share expiration cannot exceed 7 days'
      })
    }).required()
  }),
  
  "dating:report_user": Joi.object({
    reportedUserId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid user ID format',
      'any.required': 'reportedUserId is required'
    }),
    reason: Joi.string().valid(
      'inappropriate_content',
      'harassment',
      'spam',
      'fake_profile',
      'underage',
      'other'
    ).required().messages({
      'any.only': 'Invalid report reason',
      'any.required': 'Reason is required'
    }),
    description: Joi.string().max(1000).optional().messages({
      'string.max': 'Description cannot exceed 1000 characters'
    }),
    messageIds: Joi.array().items(Joi.string().regex(objectIdRegex)).optional().messages({
      'array.includes': 'Invalid message ID format'
    }),
    conversationId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid conversation ID format'
    })
  }),
  
  "dating:block_user": Joi.object({
    blockedUserId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid user ID format',
      'any.required': 'blockedUserId is required'
    }),
    reason: Joi.string().max(200).optional().messages({
      'string.max': 'Reason cannot exceed 200 characters'
    }),
    hidePreviousMessages: Joi.boolean().default(true)
  }),
  
  "dating:unmatch": Joi.object({
    unmatchedUserId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid user ID format',
      'any.required': 'unmatchedUserId is required'
    }),
    reason: Joi.string().max(200).optional().messages({
      'string.max': 'Reason cannot exceed 200 characters'
    }),
    hideConversation: Joi.boolean().default(true)
  }),
  
  // ========== VOICE/VIDEO CALL SCHEMAS ==========
  "call:initiate": Joi.object({
    receiverId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid receiver ID format',
      'any.required': 'receiverId is required'
    }),
    type: Joi.string().valid('voice', 'video').required().messages({
      'any.only': 'Call type must be voice or video',
      'any.required': 'Type is required'
    }),
    callId: Joi.string().max(100).optional(),
    metadata: Joi.object({
      iceServers: Joi.array().optional(),
      constraints: Joi.object().optional()
    }).optional()
  }),
  
  "call:answer": Joi.object({
    callId: Joi.string().required().max(100).messages({
      'string.max': 'Call ID too long',
      'any.required': 'callId is required'
    }),
    accept: Joi.boolean().required().messages({
      'any.required': 'Accept is required'
    }),
    metadata: Joi.object({
      iceServers: Joi.array().optional(),
      constraints: Joi.object().optional()
    }).optional()
  }),
  
  "call:end": Joi.object({
    callId: Joi.string().required().max(100).messages({
      'string.max': 'Call ID too long',
      'any.required': 'callId is required'
    }),
    reason: Joi.string().max(100).optional(),
    duration: Joi.number().optional()
  }),
  
  // ========== NOTIFICATION SCHEMAS ==========
  "notifications:subscribe": Joi.object({
    types: Joi.array().items(Joi.string().valid(
      'messages',
      'matches',
      'likes',
      'visits',
      'calls',
      'system'
    )).min(1).required().messages({
      'array.min': 'At least one notification type is required',
      'array.includes': 'Invalid notification type'
    }),
    deviceToken: Joi.string().max(500).optional().messages({
      'string.max': 'Device token too long'
    })
  }),
  
  "notifications:unsubscribe": Joi.object({
    types: Joi.array().items(Joi.string().valid(
      'messages',
      'matches',
      'likes',
      'visits',
      'calls',
      'system'
    )).optional().messages({
      'array.includes': 'Invalid notification type'
    }),
    deviceToken: Joi.string().max(500).optional().messages({
      'string.max': 'Device token too long'
    })
  }),
  
  // ========== LOCATION SCHEMAS ==========
  "location:update": Joi.object({
    latitude: Joi.number().required().min(-90).max(90).messages({
      'number.min': 'Latitude must be between -90 and 90',
      'number.max': 'Latitude must be between -90 and 90',
      'any.required': 'Latitude is required'
    }),
    longitude: Joi.number().required().min(-180).max(180).messages({
      'number.min': 'Longitude must be between -180 and 180',
      'number.max': 'Longitude must be between -180 and 180',
      'any.required': 'Longitude is required'
    }),
    accuracy: Joi.number().min(0).optional(),
    timestamp: Joi.number().optional(),
    city: Joi.string().max(100).optional(),
    country: Joi.string().max(100).optional()
  }),
  
  "location:share": Joi.object({
    receiverId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid receiver ID format',
      'any.required': 'receiverId is required'
    }),
    location: Joi.object({
      latitude: Joi.number().required().min(-90).max(90),
      longitude: Joi.number().required().min(-180).max(180),
      name: Joi.string().max(200).optional()
    }).required(),
    duration: Joi.number().min(300).max(86400).default(3600).messages({ // 5 min to 24 hours, default 1 hour
      'number.min': 'Share duration must be at least 5 minutes',
      'number.max': 'Share duration cannot exceed 24 hours'
    })
  }),
  
  // ========== ADMIN SCHEMAS ==========
  "admin:moderate_message": Joi.object({
    messageId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid message ID format',
      'any.required': 'messageId is required'
    }),
    action: Joi.string().valid('delete', 'warn', 'ban', 'ignore').required().messages({
      'any.only': 'Action must be delete, warn, ban, or ignore',
      'any.required': 'Action is required'
    }),
    reason: Joi.string().max(500).required().messages({
      'string.max': 'Reason cannot exceed 500 characters',
      'any.required': 'Reason is required'
    }),
    notifyUser: Joi.boolean().default(true),
    duration: Joi.number().min(0).optional() // Ban duration in seconds
  }),
  
  "admin:view_conversation": Joi.object({
    userId: Joi.string().required().regex(objectIdRegex).messages({
      'string.pattern.base': 'Invalid user ID format',
      'any.required': 'userId is required'
    }),
    otherUserId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid user ID format'
    }),
    conversationId: Joi.string().regex(objectIdRegex).optional().messages({
      'string.pattern.base': 'Invalid conversation ID format'
    }),
    limit: Joi.number().min(1).max(500).default(100).messages({
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit cannot exceed 500'
    })
  }).or('otherUserId', 'conversationId').messages({
    'object.missing': 'Either otherUserId or conversationId is required'
  })
};