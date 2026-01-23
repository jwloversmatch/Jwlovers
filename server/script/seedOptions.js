// scripts/seedOptions.js
const mongoose = require('mongoose');
const Option = require('@models/Option.model');
require('dotenv').config();

const initialOptions = [
  // Gender options
  { category: 'gender', value: 'male', label: 'Male', order: 1, isDefault: false },
  { category: 'gender', value: 'female', label: 'Female', order: 2, isDefault: false },
  { category: 'gender', value: 'non-binary', label: 'Non-binary', order: 3, isDefault: false },
  { category: 'gender', value: 'other', label: 'Other', order: 4, isDefault: false },
  { category: 'gender', value: 'prefer-not-to-say', label: 'Prefer not to say', order: 5, isDefault: false },
  
  // Religion options
  { category: 'religion', value: 'christianity', label: 'Christianity', order: 1 },
  { category: 'religion', value: 'islam', label: 'Islam', order: 2 },
  { category: 'religion', value: 'hinduism', label: 'Hinduism', order: 3 },
  { category: 'religion', value: 'buddhism', label: 'Buddhism', order: 4 },
  { category: 'religion', value: 'judaism', label: 'Judaism', order: 5 },
  { category: 'religion', value: 'atheist', label: 'Atheist', order: 6 },
  { category: 'religion', value: 'agnostic', label: 'Agnostic', order: 7 },
  { category: 'religion', value: 'spiritual', label: 'Spiritual', order: 8 },
  { category: 'religion', value: 'other', label: 'Other', order: 9 },
  { category: 'religion', value: 'prefer-not-to-say', label: 'Prefer not to say', order: 10, isDefault: true },
  
  // Serving as options
  { category: 'servingAs', value: 'elder', label: 'Elder', order: 1 },
  { category: 'servingAs', value: 'minister', label: 'Minister', order: 2 },
  { category: 'servingAs', value: 'deacon', label: 'Deacon', order: 3 },
  { category: 'servingAs', value: 'member', label: 'Member', order: 4, isDefault: true },
  { category: 'servingAs', value: 'visitor', label: 'Visitor', order: 5 },
  { category: 'servingAs', value: 'not-specified', label: 'Not specified', order: 6 },
  
  // Relationship status
  { category: 'relationshipStatus', value: 'single', label: 'Single', order: 1, isDefault: true },
  { category: 'relationshipStatus', value: 'divorced', label: 'Divorced', order: 2 },
  { category: 'relationshipStatus', value: 'widowed', label: 'Widowed', order: 3 },
  { category: 'relationshipStatus', value: 'separated', label: 'Separated', order: 4 },
  
  // Looking for
  { category: 'lookingFor', value: 'marriage', label: 'Marriage', order: 1 },
  { category: 'lookingFor', value: 'serious-relationship', label: 'Serious Relationship', order: 2 },
  { category: 'lookingFor', value: 'dating', label: 'Dating', order: 3 },
  { category: 'lookingFor', value: 'friendship', label: 'Friendship', order: 4 },
  { category: 'lookingFor', value: 'not-sure', label: 'Not sure yet', order: 5, isDefault: true },
  
  // Have children
  { category: 'haveChildren', value: 'no', label: 'No children', order: 1, isDefault: true },
  { category: 'haveChildren', value: 'yes-living-with-me', label: 'Yes, living with me', order: 2 },
  { category: 'haveChildren', value: 'yes-not-living-with-me', label: 'Yes, not living with me', order: 3 },
  { category: 'haveChildren', value: 'prefer-not-to-say', label: 'Prefer not to say', order: 4 },
  
  // Education
  { category: 'education', value: 'high-school', label: 'High School', order: 1 },
  { category: 'education', value: 'some-college', label: 'Some College', order: 2 },
  { category: 'education', value: 'associate-degree', label: 'Associate Degree', order: 3 },
  { category: 'education', value: 'bachelors-degree', label: "Bachelor's Degree", order: 4 },
  { category: 'education', value: 'masters-degree', label: "Master's Degree", order: 5 },
  { category: 'education', value: 'phd', label: 'PhD', order: 6 },
  { category: 'education', value: 'other', label: 'Other', order: 7 },
  
  // Income
  { category: 'income', value: 'under-25k', label: 'Under $25,000', order: 1 },
  { category: 'income', value: '25k-50k', label: '$25,000 - $50,000', order: 2 },
  { category: 'income', value: '50k-75k', label: '$50,000 - $75,000', order: 3 },
  { category: 'income', value: '75k-100k', label: '$75,000 - $100,000', order: 4 },
  { category: 'income', value: '100k-150k', label: '$100,000 - $150,000', order: 5 },
  { category: 'income', value: '150k-200k', label: '$150,000 - $200,000', order: 6 },
  { category: 'income', value: '200k-plus', label: '$200,000+', order: 7 },
  { category: 'income', value: 'prefer-not-to-say', label: 'Prefer not to say', order: 8, isDefault: true },
  
  // Match preferences - gender
  { category: 'matchGender', value: 'male', label: 'Men', order: 1 },
  { category: 'matchGender', value: 'female', label: 'Women', order: 2 },
  { category: 'matchGender', value: 'both', label: 'Both', order: 3, isDefault: true },
  
  // Match preferences - religion
  { category: 'matchReligion', value: 'same', label: 'Same religion', order: 1 },
  { category: 'matchReligion', value: 'similar', label: 'Similar religion', order: 2 },
  { category: 'matchReligion', value: 'any', label: 'Any religion', order: 3, isDefault: true },
  { category: 'matchReligion', value: 'christian-only', label: 'Christian only', order: 4 },
  { category: 'matchReligion', value: 'muslim-only', label: 'Muslim only', order: 5 },
  { category: 'matchReligion', value: 'not-important', label: 'Not important', order: 6 },
  
  // Verification badges
  { category: 'verificationBadge', value: 'email', label: 'Email Verified', order: 1 },
  { category: 'verificationBadge', value: 'phone', label: 'Phone Verified', order: 2 },
  { category: 'verificationBadge', value: 'photo', label: 'Photo Verified', order: 3 },
  { category: 'verificationBadge', value: 'income', label: 'Income Verified', order: 4 },
  { category: 'verificationBadge', value: 'education', label: 'Education Verified', order: 5 }
];

async function seedOptions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Clear existing options
    await Option.deleteMany({});
    console.log('🗑️  Cleared existing options');
    
    // Insert new options
    for (const option of initialOptions) {
      await Option.create(option);
    }
    
    console.log(`✅ Seeded ${initialOptions.length} options successfully`);
    
    // Display summary
    const categories = await Option.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);
    
    console.log('\n📊 Summary:');
    categories.forEach(cat => {
      console.log(`   ${cat._id}: ${cat.count} options`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding options:', error);
    process.exit(1);
  }
}

seedOptions();