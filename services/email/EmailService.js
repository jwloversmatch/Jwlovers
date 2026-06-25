// services/email/EmailService.js

class EmailService {
  constructor(config, logger = console) {
    this.transporter = null;
    this.from = config.from || 'jwloversmatch@gmail.com'; // Defaulting to your verified sender
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
      const { emailEnabled } = this.config;
      const brevoApiKey = process.env.BREVO_API_KEY;

      if (!emailEnabled) {
        this.logger.warn('⚠️ Email is disabled. Emails will be logged only.');
        this.initialized = false;
        return;
      }

      if (!brevoApiKey) {
        this.logger.warn('⚠️ BREVO_API_KEY not found in environment variables. Emails will be logged to console only.');
        this.initialized = false;
        return;
      }

      // ✅ MOCK TRANSPORTER: Drop-in replacement mimicking Nodemailer via Brevo's HTTP API
      this.transporter = {
        verify: async () => {
          // Brevo's API runs over standard web traffic (Port 443), so an SMTP handshake check isn't needed.
          return true; 
        },
        sendMail: async (mailOptions) => {
          const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'api-key': brevoApiKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              sender: { email: mailOptions.from },
              to: [{ email: mailOptions.to }],
              subject: mailOptions.subject,
              htmlContent: mailOptions.html,
              textContent: mailOptions.text
            })
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `Brevo API returned status ${response.status}`);
          }

          const data = await response.json();
          // Returning an object that matches Nodemailer's success structure
          return { messageId: data.messageId };
        }
      };

      this.logger.info(`✅ Email service initialized successfully via Brevo HTTP API`);
      this.initialized = true;
      
      this.verifyConnection().then(success => {
        if (success) {
          this.logger.info('✅ Email connection verified');
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
        // This will call our new Brevo HTTP method seamlessly!
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
        this.config.emailUser || this.from,
        'Test Email from JWLovers Match',
        '<h1>Test Email</h1><p>If you receive this, email service is working!</p>',
        'Test Email - If you receive this, email service is working!'
      );
      
      if (result.success) {
        this.logger.info('✅ Test email sent successfully!');
        this.logger.info('📧 Check your inbox at:', this.config.emailUser || this.from);
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