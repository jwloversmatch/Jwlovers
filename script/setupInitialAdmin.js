// script/setupInitialAdmin-fixed.js
require('module-alias/register');
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('@models/User/User.model');
const InviteCode = require('@models/InviteCode.model');
const bcrypt = require('bcryptjs');
const { ROLES } = require('@middleware/authmiddleware');

async function setupInitialAdmin() {
  try {
    // Connect to database
    console.log('🔗 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database');
    
    // Check if ANY super admin already exists
    console.log('👤 Checking for existing super admins...');
    
    // Look for existing super admin (any email)
    let superAdmin = await User.findOne({ role: ROLES.SUPER_ADMIN });
    
    if (!superAdmin) {
      // Check if jwloverssuperadmin@gmail.com exists (from previous run)
      superAdmin = await User.findOne({ email: 'jwloverssuperadmin@gmail.com' });
      
      if (!superAdmin) {
        // Create new Super Admin with original email
        console.log('🛠️ Creating new super admin...');
        superAdmin = await User.create({
          email: 'superadmin@jwlovers.com',
          password: await bcrypt.hash('JwLovers@SuperAdmin2024!', 12),
          firstName: 'System',
          lastName: 'Administrator',
          userName: 'sysadmin',
          dateOfBirth: new Date('1980-01-01'),
          role: ROLES.SUPER_ADMIN,
          emailVerified: true,
          accountStatus: 'active',
          ageVerified: true,
          presence: {
            status: 'offline',
            lastSeen: new Date(),
            lastActive: new Date()
          }
        });
        console.log('✅ New Super Admin created:', superAdmin.email);
      } else {
        console.log('⚠️  Found existing admin (different role/email):', superAdmin.email);
        // Update to super admin if not already
        if (superAdmin.role !== ROLES.SUPER_ADMIN) {
          superAdmin.role = ROLES.SUPER_ADMIN;
          await superAdmin.save();
          console.log('✅ Updated to Super Admin role');
        }
      }
    } else {
      console.log('✅ Super Admin already exists:', superAdmin.email);
    }
    
    // Check if invite codes already exist
    console.log('\n🔑 Checking for existing invite codes...');
    const existingCodes = await InviteCode.find({ createdBy: superAdmin._id });
    
    if (existingCodes.length > 0) {
      console.log('⚠️  Invite codes already exist:');
      existingCodes.forEach(code => {
        console.log(`  ${code.role}: ${code.code} (${code.uses}/${code.maxUses} uses)`);
      });
      
      const createNew = false; // Set to true if you want new codes
      
      if (createNew) {
        console.log('Creating additional invite codes...');
      } else {
        console.log('\n🎉 Setup already completed previously!');
        console.log('\n=== EXISTING CREDENTIALS ===');
        console.log('Super Admin Login:');
        console.log('  Email:', superAdmin.email);
        console.log('  Password: JwLovers@SuperAdmin2024! (if newly created)');
        console.log('\nExisting Invite Codes:');
        existingCodes.forEach(code => {
          console.log(`  ${code.role}: ${code.code}`);
        });
        console.log('============================\n');
        process.exit(0);
      }
    }
    
    // Generate new invite codes
    console.log('\n🔑 Generating new invite codes...');
    
    try {
      // Generate moderator invite code
      const modCode = await InviteCode.create({
        code: 'MOD-' + Date.now().toString().slice(-8),
        role: ROLES.MODERATOR,
        createdBy: superAdmin._id,
        maxUses: 10,
        description: 'Initial moderator invite code'
      });
      console.log(`✅ Moderator Invite Code: ${modCode.code}`);
    } catch (err) {
      console.log('⚠️  Moderator code already exists or error:', err.message);
    }
    
    try {
      // Generate admin invite code (single use)
      const adminCode = await InviteCode.create({
        code: 'ADM-' + Date.now().toString().slice(-8),
        role: ROLES.ADMIN,
        createdBy: superAdmin._id,
        maxUses: 1,
        description: 'Initial admin invite code - SINGLE USE'
      });
      console.log(`✅ Admin Invite Code: ${adminCode.code}`);
    } catch (err) {
      console.log('⚠️  Admin code already exists or error:', err.message);
    }
    
    try {
      // Generate super admin invite code
      const superCode = await InviteCode.create({
        code: 'SUP-' + Date.now().toString().slice(-8),
        role: ROLES.SUPER_ADMIN,
        createdBy: superAdmin._id,
        maxUses: 1,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        description: 'Emergency super admin invite code - SINGLE USE'
      });
      console.log(`✅ Super Admin Invite Code: ${superCode.code}`);
    } catch (err) {
      console.log('⚠️  Super admin code already exists or error:', err.message);
    }
    
    console.log('\n🎉 Setup completed successfully!');
    console.log('\n=== CREDENTIALS ===');
    console.log('Super Admin Login:');
    console.log('  Email:', superAdmin.email);
    console.log('  Password: JwLovers@SuperAdmin2024!');
    console.log('====================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

setupInitialAdmin();