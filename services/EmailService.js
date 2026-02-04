// // services/EmailService.js - FIXED VERSION WITH TLS FOR GMAIL AND 1-HOUR EXPIRY
// const nodemailer = require('nodemailer');

// class EmailService {
//   constructor() {
//     this.transporter = null;
//     this.from = process.env.EMAIL_FROM || 'noreply@yourdatingapp.com';
//     this.initialized = false;
//     this.logger = console;
    
//     // Expiry configuration - UPDATED TO 1 HOUR
//     this.EXPIRY_TIMES = {
//       VERIFICATION: 1, // 1 hour for email verification
//       PASSWORD_RESET: 0.25, // 15 minutes for password reset
//       EMAIL_CHANGE: 1, // 1 hour for email change
//     };
    
//     // DEBUG: Show what's configured
//     console.log('\n🔧 Email Configuration Check:');
//     console.log('  EMAIL_SERVICE:', process.env.EMAIL_SERVICE || 'Not set');
//     console.log('  EMAIL_HOST:', process.env.EMAIL_HOST || 'Not set');
//     console.log('  EMAIL_USER:', process.env.EMAIL_USER || 'Not set');
//     console.log('  EMAIL_PASSWORD:', process.env.EMAIL_PASSWORD ? 'Set' : 'Not set');
//     console.log('  EMAIL_TLS_REJECT_UNAUTHORIZED:', process.env.EMAIL_TLS_REJECT_UNAUTHORIZED || 'Not set');
//     console.log('  EMAIL_ENABLED:', process.env.EMAIL_ENABLED || 'Not set');
//     console.log('  Verification expiry:', this.EXPIRY_TIMES.VERIFICATION + ' hour(s)');
    
//     this.initializeTransporter();
//   }

//   /**
//    * Initialize the email transporter - FIXED VERSION WITH TLS
//    */
//   initializeTransporter() {
//     try {
//       // Check if email is configured
//       const hasServiceConfig = process.env.EMAIL_SERVICE && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD;
//       const hasSMTPConfig = process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD;
//       const emailEnabled = process.env.EMAIL_ENABLED === 'true' || process.env.EMAIL_ENABLED === true;
      
//       if (!emailEnabled) {
//         this.logger.warn('⚠️ Email is disabled (EMAIL_ENABLED=false). Emails will be logged only.');
//         this.initialized = false;
//         return;
//       }
      
//       if (!hasServiceConfig && !hasSMTPConfig) {
//         this.logger.warn('⚠️ Email not configured properly. Emails will be logged to console only.');
//         this.logger.warn('Required: EMAIL_USER and EMAIL_PASSWORD, plus either EMAIL_SERVICE or EMAIL_HOST');
//         this.initialized = false;
//         return;
//       }

//       // Get TLS setting - IMPORTANT!
//       const rejectUnauthorized = process.env.EMAIL_TLS_REJECT_UNAUTHORIZED !== 'false';
//       console.log(`🔧 TLS Configuration: rejectUnauthorized = ${rejectUnauthorized}`);
//       console.log(`🔧 For development, set EMAIL_TLS_REJECT_UNAUTHORIZED=false in .env`);

//       // Create transporter based on service or custom SMTP
//       if (process.env.EMAIL_SERVICE) {
//         // Using a service like Gmail, Outlook, etc.
//         // Remove spaces from Google App Password
//         const password = process.env.EMAIL_PASSWORD.replace(/\s+/g, '');
        
//         this.transporter = nodemailer.createTransport({
//           service: process.env.EMAIL_SERVICE,
//           auth: {
//             user: process.env.EMAIL_USER,
//             pass: password,
//           },
//           secure: true,
//           tls: {
//             rejectUnauthorized: rejectUnauthorized
//           }
//         });
//         this.logger.info(`✅ Email service initialized with ${process.env.EMAIL_SERVICE} (TLS: ${rejectUnauthorized ? 'strict' : 'lenient'})`);
//       } else {
//         // Using custom SMTP server
//         this.transporter = nodemailer.createTransport({
//           host: process.env.EMAIL_HOST,
//           port: parseInt(process.env.EMAIL_PORT || '587'),
//           secure: process.env.EMAIL_SECURE === 'true',
//           auth: {
//             user: process.env.EMAIL_USER,
//             pass: process.env.EMAIL_PASSWORD,
//           },
//           tls: {
//             rejectUnauthorized: rejectUnauthorized
//           },
//         });
//         this.logger.info(`✅ Email service initialized with SMTP: ${process.env.EMAIL_HOST}:${process.env.EMAIL_PORT || '587'} (TLS: ${rejectUnauthorized ? 'strict' : 'lenient'})`);
//       }

//       this.initialized = true;
      
//       // Verify connection in background
//       this.verifyConnection().then(success => {
//         if (success) {
//           this.logger.info('✅ Email server connection verified');
//         }
//       }).catch(error => {
//         this.logger.warn(`⚠️ Email connection verification failed: ${error.message}`);
//       });
//     } catch (error) {
//       this.logger.error('❌ Failed to initialize email service:', error.message);
//       this.initialized = false;
//     }
//   }

//   /**
//    * Verify email connection
//    */
//   async verifyConnection() {
//     if (!this.transporter) return false;

//     try {
//       await this.transporter.verify();
//       return true;
//     } catch (error) {
//       this.logger.error('❌ Email server connection failed:', error.message);
//       return false;
//     }
//   }

//   /**
//    * Send email with retry logic
//    */
//   async sendEmail(to, subject, html, text = null) {
//     // If not initialized, just log the email
//     if (!this.initialized || !this.transporter) {
//       this.logger.info('📧 Email (not sent - service not configured/initialized):');
//       this.logger.info(`  To: ${to}`);
//       this.logger.info(`  Subject: ${subject}`);
//       this.logger.info(`  Content preview: ${(text || html.substring(0, 200))}...`);
//       return { success: true, simulated: true };
//     }

//     const mailOptions = {
//       from: this.from,
//       to,
//       subject,
//       html,
//       text: text || this.stripHtml(html),
//     };

//     let attempts = 0;
//     const maxAttempts = 3;

//     while (attempts < maxAttempts) {
//       try {
//         const info = await this.transporter.sendMail(mailOptions);
//         this.logger.info(`✅ Email sent successfully to ${to}: ${info.messageId}`);
//         return { success: true, messageId: info.messageId };
//       } catch (error) {
//         attempts++;
//         this.logger.error(`❌ Email send attempt ${attempts}/${maxAttempts} failed: ${error.message}`);
        
//         if (attempts >= maxAttempts) {
//           this.logger.error(`❌ Failed to send email to ${to} after ${maxAttempts} attempts`);
//           return { 
//             success: false, 
//             error: error.message,
//             code: error.code,
//             response: error.response
//           };
//         }
        
//         // Wait before retry (exponential backoff)
//         await this.sleep(1000 * Math.pow(2, attempts));
//       }
//     }

//     return { success: false, error: 'Max retry attempts reached' };
//   }

//   /**
//    * Strip HTML tags for plain text version
//    */
//   stripHtml(html) {
//     return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
//   }

//   /**
//    * Sleep utility
//    */
//   sleep(ms) {
//     return new Promise(resolve => setTimeout(resolve, ms));
//   }

//   /**
//    * Format expiry time for display
//    */
//   formatExpiryTime(hours) {
//     if (hours < 1) {
//       const minutes = Math.floor(hours * 60);
//       return `${minutes} minutes`;
//     }
//     if (hours === 1) {
//       return '1 hour';
//     }
//     return `${hours} hours`;
//   }

//   // ========== EMAIL TEMPLATES ==========

//   async sendDatingUserVerification(email, token, firstName) {
//     const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;
//     const expiryTime = this.formatExpiryTime(this.EXPIRY_TIMES.VERIFICATION);
    
//     const html = `
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <style>
//           body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
//           .container { max-width: 600px; margin: 0 auto; padding: 20px; }
//           .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
//           .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
//           .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
//           .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
//           .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
//           .expiry-notice { background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; border-radius: 4px; }
//         </style>
//       </head>
//       <body>
//         <div class="container">
//           <div class="header">
//             <h1>💕 Welcome to JWLovers Match!</h1>
//           </div>
//           <div class="content">
//             <h2>Hi ${firstName || 'there'}! 👋</h2>
//             <p>Thanks for joining our dating community! We're excited to have you here.</p>
//             <p>To complete your registration and start connecting with amazing people, please verify your email address by clicking the button below:</p>
            
//             <center>
//               <a href="${verificationUrl}" class="button">Verify My Email</a>
//             </center>
            
//             <p>Or copy and paste this link into your browser:</p>
//             <p style="background: #fff; padding: 10px; border: 1px solid #ddd; word-break: break-all;">${verificationUrl}</p>
            
//             <div class="expiry-notice">
//               <strong>⏰ SECURITY NOTICE:</strong> For your protection, this verification link expires in <strong>${expiryTime}</strong>.
//             </div>
            
//             <div class="warning">
//               <p><strong>📌 Please note:</strong></p>
//               <ul style="margin: 10px 0; padding-left: 20px;">
//                 <li>Verify your email within ${expiryTime} to activate your account</li>
//                 <li>Check your spam folder if you don't see this email</li>
//                 <li>Links can only be used once</li>
//                 <li>For security, expired links cannot be extended</li>
//               </ul>
//             </div>
            
//             <p><strong>What's next?</strong></p>
//             <ul>
//               <li>✅ Verify your email (within ${expiryTime})</li>
//               <li>📝 Complete your profile</li>
//               <li>📸 Add your best photos</li>
//               <li>💫 Start matching with amazing people!</li>
//             </ul>
            
//             <p><strong>Need help?</strong><br>
//             If the link expires, you can request a new verification email from your account page.</p>
            
//             <p>If you didn't create this account, you can safely ignore this email.</p>
            
//             <p>Happy dating! ❤️<br>
//             The JWLovers Match Team</p>
//           </div>
//           <div class="footer">
//             <p>This is an automated message, please do not reply to this email.</p>
//             <p>&copy; ${new Date().getFullYear()} JWLovers Match. All rights reserved.</p>
//             <p style="font-size: 11px; color: #888;">Link expiry: ${expiryTime} for security</p>
//           </div>
//         </div>
//       </body>
//       </html>
//     `;

//     const text = `Welcome to JWLovers Match!\n\nHi ${firstName || 'there'}!\n\nThanks for joining our dating community! Please verify your email address to complete your registration.\n\nVerification link: ${verificationUrl}\n\n⚠️ IMPORTANT: This link expires in ${expiryTime} for security reasons.\n\nPlease verify within ${expiryTime} to activate your account.\n\nIf you don't see the email, check your spam folder.\n\nWhat's next?\n1. Verify your email\n2. Complete your profile\n3. Add photos\n4. Start matching!\n\nIf the link expires, request a new one from your account page.\n\nIf you didn't create this account, you can safely ignore this email.\n\nHappy dating!\nThe JWLovers Match Team`;

//     return this.sendEmail(email, '💕 Verify Your Email - Welcome to JWLovers Match!', html, text);
//   }

//   async sendDatingUserWelcome(email, firstName) {
//     const loginUrl = `${process.env.FRONTEND_URL}/login`;
//     const profileUrl = `${process.env.FRONTEND_URL}/profile/edit`;
    
//     const html = `
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <style>
//           body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
//           .container { max-width: 600px; margin: 0 auto; padding: 20px; }
//           .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
//           .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
//           .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px; font-weight: bold; }
//           .tip-box { background: #e3f2fd; border-left: 4px solid #2196f3; padding: 15px; margin: 20px 0; }
//           .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
//           .success-notice { background: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 4px; }
//         </style>
//       </head>
//       <body>
//         <div class="container">
//           <div class="header">
//             <h1>🎉 You're All Set!</h1>
//           </div>
//           <div class="content">
//             <div class="success-notice">
//               <strong>✅ Email Verified!</strong> Your account is now active and ready to use.
//             </div>
            
//             <h2>Welcome aboard, ${firstName}! 🚀</h2>
//             <p>Your email has been verified and your account is now active!</p>
            
//             <div class="tip-box">
//               <strong>💡 Quick Tips to Get Started:</strong>
//               <ul>
//                 <li>Complete your profile to increase matches by 10x</li>
//                 <li>Add at least 3 quality photos</li>
//                 <li>Write a compelling bio that shows your personality</li>
//                 <li>Be authentic and respectful</li>
//               </ul>
//             </div>
            
//             <center>
//               <a href="${profileUrl}" class="button">Complete My Profile</a>
//               <a href="${loginUrl}" class="button" style="background: #6c757d;">Go to Dashboard</a>
//             </center>
            
//             <p><strong>Security Features Activated:</strong></p>
//             <ul>
//               <li>✅ Email verification completed</li>
//               <li>🔒 Secure account access enabled</li>
//               <li>🛡️ Basic security measures active</li>
//               <li>📧 Verified communication channel</li>
//             </ul>
            
//             <p><strong>Safety First! 🛡️</strong></p>
//             <ul>
//               <li>Never share personal information too early</li>
//               <li>Meet in public places for first dates</li>
//               <li>Trust your instincts</li>
//               <li>Report any suspicious behavior</li>
//             </ul>
            
//             <p>Need help? Check out our <a href="${process.env.FRONTEND_URL}/help">Help Center</a> or contact support.</p>
            
//             <p>Best of luck finding your match! 💕<br>
//             The JWLovers Match Team</p>
//           </div>
//           <div class="footer">
//             <p>&copy; ${new Date().getFullYear()} JWLovers Match. All rights reserved.</p>
//           </div>
//         </div>
//       </body>
//       </html>
//     `;

//     return this.sendEmail(email, '🎉 Welcome! Your JWLovers Match Account is Active', html);
//   }

//   async sendStaffVerification(email, token, firstName, role, employeeId) {
//     const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;
//     const expiryTime = this.formatExpiryTime(this.EXPIRY_TIMES.VERIFICATION);
    
//     const html = `
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <style>
//           body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
//           .container { max-width: 600px; margin: 0 auto; padding: 20px; }
//           .header { background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
//           .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
//           .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
//           .info-box { background: #fff; border: 2px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 5px; }
//           .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
//           .security-notice { background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; border-radius: 4px; }
//           .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
//         </style>
//       </head>
//       <body>
//         <div class="container">
//           <div class="header">
//             <h1>🏢 Staff Account Created</h1>
//           </div>
//           <div class="content">
//             <h2>Hello ${firstName}! 👋</h2>
//             <p>Your JWLovers Match staff account has been created. Please verify your email to activate your account.</p>
            
//             <div class="info-box">
//               <strong>📋 Account Details:</strong>
//               <ul style="list-style: none; padding-left: 0;">
//                 <li><strong>Role:</strong> ${role.toUpperCase().replace('_', ' ')}</li>
//                 <li><strong>Employee ID:</strong> ${employeeId}</li>
//                 <li><strong>Email:</strong> ${email}</li>
//                 <li><strong>Access Level:</strong> Staff Portal</li>
//               </ul>
//             </div>
            
//             <center>
//               <a href="${verificationUrl}" class="button">Verify My Email</a>
//             </center>
            
//             <p>Or copy and paste this link into your browser:</p>
//             <p style="background: #fff; padding: 10px; border: 1px solid #ddd; word-break: break-all;">${verificationUrl}</p>
            
//             <div class="security-notice">
//               <strong>🔒 SECURITY REQUIREMENT:</strong> This verification link expires in <strong>${expiryTime}</strong> for security compliance.
//             </div>
            
//             <div class="warning">
//               <strong>📌 Staff Protocol:</strong>
//               <ul style="margin: 10px 0; padding-left: 20px;">
//                 <li>Complete verification within ${expiryTime} of receiving this email</li>
//                 <li>This is a single-use security link</li>
//                 <li>Expired links cannot be reactivated for security reasons</li>
//                 <li>Contact IT if you need a new verification link</li>
//               </ul>
//             </div>
            
//             <p><strong>After verification:</strong></p>
//             <ul>
//               <li>You'll have access to the staff dashboard</li>
//               <li>Your permissions will be based on your role</li>
//               <li>Complete any required security training</li>
//               <li>Review and accept the security policy</li>
//             </ul>
            
//             <p><strong>Security Requirements:</strong></p>
//             <ul>
//               <li>🔒 Never share your login credentials</li>
//               <li>🔐 Use a strong, unique password</li>
//               <li>📱 Enable two-factor authentication when available</li>
//               <li>🚨 Report any suspicious activity immediately</li>
//               <li>📧 Keep your email address secure and up-to-date</li>
//             </ul>
            
//             <p><strong>IT Compliance:</strong><br>
//             Failure to verify within ${expiryTime} will require IT intervention to activate your account.</p>
            
//             <p>If you didn't request this account, contact IT security IMMEDIATELY.</p>
            
//             <p>Welcome to the team!<br>
//             JWLovers Match HR & IT Department</p>
//           </div>
//           <div class="footer">
//             <p><strong>CONFIDENTIAL:</strong> This email contains sensitive information.</p>
//             <p>&copy; ${new Date().getFullYear()} JWLovers Match - Staff Portal. All rights reserved.</p>
//             <p style="font-size: 11px; color: #888;">Security compliance: Verification links expire in ${expiryTime}</p>
//           </div>
//         </div>
//       </body>
//       </html>
//     `;

//     return this.sendEmail(email, `🏢 Verify Your JWLovers Match Staff Account - ${role.toUpperCase()}`, html);
//   }

//   async sendPasswordReset(email, token, firstName, wasLocked = false, role = 'user') {
//     const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
//     const isStaff = role !== 'user';
//     const expiryTime = this.formatExpiryTime(this.EXPIRY_TIMES.PASSWORD_RESET);
    
//     const html = `
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <style>
//           body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
//           .container { max-width: 600px; margin: 0 auto; padding: 20px; }
//           .header { background: ${isStaff ? 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)' : 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)'}; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
//           .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
//           .button { display: inline-block; padding: 15px 30px; background: ${isStaff ? 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)' : 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)'}; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
//           .warning { background: #fee2e2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0; }
//           .info { background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; }
//           .urgent-notice { background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; border-radius: 4px; }
//           .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
//         </style>
//       </head>
//       <body>
//         <div class="container">
//           <div class="header">
//             <h1>🔐 Password Reset Request</h1>
//           </div>
//           <div class="content">
//             <h2>Hi ${firstName || 'there'}!</h2>
//             <p>We received a request to reset your password${wasLocked ? ' and unlock your account' : ''}.</p>
            
//             ${wasLocked ? `
//             <div class="warning">
//               <strong>🔓 Account Status:</strong> Your account was locked due to multiple failed login attempts. Resetting your password will unlock your account.
//             </div>
//             ` : ''}
            
//             <p>Click the button below to reset your password:</p>
            
//             <center>
//               <a href="${resetUrl}" class="button">Reset Password</a>
//             </center>
            
//             <p>Or copy and paste this link into your browser:</p>
//             <p style="background: #fff; padding: 10px; border: 1px solid #ddd; word-break: break-all;">${resetUrl}</p>
            
//             <div class="urgent-notice">
//               <strong>⏰ URGENT ACTION REQUIRED:</strong> This password reset link expires in <strong>${expiryTime}</strong> for security reasons.
//             </div>
            
//             <div class="info">
//               <strong>Security Protocol:</strong>
//               <ul style="margin: 10px 0; padding-left: 20px;">
//                 <li>Complete password reset within ${expiryTime}</li>
//                 <li>This is a single-use link</li>
//                 <li>Expired links cannot be reactivated</li>
//                 <li>Request a new link if this one expires</li>
//               </ul>
//             </div>
            
//             <p><strong>Password Requirements:</strong></p>
//             <ul>
//               <li>At least 8 characters long</li>
//               <li>Include uppercase and lowercase letters</li>
//               <li>Include at least one number</li>
//               <li>Include at least one special character</li>
//               <li>Should not be a previously used password</li>
//             </ul>
            
//             <div class="warning">
//               <strong>⚠️ Security Alert:</strong><br>
//               If you didn't request a password reset, your account may be compromised. 
//               ${isStaff ? 'Contact IT security immediately.' : 'Please ignore this email and review your account security.'}
//             </div>
            
//             ${isStaff ? `
//             <p><strong>Staff Security Notice:</strong></p>
//             <ul>
//               <li>This reset was logged for security audit purposes</li>
//               <li>Contact IT security if you suspect unauthorized access</li>
//               <li>Review your recent account activity after resetting</li>
//               <li>Complete required security training if prompted</li>
//             </ul>
//             ` : ''}
            
//             <p>Stay safe! 🛡️<br>
//             ${isStaff ? 'JWLovers Match IT Security Team' : 'The JWLovers Match Team'}</p>
//           </div>
//           <div class="footer">
//             <p>This is an automated security message.</p>
//             <p>&copy; ${new Date().getFullYear()} JWLovers Match. All rights reserved.</p>
//             <p style="font-size: 11px; color: #888;">Security: Password reset links expire in ${expiryTime}</p>
//           </div>
//         </div>
//       </body>
//       </html>
//     `;

//     return this.sendEmail(email, wasLocked ? '🔓 Reset Password & Unlock Account - JWLovers Match' : '🔐 Password Reset Request - JWLovers Match', html);
//   }

//   async sendPasswordResetConfirmation(email, firstName, wasLocked = false, role = 'user') {
//     const loginUrl = `${process.env.FRONTEND_URL}/login`;
//     const isStaff = role !== 'user';
    
//     const html = `
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <style>
//           body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
//           .container { max-width: 600px; margin: 0 auto; padding: 20px; }
//           .header { background: linear-gradient(135deg, #10b981 0%, #34d399 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
//           .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
//           .button { display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #10b981 0%, #34d399 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
//           .success { background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; }
//           .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
//           .security-update { background: #e0f2fe; border-left: 4px solid #0ea5e9; padding: 15px; margin: 20px 0; }
//           .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
//         </style>
//       </head>
//       <body>
//         <div class="container">
//           <div class="header">
//             <h1>✅ Password Reset Successful</h1>
//           </div>
//           <div class="content">
//             <h2>Hi ${firstName || 'there'}!</h2>
            
//             <div class="success">
//               <strong>🎉 Success!</strong> Your password has been reset successfully${wasLocked ? ' and your account has been unlocked' : ''}.
//             </div>
            
//             <div class="security-update">
//               <strong>🔄 Security Update Applied:</strong>
//               <ul style="margin: 10px 0; padding-left: 20px;">
//                 <li>New password is now active</li>
//                 ${wasLocked ? '<li>Account lock has been removed</li>' : ''}
//                 <li>All active sessions have been terminated</li>
//                 <li>Security logs have been updated</li>
//                 <li>Password change timestamp recorded</li>
//               </ul>
//             </div>
            
//             <p>You can now log in with your new password.</p>
            
//             <center>
//               <a href="${loginUrl}" class="button">Log In Now</a>
//             </center>
            
//             <p><strong>Security Actions Taken:</strong></p>
//             <ul>
//               <li>✅ Password successfully changed</li>
//               ${wasLocked ? '<li>🔓 Account unlocked and restored</li>' : ''}
//               <li>🔄 All active sessions logged out</li>
//               <li>🔒 Security settings updated</li>
//               <li>📧 Confirmation sent to registered email</li>
//             </ul>
            
//             <div class="warning">
//               <strong>⚠️ Unauthorized Change Alert:</strong><br>
//               If you didn't reset your password, your account may be compromised. 
//               ${isStaff ? 'Contact IT security immediately for a security audit.' : 'Please contact support immediately.'}
//             </div>
            
//             <p><strong>Security Recommendations:</strong></p>
//             <ul>
//               <li>Use a password manager to generate strong passwords</li>
//               <li>Don't reuse passwords across different sites</li>
//               <li>Change your password regularly (every 90 days)</li>
//               <li>Enable two-factor authentication if available</li>
//               <li>Never share your password with anyone</li>
//               <li>Be cautious of phishing attempts</li>
//             </ul>
            
//             <p>Stay secure! 🔒<br>
//             ${isStaff ? 'JWLovers Match IT Security Team' : 'The JWLovers Match Team'}</p>
//           </div>
//           <div class="footer">
//             <p>This is an automated security confirmation.</p>
//             <p>&copy; ${new Date().getFullYear()} JWLovers Match. All rights reserved.</p>
//           </div>
//         </div>
//       </body>
//       </html>
//     `;

//     return this.sendEmail(email, '✅ Password Reset Successful - JWLovers Match', html);
//   }

//   /**
//    * Test email sending
//    */
//   async testEmail() {
//     console.log('\n🔧 Testing email service...');
    
//     if (!this.initialized || !this.transporter) {
//       console.log('❌ Email service not initialized');
//       return { success: false, error: 'Service not initialized' };
//     }
    
//     try {
//       const result = await this.sendEmail(
//         process.env.EMAIL_USER,
//         'Test Email from JWLovers Match',
//         '<h1>Test Email</h1><p>If you receive this, email service is working!</p>',
//         'Test Email - If you receive this, email service is working!'
//       );
      
//       if (result.success) {
//         console.log('✅ Test email sent successfully!');
//         console.log('📧 Check your inbox at:', process.env.EMAIL_USER);
//       } else {
//         console.log('❌ Test email failed:', result.error);
//       }
      
//       return result;
//     } catch (error) {
//       console.log('❌ Test email error:', error.message);
//       return { success: false, error: error.message };
//     }
//   }
// }

// // Export singleton instance
// module.exports = new EmailService();