// models/PresenceHistory.model.js
const mongoose = require("mongoose");

const PresenceHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    oldStatus: {
      type: String,
      enum: ["online", "away", "busy", "offline", "dnd"],
      required: true,
    },
    newStatus: {
      type: String,
      enum: ["online", "away", "busy", "offline", "dnd"],
      required: true,
    },
    source: {
      type: String,
      enum: ["api", "socket", "system", "cleanup", "manual", "heartbeat"],
      default: "api",
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    metadata: {
      ipAddress: String,
      userAgent: String,
      sessionId: String,
      socketId: String,
    },
  },
  {
    timestamps: true,
  },
);

// Static methods
PresenceHistorySchema.statics.getUserHistory = async function (
  userId,
  limit = 50,
  offset = 0,
) {
  return this.find({ userId })
    .sort({ timestamp: -1 })
    .skip(offset)
    .limit(limit)
    .lean();
};

PresenceHistorySchema.statics.getRecentChanges = async function (
  hours = 24,
  limit = 100,
) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.find({ timestamp: { $gte: cutoff } })
    .sort({ timestamp: -1 })
    .limit(limit)
    .populate("userId", "firstName lastName userName")
    .lean();
};

PresenceHistorySchema.statics.cleanupOldRecords = async function (
  daysToKeep = 30,
) {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
  const result = await this.deleteMany({ timestamp: { $lt: cutoff } });
  return result.deletedCount;
};

const PresenceHistory = mongoose.model(
  "PresenceHistory",
  PresenceHistorySchema,
);

module.exports = PresenceHistory;
