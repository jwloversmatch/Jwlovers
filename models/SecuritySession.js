// models/SecuritySession.js - CORRECTED VERSION
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const securitySessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
      index: true,
    },
    questionId: {
      type: String,
      required: true,
      ref: "SecurityQuestion",
    },
    userAnswerHash: {
      type: String,
      select: false, // KEEP THIS - sensitive
    },
    originalAnswer: {
      type: String,
    },
    clientFingerprint: {
      type: String,
      index: true,
    },
    ipAddress: {
      type: String,
      required: true,
    },
    userAgent: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "valid", "completed", "expired", "failed"],
      default: "valid",
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 15 * 60 * 1000),
    },
    usedFor: {
      type: String,
      enum: ["registration", "password_reset", "login_recovery", "other"],
      default: "registration",
    },
    verifiedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    isValidForRegistration: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Single index definition for expiresAt (avoid duplicate warning)
securitySessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-save hook
securitySessionSchema.pre("save", function () {
  if (!this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  }
});

module.exports = mongoose.model("SecuritySession", securitySessionSchema);