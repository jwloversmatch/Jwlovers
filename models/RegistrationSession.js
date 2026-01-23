// models/RegistrationSession.js
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const registrationSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4(),
    },
    questionId: {
      type: String,
      required: true,
    },
    // Store only attempt count, not answers
    attemptCount: {
      type: Number,
      default: 0,
      min: 0,
      max: 3,
    },
    // Client fingerprint for additional security
    clientFingerprint: {
      type: String,
      required: true,
    },
    ipAddress: {
      type: String,
      required: true,
    },
    userAgent: {
      type: String,
      required: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verifiedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, 
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);



// Check if session is valid
registrationSessionSchema.methods.isValid = function () {
  const now = new Date();
  return !this.isVerified && 
         this.attemptCount < 3 && 
         this.expiresAt > now;
};

// Increment attempt count - FIXED to handle async properly
registrationSessionSchema.methods.incrementAttempt = async function () {
  this.attemptCount += 1;
  if (this.attemptCount >= 3) {
    this.expiresAt = new Date(); 
  }
  return await this.save();
};

// Mark as verified
registrationSessionSchema.methods.markAsVerified = async function () {
  this.isVerified = true;
  this.verifiedAt = new Date();
  return await this.save();
};

// Static method to create session - IMPROVED
registrationSessionSchema.statics.createSession = async function (data) {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  
  const session = new this({
    questionId: data.questionId,
    clientFingerprint: data.clientFingerprint,
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    expiresAt: expiresAt,
    metadata: data.metadata || {},
  });
  
  return await session.save();
};

// Find valid session by sessionId
registrationSessionSchema.statics.findValidSession = async function (sessionId, questionId = null) {
  const query = {
    sessionId,
    isVerified: false,
    expiresAt: { $gt: new Date() }
  };
  
  if (questionId) {
    query.questionId = questionId;
  }
  
  return await this.findOne(query);
};

// Clean up expired sessions (for manual cleanup if TTL doesn't work)
registrationSessionSchema.statics.cleanupExpiredSessions = async function () {
  const result = await this.deleteMany({
    $or: [
      { expiresAt: { $lt: new Date() } },
      { isVerified: true, verifiedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } // Clean verified sessions after 24 hours
    ]
  });
  
  return result.deletedCount;
};

module.exports = mongoose.model("RegistrationSession", registrationSessionSchema);