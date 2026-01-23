// migrateUserStatus.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

console.log('🔧 Starting user status migration...');
console.log(`📦 Mongoose version: ${mongoose.version}`);

async function runMigration() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    
    // Use same connection approach as message migration
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database');
    
    // Check if User model exists
    if (!mongoose.models.User) {
      console.error('❌ User model not found. Make sure it is imported correctly.');
      process.exit(1);
    }
    
    // Get stats first
    const totalUsers = await User.countDocuments();
    console.log(`📊 Total users: ${totalUsers}`);
    
    if (totalUsers === 0) {
      console.log('🎉 No users to migrate!');
      await mongoose.disconnect();
      process.exit(0);
    }
    
    // Find users that need migration
    const users = await User.find({
      $or: [
        { accountStatus: { $exists: false } },
        { presenceStatus: { $exists: false } },
        { isOnline: { $exists: false } }
      ]
    }).limit(50); // Start with small batch
    
    console.log(`📊 Found ${users.length} users to process (missing new fields)`);
    
    if (users.length === 0) {
      console.log('✅ All users are already migrated!');
      
      // Show sample of migrated users
      const sampleUsers = await User.find({})
        .select('email username status accountStatus presenceStatus isOnline')
        .limit(5);
      
      console.log('\n🔍 Sample migrated users:');
      sampleUsers.forEach(user => {
        console.log(`   ${user.email || user.username || user._id}:`);
        console.log(`     - status: ${user.status}`);
        console.log(`     - accountStatus: ${user.accountStatus}`);
        console.log(`     - presenceStatus: ${user.presenceStatus}`);
        console.log(`     - isOnline: ${user.isOnline}`);
      });
      
      await mongoose.disconnect();
      process.exit(0);
    }
    
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    // Process users
    for (const user of users) {
      try {
        console.log(`\n👤 Processing: ${user.email || user.username || user._id}`);
        console.log(`   Current status: "${user.status || 'not set'}"`);
        console.log(`   Current online: ${user.online || false}`);
        
        // Skip if already has all new fields
        if (user.accountStatus && user.presenceStatus && user.isOnline !== undefined) {
          console.log('   ⏭️  Already has new fields');
          skipped++;
          continue;
        }
        
        // Determine accountStatus from old status
        let accountStatus = 'active';
        if (["inactive", "suspended", "banned"].includes(user.status)) {
          accountStatus = user.status;
        } else if (["deactivated", "deleted", "disabled"].includes(user.status)) {
          accountStatus = "inactive";
        }
        
        // Determine presenceStatus from old status or online field
        let presenceStatus = 'offline';
        if (["online", "away", "busy", "offline"].includes(user.status)) {
          presenceStatus = user.status;
        } else if (user.online === true) {
          presenceStatus = 'online';
        }
        
        // Determine isOnline
        const isOnline = presenceStatus !== 'offline';
        
        console.log(`   New values:`);
        console.log(`     - accountStatus: ${accountStatus}`);
        console.log(`     - presenceStatus: ${presenceStatus}`);
        console.log(`     - isOnline: ${isOnline}`);
        
        // Prepare update
        const updateData = {};
        
        if (!user.accountStatus) {
          updateData.accountStatus = accountStatus;
        }
        if (!user.presenceStatus) {
          updateData.presenceStatus = presenceStatus;
        }
        if (user.isOnline === undefined) {
          updateData.isOnline = isOnline;
        }
        
        // If status is ambiguous (not clearly presence or account), update it
        if (user.status && !["online", "away", "busy", "offline"].includes(user.status) && 
            !["active", "inactive", "suspended", "banned"].includes(user.status)) {
          updateData.status = presenceStatus; // Default to presence status
        }
        
        // Update user
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              ...updateData,
              migration: {
                migrated: true,
                migratedAt: new Date(),
                note: 'User status migration'
              }
            }
          }
        );
        
        console.log(`   ✅ Updated`);
        updated++;
        
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        errors++;
      }
    }
    
    // Show summary
    console.log('\n' + '='.repeat(50));
    console.log('📋 MIGRATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Updated: ${updated}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    
    // Final stats
    const migratedCount = await User.countDocuments({
      $and: [
        { accountStatus: { $exists: true } },
        { presenceStatus: { $exists: true } },
        { isOnline: { $exists: true } }
      ]
    });
    
    console.log(`\n📈 Total migrated users: ${migratedCount}/${totalUsers} (${Math.round((migratedCount/totalUsers)*100)}%)`);
    
    // Show sample of migrated users
    const sampleUsers = await User.find({})
      .select('email username status accountStatus presenceStatus isOnline')
      .limit(5);
    
    console.log('\n🔍 Sample migrated users:');
    sampleUsers.forEach(user => {
      console.log(`   ${user.email || user.username || user._id}:`);
      console.log(`     - status: ${user.status}`);
      console.log(`     - accountStatus: ${user.accountStatus}`);
      console.log(`     - presenceStatus: ${user.presenceStatus}`);
      console.log(`     - isOnline: ${user.isOnline}`);
    });
    
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from database');
    console.log('\n✨ Migration complete!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    if (error.code === 'ENOTFOUND') {
      console.error('   Network error. Check your internet connection.');
    } else if (error.code === 'ETIMEDOUT') {
      console.error('   Connection timeout. Check your MongoDB URI.');
    } else if (error.name === 'MongooseServerSelectionError') {
      console.error('   Cannot connect to MongoDB. Make sure:');
      console.error('   1. MongoDB is running');
      console.error('   2. Your MONGODB_URI in .env is correct');
      console.error('   3. Your IP is whitelisted in MongoDB Atlas (if using cloud)');
    }
    process.exit(1);
  }
}

// Check for command line arguments
const args = process.argv.slice(2);
if (args.includes('--dry-run')) {
  console.log('🚧 DRY RUN MODE - Showing what would be migrated');
  console.log('   (No changes will be made to the database)');
  // For dry run, just count what would be updated
  require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
  
  async function dryRun() {
    await mongoose.connect(process.env.MONGODB_URI);
    const totalUsers = await User.countDocuments();
    const usersToMigrate = await User.find({
      $or: [
        { accountStatus: { $exists: false } },
        { presenceStatus: { $exists: false } },
        { isOnline: { $exists: false } }
      ]
    }).limit(10).select('email username status online');
    
    console.log(`\n📊 Would process ${usersToMigrate.length} users (first 10 shown):`);
    usersToMigrate.forEach(user => {
      console.log(`\n👤 ${user.email || user.username || user._id}:`);
      console.log(`   Current status: "${user.status}"`);
      console.log(`   Current online: ${user.online}`);
      console.log(`   Missing fields:`);
      if (!user.accountStatus) console.log(`     - accountStatus`);
      if (!user.presenceStatus) console.log(`     - presenceStatus`);
      if (user.isOnline === undefined) console.log(`     - isOnline`);
    });
    
    await mongoose.disconnect();
    process.exit(0);
  }
  
  dryRun().catch(console.error);
}

if (args.includes('--help')) {
  console.log(`
Usage: node migrateUserStatus.js [options]

Options:
  --dry-run    Show what would be migrated (no changes)
  --help       Show this help message
  --status     Show current migration status
  
Example:
  node migrateUserStatus.js          # Run migration
  node migrateUserStatus.js --dry-run # Dry run
  `);
  process.exit(0);
}

if (args.includes('--status')) {
  async function showStatus() {
    await mongoose.connect(process.env.MONGODB_URI);
    const totalUsers = await User.countDocuments();
    const migratedUsers = await User.countDocuments({
      $and: [
        { accountStatus: { $exists: true } },
        { presenceStatus: { $exists: true } },
        { isOnline: { $exists: true } }
      ]
    });
    
    console.log(`\n📊 Migration Status:`);
    console.log(`   Total users: ${totalUsers}`);
    console.log(`   Migrated users: ${migratedUsers}`);
    console.log(`   Remaining: ${totalUsers - migratedUsers}`);
    console.log(`   Progress: ${Math.round((migratedUsers/totalUsers)*100)}%`);
    
    await mongoose.disconnect();
    process.exit(0);
  }
  
  showStatus().catch(console.error);
}

// Run the migration
runMigration();