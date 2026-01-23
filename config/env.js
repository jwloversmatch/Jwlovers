const dotenv = require('dotenv');
dotenv.config();

const requiredEnvVars = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'MONGODB_URI',
  'NODE_ENV'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

module.exports = {
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRE || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRE || '30d'
  },
  app: {
    env: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000
  },
  presence: {
    onlineThresholdMinutes: parseInt(process.env.ONLINE_THRESHOLD_MINUTES) || 3,
    heartbeatIntervalSeconds: parseInt(process.env.HEARTBEAT_INTERVAL_SECONDS) || 30
  },
  db: {
    uri: process.env.MONGODB_URI
  }
};