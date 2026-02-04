// services/email/templates/DatingUserTemplates.js
const EmailConfig = require('../config/EmailConfig');

class DatingUserTemplates {
  constructor() {
    this.config = EmailConfig;
  }

  /**
   * Verification email for dating users
   */
  createVerificationTemplate(email, token, firstName) {
    const verificationUrl = `${this.config.getConfig().frontendUrl}/verify-email/${token}`;
    const expiryTime = this.config.formatExpiryTime(this.config.EXPIRY_TIMES.VERIFICATION);
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
          .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
          .expiry-notice { background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💕 Welcome to JWLovers Match!</h1>
          </div>
          <div class="content">
            <h2>Hi ${firstName || 'there'}! 👋</h2>
            <p>Thanks for joining our dating community! We're excited to have you here.</p>
            <p>To complete your registration and start connecting with amazing people, please verify your email address by clicking the button below:</p>
            
            <center>
              <a href="${verificationUrl}" class="button">Verify My Email</a>
            </center>
            
            <p>Or copy and paste this link into your browser:</p>
            <p style="background: #fff; padding: 10px; border: 1px solid #ddd; word-break: break-all;">${verificationUrl}</p>
            
            <div class="expiry-notice">
              <strong>⏰ SECURITY NOTICE:</strong> For your protection, this verification link expires in <strong>${expiryTime}</strong>.
            </div>
            
            <div class="warning">
              <p><strong>📌 Please note:</strong></p>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li>Verify your email within ${expiryTime} to activate your account</li>
                <li>Check your spam folder if you don't see this email</li>
                <li>Links can only be used once</li>
                <li>For security, expired links cannot be extended</li>
              </ul>
            </div>
            
            <p><strong>What's next?</strong></p>
            <ul>
              <li>✅ Verify your email (within ${expiryTime})</li>
              <li>📝 Complete your profile</li>
              <li>📸 Add your best photos</li>
              <li>💫 Start matching with amazing people!</li>
            </ul>
            
            <p><strong>Need help?</strong><br>
            If the link expires, you can request a new verification email from your account page.</p>
            
            <p>If you didn't create this account, you can safely ignore this email.</p>
            
            <p>Happy dating! ❤️<br>
            The JWLovers Match Team</p>
          </div>
          <div class="footer">
            <p>This is an automated message, please do not reply to this email.</p>
            <p>&copy; ${new Date().getFullYear()} JWLovers Match. All rights reserved.</p>
            <p style="font-size: 11px; color: #888;">Link expiry: ${expiryTime} for security</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `Welcome to JWLovers Match!\n\nHi ${firstName || 'there'}!\n\nThanks for joining our dating community! Please verify your email address to complete your registration.\n\nVerification link: ${verificationUrl}\n\n⚠️ IMPORTANT: This link expires in ${expiryTime} for security reasons.\n\nPlease verify within ${expiryTime} to activate your account.\n\nIf you don't see the email, check your spam folder.\n\nWhat's next?\n1. Verify your email\n2. Complete your profile\n3. Add photos\n4. Start matching!\n\nIf the link expires, request a new one from your account page.\n\nIf you didn't create this account, you can safely ignore this email.\n\nHappy dating!\nThe JWLovers Match Team`;

    return {
      html,
      text,
      subject: '💕 Verify Your Email - Welcome to JWLovers Match!'
    };
  }

  /**
   * Welcome email for dating users
   */
  createWelcomeTemplate(email, firstName) {
    const loginUrl = `${this.config.getConfig().frontendUrl}/login`;
    const profileUrl = `${this.config.getConfig().frontendUrl}/profile/edit`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px; font-weight: bold; }
          .tip-box { background: #e3f2fd; border-left: 4px solid #2196f3; padding: 15px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
          .success-notice { background: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 You're All Set!</h1>
          </div>
          <div class="content">
            <div class="success-notice">
              <strong>✅ Email Verified!</strong> Your account is now active and ready to use.
            </div>
            
            <h2>Welcome aboard, ${firstName}! 🚀</h2>
            <p>Your email has been verified and your account is now active!</p>
            
            <div class="tip-box">
              <strong>💡 Quick Tips to Get Started:</strong>
              <ul>
                <li>Complete your profile to increase matches by 10x</li>
                <li>Add at least 3 quality photos</li>
                <li>Write a compelling bio that shows your personality</li>
                <li>Be authentic and respectful</li>
              </ul>
            </div>
            
            <center>
              <a href="${profileUrl}" class="button">Complete My Profile</a>
              <a href="${loginUrl}" class="button" style="background: #6c757d;">Go to Dashboard</a>
            </center>
            
            <p><strong>Security Features Activated:</strong></p>
            <ul>
              <li>✅ Email verification completed</li>
              <li>🔒 Secure account access enabled</li>
              <li>🛡️ Basic security measures active</li>
              <li>📧 Verified communication channel</li>
            </ul>
            
            <p><strong>Safety First! 🛡️</strong></p>
            <ul>
              <li>Never share personal information too early</li>
              <li>Meet in public places for first dates</li>
              <li>Trust your instincts</li>
              <li>Report any suspicious behavior</li>
            </ul>
            
            <p>Need help? Check out our <a href="${this.config.getConfig().frontendUrl}/help">Help Center</a> or contact support.</p>
            
            <p>Best of luck finding your match! 💕<br>
            The JWLovers Match Team</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} JWLovers Match. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      html,
      subject: '🎉 Welcome! Your JWLovers Match Account is Active'
    };
  }
}

module.exports = DatingUserTemplates;