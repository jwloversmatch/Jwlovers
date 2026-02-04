// controllers/auth/RegistrationController.js - Registration Module
const { BaseUser, ROLES } = require("@models/User");
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

      // ===== 6. CREATE USER =====
      const userData = this.buildUserData({
        email,
        password,
        firstName,
        lastName,
        userName,
        dateOfBirth,
        userRole,
        userType,
        registrationType,
        sessionId,
        employeeId,
        department,
        jobTitle,
        managedUsers,
        gender,
        phoneNumber,
        country,
      });

      const user = await authService.createUserWithRole(userData, session);

      // ===== 7. CREATE DATING PROFILE =====
      if (userType === "DatingUser") {
        await authService.createProfile(user, session);
      }

      // ===== 8. SETUP EMAIL VERIFICATION =====
      const verificationToken = authService.generateVerificationToken();
      user.emailVerificationToken = verificationToken.hashed;
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
      await user.save({ session });

      // ===== 9. MARK INVITE AS USED (STAFF ONLY) =====
      if (userType === "Staff" && inviteCode && securityValidation.inviteValidation) {
        await authService.markInviteAsUsed(
          securityValidation.inviteValidation.invite._id,
          user._id,
          session
        );
      }

      // ===== 10. MARK SECURITY SESSION AS COMPLETED =====
      if (userType === "DatingUser" && sessionId) {
        await markSecuritySessionCompleted(sessionId, user._id, session);
      }

      await session.commitTransaction();

      // ===== 11. QUEUE EMAIL ASYNCHRONOUSLY (NON-BLOCKING) =====
      this.queueVerificationEmail(userType, user, verificationToken.plain);

      // Generate auth response
      const authResponseData = generateAuthResponseData(user, true);

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

      this.logger.info(`✅ User registered: ${user._id} (${userType})`);

      // ===== 12. SEND RESPONSE =====
      const message = this.getSuccessMessage(userType, userRole);

      return standardizedSuccessResponse(res, 201, authResponseData, message);

    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      throw error; // Will be handled by main controller
    } finally {
      session.endSession();
    }
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
    const age = calculateAge(new Date(dateOfBirth));
    
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
    // Check email
    const existingUser = await BaseUser.findOne({
      email: email.toLowerCase().trim()
    }).session(session);

    if (existingUser) {
      return { valid: false, error: "Email already exists" };
    }

    // Check username
    if (userName) {
      const existingUserWithUsername = await BaseUser.findOne({
        userName: userName.trim().toLowerCase()
      }).session(session);

      if (existingUserWithUsername) {
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
    userName,
    dateOfBirth,
    userRole,
    userType,
    registrationType,
    sessionId,
    employeeId,
    department,
    jobTitle,
    managedUsers,
    gender,
    phoneNumber,
    country,
  }) {
    const userData = {
      email: email.toLowerCase().trim(),
      password,
      firstName: firstName?.trim(),
      lastName: lastName?.trim(),
      userName: userName?.trim().toLowerCase(),
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      role: userRole,
      userType: userType,
      isActive: true,
      emailVerified: false,
      registrationType: registrationType,
      registrationDate: new Date(),
      securitySessionId: sessionId,
      tokenVersion: 1,
    };

    // Add staff-specific fields
    if (userType === "Staff") {
      userData.employeeId = employeeId;
      userData.department = department;
      userData.jobTitle = jobTitle;
      userData.managedUsers = managedUsers;
    }

    // Add optional fields
    if (gender) userData.gender = gender;
    if (phoneNumber) userData.phoneNumber = phoneNumber;
    if (country) userData.country = country;

    return userData;
  }

  /**
   * Queue verification email asynchronously
   */
  queueVerificationEmail(userType, user, plainToken) {
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