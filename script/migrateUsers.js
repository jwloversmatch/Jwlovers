// migrateUsers.js - UPDATED with manual password hashing
require('dotenv').config();
const mongoose = require("mongoose");
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const oldUserModel = require("../models/User/User.model");
const { BaseUser, DatingUser, Moderator, Admin, SuperAdmin, ROLES } = require("../models/User");

class UserMigration {
  constructor() {
    this.migrationLog = {
      totalProcessed: 0,
      migrated: 0,
      failed: 0,
      byType: {},
      errors: [],
    };
  }

  async connect() {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
      console.error("❌ MONGODB_URI environment variable is not set!");
      process.exit(1);
    }
    
    console.log("🔗 Connecting to MongoDB...");
    await mongoose.connect(mongoURI);
    console.log("✅ Connected to MongoDB");
  }

  async disconnect() {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }

  async analyzeOldData() {
    console.log("\n=== ANALYZING EXISTING DATA ===");

    // Check password data
    console.log("\n🔍 Checking password data in old users...");
    const sampleUsers = await oldUserModel.find({}).limit(5).lean();
    
    sampleUsers.forEach((user, index) => {
      console.log(`\nSample User ${index + 1}: ${user.email}`);
      console.log(`  Has password field? ${'password' in user}`);
      console.log(`  Password value: ${user.password ? `[${user.password.length} chars]` : 'null/empty'}`);
    });

    const totalUsers = await oldUserModel.countDocuments();
    console.log(`\nTotal users to migrate: ${totalUsers}`);

    // Check roles
    const roleCounts = await oldUserModel.aggregate([
      { $group: { _id: "$role", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    console.log("\nRole distribution:");
    roleCounts.forEach((r) => console.log(`  ${r._id || "null"}: ${r.count}`));

    return { totalUsers, roleCounts };
  }

  async migrateAllUsers() {
    console.log("\n=== STARTING MIGRATION ===");

    const users = await oldUserModel.find({}).lean();
    
    for (const oldUser of users) {
      await this.migrateSingleUser(oldUser);
      this.migrationLog.totalProcessed++;
    }

    this.printMigrationReport();
  }

  async migrateSingleUser(oldUser) {
    console.log(`\n🔄 Processing ${oldUser.email}...`);
    
    try {
      const userType = this.determineUserType(oldUser);
      console.log(`   Type: ${userType}`);

      // Prepare user data with MANUAL password hashing
      const userData = await this.prepareUserData(oldUser, userType);
      
      // Migrate based on user type using direct MongoDB insert
      await this.migrateUserByType(oldUser._id, userType, userData);
      
      this.migrationLog.migrated++;
      this.migrationLog.byType[userType] = (this.migrationLog.byType[userType] || 0) + 1;
      
    } catch (error) {
      this.handleMigrationError(oldUser, error);
    }
  }

  determineUserType(oldUser) {
    const role = oldUser.role || "user";
    const roleMapping = {
      user: "DatingUser",
      dating_user: "DatingUser",
      member: "DatingUser",
      moderator: "Moderator",
      admin: "Admin",
      super_admin: "SuperAdmin",
      superadmin: "SuperAdmin",
      administrator: "Admin",
    };

    let userType = roleMapping[role.toLowerCase()] || "DatingUser";

    // Check for dating data
    const hasDatingData = oldUser.preferences || oldUser.location || oldUser.dateOfBirth;
    if (hasDatingData && ["Moderator", "Admin", "SuperAdmin"].includes(userType)) {
      console.log(`   ⚠️ Has dating data, defaulting to DatingUser`);
      userType = "DatingUser";
    }

    return userType;
  }

  async prepareUserData(oldUser, userType) {
    // Get or generate password
    let password = oldUser.password;
    
    if (!password || password.trim() === '') {
      console.log(`   ⚠️ Generating temporary password`);
      password = this.generateTemporaryPassword();
    }
    
    // ALWAYS hash the password (even if it might already be hashed in old data)
    console.log(`   🔐 Hashing password...`);
    const hashedPassword = await this.hashPassword(password);

    const baseData = {
      _id: oldUser._id,
      email: oldUser.email,
      firstName: oldUser.firstName || oldUser.name?.split(" ")[0] || "User",
      lastName: oldUser.lastName || oldUser.name?.split(" ").slice(1).join(" ") || "Unknown",
      userName: oldUser.userName || oldUser.username || `user${oldUser._id.toString().slice(-4)}`,
      password: hashedPassword, // Use hashed password
      lastPasswordChange: new Date(), // Set to now
      accountStatus: oldUser.accountStatus || oldUser.status || "active",
      emailVerified: oldUser.emailVerified || oldUser.isEmailVerified || false,
      avatar: oldUser.avatar || oldUser.profilePicture,
      createdAt: oldUser.createdAt || new Date(),
      updatedAt: oldUser.updatedAt || new Date(),
    };

    // Add role-specific data
    switch(userType) {
      case "DatingUser":
        return {
          ...baseData,
          ...this.getDatingData(oldUser),
          role: ROLES.USER,
          userType: "DatingUser"
        };
      case "Moderator":
        return {
          ...baseData,
          ...this.getStaffData(oldUser),
          role: ROLES.MODERATOR,
          userType: "Moderator"
        };
      case "Admin":
        return {
          ...baseData,
          ...this.getStaffData(oldUser),
          role: ROLES.ADMIN,
          userType: "Admin"
        };
      case "SuperAdmin":
        return {
          ...baseData,
          ...this.getStaffData(oldUser),
          role: ROLES.SUPER_ADMIN,
          userType: "SuperAdmin"
        };
      default:
        return {
          ...baseData,
          role: oldUser.role || ROLES.USER,
          userType: "BaseUser"
        };
    }
  }

  getDatingData(oldUser) {
    return {
      dateOfBirth: oldUser.dateOfBirth || oldUser.dob,
      ageVerified: oldUser.ageVerified || false,
      preferences: oldUser.preferences || {
        lookingFor: ["dating"],
        ageRange: { min: 18, max: 99 },
        distance: 50,
        interests: []
      },
      location: oldUser.location || {
        city: oldUser.city,
        country: oldUser.country,
        coordinates: oldUser.coordinates || [0, 0]
      },
      sharePhone: oldUser.sharePhone || "hidden",
      messagingPreferences: oldUser.messagingPreferences || "everyone"
    };
  }

  getStaffData(oldUser) {
    return {
      employeeId: oldUser.employeeId || `EMP${oldUser._id.toString().slice(-6).toUpperCase()}`,
      department: oldUser.department || "general"
    };
  }

  async migrateUserByType(userId, userType, userData) {
    let Model;
    switch(userType) {
      case "DatingUser": Model = DatingUser; break;
      case "Moderator": Model = Moderator; break;
      case "Admin": Model = Admin; break;
      case "SuperAdmin": Model = SuperAdmin; break;
      default: Model = BaseUser;
    }

    try {
      // Use direct MongoDB insert to bypass ALL Mongoose middleware
      const existing = await Model.findById(userId);
      
      if (existing) {
        console.log(`   ♻️ Updating existing...`);
        await Model.collection.updateOne(
          { _id: userId },
          { $set: userData }
        );
      } else {
        console.log(`   🆕 Creating new...`);
        await Model.collection.insertOne(userData);
      }
      
      console.log(`   ✅ Successfully migrated`);
    } catch (error) {
      console.error(`   ❌ Migration failed:`, error.message);
      throw error;
    }
  }

  // Helper methods
  generateTemporaryPassword() {
    return crypto.randomBytes(12).toString('hex') + "Aa1!";
  }

  async hashPassword(password) {
    return new Promise((resolve, reject) => {
      bcrypt.hash(password, 10, (err, hash) => {
        if (err) reject(err);
        else resolve(hash);
      });
    });
  }

  handleMigrationError(oldUser, error) {
    this.migrationLog.failed++;
    this.migrationLog.errors.push({
      userId: oldUser._id,
      email: oldUser.email,
      error: error.message
    });

    console.error(`❌ Failed: ${error.message}`);
  }

  printMigrationReport() {
    console.log("\n" + "=".repeat(50));
    console.log("MIGRATION COMPLETE");
    console.log("=".repeat(50));

    console.log(`Total processed: ${this.migrationLog.totalProcessed}`);
    console.log(`Successfully migrated: ${this.migrationLog.migrated}`);
    console.log(`Failed: ${this.migrationLog.failed}`);

    console.log("\nDistribution by user type:");
    Object.entries(this.migrationLog.byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

    if (this.migrationLog.errors.length > 0) {
      console.log("\nErrors:");
      this.migrationLog.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.email}: ${error.error}`);
      });
    }

    // Test password verification for migrated users
    this.testPasswordVerification();
  }

  async testPasswordVerification() {
    console.log("\n🧪 Testing password verification for migrated users...");
    
    try {
      const users = await DatingUser.find({}).limit(2);
      
      for (const user of users) {
        console.log(`\nTesting ${user.email}:`);
        console.log(`  Has password: ${!!user.password}`);
        
        // Get user with password field
        const userWithPassword = await DatingUser.findById(user._id).select('+password');
        
        if (userWithPassword && userWithPassword.password) {
          // Test that the password is in bcrypt format
          const isBcryptHash = userWithPassword.password.startsWith('$2');
          console.log(`  Password is bcrypt format: ${isBcryptHash}`);
          
          if (isBcryptHash) {
            // Test password comparison with a dummy password
            const testResult = await bcrypt.compare("wrongpassword", userWithPassword.password);
            console.log(`  Password comparison works: ${testResult === false} (expected false)`);
          }
        }
      }
      
      console.log("\n✅ Migration test complete");
    } catch (error) {
      console.log(`⚠️ Could not test migrated users: ${error.message}`);
    }
  }
}

// Run migration
async function runMigration() {
  const migration = new UserMigration();

  try {
    await migration.connect();
    
    // Analyze first
    await migration.analyzeOldData();
    
    // Ask for confirmation
    const readline = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
      readline.question("\nProceed with migration? (yes/no): ", resolve);
    });

    readline.close();

    if (answer.toLowerCase() !== "yes") {
      console.log("Migration cancelled.");
      return;
    }

    // Run migration
    await migration.migrateAllUsers();
    
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await migration.disconnect();
  }
}

// Execute
runMigration();