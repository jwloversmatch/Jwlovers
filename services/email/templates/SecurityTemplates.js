// services/email/templates/SecurityTemplates.js
const EmailConfig = require('../config/EmailConfig');

class SecurityTemplates {
  constructor() {
    this.config = EmailConfig;
  }

  /**
   * Password reset email
   */
  createPasswordResetTemplate(email, token, firstName, wasLocked = false, role = 'user') {
    const resetUrl = `${this.config.getConfig().frontendUrl}/reset-password?token=${token}`;
    const isStaff = role !== 'user';
    const expiryTime = this.config.formatExpiryTime(this.config.EXPIRY_TIMES.PASSWORD_RESET);
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: ${isStaff ? 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)' : 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)'}; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 15px 30px; background: ${isStaff ? 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)' : 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)'}; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
          .warning { background: #fee2e2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0; }
          .info { background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; }
          .urgent-notice { background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Password Reset Request</h1>
          </div>
          <div class="content">
            <h2>Hi ${firstName || 'there'}!</h2>
            <p>We received a request to reset your password${wasLocked ? ' and unlock your account' : ''}.</p>
            
            ${wasLocked ? `
            <div class="warning">
              <strong>🔓 Account Status:</strong> Your account was locked due to multiple failed login attempts. Resetting your password will unlock your account.
            </div>
            ` : ''}
            
            <p>Click the button below to reset your password:</p>
            
            <center>
              <a href="${resetUrl}" class="button">Reset Password</a>
            </center>
            
            <p>Or copy and paste this link into your browser:</p>
            <p style="background: #fff; padding: 10px; border: 1px solid #ddd; word-break: break-all;">${resetUrl}</p>
            
            <div class="urgent-notice">
              <strong>⏰ URGENT ACTION REQUIRED:</strong> This password reset link expires in <strong>${expiryTime}</strong> for security reasons.
            </div>
            
            <div class="info">
              <strong>Security Protocol:</strong>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li>Complete password reset within ${expiryTime}</li>
                <li>This is a single-use link</li>
                <li>Expired links cannot be reactivated</li>
                <li>Request a new link if this one expires</li>
              </ul>
            </div>
            
            <p><strong>Password Requirements:</strong></p>
            <ul>
              <li>At least 8 characters long</li>
              <li>Include uppercase and lowercase letters</li>
              <li>Include at least one number</li>
              <li>Include at least one special character</li>
              <li>Should not be a previously used password</li>
            </ul>
            
            <div class="warning">
              <strong>⚠️ Security Alert:</strong><br>
              If you didn't request a password reset, your account may be compromised. 
              ${isStaff ? 'Contact IT security immediately.' : 'Please ignore this email and review your account security.'}
            </div>
            
            ${isStaff ? `
            <p><strong>Staff Security Notice:</strong></p>
            <ul>
              <li>This reset was logged for security audit purposes</li>
              <li>Contact IT security if you suspect unauthorized access</li>
              <li>Review your recent account activity after resetting</li>
              <li>Complete required security training if prompted</li>
            </ul>
            ` : ''}
            
            <p>Stay safe! 🛡️<br>
            ${isStaff ? 'JWLovers Match IT Security Team' : 'The JWLovers Match Team'}</p>
          </div>
          <div class="footer">
            <p>This is an automated security message.</p>
            <p>&copy; ${new Date().getFullYear()} JWLovers Match. All rights reserved.</p>
            <p style="font-size: 11px; color: #888;">Security: Password reset links expire in ${expiryTime}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      html,
      subject: wasLocked ? '🔓 Reset Password & Unlock Account - JWLovers Match' : '🔐 Password Reset Request - JWLovers Match'
    };
  }

  /**
   * Password reset confirmation email
   */
  createPasswordResetConfirmationTemplate(email, firstName, wasLocked = false, role = 'user') {
    const loginUrl = `${this.config.getConfig().frontendUrl}/login`;
    const isStaff = role !== 'user';
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981 0%, #34d399 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #10b981 0%, #34d399 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
          .success { background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; }
          .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
          .security-update { background: #e0f2fe; border-left: 4px solid #0ea5e9; padding: 15px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Password Reset Successful</h1>
          </div>
          <div class="content">
            <h2>Hi ${firstName || 'there'}!</h2>
            
            <div class="success">
              <strong>🎉 Success!</strong> Your password has been reset successfully${wasLocked ? ' and your account has been unlocked' : ''}.
            </div>
            
            <div class="security-update">
              <strong>🔄 Security Update Applied:</strong>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li>New password is now active</li>
                ${wasLocked ? '<li>Account lock has been removed</li>' : ''}
                <li>All active sessions have been terminated</li>
                <li>Security logs have been updated</li>
                <li>Password change timestamp recorded</li>
              </ul>
            </div>
            
            <p>You can now log in with your new password.</p>
            
            <center>
              <a href="${loginUrl}" class="button">Log In Now</a>
            </center>
            
            <p><strong>Security Actions Taken:</strong></p>
            <ul>
              <li>✅ Password successfully changed</li>
              ${wasLocked ? '<li>🔓 Account unlocked and restored</li>' : ''}
              <li>🔄 All active sessions logged out</li>
              <li>🔒 Security settings updated</li>
              <li>📧 Confirmation sent to registered email</li>
            </ul>
            
            <div class="warning">
              <strong>⚠️ Unauthorized Change Alert:</strong><br>
              If you didn't reset your password, your account may be compromised. 
              ${isStaff ? 'Contact IT security immediately for a security audit.' : 'Please contact support immediately.'}
            </div>
            
            <p><strong>Security Recommendations:</strong></p>
            <ul>
              <li>Use a password manager to generate strong passwords</li>
              <li>Don't reuse passwords across different sites</li>
              <li>Change your password regularly (every 90 days)</li>
              <li>Enable two-factor authentication if available</li>
              <li>Never share your password with anyone</li>
              <li>Be cautious of phishing attempts</li>
            </ul>
            
            <p>Stay secure! 🔒<br>
            ${isStaff ? 'JWLovers Match IT Security Team' : 'The JWLovers Match Team'}</p>
          </div>
          <div class="footer">
            <p>This is an automated security confirmation.</p>
            <p>&copy; ${new Date().getFullYear()} JWLovers Match. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      html,
      subject: '✅ Password Reset Successful - JWLovers Match'
    };
  }
}

module.exports = SecurityTemplates;