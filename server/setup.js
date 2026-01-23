const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

console.log('🚀 Setting up JW Lovers Server...\n');

const directories = [
  'logs',
  'socket/handlers',
  'socket/middleware',
  'config',
  'services',
  'middleware',
  'routes',
  'utils',
  'controllers',
  'models'
];

directories.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`✅ Created directory: ${dir}`);
  }
});

const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  const envExample = `# Server
PORT=5000
NODE_ENV=development
LOG_LEVEL=info

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# MongoDB
MONGODB_URI=mongodb://localhost:27017/jwlovers

# Redis
REDIS_URL=redis://localhost:6379

# Encryption
MESSAGE_ENCRYPTION_KEY=your-32-byte-encryption-key-here
ENCRYPTION_SALT=optional-salt-for-key-derivation

# Frontend
FRONTEND_URL=http://localhost:3000

# Rate Limiting
DISABLE_RATE_LIMITING=false`;
  
  fs.writeFileSync(envPath, envExample);
  console.log('✅ Created .env file');
}

console.log('\n📦 Installing dependencies...');
try {
  execSync('npm install', { stdio: 'inherit', cwd: __dirname });
  console.log('✅ Dependencies installed');
} catch (error) {
  console.error('❌ Failed to install dependencies:', error.message);
}

console.log('\n🔑 Generating encryption key...');
const encryptionKey = crypto.randomBytes(32).toString('hex');
console.log(`Generated MESSAGE_ENCRYPTION_KEY: ${encryptionKey}`);
console.log('\n⚠️  Add this key to your .env file as MESSAGE_ENCRYPTION_KEY');

console.log('\n🎉 Setup complete!');
console.log('\nNext steps:');
console.log('1. Update .env file with your configuration');
console.log('2. Make sure MongoDB and Redis are running');
console.log('3. Start the server: npm start');
console.log('4. For development: npm run dev');