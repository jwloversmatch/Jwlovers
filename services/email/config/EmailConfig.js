// services/email/config/EmailConfig.js
module.exports = {
  // Expiry times in hours
  EXPIRY_TIMES: {
    VERIFICATION: 1, // 1 hour for email verification
    PASSWORD_RESET: 0.25, // 15 minutes for password reset
    EMAIL_CHANGE: 1, // 1 hour for email change
  },

  // Cooldown periods in milliseconds
  COOLDOWNS: {
    RESEND: 60 * 1000, // 1 minute between resend requests
    RATE_LIMIT: 3, // Max 3 attempts per hour
  },

  // Email configuration from environment
  getConfig() {
    return {
      from: process.env.EMAIL_FROM || 'noreply@yourdatingapp.com',
      emailEnabled: process.env.EMAIL_ENABLED === 'true' || process.env.EMAIL_ENABLED === true,
      emailService: process.env.EMAIL_SERVICE,
      emailHost: process.env.EMAIL_HOST,
      emailUser: process.env.EMAIL_USER,
      emailPassword: process.env.EMAIL_PASSWORD,
      emailPort: process.env.EMAIL_PORT || '587',
      emailSecure: process.env.EMAIL_SECURE,
      tlsRejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED,
      frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000'
    };
  },

  /**
   * Format expiry time for display
   */
  formatExpiryTime(hours) {
    if (hours < 1) {
      const minutes = Math.floor(hours * 60);
      return `${minutes} minutes`;
    }
    if (hours === 1) {
      return '1 hour';
    }
    return `${hours} hours`;
  },

  /**
   * Log configuration check
   */
  logConfiguration() {
    const config = this.getConfig();
    console.log('\n🔧 Email Configuration Check:');
    console.log('  EMAIL_SERVICE:', config.emailService || 'Not set');
    console.log('  EMAIL_HOST:', config.emailHost || 'Not set');
    console.log('  EMAIL_USER:', config.emailUser || 'Not set');
    console.log('  EMAIL_PASSWORD:', config.emailPassword ? 'Set' : 'Not set');
    console.log('  EMAIL_TLS_REJECT_UNAUTHORIZED:', config.tlsRejectUnauthorized || 'Not set');
    console.log('  EMAIL_ENABLED:', config.emailEnabled);
    console.log('  Verification expiry:', this.EXPIRY_TIMES.VERIFICATION + ' hour(s)');
  }
};