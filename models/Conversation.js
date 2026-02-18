// models/Conversation.js (For faster last message queries)
const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BaseUser',
    
  }],
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastMessageAt: {
    type: Date,
    
  },
  unreadCount: {
    type: Map,
    of: Number,
    default: {}
  },
  mutedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BaseUser'
  }],
  archivedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BaseUser'
  }]
}, {
  timestamps: true
});


module.exports = mongoose.model('Conversation', conversationSchema);