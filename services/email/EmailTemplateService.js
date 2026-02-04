// services/email/EmailTemplateService.js
const DatingUserTemplates = require('./templates/DatingUserTemplates');
const StaffTemplates = require('./templates/StaffTemplates');
const SecurityTemplates = require('./templates/SecurityTemplates');

class EmailTemplateService {
  constructor() {
    this.datingTemplates = new DatingUserTemplates();
    this.staffTemplates = new StaffTemplates();
    this.securityTemplates = new SecurityTemplates();
  }

  // Dating user emails
  getDatingVerificationTemplate(email, token, firstName) {
    return this.datingTemplates.createVerificationTemplate(email, token, firstName);
  }

  getDatingWelcomeTemplate(email, firstName) {
    return this.datingTemplates.createWelcomeTemplate(email, firstName);
  }

  // Staff emails
  getStaffVerificationTemplate(email, token, firstName, role, employeeId) {
    return this.staffTemplates.createVerificationTemplate(email, token, firstName, role, employeeId);
  }

  // Security emails
  getPasswordResetTemplate(email, token, firstName, wasLocked, role) {
    return this.securityTemplates.createPasswordResetTemplate(email, token, firstName, wasLocked, role);
  }

  getPasswordResetConfirmationTemplate(email, firstName, wasLocked, role) {
    return this.securityTemplates.createPasswordResetConfirmationTemplate(email, firstName, wasLocked, role);
  }

  // Generic template
  getGenericTemplate(subject, content) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>JWLovers Match</h1>
          </div>
          <div class="content">
            ${content}
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
      subject
    };
  }
}

module.exports = EmailTemplateService;