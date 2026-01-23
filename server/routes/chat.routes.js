const express = require("express");
const mongoose = require("mongoose");

const authMiddleware = require("../middleware/auth");
const validate = require("../middleware/validation");
const validationSchemas = require("../utils/validators");
const chatController = require("../controllers/chatController");
const logger = require("../utils/logger");

const router = express.Router();

router.get("/conversations", authMiddleware, chatController.getConversations);

router.get("/conversations/with/:userId", 
  authMiddleware, 
  validate(validationSchemas.userIdParam, 'params'),
  chatController.getConversationWithUser
);

router.get("/conversations/with/:userId/unread", 
  authMiddleware,
  validate(validationSchemas.userIdParam, 'params'),
  chatController.getUnreadCount
);

router.get("/conversations/unread/total", authMiddleware, chatController.getTotalUnreadCount);

router.post("/messages", 
  authMiddleware,
  validate(validationSchemas.message),
  chatController.sendMessage
);

router.put("/messages/read/bulk", authMiddleware, chatController.markMessagesAsRead);

router.post("/conversations", authMiddleware, chatController.createConversation);

router.get("/conversations/search", authMiddleware, chatController.searchConversations);

router.patch("/conversations/with/:userId/archive", 
  authMiddleware,
  validate(validationSchemas.userIdParam, 'params'),
  chatController.archiveConversation
);

router.patch("/conversations/with/:userId/mute", 
  authMiddleware,
  validate(validationSchemas.userIdParam, 'params'),
  chatController.muteConversation
);

router.delete("/conversations/with/:userId", 
  authMiddleware,
  validate(validationSchemas.userIdParam, 'params'),
  chatController.clearConversation
);

router.get("/ws-token", authMiddleware, chatController.getWsToken);

router.post("/migrate-legacy-messages", authMiddleware, chatController.migrateLegacyMessages);

module.exports = router;