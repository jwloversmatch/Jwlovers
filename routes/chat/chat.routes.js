const express = require("express");
const { protect } = require("@middleware/auth");
const validate = require("@middleware/validation");
const chatValidators = require("@validators/socket.schemas"); 
const chatController = require("@controllers/chat/chat.controller");

const router = express.Router();

// Apply protect middleware to all routes
router.use(protect);

/* ===================== CONVERSATIONS ===================== */
router.get("/conversations", chatController.getConversations);
router.post("/conversations", chatController.createConversation);
router.get("/conversations/with/:userId", chatController.getConversation);
router.get("/conversations/with/:userId/unread", chatController.getUnreadCount);
router.get("/conversations/unread/total", chatController.getTotalUnreadCount);
router.patch("/conversations/with/:userId/archive", chatController.archiveConversation);
router.patch("/conversations/with/:userId/mute", chatController.muteConversation);
router.delete("/conversations/with/:userId", chatController.clearConversation);
router.get("/conversations/search", chatController.searchConversations);

/* ===================== MESSAGES ===================== */
router.get("/conversations/:conversationId/messages", chatController.getMessages);
router.post("/messages", validate(chatValidators["message:send"]), chatController.sendMessage);
router.patch("/messages/read/:messageId", chatController.markAsRead);
router.put("/messages/read/bulk", validate(chatValidators["messages:viewed"]), chatController.markMessagesAsRead);
router.delete("/messages/:messageId", chatController.deleteMessage);
router.put("/messages/:messageId", chatController.editMessage);

/* ===================== SEARCH & STATS ===================== */
router.get("/messages/search", chatController.searchMessages);
router.get("/stats", chatController.getStats);

/* ===================== WEBSOCKET TOKEN ===================== */
router.get("/ws-token", chatController.getWsToken);

module.exports = router;