const mongoose = require("mongoose");
const { baseUserSchema, ROLES, ROLE_HIERARCHY, ROLE_PERMISSIONS } = require("./baseUserSchema");

// ========== CREATE BASE MODEL FIRST ==========
// This MUST happen before any discriminator creation
const BaseUser = mongoose.model('BaseUser', baseUserSchema);

// ========== NOW REQUIRE DISCRIMINATOR SCHEMAS ==========
// These schemas are now clean - no dependencies on BaseUser
const datingUserSchema = require("./datingUserSchema");
const staffUserSchema = require("./staffUserSchema");

// ========== CREATE DISCRIMINATORS ==========
const DatingUser = BaseUser.discriminator('DatingUser', datingUserSchema);

// ========== ADD POST HOOKS HERE - BaseUser IS DEFINITELY REGISTERED ==========
// These hooks sync ageVerified from DatingUser to BaseUser
// IMPORTANT: These hooks are attached AFTER the discriminator is created
datingUserSchema.post('save', async function(doc) {
  try {
    if (!doc || doc.ageVerified === undefined) return;
    
    // BaseUser is guaranteed to be registered here
    await BaseUser.findByIdAndUpdate(
      doc._id,
      { 
        $set: { 
          ageVerified: doc.ageVerified,
          ageVerifiedAt: doc.ageVerifiedAt || new Date()
        } 
      },
      { runValidators: false }
    );
    
    console.log(`✅ Synced ageVerified=${doc.ageVerified} to BaseUser ${doc._id}`);
  } catch (error) {
    console.error('❌ Failed to sync ageVerified to BaseUser:', error.message);
  }
});

datingUserSchema.post('findOneAndUpdate', async function(doc) {
  try {
    if (!doc || doc.ageVerified === undefined) return;
    
    // BaseUser is guaranteed to be registered here
    await BaseUser.findByIdAndUpdate(
      doc._id,
      { 
        $set: { 
          ageVerified: doc.ageVerified,
          ageVerifiedAt: doc.ageVerifiedAt || new Date()
        } 
      },
      { runValidators: false }
    );
    
    console.log(`✅ Synced ageVerified=${doc.ageVerified} to BaseUser ${doc._id}`);
  } catch (error) {
    console.error('❌ Failed to sync ageVerified to BaseUser:', error.message);
  }
});

// ========== CREATE OTHER DISCRIMINATORS ==========
const Moderator = BaseUser.discriminator('Moderator', staffUserSchema);
const Admin = BaseUser.discriminator('Admin', staffUserSchema);
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
    
    const existingUser = await UserQuery.getUserByEmail(data.email);
    if (existingUser) {
      throw new Error('Email already registered');
    }
    
    const user = await UserFactory.createUser({
      ...data,
      role
    });
    
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
    
    await DatingUser.findByIdAndDelete(userId);
    
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
    
    if (!user._id.equals(requestingUser._id) && !requestingUser.isAdminUser) {
      throw new Error('Unauthorized');
    }
    
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
    
    if (!user._id.equals(requestingUser._id)) {
      throw new Error('Can only update your own profile');
    }
    
    delete updateData.role;
    delete updateData.userType;
    
    Object.keys(updateData).forEach(key => {
      user[key] = updateData[key];
    });
    
    await user.save();
    return user;
  }
  
  static async sendVerificationEmail(user) {
    console.log(`Verification email sent to ${user.email}`);
    return true;
  }
}

// Export everything
module.exports = {
  BaseUser,
  DatingUser,
  Moderator,
  Admin,
  SuperAdmin,
  ROLES,
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  UserFactory,
  UserQuery,
  UserService
};