const Message = require('@models/Message');

class ReactionService {
  async addReaction(userId, messageId, reaction) {
    if (!reaction) {
      throw new Error('Reaction is required');
    }
    
    const message = await Message.findById(messageId);
    
    if (!message) {
      throw new Error('Message not found');
    }
    
    // Check if user already has this reaction
    const existingReactionIndex = message.reactions.findIndex(
      r => r.userId.toString() === userId && r.emoji === reaction
    );
    
    if (existingReactionIndex >= 0) {
      // Remove if same reaction clicked again (toggle)
      message.reactions.splice(existingReactionIndex, 1);
    } else {
      // Remove any existing reaction from this user
      message.reactions = message.reactions.filter(r => r.userId.toString() !== userId);
      // Add new reaction
      message.reactions.push({
        userId,
        emoji: reaction,
        createdAt: new Date()
      });
    }
    
    await message.save();
    
    return {
      reactions: message.reactions,
      userReaction: message.reactions.find(r => r.userId.toString() === userId)
    };
  }

  async removeReaction(userId, messageId, reaction) {
    const message = await Message.findById(messageId);
    
    if (!message) {
      throw new Error('Message not found');
    }
    
    // Remove specific reaction
    const initialLength = message.reactions.length;
    message.reactions = message.reactions.filter(
      r => !(r.userId.toString() === userId && r.emoji === reaction)
    );
    
    // Only save if something changed
    if (message.reactions.length !== initialLength) {
      await message.save();
    }
    
    return {
      reactions: message.reactions
    };
  }
}

module.exports = new ReactionService();