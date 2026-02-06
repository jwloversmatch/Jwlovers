// test-route-file.js
const path = require('path');

const testFile = (filePath, dependencies = {}) => {
  console.log(`\n🧪 Testing: ${filePath}`);
  console.log('='.repeat(50));
  
  try {
    // Clear cache
    delete require.cache[require.resolve(path.join(__dirname, filePath))];
    
    // Try to load the module
    const module = require(filePath);
    console.log('✅ Module loaded successfully');
    
    // Test 1: Check if it's a function (for DI)
    if (typeof module === 'function') {
      console.log('   ✓ Exports as function');
      
      try {
        const router = module(dependencies);
        if (router && typeof router.use === 'function') {
          console.log('   ✓ Function returns valid router');
          console.log(`   ✓ Router has ${router.stack?.length || 0} middleware layers`);
        } else {
          console.log('   ❌ Function does not return valid router');
        }
      } catch (funcError) {
        console.log(`   ❌ Function call error: ${funcError.message}`);
        console.log(`   Stack: ${funcError.stack.split('\n')[1]}`);
      }
    }
    // Test 2: Check if it's a router directly
    else if (module && typeof module.use === 'function') {
      console.log('   ✓ Exports router directly');
      console.log(`   ✓ Router has ${module.stack?.length || 0} middleware layers`);
    }
    // Test 3: Check other export patterns
    else if (module && module.router) {
      console.log('   ✓ Exports via .router property');
    }
    else {
      console.log('   ❌ Unknown export type');
      console.log('   Type:', typeof module);
      console.log('   Keys:', Object.keys(module || {}));
    }
    
  } catch (error) {
    console.log(`❌ LOAD ERROR: ${error.message}`);
    console.log('Stack trace:');
    console.log(error.stack.split('\n').slice(0, 5).join('\n'));
  }
};

// Test all failing routes
testFile('./routes/auth/auth.routes.js', { logger: console });
testFile('./routes/chat/chat.routes.js', { logger: console });
testFile('./routes/admin/admin.routes.js', { logger: console });