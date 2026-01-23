const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, 'routes');
const adminDir = path.join(routesDir, 'admin');

console.log('🔍 Checking route files...\n');

const routeFiles = [
  { name: 'auth.routes.js', path: path.join(routesDir, 'auth.routes.js') },
  { name: 'user.routes.js', path: path.join(routesDir, 'user.routes.js') },
  { name: 'profile.routes.js', path: path.join(routesDir, 'profile.routes.js') },
  { name: 'match.routes.js', path: path.join(routesDir, 'match.routes.js') },
  { name: 'chat.routes.js', path: path.join(routesDir, 'chat.routes.js') },
  { name: 'presence.routes.js', path: path.join(routesDir, 'presence.routes.js') },
  { name: 'websocket.routes.js', path: path.join(routesDir, 'websocket.routes.js') },
  { name: 'admin.routes.js', path: path.join(adminDir, 'admin.routes.js') },
  { name: 'inviteCodes.routes.js', path: path.join(adminDir, 'inviteCodes.routes.js') }
];

routeFiles.forEach(file => {
  console.log(`📄 ${file.name}:`);
  
  if (!fs.existsSync(file.path)) {
    console.log('   ❌ File does not exist');
    return;
  }
  
  try {
    const content = fs.readFileSync(file.path, 'utf8');
    
    // Check for common issues
    if (!content.includes('module.exports')) {
      console.log('   ⚠️  No module.exports found');
    } else if (content.includes('module.exports = router;')) {
      console.log('   ✅ Proper router export found');
    } else if (content.includes('module.exports = (') || content.includes('module.exports = function')) {
      console.log('   ✅ Function export found');
    } else {
      console.log('   ⚠️  Unknown export format');
    }
    
    // Check for syntax errors
    try {
      require(file.path);
      console.log('   ✅ File loads without errors');
    } catch (loadError) {
      console.log(`   ❌ Load error: ${loadError.message}`);
    }
    
  } catch (error) {
    console.log(`   ❌ Read error: ${error.message}`);
  }
  
  console.log('');
});

console.log('='.repeat(50));
console.log('💡 If files are missing, create minimal versions:');
console.log(`
// Example minimal route file (auth.routes.js)
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Auth API placeholder',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
`);