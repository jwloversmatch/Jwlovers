const express = require("express");
const { protect, authorize } = require("@middleware/authmiddleware"); // Fixed import name
const validate = require("@middleware/validation");
const chatValidators = require("@validators/socket.schemas"); 
const chatController = require("@controllers/chat/chat.controller"); // Fixed path case

const router = express.Router();

// Apply protect middleware to all routes
router.use(protect);

// ===================== CONVERSATIONS =====================

// Get all conversations for current user
router.get("/conversations", chatController.getConversations);

// Create new conversation
router.post("/conversations", chatController.createConversation);

// Get specific conversation with user
router.get("/conversations/with/:userId", chatController.getConversation);

// Get unread count for specific conversation
router.get("/conversations/with/:userId/unread", chatController.getUnreadCount);

// Get total unread count across all conversations
router.get("/conversations/unread/total", chatController.getTotalUnreadCount);

// Archive/unarchive conversation
router.patch("/conversations/with/:userId/archive", chatController.archiveConversation);

// Mute/unmute conversation
router.patch("/conversations/with/:userId/mute", chatController.muteConversation);

// Clear conversation messages
router.delete("/conversations/with/:userId", chatController.clearConversation);

// Search conversations
router.get("/conversations/search", chatController.searchConversations);

// ===================== MESSAGES =====================

// Get messages for a conversation
router.get("/conversations/:conversationId/messages", chatController.getMessages);

// Send message (HTTP endpoint)
// router.post("/messages", chatController.sendMessage);
// OR with validation if you have it:
router.post("/messages", validate(chatValidators["message:send"] || {}), chatController.sendMessage);

// Mark single message as read
router.patch("/messages/read/:messageId", chatController.markAsRead);

// Mark multiple messages as read
// router.put("/messages/read/bulk", chatController.markMessagesAsRead);
// OR with validation:
router.put("/messages/read/bulk", validate(chatValidators["messages:viewed"] || {}), chatController.markMessagesAsRead);

// Delete message
router.delete("/messages/:messageId", chatController.deleteMessage);

// Edit message
router.put("/messages/:messageId", chatController.editMessage);

// Delete multiple messages
router.delete("/messages/bulk", chatController.deleteMessagesBulk);

// ===================== REACTIONS =====================

// Add reaction to message
router.post("/messages/:messageId/reactions", chatController.addReaction);

// Remove reaction from message
router.delete("/messages/:messageId/reactions/:reaction", chatController.removeReaction);

// ===================== SEARCH & STATS =====================

// Search messages
router.get("/messages/search", chatController.searchMessages);

// Get chat stats
router.get("/stats", chatController.getStats);

// ===================== WEBSOCKET TOKEN =====================

// Get WebSocket token
router.get("/ws-token", chatController.getWsToken);

module.exports = router;