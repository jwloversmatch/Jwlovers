const fs = require('fs');
const path = require('path');

console.log('🔍 Searching for duplicate Mongoose index definitions...\n');

// Common patterns to search for
const indexPatterns = [
  { field: 'email', patterns: ['email.*index.*true', 'index.*{.*email'] },
  { field: 'userName', patterns: ['userName.*index.*true', 'index.*{.*userName'] },
  { field: 'location.coordinates', patterns: ['2dsphere', 'location.*coordinates.*index'] },
  { field: 'employeeId', patterns: ['employeeId.*index.*true', 'index.*{.*employeeId'] },
  { field: 'code', patterns: ['code.*index.*true', 'index.*{.*code'] }
];

// Search in these directories
const searchDirs = [
  'models',
  'models/User',
  'models/Admin',
  'models/InviteCode'
];

let foundFiles = [];

// Search recursively
function searchInDir(dir) {
  if (!fs.existsSync(dir)) return;
  
  const items = fs.readdirSync(dir);
  
  items.forEach(item => {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      searchInDir(fullPath);
    } else if (item.endsWith('.js')) {
      foundFiles.push(fullPath);
    }
  });
}

// Search all directories
searchDirs.forEach(dir => {
  if (fs.existsSync(dir)) {
    searchInDir(dir);
  }
});

console.log(`📁 Found ${foundFiles.length} JavaScript files to check\n`);

// Check each file
foundFiles.forEach(file => {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    
    let hasIndexes = false;
    const fileIndexes = [];
    
    // Check for inline indexes
    lines.forEach((line, index) => {
      indexPatterns.forEach(patternObj => {
        patternObj.patterns.forEach(pattern => {
          const regex = new RegExp(pattern, 'i');
          if (regex.test(line)) {
            fileIndexes.push({
              field: patternObj.field,
              line: index + 1,
              content: line.trim(),
              file: path.relative(process.cwd(), file)
            });
            hasIndexes = true;
          }
        });
      });
    });
    
    if (hasIndexes) {
      console.log(`📄 ${path.relative(process.cwd(), file)}:`);
      fileIndexes.forEach(idx => {
        console.log(`   Line ${idx.line}: ${idx.field} - "${idx.content.substring(0, 60)}..."`);
      });
      console.log('');
    }
    
  } catch (error) {
    console.log(`❌ Error reading ${file}: ${error.message}`);
  }
});

console.log('\n💡 How to fix:');
console.log('1. Choose ONE method per field:');
console.log('   - EITHER use inline: email: { type: String, index: true }');
console.log('   - OR use schema.index(): schema.index({ email: 1 })');
console.log('2. Remove the duplicate definition');
console.log('3. Run the server again to confirm warnings are gone');