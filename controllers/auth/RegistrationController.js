// controllers/auth/RegistrationController.js - TWO-STEP REGISTRATION FLOW WITH MIDDLEWARE LOGIC
const { BaseUser, ROLES, DatingUser } = require("@models/User");
const Profile = require("@models/Profile.model");
const authService = require("@services/AuthService");
const validationService = require("@services/ValidationService");
const emailQueueService = require("@services/EmailQueueService");
const authHelpers = require("@utils/AuthHelpers");

class RegistrationController {
  constructor() {
    this.logger = console;
  }

  /**
   * Main registration handler
   */
  async register(req, res, { 
    standardizedSuccessResponse, 
    standardizedErrorResponse,
    enhanceUserResponse,
    generateAuthResponseData,
    calculateAge,
    validateSecuritySession,
    markSecuritySessionCompleted
  }) {
    const session = await BaseUser.startSession();

    try {
      await session.startTransaction();

      const {
        email,
        password,
        firstName,
        lastName,
        userName,
        dateOfBirth,
        role = ROLES.USER,
        inviteCode,
        sessionId,
        employeeId,
        department,
        jobTitle,
        managedUsers = [],
        gender,
        phoneNumber,
        country,
        registrationType = req.registrationType || "dating",
      } = req.body;

      // ===== 1. DETERMINE USER TYPE =====
      const { userType, userRole } = this.determineUserType(registrationType, role);
      this.logger.info(`👤 ${userType} registration for: ${email}`);

      // ===== 2. SECURITY VALIDATION =====
      const securityValidation = await this.validateSecurity(
        registrationType,
        sessionId,
        inviteCode,
        userRole,
        validateSecuritySession
      );

      if (!securityValidation.valid) {
        await session.abortTransaction();
        return standardizedErrorResponse(res, 403, securityValidation.error);
      }

      // ===== 3. INPUT VALIDATION =====
      const validation = validationService.validateRegistrationInput(req.body);
      if (!validation.valid) {
        await session.abortTransaction();
        return standardizedErrorResponse(res, 400, validation.error);
      }

      // ===== 4. AGE VALIDATION =====
      if (userType === "DatingUser" && dateOfBirth) {
        const ageValidation = this.validateAge(dateOfBirth, calculateAge);
        if (!ageValidation.valid) {
          await session.abortTransaction();
          return standardizedErrorResponse(res, 400, ageValidation.error);
        }
      }

      // ===== 5. CHECK EXISTING USERS =====
      const existingCheck = await this.checkExistingUsers(
        email,
        userName,
        employeeId,
        userType,
        session
      );

      if (!existingCheck.valid) {
        await session.abortTransaction();
        return standardizedErrorResponse(res, 400, existingCheck.error);
      }

      // ===== 6. CREATE USER WITHOUT PROFILE FIRST =====
      const userData = this.buildUserData({
        email,
        password,
        firstName,
        lastName,
        userRole,
        userType,
        registrationType,
        sessionId,
        employeeId,
        department,
        jobTitle,
        managedUsers,
        phoneNumber,
      });

      this.logger.info(`Creating ${userType} WITHOUT profile (will create after)...`);
      this.logger.debug(`User data:`, JSON.stringify({
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        userType: userData.userType,
        role: userData.role,
        hasProfileField: 'profile' in userData
      }, null, 2));

      // Create user without profile initially
      const user = await authService.createUserWithRole(userData, session);
      this.logger.info(`✅ ${userType} created with ID: ${user._id}`);

      // ===== 7. CREATE PROFILE (AFTER USER IS CREATED) =====
      let profile = null;
      if (userType === "DatingUser") {
        this.logger.info(`📝 Creating Profile for user ${user._id}...`);
        
        try {
          profile = await this.createProfileForUser({
            userId: user._id,
            userName,
            dateOfBirth,
            gender,
            phoneNumber,
            country,
            firstName,
            lastName,
            email
          }, session);
          
          this.logger.info(`✅ Profile created with ID: ${profile._id}`);
          
          // ===== 8. UPDATE DATINGUSER WITH PROFILE REFERENCE =====
          await this.updateDatingUserWithProfile(user._id, profile._id, session);
          
        } catch (profileError) {
          this.logger.error(`❌ Failed to create profile:`, profileError);
          throw profileError;
        }
      } else if (userType === "Staff") {
        // Create basic profile for staff users (optional)
        profile = await this.createBasicProfileForStaff({
          userId: user._id,
          firstName,
          lastName,
          email,
          jobTitle,
          department
        }, session);
      }

      // ===== 9. SETUP EMAIL VERIFICATION =====
      const verificationToken = authService.generateVerificationToken();
      user.emailVerificationToken = verificationToken.hashed;
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
      await user.save({ session });
      this.logger.info(`🔐 Verification token generated for user: ${user._id}`);

      // ===== 10. MARK INVITE AS USED (STAFF ONLY) =====
      if (userType === "Staff" && inviteCode && securityValidation.inviteValidation) {
        await authService.markInviteAsUsed(
          securityValidation.inviteValidation.invite._id,
          user._id,
          session
        );
        this.logger.info(`📋 Invite marked as used for staff user: ${user._id}`);
      }

      // ===== 11. MARK SECURITY SESSION AS COMPLETED =====
      if (userType === "DatingUser" && sessionId) {
        await markSecuritySessionCompleted(sessionId, user._id, session);
        this.logger.info(`🔒 Security session completed: ${sessionId}`);
      }

      await session.commitTransaction();
      this.logger.info(`✅ Transaction committed for user registration: ${user._id}`);

      // ===== 12. QUEUE EMAIL ASYNCHRONOUSLY =====
      this.queueVerificationEmail(userType, user, verificationToken.plain);

      // ===== 13. BUILD USER RESPONSE =====
      const userResponse = this.buildUserResponse(user, profile);
      
      // Generate auth response with enhanced user data
      const authResponseData = generateAuthResponseData(userResponse, true);

      // Update user session data
      user.refreshToken = authResponseData.refreshToken;
      user.lastLogin = new Date();
      if (typeof user.updatePresence === "function") {
        await user.updatePresence("online");
      }
      await user.save({ validateBeforeSave: false });

      authHelpers.setAuthCookies(
        res,
        authResponseData.accessToken,
        authResponseData.refreshToken
      );

      this.logger.info(`🎉 User fully registered: ${user._id} (${userType})`);

      // ===== 14. SEND RESPONSE =====
      const message = this.getSuccessMessage(userType, userRole);

      return standardizedSuccessResponse(res, 201, authResponseData, message);

    } catch (error) {
      this.logger.error("📛 Registration error details:");
      this.logger.error("Error name:", error.name);
      this.logger.error("Error message:", error.message);
      
      // Check for Mongoose validation errors
      if (error.name === 'ValidationError') {
        this.logger.error("Validation errors:");
        for (const field in error.errors) {
          this.logger.error(`  ${field}:`, error.errors[field].message);
        }
      }
      
      if (session.inTransaction()) {
        await session.abortTransaction();
        this.logger.info("❌ Transaction aborted due to error");
      }
      return standardizedErrorResponse(res, 400, error.message);
    } finally {
      session.endSession();
    }
  }

  /**
   * Create profile for DatingUser (WITH MIDDLEWARE LOGIC MOVED HERE)
   */
  async createProfileForUser(profileData, session) {
    const {
      userId,
      userName,
      dateOfBirth,
      gender,
      phoneNumber,
      country,
      firstName,
      lastName,
      email
    } = profileData;

    // Parse date of birth properly
    let parsedDateOfBirth = this.parseDateOfBirth(dateOfBirth);
    
    if (!parsedDateOfBirth || isNaN(parsedDateOfBirth.getTime())) {
      throw new Error("Valid date of birth is required for dating users");
    }

    const profile = new Profile({
      userId,
      userName: userName || this.generateTemporaryUsername(email, firstName, lastName),
      dateOfBirth: parsedDateOfBirth,
      gender: gender || "prefer-not-to-say",
      phoneNumber: phoneNumber || "",
      countryOfOrigin: country || "",
      datingProfile: {
        isVisible: true,
        isPaused: false
      },
      profilePicture: null,
      bio: "",
      hobbies: [],
      profileCompletion: 10,
      location: {
        type: 'Point',
        coordinates: [0, 0],
        city: '',
        country: ''
      },
      matchPreferences: {
        gender: [],
        ageRange: { min: 18, max: 45 },
        locationRange: 50,
        relationshipGoals: [],
        mustHaves: [],
        dealBreakers: []
      },
      verificationBadges: [],
      photos: [],
      lastProfileUpdate: new Date() // Set initial update date
    });

    // ========== MOVED FROM PROFILE MODEL MIDDLEWARE ==========
    // Apply the logic that was in Profile model's pre-save middleware
    
    // 1. Normalize username
    if (profile.userName) {
      profile.userName = profile.userName.toLowerCase();
    }
    
    // 2. Calculate profile completion
    this.calculateProfileCompletion(profile);
    
    // 3. Set initial profile stats
    profile.profileViews = 0;
    profile.likeCount = 0;
    profile.matchCount = 0;
    profile.responseRate = 0;
    // ========== END MOVED LOGIC ==========

    try {
      // Save with session, bypassing middleware by using direct MongoDB operation
      // to avoid the "next is not a function" error
      const ProfileModel = require('mongoose').model('Profile');
      
      // Use insertOne to bypass middleware
      const profileDataToSave = profile.toObject();
      
      // Ensure timestamps are set
      const now = new Date();
      profileDataToSave.createdAt = now;
      profileDataToSave.updatedAt = now;
      
      this.logger.info(`📦 Saving profile via direct insert...`);
      
      const result = await ProfileModel.collection.insertOne(
        profileDataToSave,
        { session }
      );
      
      // Update the profile object with the generated _id
      profile._id = result.insertedId;
      profile.isNew = false;
      
      this.logger.info(`✅ Profile saved via direct insert: ${profile._id}`);
      
    } catch (saveError) {
      this.logger.error(`❌ Failed to save profile directly:`, saveError);
      
      // Fallback: Try regular save with middleware disabled
      try {
        this.logger.info(`🔄 Trying fallback save method...`);
        
        // Temporarily remove pre-save middleware
        const ProfileModel = require('mongoose').model('Profile');
        const originalPreSave = ProfileModel.schema._preSave;
        
        if (originalPreSave) {
          ProfileModel.schema._preSave = null;
        }
        
        await profile.save({ session, validateBeforeSave: true });
        
        // Restore middleware
        if (originalPreSave) {
          ProfileModel.schema._preSave = originalPreSave;
        }
        
      } catch (fallbackError) {
        this.logger.error(`❌ Fallback save also failed:`, fallbackError);
        throw new Error(`Failed to save profile: ${fallbackError.message}`);
      }
    }
    
    // Verify profile was saved and has an _id
    if (!profile._id) {
      throw new Error("Profile was saved but has no _id");
    }
    
    this.logger.info(`✅ Profile created with ID: ${profile._id} for user: ${userId}`);
    return profile;
  }

  /**
   * Calculate profile completion (moved from Profile model)
   */
  calculateProfileCompletion(profile) {
    const requiredFields = [
      { field: 'userName', weight: 10 },
      { field: 'profilePicture.url', weight: 15 },
      { field: 'bio', weight: 10, condition: (val) => val && val.length > 50 },
      { field: 'dateOfBirth', weight: 5 },
      { field: 'gender', weight: 5 },
      { field: 'location.city', weight: 10 },
      { field: 'hobbies', weight: 10, condition: (val) => val && val.length >= 3 },
      { field: 'languages', weight: 5, condition: (val) => val && val.length >= 1 },
      { field: 'relationshipStatus', weight: 5 },
      { field: 'lookingFor', weight: 5, condition: (val) => val && val.length >= 1 },
      { field: 'verificationBadges', weight: 10, condition: (val) => val && val.length >= 1 }
    ];
    
    let completion = 0;
    
    requiredFields.forEach(({ field, weight, condition }) => {
      const value = field.split('.').reduce((obj, key) => obj && obj[key], profile);
      
      if (condition) {
        if (condition(value)) completion += weight;
      } else if (value) {
        completion += weight;
      }
    });
    
    // For new profiles during registration, we give a baseline
    if (completion < 10) {
      completion = 10; // Baseline for new profiles
    }
    
    profile.profileCompletion = Math.min(completion, 100);
    return profile.profileCompletion;
  }

  /**
   * Create basic profile for Staff users
   */
  async createBasicProfileForStaff(profileData, session) {
    const {
      userId,
      firstName,
      lastName,
      email,
      jobTitle,
      department
    } = profileData;

    const profile = new Profile({
      userId,
      userName: `${firstName.toLowerCase()}.${lastName.toLowerCase()}`,
      gender: "prefer-not-to-say",
      phoneNumber: "",
      countryOfOrigin: "",
      datingProfile: {
        isVisible: false,
        isPaused: true
      },
      profilePicture: null,
      bio: `${jobTitle} at ${department}`,
      hobbies: [],
      profileCompletion: 5,
      location: {
        type: 'Point',
        coordinates: [0, 0],
        city: '',
        country: ''
      },
      verificationBadges: [],
      lastProfileUpdate: new Date()
    });

    // Calculate completion
    this.calculateProfileCompletion(profile);

    // Save using direct insert to avoid middleware issues
    const mongoose = require('mongoose');
    const ProfileModel = mongoose.model('Profile');
    
    const profileDataToSave = profile.toObject();
    const now = new Date();
    profileDataToSave.createdAt = now;
    profileDataToSave.updatedAt = now;
    
    const result = await ProfileModel.collection.insertOne(
      profileDataToSave,
      { session }
    );
    
    profile._id = result.insertedId;
    profile.isNew = false;
    
    return profile;
  }

  /**
   * Update DatingUser with profile reference
   */
  async updateDatingUserWithProfile(userId, profileId, session) {
    // Find the DatingUser we just created
    const datingUser = await DatingUser.findById(userId).session(session);
    
    if (!datingUser) {
      throw new Error(`DatingUser not found: ${userId}`);
    }
    
    this.logger.info(`📌 Updating DatingUser ${userId} with profile reference: ${profileId}`);
    
    // Update with profile reference
    datingUser.profile = profileId;
    
    // Validate before saving
    const validationError = datingUser.validateSync();
    if (validationError) {
      this.logger.error(`❌ DatingUser validation error when adding profile:`, validationError.errors);
      throw validationError;
    }
    
    await datingUser.save({ session });
    
    this.logger.info(`✅ DatingUser updated with profile: ${datingUser._id} -> ${profileId}`);
    
    return datingUser;
  }

  /**
   * Parse date of birth from various formats
   */
  parseDateOfBirth(dateString) {
    if (!dateString) return null;
    
    // If it's already a Date object
    if (dateString instanceof Date) {
      return dateString;
    }
    
    // If it's a string
    if (typeof dateString === 'string') {
      try {
        // For ISO format YYYY-MM-DD (most common from HTML date input)
        if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
          // Parse as UTC to avoid timezone issues
          const [year, month, day] = dateString.split('-').map(Number);
          return new Date(Date.UTC(year, month - 1, day));
        }
        
        // Try standard Date parsing for other formats
        const date = new Date(dateString);
        if (!isNaN(date.getTime())) {
          return date;
        }
      } catch (error) {
        this.logger.error(`Error parsing date "${dateString}": ${error.message}`);
      }
    }
    
    return null;
  }

  /**
   * Generate temporary username
   */
  generateTemporaryUsername(email, firstName, lastName) {
    const base = firstName ? 
      `${firstName.toLowerCase()}${lastName ? lastName.toLowerCase().charAt(0) : ''}` :
      email.split('@')[0].toLowerCase();
    
    // Remove any non-alphanumeric characters
    const cleanBase = base.replace(/[^a-z0-9]/g, '');
    
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return `${cleanBase}${randomNum}`;
  }

  /**
   * Build user response object
   */
  buildUserResponse(user, profile) {
    // For DatingUser, populate the profile reference if available
    let datingUserData = null;
    if (user.userType === "DatingUser") {
      datingUserData = {
        profile: profile ? profile._id : null,
        hasDatingProfile: !!profile
      };
    }
    
    return {
      ...user.toObject(),
      // Computed properties
      hasDatingProfile: !!datingUserData,
      hasProfile: !!profile,
      profileCompletion: profile ? profile.profileCompletion : 0,
      // Nested objects for easy access
      base: user.toObject(),
      dating: datingUserData,
      profile: profile ? profile.toObject() : null,
      // Backward compatibility
      _id: user._id,
      id: user._id.toString(),
      role: user.role,
      userType: user.userType,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName
    };
  }

  /**
   * Determine user type and role
   */
  determineUserType(registrationType, role) {
    if (registrationType === "staff") {
      return { userType: "Staff", userRole: role };
    }
    return { userType: "DatingUser", userRole: ROLES.USER };
  }

  /**
   * Validate security requirements
   */
  async validateSecurity(registrationType, sessionId, inviteCode, userRole, validateSecuritySession) {
    // Dating user validation
    if (registrationType === "dating") {
      if (!sessionId) {
        return {
          valid: false,
          error: "Security verification required. Please answer the security question first."
        };
      }

      const sessionValidation = await validateSecuritySession(sessionId);
      if (!sessionValidation.valid) {
        return { valid: false, error: sessionValidation.error };
      }

      return { valid: true };
    }

    // Staff user validation
    if (registrationType === "staff") {
      if (!inviteCode) {
        return {
          valid: false,
          error: "Invite code required for staff registration."
        };
      }

      const inviteValidation = await authService.validateAdminInvite(inviteCode, userRole);
      if (!inviteValidation.valid) {
        return { valid: false, error: inviteValidation.error };
      }

      return { valid: true, inviteValidation };
    }

    return { valid: true };
  }

  /**
   * Validate age
   */
  validateAge(dateOfBirth, calculateAge) {
    const dob = this.parseDateOfBirth(dateOfBirth);
    if (!dob) {
      return { valid: false, error: "Invalid date of birth" };
    }
    
    const age = calculateAge(dob);
    
    if (age < 18) {
      return { valid: false, error: "You must be at least 18 years old" };
    }
    
    if (age > 100) {
      return { valid: false, error: "Please enter a valid date of birth" };
    }
    
    return { valid: true, age };
  }

  /**
   * Check for existing users
   */
  async checkExistingUsers(email, userName, employeeId, userType, session) {
    // Check email in BaseUser
    const existingUser = await BaseUser.findOne({
      email: email.toLowerCase().trim()
    }).session(session);

    if (existingUser) {
      return { valid: false, error: "Email already exists" };
    }

    // Check username in Profile
    if (userName) {
      const existingProfileWithUsername = await Profile.findOne({
        userName: userName.trim().toLowerCase()
      }).session(session);

      if (existingProfileWithUsername) {
        return { valid: false, error: "Username already exists" };
      }
    }

    // Check employee ID (staff only)
    if (userType === "Staff" && employeeId) {
      const existingEmployee = await BaseUser.findOne({
        employeeId
      }).session(session);

      if (existingEmployee) {
        return { valid: false, error: "Employee ID already exists" };
      }
    }

    return { valid: true };
  }

  /**
   * Build user data object
   */
  buildUserData({
    email,
    password,
    firstName,
    lastName,
    userRole,
    userType,
    registrationType,
    sessionId,
    employeeId,
    department,
    jobTitle,
    managedUsers,
    phoneNumber,
  }) {
    const userData = {
      email: email.toLowerCase().trim(),
      password,
      firstName: firstName?.trim(),
      lastName: lastName?.trim(),
      role: userRole,
      userType: userType,
      isActive: true,
      emailVerified: false,
      registrationType: registrationType,
      registrationDate: new Date(),
      securitySessionId: sessionId,
      tokenVersion: 1,
      phoneNumber: phoneNumber || "",
      presence: {
        status: 'offline',
        lastSeen: new Date(),
        lastActive: new Date()
      }
    };

    // Add staff-specific fields
    if (userType === "Staff") {
      userData.employeeId = employeeId;
      userData.department = department;
      userData.jobTitle = jobTitle;
      userData.managedUsers = managedUsers;
    }

    // IMPORTANT: DO NOT include profile field here
    // Profile will be added after user creation
    return userData;
  }

  /**
   * Queue verification email asynchronously
   */
  queueVerificationEmail(userType, user, plainToken) {
    try {
      if (userType === "DatingUser") {
        emailQueueService.queueEmail('dating_verification', {
          email: user.email,
          token: plainToken,
          firstName: user.firstName
        });
        this.logger.info(`📧 Dating verification email queued for: ${user.email}`);
      } else {
        emailQueueService.queueEmail('staff_verification', {
          email: user.email,
          token: plainToken,
          firstName: user.firstName,
          role: user.role,
          employeeId: user.employeeId
        });
        this.logger.info(`📧 Staff verification email queued for: ${user.email}`);
      }
    } catch (error) {
      this.logger.error("Failed to queue verification email:", error);
      // Don't throw, just log - email failure shouldn't fail registration
    }
  }

  /**
   * Get success message
   */
  getSuccessMessage(userType, userRole) {
    if (userType === "DatingUser") {
      return "Registration successful! Please check your email to verify your account.";
    }
    return `Staff account created as ${userRole}. Please check your email to verify.`;
  }
}

module.exports = new RegistrationController();