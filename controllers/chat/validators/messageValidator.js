const Joi = require('joi');

const messageSchemas = {
  sendMessage: Joi.object({
    receiverId:       Joi.string().required(),
    content:          Joi.string().min(1).max(10000).required(), // FIX #8: raised from 5000 → 10000 to match MessageService.CONFIG.MAX_MESSAGE_LENGTH
    type:             Joi.string().valid('text', 'image', 'video', 'file', 'audio').default('text'),
    mediaUrl:         Joi.string().uri().optional(),
    conversationId:   Joi.string().optional(),
    clientMessageId:  Joi.string().optional(),  // FIX #1: dedup key used by MessageService
    messageId:        Joi.string().optional(),  // FIX #1: legacy alias still accepted
    senderId:         Joi.string().optional(),  // FIX #1: spread from chatSlice thunk
    tempId:           Joi.string().optional(),  // FIX #1: spread from chatSlice thunk
  }),

  editMessage: Joi.object({
    content: Joi.string().min(1).max(10000).required(), // aligned with MAX_MESSAGE_LENGTH
  }),

  markMessagesRead: Joi.object({
    messageIds:     Joi.array().items(Joi.string()).min(1).required(),
    conversationId: Joi.string().optional(),  // FIX #3: frontend sends this, service ignores it (gets it from DB)
  }),

  deleteMessagesBulk: Joi.object({
    messageIds:     Joi.array().items(Joi.string()).min(1).required(),
    conversationId: Joi.string().optional(),  // FIX #4: frontend sends this, service fetches it anyway
  }),

  addReaction: Joi.object({
    reaction: Joi.string().min(1).max(10).required(),
  }),
};

const validateMessage = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, {
    abortEarly: false,
    allowUnknown: false,
  });

  if (error) {
    const errors = error.details.map(detail => detail.message);
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors,
    });
  }

  next();
};

module.exports = {
  messageSchemas,
  validateMessage,
};