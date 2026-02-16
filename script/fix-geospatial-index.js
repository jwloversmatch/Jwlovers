// scripts/fix-geospatial-index.js
// Run this script to create the required geospatial index for match discovery

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/jwlovers_match';

async function createGeospatialIndex() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    
    // FIX: Use the correct collection name from the error
    const baseusersCollection = db.collection('baseusers');
    
    // Also check if there's a profiles collection that might need the index
    const profilesCollection = db.collection('profiles');

    // Check existing indexes on baseusers
    console.log('\n📋 Checking existing indexes on baseusers...');
    const existingBaseusersIndexes = await baseusersCollection.indexes();
    console.log('Existing indexes:', existingBaseusersIndexes.map(i => i.name));

    // Check if 2dsphere index exists on baseusers
    const has2dsphereBaseusers = existingBaseusersIndexes.some(
      index => index.name === 'profile.location.coordinates_2dsphere' || 
               (index.key && index.key['profile.location.coordinates'] === '2dsphere')
    );

    if (has2dsphereBaseusers) {
      console.log('✅ 2dsphere index already exists on baseusers profile.location.coordinates');
    } else {
      console.log('\n🔧 Creating 2dsphere index on baseusers profile.location.coordinates...');
      
      await baseusersCollection.createIndex(
        { 'profile.location.coordinates': '2dsphere' },
        { name: 'profile_location_coordinates_2dsphere' }
      );
      
      console.log('✅ 2dsphere index created successfully on baseusers!');
    }

    // Optional: Also create index on profiles collection if it exists and uses same structure
    try {
      const profilesExists = await db.listCollections({ name: 'profiles' }).hasNext();
      if (profilesExists) {
        console.log('\n📋 Checking profiles collection...');
        const existingProfilesIndexes = await profilesCollection.indexes();
        const has2dsphereProfiles = existingProfilesIndexes.some(
          index => index.key && index.key['location.coordinates'] === '2dsphere'
        );
        
        if (!has2dsphereProfiles) {
          await profilesCollection.createIndex(
            { 'location.coordinates': '2dsphere' },
            { name: 'location_coordinates_2dsphere' }
          );
          console.log('✅ 2dsphere index created on profiles collection');
        }
      }
    } catch (e) {
      console.log('⚠️ Profiles collection may not exist:', e.message);
    }

    // Verify the index was created on baseusers
    console.log('\n🔍 Verifying index on baseusers...');
    const updatedIndexes = await baseusersCollection.indexes();
    const indexFound = updatedIndexes.find(
      index => index.key && index.key['profile.location.coordinates'] === '2dsphere'
    );

    if (indexFound) {
      console.log('✅ Index verified:', indexFound.name);
      console.log('   Index details:', JSON.stringify(indexFound, null, 2));
    } else {
      console.log('❌ Index not found after creation!');
    }

    // Create other useful indexes for match queries on baseusers
    console.log('\n🔧 Creating additional indexes for match queries on baseusers...');
    
    // Index for gender filter
    await baseusersCollection.createIndex(
      { 'profile.basic.gender': 1 },
      { name: 'profile_basic_gender', background: true }
    );
    console.log('✅ Created index: profile.basic.gender');

    // Index for age (dateOfBirth) filter
    await baseusersCollection.createIndex(
      { 'profile.basic.dateOfBirth': 1 },
      { name: 'profile_basic_dateOfBirth', background: true }
    );
    console.log('✅ Created index: profile.basic.dateOfBirth');

    // Index for visibility settings
    await baseusersCollection.createIndex(
      { 
        'profile.settings.isVisible': 1,
        'profile.settings.isPaused': 1
      },
      { name: 'profile_settings_visibility', background: true }
    );
    console.log('✅ Created index: profile settings visibility');

    // Index for faith preferences
    await baseusersCollection.createIndex(
      { 'profile.faith.servingAs': 1 },
      { name: 'profile_faith_servingAs', background: true, sparse: true }
    );
    console.log('✅ Created index: profile.faith.servingAs');

    // Compound index for common match query pattern
    await baseusersCollection.createIndex(
      {
        'profile.settings.isVisible': 1,
        'profile.settings.isPaused': 1,
        'profile.basic.gender': 1,
        'profile.basic.dateOfBirth': 1
      },
      { name: 'profile_match_query_compound', background: true }
    );
    console.log('✅ Created compound index for match queries');

    console.log('\n✅ All indexes created successfully on baseusers!');
    console.log('\n📋 Final index list on baseusers:');
    const finalIndexes = await baseusersCollection.indexes();
    finalIndexes.forEach(index => {
      console.log(`   - ${index.name}: ${JSON.stringify(index.key)}`);
    });

    console.log('\n✅ Index setup complete! Your match discovery should now work.');
    
  } catch (error) {
    console.error('❌ Error creating index:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the script
createGeospatialIndex()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });