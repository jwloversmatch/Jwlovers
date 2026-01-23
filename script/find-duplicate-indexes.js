// find-duplicate-indexes.js
require('dotenv').config();
const mongoose = require('mongoose');

// Enable trace warnings
process.traceProcessWarnings = true;

async function findDuplicates() {
  console.log('🔍 Searching for duplicate indexes...\n');
  
  // Connect
  await mongoose.connect(process.env.MONGODB_URI);
  
  // Require all your models to see warnings
  console.log('📋 Loading models...\n');
  
  try {
    require('../models/User'); // Load your User models
  } catch (error) {
    console.log('⚠️ Could not load User models:', error.message);
  }
  
  // Wait a bit to see warnings
  setTimeout(async () => {
    console.log('\n✅ All models loaded');
    console.log('\n📊 Checking existing indexes in database...\n');
    
    // Check all collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    
    for (const collection of collections) {
      console.log(`\n📁 Collection: ${collection.name}`);
      try {
        const indexes = await mongoose.connection.db.collection(collection.name).indexes();
        
        // Check for duplicates
        const indexKeys = new Map();
        const duplicates = [];
        
        indexes.forEach((index, i) => {
          const key = JSON.stringify(index.key);
          if (indexKeys.has(key)) {
            duplicates.push({
              key: key,
              first: indexKeys.get(key),
              second: i
            });
          } else {
            indexKeys.set(key, i);
          }
        });
        
        if (duplicates.length > 0) {
          console.log('❌ DUPLICATE INDEXES FOUND:');
          duplicates.forEach(dup => {
            console.log(`  Key: ${dup.key}`);
            console.log(`  Indexes at positions: ${dup.first} and ${dup.second}`);
          });
        } else {
          console.log('✅ No duplicate indexes found');
        }
        
        console.log(`  Total indexes: ${indexes.length}`);
        
      } catch (error) {
        console.log(`  Error: ${error.message}`);
      }
    }
    
    await mongoose.disconnect();
    console.log('\n✅ Done!');
    process.exit(0);
    
  }, 1000); // Give time for warnings to appear
}

findDuplicates().catch(console.error);