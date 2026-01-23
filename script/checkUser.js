// checkProblemUser.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

async function checkUser() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database');
    
    // Find the problematic user
    const problemUser = await User.findOne({ 
      email: 'joelme@gmail.com' 
    });
    
    if (!problemUser) {
      console.log('❌ User not found');
      return;
    }
    
    console.log('\n🔍 Problem User Details:');
    console.log('='.repeat(50));
    console.log(`ID: ${problemUser._id}`);
    console.log(`Email: ${problemUser.email}`);
    console.log(`First Name: ${problemUser.firstName}`);
    console.log(`Last Name: ${problemUser.lastName}`);
    console.log(`Role: ${problemUser.role}`);
    console.log(`Email Verified: ${problemUser.emailVerified}`);
    console.log(`Phone Verified: ${problemUser.phoneVerified}`);
    console.log(`Account Status: ${problemUser.accountStatus}`);
    console.log(`Presence Status: ${problemUser.presenceStatus}`);
    console.log(`isOnline: ${problemUser.isOnline}`);
    console.log(`Old online field: ${problemUser.online}`);
    console.log(`Old status field: "${problemUser.status}"`);
    console.log(`Created: ${problemUser.createdAt}`);
    console.log(`Last Login: ${problemUser.lastLogin}`);
    console.log(`Last Seen: ${problemUser.lastSeen}`);
    
    // Check for any migration-related issues
    console.log('\n🔧 Migration Status:');
    console.log('Has accountStatus:', !!problemUser.accountStatus);
    console.log('Has presenceStatus:', !!problemUser.presenceStatus);
    console.log('Has isOnline:', problemUser.isOnline !== undefined);
    
    // Check JWT token consistency
    console.log('\n🔐 Authentication Check:');
    console.log('Refresh Token exists:', !!problemUser.refreshToken);
    if (problemUser.refreshToken) {
      console.log('Refresh Token length:', problemUser.refreshToken.length);
    }
    
    // Check for any validation issues
    try {
      await problemUser.validate();
      console.log('✅ User validation passed');
    } catch (validationError) {
      console.log('❌ User validation failed:', validationError.message);
      console.log('Validation errors:', validationError.errors);
    }
    
    // Check if account is active
    if (problemUser.accountStatus !== 'active') {
      console.log(`\n⚠️  WARNING: User account status is "${problemUser.accountStatus}"`);
      console.log('   This could prevent login!');
    }
    
    // Check if email is verified (if required)
    if (!problemUser.emailVerified) {
      console.log('\n⚠️  Email not verified');
      console.log('   Check if your app requires email verification');
    }
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkUser();