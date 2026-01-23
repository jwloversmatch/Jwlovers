const mongoose = require('mongoose');
console.log('Testing MongoDB connection...');

const uri = 'mongodb://jwlovers:jwlovers123@mongodb:27017/jwlovers?authSource=admin';

mongoose.connect(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
  .then(() => {
    console.log('✅ SUCCESS: Connected to MongoDB!');
    console.log('Database:', mongoose.connection.name);
    console.log('Host:', mongoose.connection.host);
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ ERROR:', err.message);
    console.log('Error details:', err);
    process.exit(1);
  });
