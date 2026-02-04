// services/email/index.js
const EmailConfig = require('./config/EmailConfig');
const EmailService = require('./EmailService');
const EmailTemplateService = require('./EmailTemplateService');

class EmailManager {
  constructor(logger = console) {
    this.logger = logger;
    this.config = EmailConfig;
    
    // Log configuration
    this.config.logConfiguration();
    
    // Initialize services
    this.emailService = new EmailService(this.config.getConfig(), logger);
    this.templateService = new EmailTemplateService();
  }

  // Dating user emails
  async sendDatingUserVerification(email, token, firstName) {
    const template = this.templateService.getDatingVerificationTemplate(email, token, firstName);
    return this.emailService.sendEmail(email, template.subject, template.html, template.text);
  }

  async sendDatingUserWelcome(email, firstName) {
    const template = this.templateService.getDatingWelcomeTemplate(email, firstName);
    return this.emailService.sendEmail(email, template.subject, template.html);
  }

  // Staff emails
  async sendStaffVerification(email, token, firstName, role, employeeId) {
    const template = this.templateService.getStaffVerificationTemplate(email, token, firstName, role, employeeId);
    return this.emailService.sendEmail(email, template.subject, template.html);
  }

  // Security emails
  async sendPasswordReset(email, token, firstName, wasLocked = false, role = 'user') {
    const template = this.templateService.getPasswordResetTemplate(email, token, firstName, wasLocked, role);
    return this.emailService.sendEmail(email, template.subject, template.html);
  }

  async sendPasswordResetConfirmation(email, firstName, wasLocked = false, role = 'user') {
    const template = this.templateService.getPasswordResetConfirmationTemplate(email, firstName, wasLocked, role);
    return this.emailService.sendEmail(email, template.subject, template.html);
  }

  // Generic email
  async sendGenericEmail(to, subject, content) {
    const template = this.templateService.getGenericTemplate(subject, content);
    return this.emailService.sendEmail(to, template.subject, template.html);
  }

  // Test email
  async testEmail() {
    return this.emailService.testEmail();
  }

  // Direct email sending
  async sendEmail(to, subject, html, text) {
    return this.emailService.sendEmail(to, subject, html, text);
  }

  // Get expiry times
  getExpiryTimes() {
    return this.config.EXPIRY_TIMES;
  }

  // Format expiry time
  formatExpiryTime(hours) {
    return this.config.formatExpiryTime(hours);
  }

  // Check if email service is initialized
  isInitialized() {
    return this.emailService.initialized;
  }
}

// Export singleton instance
module.exports = new EmailManager();