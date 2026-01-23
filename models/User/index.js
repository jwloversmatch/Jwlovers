// models/User/index.js
const mongoose = require("mongoose");
const { baseUserSchema, ROLES, ROLE_HIERARCHY, ROLE_PERMISSIONS } = require("./baseUserSchema");
const datingUserSchema = require("./datingUserSchema");
const staffUserSchema = require("./staffUserSchema");

// Create base model
const BaseUser = mongoose.model('BaseUser', baseUserSchema);

// ========== CREATE DISCRIMINATORS ==========
// 1. Dating User (Regular user with dating features)
const DatingUser = BaseUser.discriminator('DatingUser', datingUserSchema);

// 2. Moderator (Staff with moderation powers)
const Moderator = BaseUser.discriminator('Moderator', staffUserSchema);

// 3. Admin (Full staff access)
const Admin = BaseUser.discriminator('Admin', staffUserSchema);

// 4. Super Admin (Highest level)
const SuperAdmin = BaseUser.discriminator('SuperAdmin', staffUserSchema);

// ========== FACTORY FUNCTION TO CREATE USERS ==========
class UserFactory {
  static async createUser(data) {
    const { role, ...userData } = data;
    
    switch(role) {
      case ROLES.USER:
        return this.createDatingUser(userData);
      case ROLES.MODERATOR:
        return this.createModerator(userData);
      case ROLES.ADMIN:
        return this.createAdmin(userData);
      case ROLES.SUPER_ADMIN:
        return this.createSuperAdmin(userData);
      default:
        throw new Error(`Invalid role: ${role}`);
    }
  }
  
  static async createDatingUser(data) {
    // Validate dating-specific data
    if (!data.dateOfBirth) {
      throw new Error('Date of birth is required for dating users');
    }
    
    const user = new DatingUser({
      ...data,
      role: ROLES.USER,
      userType: 'DatingUser'
    });
    
    await user.save();
    return user;
  }
  
  static async createModerator(data) {
    if (!data.employeeId || !data.department) {
      throw new Error('Employee ID and department are required for staff');
    }
    
    const user = new Moderator({
      ...data,
      role: ROLES.MODERATOR,
      userType: 'Moderator'
    });
    
    await user.save();
    return user;
  }
  
  static async createAdmin(data) {
    if (!data.employeeId || !data.department) {
      throw new Error('Employee ID and department are required for staff');
    }
    
    const user = new Admin({
      ...data,
      role: ROLES.ADMIN,
      userType: 'Admin'
    });
    
    await user.save();
    return user;
  }
  
  static async createSuperAdmin(data) {
    // Super admin creation should be restricted
    const user = new SuperAdmin({
      ...data,
      role: ROLES.SUPER_ADMIN,
      userType: 'SuperAdmin'
    });
    
    await user.save();
    return user;
  }
}

// ========== QUERY HELPERS ==========
class UserQuery {
  static async findDatingUsers(options = {}) {
    const query = {
      userType: 'DatingUser',
      accountStatus: 'active'
    };
    
    // Add filters
    if (options.ageRange) {
      // Will need custom logic for age range with dateOfBirth
    }
    
    if (options.location) {
      query['location.coordinates'] = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: options.location.coordinates
          },
          $maxDistance: options.maxDistance || 50000
        }
      };
    }
    
    return DatingUser.find(query)
      .select('firstName lastName userName avatar age location.city preferences.lookingFor')
      .limit(options.limit || 50)
      .skip(options.skip || 0);
  }
  
  static async findStaff(options = {}) {
    const query = {
      userType: { $in: ['Moderator', 'Admin', 'SuperAdmin'] }
    };
    
    if (options.role) {
      query.role = options.role;
    }
    
    if (options.department) {
      query.department = options.department;
    }
    
    return BaseUser.find(query)
      .select('firstName lastName email role department employeeId accountStatus')
      .sort({ createdAt: -1 })
      .limit(options.limit || 100)
      .skip(options.skip || 0);
  }
  
  static async getUserById(userId) {
    return BaseUser.findById(userId);
  }
  
  static async getUserByEmail(email) {
    return BaseUser.findOne({ email });
  }
  
  static async getUserByRole(role) {
    return BaseUser.find({ role });
  }
}

// ========== SERVICE LAYER ==========
class UserService {
  static async registerUser(registrationData) {
    const { role = ROLES.USER, ...data } = registrationData;
    
    // Check if email already exists
    const existingUser = await UserQuery.getUserByEmail(data.email);
    if (existingUser) {
      throw new Error('Email already registered');
    }
    
    // Create user based on role
    const user = await UserFactory.createUser({
      ...data,
      role
    });
    
    // Send verification email
    await this.sendVerificationEmail(user);
    
    return {
      success: true,
      user: user.toJSON(),
      message: 'User registered successfully'
    };
  }
  
  static async promoteToModerator(userId, promotedBy, employeeData) {
    const user = await UserQuery.getUserById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    if (user.role !== ROLES.USER) {
      throw new Error('Only regular users can be promoted to moderator');
    }
    
    // Delete old dating user document
    await DatingUser.findByIdAndDelete(userId);
    
    // Create new moderator with same base data
    const moderator = new Moderator({
      _id: userId,
      ...user.toObject(),
      role: ROLES.MODERATOR,
      userType: 'Moderator',
      ...employeeData,
      promotedBy: promotedBy._id,
      promotedAt: new Date()
    });
    
    await moderator.save();
    return moderator;
  }
  
  static async getProfile(userId, requestingUser) {
    const user = await UserQuery.getUserById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Authorization check
    if (!user._id.equals(requestingUser._id) && !requestingUser.isAdminUser) {
      throw new Error('Unauthorized');
    }
    
    // Return role-specific profile
    switch(user.userType) {
      case 'DatingUser':
        return user.getDatingProfile();
      case 'Moderator':
      case 'Admin':
      case 'SuperAdmin':
        return user.getStaffProfile();
      default:
        return user.toJSON();
    }
  }
  
  static async updateProfile(userId, updateData, requestingUser) {
    const user = await UserQuery.getUserById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Check permissions
    if (!user._id.equals(requestingUser._id)) {
      throw new Error('Can only update your own profile');
    }
    
    // Remove role-changing attempts
    delete updateData.role;
    delete updateData.userType;
    
    // Update user
    Object.keys(updateData).forEach(key => {
      user[key] = updateData[key];
    });
    
    await user.save();
    return user;
  }
  
  static async sendVerificationEmail(user) {
    // Implementation for sending verification email
    console.log(`Verification email sent to ${user.email}`);
    return true;
  }
}

// Export everything
module.exports = {
  // Models
  BaseUser,
  DatingUser,
  Moderator,
  Admin,
  SuperAdmin,
  
  // Constants
  ROLES,
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  
  // Services
  UserFactory,
  UserQuery,
  UserService
};