// scripts/seedSecurityQuestions.js - UPDATED
require("dotenv").config();
const mongoose = require("mongoose");
const SecurityQuestion = require("../models/SecurityQuestion");
const bcrypt = require("bcryptjs");

const seedQuestions = [
  {
    questionId: "math_001",
    questionText: "What is 5 + 3?",
    answer: "8",
    category: "math",
    difficulty: "easy",
  },
  {
    questionId: "color_001",
    questionText: "What color is a banana?",
    answer: "yellow",
    category: "general",
    difficulty: "easy",
  },
  {
    questionId: "alphabet_001",
    questionText: "What is the first letter of the alphabet?",
    answer: "a",
    category: "general",
    difficulty: "easy",
  },
  {
    questionId: "math_002",
    questionText: "What is 12 - 4?",
    answer: "8",
    category: "math",
    difficulty: "easy",
  },
  {
    questionId: "logic_001",
    questionText: "What comes after Monday?",
    answer: "tuesday",
    category: "logic",
    difficulty: "easy",
  },
  {
    questionId: "math_003",
    questionText: "What is 2 × 4?",
    answer: "8",
    category: "math",
    difficulty: "easy",
  },
];

async function seedDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatdb');
    console.log("✅ Connected to MongoDB");
    
    // Clear existing questions
    await SecurityQuestion.deleteMany({});
    console.log("✅ Cleared existing questions");
    
    // Insert new questions - MANUALLY HASH THE ANSWERS
    let seededCount = 0;
    for (const q of seedQuestions) {
      // Generate salt and hash manually
      const salt = await bcrypt.genSalt(12);
      const hashedAnswer = await bcrypt.hash(q.answer.toLowerCase().trim(), salt);
      
      // Create question with already-hashed answer
      const question = new SecurityQuestion({
        questionId: q.questionId,
        questionText: q.questionText,
        hashedAnswer: hashedAnswer, // Already hashed
        salt: salt, // Provide the salt
        category: q.category,
        difficulty: q.difficulty,
        isActive: true
      });
      
      await question.save();
      seededCount++;
      console.log(`✅ Seeded: ${q.questionText} (Answer: ${q.answer})`);
    }
    
    console.log(`\n🎉 Database seeded successfully! ${seededCount} questions added.`);
    
    // Verify the questions were saved correctly
    const count = await SecurityQuestion.countDocuments();
    console.log(`📊 Total questions in database: ${count}`);
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding database:", error.message);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  seedDatabase();
}

module.exports = { seedQuestions, seedDatabase };