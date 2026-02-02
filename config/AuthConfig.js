// config/AuthConfig.js
module.exports = {
  // Token sources in order of priority
  TOKEN_SOURCES: {
    AUTH_HEADER: 'authorization',
    X_ACCESS_TOKEN: 'x-access-token',
    X_REFRESH_TOKEN: 'x-refresh-token',
    ACCESS_TOKEN_COOKIE: 'accessToken',
    REFRESH_TOKEN_COOKIE: 'refreshToken',
    QUERY_PARAM: 'token'
  },
  
  // Token validation
  ALLOW_QUERY_TOKEN: false,
  TOKEN_MIN_LENGTH: 32,
  
  // User statuses allowed to access protected routes
  ALLOWED_STATUSES: ['active', 'verified', "pending_verification"],
  
  // Rate limiting
  RATE_LIMIT_WINDOW: 15 * 60 * 1000,
  MAX_REQUESTS_PER_WINDOW: 100,
  
  // Security headers
  SECURITY_HEADERS: {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block'
  }
};