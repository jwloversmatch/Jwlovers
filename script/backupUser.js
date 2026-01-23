// backupUser.js - Corrected version
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const { createGzip } = require('zlib');
const { pipeline } = require('stream');

async function backupUsers() {
  const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URL;
  
  if (!mongoURI) {
    console.error('❌ MONGODB_URI environment variable is not set!');
    console.log('Please set it in your .env file:');
    console.log('MONGODB_URI=mongodb://localhost:27017/jwlovers');
    process.exit(1);
  }
  
  console.log('🔗 Connecting to MongoDB...');
  
  try {
    // Simple connection for Mongoose 6+
    await mongoose.connect(mongoURI);
    
    console.log('✅ Connected to MongoDB successfully');
    console.log('📁 Database:', mongoose.connection.db.databaseName);
    
    // Load the old User model
    let oldUserModel;
    try {
      // Try to load from your old structure
      oldUserModel = require('../models/User/User.model');
    } catch (error) {
      console.log('⚠️ Could not load old User model, trying alternative...');
      // Try to get it from mongoose models
      oldUserModel = mongoose.models.User || mongoose.model('User');
    }
    
    if (!oldUserModel) {
      console.error('❌ Could not find User model');
      console.log('Please specify the correct path to your old User model');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    console.log('📊 Fetching users...');
    const users = await oldUserModel.find({}).lean();
    console.log(`✅ Found ${users.length} users to backup`);
    
    if (users.length === 0) {
      console.log('⚠️ No users found. Nothing to backup.');
      await mongoose.disconnect();
      return;
    }
    
    // Create backup directory
    const backupDir = './backups';
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log(`📁 Created backup directory: ${backupDir}`);
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = `${backupDir}/user-backup-${timestamp}.json`;
    const gzipFile = `${backupFile}.gz`;
    
    // Save to JSON file - FIXED TYPO HERE
    console.log(`💾 Saving backup to ${backupFile}...`); // Changed backFile to backupFile
    fs.writeFileSync(backupFile, JSON.stringify(users, null, 2));
    console.log(`✅ Backup saved (${fs.statSync(backupFile).size} bytes)`);
    
    // Compress
    console.log('🗜️ Compressing backup...');
    const gzip = createGzip();
    const source = fs.createReadStream(backupFile);
    const destination = fs.createWriteStream(gzipFile);
    
    await new Promise((resolve, reject) => {
      pipeline(source, gzip, destination, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    console.log(`✅ Compressed backup saved to ${gzipFile} (${fs.statSync(gzipFile).size} bytes)`);
    
    // Delete uncompressed file
    fs.unlinkSync(backupFile);
    console.log('✅ Removed uncompressed file');
    
    // Create summary
    const summary = {
      timestamp: new Date().toISOString(),
      database: mongoose.connection.db.databaseName,
      userCount: users.length,
      backupFile: gzipFile,
      sampleUsers: users.slice(0, 3).map(u => ({
        _id: u._id,
        email: u.email || 'no-email',
        name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'no-name',
        role: u.role || 'user'
      }))
    };
    
    const summaryFile = `${backupDir}/backup-summary-${timestamp}.json`;
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    console.log(`✅ Backup summary saved to ${summaryFile}`);
    
    await mongoose.disconnect();
    console.log('\n🎉 Backup complete!');
    console.log(`\n📦 Backup files created:`);
    console.log(`  • ${gzipFile}`);
    console.log(`  • ${summaryFile}`);
    
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    console.error('Stack:', error.stack);
    
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

// Run backup
backupUsers().catch(console.error);