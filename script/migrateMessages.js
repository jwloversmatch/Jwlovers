// migration-fix-encryption.js
const mongoose = require('mongoose');
require('dotenv').config();

async function fixEncryptionFields() {
  console.log('🚀 Starting encryption field migration...');
  
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/jwlovers', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('✅ Connected to MongoDB');
    
    // Load Message model (adjust path as needed)
    const Message = require('./models/Message');
    
    // Find messages with encrypted content but wrong encryption field
    // Look for content that is JSON with iv, authTag, and content fields
    const messages = await Message.find({
      $or: [
        { content: { $regex: /^{.*"iv":.*"authTag":.*"content":/i } },
        { content: { $regex: /^{.*"iv":.*"content":/i } }
      ]
    });
    
    console.log(`📊 Found ${messages.length} potentially encrypted messages`);
    
    let fixedCount = 0;
    let errorCount = 0;
    
    for (const message of messages) {
      try {
        const parsed = JSON.parse(message.content);
        
        // Check if it has the structure of an encrypted message
        const isEncrypted = parsed.iv && parsed.content;
        const hasAuthTag = !!parsed.authTag; // GCM has authTag, CBC might not
        
        if (isEncrypted) {
          const algorithm = parsed.alg || 'AES-256-GCM';
          
          await Message.updateOne(
            { _id: message._id },
            {
              $set: {
                'encryption.isEncrypted': true,
                'encryption.algorithm': algorithm,
                'encryption.migrated': true,
                isEncrypted: true,
                encryptionType: 'server-side'
              }
            }
          );
          
          fixedCount++;
          console.log(`✅ Fixed message ${message._id} (algorithm: ${algorithm})`);
        }
      } catch (error) {
        errorCount++;
        console.log(`⚠️ Skipping message ${message._id}: ${error.message}`);
      }
    }
    
    console.log('\n📊 Migration Summary:');
    console.log(`   Total messages scanned: ${messages.length}`);
    console.log(`   Successfully fixed: ${fixedCount}`);
    console.log(`   Errors/skipped: ${errorCount}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    // Close connection
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the migration
fixEncryptionFields();