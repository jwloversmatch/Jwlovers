// services/email/templates/StaffTemplates.js
const EmailConfig = require('../config/EmailConfig');

class StaffTemplates {
  constructor() {
    this.config = EmailConfig;
  }

  /**
   * Verification email for staff
   */
  createVerificationTemplate(email, token, firstName, role, employeeId) {
    const verificationUrl = `${this.config.getConfig().frontendUrl}/verify-email/${token}`;
    const expiryTime = this.config.formatExpiryTime(this.config.EXPIRY_TIMES.VERIFICATION);
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
          .info-box { background: #fff; border: 2px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 5px; }
          .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
          .security-notice { background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏢 Staff Account Created</h1>
          </div>
          <div class="content">
            <h2>Hello ${firstName}! 👋</h2>
            <p>Your JWLovers Match staff account has been created. Please verify your email to activate your account.</p>
            
            <div class="info-box">
              <strong>📋 Account Details:</strong>
              <ul style="list-style: none; padding-left: 0;">
                <li><strong>Role:</strong> ${role.toUpperCase().replace('_', ' ')}</li>
                <li><strong>Employee ID:</strong> ${employeeId}</li>
                <li><strong>Email:</strong> ${email}</li>
                <li><strong>Access Level:</strong> Staff Portal</li>
              </ul>
            </div>
            
            <center>
              <a href="${verificationUrl}" class="button">Verify My Email</a>
            </center>
            
            <p>Or copy and paste this link into your browser:</p>
            <p style="background: #fff; padding: 10px; border: 1px solid #ddd; word-break: break-all;">${verificationUrl}</p>
            
            <div class="security-notice">
              <strong>🔒 SECURITY REQUIREMENT:</strong> This verification link expires in <strong>${expiryTime}</strong> for security compliance.
            </div>
            
            <div class="warning">
              <strong>📌 Staff Protocol:</strong>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li>Complete verification within ${expiryTime} of receiving this email</li>
                <li>This is a single-use security link</li>
                <li>Expired links cannot be reactivated for security reasons</li>
                <li>Contact IT if you need a new verification link</li>
              </ul>
            </div>
            
            <p><strong>After verification:</strong></p>
            <ul>
              <li>You'll have access to the staff dashboard</li>
              <li>Your permissions will be based on your role</li>
              <li>Complete any required security training</li>
              <li>Review and accept the security policy</li>
            </ul>
            
            <p><strong>Security Requirements:</strong></p>
            <ul>
              <li>🔒 Never share your login credentials</li>
              <li>🔐 Use a strong, unique password</li>
              <li>📱 Enable two-factor authentication when available</li>
              <li>🚨 Report any suspicious activity immediately</li>
              <li>📧 Keep your email address secure and up-to-date</li>
            </ul>
            
            <p><strong>IT Compliance:</strong><br>
            Failure to verify within ${expiryTime} will require IT intervention to activate your account.</p>
            
            <p>If you didn't request this account, contact IT security IMMEDIATELY.</p>
            
            <p>Welcome to the team!<br>
            JWLovers Match HR & IT Department</p>
          </div>
          <div class="footer">
            <p><strong>CONFIDENTIAL:</strong> This email contains sensitive information.</p>
            <p>&copy; ${new Date().getFullYear()} JWLovers Match - Staff Portal. All rights reserved.</p>
            <p style="font-size: 11px; color: #888;">Security compliance: Verification links expire in ${expiryTime}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      html,
      subject: `🏢 Verify Your JWLovers Match Staff Account - ${role.toUpperCase()}`
    };
  }
}

module.exports = StaffTemplates;