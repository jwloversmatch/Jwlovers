// config/env-validator.js
const validator = require('validator');

const validateEnvVars = () => {
  const errors = [];
  const warnings = [];

  console.log('='.repeat(60));
  console.log('🔍 Validating Environment Variables');
  console.log('='.repeat(60));

  // Required environment variables
  const required = [
    'MONGODB_URI',
    'JWT_SECRET',
    'MESSAGE_ENCRYPTION_KEY'
  ];

  required.forEach((key) => {
    if (!process.env[key]) {
      errors.push(`❌ Required environment variable missing: ${key}`);
    } else if (key.includes('SECRET') || key.includes('KEY')) {
      // Check length for secrets
      if (process.env[key].length < 32) {
        warnings.push(`⚠️ ${key} is less than 32 characters. Consider using a longer value for production.`);
      }
    }
  });

  // Validate Redis configuration
  if (process.env.REDIS_ENABLED === 'true' && !process.env.REDIS_URL && !process.env.REDIS_HOST) {
    warnings.push('⚠️ Redis is enabled but REDIS_URL or REDIS_HOST is not set. Using default: localhost:6379');
  }

  // Validate JWT configuration
  if (process.env.JWT_SECRET && process.env.JWT_SECRET === 'your-jwt-secret-key') {
    warnings.push('⚠️ Using default JWT_SECRET. Change this in production!');
  }

  // Validate encryption configuration
  if (process.env.MESSAGE_ENCRYPTION_KEY && process.env.MESSAGE_ENCRYPTION_KEY === 'your-encryption-key') {
    errors.push('❌ Using default MESSAGE_ENCRYPTION_KEY. You MUST change this!');
  }

  // Validate age restriction
  const minAge = parseInt(process.env.MINIMUM_AGE) || 18;
  if (minAge < 18) {
    errors.push('❌ MINIMUM_AGE must be at least 18 for a dating app');
  }

  // Validate production security settings
  if (process.env.NODE_ENV === 'production') {
    if (process.env.DISABLE_RATE_LIMITING === 'true') {
      warnings.push('⚠️ WARNING: Rate limiting is disabled in production!');
    }
    if (process.env.COOKIE_SECURE !== 'true') {
      warnings.push('⚠️ COOKIE_SECURE should be true in production with HTTPS');
    }
    if (process.env.DISABLE_SECURITY_HEADERS === 'true') {
      warnings.push('⚠️ Security headers are disabled in production!');
    }
    if (process.env.ALLOW_CORS_ALL === 'true') {
      warnings.push('⚠️ ALLOW_CORS_ALL is true in production - this is dangerous!');
    }
    if (process.env.SKIP_AUTH === 'true') {
      errors.push('❌ SKIP_AUTH cannot be true in production!');
    }
  }

  // Validate development settings
  if (process.env.NODE_ENV === 'development') {
    if (process.env.DISABLE_RATE_LIMITING_DEV !== 'true' && process.env.DISABLE_RATE_LIMITING !== 'true') {
      console.log('✅ Rate limiting enabled in development (with higher limits)');
    }
    if (process.env.ENABLE_MOCK_DATA === 'true') {
      console.log('✅ Mock data generation enabled');
    }
  }

  // Log all errors and warnings
  if (errors.length > 0) {
    console.error('\n' + '='.repeat(60));
    console.error('ENVIRONMENT VALIDATION ERRORS:');
    console.error('='.repeat(60));
    errors.forEach(error => console.error(error));
    console.error('='.repeat(60));
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n' + '='.repeat(60));
    console.warn('ENVIRONMENT VALIDATION WARNINGS:');
    console.warn('='.repeat(60));
    warnings.forEach(warning => console.warn(warning));
    console.warn('='.repeat(60));
  }

  // Log success with key settings
  console.log('\n✅ Environment variables validated successfully');
  console.log('📋 Key Settings:');
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Redis Enabled: ${process.env.REDIS_ENABLED === 'true'}`);
  console.log(`   Rate Limiting: ${process.env.DISABLE_RATE_LIMITING !== 'true'}`);
  console.log(`   E2EE Encryption: ${process.env.ENABLE_END_TO_END_ENCRYPTION === 'true'}`);
  console.log(`   Content Moderation: ${process.env.CONTENT_MODERATION_ENABLED === 'true'}`);
  console.log(`   Age Verification: ${process.env.AGE_VERIFICATION_REQUIRED === 'true'}`);
  console.log('='.repeat(60) + '\n');
};

module.exports = { validateEnvVars };