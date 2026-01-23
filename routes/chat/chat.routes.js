const express = require("express");

const authMiddleware = require("@middleware/auth");
const validate = require("@middleware/validation");
const chatValidators = require("@validators/socket.schemas"); 
const chatController = require("@controllers/chat/chat.controller");

const router = express.Router();

/* ===================== CONVERSATIONS ===================== */

router.get("/conversations", authMiddleware, chatController.getConversations);

router.post(
  "/conversations",
  authMiddleware,
  chatController.createConversation,
);

router.get(
  "/conversations/with/:userId",
  authMiddleware,
  chatController.getConversation,
);

router.get(
  "/conversations/with/:userId/unread",
  authMiddleware,
  chatController.getUnreadCount,
);

router.get(
  "/conversations/unread/total",
  authMiddleware,
  chatController.getTotalUnreadCount,
);

router.patch(
  "/conversations/with/:userId/archive",
  authMiddleware,
  chatController.archiveConversation,
);

router.patch(
  "/conversations/with/:userId/mute",
  authMiddleware,
  chatController.muteConversation,
);

router.delete(
  "/conversations/with/:userId",
  authMiddleware,
  chatController.clearConversation,
);

router.get(
  "/conversations/search",
  authMiddleware,
  chatController.searchConversations,
);

/* ===================== MESSAGES ===================== */

router.get(
  "/conversations/:conversationId/messages",
  authMiddleware,
  chatController.getMessages,
);

router.post(
  "/messages",
  authMiddleware,
  validate(chatValidators["message:send"]), // ✅ CORRECT
  chatController.sendMessage,
);

router.patch(
  "/messages/read/:messageId",
  authMiddleware,
  chatController.markAsRead,
);

router.put(
  "/messages/read/bulk",
  authMiddleware,
  validate(chatValidators["messages:viewed"]), // ✅ CORRECT
  chatController.markMessagesAsRead,
);

router.delete(
  "/messages/:messageId",
  authMiddleware,
  chatController.deleteMessage,
);

router.put("/messages/:messageId", authMiddleware, chatController.editMessage);

/* ===================== SEARCH & STATS ===================== */

router.get("/messages/search", authMiddleware, chatController.searchMessages);

router.get("/stats", authMiddleware, chatController.getStats);

/* ===================== WEBSOCKET TOKEN ===================== */

router.get("/ws-token", authMiddleware, chatController.getWsToken);

module.exports = router;
