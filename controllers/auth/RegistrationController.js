// controllers/auth/RegistrationController.js - FINAL FIXED VERSION
const { BaseUser, ROLES, DatingUser } = require("@models/User");
const Profile = require("@models/Profile/Profile.model");
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
      
      const { user, verificationToken } = await authService.createUserWithRole(userData, session);
      this.logger.info(`✅ ${userType} created with ID: ${user._id}`);
      this.logger.info(`🔐 Verification token generated for user: ${user._id}`);

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
        // Create basic profile for staff users
        profile = await this.createBasicProfileForStaff({
          userId: user._id,
          firstName,
          lastName,
          email,
          jobTitle,
          department
        }, session);
      }

      // ===== 9. MARK INVITE AS USED (STAFF ONLY) =====
      if (userType === "Staff" && inviteCode && securityValidation.inviteValidation) {
        await authService.markInviteAsUsed(
          securityValidation.inviteValidation.invite._id,
          user._id,
          session
        );
        this.logger.info(`📋 Invite marked as used for staff user: ${user._id}`);
      }

      // ===== 10. MARK SECURITY SESSION AS COMPLETED =====
      if (userType === "DatingUser" && sessionId) {
        await markSecuritySessionCompleted(sessionId, user._id, session);
        this.logger.info(`🔒 Security session completed: ${sessionId}`);
      }

      await session.commitTransaction();
      this.logger.info(`✅ Transaction committed for user registration: ${user._id}`);

      // ===== 11. QUEUE EMAIL ASYNCHRONOUSLY =====
      this.queueVerificationEmail(userType, user, verificationToken);

      // ===== 12. BUILD USER RESPONSE =====
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

      // ===== 13. SEND RESPONSE =====
      const message = this.getSuccessMessage(userType, userRole);

      return standardizedSuccessResponse(res, 201, authResponseData, message);

    } catch (error) {
      this.logger.error("📛 Registration error details:");
      this.logger.error("Error name:", error.name);
      this.logger.error("Error message:", error.message);
      
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
   * Create profile for DatingUser
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

    // Use Profile model's getDefaultValues static method
    const defaults = Profile.getDefaultValues();
    
    const profile = new Profile({
      userId,
      ...defaults,
      basic: {
        ...defaults.basic,
        userName: userName || this.generateTemporaryUsername(email, firstName, lastName),
        dateOfBirth: parsedDateOfBirth,
        gender: gender || "prefer-not-to-say"
      },
      phoneNumber: phoneNumber || "",
      countryOfOrigin: country || "",
      'datingProfile.isVisible': true,
      'datingProfile.isPaused': false
    });

    // Calculate profile completion
    profile.calculateCompletion();

    try {
      await profile.save({ session });
      this.logger.info(`✅ Profile created with ID: ${profile._id} for user: ${userId}`);
      return profile;
    } catch (saveError) {
      this.logger.error(`❌ Failed to save profile:`, saveError);
      throw new Error(`Failed to save profile: ${saveError.message}`);
    }
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

    const defaults = Profile.getDefaultValues();
    
    const profile = new Profile({
      userId,
      ...defaults,
      basic: {
        ...defaults.basic,
        userName: `${firstName.toLowerCase()}.${lastName.toLowerCase()}`
      },
      bio: `${jobTitle} at ${department}`,
      'datingProfile.isVisible': false,
      'datingProfile.isPaused': true
    });

    // Calculate completion
    profile.calculateCompletion();

    await profile.save({ session });
    
    this.logger.info(`✅ Staff profile created: ${profile._id} for user: ${userId}`);
    return profile;
  }

  /**
   * Update DatingUser with profile reference
   */
  async updateDatingUserWithProfile(userId, profileId, session) {
    const datingUser = await DatingUser.findById(userId).session(session);
    
    if (!datingUser) {
      throw new Error(`DatingUser not found: ${userId}`);
    }
    
    this.logger.info(`📌 Updating DatingUser ${userId} with profile reference: ${profileId}`);
    
    datingUser.profile = profileId;
    
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
    
    if (dateString instanceof Date) {
      return dateString;
    }
    
    if (typeof dateString === 'string') {
      try {
        if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = dateString.split('-').map(Number);
          return new Date(Date.UTC(year, month - 1, day));
        }
        
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
    
    const cleanBase = base.replace(/[^a-z0-9]/g, '');
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return `${cleanBase}${randomNum}`;
  }

  /**
   * Build user response object
   */
  buildUserResponse(user, profile) {
    let datingUserData = null;
    if (user.userType === "DatingUser") {
      datingUserData = {
        profile: profile ? profile._id : null,
        hasDatingProfile: !!profile
      };
    }
    
    return {
      ...user.toObject(),
      hasDatingProfile: !!datingUserData,
      hasProfile: !!profile,
      profileCompletion: profile ? profile.progress?.completion || 0 : 0,
      base: user.toObject(),
      dating: datingUserData,
      profile: profile ? profile.toObject() : null,
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
        'basic.userName': userName.trim().toLowerCase()
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
      // REMOVED: isActive: true - this field doesn't exist, use accountStatus
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