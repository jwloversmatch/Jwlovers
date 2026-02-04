// controllers/auth/EmailVerificationController.js - Email Verification Module
const { BaseUser } = require("@models/User");
const authService = require("@services/AuthService");
const authHelpers = require("@utils/AuthHelpers");
const emailQueueService = require("@services/EmailQueueService");
const validator = require("validator");

class EmailVerificationController {
  constructor() {
    this.logger = console;
    // Configuration for verification expiry times
    this.VERIFICATION_EXPIRY = {
      REGISTRATION: 60 * 60 * 1000,
      PASSWORD_RESET: 15 * 60 * 1000, 
      EMAIL_CHANGE: 60 * 60 * 1000, 
      STAFF: 60 * 60 * 1000, 
      DATING: 60 * 60 * 1000, 
    };
    
    // Cooldown periods
    this.COOLDOWNS = {
      RESEND: 60 * 1000, 
      RATE_LIMIT: 3, 
    };
  }

  /**
   * Get expiry time based on user type
   */
  getExpiryTime(userType = 'DatingUser') {
    return this.VERIFICATION_EXPIRY[userType === 'Staff' ? 'STAFF' : 'DATING'];
  }

  /**
   * Format expiry message for display
   */
  getExpiryMessage(expiryHours) {
    if (expiryHours < 1) {
      const minutes = Math.floor(expiryHours * 60);
      return `expires in ${minutes} minutes`;
    }
    if (expiryHours === 1) {
      return 'expires in 1 hour';
    }
    return `expires in ${expiryHours} hours`;
  }

  /**
   * Resend verification email
   */
  async resendVerification(req, res, { standardizedSuccessResponse, standardizedErrorResponse }) {
    try {
      const { email } = req.body;

      if (!email || !validator.isEmail(email)) {
        return standardizedErrorResponse(res, 400, 'Please provide a valid email address');
      }

      const user = await BaseUser.findOne({
        email: email.toLowerCase().trim(),
        emailVerified: false
      });

      if (!user) {
        // For security, don't reveal if user exists
        return standardizedSuccessResponse(
          res,
          200,
          {
            message: 'If your email exists and is not verified, you will receive a new verification email',
            note: 'Check your spam folder if you don\'t see it within 5 minutes',
            expiresIn: 1, 
            expiryMessage: 'Verification link expires in 1 hour'
          }
        );
      }

      // Check rate limiting
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      
      // Count recent attempts
      const recentAttempts = await BaseUser.aggregate([
        {
          $match: {
            _id: user._id,
            emailVerificationSentAt: { $gt: oneHourAgo }
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 }
          }
        }
      ]);

      const attemptCount = recentAttempts[0]?.count || 0;
      if (attemptCount >= this.COOLDOWNS.RATE_LIMIT) {
        return standardizedErrorResponse(
          res,
          429,
          'Too many verification attempts. Please try again in 1 hour.'
        );
      }

      // Check immediate cooldown (1 minute)
      const lastSent = user.emailVerificationSentAt;
      const oneMinuteAgo = now - this.COOLDOWNS.RESEND;

      if (lastSent && lastSent > oneMinuteAgo) {
        const secondsLeft = Math.ceil((lastSent - oneMinuteAgo) / 1000);
        return standardizedErrorResponse(
          res,
          429,
          `Please wait ${secondsLeft} seconds before requesting another verification email`
        );
      }

      // Generate new token with 1-hour expiry
      const verificationToken = authService.generateVerificationToken();
      const expiryTime = this.getExpiryTime(user.userType);
      
      user.emailVerificationToken = verificationToken.hashed;
      user.emailVerificationExpires = now + expiryTime;
      user.emailVerificationSentAt = now;
      user.verificationAttempts = attemptCount + 1;
      await user.save();

      // Queue email asynchronously with expiry notice
      if (user.userType === 'DatingUser') {
        emailQueueService.queueEmail('dating_verification', {
          email: user.email,
          token: verificationToken.plain,
          firstName: user.firstName,
          expiryHours: 1,
          expiryMessage: 'This verification link expires in 1 hour'
        });
        this.logger.info(`📧 Resent dating verification email (1-hour expiry) queued for: ${user.email}`);
      } else {
        emailQueueService.queueEmail('staff_verification', {
          email: user.email,
          token: verificationToken.plain,
          firstName: user.firstName,
          role: user.role,
          employeeId: user.employeeId,
          expiryHours: 1,
          expiryMessage: 'This verification link expires in 1 hour'
        });
        this.logger.info(`📧 Resent staff verification email (1-hour expiry) queued for: ${user.email}`);
      }

      return standardizedSuccessResponse(
        res,
        200,
        {
          message: 'Verification email sent successfully',
          expiresIn: 1, 
          expiryMessage: 'Link expires in 1 hour',
          userType: user.userType,
          note: 'Check your spam folder if you don\'t see the email within 5 minutes',
          cooldown: 60, // 60 seconds cooldown
          attemptsRemaining: this.COOLDOWNS.RATE_LIMIT - attemptCount - 1
        }
      );
    } catch (error) {
      this.logger.error('Resend verification error:', error);
      throw error;
    }
  }

  /**
   * Verify email with token
   */
  async verifyEmail(req, res, {
    standardizedSuccessResponse,
    standardizedErrorResponse,
    enhanceUserResponse,
    generateAuthResponseData
  }) {
    try {
      const { token } = req.params;

      if (!token) {
        return standardizedErrorResponse(res, 400, "Verification token is required");
      }

      const hashedToken = authService.hashToken(token);

      const user = await BaseUser.findOne({
        emailVerificationToken: hashedToken,
        emailVerificationExpires: { $gt: Date.now() },
        emailVerified: false,
      });

      if (!user) {
        // Check if token exists but is expired
        const expiredUser = await BaseUser.findOne({
          emailVerificationToken: hashedToken,
          emailVerified: false,
        });

        if (expiredUser) {
          return standardizedErrorResponse(
            res,
            410, // Gone status code for expired resources
            "Verification link has expired. Please request a new verification email."
          );
        }

        return standardizedErrorResponse(
          res,
          400,
          "Invalid verification token. Please request a new verification email."
        );
      }

      // Token is valid - update verification status
      user.emailVerified = true;
      user.emailVerificationToken = null;
      user.emailVerificationExpires = null;
      user.emailVerifiedAt = new Date();
      user.verificationAttempts = 0; 

      // Update account status
      if (user.accountStatus === "pending_verification") {
        user.accountStatus = "active";
      } else if (!user.accountStatus) {
        user.accountStatus = "active";
      }

      await user.save();

      // Log security event with timing info
      await authHelpers.logSecurityEvent(user._id, "email_verified", {
        email: user.email,
        userType: user.userType,
        timestamp: new Date().toISOString(),
        verificationTimeUsed: Date.now() - user.emailVerificationSentAt,
        newAccountStatus: user.accountStatus,
      });

      this.logger.info(`✅ Email verified for ${user.email} (${user.userType}) - verification completed in ${Date.now() - user.emailVerificationSentAt}ms`);

      // Send welcome email asynchronously for dating users
      if (user.userType === 'DatingUser') {
        emailQueueService.queueEmail('welcome', {
          email: user.email,
          firstName: user.firstName,
          verificationTime: new Date().toISOString()
        });
        this.logger.info(`📧 Welcome email queued for: ${user.email}`);
      }

      // Generate auth response for automatic login
      const authResponseData = generateAuthResponseData(user, true);

      // Update user session
      user.refreshToken = authResponseData.refreshToken;
      user.lastLogin = new Date();
      if (typeof user.updatePresence === "function") {
        await user.updatePresence("online");
      }
      await user.save({ validateBeforeSave: false });

      // Set cookies
      authHelpers.setAuthCookies(res, authResponseData.accessToken, authResponseData.refreshToken);

      return standardizedSuccessResponse(
        res,
        200,
        {
          email: user.email,
          userType: user.userType,
          accountStatus: user.accountStatus,
          requiresCompleteProfile: user.userType === 'DatingUser',
          user: enhanceUserResponse(user),
          auth: authResponseData,
          message: "Email verified successfully! Your account is now active.",
          securityNote: "For your security, verification links expire after 1 hour",
          verifiedAt: user.emailVerifiedAt
        },
        "Email verified successfully! Welcome aboard!"
      );
    } catch (error) {
      this.logger.error("Verify email error:", error);
      throw error;
    }
  }

  /**
   * Check verification expiry status
   */
  async checkVerificationStatus(req, res, { standardizedSuccessResponse, standardizedErrorResponse }) {
    try {
      const { email } = req.query;

      if (!email || !validator.isEmail(email)) {
        return standardizedErrorResponse(res, 400, 'Please provide a valid email address');
      }

      const user = await BaseUser.findOne({
        email: email.toLowerCase().trim(),
        emailVerified: false
      }).select('emailVerificationExpires emailVerificationSentAt createdAt');

      if (!user) {
        // Don't reveal if user exists
        return standardizedSuccessResponse(res, 200, {
          canRequest: true,
          note: 'You can request a verification email if needed'
        });
      }

      const now = Date.now();
      const expiresAt = user.emailVerificationExpires;
      const sentAt = user.emailVerificationSentAt;

      // Calculate time left
      let timeLeft = null;
      let expired = false;
      
      if (expiresAt) {
        timeLeft = Math.max(0, expiresAt - now);
        expired = timeLeft === 0;
      }

      // Calculate if user can request new verification
      const oneMinuteAgo = now - this.COOLDOWNS.RESEND;
      const canResend = !sentAt || sentAt < oneMinuteAgo;

      return standardizedSuccessResponse(res, 200, {
        hasPendingVerification: !!expiresAt,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        sentAt: sentAt ? new Date(sentAt).toISOString() : null,
        timeLeft: timeLeft ? Math.ceil(timeLeft / 1000) : null, // in seconds
        expired,
        canResend,
        nextResendAvailable: !canResend && sentAt ? new Date(sentAt + this.COOLDOWNS.RESEND).toISOString() : null,
        expiryHours: 1 // Always 1 hour for new requests
      });
    } catch (error) {
      this.logger.error('Check verification status error:', error);
      throw error;
    }
  }
}

module.exports = new EmailVerificationController();