// Create database user
db.createUser({
  user: 'jwlovers',
  pwd: 'jwlovers123',
  roles: [
    { role: 'readWrite', db: 'jwlovers' },
    { role: 'dbAdmin', db: 'jwlovers' }
  ]
});

// Switch to jwlovers database
db = db.getSiblingDB('jwlovers');

// Create collections
db.createCollection('users');
db.createCollection('messages');
db.createCollection('conversations');

// Create indexes
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ userName: 1 }, { unique: true, sparse: true });
db.users.createIndex({ createdAt: -1 });

db.messages.createIndex({ conversationId: 1, createdAt: -1 });
db.messages.createIndex({ senderId: 1, receiverId: 1 });
db.messages.createIndex({ createdAt: -1 });

db.conversations.createIndex({ participants: 1 }, { unique: true });
db.conversations.createIndex({ lastMessageAt: -1 });

print('✅ MongoDB initialized successfully');