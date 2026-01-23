const mongoose = require('mongoose');
require('dotenv').config();

// Import your models
const { BaseUser, ROLES } = require('../models/User');
const InviteCode = require('../models/InviteCode.model');

async function runMigration() {
  try {
    console.log('🚀 Starting database migration...\n');

    // Connect to database
    await mongoose.connect(process.env.MONGO_URI || process.env.DATABASE_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to database\n');

    // ========== MIGRATION 1: Clean InviteCode Collection ==========
    console.log('📋 Migrating InviteCode collection...');
    
    const inviteCodesWithLegacyFields = await InviteCode.find({
      $or: [
        { isAdminUser: { $exists: true } },
        { isSuperAdminUser: { $exists: true } }
      ]
    });

    console.log(`   Found ${inviteCodesWithLegacyFields.length} invite codes with legacy fields`);

    if (inviteCodesWithLegacyFields.length > 0) {
      const inviteResult = await InviteCode.updateMany(
        {
          $or: [
            { isAdminUser: { $exists: true } },
            { isSuperAdminUser: { $exists: true } }
          ]
        },
        {
          $unset: {
            isAdminUser: "",
            isSuperAdminUser: ""
          }
        }
      );

      console.log(`   ✅ Removed legacy fields from ${inviteResult.modifiedCount} invite codes\n`);
    } else {
      console.log(`   ✅ No legacy fields found in InviteCode collection\n`);
    }

    // ========== MIGRATION 2: Clean BaseUser Collection ==========
    console.log('📋 Migrating BaseUser collection (all user types)...');
    
    const usersWithLegacyFields = await BaseUser.find({
      $or: [
        { isAdminUser: { $exists: true } },
        { isSuperAdminUser: { $exists: true } }
      ]
    });

    console.log(`   Found ${usersWithLegacyFields.length} users with legacy fields`);

    if (usersWithLegacyFields.length > 0) {
      const userResult = await BaseUser.updateMany(
        {
          $or: [
            { isAdminUser: { $exists: true } },
            { isSuperAdminUser: { $exists: true } }
          ]
        },
        {
          $unset: {
            isAdminUser: "",
            isSuperAdminUser: ""
          }
        }
      );

      console.log(`   ✅ Removed legacy fields from ${userResult.modifiedCount} users\n`);
    } else {
      console.log(`   ✅ No legacy fields found in BaseUser collection\n`);
    }

    // ========== VERIFICATION: Check for any remaining legacy fields ==========
    console.log('🔍 Verifying migration...');
    
    const remainingInviteLegacy = await InviteCode.countDocuments({
      $or: [
        { isAdminUser: { $exists: true } },
        { isSuperAdminUser: { $exists: true } }
      ]
    });

    const remainingUserLegacy = await BaseUser.countDocuments({
      $or: [
        { isAdminUser: { $exists: true } },
        { isSuperAdminUser: { $exists: true } }
      ]
    });

    if (remainingInviteLegacy === 0 && remainingUserLegacy === 0) {
      console.log('   ✅ Verification passed - no legacy fields remain\n');
    } else {
      console.log(`   ⚠️  Warning: Found ${remainingInviteLegacy} invite codes and ${remainingUserLegacy} users with legacy fields\n`);
    }

    // ========== SUMMARY ==========
    console.log('📊 Migration Summary:');
    console.log('='.repeat(50));
    console.log(`   InviteCodes cleaned: ${inviteCodesWithLegacyFields.length}`);
    console.log(`   Users cleaned: ${usersWithLegacyFields.length}`);
    console.log(`   Remaining legacy fields: ${remainingInviteLegacy + remainingUserLegacy}`);
    console.log('='.repeat(50));
    console.log('\n✅ Migration completed successfully!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('\n🎉 All done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration error:', error);
      process.exit(1);
    });
}

module.exports = runMigration;