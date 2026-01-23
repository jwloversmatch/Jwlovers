// create-super-admin.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { SuperAdmin } = require('../models/User');

async function createSuperAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const email = 'superadmin@yourdomain.com';
    const password = 'SuperAdmin123!'; // Change this!
    
    // Check if super admin already exists
    const existing = await SuperAdmin.findOne({ email });
    if (existing) {
      console.log('⚠️ Super admin already exists:', email);
      return;
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create super admin
    const superAdmin = new SuperAdmin({
      email: email,
      password: hashedPassword,
      firstName: 'Super',
      lastName: 'Admin',
      userName: 'superadmin',
      employeeId: 'SUPER001',           // Choose any unique ID
      department: 'management',         // Must be from allowed list
      role: 'super_admin',
      userType: 'SuperAdmin',
      emailVerified: true,
      accountStatus: 'active',
      permissions: [],                  // Can be empty or add permissions
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await superAdmin.save();
    
    console.log('\n✅ SUPER ADMIN CREATED SUCCESSFULLY!');
    console.log('=====================================');
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('Employee ID: SUPER001');
    console.log('Role: super_admin');
    console.log('\n⚠️ IMPORTANT: Change password immediately after first login!');
    
  } catch (error) {
    console.error('❌ Error creating super admin:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

createSuperAdmin();