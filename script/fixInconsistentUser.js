// fixInconsistentUser.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function fixInconsistentUser() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database');
    
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    
    // Find user with email
    const user = await usersCollection.findOne({ 
      email: 'jeze5959@gmail.com' 
    });
    
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    console.log('\n🔍 Current user state:');
    console.log('Email:', user.email);
    console.log('presenceStatus:', user.presenceStatus);
    console.log('isOnline:', user.isOnline);
    console.log('online (legacy):', user.online);
    console.log('accountStatus:', user.accountStatus);
    
    // The problem: online=false but presenceStatus="online" and isOnline=true
    // This inconsistency can cause login issues
    
    console.log('\n🔧 Fixing inconsistency...');
    
    // Option 1: Update legacy online field to match isOnline
    const result = await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          online: true, // Sync with isOnline and presenceStatus
          'migration.fixedInconsistency': {
            fixedAt: new Date(),
            note: 'Fixed online field inconsistency',
            before: {
              presenceStatus: user.presenceStatus,
              isOnline: user.isOnline,
              online: user.online
            },
            after: {
              presenceStatus: user.presenceStatus,
              isOnline: user.isOnline,
              online: true
            }
          }
        }
      }
    );
    
    if (result.modifiedCount > 0) {
      console.log('✅ User fixed successfully');
      
      // Verify
      const updatedUser = await usersCollection.findOne({ _id: user._id });
      console.log('\n🔍 Updated user:');
      console.log('presenceStatus:', updatedUser.presenceStatus);
      console.log('isOnline:', updatedUser.isOnline);
      console.log('online:', updatedUser.online);
      console.log('✅ All fields are now consistent!');
    }
    
    // Also check for other users with the same issue
    console.log('\n🔍 Checking for other users with inconsistencies...');
    
    const inconsistentUsers = await usersCollection.find({
      $or: [
        // Case 1: presenceStatus is online/away/busy but online=false
        {
          $and: [
            { presenceStatus: { $in: ['online', 'away', 'busy'] } },
            { online: false }
          ]
        },
        // Case 2: presenceStatus is offline but online=true
        {
          $and: [
            { presenceStatus: 'offline' },
            { online: true }
          ]
        },
        // Case 3: isOnline doesn't match presenceStatus
        {
          $expr: {
            $ne: [
              '$isOnline',
              { $ne: ['$presenceStatus', 'offline'] }
            ]
          }
        }
      ]
    }).toArray();
    
    console.log(`Found ${inconsistentUsers.length} users with field inconsistencies`);
    
    if (inconsistentUsers.length > 0) {
      console.log('\n🔧 Fixing all inconsistent users...');
      
      for (const inconsistentUser of inconsistentUsers) {
        const userId = inconsistentUser._id;
        const targetOnline = inconsistentUser.presenceStatus !== 'offline';
        
        if (inconsistentUser.online !== targetOnline) {
          await usersCollection.updateOne(
            { _id: userId },
            {
              $set: {
                online: targetOnline,
                'migration.consistencyFix': new Date()
              }
            }
          );
          console.log(`✅ Fixed ${inconsistentUser.email || userId}: online=${targetOnline}`);
        }
      }
    }
    
    await mongoose.disconnect();
    console.log('\n✨ Fix complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

fixInconsistentUser();