const express = require("express");
const { protect, authorize } = require("@middleware/authmiddleware");
const validate = require("@middleware/validation");
const chatValidators = require("@validators/socket.schemas"); 
const chatController = require("@controllers/chat/chat.controller");

const router = express.Router();

// Apply protect middleware to all routes
router.use(protect);

// Helper function to safely get validators
const getValidators = (validatorName) => {
  const validators = chatValidators[validatorName];
  return Array.isArray(validators) ? validators : [];
};

// ===================== WEBSOCKET TOKEN =====================
// MOVED TO TOP - Must come before /conversations/:conversationId to avoid conflict
router.get("/ws-token", chatController.getWsToken);

// ===================== STATS =====================
// MOVED UP - Must come before routes with :messageId param
router.get("/stats", chatController.getStats);

// ===================== CONVERSATIONS =====================

// Search conversations - MUST come before /conversations/with/:userId
router.get("/conversations/search", chatController.searchConversations);

// Get total unread count - MUST come before /conversations/with/:userId
router.get("/conversations/unread/total", chatController.getTotalUnreadCount);

// Get all conversations for current user
router.get("/conversations", chatController.getConversations);

// Create new conversation
router.post("/conversations", chatController.createConversation);

// Get messages for a conversation - MUST come before /conversations/with/:userId
router.get("/conversations/:conversationId/messages", chatController.getMessages);

// Get specific conversation with user
router.get("/conversations/with/:userId", chatController.getConversation);

// Get unread count for specific conversation
router.get("/conversations/with/:userId/unread", chatController.getUnreadCount);

// Archive/unarchive conversation
router.patch("/conversations/with/:userId/archive", chatController.archiveConversation);

// Mute/unmute conversation
router.patch("/conversations/with/:userId/mute", chatController.muteConversation);

// Clear conversation messages
router.delete("/conversations/with/:userId", chatController.clearConversation);

// ===================== MESSAGES =====================

// Search messages - MUST come before /messages/:messageId
router.get("/messages/search", chatController.searchMessages);

// Mark multiple messages as read - MUST come before /messages/:messageId
router.put(
  "/messages/read/bulk", 
  validate(getValidators("messages:viewed")), 
  chatController.markMessagesAsRead
);

// Delete multiple messages - MUST come before /messages/:messageId
router.delete("/messages/bulk", chatController.deleteMessagesBulk);

// Send message (HTTP endpoint)
router.post(
  "/messages", 
  validate(getValidators("message:send")), 
  chatController.sendMessage
);

// Mark single message as read
router.patch("/messages/read/:messageId", chatController.markAsRead);

// Delete message
router.delete("/messages/:messageId", chatController.deleteMessage);

// Edit message
router.put("/messages/:messageId", chatController.editMessage);

// ===================== REACTIONS =====================

// Add reaction to message
router.post("/messages/:messageId/reactions", chatController.addReaction);

// Remove reaction from message
router.delete("/messages/:messageId/reactions/:reaction", chatController.removeReaction);

module.exports = router;