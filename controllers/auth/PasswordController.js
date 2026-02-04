// controllers/auth/PasswordController.js - Password Management Module
const { BaseUser, ROLES } = require("@models/User");
const authService = require("@services/AuthService");
const authHelpers = require("@utils/AuthHelpers");
const emailQueueService = require("@services/EmailQueueService");
const validator = require("validator");

class PasswordController {
  constructor() {
    this.logger = console;
  }

  /**
   * Change password
   */
  async changePassword(req, res, { standardizedSuccessResponse, standardizedErrorResponse }) {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body;

      if (!currentPassword || !newPassword || !confirmPassword) {
        return standardizedErrorResponse(
          res,
          400,
          "All password fields are required",
        );
      }

      if (newPassword !== confirmPassword) {
        return standardizedErrorResponse(
          res,
          400,
          "New passwords do not match",
        );
      }

      const user = await BaseUser.findById(req.userId).select(
        "+password +passwordHistory +accountLockedUntil +role +userType",
      );
      
      if (!user) {
        return standardizedErrorResponse(res, 404, "User not found");
      }

      if (user.accountLockedUntil) {
        const message =
          user.role !== ROLES.USER
            ? "Staff account locked. Contact security team."
            : "Cannot change password while account is locked.";
        return standardizedErrorResponse(res, 403, message);
      }

      const result = await authService.changePassword(
        user,
        currentPassword,
        newPassword,
      );

      if (!result.success) {
        return standardizedErrorResponse(res, 400, result.error);
      }

      await authHelpers.logSecurityEvent(user._id, "password_changed", {
        role: user.role,
        userType: user.userType,
        ip: req.ip,
        timestamp: new Date().toISOString(),
        securityLevel: user.role !== ROLES.USER ? "high" : "standard",
      });

      // Invalidate all tokens
      user.refreshToken = null;
      user.tokenVersion = (user.tokenVersion || 1) + 1;
      await user.save({ validateBeforeSave: false });

      authHelpers.clearAuthCookies(res);

      return standardizedSuccessResponse(
        res,
        200,
        {
          message: "Password changed successfully. Please login again.",
          requiresReauthentication: true,
          timestamp: new Date().toISOString(),
        },
        "Password changed successfully",
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Forgot password - initiate reset
   */
  async forgotPassword(req, res, { standardizedSuccessResponse, standardizedErrorResponse }) {
    try {
      const { email } = req.body;

      if (!email || !validator.isEmail(email)) {
        return standardizedErrorResponse(
          res,
          400,
          "Please provide a valid email address",
        );
      }

      const result = await authService.initiatePasswordReset(email);

      if (!result.success && result.error) {
        return standardizedErrorResponse(res, 429, result.error);
      }

      if (result.userFound) {
        // Queue password reset email asynchronously
        emailQueueService.queueEmail('password_reset', {
          email: result.user.email,
          token: result.resetToken,
          firstName: result.user.firstName,
          wasLocked: result.wasLocked,
          role: result.user.role
        });

        this.logger.info(`📧 Password reset email queued for: ${result.user.email}`);

        return standardizedSuccessResponse(res, 200, {
          message: "Password reset instructions sent to your email",
          expiresIn: 15,
          accountWasLocked: result.wasLocked,
          userType: result.user.userType,
          note: "Check your spam folder if you don't see the email within 5 minutes",
        });
      }

      // Always return success for security
      return standardizedSuccessResponse(res, 200, {
        message:
          "If your email is registered, you will receive password reset instructions within 5 minutes.",
        note: "Check your spam folder",
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Reset password with token
   */
  async resetPassword(req, res, { standardizedSuccessResponse, standardizedErrorResponse }) {
    try {
      const { token, password, confirmPassword } = req.body;

      if (!token || !password || !confirmPassword) {
        return standardizedErrorResponse(
          res,
          400,
          "Token, new password, and confirmation are required",
        );
      }

      if (password !== confirmPassword) {
        return standardizedErrorResponse(
          res,
          400,
          "Passwords do not match",
        );
      }

      const result = await authService.resetPassword(token, password);

      if (!result.success) {
        return standardizedErrorResponse(res, 400, result.error);
      }

      await authHelpers.logSecurityEvent(
        result.user._id,
        "password_reset_with_token",
        {
          ip: req.ip,
          role: result.user.role,
          userType: result.user.userType,
          timestamp: new Date().toISOString(),
          accountWasUnlocked: result.wasLocked,
        },
      );

      // Invalidate all existing tokens
      result.user.refreshToken = null;
      result.user.tokenVersion = (result.user.tokenVersion || 1) + 1;
      await result.user.save({ validateBeforeSave: false });

      // Queue confirmation email asynchronously
      emailQueueService.queueEmail('password_reset_confirmation', {
        email: result.user.email,
        firstName: result.user.firstName,
        wasLocked: result.wasLocked,
        role: result.user.role
      });

      this.logger.info(`📧 Password reset confirmation queued for: ${result.user.email}`);

      return standardizedSuccessResponse(
        res,
        200,
        {
          message: "Password reset successful",
          accountUnlocked: result.wasLocked,
          userType: result.user.userType,
          email: result.user.email,
          nextStep: "login",
        },
        "Password reset successful. Please check your email for confirmation.",
      );
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new PasswordController();