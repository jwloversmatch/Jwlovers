const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const messageSchema = new Schema({
  senderId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  receiverId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  conversationId: {
    type: Schema.Types.ObjectId,
    ref: "Conversation"
  },
  content: {
    type: String,
    required: true
  },
  originalContent: {
    type: String
  },
  type: {
    type: String,
    enum: ["text", "image", "file", "audio", "video"],
    default: "text"
  },
  mediaUrl: {
    type: String
  },
  status: {
    type: String,
    enum: ["sent", "delivered", "read"],
    default: "sent"
  },
  readBy: [{
    type: Schema.Types.ObjectId,
    ref: "User"
  }],
  isEncrypted: {
    type: Boolean,
    default: false
  },
  encryptionType: {
    type: String,
    enum: ["server-side", "client-side", "none"],
    default: "none"
  },
  needsMigration: {
    type: Boolean,
    default: false
  },
  migratedAt: {
    type: Date
  },
  clientMessageId: {
    type: String
  },
  source: {
    type: String,
    enum: ["websocket", "http", "system"],
    default: "websocket"
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, receiverId: 1 });
messageSchema.index({ readBy: 1 });
messageSchema.index({ createdAt: -1 });
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });

const Message = mongoose.model("Message", messageSchema);

module.exports = Message;