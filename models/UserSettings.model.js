const mongoose = require("mongoose");

const userSettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  
  // Chat Settings
  chat: {
    onlineStatus: {
      type: String,
      enum: ["online", "away", "busy", "invisible"],
      default: "online",
    },
    showOnlineStatus: { type: Boolean, default: true },
    showLastSeen: { type: Boolean, default: true },
    readReceipts: { type: Boolean, default: true },
    typingIndicators: { type: Boolean, default: true },
    allowMessagesFrom: {
      type: String,
      enum: ["everyone", "contacts", "nobody"],
      default: "everyone",
    },
    theme: {
      type: String,
      enum: ["light", "dark", "auto"],
      default: "auto",
    },
  },
  
  // Notification Settings
  notifications: {
    messages: { type: Boolean, default: true },
    groups: { type: Boolean, default: true },
    mentions: { type: Boolean, default: true },
    email: { type: Boolean, default: true },
    push: { type: Boolean, default: true },
  },
  
  // Privacy Settings
  privacy: {
    profileVisibility: {
      type: String,
      enum: ["public", "private", "contacts"],
      default: "public",
    },
    showEmail: { type: Boolean, default: false },
    showPhone: { type: Boolean, default: false },
  },
  
  // Media Settings
  media: {
    autoDownload: {
      wifi: { type: Boolean, default: true },
      cellular: { type: Boolean, default: false },
    },
    maxFileSize: {
      type: Number,
      default: 10 * 1024 * 1024, // 10MB
    },
  },
  
}, {
  timestamps: true,
});

userSettingsSchema.index({ userId: 1 });

module.exports = mongoose.model("UserSettings", userSettingsSchema);