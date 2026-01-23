require('dotenv').config();
const Database = require('@config/database');

async function setupDatabase() {
  console.log('🔧 Setting up database...');
  
  try {
    const db = Database;
    
    // Wait for connection
    await new Promise(resolve => {
      const checkConnection = () => {
        if (db.getConnection().readyState === 1) {
          resolve();
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      checkConnection();
    });
    
    console.log('✅ Database connection established');
    
    // Create indexes if needed
    const collections = await db.getConnection().db.listCollections().toArray();
    console.log(`📋 Existing collections: ${collections.map(c => c.name).join(', ')}`);
    
    if (collections.length === 0) {
      console.log('📝 No collections found. Ready for your models!');
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    console.log('\n💡 Troubleshooting:');
    console.log('   1. Check if MongoDB is running: "mongod"');
    console.log('   2. Verify MONGODB_URI in .env file');
    console.log('   3. For MongoDB Atlas: Check network access');
    console.log('   4. For local install: Ensure MongoDB service is running');
    process.exit(1);
  }
}

setupDatabase();