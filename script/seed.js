const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('@models/User/User.model');
const Message = require('@models/Message');
const logger = require('@utils/logger');
require('dotenv').config();

async function seed() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Connected to database');

    // Clear existing data
    await User.deleteMany({});
    await Message.deleteMany({});
    logger.info('Cleared existing data');

    // Create test users
    const users = await User.create([
      {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123',
        avatar: 'https://ui-avatars.com/api/?name=John+Doe&background=random',
        bio: 'Software developer and tech enthusiast'
      },
      {
        name: 'Jane Smith',
        email: 'jane@example.com',
        password: 'password123',
        avatar: 'https://ui-avatars.com/api/?name=Jane+Smith&background=random',
        bio: 'Product designer and UX expert'
      },
      {
        name: 'Bob Johnson',
        email: 'bob@example.com',
        password: 'password123',
        avatar: 'https://ui-avatars.com/api/?name=Bob+Johnson&background=random',
        bio: 'Digital marketing specialist'
      }
    ]);

    logger.info(`Created ${users.length} users`);

    // Create sample messages
    const messages = await Message.create([
      {
        senderId: users[0]._id,
        receiverId: users[1]._id,
        content: 'Hey Jane, how are you doing?',
        type: 'text',
        status: 'read'
      },
      {
        senderId: users[1]._id,
        receiverId: users[0]._id,
        content: 'Hi John! I\'m doing great, thanks! How about you?',
        type: 'text',
        status: 'read'
      },
      {
        senderId: users[0]._id,
        receiverId: users[1]._id,
        content: 'Just working on our new chat application. Want to test it?',
        type: 'text',
        status: 'delivered'
      },
      {
        senderId: users[0]._id,
        receiverId: users[2]._id,
        content: 'Bob, are you joining the meeting tomorrow?',
        type: 'text',
        status: 'sent'
      }
    ]);

    logger.info(`Created ${messages.length} messages`);

    // Close connection
    await mongoose.connection.close();
    logger.info('Seeding completed successfully');
    process.exit(0);

  } catch (error) {
    logger.error('Seeding failed:', error);
    process.exit(1);
  }
}

seed();