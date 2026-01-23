// // services/message.service.js
// const Message = require('@models/Message');
// const Conversation = require('@models/Conversation');
// const messageQueue = require('@queues/message.queue');
// const logger = require('@utils/logger');
// const metrics = require('@utils/metrics');

// class MessageService {
//   async sendMessage(data) {
//     const { senderId, receiverId, content, type, mediaUrl } = data;
    
//     // Validate message
//     this.validateMessage(content, type);
    
//     // Create message
//     const message = await Message.create({
//       senderId,
//       receiverId,
//       content,
//       type,
//       mediaUrl,
//       status: 'sent'
//     });
    
//     // Update conversation
//     await this.updateConversation(senderId, receiverId, message._id);
    
//     // Log metrics
//     metrics.messageSize.observe(content.length);
    
//     // Add to queue for async processing (analytics, indexing, etc.)
//     await messageQueue.add('process-message', {
//       messageId: message._id,
//       senderId,
//       receiverId
//     }, {
//       delay: 1000, // Process after 1 second
//       attempts: 3
//     });
    
//     return message;
//   }
  
//   validateMessage(content, type) {
//     if (type === 'text') {
//       if (!content || content.trim().length === 0) {
//         throw new Error('Message content is required');
//       }
      
//       if (content.length > 10000) {
//         throw new Error('Message too long');
//       }
      
//       // Check for spam (simplified)
//       const spamKeywords = ['buy now', 'click here', 'free money'];
//       if (spamKeywords.some(keyword => content.toLowerCase().includes(keyword))) {
//         throw new Error('Message contains suspicious content');
//       }
//     }
//   }
  
//   async updateConversation(user1Id, user2Id, lastMessageId) {
//     const participants = [user1Id, user2Id].sort();
    
//     await Conversation.findOneAndUpdate(
//       { participants },
//       {
//         $set: {
//           lastMessage: lastMessageId,
//           lastMessageAt: new Date()
//         },
//         $inc: {
//           [`unreadCount.${user2Id}`]: 1
//         }
//       },
//       {
//         upsert: true,
//         new: true
//       }
//     );
//   }
  
//   async getConversation(userId, otherUserId, options = {}) {
//     const {
//       limit = 50,
//       before = null,
//       after = null
//     } = options;
    
//     const conversationId = [userId, otherUserId]
//       .sort()
//       .map(id => id.toString())
//       .join('_');
    
//     const query = { conversationId };
    
//     if (before) {
//       query.createdAt = { $lt: new Date(before) };
//     } else if (after) {
//       query.createdAt = { $gt: new Date(after) };
//     }
    
//     const messages = await Message.find(query)
//       .sort({ createdAt: -1 })
//       .limit(limit)
//       .populate('senderId', 'name avatar')
//       .populate('receiverId', 'name avatar');
    
//     // Mark as delivered if recipient is viewing
//     if (messages.length > 0) {
//       const undeliveredMessages = messages.filter(
//         msg => msg.receiverId._id.toString() === userId && msg.status === 'sent'
//       );
      
//       if (undeliveredMessages.length > 0) {
//         await Message.updateMany(
//           { _id: { $in: undeliveredMessages.map(msg => msg._id) } },
//           { status: 'delivered', deliveredAt: new Date() }
//         );
//       }
//     }
    
//     return messages.reverse(); // Return in chronological order
//   }
  
//   async markMessagesAsRead(userId, messageIds) {
//     if (!messageIds || messageIds.length === 0) return;
    
//     const result = await Message.updateMany(
//       {
//         _id: { $in: messageIds },
//         receiverId: userId,
//         status: { $ne: 'read' }
//       },
//       {
//         status: 'read',
//         readAt: new Date()
//       }
//     );
    
//     // Update conversation unread count
//     if (result.modifiedCount > 0) {
//       await this.updateUnreadCounts(userId, messageIds);
//     }
    
//     return result;
//   }
  
//   async updateUnreadCounts(userId, messageIds) {
//     // Get conversations for these messages
//     const messages = await Message.find(
//       { _id: { $in: messageIds } },
//       { senderId: 1, receiverId: 1 }
//     );
    
//     const conversationUpdates = messages.map(msg => {
//       const participants = [msg.senderId, msg.receiverId].sort();
//       return Conversation.findOneAndUpdate(
//         { participants },
//         { $inc: { [`unreadCount.${userId}`]: -1 } }
//       );
//     });
    
//     await Promise.all(conversationUpdates);
//   }
// }

// module.exports = new MessageService();