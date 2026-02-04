// services/email/EmailService.js
const nodemailer = require('nodemailer');

class EmailService {
  constructor(config, logger = console) {
    this.transporter = null;
    this.from = config.from || 'noreply@yourdatingapp.com';
    this.initialized = false;
    this.logger = logger;
    this.config = config;

    this.initializeTransporter();
  }

  /**
   * Initialize the email transporter
   */
  initializeTransporter() {
    try {
      const { emailEnabled, emailService, emailHost, emailUser, emailPassword, emailPort, emailSecure, tlsRejectUnauthorized } = this.config;

      if (!emailEnabled) {
        this.logger.warn('⚠️ Email is disabled. Emails will be logged only.');
        this.initialized = false;
        return;
      }

      if (!emailUser || !emailPassword) {
        this.logger.warn('⚠️ Email not configured properly. Emails will be logged to console only.');
        this.initialized = false;
        return;
      }

      const rejectUnauthorized = tlsRejectUnauthorized !== 'false';

      if (emailService) {
        const password = emailPassword.replace(/\s+/g, '');
        
        this.transporter = nodemailer.createTransport({
          service: emailService,
          auth: { user: emailUser, pass: password },
          secure: true,
          tls: { rejectUnauthorized }
        });
        this.logger.info(`✅ Email service initialized with ${emailService}`);
      } else {
        this.transporter = nodemailer.createTransport({
          host: emailHost,
          port: parseInt(emailPort || '587'),
          secure: emailSecure === 'true',
          auth: { user: emailUser, pass: emailPassword },
          tls: { rejectUnauthorized }
        });
        this.logger.info(`✅ Email service initialized with SMTP: ${emailHost}:${emailPort || '587'}`);
      }

      this.initialized = true;
      
      this.verifyConnection().then(success => {
        if (success) {
          this.logger.info('✅ Email server connection verified');
        }
      }).catch(error => {
        this.logger.warn(`⚠️ Email connection verification failed: ${error.message}`);
      });
    } catch (error) {
      this.logger.error('❌ Failed to initialize email service:', error.message);
      this.initialized = false;
    }
  }

  /**
   * Verify email connection
   */
  async verifyConnection() {
    if (!this.transporter) return false;

    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      this.logger.error('❌ Email server connection failed:', error.message);
      return false;
    }
  }

  /**
   * Send email with retry logic
   */
  async sendEmail(to, subject, html, text = null) {
    if (!this.initialized || !this.transporter) {
      this.logger.info('📧 Email (not sent - service not configured/initialized):');
      this.logger.info(`  To: ${to}`);
      this.logger.info(`  Subject: ${subject}`);
      this.logger.info(`  Content preview: ${(text || html.substring(0, 200))}...`);
      return { success: true, simulated: true };
    }

    const mailOptions = {
      from: this.from,
      to,
      subject,
      html,
      text: text || this.stripHtml(html),
    };

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        const info = await this.transporter.sendMail(mailOptions);
        this.logger.info(`✅ Email sent successfully to ${to}: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
      } catch (error) {
        attempts++;
        this.logger.error(`❌ Email send attempt ${attempts}/${maxAttempts} failed: ${error.message}`);
        
        if (attempts >= maxAttempts) {
          this.logger.error(`❌ Failed to send email to ${to} after ${maxAttempts} attempts`);
          return { 
            success: false, 
            error: error.message,
            code: error.code,
            response: error.response
          };
        }
        
        await this.sleep(1000 * Math.pow(2, attempts));
      }
    }

    return { success: false, error: 'Max retry attempts reached' };
  }

  /**
   * Strip HTML tags for plain text version
   */
  stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test email sending
   */
  async testEmail() {
    if (!this.initialized || !this.transporter) {
      return { success: false, error: 'Service not initialized' };
    }
    
    try {
      const result = await this.sendEmail(
        this.config.emailUser,
        'Test Email from JWLovers Match',
        '<h1>Test Email</h1><p>If you receive this, email service is working!</p>',
        'Test Email - If you receive this, email service is working!'
      );
      
      if (result.success) {
        this.logger.info('✅ Test email sent successfully!');
        this.logger.info('📧 Check your inbox at:', this.config.emailUser);
      } else {
        this.logger.error('❌ Test email failed:', result.error);
      }
      
      return result;
    } catch (error) {
      this.logger.error('❌ Test email error:', error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = EmailService;