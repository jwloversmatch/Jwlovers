const mongoose = require('mongoose');

const userSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    
  },
  
  socketId: {
    type: String,
    required: true,
    
  },
  
  userAgent: {
    type: String,
    default: ''
  },
  
  ipAddress: {
    type: String,
    default: ''
  },
  
  deviceInfo: {
    type: {
      browser: String,
      os: String,
      device: String,
      isMobile: Boolean
    },
    default: {}
  },
  
  connectedAt: {
    type: Date,
    default: Date.now,
    
  },
  
  lastActivity: {
    type: Date,
    default: Date.now,
    
  },
  
  disconnectedAt: {
    type: Date,
    default: null
  },
  
  status: {
    type: String,
    enum: ['active', 'disconnected', 'expired'],
    default: 'active',
    
  },
  
  // For tracking app version
  appVersion: String,
  
  // For WebSocket connection details
  connectionDetails: {
    transport: String,
    remoteAddress: String
  }
  
}, {
  timestamps: true
});

// Methods
userSessionSchema.methods.updateActivity = function() {
  this.lastActivity = new Date();
  return this.save();
};

userSessionSchema.methods.disconnect = function() {
  this.status = 'disconnected';
  this.disconnectedAt = new Date();
  return this.save();
};

// Static methods
userSessionSchema.statics.findActiveByUserId = function(userId) {
  return this.find({ 
    userId, 
    status: 'active',
    disconnectedAt: null
  });
};

userSessionSchema.statics.cleanupOldSessions = async function(days = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  return this.deleteMany({
    disconnectedAt: { $lt: cutoffDate },
    status: { $in: ['disconnected', 'expired'] }
  });
};

module.exports = mongoose.model('UserSession', userSessionSchema);